/**
 * W3C Design Tokens (DTCG) support — spec §8. No OVD-specific extensions to the token format.
 *
 *   flatten → layer (base files, then the theme's files, later wins) → resolve aliases → CSS
 */
import type { Manifest, Project, TokenDocument } from './model';
import { cssVarName, tokenPath } from './token-ref';

export type TokenType =
    | 'color'
    | 'dimension'
    | 'fontFamily'
    | 'fontWeight'
    | 'number'
    | 'duration'
    | 'cubicBezier'
    | 'shadow'
    | 'border'
    | 'gradient'
    | 'typography'
    | 'strokeStyle';

export const TOKEN_TYPES: TokenType[] = [
    'color',
    'dimension',
    'fontFamily',
    'fontWeight',
    'number',
    'duration',
    'cubicBezier',
    'shadow',
    'border',
    'gradient',
    'typography',
    'strokeStyle',
];

export interface FlatToken {
    path: string;
    type?: TokenType;
    value: unknown;
    description?: string;
    /** The token file that defined (or last overrode) this token. */
    source: string;
}

export interface ResolvedToken extends FlatToken {
    type: TokenType;
    /** The value with every alias substituted. */
    resolved: unknown;
    css: string;
    /** When the value is a pure alias, the path it points at. */
    aliasOf?: string;
}

export interface TokenError {
    path: string;
    source: string;
    message: string;
}

export interface TokenSet {
    tokens: Map<string, ResolvedToken>;
    errors: TokenError[];
}

// ---------------------------------------------------------------------------------------------
// Flattening and layering
// ---------------------------------------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

export function flattenTokens(
    doc: TokenDocument,
    source: string,
    into: Map<string, FlatToken> = new Map(),
): Map<string, FlatToken> {
    const visit = (node: Record<string, unknown>, prefix: string, inherited?: TokenType) => {
        const type = (node['$type'] as TokenType | undefined) ?? inherited;
        if ('$value' in node) {
            into.set(prefix, {
                path: prefix,
                type,
                value: node['$value'],
                description: node['$description'] as string | undefined,
                source,
            });
            return;
        }
        for (const [key, child] of Object.entries(node)) {
            if (key.startsWith('$') || !isObject(child)) continue;
            visit(child, prefix ? `${prefix}.${key}` : key, type);
        }
    };
    visit(doc, '');
    return into;
}

export function listThemes(manifest: Manifest): string[] {
    return Object.keys(manifest.themes).sort();
}

/** 'light' when the project has one, else the first theme A–Z. Not "the first key": canonical JSON
 *  sorts keys, which would silently change the default after the first `ovd fmt`. */
export function defaultTheme(manifest: Manifest): string | undefined {
    const themes = listThemes(manifest);
    return themes.includes('light') ? 'light' : themes[0];
}

/** Token files in layering order: base files, then the theme's files (spec §8). */
export function themeFiles(manifest: Manifest, theme?: string): string[] {
    return [...manifest.tokens, ...(theme ? (manifest.themes[theme] ?? []) : [])];
}

export function layerTokens(
    docs: Record<string, TokenDocument>,
    files: string[],
): Map<string, FlatToken> {
    const out = new Map<string, FlatToken>();
    for (const file of files) {
        const doc = docs[file];
        if (!doc) continue;
        for (const [path, token] of flattenTokens(doc, file)) {
            const prev = out.get(path);
            // A theme override may omit $type and inherit it from the base definition.
            out.set(path, { ...token, type: token.type ?? prev?.type });
        }
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------------------------

const ALIAS = /^\{([^{}]+)\}$/;

export function resolveTokens(flat: Map<string, FlatToken>): TokenSet {
    const tokens = new Map<string, ResolvedToken>();
    const errors: TokenError[] = [];
    const visiting = new Set<string>();

    const resolveValue = (value: unknown, from: FlatToken): unknown => {
        if (typeof value === 'string') {
            const m = ALIAS.exec(value.trim());
            if (!m) return value;
            const target = resolve(m[1]!, from);
            return target?.resolved;
        }
        if (Array.isArray(value)) return value.map((v) => resolveValue(v, from));
        if (isObject(value)) {
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, from);
            return out;
        }
        return value;
    };

    const resolve = (path: string, from?: FlatToken): ResolvedToken | undefined => {
        const done = tokens.get(path);
        if (done) return done;
        const token = flat.get(path);
        if (!token) {
            if (from) {
                errors.push({
                    path: from.path,
                    source: from.source,
                    message: `refers to {${path}}, which does not exist`,
                });
            }
            return undefined;
        }
        if (visiting.has(path)) {
            errors.push({
                path,
                source: token.source,
                message: `alias cycle through {${path}}`,
            });
            return undefined;
        }
        visiting.add(path);
        const alias =
            typeof token.value === 'string' ? ALIAS.exec(token.value.trim())?.[1] : undefined;
        let type = token.type;
        let resolved: unknown;
        if (alias) {
            const target = resolve(alias, token);
            resolved = target?.resolved;
            type ??= target?.type;
        } else {
            resolved = resolveValue(token.value, token);
        }
        visiting.delete(path);
        const finalType: TokenType = type ?? guessType(resolved);
        const result: ResolvedToken = {
            ...token,
            type: finalType,
            resolved,
            css: resolved === undefined ? '' : tokenToCss(finalType, resolved),
            aliasOf: alias,
        };
        tokens.set(path, result);
        return result;
    };

    for (const path of flat.keys()) resolve(path);
    return { tokens, errors };
}

function guessType(value: unknown): TokenType {
    if (typeof value === 'number') return 'number';
    if (typeof value === 'string' && /^(#|rgb|hsl|oklch|color\()/.test(value)) return 'color';
    if (isObject(value) && 'colorSpace' in value) return 'color';
    if (isObject(value) && 'unit' in value) return 'dimension';
    return 'number';
}

/** Resolves a whole project's tokens for one theme (default theme when omitted). */
export function projectTokens(project: Project, theme = defaultTheme(project.manifest)): TokenSet {
    return resolveTokens(layerTokens(project.tokens, themeFiles(project.manifest, theme)));
}

// ---------------------------------------------------------------------------------------------
// CSS output
// ---------------------------------------------------------------------------------------------

const round = (n: number, dp = 4) => String(Math.round(n * 10 ** dp) / 10 ** dp);

function hexByte(n: number): string {
    return Math.max(0, Math.min(255, Math.round(n * 255)))
        .toString(16)
        .padStart(2, '0');
}

export function colorToCss(value: unknown): string {
    if (typeof value === 'string') return value;
    if (!isObject(value)) return '';
    const space = String(value['colorSpace'] ?? 'srgb');
    const comps = (Array.isArray(value['components']) ? value['components'] : []) as (
        number | 'none'
    )[];
    const alpha = typeof value['alpha'] === 'number' ? value['alpha'] : 1;
    const hex = typeof value['hex'] === 'string' ? value['hex'] : undefined;
    if (space === 'srgb' && hex) return alpha < 1 ? `${hex}${hexByte(alpha)}` : hex;
    const c = comps.map((v) => (v === 'none' ? 'none' : round(v)));
    const a = alpha < 1 ? ` / ${round(alpha)}` : '';
    switch (space) {
        case 'srgb':
            if (comps.every((v) => typeof v === 'number')) {
                const h = '#' + (comps as number[]).map(hexByte).join('');
                return alpha < 1 ? `${h}${hexByte(alpha)}` : h;
            }
            return `color(srgb ${c.join(' ')}${a})`;
        case 'oklch':
            return `oklch(${c.join(' ')}${a})`;
        case 'oklab':
            return `oklab(${c.join(' ')}${a})`;
        case 'hsl':
            return `hsl(${c[0]} ${c[1]}% ${c[2]}%${a})`;
        case 'hwb':
            return `hwb(${c[0]} ${c[1]}% ${c[2]}%${a})`;
        case 'lab':
        case 'lch':
            return `${space}(${c.join(' ')}${a})`;
        default:
            // display-p3, srgb-linear, a98-rgb, prophoto-rgb, rec2020, xyz-d50, xyz-d65
            return `color(${space} ${c.join(' ')}${a})`;
    }
}

export function dimensionToCss(value: unknown): string {
    if (typeof value === 'number') return `${round(value)}px`;
    if (typeof value === 'string') return value;
    if (isObject(value) && typeof value['value'] === 'number') {
        return `${round(value['value'])}${String(value['unit'] ?? 'px')}`;
    }
    return '';
}

/** A dimension in px (rem/em taken at 16px) — what SVG geometry needs. */
export function dimensionToPx(value: unknown): number | undefined {
    if (typeof value === 'number') return value;
    let n: number | undefined;
    let unit = 'px';
    if (typeof value === 'string') {
        const m = /^(-?[\d.]+)([a-z%]*)$/.exec(value.trim());
        if (m) {
            n = parseFloat(m[1]!);
            unit = m[2] || 'px';
        }
    } else if (isObject(value) && typeof value['value'] === 'number') {
        n = value['value'];
        unit = String(value['unit'] ?? 'px');
    }
    if (n === undefined) return undefined;
    return unit === 'rem' || unit === 'em' ? n * 16 : n;
}

function fontFamilyToCss(value: unknown): string {
    const list = Array.isArray(value) ? value : [value];
    return list
        .map((f) => String(f))
        .map((f) => (/\s/.test(f) && !/^["']/.test(f) ? `"${f}"` : f))
        .join(', ');
}

const WEIGHTS: Record<string, number> = {
    thin: 100,
    hairline: 100,
    'extra-light': 200,
    'ultra-light': 200,
    light: 300,
    normal: 400,
    regular: 400,
    book: 400,
    medium: 500,
    'semi-bold': 600,
    'demi-bold': 600,
    bold: 700,
    'extra-bold': 800,
    'ultra-bold': 800,
    black: 900,
    heavy: 900,
};

export function fontWeightToNumber(value: unknown): number {
    if (typeof value === 'number') return value;
    return WEIGHTS[String(value).toLowerCase()] ?? 400;
}

function durationToCss(value: unknown): string {
    if (isObject(value)) return `${round(Number(value['value']))}${String(value['unit'] ?? 'ms')}`;
    return String(value);
}

function shadowOne(v: unknown): string {
    if (!isObject(v)) return String(v);
    const parts = [
        v['inset'] ? 'inset' : '',
        dimensionToCss(v['offsetX']),
        dimensionToCss(v['offsetY']),
        dimensionToCss(v['blur']),
        dimensionToCss(v['spread']),
        colorToCss(v['color']),
    ];
    return parts.filter(Boolean).join(' ');
}

export function tokenToCss(type: TokenType, value: unknown): string {
    switch (type) {
        case 'color':
            return colorToCss(value);
        case 'dimension':
            return dimensionToCss(value);
        case 'fontFamily':
            return fontFamilyToCss(value);
        case 'fontWeight':
            return String(fontWeightToNumber(value));
        case 'number':
            return String(value);
        case 'duration':
            return durationToCss(value);
        case 'cubicBezier':
            return Array.isArray(value) ? `cubic-bezier(${value.map(Number).join(', ')})` : '';
        case 'shadow':
            return Array.isArray(value) ? value.map(shadowOne).join(', ') : shadowOne(value);
        case 'border':
            if (!isObject(value)) return String(value);
            return [
                dimensionToCss(value['width']),
                typeof value['style'] === 'string' ? value['style'] : 'solid',
                colorToCss(value['color']),
            ].join(' ');
        case 'strokeStyle':
            return typeof value === 'string' ? value : 'dashed';
        case 'gradient':
            if (!Array.isArray(value)) return '';
            return `linear-gradient(90deg, ${value
                .map((s) =>
                    isObject(s)
                        ? `${colorToCss(s['color'])} ${round(Number(s['position']) * 100)}%`
                        : '',
                )
                .join(', ')})`;
        case 'typography': {
            const t = typographyOf(value);
            if (!t) return '';
            return `${t.fontWeight} ${round(t.fontSize)}px/${round(t.lineHeight)} ${t.fontFamily}`;
        }
    }
}

export interface Typography {
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    lineHeight: number;
    letterSpacing: number;
}

export function typographyOf(value: unknown): Typography | undefined {
    if (!isObject(value)) return undefined;
    const fontSize = dimensionToPx(value['fontSize']) ?? 16;
    const lh = value['lineHeight'];
    const lineHeight =
        typeof lh === 'number' ? lh : (dimensionToPx(lh) ?? fontSize * 1.4) / fontSize;
    return {
        fontFamily: fontFamilyToCss(value['fontFamily'] ?? 'sans-serif'),
        fontSize,
        fontWeight: fontWeightToNumber(value['fontWeight'] ?? 400),
        lineHeight,
        letterSpacing: dimensionToPx(value['letterSpacing']) ?? 0,
    };
}

/** `:root { --a: …; }` for the given paths (all when omitted), one declaration per line. */
export function tokensToCss(set: TokenSet, paths?: Iterable<string>): string {
    const wanted = paths ? [...new Set(paths)].sort() : [...set.tokens.keys()].sort();
    const lines: string[] = [];
    for (const path of wanted) {
        const t = set.tokens.get(path);
        if (t && t.css) lines.push(`  ${cssVarName(path)}: ${t.css};`);
    }
    return lines.length ? `\n:root {\n${lines.join('\n')}\n}\n` : '';
}

// ---------------------------------------------------------------------------------------------
// Lookups used by the editor and the writer
// ---------------------------------------------------------------------------------------------

export function lookup(set: TokenSet, ref: string | undefined): ResolvedToken | undefined {
    return ref ? set.tokens.get(tokenPath(ref)) : undefined;
}

export function tokenColor(set: TokenSet, ref: string | undefined): string | undefined {
    const t = lookup(set, ref);
    return t && t.type === 'color' && t.css ? t.css : undefined;
}

export function tokenNumber(set: TokenSet, ref: string | undefined): number | undefined {
    const t = lookup(set, ref);
    if (!t) return undefined;
    if (t.type === 'number' || t.type === 'fontWeight') return Number(t.resolved);
    return dimensionToPx(t.resolved);
}

export function tokenTypography(set: TokenSet, ref: string | undefined): Typography | undefined {
    const t = lookup(set, ref);
    return t && t.type === 'typography' ? typographyOf(t.resolved) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Editing a token document (token manager, #10). Mutates `doc`.
// ---------------------------------------------------------------------------------------------

export interface TokenInput {
    $value: unknown;
    $type?: TokenType;
    $description?: string;
}

export function setToken(doc: TokenDocument, path: string, token: TokenInput): void {
    const keys = path.split('.');
    let node: Record<string, unknown> = doc;
    for (const key of keys.slice(0, -1)) {
        const next = node[key];
        if (!isObject(next) || '$value' in next) node[key] = {};
        node = node[key] as Record<string, unknown>;
    }
    const last = keys[keys.length - 1]!;
    const prev = isObject(node[last]) ? (node[last] as Record<string, unknown>) : {};
    const out: Record<string, unknown> = { ...prev, $value: token.$value };
    if (token.$type) out['$type'] = token.$type;
    if (token.$description !== undefined) out['$description'] = token.$description;
    node[last] = out;
}

export function deleteToken(doc: TokenDocument, path: string): boolean {
    const keys = path.split('.');
    const trail: Record<string, unknown>[] = [doc];
    let node: Record<string, unknown> = doc;
    for (const key of keys.slice(0, -1)) {
        const next = node[key];
        if (!isObject(next)) return false;
        node = next;
        trail.push(node);
    }
    const last = keys[keys.length - 1]!;
    if (!(last in node)) return false;
    delete node[last];
    // Remove groups left empty (ignoring $-metadata such as an inherited $type).
    for (let i = trail.length - 1; i > 0; i--) {
        const group = trail[i]!;
        if (Object.keys(group).some((k) => !k.startsWith('$'))) break;
        delete trail[i - 1]![keys[i - 1]!];
    }
    return true;
}
