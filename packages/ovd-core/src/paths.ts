/** POSIX-style path helpers for project-relative paths (no Node `path`, so this runs anywhere). */

export function dirname(p: string): string {
    const i = p.lastIndexOf('/');
    return i < 0 ? '' : p.slice(0, i);
}

export function basename(p: string): string {
    return p.slice(p.lastIndexOf('/') + 1);
}

/** Joins and normalises `.` / `..` segments. Leading `..` beyond the root are dropped. */
export function joinPath(...parts: string[]): string {
    const out: string[] = [];
    for (const seg of parts.join('/').split('/')) {
        if (seg === '' || seg === '.') continue;
        if (seg === '..') out.pop();
        else out.push(seg);
    }
    return out.join('/');
}

/** Resolves `rel` against the directory of `fromFile`. */
export function resolveRelative(fromFile: string, rel: string): string {
    return joinPath(dirname(fromFile), rel);
}

/** The relative path from the directory of `fromFile` to `toFile`. */
export function relativePath(fromFile: string, toFile: string): string {
    const from = dirname(fromFile).split('/').filter(Boolean);
    const to = toFile.split('/').filter(Boolean);
    let i = 0;
    while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
    return [...from.slice(i).map(() => '..'), ...to.slice(i)].join('/') || basename(toFile);
}
