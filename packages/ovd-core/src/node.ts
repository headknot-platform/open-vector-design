/**
 * Package folders on disk, for Node tools (the `ovd` CLI, the server, tests). Kept out of
 * `index.ts` so the main entry stays free of `node:fs` for browsers.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { exportAll } from './export';
import { type FileMap, asBytes, readProject, writeProject } from './project';

const TEXT = /\.(svg|json|md|txt|css)$|^\.git\w+$/;
const IGNORE = new Set(['.git', 'node_modules', '.DS_Store']);

/** Reads a package folder into a FileMap (text as UTF-8, everything else as bytes). */
export function readDir(root: string): FileMap {
    const out: FileMap = {};
    const visit = (dir: string) => {
        for (const name of readdirSync(dir)) {
            if (IGNORE.has(name)) continue;
            const full = join(dir, name);
            if (statSync(full).isDirectory()) visit(full);
            else {
                const rel = relative(root, full).split('\\').join('/');
                const buf = readFileSync(full);
                out[rel] = TEXT.test(name) ? buf.toString('utf8') : new Uint8Array(buf);
            }
        }
    };
    visit(root);
    return out;
}

function same(a: string | Uint8Array | undefined, b: string | Uint8Array): boolean {
    if (a === undefined) return false;
    const x = asBytes(a);
    const y = asBytes(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
}

/** Writes the files whose bytes differ; returns their paths. */
function writeChanged(root: string, before: FileMap, files: FileMap): string[] {
    const written: string[] = [];
    for (const [path, content] of Object.entries(files)) {
        if (same(before[path], content)) continue;
        const full = join(root, path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, typeof content === 'string' ? content : Buffer.from(content));
        written.push(path);
    }
    return written.sort();
}

/** `ovd fmt`: rewrites the package's sources into canonical form (§10). */
export function formatDir(root: string): string[] {
    const files = readDir(root);
    return writeChanged(root, files, writeProject(readProject(files)));
}

/**
 * `ovd export`: regenerates the flattened exports (§5) exactly as a server save does — the same
 * `exportAll`, and anything else in the exports folder is removed.
 */
export function exportDir(root: string): { written: string[]; removed: string[] } {
    const files = readDir(root);
    const project = readProject(files);
    const generated = exportAll(project);
    const folder = project.manifest.exports || 'exports/';
    const removed: string[] = [];
    for (const path of Object.keys(files)) {
        if (!path.startsWith(folder) || path in generated) continue;
        rmSync(join(root, path));
        removed.push(path);
    }
    return { written: writeChanged(root, files, generated), removed: removed.sort() };
}
