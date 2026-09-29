/** Canonical JSON (spec §10): sorted object keys, 2-space indentation, LF, trailing newline.
 *  Arrays keep their order — it is meaningful (manifest pages, theme layering). */
export function canonicalJson(value: unknown): string {
    return JSON.stringify(sortKeys(value), null, 2) + '\n';
}

function sortKeys(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (value && typeof value === 'object' && !(value instanceof Uint8Array)) {
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(value).sort()) {
            out[key] = sortKeys((value as Record<string, unknown>)[key]);
        }
        return out;
    }
    return value;
}
