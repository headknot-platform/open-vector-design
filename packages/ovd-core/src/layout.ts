/**
 * Layout (spec §6): CSS-flexbox semantics over the model, and constraints for `layout=none` frames.
 *
 * Results are written into the nodes' x / y / width / height, so the file stays a correct static
 * picture; `ovd:*` attributes record the intent and win when the two disagree (§6 rules).
 *
 * A small solver rather than Yoga: v0.1 needs a dozen attributes, and Yoga would add a WASM load.
 */
import {
    type AnyNode,
    type ComponentNode,
    type Dim,
    type FrameNode,
    type GroupNode,
    type SceneNode,
    childrenOf,
} from './model';
import { mapPath, parsePath, serializePath } from './path';
import { type Measure, approxMeasure, relayoutText } from './text';
import { type TokenSet, tokenNumber } from './tokens';

export interface LayoutContext {
    tokens?: TokenSet;
    measure?: Measure;
}

type FlexContainer = FrameNode | ComponentNode;

export function resolveDim(d: Dim, ctx: LayoutContext = {}): number {
    if (d.token && ctx.tokens) return tokenNumber(ctx.tokens, d.token) ?? d.value;
    return d.value;
}

function isFlex(n: AnyNode): n is FlexContainer {
    return (n.type === 'frame' || n.type === 'component') && n.layout.mode === 'flex';
}

function inFlow(n: SceneNode): boolean {
    return !n.hidden && n.position !== 'absolute' && n.type !== 'raw';
}

/** Sets a node's size, keeping dependent geometry (paths, text wrapping) consistent. */
export function resizeNode(n: AnyNode, width: number, height: number, ctx: LayoutContext = {}) {
    const w = Math.max(0, width);
    const h = Math.max(0, height);
    if (n.type === 'shape' && n.kind === 'path' && n.d && (n.width !== w || n.height !== h)) {
        const sx = n.width === 0 ? 1 : w / n.width;
        const sy = n.height === 0 ? 1 : h / n.height;
        n.d = serializePath(mapPath(parsePath(n.d), (x, y) => [x * sx, y * sy]));
    }
    if (n.type === 'text') {
        const widthChanged = n.width !== w;
        n.width = w;
        if (n.box === 'fixed') n.height = h;
        if (widthChanged && n.box !== 'auto-width') relayoutText(n, ctx.measure ?? approxMeasure);
        if (n.box === 'auto-width') n.height = h;
        return;
    }
    n.width = w;
    n.height = h;
}

// ---------------------------------------------------------------------------------------------
// Flex
// ---------------------------------------------------------------------------------------------

interface Item {
    node: SceneNode;
    main: number;
    cross: number;
    grow: boolean;
}

function layoutFlex(c: FlexContainer, ctx: LayoutContext): void {
    const row = c.layout.direction === 'row';
    const [pt, pr, pb, pl] = c.layout.padding.map((d) => resolveDim(d, ctx)) as [
        number,
        number,
        number,
        number,
    ];
    const gap = resolveDim(c.layout.gap, ctx);
    const kids = c.children.filter(inFlow);

    const mainOf = (n: SceneNode) => (row ? n.width : n.height);
    const crossOf = (n: SceneNode) => (row ? n.height : n.width);
    const sizingMain = (n: SceneNode) => (row ? n.sizing?.h : n.sizing?.v) ?? 'fixed';
    const sizingCross = (n: SceneNode) => (row ? n.sizing?.v : n.sizing?.h) ?? 'fixed';
    const hugMain = (row ? c.sizing?.h : c.sizing?.v) === 'hug';
    const hugCross = (row ? c.sizing?.v : c.sizing?.h) === 'hug';

    // Children that are containers themselves compute their hug size first.
    for (const k of kids) layoutNode(k, ctx);

    const padMainStart = row ? pl : pt;
    const padMainEnd = row ? pr : pb;
    const padCrossStart = row ? pt : pl;
    const padCrossEnd = row ? pb : pr;

    const items: Item[] = kids.map((node) => ({
        node,
        main: mainOf(node),
        cross: crossOf(node),
        grow: sizingMain(node) === 'fill' && !hugMain,
    }));

    let innerMain = (row ? c.width : c.height) - padMainStart - padMainEnd;

    // Break into lines when wrapping.
    const lines: Item[][] = [];
    if (c.layout.wrap && !hugMain) {
        let line: Item[] = [];
        let used = 0;
        for (const it of items) {
            const size = it.grow ? 0 : it.main;
            if (line.length && used + gap + size > innerMain) {
                lines.push(line);
                line = [];
                used = 0;
            }
            used += (line.length ? gap : 0) + size;
            line.push(it);
        }
        if (line.length) lines.push(line);
    } else {
        lines.push(items);
    }

    if (hugMain) {
        innerMain = Math.max(
            0,
            ...lines.map(
                (l) => l.reduce((s, it) => s + it.main, 0) + gap * Math.max(0, l.length - 1),
            ),
        );
        if (row) c.width = innerMain + padMainStart + padMainEnd;
        else c.height = innerMain + padMainStart + padMainEnd;
    }

    const lineCross = lines.map((l) => Math.max(0, ...l.map((it) => it.cross)));
    if (hugCross) {
        const total = lineCross.reduce((s, v) => s + v, 0) + gap * Math.max(0, lines.length - 1);
        if (row) c.height = total + padCrossStart + padCrossEnd;
        else c.width = total + padCrossStart + padCrossEnd;
    }
    const innerCross = (row ? c.height : c.width) - padCrossStart - padCrossEnd;

    let crossCursor = padCrossStart;
    lines.forEach((line, li) => {
        const lineSize = lines.length === 1 ? innerCross : lineCross[li]!;
        const fixed = line.reduce((s, it) => s + (it.grow ? 0 : it.main), 0);
        const gaps = gap * Math.max(0, line.length - 1);
        const growers = line.filter((it) => it.grow).length;
        const free = innerMain - fixed - gaps;
        const share = growers ? Math.max(0, free) / growers : 0;
        for (const it of line) if (it.grow) it.main = share;

        const used = line.reduce((s, it) => s + it.main, 0) + gaps;
        const rest = innerMain - used;
        let cursor = padMainStart;
        let between = gap;
        const j = c.layout.justify;
        if (!growers) {
            if (j === 'center') cursor += rest / 2;
            else if (j === 'end') cursor += rest;
            else if (j === 'space-between' && line.length > 1)
                between = gap + rest / (line.length - 1);
        }

        for (const it of line) {
            const n = it.node;
            const stretch =
                sizingCross(n) === 'fill' ||
                (c.layout.align === 'stretch' && sizingCross(n) !== 'hug');
            const cross = stretch ? lineSize : it.cross;
            let offset = 0;
            if (!stretch) {
                if (c.layout.align === 'center') offset = (lineSize - cross) / 2;
                else if (c.layout.align === 'end') offset = lineSize - cross;
            }
            const before = { w: n.width, h: n.height };
            if (row) {
                resizeNode(n, it.main, cross, ctx);
                n.x = cursor;
                n.y = crossCursor + offset;
            } else {
                resizeNode(n, cross, it.main, ctx);
                n.x = crossCursor + offset;
                n.y = cursor;
            }
            // A child resized by fill/stretch lays its own children out again at the new size.
            if (before.w !== n.width || before.h !== n.height) {
                if (n.type === 'frame') {
                    if (n.layout.mode === 'flex') layoutFlex(n, ctx);
                    else applyConstraints(n, before.w, before.h, ctx);
                }
            }
            cursor += it.main + between;
        }
        crossCursor += lineSize + gap;
    });
}

/** Lays out a node and everything inside it. Mutates. */
export function layoutNode(n: AnyNode, ctx: LayoutContext = {}): void {
    if (isFlex(n)) {
        layoutFlex(n, ctx);
        // Absolute children still lay out their own content.
        for (const k of n.children) if (!inFlow(k)) layoutNode(k, ctx);
        return;
    }
    const kids = childrenOf(n);
    if (!kids) return;
    for (const k of kids) layoutNode(k, ctx);
    if (n.type === 'group') fitGroup(n);
}

export function layoutAll(nodes: AnyNode[], ctx: LayoutContext = {}): void {
    for (const n of nodes) layoutNode(n, ctx);
}

// ---------------------------------------------------------------------------------------------
// Constraints and groups
// ---------------------------------------------------------------------------------------------

/** Re-positions children of a `layout=none` container after it changed size (spec §6). Mutates. */
export function applyConstraints(
    c: FrameNode | ComponentNode,
    oldWidth: number,
    oldHeight: number,
    ctx: LayoutContext = {},
): void {
    if (c.layout.mode === 'flex') {
        layoutFlex(c, ctx);
        return;
    }
    const dw = c.width - oldWidth;
    const dh = c.height - oldHeight;
    const sx = oldWidth === 0 ? 1 : c.width / oldWidth;
    const sy = oldHeight === 0 ? 1 : c.height / oldHeight;
    if (dw === 0 && dh === 0) return;
    for (const k of c.children) {
        if (k.type === 'raw') continue;
        const h = k.constraints?.h ?? 'left';
        const v = k.constraints?.v ?? 'top';
        let { x, y, width, height } = k;
        if (h === 'right') x += dw;
        else if (h === 'center') x += dw / 2;
        else if (h === 'left-right') width += dw;
        else if (h === 'scale') {
            x *= sx;
            width *= sx;
        }
        if (v === 'bottom') y += dh;
        else if (v === 'center') y += dh / 2;
        else if (v === 'top-bottom') height += dh;
        else if (v === 'scale') {
            y *= sy;
            height *= sy;
        }
        const before = { w: k.width, h: k.height };
        k.x = x;
        k.y = y;
        resizeNode(k, width, height, ctx);
        if (k.type === 'frame' && (before.w !== k.width || before.h !== k.height)) {
            applyConstraints(k, before.w, before.h, ctx);
        }
    }
}

/** Keeps a group's box equal to its children's bounds, keeping children visually in place. */
export function fitGroup(g: GroupNode): void {
    const kids = g.children.filter((k) => k.type !== 'raw');
    if (!kids.length) return;
    const minX = Math.min(...kids.map((k) => k.x));
    const minY = Math.min(...kids.map((k) => k.y));
    const maxX = Math.max(...kids.map((k) => k.x + k.width));
    const maxY = Math.max(...kids.map((k) => k.y + k.height));
    if (minX !== 0 || minY !== 0) {
        for (const k of kids) {
            k.x -= minX;
            k.y -= minY;
        }
        g.x += minX;
        g.y += minY;
    }
    g.width = maxX - minX;
    g.height = maxY - minY;
}
