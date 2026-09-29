/**
 * SVG → model. Implements spec §11 level 2 ("Read") for pages and component files.
 *
 * Every attribute is either consumed into a typed field or kept in `extra`; every element is either
 * modelled or kept as a `raw` node in place. Nothing a file contains is dropped (principle 6).
 */
import {
    type ComponentFile,
    type ComponentNode,
    type ComponentSet,
    type Dim,
    type FrameNode,
    type GroupNode,
    type ImageNode,
    type InstanceNode,
    type Layout,
    type Override,
    type Page,
    type Paint,
    type PropDef,
    type RawNode,
    type SceneNode,
    type ShapeNode,
    type Stroke,
    type TextNode,
    defaultLayout,
} from './model';
import { mapPath, parsePath, pathBounds, serializePath } from './path';
import { type XmlElement, type XmlNode, childElements, parseXml, textContent } from './xml';

// ---------------------------------------------------------------------------------------------
// Attribute helpers
// ---------------------------------------------------------------------------------------------

type Attrs = Record<string, string>;

/** Removes and returns an attribute, so whatever is left at the end is `extra`. */
function take(attrs: Attrs, key: string): string | undefined {
    const v = attrs[key];
    delete attrs[key];
    return v;
}

function num(v: string | undefined, fallback = 0): number {
    if (v === undefined) return fallback;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
}

function bool(v: string | undefined): boolean {
    return v === 'true';
}

/** `var(--color-primary, #4f46e5)` → `#4f46e5`; plain values pass through. */
export function cssFallback(value: string): string {
    const m = /^var\(\s*--[\w-]+\s*,\s*(.+)\)$/.exec(value.trim());
    return m ? m[1]!.trim() : value.trim();
}

function paintFrom(value: string | undefined, token: string | undefined): Paint | undefined {
    if (value === undefined && token === undefined) return undefined;
    if (value === 'none') return undefined;
    const color = value === undefined ? '#000000' : cssFallback(value);
    return token ? { color, token } : { color };
}

function dimFrom(v: string | undefined): Dim {
    if (!v) return { value: 0 };
    const t = v.trim();
    if (t.startsWith('{')) return { value: 0, token: t };
    return { value: num(t) };
}

function paddingFrom(v: string | undefined): [Dim, Dim, Dim, Dim] {
    const parts = (v ?? '0').trim().match(/\{[^}]*\}|[^\s]+/g) ?? ['0'];
    const d = parts.map(dimFrom);
    const [t, r = t, b = t, l = r] = d as [Dim, Dim?, Dim?, Dim?];
    return [t!, r!, b!, l!];
}

interface Transform {
    x: number;
    y: number;
    rotation: number;
    /** Set when the transform had parts we don't model (scale, matrix, skew). */
    raw?: string;
}

function parseTransform(v: string | undefined): Transform {
    const out: Transform = { x: 0, y: 0, rotation: 0 };
    if (!v) return out;
    const re = /(\w+)\s*\(([^)]*)\)/g;
    let m: RegExpExecArray | null;
    let unknown = false;
    while ((m = re.exec(v))) {
        const args = m[2]!
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(Number);
        if (m[1] === 'translate') {
            out.x += args[0] ?? 0;
            out.y += args[1] ?? 0;
        } else if (m[1] === 'rotate') {
            out.rotation = args[0] ?? 0;
        } else {
            unknown = true;
        }
    }
    if (unknown) return { x: 0, y: 0, rotation: 0, raw: v };
    return out;
}

function rotationFrom(v: string | undefined): { rotation: number; raw?: string } {
    if (!v) return { rotation: 0 };
    const t = parseTransform(v);
    if (t.raw || t.x !== 0 || t.y !== 0) return { rotation: 0, raw: v };
    return { rotation: t.rotation };
}

function strokeFrom(attrs: Attrs): Stroke | undefined {
    const value = take(attrs, 'stroke');
    const token = take(attrs, 'ovd:stroke');
    const width = num(take(attrs, 'stroke-width'), 1);
    const paint = paintFrom(value, token);
    return paint ? { paint, width } : undefined;
}

function shadowFrom(attrs: Attrs): FrameNode['shadow'] {
    const v = take(attrs, 'ovd:shadow');
    // The CSS fallback is regenerated from ovd:shadow on write.
    if (v !== undefined) delete attrs['filter'];
    if (!v) return undefined;
    const parts = v.trim().split(/\s+/);
    return {
        x: num(parts[0]),
        y: num(parts[1]),
        blur: num(parts[2]),
        spread: num(parts[3]),
        color: parts.slice(4).join(' ') || '#00000040',
    };
}

/** Fields every node shares. Consumes them from `attrs`. */
function common(node: XmlElement, attrs: Attrs, fallbackName: string) {
    const id = take(attrs, 'id') ?? '';
    const name = take(attrs, 'ovd:name') ?? fallbackName;
    take(attrs, 'ovd:type');
    const hidden = bool(take(attrs, 'ovd:hidden'));
    if (hidden && attrs['visibility'] === 'hidden') delete attrs['visibility'];
    const sizingRaw = take(attrs, 'ovd:sizing');
    const constraintsRaw = take(attrs, 'ovd:constraints');
    const position = take(attrs, 'ovd:position') as 'auto' | 'absolute' | undefined;
    const opacity = num(take(attrs, 'opacity'), 1);

    let sizing: SceneNode['sizing'];
    if (sizingRaw) {
        const [h, v = h] = sizingRaw.trim().split(/\s+/) as [
            NonNullable<SceneNode['sizing']>['h'],
            NonNullable<SceneNode['sizing']>['v']?,
        ];
        sizing = { h, v: v! };
    }
    let constraints: SceneNode['constraints'];
    if (constraintsRaw) {
        const parts = constraintsRaw.trim().split(/\s+/);
        const h = (parts.find((p) => ['left', 'right', 'left-right'].includes(p)) ??
            (parts[0] === 'center' || parts[0] === 'scale' ? parts[0] : 'left')) as NonNullable<
            SceneNode['constraints']
        >['h'];
        const v = (parts.find((p) => ['top', 'bottom', 'top-bottom'].includes(p)) ??
            (parts[1] === 'center' || parts[1] === 'scale' ? parts[1] : 'top')) as NonNullable<
            SceneNode['constraints']
        >['v'];
        constraints = { h, v };
    }

    let title: string | undefined;
    let desc: string | undefined;
    for (const c of childElements(node)) {
        if (c.name === 'title') title = textContent(c);
        if (c.name === 'desc') desc = textContent(c);
    }

    return {
        id,
        name,
        hidden,
        locked: bool(take(attrs, 'ovd:locked')),
        opacity,
        sizing,
        constraints,
        position,
        prop: take(attrs, 'ovd:prop'),
        shadow: shadowFrom(attrs),
        title,
        desc,
    };
}

function layoutFrom(attrs: Attrs): Layout {
    const l = defaultLayout();
    const mode = take(attrs, 'ovd:layout');
    if (mode === 'flex') l.mode = 'flex';
    const dir = take(attrs, 'ovd:direction');
    if (dir === 'row' || dir === 'column') l.direction = dir;
    l.wrap = take(attrs, 'ovd:wrap') === 'wrap';
    l.gap = dimFrom(take(attrs, 'ovd:gap'));
    l.padding = paddingFrom(take(attrs, 'ovd:padding'));
    const align = take(attrs, 'ovd:align');
    if (align) l.align = align as Layout['align'];
    const justify = take(attrs, 'ovd:justify');
    if (justify) l.justify = justify as Layout['justify'];
    return l;
}

// ---------------------------------------------------------------------------------------------
// Elements
// ---------------------------------------------------------------------------------------------

const SKIP_CHILDREN = new Set(['title', 'desc']);

function readChildren(parent: XmlElement, ownerId: string | null): SceneNode[] {
    const out: SceneNode[] = [];
    const kids = parent.children;
    for (let i = 0; i < kids.length; i++) {
        const child = kids[i]!;
        if (child.kind !== 'element') continue;
        if (SKIP_CHILDREN.has(child.name)) continue;
        // Generated plumbing the writer recreates.
        if (ownerId && child.name === 'clipPath' && child.attrs['id'] === `${ownerId}__clip`)
            continue;
        const node = readNode(child);
        if (node) out.push(node);
    }
    return out;
}

export function readNode(xml: XmlElement): SceneNode | null {
    const attrs: Attrs = { ...xml.attrs };
    const type = attrs['ovd:type'];

    if (xml.name === 'a') return readLink(xml);
    if (xml.name === 'g') {
        if (type === 'frame') return readFrame(xml, attrs);
        if (type === 'group' || type === undefined) return readGroup(xml, attrs);
    }
    if (xml.name === 'use') return readInstance(xml, attrs);
    if (xml.name === 'text') return readText(xml, attrs);
    if (xml.name === 'image') return readImage(xml, attrs);
    if (['rect', 'ellipse', 'circle', 'line', 'path', 'polygon', 'polyline'].includes(xml.name)) {
        return readShape(xml, attrs);
    }
    return readRaw(xml);
}

function readRaw(xml: XmlElement): RawNode {
    return {
        id: xml.attrs['id'] ?? '',
        type: 'raw',
        name: xml.attrs['ovd:name'] ?? `<${xml.name}>`,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: true,
        extra: {},
        extraChildren: [],
        xml,
    };
}

function readLink(xml: XmlElement): SceneNode | null {
    const attrs = { ...xml.attrs };
    const inner = childElements(xml);
    if (inner.length !== 1) return readRaw(xml);
    const node = readNode(inner[0]!);
    if (!node) return null;
    node.link = {
        href: take(attrs, 'href') ?? take(attrs, 'xlink:href') ?? '',
        trigger: take(attrs, 'ovd:trigger'),
        transition: take(attrs, 'ovd:transition'),
        duration: take(attrs, 'ovd:duration'),
    };
    for (const [k, v] of Object.entries(attrs)) node.extra[`a:${k}`] = v;
    return node;
}

function splitFrameChildren(xml: XmlElement, ownerId: string) {
    // The frame's background is the first child <rect> without an id — exactly the shape of the
    // spec §4 example. Everything the editor creates has an id, so the two never collide.
    const first = childElements(xml).find(
        (c) =>
            !SKIP_CHILDREN.has(c.name) &&
            !(c.name === 'clipPath' && c.attrs['id'] === `${ownerId}__clip`),
    );
    const bg =
        first && first.name === 'rect' && first.attrs['id'] === undefined ? first : undefined;
    const rest: XmlElement = {
        ...xml,
        children: xml.children.filter((c) => c !== bg),
    };
    return { bg, children: readChildren(rest, ownerId) };
}

function readFrame(xml: XmlElement, attrs: Attrs): FrameNode {
    const c = common(xml, attrs, 'Frame');
    const t = parseTransform(take(attrs, 'transform'));
    if (t.raw) attrs['transform'] = t.raw;
    const width = num(take(attrs, 'ovd:width'));
    const height = num(take(attrs, 'ovd:height'));
    const clip = bool(take(attrs, 'ovd:clip'));
    if (clip) delete attrs['clip-path'];
    const layout = layoutFrom(attrs);
    const { bg, children } = splitFrameChildren(xml, c.id);

    let fill: Paint | undefined;
    let stroke: Stroke | undefined;
    let radius = 0;
    if (bg) {
        const b = { ...bg.attrs };
        fill = paintFrom(take(b, 'fill') ?? 'none', take(b, 'ovd:fill'));
        stroke = strokeFrom(b);
        radius = num(b['rx']);
    }

    return {
        ...c,
        type: 'frame',
        x: t.x,
        y: t.y,
        width,
        height,
        rotation: t.rotation,
        fill,
        stroke,
        radius,
        clip,
        layout,
        children,
        extra: attrs,
        extraChildren: [],
    };
}

function readGroup(xml: XmlElement, attrs: Attrs): GroupNode {
    const c = common(xml, attrs, 'Group');
    const t = parseTransform(take(attrs, 'transform'));
    if (t.raw) attrs['transform'] = t.raw;
    return {
        ...c,
        type: 'group',
        x: t.x,
        y: t.y,
        width: num(take(attrs, 'ovd:width')),
        height: num(take(attrs, 'ovd:height')),
        rotation: t.rotation,
        children: readChildren(xml, c.id),
        extra: attrs,
        extraChildren: [],
    };
}

function readShape(xml: XmlElement, attrs: Attrs): ShapeNode {
    const c = common(xml, attrs, xml.name[0]!.toUpperCase() + xml.name.slice(1));
    const fill = paintFrom(take(attrs, 'fill'), take(attrs, 'ovd:fill'));
    const stroke = strokeFrom(attrs);
    const base = { ...c, type: 'shape' as const, fill, stroke, radius: 0 };

    if (xml.name === 'rect') {
        const r = rotationFrom(take(attrs, 'transform'));
        if (r.raw) attrs['transform'] = r.raw;
        const rx = num(take(attrs, 'rx'));
        take(attrs, 'ry');
        return {
            ...base,
            kind: 'rect',
            x: num(take(attrs, 'x')),
            y: num(take(attrs, 'y')),
            width: num(take(attrs, 'width')),
            height: num(take(attrs, 'height')),
            rotation: r.rotation,
            radius: rx,
            extra: attrs,
            extraChildren: [],
        };
    }
    if (xml.name === 'ellipse' || xml.name === 'circle') {
        const r = rotationFrom(take(attrs, 'transform'));
        if (r.raw) attrs['transform'] = r.raw;
        const cx = num(take(attrs, 'cx'));
        const cy = num(take(attrs, 'cy'));
        const radius = take(attrs, 'r');
        const rx = radius !== undefined ? num(radius) : num(take(attrs, 'rx'));
        const ry = radius !== undefined ? num(radius) : num(take(attrs, 'ry'));
        return {
            ...base,
            kind: 'ellipse',
            x: cx - rx,
            y: cy - ry,
            width: rx * 2,
            height: ry * 2,
            rotation: r.rotation,
            extra: attrs,
            extraChildren: [],
        };
    }
    if (xml.name === 'line') {
        const r = rotationFrom(take(attrs, 'transform'));
        if (r.raw) attrs['transform'] = r.raw;
        const x1 = num(take(attrs, 'x1'));
        const y1 = num(take(attrs, 'y1'));
        const x2 = num(take(attrs, 'x2'));
        const y2 = num(take(attrs, 'y2'));
        return {
            ...base,
            fill: undefined,
            kind: 'line',
            x: x1,
            y: y1,
            width: x2 - x1,
            height: y2 - y1,
            rotation: r.rotation,
            extra: attrs,
            extraChildren: [],
        };
    }

    // path, polygon, polyline → path in the node's local box.
    let d: string;
    if (xml.name === 'path') {
        d = take(attrs, 'd') ?? '';
    } else {
        const pts = (take(attrs, 'points') ?? '')
            .trim()
            .split(/[\s,]+/)
            .map(Number);
        const parts: string[] = [];
        for (let i = 0; i + 1 < pts.length; i += 2) {
            parts.push(`${i === 0 ? 'M' : 'L'}${pts[i]} ${pts[i + 1]}`);
        }
        d = parts.join('') + (xml.name === 'polygon' ? 'Z' : '');
    }
    const t = parseTransform(take(attrs, 'transform'));
    if (t.raw) attrs['transform'] = t.raw;
    const cmds = parsePath(d);
    const hasBox = attrs['ovd:width'] !== undefined;
    let width = num(take(attrs, 'ovd:width'));
    let height = num(take(attrs, 'ovd:height'));
    let x = t.x;
    let y = t.y;
    if (!hasBox) {
        // A foreign path: normalise it so its bounding box starts at the local origin.
        const b = pathBounds(cmds);
        x += b.x;
        y += b.y;
        width = b.width;
        height = b.height;
        d = serializePath(mapPath(cmds, (px, py) => [px - b.x, py - b.y]));
    }
    return {
        ...base,
        kind: 'path',
        x,
        y,
        width,
        height,
        rotation: t.rotation,
        d,
        extra: attrs,
        extraChildren: [],
    };
}

function readText(xml: XmlElement, attrs: Attrs): TextNode {
    const c = common(xml, attrs, 'Text');
    const t = parseTransform(take(attrs, 'transform'));
    if (t.raw) attrs['transform'] = t.raw;

    const tspans = childElements(xml, 'tspan');
    const lines = tspans.length
        ? tspans.map((s) => textContent(s))
        : [textContent({ ...xml, children: xml.children.filter((k) => k.kind === 'text') })];
    const contentAttr = take(attrs, 'ovd:content');
    const content = contentAttr ?? lines.join(tspans.length ? ' ' : '');

    // Without a transform, a foreign <text x y> is positioned by its baseline; approximate the
    // box top from it. Our writer always uses a transform and local tspan coordinates.
    const fontSize = num(take(attrs, 'font-size'), 16);
    const lineHeight = num(take(attrs, 'ovd:line-height'), 1.4);
    let x = t.x;
    let y = t.y;
    const rawX = take(attrs, 'x');
    const rawY = take(attrs, 'y');
    if (!t.x && !t.y && (rawX !== undefined || rawY !== undefined)) {
        x = num(rawX);
        y = num(rawY) - fontSize * 0.8 - ((lineHeight - 1) * fontSize) / 2;
    }
    const anchor = take(attrs, 'text-anchor');
    const align = anchor === 'middle' ? 'middle' : anchor === 'end' ? 'end' : 'start';
    const box = (take(attrs, 'ovd:box') as TextNode['box']) ?? 'auto-width';
    const fill = paintFrom(take(attrs, 'fill') ?? '#000000', take(attrs, 'ovd:fill'))!;
    const width = num(take(attrs, 'ovd:width'));
    const height = num(take(attrs, 'ovd:height'), lines.length * fontSize * lineHeight);

    return {
        ...c,
        type: 'text',
        x,
        y,
        width,
        height,
        rotation: t.rotation,
        content,
        lines,
        box,
        fontFamily: take(attrs, 'font-family') ?? 'Inter, sans-serif',
        fontSize,
        fontWeight: num(take(attrs, 'font-weight'), 400),
        lineHeight,
        letterSpacing: num(take(attrs, 'letter-spacing')),
        align,
        fill,
        textStyle: take(attrs, 'ovd:text-style'),
        extra: attrs,
        extraChildren: [],
    };
}

function readImage(xml: XmlElement, attrs: Attrs): ImageNode {
    const c = common(xml, attrs, 'Image');
    const r = rotationFrom(take(attrs, 'transform'));
    if (r.raw) attrs['transform'] = r.raw;
    const par = take(attrs, 'preserveAspectRatio');
    const fit = par === 'none' ? 'fill' : par?.includes('slice') ? 'cover' : 'contain';
    return {
        ...c,
        type: 'image',
        x: num(take(attrs, 'x')),
        y: num(take(attrs, 'y')),
        width: num(take(attrs, 'width')),
        height: num(take(attrs, 'height')),
        rotation: r.rotation,
        href: take(attrs, 'href') ?? take(attrs, 'xlink:href') ?? '',
        fit,
        extra: attrs,
        extraChildren: [],
    };
}

function readOverride(xml: XmlElement): Override {
    const a = { ...xml.attrs };
    const target = take(a, 'target') ?? '';
    const o: Override = { target, extra: {} };
    const text = take(a, 'text');
    if (text !== undefined) o.text = text;
    const fill = take(a, 'fill');
    if (fill !== undefined)
        o.fill = fill.startsWith('{') ? { color: '', token: fill } : { color: fill };
    const stroke = take(a, 'stroke');
    if (stroke !== undefined) {
        o.stroke = stroke.startsWith('{') ? { color: '', token: stroke } : { color: stroke };
    }
    const vis = take(a, 'visibility');
    if (vis !== undefined) o.hidden = vis === 'hidden';
    const swap = take(a, 'href');
    if (swap !== undefined) o.swap = swap;
    o.extra = a;
    return o;
}

function readInstance(xml: XmlElement, attrs: Attrs): InstanceNode {
    const c = common(xml, attrs, 'Instance');
    const r = rotationFrom(take(attrs, 'transform'));
    if (r.raw) attrs['transform'] = r.raw;
    const overrides: Override[] = [];
    const extraChildren: XmlNode[] = [];
    for (const child of xml.children) {
        if (child.kind !== 'element') continue;
        if (child.name === 'ovd:override') overrides.push(readOverride(child));
        else if (!SKIP_CHILDREN.has(child.name)) extraChildren.push(child);
    }
    return {
        ...c,
        type: 'instance',
        x: num(take(attrs, 'x')),
        y: num(take(attrs, 'y')),
        width: num(take(attrs, 'width')),
        height: num(take(attrs, 'height')),
        rotation: r.rotation,
        href: take(attrs, 'href') ?? take(attrs, 'xlink:href') ?? '',
        variant: take(attrs, 'ovd:variant'),
        overrides,
        extra: attrs,
        extraChildren,
    };
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

/** Root attributes that the writer always regenerates. */
const ROOT_GENERATED = ['xmlns', 'xmlns:ovd', 'ovd:version', 'ovd:type', 'ovd:name', 'viewBox'];

export function readPage(file: string, source: string | XmlElement): Page {
    const root = typeof source === 'string' ? parseXml(source) : source;
    if (root.name !== 'svg') throw new Error(`${file}: root element is <${root.name}>, not <svg>`);
    const attrs = { ...root.attrs };
    const name = attrs['ovd:name'] ?? file.replace(/^.*\//, '').replace(/\.svg$/, '');
    for (const k of ROOT_GENERATED) delete attrs[k];

    const extraChildren: XmlNode[] = [];
    const sceneParent: XmlElement = { ...root, children: [] };
    for (const child of root.children) {
        if (child.kind !== 'element') continue;
        // The token <style> is generated from the active theme on every write (spec §8).
        if (child.name === 'style' && child.attrs['ovd:generated'] === 'tokens') continue;
        if (child.name === 'defs' || child.name === 'metadata' || child.name === 'style') {
            extraChildren.push(child);
            continue;
        }
        sceneParent.children.push(child);
    }
    return {
        file,
        name,
        children: readChildren(sceneParent, null),
        extra: attrs,
        extraChildren,
    };
}

function parseProps(v: string | undefined): Record<string, PropDef> {
    if (!v) return {};
    try {
        const parsed = JSON.parse(v) as Record<string, unknown>;
        const out: Record<string, PropDef> = {};
        for (const [k, def] of Object.entries(parsed)) {
            if (Array.isArray(def)) out[k] = def.map(String);
            else if (def === 'text' || def === 'boolean' || def === 'instance') out[k] = def;
        }
        return out;
    } catch {
        return {};
    }
}

function readComponentSymbol(xml: XmlElement): ComponentNode {
    const attrs: Attrs = { ...xml.attrs };
    const c = common(xml, attrs, 'Component');
    const variant = take(attrs, 'ovd:variant');
    take(attrs, 'viewBox');
    const width = num(take(attrs, 'width'));
    const height = num(take(attrs, 'height'));
    const layout = layoutFrom(attrs);
    const { bg, children } = splitFrameChildren(xml, c.id);
    let fill: Paint | undefined;
    let stroke: Stroke | undefined;
    let radius = 0;
    if (bg) {
        const b = { ...bg.attrs };
        fill = paintFrom(take(b, 'fill') ?? 'none', take(b, 'ovd:fill'));
        stroke = strokeFrom(b);
        radius = num(b['rx']);
    }
    const clip = take(attrs, 'ovd:clip') !== 'false';
    return {
        ...c,
        type: 'component',
        variant,
        x: 0,
        y: 0,
        width,
        height,
        rotation: 0,
        fill,
        stroke,
        radius,
        clip,
        layout,
        children,
        extra: attrs,
        extraChildren: [],
    };
}

export function readComponentFile(file: string, source: string | XmlElement): ComponentFile {
    const root = typeof source === 'string' ? parseXml(source) : source;
    if (root.name !== 'svg') throw new Error(`${file}: root element is <${root.name}>, not <svg>`);
    const attrs = { ...root.attrs };
    const name = attrs['ovd:name'] ?? file.replace(/^.*\//, '').replace(/\.svg$/, '');
    for (const k of ROOT_GENERATED) delete attrs[k];

    const sets: ComponentSet[] = [];
    const extraChildren: XmlNode[] = [];
    for (const child of root.children) {
        if (child.kind !== 'element') continue;
        if (child.name === 'style' && child.attrs['ovd:generated'] === 'tokens') continue;
        if (child.name !== 'defs') {
            extraChildren.push(child);
            continue;
        }
        const foreign: XmlNode[] = [];
        for (const sym of child.children) {
            if (sym.kind !== 'element') continue;
            const type = sym.attrs['ovd:type'];
            if (sym.name === 'symbol' && type === 'component-set') {
                const a: Attrs = { ...sym.attrs };
                const id = take(a, 'id') ?? '';
                const setName = take(a, 'ovd:name') ?? id;
                take(a, 'ovd:type');
                const props = parseProps(take(a, 'ovd:props'));
                const defaultVariant = take(a, 'ovd:default');
                const variants = childElements(sym, 'symbol')
                    .filter((s) => s.attrs['ovd:type'] === 'component')
                    .map(readComponentSymbol);
                sets.push({
                    id,
                    name: setName,
                    isSet: true,
                    props,
                    defaultVariant,
                    variants,
                    extra: a,
                });
            } else if (sym.name === 'symbol' && type === 'component') {
                const comp = readComponentSymbol(sym);
                sets.push({
                    id: comp.id,
                    name: comp.name,
                    isSet: false,
                    props: {},
                    variants: [comp],
                    extra: {},
                });
            } else {
                foreign.push(sym);
            }
        }
        if (foreign.length) extraChildren.push({ ...child, children: foreign });
    }
    return { file, name, sets, extra: attrs, extraChildren };
}
