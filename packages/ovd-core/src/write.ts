/**
 * Model → SVG, in canonical form (spec §10). The output renders in any SVG viewer (principle 1):
 * token references always carry a resolved fallback, frames carry a real clip path, and text is
 * pre-wrapped into `<tspan>`s.
 */
import {
    type ComponentFile,
    type ComponentNode,
    type ComponentSet,
    type Dim,
    type FrameNode,
    type Layout,
    type Override,
    type Page,
    type Paint,
    type SceneNode,
    type Shadow,
    type Stroke,
    OVD_NS,
    OVD_VERSION,
    SVG_NS,
} from './model';
import { anchorX, baselineY } from './text';
import { cssVarName } from './token-ref';
import { type XmlElement, type XmlNode, el, fmtNum, serializeXml, text } from './xml';

type Attrs = Record<string, string | undefined>;

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

function paintValue(p: Paint): string {
    return p.token ? `var(${cssVarName(p.token)}, ${p.color})` : p.color;
}

function paintAttrs(p: Paint | undefined, attr: 'fill' | 'stroke', none = true): Attrs {
    if (!p) return none ? { [attr]: 'none' } : {};
    return { [attr]: paintValue(p), [`ovd:${attr}`]: p.token };
}

function strokeAttrs(s: Stroke | undefined): Attrs {
    if (!s) return {};
    return { ...paintAttrs(s.paint, 'stroke'), 'stroke-width': fmtNum(s.width) };
}

function dim(d: Dim): string {
    return d.token ?? fmtNum(d.value);
}

/** CSS-style shorthand: 1, 2, 3 or 4 values. */
function padding(p: [Dim, Dim, Dim, Dim]): string {
    const [t, r, b, l] = p.map(dim) as [string, string, string, string];
    if (t === r && r === b && b === l) return t;
    if (t === b && r === l) return `${t} ${r}`;
    if (r === l) return `${t} ${r} ${b}`;
    return `${t} ${r} ${b} ${l}`;
}

function layoutAttrs(l: Layout): Attrs {
    if (l.mode !== 'flex') return {};
    return {
        'ovd:layout': 'flex',
        'ovd:direction': l.direction,
        'ovd:wrap': l.wrap ? 'wrap' : undefined,
        'ovd:gap': dim(l.gap),
        'ovd:padding': padding(l.padding),
        'ovd:align': l.align,
        'ovd:justify': l.justify,
    };
}

function shadowAttrs(s: Shadow | undefined): Attrs {
    if (!s) return {};
    return {
        'ovd:shadow': `${fmtNum(s.x)} ${fmtNum(s.y)} ${fmtNum(s.blur)} ${fmtNum(s.spread)} ${s.color}`,
        // Plain-viewer fallback; CSS drop-shadow has no spread, so spread is approximated by blur.
        filter: `drop-shadow(${fmtNum(s.x)}px ${fmtNum(s.y)}px ${fmtNum(s.blur / 2)}px ${s.color})`,
    };
}

function rotateSuffix(n: { rotation: number; width: number; height: number }, ox = 0, oy = 0) {
    if (!n.rotation) return '';
    return ` rotate(${fmtNum(n.rotation)} ${fmtNum(ox + n.width / 2)} ${fmtNum(oy + n.height / 2)})`;
}

function translate(x: number, y: number): string {
    return `translate(${fmtNum(x)} ${fmtNum(y)})`;
}

// ---------------------------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------------------------

function commonAttrs(n: SceneNode | ComponentNode): Attrs {
    let sizing: string | undefined;
    if (n.sizing) sizing = n.sizing.h === n.sizing.v ? n.sizing.h : `${n.sizing.h} ${n.sizing.v}`;
    let constraints: string | undefined;
    if (n.constraints) constraints = `${n.constraints.h} ${n.constraints.v}`;
    return {
        id: n.id || undefined,
        'ovd:name': n.name,
        'ovd:hidden': n.hidden ? 'true' : undefined,
        visibility: n.hidden ? 'hidden' : undefined,
        'ovd:locked': n.locked ? 'true' : undefined,
        opacity: n.opacity !== 1 ? fmtNum(n.opacity) : undefined,
        'ovd:sizing': sizing,
        'ovd:constraints': constraints,
        'ovd:position': n.position === 'absolute' ? 'absolute' : undefined,
        'ovd:prop': n.prop,
        ...shadowAttrs(n.shadow),
    };
}

function meta(n: SceneNode | ComponentNode): XmlNode[] {
    const out: XmlNode[] = [];
    if (n.title) out.push(el('title', {}, [text(n.title)]));
    if (n.desc) out.push(el('desc', {}, [text(n.desc)]));
    return out;
}

function withExtra(attrs: Attrs, extra: Record<string, string>): Attrs {
    const out: Attrs = { ...attrs };
    for (const [k, v] of Object.entries(extra)) {
        if (k.startsWith('a:')) continue; // attributes of a wrapping <a>, see link()
        if (out[k] === undefined) out[k] = v;
    }
    return out;
}

/** Background rect + clip path shared by frames and component symbols. */
function frameBody(n: FrameNode | ComponentNode, clipWithPath: boolean): XmlNode[] {
    const out: XmlNode[] = [];
    const rx = n.radius ? fmtNum(n.radius) : undefined;
    if (clipWithPath && n.clip) {
        out.push(
            el('clipPath', { id: `${n.id}__clip` }, [
                el('rect', { width: fmtNum(n.width), height: fmtNum(n.height), rx }),
            ]),
        );
    }
    if (n.fill || n.stroke) {
        out.push(
            el('rect', {
                width: fmtNum(n.width),
                height: fmtNum(n.height),
                rx,
                ...paintAttrs(n.fill, 'fill'),
                ...strokeAttrs(n.stroke),
            }),
        );
    }
    return out;
}

function link(n: SceneNode, inner: XmlElement): XmlElement {
    if (!n.link) return inner;
    const extra: Attrs = {};
    for (const [k, v] of Object.entries(n.extra)) if (k.startsWith('a:')) extra[k.slice(2)] = v;
    return el(
        'a',
        {
            ...extra,
            href: n.link.href,
            'ovd:trigger': n.link.trigger,
            'ovd:transition': n.link.transition,
            'ovd:duration': n.link.duration,
        },
        [inner],
    );
}

function overrideEl(o: Override): XmlElement {
    const paint = (p: Paint | undefined) => (p ? (p.token ?? p.color) : undefined);
    return el('ovd:override', {
        ...o.extra,
        target: o.target,
        text: o.text,
        fill: paint(o.fill),
        stroke: paint(o.stroke),
        visibility: o.hidden === undefined ? undefined : o.hidden ? 'hidden' : 'visible',
        href: o.swap,
    });
}

export function writeNode(n: SceneNode): XmlElement {
    return link(n, writeBare(n));
}

function writeBare(n: SceneNode): XmlElement {
    switch (n.type) {
        case 'raw':
            return n.xml;

        case 'frame':
            return el(
                'g',
                withExtra(
                    {
                        ...commonAttrs(n),
                        'ovd:type': 'frame',
                        'ovd:width': fmtNum(n.width),
                        'ovd:height': fmtNum(n.height),
                        'ovd:clip': n.clip ? 'true' : undefined,
                        ...layoutAttrs(n.layout),
                        transform: translate(n.x, n.y) + rotateSuffix(n),
                        'clip-path': n.clip ? `url(#${n.id}__clip)` : undefined,
                    },
                    n.extra,
                ),
                [
                    ...meta(n),
                    ...frameBody(n, true),
                    ...n.children.map(writeNode),
                    ...n.extraChildren,
                ],
            );

        case 'group':
            return el(
                'g',
                withExtra(
                    {
                        ...commonAttrs(n),
                        'ovd:type': 'group',
                        'ovd:width': fmtNum(n.width),
                        'ovd:height': fmtNum(n.height),
                        transform: translate(n.x, n.y) + rotateSuffix(n),
                    },
                    n.extra,
                ),
                [...meta(n), ...n.children.map(writeNode), ...n.extraChildren],
            );

        case 'shape': {
            const style = {
                ...paintAttrs(n.fill, 'fill', n.kind !== 'line'),
                ...strokeAttrs(n.stroke),
            };
            if (n.kind === 'rect') {
                return el(
                    'rect',
                    withExtra(
                        {
                            ...commonAttrs(n),
                            x: fmtNum(n.x),
                            y: fmtNum(n.y),
                            width: fmtNum(n.width),
                            height: fmtNum(n.height),
                            rx: n.radius ? fmtNum(n.radius) : undefined,
                            transform: rotateSuffix(n, n.x, n.y).trim() || undefined,
                            ...style,
                        },
                        n.extra,
                    ),
                    [...meta(n), ...n.extraChildren],
                );
            }
            if (n.kind === 'ellipse') {
                return el(
                    'ellipse',
                    withExtra(
                        {
                            ...commonAttrs(n),
                            cx: fmtNum(n.x + n.width / 2),
                            cy: fmtNum(n.y + n.height / 2),
                            rx: fmtNum(n.width / 2),
                            ry: fmtNum(n.height / 2),
                            transform: rotateSuffix(n, n.x, n.y).trim() || undefined,
                            ...style,
                        },
                        n.extra,
                    ),
                    [...meta(n), ...n.extraChildren],
                );
            }
            if (n.kind === 'line') {
                return el(
                    'line',
                    withExtra(
                        {
                            ...commonAttrs(n),
                            x1: fmtNum(n.x),
                            y1: fmtNum(n.y),
                            x2: fmtNum(n.x + n.width),
                            y2: fmtNum(n.y + n.height),
                            transform: rotateSuffix(n, n.x, n.y).trim() || undefined,
                            ...style,
                        },
                        n.extra,
                    ),
                    [...meta(n), ...n.extraChildren],
                );
            }
            return el(
                'path',
                withExtra(
                    {
                        ...commonAttrs(n),
                        'ovd:width': fmtNum(n.width),
                        'ovd:height': fmtNum(n.height),
                        transform: translate(n.x, n.y) + rotateSuffix(n),
                        d: n.d ?? '',
                        ...style,
                    },
                    n.extra,
                ),
                [...meta(n), ...n.extraChildren],
            );
        }

        case 'text': {
            const ax = anchorX(n);
            return el(
                'text',
                withExtra(
                    {
                        ...commonAttrs(n),
                        'ovd:type': 'text',
                        'ovd:box': n.box,
                        'ovd:content': n.content,
                        'ovd:width': fmtNum(n.width),
                        'ovd:height': fmtNum(n.height),
                        'ovd:line-height': fmtNum(n.lineHeight),
                        'ovd:text-style': n.textStyle,
                        transform: translate(n.x, n.y) + rotateSuffix(n),
                        'font-family': n.fontFamily,
                        'font-size': fmtNum(n.fontSize),
                        'font-weight': fmtNum(n.fontWeight),
                        'letter-spacing': n.letterSpacing ? fmtNum(n.letterSpacing) : undefined,
                        'text-anchor': n.align === 'start' ? undefined : n.align,
                        ...paintAttrs(n.fill, 'fill'),
                    },
                    n.extra,
                ),
                [
                    ...meta(n),
                    ...n.lines.map((line, i) =>
                        el('tspan', { x: fmtNum(ax), y: fmtNum(baselineY(n, i)) }, [text(line)]),
                    ),
                    ...n.extraChildren,
                ],
            );
        }

        case 'image':
            return el(
                'image',
                withExtra(
                    {
                        ...commonAttrs(n),
                        'ovd:type': 'image',
                        href: n.href,
                        x: fmtNum(n.x),
                        y: fmtNum(n.y),
                        width: fmtNum(n.width),
                        height: fmtNum(n.height),
                        preserveAspectRatio:
                            n.fit === 'fill'
                                ? 'none'
                                : n.fit === 'cover'
                                  ? 'xMidYMid slice'
                                  : 'xMidYMid meet',
                        transform: rotateSuffix(n, n.x, n.y).trim() || undefined,
                    },
                    n.extra,
                ),
                [...meta(n), ...n.extraChildren],
            );

        case 'instance':
            return el(
                'use',
                withExtra(
                    {
                        ...commonAttrs(n),
                        'ovd:type': 'instance',
                        'ovd:variant': n.variant,
                        href: n.href,
                        x: fmtNum(n.x),
                        y: fmtNum(n.y),
                        width: fmtNum(n.width),
                        height: fmtNum(n.height),
                        transform: rotateSuffix(n, n.x, n.y).trim() || undefined,
                    },
                    n.extra,
                ),
                [...meta(n), ...n.overrides.map(overrideEl), ...n.extraChildren],
            );
    }
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

export interface WriteOptions {
    /** CSS for the generated token `<style>` block (spec §8), from the active theme. */
    tokenCss?: string;
}

function styleBlock(css: string | undefined): XmlNode[] {
    return css ? [el('style', { 'ovd:generated': 'tokens' }, [text(css)])] : [];
}

export function sceneBounds(nodes: SceneNode[]) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
        if (n.type === 'raw') continue;
        const x2 = n.x + Math.max(0, n.width);
        const y2 = n.y + Math.max(0, n.height);
        minX = Math.min(minX, n.x, x2);
        minY = Math.min(minY, n.y, y2);
        maxX = Math.max(maxX, x2, n.x);
        maxY = Math.max(maxY, y2, n.y);
    }
    if (minX === Infinity) return { x: 0, y: 0, width: 1000, height: 1000 };
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

const VIEW_PAD = 100;

export function pageToXml(page: Page, opts: WriteOptions = {}): XmlElement {
    const b = sceneBounds(page.children);
    const viewBox = [
        b.x - VIEW_PAD,
        b.y - VIEW_PAD,
        b.width + VIEW_PAD * 2,
        b.height + VIEW_PAD * 2,
    ]
        .map(fmtNum)
        .join(' ');
    return el(
        'svg',
        {
            ...page.extra,
            xmlns: SVG_NS,
            'xmlns:ovd': OVD_NS,
            'ovd:version': OVD_VERSION,
            'ovd:type': 'page',
            'ovd:name': page.name,
            viewBox,
        },
        [...styleBlock(opts.tokenCss), ...page.extraChildren, ...page.children.map(writeNode)],
    );
}

export function writePage(page: Page, opts: WriteOptions = {}): string {
    return serializeXml(pageToXml(page, opts));
}

function componentSymbol(c: ComponentNode): XmlElement {
    return el(
        'symbol',
        withExtra(
            {
                ...commonAttrs(c),
                'ovd:type': 'component',
                'ovd:variant': c.variant,
                'ovd:clip': c.clip ? undefined : 'false',
                ...layoutAttrs(c.layout),
                viewBox: `0 0 ${fmtNum(c.width)} ${fmtNum(c.height)}`,
                width: fmtNum(c.width),
                height: fmtNum(c.height),
                overflow: c.clip ? undefined : 'visible',
            },
            c.extra,
        ),
        [...meta(c), ...frameBody(c, false), ...c.children.map(writeNode), ...c.extraChildren],
    );
}

function setSymbol(s: ComponentSet): XmlElement {
    if (!s.isSet) return componentSymbol(s.variants[0]!);
    return el(
        'symbol',
        {
            ...s.extra,
            id: s.id,
            'ovd:type': 'component-set',
            'ovd:name': s.name,
            'ovd:props': Object.keys(s.props).length ? JSON.stringify(s.props) : undefined,
            'ovd:default': s.defaultVariant,
        },
        s.variants.map(componentSymbol),
    );
}

export function componentFileToXml(file: ComponentFile, opts: WriteOptions = {}): XmlElement {
    return el(
        'svg',
        {
            ...file.extra,
            xmlns: SVG_NS,
            'xmlns:ovd': OVD_NS,
            'ovd:version': OVD_VERSION,
            'ovd:type': 'library',
            'ovd:name': file.name,
        },
        [
            ...styleBlock(opts.tokenCss),
            ...file.extraChildren,
            el('defs', {}, file.sets.map(setSymbol)),
        ],
    );
}

export function writeComponentFile(file: ComponentFile, opts: WriteOptions = {}): string {
    return serializeXml(componentFileToXml(file, opts));
}
