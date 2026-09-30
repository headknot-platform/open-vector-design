/**
 * Figma import (spec §11) from the REST API's JSON — `GET /v1/files/:key?geometry=paths`, optionally
 * `GET /v1/files/:key/variables/local`, and the bytes of image fills. Like the Sketch importer this
 * is pure: the server fetches, this maps.
 *
 * Fidelity: frames with auto layout (direction, gap, padding, alignment, wrap, hug / fill / fixed,
 * absolute children), constraints, rectangles, ellipses, lines, vectors and boolean operations (as
 * their computed path), text, image fills, a drop shadow, components and component sets (variant
 * axes, text / boolean / instance-swap props), instances (variant, text overrides), and variables →
 * DTCG tokens, with multi-mode collections as themes and bound fills / spacing kept as token refs.
 * Not mapped: gradients (first stop), blend modes, masks, mixed text styles (first style), effects
 * beyond one drop shadow; instances of library components are kept as detached frames.
 */
import {
    type ComponentFile,
    type ComponentNode,
    type ComponentSet,
    type Dim,
    type FrameNode,
    type HConstraint,
    type InstanceNode,
    type Layout,
    type Manifest,
    type Override,
    type Page,
    type Paint,
    type Project,
    type PropDef,
    type SceneNode,
    type Shadow,
    type Sizing,
    type Stroke,
    type TextNode,
    type TokenDocument,
    type VConstraint,
    createFrame,
    createGroup,
    createImage,
    createInstance,
    createShape,
    createText,
    defaultLayout,
    formatVariant,
} from './model';
import { type Measure, approxMeasure, relayoutText } from './text';
import { setToken } from './tokens';

type Json = Record<string, unknown>;

export interface FigmaInput {
    /** `GET /v1/files/:key?geometry=paths` */
    file: Json;
    /** `GET /v1/files/:key/variables/local`, when the plan allows it. */
    variables?: Json | null;
    /** Image fills by `imageRef`. */
    images?: Record<string, { bytes: Uint8Array; ext: string }>;
}

export interface FigmaImport {
    project: Project;
    warnings: string[];
}

const COMPONENT_FILE = 'components/figma.svg';
const TOKENS_FILE = 'tokens/figma.tokens.json';

const obj = (v: unknown): Json =>
    v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const round = (v: number) => Math.round(v * 100) / 100;

function slug(s: string, fallback = 'page'): string {
    return (
        s
            .toLowerCase()
            .normalize('NFKD')
            .replace(/[^\w\s-]/g, '')
            .trim()
            .replace(/[\s_/]+/g, '-') || fallback
    );
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

function hexOf(c: Json, opacity = 1): string {
    const b = (x: number) =>
        Math.max(0, Math.min(255, Math.round(x * 255)))
            .toString(16)
            .padStart(2, '0');
    const a = num(c['a'], 1) * opacity;
    return `#${b(num(c['r']))}${b(num(c['g']))}${b(num(c['b']))}${a < 1 ? b(a) : ''}`;
}

/** A DTCG colour value (as the starter writes them). */
function colorValue(c: Json): Json {
    const r3 = (v: number) => Math.round(v * 1000) / 1000;
    const a = num(c['a'], 1);
    return {
        colorSpace: 'srgb',
        components: [r3(num(c['r'])), r3(num(c['g'])), r3(num(c['b']))],
        ...(a < 1 ? { alpha: r3(a) } : {}),
        hex: hexOf({ ...c, a: 1 }),
    };
}

interface Ctx {
    warnings: string[];
    warned: Set<string>;
    /** Ids used in the file being written (spec §4: unique per file). */
    taken: Set<string>;
    file: string;
    measure: Measure;
    assets: Record<string, Uint8Array>;
    images: NonNullable<FigmaInput['images']>;
    /** Figma variable id → `{token.path}`. */
    vars: Map<string, string>;
    /** Figma component id → where instances point. */
    components: Map<string, ComponentRef>;
    /** Figma node id (inside components) → OVD id, and that text's original content. */
    compIds: Map<string, string>;
    compTexts: Map<string, string>;
    /** Collecting a component: TEXT prop key → the layer bound to it. */
    propLayers?: Map<string, string>;
}

interface ComponentRef {
    setId: string;
    variant?: string;
    /** TEXT prop key (e.g. `Label#12:0`) → layer id in the component. */
    propLayers: Map<string, string>;
}

function warnOnce(ctx: Ctx, key: string, message: string): void {
    if (ctx.warned.has(key)) return;
    ctx.warned.add(key);
    ctx.warnings.push(message);
}

function uniqueId(ctx: Ctx, base: string): string {
    let id = base;
    for (let i = 2; ctx.taken.has(id); i++) id = `${base}_${i}`;
    ctx.taken.add(id);
    return id;
}

function idFor(ctx: Ctx, node: Json, prefix: string): string {
    const raw =
        str(node['id'])
            .replace(/[^0-9a-z]+/gi, '_')
            .replace(/^_|_$/g, '') || 'x';
    return uniqueId(ctx, `${prefix}_${raw}`);
}

const visible = (p: Json) => p['visible'] !== false;

/** Figma lists fills bottom to top: the last visible one is what shows. */
function topPaint(paints: unknown): Json | undefined {
    return arr(paints).filter(visible).at(-1);
}

function paintOf(p: Json | undefined, ctx: Ctx): Paint | undefined {
    if (!p) return undefined;
    const type = str(p['type']);
    const opacity = num(p['opacity'], 1);
    if (type === 'SOLID') {
        const paint: Paint = { color: hexOf(obj(p['color']), opacity) };
        const bound = str(obj(obj(p['boundVariables'])['color'])['id']);
        const token = bound ? ctx.vars.get(bound) : undefined;
        return token ? { ...paint, token } : paint;
    }
    if (type.startsWith('GRADIENT_')) {
        warnOnce(ctx, 'gradient', 'gradients are imported as their first colour stop');
        const stop = arr(p['gradientStops'])[0];
        return stop ? { color: hexOf(obj(stop['color']), opacity) } : undefined;
    }
    return undefined;
}

function strokeOf(node: Json, ctx: Ctx): Stroke | undefined {
    const paint = paintOf(topPaint(node['strokes']), ctx);
    return paint ? { paint, width: num(node['strokeWeight'], 1) } : undefined;
}

function shadowOf(node: Json): Shadow | undefined {
    const e = arr(node['effects']).find((x) => visible(x) && x['type'] === 'DROP_SHADOW');
    if (!e) return undefined;
    const offset = obj(e['offset']);
    return {
        x: num(offset['x']),
        y: num(offset['y']),
        blur: num(e['radius']),
        spread: num(e['spread']),
        color: hexOf(obj(e['color'])),
    };
}

function dimOf(value: number, bound: unknown, ctx: Ctx): Dim {
    const id = str(obj(bound)['id']);
    const token = id ? ctx.vars.get(id) : undefined;
    return token ? { value, token } : { value };
}

// ---------------------------------------------------------------------------------------------
// Geometry and layout
// ---------------------------------------------------------------------------------------------

interface Origin {
    x: number;
    y: number;
}

/**
 * Position, size and rotation in the parent's space. The centre of `absoluteBoundingBox` does not
 * move under rotation, and `size` is the unrotated size, so rotated nodes and Figma groups (which
 * have no coordinate space of their own) both land where they should.
 */
function box(node: Json, parent: Origin) {
    const abs = obj(node['absoluteBoundingBox']);
    const size = obj(node['size']);
    const width = num(size['x'], num(abs['width']));
    const height = num(size['y'], num(abs['height']));
    const rt = node['relativeTransform'] as number[][] | undefined;
    const rotation =
        rt?.[0] && rt[1] ? round((Math.atan2(rt[1][0]!, rt[0][0]!) * 180) / Math.PI) : 0;
    const cx = num(abs['x']) + num(abs['width']) / 2;
    const cy = num(abs['y']) + num(abs['height']) / 2;
    return {
        x: round(cx - parent.x - width / 2),
        y: round(cy - parent.y - height / 2),
        width: round(width),
        height: round(height),
        rotation: rotation === 0 ? 0 : rotation,
    };
}

const originOf = (node: Json): Origin => {
    const abs = obj(node['absoluteBoundingBox']);
    return { x: num(abs['x']), y: num(abs['y']) };
};

const SIZING: Record<string, Sizing> = { FIXED: 'fixed', HUG: 'hug', FILL: 'fill' };
const H_CONSTRAINT: Record<string, HConstraint> = {
    LEFT: 'left',
    RIGHT: 'right',
    LEFT_RIGHT: 'left-right',
    CENTER: 'center',
    SCALE: 'scale',
};
const V_CONSTRAINT: Record<string, VConstraint> = {
    TOP: 'top',
    BOTTOM: 'bottom',
    TOP_BOTTOM: 'top-bottom',
    CENTER: 'center',
    SCALE: 'scale',
};

interface ParentInfo extends Origin {
    flex: boolean;
}

function common(node: Json, parent: ParentInfo) {
    const out: Record<string, unknown> = {
        name: str(node['name'], 'Layer'),
        ...box(node, parent),
        opacity: num(node['opacity'], 1),
        hidden: node['visible'] === false,
        locked: node['locked'] === true,
    };
    const shadow = shadowOf(node);
    if (shadow) out['shadow'] = shadow;
    if (parent.flex) {
        if (node['layoutPositioning'] === 'ABSOLUTE') out['position'] = 'absolute';
        const h = SIZING[str(node['layoutSizingHorizontal'])];
        const v = SIZING[str(node['layoutSizingVertical'])];
        if (h || v) out['sizing'] = { h: h ?? 'fixed', v: v ?? 'fixed' };
    } else {
        const c = obj(node['constraints']);
        const h = H_CONSTRAINT[str(c['horizontal'])] ?? 'left';
        const v = V_CONSTRAINT[str(c['vertical'])] ?? 'top';
        if (h !== 'left' || v !== 'top') out['constraints'] = { h, v };
    }
    return out;
}

function layoutOf(node: Json, ctx: Ctx): Layout {
    const mode = str(node['layoutMode']);
    if (mode !== 'HORIZONTAL' && mode !== 'VERTICAL') return defaultLayout();
    const bound = obj(node['boundVariables']);
    const justify: Record<string, Layout['justify']> = {
        MIN: 'start',
        CENTER: 'center',
        MAX: 'end',
        SPACE_BETWEEN: 'space-between',
    };
    const align: Record<string, Layout['align']> = {
        MIN: 'start',
        CENTER: 'center',
        MAX: 'end',
        BASELINE: 'baseline',
    };
    return {
        mode: 'flex',
        direction: mode === 'HORIZONTAL' ? 'row' : 'column',
        wrap: node['layoutWrap'] === 'WRAP',
        gap: dimOf(num(node['itemSpacing']), bound['itemSpacing'], ctx),
        padding: [
            dimOf(num(node['paddingTop']), bound['paddingTop'], ctx),
            dimOf(num(node['paddingRight']), bound['paddingRight'], ctx),
            dimOf(num(node['paddingBottom']), bound['paddingBottom'], ctx),
            dimOf(num(node['paddingLeft']), bound['paddingLeft'], ctx),
        ],
        align: align[str(node['counterAxisAlignItems'], 'MIN')] ?? 'start',
        justify: justify[str(node['primaryAxisAlignItems'], 'MIN')] ?? 'start',
    };
}

const radiusOf = (node: Json) =>
    num(node['cornerRadius'], num(list(node['rectangleCornerRadii'])[0]));

// ---------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------

function children(node: Json, ctx: Ctx, frame: boolean): SceneNode[] {
    const parent: ParentInfo = {
        ...originOf(node),
        flex: frame && (node['layoutMode'] === 'HORIZONTAL' || node['layoutMode'] === 'VERTICAL'),
    };
    return arr(node['children'])
        .map((c) => convert(c, parent, ctx))
        .filter((n): n is SceneNode => !!n);
}

function convertFrame(node: Json, parent: ParentInfo, ctx: Ctx): FrameNode {
    return createFrame(idFor(ctx, node, 'f'), {
        ...common(node, parent),
        fill: paintOf(topPaint(node['fills']), ctx),
        stroke: strokeOf(node, ctx),
        radius: radiusOf(node),
        clip: node['clipsContent'] === true,
        layout: layoutOf(node, ctx),
        children: children(node, ctx, true),
    });
}

function convertText(node: Json, parent: ParentInfo, ctx: Ctx): TextNode {
    const s = obj(node['style']);
    const size = num(s['fontSize'], 16);
    const align: Record<string, TextNode['align']> = { CENTER: 'middle', RIGHT: 'end' };
    const resize = str(node['textAutoResize'], 'NONE');
    if (list(node['characterStyleOverrides']).some((x) => x !== 0))
        warnOnce(
            ctx,
            `mixed:${str(node['id'])}`,
            `text "${str(node['name'])}" has mixed styles; the first is used`,
        );
    const id = idFor(ctx, node, 't');
    const text = createText(id, {
        ...common(node, parent),
        content: str(node['characters']),
        fontFamily: `${str(s['fontFamily'], 'Inter')}, sans-serif`,
        fontSize: size,
        fontWeight: num(s['fontWeight'], 400),
        lineHeight: num(s['lineHeightPx']) ? round(num(s['lineHeightPx']) / size) : 1.2,
        letterSpacing: round(num(s['letterSpacing'])),
        align: align[str(s['textAlignHorizontal'])] ?? 'start',
        box:
            resize === 'WIDTH_AND_HEIGHT'
                ? 'auto-width'
                : resize === 'HEIGHT'
                  ? 'fixed-width'
                  : 'fixed',
        fill: paintOf(topPaint(node['fills']), ctx) ?? { color: '#000000' },
    });
    const propKey = str(obj(node['componentPropertyReferences'])['characters']);
    if (propKey && ctx.propLayers) {
        text.prop = slug(propKey.split('#')[0]!, 'text');
        ctx.propLayers.set(propKey, id);
    }
    relayoutText(text, ctx.measure);
    return text;
}

function convertVector(node: Json, parent: ParentInfo, ctx: Ctx): SceneNode | null {
    const fill = arr(node['fillGeometry'])
        .map((g) => str(g['path']))
        .filter(Boolean);
    const outline = arr(node['strokeGeometry'])
        .map((g) => str(g['path']))
        .filter(Boolean);
    const stroke = strokeOf(node, ctx);
    if (!fill.length && !outline.length) {
        warnOnce(
            ctx,
            'geometry',
            'vectors need the file fetched with geometry=paths; some were skipped',
        );
        return null;
    }
    // Filled shapes keep their outline; stroke-only shapes (icons) become their outlined stroke.
    return createShape(idFor(ctx, node, 'p'), 'path', {
        ...common(node, parent),
        d: (fill.length ? fill : outline).join(' '),
        fill: fill.length ? paintOf(topPaint(node['fills']), ctx) : stroke?.paint,
        stroke: fill.length ? stroke : undefined,
    });
}

function convertImageFill(
    node: Json,
    fillPaint: Json,
    parent: ParentInfo,
    ctx: Ctx,
): SceneNode | null {
    const ref = str(fillPaint['imageRef']);
    const image = ctx.images[ref];
    if (!image) {
        warnOnce(ctx, `img:${ref}`, `image for "${str(node['name'])}" could not be downloaded`);
        return null;
    }
    const path = `assets/images/figma-${slug(ref, 'image').slice(0, 24)}.${image.ext}`;
    ctx.assets[path] = image.bytes;
    const fit: Record<string, 'cover' | 'contain' | 'fill'> = { FILL: 'cover', FIT: 'contain' };
    const depth = ctx.file.split('/').length - 1;
    return createImage(idFor(ctx, node, 'img'), `${'../'.repeat(depth)}${path}`, {
        ...common(node, parent),
        fit: fit[str(fillPaint['scaleMode'])] ?? 'fill',
    });
}

function convertInstance(node: Json, parent: ParentInfo, ctx: Ctx): SceneNode | null {
    const ref = ctx.components.get(str(node['componentId']));
    if (!ref) {
        // A library component: keep what it looks like, as a frame.
        warnOnce(
            ctx,
            `lib:${str(node['componentId'])}`,
            `"${str(node['name'])}" is an instance of a library component; imported as a detached frame`,
        );
        return convertFrame(node, parent, ctx);
    }
    const overrides: Override[] = [];
    const set = new Set<string>();
    for (const [key, prop] of Object.entries(obj(node['componentProperties']))) {
        const p = obj(prop);
        const target = ref.propLayers.get(key);
        if (p['type'] === 'TEXT' && target) {
            overrides.push({ target, text: str(p['value']), extra: {} });
            set.add(target);
        }
    }
    // Text changed directly in the instance: its layers are `I<instance>;<component node>` ids.
    const walk = (n: Json) => {
        for (const c of arr(n['children'])) {
            if (c['type'] === 'TEXT') {
                const source = str(c['id']).split(';').at(-1) ?? '';
                const target = ctx.compIds.get(source);
                const text = str(c['characters']);
                if (target && !set.has(target) && ctx.compTexts.get(source) !== text) {
                    overrides.push({ target, text, extra: {} });
                    set.add(target);
                }
            }
            walk(c);
        }
    };
    walk(node);
    const depth = ctx.file.split('/').length - 1;
    const href =
        ctx.file === COMPONENT_FILE
            ? `#${ref.setId}`
            : `${'../'.repeat(depth)}${COMPONENT_FILE}#${ref.setId}`;
    const instance: InstanceNode = createInstance(idFor(ctx, node, 'i'), href, {
        ...common(node, parent),
        overrides,
    });
    if (ref.variant) instance.variant = ref.variant;
    return instance;
}

function convert(node: Json, parent: ParentInfo, ctx: Ctx): SceneNode | null {
    const type = str(node['type']);
    const inComponent = !!ctx.propLayers;
    let out: SceneNode | null;
    switch (type) {
        case 'FRAME':
        case 'SECTION':
            out = convertFrame(node, parent, ctx);
            break;
        case 'COMPONENT':
        case 'COMPONENT_SET':
            // A component placed inside a frame: an instance of it where it stands.
            out = convertInstance({ ...node, componentId: str(node['id']) }, parent, ctx);
            break;
        case 'INSTANCE':
            out = convertInstance(node, parent, ctx);
            break;
        case 'GROUP':
            out = createGroup(idFor(ctx, node, 'g'), {
                ...common(node, parent),
                children: children(node, ctx, false),
            });
            break;
        case 'RECTANGLE': {
            const fill = topPaint(node['fills']);
            if (fill?.['type'] === 'IMAGE') {
                out = convertImageFill(node, fill, parent, ctx);
                break;
            }
            out = createShape(idFor(ctx, node, 'r'), 'rect', {
                ...common(node, parent),
                fill: paintOf(fill, ctx),
                stroke: strokeOf(node, ctx),
                radius: radiusOf(node),
            });
            break;
        }
        case 'ELLIPSE':
            out = createShape(idFor(ctx, node, 'e'), 'ellipse', {
                ...common(node, parent),
                fill: paintOf(topPaint(node['fills']), ctx),
                stroke: strokeOf(node, ctx),
            });
            break;
        case 'LINE':
            out = createShape(idFor(ctx, node, 'l'), 'line', {
                ...common(node, parent),
                stroke: strokeOf(node, ctx),
            });
            break;
        case 'VECTOR':
        case 'BOOLEAN_OPERATION':
        case 'STAR':
        case 'REGULAR_POLYGON':
            out = convertVector(node, parent, ctx);
            break;
        case 'TEXT':
            out = convertText(node, parent, ctx);
            break;
        default:
            warnOnce(ctx, `type:${type}`, `skipped ${type.toLowerCase()} layers (not supported)`);
            return null;
    }
    // Remember component layers, so instances can override them by id.
    if (out && inComponent) {
        ctx.compIds.set(str(node['id']), out.id);
        if (out.type === 'text') ctx.compTexts.set(str(node['id']), out.content);
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------------------------

const axisName = (s: string) => slug(s.split('#')[0]!, 'prop');
const variantValue = (s: string) => s.trim().replace(/[,=]/g, '-');

/** "Size=md, State=hover" → "size=md,state=hover" */
function variantOf(name: string): string {
    const v: Record<string, string> = {};
    for (const part of name.split(',')) {
        const [k, val] = part.split('=');
        if (k && val !== undefined) v[axisName(k)] = variantValue(val);
    }
    return formatVariant(v);
}

function propsOf(defs: Json): { props: Record<string, PropDef>; defaultVariant?: string } {
    const props: Record<string, PropDef> = {};
    const defaults: Record<string, string> = {};
    for (const [key, d] of Object.entries(defs)) {
        const def = obj(d);
        const name = axisName(key);
        switch (def['type']) {
            case 'VARIANT':
                props[name] = list(def['variantOptions']).map((o) => variantValue(String(o)));
                defaults[name] = variantValue(str(def['defaultValue']));
                break;
            case 'TEXT':
                props[name] = 'text';
                break;
            case 'BOOLEAN':
                props[name] = 'boolean';
                break;
            case 'INSTANCE_SWAP':
                props[name] = 'instance';
                break;
        }
    }
    return Object.keys(defaults).length
        ? { props, defaultVariant: formatVariant(defaults) }
        : { props };
}

function componentNode(node: Json, id: string, ctx: Ctx, variant?: string): ComponentNode {
    ctx.propLayers = new Map();
    const origin = originOf(node);
    const flex = node['layoutMode'] === 'HORIZONTAL' || node['layoutMode'] === 'VERTICAL';
    const kids = arr(node['children'])
        .map((c) => convert(c, { ...origin, flex }, ctx))
        .filter((n): n is SceneNode => !!n);
    const size = box(node, origin);
    const out: ComponentNode = {
        ...createFrame(id, {
            name: str(node['name'], 'Component'),
            width: size.width,
            height: size.height,
            fill: paintOf(topPaint(node['fills']), ctx),
            stroke: strokeOf(node, ctx),
            radius: radiusOf(node),
            clip: node['clipsContent'] === true,
            layout: layoutOf(node, ctx),
            children: kids,
        }),
        type: 'component',
        x: 0,
        y: 0,
    };
    const shadow = shadowOf(node);
    if (shadow) out.shadow = shadow;
    if (variant) out.variant = variant;
    return out;
}

function collectComponents(canvases: Json[], ctx: Ctx): ComponentSet[] {
    const sets: Json[] = [];
    const singles: Json[] = [];
    const visit = (n: Json, parentType: string) => {
        if (n['type'] === 'COMPONENT_SET') sets.push(n);
        else if (n['type'] === 'COMPONENT' && parentType !== 'COMPONENT_SET') singles.push(n);
        for (const c of arr(n['children'])) visit(c, str(n['type']));
    };
    for (const c of canvases) visit(c, 'CANVAS');

    // Ids first, so instances inside components can point at any component.
    const plans: {
        node: Json;
        setId: string;
        variants: { node: Json; id: string; variant?: string }[];
    }[] = [];
    for (const s of sets) {
        const setId = uniqueId(ctx, `c_${slug(str(s['name']), 'component').replace(/-/g, '_')}`);
        const variants = arr(s['children'])
            .filter((v) => v['type'] === 'COMPONENT')
            .map((v) => {
                const variant = variantOf(str(v['name']));
                const values = slug(variant.replace(/[^,]+=/g, '').replace(/,/g, '_'), 'v');
                const id = uniqueId(ctx, `${setId}__${values.replace(/-/g, '_')}`);
                ctx.components.set(str(v['id']), { setId, variant, propLayers: new Map() });
                return { node: v, id, variant };
            });
        // The set itself, placed somewhere: its default variant.
        const { defaultVariant } = propsOf(obj(s['componentPropertyDefinitions']));
        ctx.components.set(str(s['id']), { setId, variant: defaultVariant, propLayers: new Map() });
        plans.push({ node: s, setId, variants });
    }
    for (const c of singles) {
        const setId = uniqueId(ctx, `c_${slug(str(c['name']), 'component').replace(/-/g, '_')}`);
        ctx.components.set(str(c['id']), { setId, propLayers: new Map() });
        plans.push({ node: c, setId, variants: [{ node: c, id: setId }] });
    }

    const out: ComponentSet[] = [];
    for (const plan of plans) {
        const isSet = plan.node['type'] === 'COMPONENT_SET';
        const { props, defaultVariant } = propsOf(obj(plan.node['componentPropertyDefinitions']));
        const variants = plan.variants.map((v) => {
            const node = componentNode(v.node, v.id, ctx, isSet ? v.variant : undefined);
            ctx.components.get(str(v.node['id']))!.propLayers = ctx.propLayers!;
            return node;
        });
        ctx.propLayers = undefined;
        out.push({
            id: plan.setId,
            name: str(plan.node['name'], 'Component'),
            isSet,
            props,
            ...(isSet && defaultVariant ? { defaultVariant } : {}),
            variants,
            extra: {},
        });
    }
    return out;
}

// ---------------------------------------------------------------------------------------------
// Variables → tokens
// ---------------------------------------------------------------------------------------------

const DIMENSION_SCOPES = new Set([
    'CORNER_RADIUS',
    'WIDTH_HEIGHT',
    'GAP',
    'FONT_SIZE',
    'LINE_HEIGHT',
    'LETTER_SPACING',
    'STROKE_FLOAT',
    'EFFECT_FLOAT',
    'PARAGRAPH_SPACING',
    'PARAGRAPH_INDENT',
]);

function tokensFrom(
    variables: Json | null | undefined,
    ctx: Ctx,
): { base: TokenDocument; themes: Record<string, TokenDocument> } {
    const base: TokenDocument = {};
    const themes: Record<string, TokenDocument> = {};
    const meta = obj(obj(variables)['meta']);
    const vars = obj(meta['variables']);
    const collections = obj(meta['variableCollections']);
    const segment = (s: string) => slug(s, 'token').replace(/-+/g, '-');
    const pathOf = new Map<string, string>();
    const typeOf = new Map<string, string>();
    for (const [id, v] of Object.entries(vars)) {
        const variable = obj(v);
        const scopes = list(variable['scopes']).map(String);
        const kind = str(variable['resolvedType']);
        const type =
            kind === 'COLOR'
                ? 'color'
                : kind === 'FLOAT'
                  ? scopes.some((s) => DIMENSION_SCOPES.has(s)) ||
                    (scopes.includes('ALL_SCOPES') &&
                        /space|spacing|gap|radius|size|padding|width|height/i.test(
                            str(variable['name']),
                        ))
                      ? 'dimension'
                      : 'number'
                  : kind === 'STRING' && scopes.includes('FONT_FAMILY')
                    ? 'fontFamily'
                    : null;
        if (!type) {
            warnOnce(
                ctx,
                `var:${kind}`,
                `${kind.toLowerCase()} variables are not imported as tokens`,
            );
            continue;
        }
        const parts = str(variable['name']).split('/').map(segment).filter(Boolean);
        // A bare name gets its type as the group: `primary` → `color.primary`.
        const path = (
            parts.length > 1 ? parts : [type === 'dimension' ? 'size' : type, ...parts]
        ).join('.');
        pathOf.set(id, path);
        typeOf.set(id, type);
        ctx.vars.set(id, `{${path}}`);
    }
    const valueOf = (id: string, raw: unknown): unknown => {
        const alias = obj(raw);
        if (alias['type'] === 'VARIABLE_ALIAS') {
            const target = pathOf.get(str(alias['id']));
            return target ? `{${target}}` : undefined;
        }
        switch (typeOf.get(id)) {
            case 'color':
                return colorValue(obj(raw));
            case 'dimension':
                return { value: round(num(raw)), unit: 'px' };
            case 'number':
                return num(raw);
            default:
                return typeof raw === 'string' ? raw : undefined;
        }
    };
    for (const [id, v] of Object.entries(vars)) {
        const path = pathOf.get(id);
        if (!path) continue;
        const variable = obj(v);
        const collection = obj(collections[str(variable['variableCollectionId'])]);
        const modes = arr(collection['modes']);
        const byMode = obj(variable['valuesByMode']);
        const defaultMode = str(collection['defaultModeId'], str(modes[0]?.['modeId']));
        const $type = typeOf.get(id) as never;
        const baseValue = valueOf(id, byMode[defaultMode] ?? Object.values(byMode)[0]);
        if (baseValue !== undefined) setToken(base, path, { $type, $value: baseValue });
        if (modes.length > 1) {
            for (const mode of modes) {
                const value = valueOf(id, byMode[str(mode['modeId'])]);
                if (value === undefined) continue;
                const theme = slug(str(mode['name']), 'mode');
                setToken((themes[theme] ??= {}), path, { $type, $value: value });
            }
        }
    }
    return { base, themes };
}

// ---------------------------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------------------------

/** Maps a Figma file (REST API JSON) to an OVD project. */
export function importFigma(
    input: FigmaInput,
    opts: { name?: string; measure?: Measure } = {},
): FigmaImport {
    const doc = obj(input.file['document']);
    const canvases = arr(doc['children']).filter((c) => c['type'] === 'CANVAS');
    const ctx: Ctx = {
        warnings: [],
        warned: new Set(),
        taken: new Set(),
        file: COMPONENT_FILE,
        measure: opts.measure ?? approxMeasure,
        assets: {},
        images: input.images ?? {},
        vars: new Map(),
        components: new Map(),
        compIds: new Map(),
        compTexts: new Map(),
    };
    if (input.variables === null)
        ctx.warnings.push(
            'variables were not available (they need a Figma plan with the Variables API); colours are kept as values',
        );
    const { base, themes } = tokensFrom(input.variables, ctx);

    const sets = collectComponents(canvases, ctx);

    const pages: Page[] = [];
    const used = new Set<string>();
    for (const canvas of canvases) {
        const layers = arr(canvas['children']).filter(
            (n) => n['type'] !== 'COMPONENT' && n['type'] !== 'COMPONENT_SET',
        );
        if (!layers.length && arr(canvas['children']).length) continue; // a components page
        const name = str(canvas['name'], 'Page');
        let file = `pages/${slug(name)}.svg`;
        for (let i = 2; used.has(file); i++) file = `pages/${slug(name)}-${i}.svg`;
        used.add(file);
        ctx.file = file;
        ctx.taken = new Set();
        const children = layers
            .map((l) => convert(l, { x: 0, y: 0, flex: false }, ctx))
            .filter((n): n is SceneNode => !!n);
        pages.push({ file, name, children, extra: {}, extraChildren: [] });
    }
    if (!pages.length)
        pages.push({
            file: 'pages/page.svg',
            name: 'Page',
            children: [],
            extra: {},
            extraChildren: [],
        });

    const components: ComponentFile[] = sets.length
        ? [{ file: COMPONENT_FILE, name: 'Figma components', sets, extra: {}, extraChildren: [] }]
        : [];
    const tokens: Record<string, TokenDocument> = {};
    if (Object.keys(base).length) tokens[TOKENS_FILE] = base;
    const themeFiles: Record<string, string[]> = {};
    for (const [theme, docTokens] of Object.entries(themes)) {
        const file = `tokens/themes/${theme}.tokens.json`;
        tokens[file] = docTokens;
        themeFiles[theme] = [file];
    }
    const key = str(input.file['key']) || slug(str(input.file['name']), 'figma');
    const manifest: Manifest = {
        $schema: 'https://ovd.dev/schema/0.1/manifest.json',
        version: '0.1',
        name: opts.name ?? (str(input.file['name']) || 'Figma import'),
        id: `urn:figma:${key}`,
        exports: 'exports/',
        tokens: tokens[TOKENS_FILE] ? [TOKENS_FILE] : [],
        themes: themeFiles,
        pages: pages.map((p) => ({ file: p.file, name: p.name })),
    };
    return {
        project: {
            manifest,
            pages,
            components,
            tokens,
            assets: ctx.assets,
            comments: {},
            other: {},
        },
        warnings: ctx.warnings,
    };
}
