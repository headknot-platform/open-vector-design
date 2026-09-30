import { type AnyNode, ancestorsOf, findNode } from '@workspace/ovd-core';

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface Point {
    x: number;
    y: number;
}

export function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
    return {
        x: Math.min(x1, x2),
        y: Math.min(y1, y2),
        width: Math.abs(x2 - x1),
        height: Math.abs(y2 - y1),
    };
}

/** Lines have a signed width/height (x2 − x1); boxes are always normalised for display. */
export function nodeBox(n: Pick<AnyNode, 'x' | 'y' | 'width' | 'height'>): Rect {
    return normRect(n.x, n.y, n.x + n.width, n.y + n.height);
}

/** The node's origin in document space: its own x/y plus every ancestor container's translation. */
export function absOrigin(roots: AnyNode[], id: string): Point {
    let x = 0;
    let y = 0;
    for (const a of ancestorsOf(roots, id)) {
        x += a.x;
        y += a.y;
    }
    return { x, y };
}

export function absRect(roots: AnyNode[], id: string): Rect | undefined {
    const n = findNode(roots, id);
    if (!n) return undefined;
    const o = absOrigin(roots, id);
    const b = nodeBox(n);
    return { x: b.x + o.x, y: b.y + o.y, width: b.width, height: b.height };
}

export function unionRects(rects: Rect[]): Rect | undefined {
    if (!rects.length) return undefined;
    const x1 = Math.min(...rects.map((r) => r.x));
    const y1 = Math.min(...rects.map((r) => r.y));
    const x2 = Math.max(...rects.map((r) => r.x + r.width));
    const y2 = Math.max(...rects.map((r) => r.y + r.height));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
    return (
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
    );
}

export function rectContains(outer: Rect, p: Point): boolean {
    return (
        p.x >= outer.x &&
        p.x <= outer.x + outer.width &&
        p.y >= outer.y &&
        p.y <= outer.y + outer.height
    );
}
