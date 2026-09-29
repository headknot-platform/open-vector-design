/**
 * Sketch import (spec §11): a `.sketch` file is a ZIP of JSON with a published schema
 * (document.json, meta.json, pages/*.json, images/*). This maps it onto the OVD model.
 *
 * Fidelity (§11 table): good for artboards, groups, shapes, text, images, symbols and instances with
 * text overrides, shared colours → tokens. Not mapped: gradients (first stop used), blend modes,
 * boolean operations (children kept as separate shapes), text runs with mixed styles (first run),
 * symbol overrides other than text, layer and text styles as tokens.
 */
import {
    type ComponentFile,
    type ComponentNode,
    type ComponentSet,
    type FrameNode,
    type ImageNode,
    type InstanceNode,
    type Manifest,
    type Override,
    type Page,
    type Paint,
    type Project,
    type SceneNode,
    type Shadow,
    type ShapeNode,
    type Stroke,
    type TextNode,
    type TokenDocument,
    createFrame,
    createGroup,
    createImage,
    createInstance,
    createShape,
    createText,
    defaultLayout,
} from './model';
import { type PathCmd, serializePath } from './path';
import { type Measure, approxMeasure, relayoutText } from './text';

type Json = Record<string, unknown>;
type SketchFiles = Record<string, string | Uint8Array>;

const COMPONENT_FILE = 'components/sketch-symbols.svg';
const TOKENS_FILE = 'tokens/sketch.tokens.json';

const obj = (v: unknown): Json =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

function text(v: string | Uint8Array): string {
    return typeof v === 'string' ? v : new TextDecoder().decode(v);
}

function slug(s: string): string {
    return (
        s
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/[\s_/]+/g, '-') || 'page'
    );
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

function hex(c: Json): string {
    const b = (x: unknown) =>
        Math.max(0, Math.min(255, Math.round(num(x) * 255)))
            .toString(16)
            .padStart(2, '0');
    const a = num(c['alpha'], 1);
    return `#${b(c['red'])}${b(c['green'])}${b(c['blue'])}${a < 1 ? b(a) : ''}`;
}

/** "{0.5, 1}" → [0.5, 1] */
function pt(s: unknown): [number, number] {
    const m = /\{\s*(-?[\d.eE+-]+)\s*,\s*(-?[\d.eE+-]+)\s*\}/.exec(str(s));
    return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

interface Style {
    fill?: Paint;
    stroke?: Stroke;
    shadow?: Shadow;
    opacity: number;
}

function styleOf(layer: Json, swatches: Map<string, string>): Style {
    const s = obj(layer['style']);
    const paintOf = (c: Json): Paint => {
        const color = hex(c);
        // A fill that uses a shared swatch keeps the link as a token (DTCG alias).
        const swatch = str(obj(c)['swatchID']);
        const token = swatch ? swatches.get(swatch) : undefined;
        return token ? { color, token } : { color };
    };
    const fill = arr(s['fills']).find((f) => f['isEnabled'] !== false);
    const border = arr(s['borders']).find((b) => b['isEnabled'] !== false);
    const shadow = arr(s['shadows']).find((b) => b['isEnabled'] !== false);
    const out: Style = { opacity: num(obj(s['contextSettings'])['opacity'], 1) };
    if (fill) {
        // Gradients (fillType 1): the first stop approximates the fill.
        const grad = obj(fill['gradient']);
        const stop = arr(grad['stops'])[0];
        out.fill = paintOf(
            num(fill['fillType']) === 1 && stop ? obj(stop['color']) : obj(fill['color']),
        );
    }
    if (border)
        out.stroke = { paint: paintOf(obj(border['color'])), width: num(border['thickness'], 1) };
    if (shadow) {
        out.shadow = {
            x: num(shadow['offsetX']),
            y: num(shadow['offsetY']),
            blur: num(shadow['blurRadius']),
            spread: num(shadow['spread']),
            color: hex(obj(shadow['color'])),
        };
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

interface Ctx {
    files: SketchFiles;
    assets: Record<string, Uint8Array>;
    swatches: Map<string, string>;
    /** Sketch symbolID → component symbol id. */
    symbols: Map<string, string>;
    /** Sketch objectID → OVD id (for override targets). */
    ids: Map<string, string>;
    taken: Set<string>;
    measure: Measure;
    /** File the current scene will be written to (hrefs are relative to it). */
    file: string;
    warnings: string[];
}

function idFor(ctx: Ctx, layer: Json, prefix: string): string {
    const objectId = str(layer['do_objectID']);
    const known = objectId && ctx.ids.get(objectId);
    if (known) return known;
    const base = `${prefix}_${(objectId.replace(/[^0-9a-f]/gi, '').slice(0, 8) || 'x').toLowerCase()}`;
    let id = base;
    for (let i = 2; ctx.taken.has(id); i++) id = `${base}${i}`;
    ctx.taken.add(id);
    if (objectId) ctx.ids.set(objectId, id);
    return id;
}

function common(layer: Json, style: Style) {
    const f = obj(layer['frame']);
    return {
        name: str(layer['name'], 'Layer'),
        x: num(f['x']),
        y: num(f['y']),
        width: num(f['width']),
        height: num(f['height']),
        // Sketch rotates counter-clockwise; OVD (like SVG) clockwise.
        rotation: -num(layer['rotation']),
        opacity: style.opacity,
        hidden: layer['isVisible'] === false,
        locked: layer['isLocked'] === true,
        shadow: style.shadow,
    };
}

function pathFromPoints(layer: Json, w: number, h: number): string {
    const pts = arr(layer['points']);
    if (!pts.length) return `M0 0L${w} 0L${w} ${h}L0 ${h}Z`;
    const P = (p: Json, key: string) => {
        const [x, y] = pt(p[key]);
        return [x * w, y * h] as const;
    };
    const cmds: PathCmd[] = [];
    const [x0, y0] = P(pts[0]!, 'point');
    cmds.push({ c: 'M', x: x0, y: y0 });
    const seg = (a: Json, b: Json) => {
        const [bx, by] = P(b, 'point');
        if (a['hasCurveFrom'] || b['hasCurveTo']) {
            const [x1, y1] = a['hasCurveFrom'] ? P(a, 'curveFrom') : P(a, 'point');
            const [x2, y2] = b['hasCurveTo'] ? P(b, 'curveTo') : [bx, by];
            cmds.push({ c: 'C', x1, y1, x2, y2, x: bx, y: by });
        } else {
            cmds.push({ c: 'L', x: bx, y: by });
        }
    };
    for (let i = 1; i < pts.length; i++) seg(pts[i - 1]!, pts[i]!);
    if (layer['isClosed'] !== false) {
        seg(pts[pts.length - 1]!, pts[0]!);
        cmds.push({ c: 'Z' });
    }
    return serializePath(cmds);
}

function convertText(layer: Json, style: Style, ctx: Ctx): TextNode {
    const attributed = obj(layer['attributedString']);
    const content = str(attributed['string']);
    const firstRun = obj(arr(attributed['attributes'])[0]);
    const attrs = obj(firstRun['attributes']);
    const textStyle = obj(obj(obj(layer['style'])['textStyle'])['encodedAttributes']);
    const font = obj(
        obj(
            attrs['MSAttributedStringFontAttribute'] ??
                textStyle['MSAttributedStringFontAttribute'],
        )['attributes'],
    );
    const color = obj(
        attrs['MSAttributedStringColorAttribute'] ?? textStyle['MSAttributedStringColorAttribute'],
    );
    const para = obj(attrs['paragraphStyle'] ?? textStyle['paragraphStyle']);
    const fontName = str(font['name'], 'Inter');
    const [family, weightName = 'Regular'] = fontName.split('-');
    const weights: Record<string, number> = {
        Thin: 100,
        Light: 300,
        Regular: 400,
        Medium: 500,
        SemiBold: 600,
        Semibold: 600,
        Bold: 700,
        ExtraBold: 800,
        Black: 900,
    };
    const size = num(font['size'], 16);
    const lineSpacing = num(para['maximumLineHeight']) || num(para['minimumLineHeight']);
    const align = num(para['alignment']);
    const behaviour = num(layer['textBehaviour']);
    const node = createText(idFor(ctx, layer, 't'), {
        ...common(layer, style),
        content,
        fontFamily: `${(family ?? 'Inter').replace(/([a-z])([A-Z])/g, '$1 $2')}, sans-serif`,
        fontSize: size,
        fontWeight: weights[weightName] ?? 400,
        lineHeight: lineSpacing ? lineSpacing / size : 1.2,
        letterSpacing: num(attrs['kerning']),
        align: align === 2 ? 'middle' : align === 1 ? 'end' : 'start',
        box: behaviour === 0 ? 'auto-width' : behaviour === 2 ? 'fixed' : 'fixed-width',
        fill: Object.keys(color).length
            ? { color: hex(color) }
            : (style.fill ?? { color: '#000000' }),
    });
    relayoutText(node, ctx.measure);
    return node;
}

function convertBitmap(layer: Json, style: Style, ctx: Ctx): ImageNode | null {
    const ref = str(obj(layer['image'])['_ref']);
    const key = [ref, `${ref}.png`].find((k) => ctx.files[k] !== undefined);
    if (!key) {
        ctx.warnings.push(`image ${ref || '(none)'} for "${str(layer['name'])}" is missing`);
        return null;
    }
    const ext = /\.(png|jpe?g|webp|gif|pdf)$/i.exec(key)?.[1]?.toLowerCase() ?? 'png';
    const path = `assets/images/${slug(key.replace(/^images\//, '').replace(/\.\w+$/, ''))}.${ext}`;
    const bytes = ctx.files[key]!;
    ctx.assets[path] = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
    const depth = ctx.file.split('/').length - 1;
    return createImage(idFor(ctx, layer, 'img'), `${'../'.repeat(depth)}${path}`, {
        ...common(layer, style),
        fit: 'fill',
    });
}

function convertLayer(layer: Json, ctx: Ctx): SceneNode | null {
    const cls = str(layer['_class']);
    const style = styleOf(layer, ctx.swatches);
    switch (cls) {
        case 'group':
        case 'shapeGroup': {
            const g = createGroup(idFor(ctx, layer, 'g'), {
                ...common(layer, style),
                children: [],
            });
            for (const child of arr(layer['layers'])) {
                const c = convertLayer(child, ctx);
                if (!c) continue;
                // A shape group's style belongs to its shapes (boolean ops are not reproduced).
                if (cls === 'shapeGroup' && c.type === 'shape') {
                    if (style.fill) c.fill = style.fill;
                    if (style.stroke) c.stroke = style.stroke;
                }
                g.children.push(c);
            }
            return g;
        }
        case 'artboard':
            return convertArtboard(layer, ctx);
        case 'rectangle': {
            const radius =
                num(layer['fixedRadius']) || num(arr(layer['points'])[0]?.['cornerRadius']);
            return createShape(idFor(ctx, layer, 'r'), 'rect', {
                ...common(layer, style),
                fill: style.fill,
                stroke: style.stroke,
                radius,
            });
        }
        case 'oval':
            return createShape(idFor(ctx, layer, 'e'), 'ellipse', {
                ...common(layer, style),
                fill: style.fill,
                stroke: style.stroke,
            });
        case 'shapePath':
        case 'star':
        case 'polygon':
        case 'triangle': {
            const c = common(layer, style);
            const d = pathFromPoints(layer, c.width, c.height);
            const node: ShapeNode = createShape(idFor(ctx, layer, 'p'), 'path', {
                ...c,
                fill: layer['isClosed'] === false ? undefined : style.fill,
                stroke: style.stroke,
                d,
            });
            return node;
        }
        case 'text':
            return convertText(layer, style, ctx);
        case 'bitmap':
            return convertBitmap(layer, style, ctx);
        case 'symbolInstance':
            return convertInstance(layer, style, ctx);
        case 'symbolMaster':
            return null; // collected separately into the component file
        default:
            ctx.warnings.push(`skipped unsupported layer "${str(layer['name'])}" (${cls})`);
            return null;
    }
}

function convertArtboard(layer: Json, ctx: Ctx): FrameNode {
    const style = styleOf(layer, ctx.swatches);
    const bg = layer['hasBackgroundColor']
        ? { color: hex(obj(layer['backgroundColor'])) }
        : { color: '#ffffff' };
    const frame = createFrame(idFor(ctx, layer, 'f'), {
        ...common(layer, style),
        fill: bg,
        clip: true,
        children: arr(layer['layers'])
            .map((l) => convertLayer(l, ctx))
            .filter((n): n is SceneNode => !!n),
    });
    return frame;
}

function convertInstance(layer: Json, style: Style, ctx: Ctx): InstanceNode | null {
    const symbolId = str(layer['symbolID']);
    const target = ctx.symbols.get(symbolId);
    if (!target) {
        ctx.warnings.push(
            `instance "${str(layer['name'])}" refers to a symbol that is not in this file`,
        );
        return null;
    }
    const depth = ctx.file.split('/').length - 1;
    const overrides: Override[] = [];
    for (const o of arr(layer['overrideValues'])) {
        // overrideName: "<objectID>_stringValue" (nested: "<a>/<b>_stringValue").
        const m = /^(?:.*\/)?([^/]+)_stringValue$/.exec(str(o['overrideName']));
        const layerId = m && ctx.ids.get(m[1]!);
        if (layerId) overrides.push({ target: layerId, text: str(o['value']), extra: {} });
    }
    return createInstance(
        idFor(ctx, layer, 'i'),
        `${'../'.repeat(depth)}${COMPONENT_FILE}#${target}`,
        {
            ...common(layer, style),
            overrides,
        },
    );
}

// ---------------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------------

export interface SketchImport {
    project: Project;
    warnings: string[];
}

/** Maps the entries of an unzipped `.sketch` file to an OVD project. */
export function importSketch(
    files: SketchFiles,
    opts: { name?: string; measure?: Measure } = {},
): SketchImport {
    const doc = JSON.parse(text(files['document.json'] ?? '{}')) as Json;
    const pageRefs = arr(doc['pages']).map((p) => str(p['_ref']));
    const pagePaths = pageRefs.length
        ? pageRefs.map((r) => (r.endsWith('.json') ? r : `${r}.json`))
        : Object.keys(files).filter((p) => /^pages\/.+\.json$/.test(p));
    const pages = pagePaths
        .filter((p) => files[p] !== undefined)
        .map((p) => JSON.parse(text(files[p]!)) as Json);

    const ctx: Ctx = {
        files,
        assets: {},
        swatches: new Map(),
        symbols: new Map(),
        ids: new Map(),
        taken: new Set(),
        measure: opts.measure ?? approxMeasure,
        file: COMPONENT_FILE,
        warnings: [],
    };

    // Shared swatches → DTCG colour tokens; fills using them keep the alias.
    const tokens: TokenDocument = {};
    const colours: Json = { $type: 'color' };
    for (const sw of arr(obj(obj(doc['sharedSwatches']))['objects'])) {
        const name = slug(str(sw['name'], 'swatch')).replace(/-/g, '_');
        colours[name] = { $value: hex(obj(sw['value'])) };
        ctx.swatches.set(str(sw['do_objectID']), `{color.${name}}`);
    }
    if (Object.keys(colours).length > 1) tokens['color'] = colours;

    // Symbol masters first, so instances anywhere can resolve them.
    const masters = pages.flatMap((p) =>
        arr(p['layers']).filter((l) => l['_class'] === 'symbolMaster'),
    );
    const sets: ComponentSet[] = [];
    for (const m of masters) {
        const id = idFor(ctx, m, 'c');
        ctx.symbols.set(str(m['symbolID']), id);
    }
    for (const m of masters) {
        const frame = convertArtboard(m, ctx);
        const variant: ComponentNode = {
            ...frame,
            type: 'component',
            id: ctx.symbols.get(str(m['symbolID']))!,
            x: 0,
            y: 0,
            layout: defaultLayout(),
        };
        sets.push({
            id: variant.id,
            name: variant.name,
            isSet: false,
            props: {},
            variants: [variant],
            extra: {},
        });
    }

    const outPages: Page[] = [];
    const usedFiles = new Set<string>();
    for (const p of pages) {
        const layers = arr(p['layers']).filter((l) => l['_class'] !== 'symbolMaster');
        if (!layers.length && masters.length) continue; // the Symbols page, now a component file
        const name = str(p['name'], 'Page');
        let file = `pages/${slug(name)}.svg`;
        for (let i = 2; usedFiles.has(file); i++) file = `pages/${slug(name)}-${i}.svg`;
        usedFiles.add(file);
        ctx.file = file;
        ctx.taken = new Set(); // ids are unique per file (spec §4)
        const children = layers.map((l) => convertLayer(l, ctx)).filter((n): n is SceneNode => !!n);
        outPages.push({ file, name, children, extra: {}, extraChildren: [] });
    }
    if (!outPages.length)
        outPages.push({
            file: 'pages/page.svg',
            name: 'Page',
            children: [],
            extra: {},
            extraChildren: [],
        });

    const components: ComponentFile[] = sets.length
        ? [{ file: COMPONENT_FILE, name: 'Sketch symbols', sets, extra: {}, extraChildren: [] }]
        : [];
    const manifest: Manifest = {
        $schema: 'https://ovd.dev/schema/0.1/manifest.json',
        version: '0.1',
        name: opts.name ?? 'Sketch import',
        id: `urn:uuid:${str(doc['do_objectID']) || 'sketch-import'}`.toLowerCase(),
        exports: 'exports/',
        tokens: Object.keys(tokens).length ? [TOKENS_FILE] : [],
        themes: {},
        pages: outPages.map((p) => ({ file: p.file, name: p.name })),
    };
    return {
        project: {
            manifest,
            pages: outPages,
            components,
            tokens: Object.keys(tokens).length ? { [TOKENS_FILE]: tokens } : {},
            assets: ctx.assets,
            comments: {},
            other: {},
        },
        warnings: ctx.warnings,
    };
}
