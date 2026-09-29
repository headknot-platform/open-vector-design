/**
 * `ovd diff` (spec §10): a semantic summary of what changed between two versions of a project,
 * matched by stable element id (§4) rather than by line — "Button: fill #fff → {color.primary}".
 */
import {
    type AnyNode,
    type ComponentNode,
    type Dim,
    type Paint,
    type Project,
    type TokenDocument,
    walk,
} from './model';
import { canonicalJson } from './json';
import { flattenTokens } from './tokens';
import { fmtNum } from './xml';

export interface ElementChange {
    id: string;
    name: string;
    kind: 'added' | 'removed' | 'changed';
    details: string[];
}

export interface FileChange {
    file: string;
    kind: 'added' | 'removed' | 'changed';
    /** Pages and component files: element-level changes. */
    elements?: ElementChange[];
    /** Token files: one line per token. */
    tokens?: string[];
}

const n = (v: number) => fmtNum(v);
const paint = (p: Paint | undefined) => (p ? (p.token ?? p.color) : 'none');
const dim = (d: Dim) => d.token ?? n(d.value);
const quote = (s: string) => `"${s.length > 40 ? `${s.slice(0, 37)}…` : s}"`;

function index(nodes: AnyNode[]) {
    const out = new Map<string, { node: AnyNode; parent: string | null }>();
    walk(nodes, (node, parent) => {
        if (node.id && node.type !== 'raw') out.set(node.id, { node, parent: parent?.id ?? null });
    });
    return out;
}

function describe(
    a: AnyNode,
    b: AnyNode,
    parentA: string | null,
    parentB: string | null,
): string[] {
    const d: string[] = [];
    if (a.name !== b.name) d.push(`renamed ${quote(a.name)} → ${quote(b.name)}`);
    if (parentA !== parentB)
        d.push(`moved from ${parentA ?? 'top level'} to ${parentB ?? 'top level'}`);
    else if (a.x !== b.x || a.y !== b.y) d.push(`moved ${n(a.x)},${n(a.y)} → ${n(b.x)},${n(b.y)}`);
    if (a.width !== b.width || a.height !== b.height) {
        d.push(`resized ${n(a.width)}×${n(a.height)} → ${n(b.width)}×${n(b.height)}`);
    }
    if (a.rotation !== b.rotation) d.push(`rotation ${n(a.rotation)}° → ${n(b.rotation)}°`);
    if (a.opacity !== b.opacity) d.push(`opacity ${n(a.opacity * 100)}% → ${n(b.opacity * 100)}%`);
    if (a.hidden !== b.hidden) d.push(b.hidden ? 'hidden' : 'shown');
    if (a.locked !== b.locked) d.push(b.locked ? 'locked' : 'unlocked');
    if (JSON.stringify(a.shadow) !== JSON.stringify(b.shadow))
        d.push(b.shadow ? 'shadow changed' : 'shadow removed');

    const fa = (a as { fill?: Paint }).fill;
    const fb = (b as { fill?: Paint }).fill;
    if (paint(fa) !== paint(fb)) d.push(`fill ${paint(fa)} → ${paint(fb)}`);
    const sa = (a as { stroke?: { paint: Paint; width: number } }).stroke;
    const sb = (b as { stroke?: { paint: Paint; width: number } }).stroke;
    if (paint(sa?.paint) !== paint(sb?.paint))
        d.push(`stroke ${paint(sa?.paint)} → ${paint(sb?.paint)}`);
    else if (sa && sb && sa.width !== sb.width)
        d.push(`stroke width ${n(sa.width)} → ${n(sb.width)}`);
    const ra = (a as { radius?: number }).radius;
    const rb = (b as { radius?: number }).radius;
    if (ra !== undefined && rb !== undefined && ra !== rb) d.push(`radius ${n(ra)} → ${n(rb)}`);

    if (a.type === 'text' && b.type === 'text') {
        if (a.content !== b.content) d.push(`text ${quote(a.content)} → ${quote(b.content)}`);
        if (a.fontSize !== b.fontSize) d.push(`font size ${n(a.fontSize)} → ${n(b.fontSize)}`);
        if (a.fontWeight !== b.fontWeight) d.push(`font weight ${a.fontWeight} → ${b.fontWeight}`);
        if (a.fontFamily !== b.fontFamily) d.push(`font ${a.fontFamily} → ${b.fontFamily}`);
        if (a.textStyle !== b.textStyle)
            d.push(`text style ${a.textStyle ?? 'none'} → ${b.textStyle ?? 'none'}`);
    }
    if (
        (a.type === 'frame' || a.type === 'component') &&
        (b.type === 'frame' || b.type === 'component')
    ) {
        const la = a.layout;
        const lb = b.layout;
        if (la.mode !== lb.mode) d.push(`layout ${la.mode} → ${lb.mode}`);
        else if (lb.mode === 'flex') {
            if (la.direction !== lb.direction)
                d.push(`direction ${la.direction} → ${lb.direction}`);
            if (dim(la.gap) !== dim(lb.gap)) d.push(`gap ${dim(la.gap)} → ${dim(lb.gap)}`);
            const pa = la.padding.map(dim).join(' ');
            const pb = lb.padding.map(dim).join(' ');
            if (pa !== pb) d.push(`padding ${pa} → ${pb}`);
            if (la.align !== lb.align) d.push(`align ${la.align} → ${lb.align}`);
            if (la.justify !== lb.justify) d.push(`justify ${la.justify} → ${lb.justify}`);
        }
        if (a.clip !== b.clip) d.push(b.clip ? 'clips content' : 'no longer clips');
    }
    if (a.type === 'component' && b.type === 'component' && a.variant !== b.variant) {
        d.push(`variant ${a.variant ?? '-'} → ${b.variant ?? '-'}`);
    }
    if (a.type === 'instance' && b.type === 'instance') {
        if (a.href !== b.href) d.push(`component ${a.href} → ${b.href}`);
        if ((a.variant ?? '') !== (b.variant ?? ''))
            d.push(`variant ${a.variant ?? 'default'} → ${b.variant ?? 'default'}`);
        const oa = new Map(a.overrides.map((o) => [o.target, o]));
        const ob = new Map(b.overrides.map((o) => [o.target, o]));
        for (const target of new Set([...oa.keys(), ...ob.keys()])) {
            const x = oa.get(target);
            const y = ob.get(target);
            if (x?.text !== y?.text)
                d.push(
                    `${target} text ${quote(x?.text ?? '(component)')} → ${quote(y?.text ?? '(component)')}`,
                );
            if (paint(x?.fill) !== paint(y?.fill))
                d.push(`${target} fill ${paint(x?.fill)} → ${paint(y?.fill)}`);
            if (x?.hidden !== y?.hidden) d.push(`${target} ${y?.hidden ? 'hidden' : 'shown'}`);
        }
    }
    if (
        a.type === 'shape' &&
        b.type === 'shape' &&
        a.d !== b.d &&
        a.width === b.width &&
        a.height === b.height
    ) {
        d.push('path edited');
    }
    if (a.type === 'image' && b.type === 'image' && a.href !== b.href)
        d.push(`image ${a.href} → ${b.href}`);
    return d;
}

export function diffNodes(before: AnyNode[], after: AnyNode[]): ElementChange[] {
    const a = index(before);
    const b = index(after);
    const out: ElementChange[] = [];
    for (const [id, { node }] of b) {
        if (!a.has(id))
            out.push({
                id,
                name: node.name,
                kind: 'added',
                details: [node.type === 'shape' ? node.kind : node.type],
            });
    }
    for (const [id, { node }] of a) {
        if (!b.has(id))
            out.push({
                id,
                name: node.name,
                kind: 'removed',
                details: [node.type === 'shape' ? node.kind : node.type],
            });
    }
    for (const [id, x] of a) {
        const y = b.get(id);
        if (!y) continue;
        const details = describe(x.node, y.node, x.parent, y.parent);
        if (details.length) out.push({ id, name: y.node.name, kind: 'changed', details });
    }
    return out;
}

function tokenValue(v: unknown): string {
    return typeof v === 'string' ? v : JSON.stringify(v);
}

export function diffTokens(
    before: TokenDocument | undefined,
    after: TokenDocument | undefined,
): string[] {
    const a = flattenTokens(before ?? {}, 'a');
    const b = flattenTokens(after ?? {}, 'b');
    const out: string[] = [];
    for (const [path, t] of b) {
        const old = a.get(path);
        if (!old) out.push(`+ ${path}: ${tokenValue(t.value)}`);
        else if (tokenValue(old.value) !== tokenValue(t.value))
            out.push(`~ ${path}: ${tokenValue(old.value)} → ${tokenValue(t.value)}`);
    }
    for (const path of a.keys()) if (!b.has(path)) out.push(`- ${path}`);
    return out;
}

const variantsOf = (p: Project, file: string): ComponentNode[] =>
    p.components.find((c) => c.file === file)?.sets.flatMap((s) => s.variants) ?? [];

export function diffProjects(before: Project, after: Project): FileChange[] {
    const out: FileChange[] = [];
    const scene = (file: string, a: AnyNode[] | undefined, b: AnyNode[] | undefined) => {
        if (!a) return out.push({ file, kind: 'added', elements: diffNodes([], b!) });
        if (!b) return out.push({ file, kind: 'removed' });
        const elements = diffNodes(a, b);
        if (elements.length) out.push({ file, kind: 'changed', elements });
    };
    const pages = new Set([...before.pages, ...after.pages].map((p) => p.file));
    for (const file of pages) {
        scene(
            file,
            before.pages.find((p) => p.file === file)?.children,
            after.pages.find((p) => p.file === file)?.children,
        );
    }
    const comps = new Set([...before.components, ...after.components].map((c) => c.file));
    for (const file of comps) {
        const had = before.components.some((c) => c.file === file);
        const has = after.components.some((c) => c.file === file);
        scene(
            file,
            had ? variantsOf(before, file) : undefined,
            has ? variantsOf(after, file) : undefined,
        );
    }
    for (const file of new Set([...Object.keys(before.tokens), ...Object.keys(after.tokens)])) {
        const a = before.tokens[file];
        const b = after.tokens[file];
        if (!a) out.push({ file, kind: 'added', tokens: diffTokens(undefined, b) });
        else if (!b) out.push({ file, kind: 'removed' });
        else {
            const tokens = diffTokens(a, b);
            if (tokens.length) out.push({ file, kind: 'changed', tokens });
        }
    }
    for (const file of new Set([...Object.keys(before.assets), ...Object.keys(after.assets)])) {
        const a = before.assets[file];
        const b = after.assets[file];
        if (!a) out.push({ file, kind: 'added' });
        else if (!b) out.push({ file, kind: 'removed' });
        else if (a.length !== b.length || a.some((v, i) => v !== b[i]))
            out.push({ file, kind: 'changed' });
    }
    const ma = canonicalJson({
        ...before.manifest,
        pages: before.pages.map((p) => [p.file, p.name]),
    });
    const mb = canonicalJson({
        ...after.manifest,
        pages: after.pages.map((p) => [p.file, p.name]),
    });
    if (ma !== mb) out.push({ file: 'manifest.json', kind: 'changed' });
    return out;
}

/** Plain-text summary, one line per change — what `ovd diff` prints. */
export function formatDiff(changes: FileChange[]): string {
    const lines: string[] = [];
    for (const c of changes) {
        lines.push(`${c.kind === 'added' ? 'A' : c.kind === 'removed' ? 'D' : 'M'} ${c.file}`);
        for (const e of c.elements ?? []) {
            const sign = e.kind === 'added' ? '+' : e.kind === 'removed' ? '-' : '~';
            lines.push(`    ${sign} ${e.name} (${e.id}): ${e.details.join(', ')}`);
        }
        for (const t of c.tokens ?? []) lines.push(`    ${t}`);
    }
    return lines.join('\n');
}
