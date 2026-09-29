/**
 * Flattened, view-only export (spec §5, §11 level 1): every component resolved, overrides applied,
 * tokens replaced by literal values for one theme, images inlined, and no `ovd:` markup left — a
 * self-contained SVG that any viewer renders exactly.
 */
import { instanceContent } from './components';
import {
    type ComponentNode,
    type FrameNode,
    type Page,
    type Paint,
    type Project,
    type SceneNode,
    childrenOf,
} from './model';
import { basename, joinPath, resolveRelative } from './paths';
import type { Measure } from './text';
import { type TokenSet, projectTokens, tokenColor } from './tokens';
import { type XmlElement, type XmlNode, serializeXml } from './xml';
import { pageToXml } from './write';

export interface ExportOptions {
    /** Theme to resolve tokens with (default theme when omitted). */
    theme?: string;
    measure?: Measure;
    /** Inline images as data: URIs (default true). */
    inlineImages?: boolean;
}

const MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    svg: 'image/svg+xml',
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Base64 without platform APIs (no Buffer, no btoa on binary strings). */
export function toBase64(bytes: Uint8Array): string {
    let out = '';
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
        const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
        out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + B64[n & 63]!;
    }
    const rest = bytes.length - i;
    if (rest === 1) {
        const n = bytes[i]! << 16;
        out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + '==';
    } else if (rest === 2) {
        const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
        out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + B64[(n >> 6) & 63]! + '=';
    }
    return out;
}

function literal(p: Paint | undefined, set: TokenSet): Paint | undefined {
    if (!p) return p;
    return { color: (p.token && tokenColor(set, p.token)) || p.color };
}

interface Ctx {
    project: Project;
    set: TokenSet;
    opts: ExportOptions;
    /** Guards against a component containing an instance of itself. */
    stack: string[];
}

/** Rewrites a subtree for export: instances resolved, tokens made literal, images inlined. */
function flattenNodes(nodes: SceneNode[], fromFile: string, ctx: Ctx): SceneNode[] {
    const out: SceneNode[] = [];
    for (const src of nodes) {
        if (src.hidden) continue;
        let n: SceneNode = src;
        if (n.type === 'instance') {
            const key = `${fromFile}|${n.href}`;
            const content = ctx.stack.includes(key)
                ? undefined
                : instanceContent(ctx.project, fromFile, n, {
                      tokens: ctx.set,
                      measure: ctx.opts.measure,
                  });
            if (!content) continue;
            const root: ComponentNode = content.root;
            const frame: FrameNode = {
                ...root,
                type: 'frame',
                id: n.id,
                name: n.name,
                x: n.x,
                y: n.y,
                rotation: n.rotation,
                opacity: n.opacity * root.opacity,
                shadow: n.shadow ?? root.shadow,
                link: n.link,
                extra: {},
                extraChildren: [],
                children: flattenNodes(root.children, content.file.file, {
                    ...ctx,
                    stack: [...ctx.stack, key],
                }),
            };
            delete (frame as { variant?: string }).variant;
            out.push(literalise(frame, ctx) as SceneNode);
            continue;
        }
        n = { ...n, extra: {} } as SceneNode;
        if (
            n.type === 'image' &&
            ctx.opts.inlineImages !== false &&
            !/^(data:|https?:)/.test(n.href)
        ) {
            const path = resolveRelative(fromFile, n.href);
            const bytes = ctx.project.assets[path];
            if (bytes) {
                const ext = path.split('.').pop()?.toLowerCase() ?? '';
                n = {
                    ...n,
                    href: `data:${MIME[ext] ?? 'application/octet-stream'};base64,${toBase64(bytes)}`,
                };
            }
        }
        const kids = childrenOf(n);
        if (kids) n = { ...n, children: flattenNodes(kids, fromFile, ctx) } as SceneNode;
        out.push(literalise(n, ctx) as SceneNode);
    }
    return out;
}

function literalise(n: SceneNode | FrameNode, ctx: Ctx): SceneNode {
    const copy = { ...n } as SceneNode & { fill?: Paint; stroke?: { paint: Paint; width: number } };
    if ('fill' in copy && copy.fill) copy.fill = literal(copy.fill, ctx.set);
    if ('stroke' in copy && copy.stroke)
        copy.stroke = { ...copy.stroke, paint: literal(copy.stroke.paint, ctx.set)! };
    if (copy.type === 'text') {
        copy.fill = literal(copy.fill, ctx.set)!;
        delete copy.textStyle;
    }
    if (copy.link) {
        // Keep the link working between exported files: `dashboard.svg#f_home` stays as is (exports
        // are named after their pages); OVD-only trigger/transition attributes are dropped below.
        copy.link = { href: copy.link.href };
    }
    return copy;
}

/** Removes every ovd:* attribute and element, and the namespace declaration. Top-level frames
 *  keep their name as `aria-label` (spec §2: ARIA for accessibility metadata). */
function strip(node: XmlElement, depth = 0): XmlElement {
    const attrs: Record<string, string> = {};
    if (depth === 1 && node.attrs['ovd:type'] === 'frame' && node.attrs['ovd:name']) {
        attrs['aria-label'] = node.attrs['ovd:name'];
        attrs['role'] = 'group';
    }
    for (const [k, v] of Object.entries(node.attrs)) {
        if (k.startsWith('ovd:') || k === 'xmlns:ovd') continue;
        attrs[k] = v;
    }
    const children: XmlNode[] = [];
    for (const c of node.children) {
        if (c.kind === 'element') {
            if (c.name.startsWith('ovd:')) continue;
            children.push(strip(c, depth + 1));
        } else children.push(c);
    }
    return { ...node, attrs, children };
}

export function exportPageXml(project: Project, page: Page, opts: ExportOptions = {}): XmlElement {
    const set = projectTokens(project, opts.theme);
    const ctx: Ctx = { project, set, opts, stack: [] };
    const flat: Page = {
        ...page,
        extra: {},
        children: flattenNodes(page.children, page.file, ctx),
    };
    const xml = strip(pageToXml(flat));
    // A title helps viewers and screen readers identify the file.
    xml.children.unshift({
        kind: 'element',
        name: 'title',
        attrs: {},
        children: [{ kind: 'text', text: page.name }],
    });
    return xml;
}

export function exportPageSvg(project: Project, page: Page, opts: ExportOptions = {}): string {
    return serializeXml(exportPageXml(project, page, opts));
}

/** Where a page's export lives, per the manifest's `exports` folder (spec §3, §5). */
export function exportPath(project: Project, page: Page): string {
    return joinPath(project.manifest.exports || 'exports/', basename(page.file));
}

/** Every page's flattened export, ready for `writeProject({ generated })`. */
export function exportAll(project: Project, opts: ExportOptions = {}): Record<string, string> {
    const out: Record<string, string> = {};
    for (const page of project.pages)
        out[exportPath(project, page)] = exportPageSvg(project, page, opts);
    return out;
}
