/**
 * The OVD document model. Plain, JSON-serialisable objects: the editor mutates them through immer,
 * autosave stores them as-is, and read.ts / write.ts map them to and from SVG.
 *
 * Coordinates are local to the parent: a frame's children live in the frame's own space, matching
 * the `<g transform="translate(x y)">` the writer emits.
 */
import type { XmlElement, XmlNode } from './xml';

export const OVD_NS = 'https://ovd.dev/ns/0.1';
export const SVG_NS = 'http://www.w3.org/2000/svg';
export const OVD_VERSION = '0.1';

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

/** A colour: the resolved CSS value (always present, used as the plain-SVG fallback) plus an
 *  optional DTCG alias such as `{color.primary}` that wins when tokens are available. */
export interface Paint {
    color: string;
    token?: string;
}

/** A length that may be bound to a dimension token. */
export interface Dim {
    value: number;
    token?: string;
}

export interface Stroke {
    paint: Paint;
    width: number;
}

export interface Shadow {
    x: number;
    y: number;
    blur: number;
    spread: number;
    color: string;
}

export type Sizing = 'fixed' | 'hug' | 'fill';
export type Align = 'start' | 'center' | 'end' | 'stretch' | 'baseline';
export type Justify = 'start' | 'center' | 'end' | 'space-between';
export type HConstraint = 'left' | 'right' | 'left-right' | 'center' | 'scale';
export type VConstraint = 'top' | 'bottom' | 'top-bottom' | 'center' | 'scale';

/** Spec §6 — CSS flexbox vocabulary. */
export interface Layout {
    mode: 'none' | 'flex';
    direction: 'row' | 'column';
    wrap: boolean;
    gap: Dim;
    /** top, right, bottom, left */
    padding: [Dim, Dim, Dim, Dim];
    align: Align;
    justify: Justify;
}

/** Spec §9 — a prototype link, written as a wrapping SVG `<a>`. */
export interface PrototypeLink {
    href: string;
    trigger?: string;
    transition?: string;
    duration?: string;
}

// ---------------------------------------------------------------------------------------------
// Scene nodes
// ---------------------------------------------------------------------------------------------

export type NodeType = 'frame' | 'group' | 'shape' | 'text' | 'image' | 'instance' | 'raw';

interface BaseNode {
    id: string;
    type: NodeType;
    name: string;
    x: number;
    y: number;
    width: number;
    height: number;
    /** Degrees, clockwise, about the node's centre. */
    rotation: number;
    opacity: number;
    hidden: boolean;
    locked: boolean;
    shadow?: Shadow;
    /** Per-axis sizing inside a flex parent (spec §6). */
    sizing?: { h: Sizing; v: Sizing };
    position?: 'auto' | 'absolute';
    /** Constraints inside a `layout=none` frame (spec §6). */
    constraints?: { h: HConstraint; v: VConstraint };
    /** Inside a component: the component prop this layer is bound to (`ovd:prop`). */
    prop?: string;
    link?: PrototypeLink;
    title?: string;
    desc?: string;
    /** Attributes this version does not understand, written back unchanged (principle 6). */
    extra: Record<string, string>;
    /** Child elements this version does not understand, written back unchanged. */
    extraChildren: XmlNode[];
}

export interface FrameNode extends BaseNode {
    type: 'frame';
    fill?: Paint;
    stroke?: Stroke;
    radius: number;
    clip: boolean;
    layout: Layout;
    children: SceneNode[];
}

export interface GroupNode extends BaseNode {
    type: 'group';
    children: SceneNode[];
}

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'path';

export interface ShapeNode extends BaseNode {
    type: 'shape';
    kind: ShapeKind;
    fill?: Paint;
    stroke?: Stroke;
    radius: number;
    /** Path data in the node's local box (0,0)–(width,height). Paths only. */
    d?: string;
}

export type TextBox = 'auto-width' | 'fixed-width' | 'fixed';
export type TextAlign = 'start' | 'middle' | 'end';

export interface TextNode extends BaseNode {
    type: 'text';
    /** Source text (`ovd:content`). */
    content: string;
    /** The editor's pre-wrapped lines (`<tspan>`s, spec §7). Regenerated on edit, never on format. */
    lines: string[];
    box: TextBox;
    fontFamily: string;
    fontSize: number;
    fontWeight: number;
    /** Multiplier of font size. */
    lineHeight: number;
    letterSpacing: number;
    align: TextAlign;
    fill: Paint;
    /** A DTCG typography token, e.g. `{typography.heading.xl}`. */
    textStyle?: string;
}

export type ImageFit = 'fill' | 'contain' | 'cover';

export interface ImageNode extends BaseNode {
    type: 'image';
    /** Relative path from the file, e.g. `../assets/images/hero.webp`. */
    href: string;
    fit: ImageFit;
}

/** Spec §5 — an override applied to one layer of the instance's component, by that layer's id. */
export interface Override {
    target: string;
    text?: string;
    fill?: Paint;
    stroke?: Paint;
    hidden?: boolean;
    /** Nested instance swap: a new href for a `<use>` inside the component. */
    swap?: string;
    extra: Record<string, string>;
}

export interface InstanceNode extends BaseNode {
    type: 'instance';
    /** Component reference: `#id` (same file), `../components/button.svg#id`, or `lib:path#id`. */
    href: string;
    /** Variant selection, `axis=value,axis=value` (spec §5). */
    variant?: string;
    overrides: Override[];
}

/** An element this version does not model. Kept in place so z-order and content survive. */
export interface RawNode extends BaseNode {
    type: 'raw';
    xml: XmlElement;
}

export type SceneNode =
    FrameNode | GroupNode | ShapeNode | TextNode | ImageNode | InstanceNode | RawNode;
export type ContainerNode = FrameNode | GroupNode;

// ---------------------------------------------------------------------------------------------
// Components (spec §5)
// ---------------------------------------------------------------------------------------------

/** One concrete component (a single variant): an SVG `<symbol>`, laid out like a frame. */
export interface ComponentNode extends Omit<FrameNode, 'type'> {
    type: 'component';
    /** `axis=value,…` for a variant inside a set. */
    variant?: string;
}

/** Prop types: an enum axis (list of values), `text`, `boolean` or `instance`. */
export type PropDef = string[] | 'text' | 'boolean' | 'instance';

export interface ComponentSet {
    id: string;
    name: string;
    /** false for a standalone component (a single `<symbol ovd:type="component">`). */
    isSet: boolean;
    props: Record<string, PropDef>;
    defaultVariant?: string;
    variants: ComponentNode[];
    extra: Record<string, string>;
}

export interface ComponentFile {
    file: string;
    name: string;
    sets: ComponentSet[];
    /** Root attributes and non-defs children not modelled. */
    extra: Record<string, string>;
    extraChildren: XmlNode[];
}

// ---------------------------------------------------------------------------------------------
// Pages and project
// ---------------------------------------------------------------------------------------------

export interface Page {
    file: string;
    name: string;
    children: SceneNode[];
    extra: Record<string, string>;
    /** Top-level children not modelled (e.g. a foreign `<defs>`). The generated token `<style>` is
     *  not kept here; the writer regenerates it (spec §8). */
    extraChildren: XmlNode[];
}

export interface ManifestPage {
    file: string;
    name: string;
}

export interface ManifestLibrary {
    name: string;
    url: string;
    ref: string;
}

export interface Manifest {
    $schema?: string;
    version: string;
    name: string;
    id: string;
    exports: string;
    tokens: string[];
    themes: Record<string, string[]>;
    pages: ManifestPage[];
    components?: string[];
    libraries?: ManifestLibrary[];
    [key: string]: unknown;
}

/** DTCG token file content, kept as parsed JSON so unknown keys survive. */
export type TokenDocument = Record<string, unknown>;

export interface Project {
    manifest: Manifest;
    pages: Page[];
    components: ComponentFile[];
    /** path → DTCG JSON */
    tokens: Record<string, TokenDocument>;
    /** path → bytes (images, fonts) */
    assets: Record<string, Uint8Array>;
    /** path → comment thread JSON (spec §9) */
    comments: Record<string, unknown>;
    /** Any other file in the project folder, preserved as-is (README, .gitattributes, exports/…). */
    other: Record<string, string | Uint8Array>;
    /**
     * Loaded manifest libraries by name (spec §3) — supplied at runtime by a host that fetched
     * them, never read from or written to the package. Their component files resolve as
     * `name:components/file.svg`.
     */
    libraries?: Record<string, Project>;
}

// ---------------------------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------------------------

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** A short, stable, file-unique id with a readable type prefix (`f_` frame, `r_` rect …). */
export function newId(prefix: string, taken?: Set<string>): string {
    for (;;) {
        let s = '';
        for (let i = 0; i < 6; i++)
            s += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
        const id = `${prefix}_${s}`;
        if (!taken || !taken.has(id)) {
            taken?.add(id);
            return id;
        }
    }
}

export const ID_PREFIX: Record<string, string> = {
    frame: 'f',
    group: 'g',
    rect: 'r',
    ellipse: 'e',
    line: 'l',
    path: 'p',
    text: 't',
    image: 'img',
    instance: 'i',
    component: 'c',
};

// ---------------------------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------------------------

export function defaultLayout(): Layout {
    return {
        mode: 'none',
        direction: 'column',
        wrap: false,
        gap: { value: 0 },
        padding: [{ value: 0 }, { value: 0 }, { value: 0 }, { value: 0 }],
        align: 'start',
        justify: 'start',
    };
}

function base<T extends NodeType>(type: T, id: string, name: string) {
    return {
        id,
        type,
        name,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        extra: {},
        extraChildren: [],
    };
}

export function createFrame(id: string, init: Partial<FrameNode> = {}): FrameNode {
    return {
        ...base('frame', id, 'Frame'),
        fill: { color: '#ffffff' },
        radius: 0,
        clip: true,
        layout: defaultLayout(),
        children: [],
        ...init,
        type: 'frame',
    };
}

export function createGroup(id: string, init: Partial<GroupNode> = {}): GroupNode {
    return { ...base('group', id, 'Group'), children: [], ...init, type: 'group' };
}

export function createShape(id: string, kind: ShapeKind, init: Partial<ShapeNode> = {}): ShapeNode {
    const names: Record<ShapeKind, string> = {
        rect: 'Rectangle',
        ellipse: 'Ellipse',
        line: 'Line',
        path: 'Path',
    };
    const lineLike = kind === 'line' || kind === 'path';
    return {
        ...base('shape', id, names[kind]),
        kind,
        fill: lineLike ? undefined : { color: '#d9d9d9' },
        stroke: lineLike ? { paint: { color: '#1e1e1e' }, width: 2 } : undefined,
        radius: 0,
        ...init,
        type: 'shape',
    };
}

export function createText(id: string, init: Partial<TextNode> = {}): TextNode {
    const content = init.content ?? 'Text';
    return {
        ...base('text', id, content.slice(0, 40) || 'Text'),
        content,
        lines: content.split('\n'),
        box: 'auto-width',
        fontFamily: 'Inter, sans-serif',
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 1.4,
        letterSpacing: 0,
        align: 'start',
        fill: { color: '#1e1e1e' },
        ...init,
        type: 'text',
    };
}

export function createImage(id: string, href: string, init: Partial<ImageNode> = {}): ImageNode {
    return { ...base('image', id, 'Image'), href, fit: 'cover', ...init, type: 'image' };
}

export function createInstance(
    id: string,
    href: string,
    init: Partial<InstanceNode> = {},
): InstanceNode {
    return { ...base('instance', id, 'Instance'), href, overrides: [], ...init, type: 'instance' };
}

// ---------------------------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------------------------

/** Any node a document can hold at its top level: scene nodes on pages, variants in component
 *  files. Only roots can be components; everything below them is a SceneNode. */
export type AnyNode = SceneNode | ComponentNode;

export function isContainer(node: AnyNode): node is ContainerNode {
    return node.type === 'frame' || node.type === 'group';
}

export function childrenOf(node: AnyNode): SceneNode[] | undefined {
    return node.type === 'frame' || node.type === 'group' || node.type === 'component'
        ? node.children
        : undefined;
}

/** Depth-first walk. Return `false` from the visitor to skip a node's children. */
export function walk(
    nodes: AnyNode[],
    visit: (node: AnyNode, parent: AnyNode | null, depth: number) => void | false,
    parent: AnyNode | null = null,
    depth = 0,
): void {
    for (const node of nodes) {
        if (visit(node, parent, depth) === false) continue;
        const kids = childrenOf(node);
        if (kids) walk(kids, visit, node, depth + 1);
    }
}

export function findNode(nodes: AnyNode[], id: string): AnyNode | undefined {
    let found: AnyNode | undefined;
    walk(nodes, (n) => {
        if (found) return false;
        if (n.id === id) found = n;
    });
    return found;
}

/** The chain of ancestors from the top level down to (excluding) the node. */
export function ancestorsOf(nodes: AnyNode[], id: string): AnyNode[] {
    const path: AnyNode[] = [];
    const search = (list: AnyNode[]): boolean => {
        for (const n of list) {
            if (n.id === id) return true;
            const kids = childrenOf(n);
            if (kids) {
                path.push(n);
                if (search(kids)) return true;
                path.pop();
            }
        }
        return false;
    };
    return search(nodes) ? path : [];
}

/** The list that directly contains the node, and its index there. */
export function locate(
    nodes: AnyNode[],
    id: string,
): { list: AnyNode[]; index: number; parent: AnyNode | null } | undefined {
    const search = (
        list: AnyNode[],
        parent: AnyNode | null,
    ): ReturnType<typeof locate> | undefined => {
        for (let i = 0; i < list.length; i++) {
            const n = list[i]!;
            if (n.id === id) return { list, index: i, parent };
            const kids = childrenOf(n);
            if (kids) {
                const hit = search(kids, n);
                if (hit) return hit;
            }
        }
        return undefined;
    };
    return search(nodes, null);
}

export function collectIds(nodes: AnyNode[], into = new Set<string>()): Set<string> {
    walk(nodes, (n) => {
        into.add(n.id);
    });
    return into;
}

// ---------------------------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------------------------

/** `variant=primary,size=md` → { variant: 'primary', size: 'md' } */
export function parseVariant(s: string | undefined): Record<string, string> {
    const out: Record<string, string> = {};
    if (!s) return out;
    for (const part of s.split(',')) {
        const [k, v] = part.split('=');
        if (k && v !== undefined) out[k.trim()] = v.trim();
    }
    return out;
}

export function formatVariant(v: Record<string, string>): string {
    return Object.entries(v)
        .map(([k, val]) => `${k}=${val}`)
        .join(',');
}
