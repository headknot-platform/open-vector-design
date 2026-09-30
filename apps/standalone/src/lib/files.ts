/**
 * Package folders arriving from the user — a picked folder, a folder upload, a `.tar.gz` — go
 * through the same rules an OVD server applies on import: clutter is
 * skipped, anything that could leave the folder is refused, and the shallowest `manifest.json`
 * marks the package root.
 */
import type { FileMap } from '@workspace/ovd-core';

export const TEXT_FILE = /\.(svg|json|md|txt|css)$|(^|\/)\.git\w+$/i;

const SKIP = new Set(['.git', '__MACOSX', '.DS_Store', 'node_modules', 'Thumbs.db']);

/** A safe relative path, or `skip` for clutter. Throws for anything that could leave the folder. */
export function packagePath(raw: string): string | 'skip' {
    const bad = (why: string) => new Error(`Invalid path "${raw}": ${why}`);
    if (!raw || raw.length > 512) throw bad('empty or too long');
    // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
    if (/[\u0000-\u001f\\]/.test(raw)) throw bad('control character or backslash');
    if (raw.startsWith('/') || /^[a-z]:/i.test(raw)) throw bad('must be relative');
    const parts = raw.replace(/^\.\//, '').split('/');
    if (parts.at(-1) === '') parts.pop(); // a directory entry
    if (parts.some((p) => p === '..')) throw bad('".." is not allowed');
    if (parts.some((p) => SKIP.has(p) || p.startsWith('._'))) return 'skip';
    if (!parts.length || parts.some((p) => p === '' || p === '.')) throw bad('empty segment');
    return parts.join('/');
}

/** Files (path + bytes) as a FileMap: text decoded, clutter skipped. */
export function collect(entries: Iterable<[string, Uint8Array]>): FileMap {
    const out: FileMap = {};
    for (const [raw, bytes] of entries) {
        const path = packagePath(raw);
        if (path === 'skip') continue;
        out[path] = TEXT_FILE.test(path) ? new TextDecoder().decode(bytes) : bytes;
    }
    return out;
}

/** The files relative to the package root — the shallowest manifest.json. */
export function packageRoot(files: FileMap): FileMap {
    const manifest = Object.keys(files)
        .filter((p) => p === 'manifest.json' || p.endsWith('/manifest.json'))
        .sort((a, b) => a.split('/').length - b.split('/').length)[0];
    if (!manifest) throw new Error('No manifest.json — an OVD package has one at its root');
    const prefix = manifest.slice(0, -'manifest.json'.length);
    const out: FileMap = {};
    for (const [path, content] of Object.entries(files))
        if (path.startsWith(prefix)) out[path.slice(prefix.length)] = content;
    return out;
}
