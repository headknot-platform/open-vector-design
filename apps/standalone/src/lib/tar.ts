/**
 * `.tar.gz` in the browser: ustar with pax / GNU long names on read, gzip by fflate. The same
 * archive the server's `/download` produces opens here, and one saved here imports there.
 */
import { type FileMap, asBytes } from '@workspace/ovd-core';
import { gunzipSync, gzipSync } from 'fflate';

const BLOCK = 512;
const enc = new TextEncoder();
const dec = new TextDecoder();

function field(h: Uint8Array, at: number, len: number): string {
    const raw = h.subarray(at, at + len);
    const end = raw.indexOf(0);
    return dec.decode(end < 0 ? raw : raw.subarray(0, end));
}

const octal = (h: Uint8Array, at: number, len: number) =>
    parseInt(field(h, at, len).trim() || '0', 8);

function checksum(h: Uint8Array): number {
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : h[i]!;
    return sum;
}

/** The regular files of a `.tar.gz`, in archive order. Links and devices are ignored. */
export function untarGz(gz: Uint8Array): [string, Uint8Array][] {
    let tar: Uint8Array;
    try {
        tar = gunzipSync(gz);
    } catch {
        throw new Error('Not a readable .tar.gz');
    }
    const out: [string, Uint8Array][] = [];
    let longName: string | null = null;
    for (let at = 0; at + BLOCK <= tar.length;) {
        const h = tar.subarray(at, at + BLOCK);
        if (h.every((b) => b === 0)) break; // end of archive
        if (octal(h, 148, 8) !== checksum(h)) throw new Error('Not a readable .tar.gz');
        const size = octal(h, 124, 12);
        const type = String.fromCharCode(h[156] || 48);
        const body = tar.subarray(at + BLOCK, at + BLOCK + size);
        at += BLOCK + Math.ceil(size / BLOCK) * BLOCK;

        if (type === 'L') {
            longName = field(body, 0, body.length); // GNU long name for the next entry
            continue;
        }
        if (type === 'x') {
            const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(dec.decode(body)); // pax: "len path=…\n"
            if (m) longName = m[1]!;
            continue;
        }
        const prefix = field(h, 345, 155);
        const name = longName ?? (prefix ? `${prefix}/${field(h, 0, 100)}` : field(h, 0, 100));
        longName = null;
        if (type === '0' || type === '7') out.push([name, body.slice()]);
    }
    return out;
}

function header(path: string, size: number, mtime: number): Uint8Array {
    const h = new Uint8Array(BLOCK);
    let name = path;
    let prefix = '';
    if (enc.encode(path).length > 100) {
        const cut = path.lastIndexOf('/', 155);
        prefix = path.slice(0, cut);
        name = path.slice(cut + 1);
        if (cut < 0 || enc.encode(name).length > 100 || enc.encode(prefix).length > 155)
            throw new Error(`Path too long for an archive: ${path}`);
    }
    const put = (s: string, at: number) => h.set(enc.encode(s), at);
    const num = (n: number, at: number, len: number) =>
        put(n.toString(8).padStart(len - 1, '0'), at);
    put(name, 0);
    num(0o644, 100, 8);
    num(0, 108, 8);
    num(0, 116, 8);
    num(size, 124, 12);
    num(mtime, 136, 12);
    h[156] = 48; // '0': regular file
    put('ustar\x0000', 257);
    put(prefix, 345);
    put(checksum(h).toString(8).padStart(6, '0') + '\0 ', 148);
    return h;
}

/** A `.tar.gz` of `files`, under a top-level `root/` folder like the server's download. */
export function tarGz(files: FileMap, root: string): Uint8Array {
    const mtime = Math.floor(Date.now() / 1000);
    const parts: Uint8Array[] = [];
    for (const path of Object.keys(files).sort()) {
        const bytes = asBytes(files[path]!);
        parts.push(header(`${root}/${path}`, bytes.length, mtime), bytes);
        const pad = (BLOCK - (bytes.length % BLOCK)) % BLOCK;
        if (pad) parts.push(new Uint8Array(pad));
    }
    parts.push(new Uint8Array(BLOCK * 2));
    const tar = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        tar.set(p, at);
        at += p.length;
    }
    return gzipSync(tar, { level: 6 });
}
