/** DTCG alias helpers shared by the reader, writer and token engine. */

/** `{color.primary}` → `color.primary`; a bare path passes through. */
export function tokenPath(ref: string): string {
    const t = ref.trim();
    return t.startsWith('{') && t.endsWith('}') ? t.slice(1, -1) : t;
}

export function isTokenRef(value: string | undefined): value is string {
    return !!value && /^\{[^{}]+\}$/.test(value.trim());
}

/** `color.primary` (or `{color.primary}`) → `--color-primary` (spec §8). */
export function cssVarName(pathOrRef: string): string {
    return '--' + tokenPath(pathOrRef).replace(/[^\w-]+/g, '-');
}
