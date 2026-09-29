/**
 * A whole project as a map of `path → content`. Folder, `.ovd` ZIP and browser storage all reduce
 * to this map, so they share one reader and one writer.
 */
import { canonicalJson } from './json';
import type { Manifest, Project, TokenDocument } from './model';
import { readComponentFile, readPage } from './read';
import { collectTokenRefs, componentFileNodes, refreshFallbacks } from './refs';
import { projectTokens, tokensToCss } from './tokens';
import { type WriteOptions, writeComponentFile, writePage } from './write';

export type FileMap = Record<string, string | Uint8Array>;

export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_SCHEMA = 'https://ovd.dev/schema/0.1/manifest.json';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

export function asText(v: string | Uint8Array): string {
    return typeof v === 'string' ? v : decoder.decode(v);
}

export function asBytes(v: string | Uint8Array): Uint8Array {
    return typeof v === 'string' ? encoder.encode(v) : v;
}

export class ProjectError extends Error {
    constructor(
        public readonly file: string,
        message: string,
    ) {
        super(`${file}: ${message}`);
        this.name = 'ProjectError';
    }
}

export function parseManifest(source: string): Manifest {
    let raw: unknown;
    try {
        raw = JSON.parse(source);
    } catch (e) {
        throw new ProjectError(MANIFEST_FILE, `not valid JSON (${(e as Error).message})`);
    }
    if (!raw || typeof raw !== 'object') throw new ProjectError(MANIFEST_FILE, 'not an object');
    const m = raw as Partial<Manifest>;
    const problems: string[] = [];
    if (typeof m.version !== 'string') problems.push('`version` must be a string');
    if (typeof m.name !== 'string') problems.push('`name` must be a string');
    if (!Array.isArray(m.pages)) problems.push('`pages` must be an array');
    else if (m.pages.some((p) => !p || typeof p.file !== 'string')) {
        problems.push('every page needs a `file`');
    }
    if (problems.length) throw new ProjectError(MANIFEST_FILE, problems.join('; '));
    return {
        ...m,
        version: m.version!,
        name: m.name!,
        id: typeof m.id === 'string' ? m.id : '',
        exports: typeof m.exports === 'string' ? m.exports : 'exports/',
        tokens: Array.isArray(m.tokens) ? m.tokens : [],
        themes: m.themes && typeof m.themes === 'object' ? m.themes : {},
        pages: m.pages!.map((p) => ({ file: p.file, name: p.name ?? p.file })),
    };
}

const isComponentPath = (p: string) => p.startsWith('components/') && p.endsWith('.svg');

export function readProject(files: FileMap): Project {
    const manifestSrc = files[MANIFEST_FILE];
    if (manifestSrc === undefined) throw new ProjectError(MANIFEST_FILE, 'missing');
    const manifest = parseManifest(asText(manifestSrc));

    const used = new Set<string>([MANIFEST_FILE]);
    const pages = manifest.pages.map((p) => {
        const src = files[p.file];
        if (src === undefined) throw new ProjectError(p.file, 'listed in the manifest but missing');
        used.add(p.file);
        const page = readPage(p.file, asText(src));
        if (p.name) page.name = p.name;
        return page;
    });

    // The manifest does not list components (spec §3); they are discovered under components/.
    const componentPaths = Array.isArray(manifest.components)
        ? manifest.components
        : Object.keys(files).filter(isComponentPath).sort();
    const components = componentPaths.map((path) => {
        const src = files[path];
        if (src === undefined) throw new ProjectError(path, 'listed in the manifest but missing');
        used.add(path);
        return readComponentFile(path, asText(src));
    });

    const tokens: Record<string, TokenDocument> = {};
    const tokenPaths = new Set([
        ...manifest.tokens,
        ...Object.values(manifest.themes).flat(),
        ...Object.keys(files).filter((p) => p.endsWith('.tokens.json')),
    ]);
    for (const path of tokenPaths) {
        const src = files[path];
        if (src === undefined) continue;
        try {
            tokens[path] = JSON.parse(asText(src)) as TokenDocument;
        } catch (e) {
            throw new ProjectError(path, `not valid JSON (${(e as Error).message})`);
        }
        used.add(path);
    }

    const assets: Record<string, Uint8Array> = {};
    const comments: Record<string, unknown> = {};
    const other: Record<string, string | Uint8Array> = {};
    for (const [path, content] of Object.entries(files)) {
        if (used.has(path)) continue;
        if (path.startsWith('assets/')) assets[path] = asBytes(content);
        else if (path.startsWith('comments/') && path.endsWith('.json')) {
            try {
                comments[path] = JSON.parse(asText(content));
            } catch {
                other[path] = content;
            }
        } else other[path] = content;
    }

    return { manifest, pages, components, tokens, assets, comments, other };
}

export interface ProjectWriteOptions extends WriteOptions {
    /** Extra files to add or replace (e.g. flattened exports, spec §5). */
    generated?: FileMap;
    /** Theme for the generated `<style>` blocks and fallbacks. Defaults to `defaultTheme()`, not
     *  the editor's preview theme, so toggling light/dark never produces a diff. */
    theme?: string;
}

export function writeProject(project: Project, opts: ProjectWriteOptions = {}): FileMap {
    const out: FileMap = { ...project.other };
    const manifest: Manifest = {
        ...project.manifest,
        pages: project.pages.map((p) => ({ file: p.file, name: p.name })),
    };
    out[MANIFEST_FILE] = canonicalJson(manifest);

    const set = projectTokens(project, opts.theme);
    for (const source of project.pages) {
        const page = structuredClone(source);
        refreshFallbacks(page.children, set);
        const tokenCss = tokensToCss(set, collectTokenRefs(page.children));
        out[page.file] = writePage(page, { ...opts, tokenCss });
    }
    for (const source of project.components) {
        const file = structuredClone(source);
        const nodes = componentFileNodes(file);
        refreshFallbacks(nodes, set);
        const tokenCss = tokensToCss(set, collectTokenRefs(nodes));
        out[file.file] = writeComponentFile(file, { ...opts, tokenCss });
    }
    for (const [path, doc] of Object.entries(project.tokens)) out[path] = canonicalJson(doc);
    for (const [path, bytes] of Object.entries(project.assets)) out[path] = bytes;
    for (const [path, thread] of Object.entries(project.comments))
        out[path] = canonicalJson(thread);
    Object.assign(out, opts.generated);
    return out;
}
