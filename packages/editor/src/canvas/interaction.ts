/** Pure helpers for canvas gestures: what a click selects, and where a moving box snaps. */
import { type AnyNode, ancestorsOf, childrenOf, findNode, locate } from '@workspace/ovd-core';
import { type Rect, absRect } from '../lib/geometry';
import type { Guide } from '../state/store';

// ---------------------------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------------------------

/**
 * Figma-like selection rules for a click on `hitId` (the innermost element under the pointer):
 * - a top-level frame is "transparent": clicking inside it selects its direct child;
 * - once something is selected, its siblings are picked at the same depth (so after entering a
 *   group with a double-click, clicks stay inside it);
 * - `deep` (⌘/Ctrl-click) picks the innermost layer.
 * Locked and hidden layers are never picked.
 */
export function pickTarget(
    roots: AnyNode[],
    hitId: string,
    selection: string[],
    opts: { deep?: boolean } = {},
): string | null {
    const hit = findNode(roots, hitId);
    if (!hit) return null;
    const chain = [...ancestorsOf(roots, hitId), hit].filter((n) => !n.hidden);
    const pickable = (n: AnyNode) => !n.locked;
    if (opts.deep) return [...chain].reverse().find(pickable)?.id ?? null;

    const contextParents = new Set(
        selection.map((id) => locate(roots, id)?.parent?.id).filter(Boolean) as string[],
    );
    for (let i = chain.length - 1; i >= 1; i--) {
        if (contextParents.has(chain[i - 1]!.id) && pickable(chain[i]!)) return chain[i]!.id;
    }
    const top = chain[0]!;
    const topIsTransparent = top.type === 'frame' || top.type === 'component';
    const candidate = topIsTransparent && chain.length > 1 ? chain[1]! : top;
    if (pickable(candidate)) return candidate.id;
    return pickable(top) ? top.id : null;
}

/** The next layer down the chain from `selectedId` towards `hitId` (double-click to enter). */
export function pickDeeper(roots: AnyNode[], selectedId: string, hitId: string): string | null {
    const hit = findNode(roots, hitId);
    if (!hit) return null;
    const chain = [...ancestorsOf(roots, hitId), hit];
    const i = chain.findIndex((n) => n.id === selectedId);
    if (i < 0 || i === chain.length - 1) return null;
    return chain[i + 1]!.id;
}

// ---------------------------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------------------------

export interface SnapLine {
    v: number;
    from: number;
    to: number;
}

export interface SnapTargets {
    xs: SnapLine[];
    ys: SnapLine[];
}

function addRect(t: SnapTargets, r: Rect) {
    for (const x of [r.x, r.x + r.width / 2, r.x + r.width])
        t.xs.push({ v: x, from: r.y, to: r.y + r.height });
    for (const y of [r.y, r.y + r.height / 2, r.y + r.height])
        t.ys.push({ v: y, from: r.x, to: r.x + r.width });
}

/** Edges and centres of the moving nodes' siblings, their parents, and every top-level node. */
export function collectSnapTargets(roots: AnyNode[], movingIds: string[]): SnapTargets {
    const t: SnapTargets = { xs: [], ys: [] };
    const moving = new Set(movingIds);
    const seen = new Set<string>();
    const add = (n: AnyNode) => {
        if (moving.has(n.id) || seen.has(n.id) || n.hidden || n.type === 'raw') return;
        seen.add(n.id);
        const r = absRect(roots, n.id);
        if (r) addRect(t, r);
    };
    for (const id of movingIds) {
        const loc = locate(roots, id);
        if (!loc) continue;
        loc.list.forEach(add);
        if (loc.parent) add(loc.parent);
    }
    roots.forEach(add);
    // Children of top-level frames too — the usual alignment targets.
    for (const r of roots) childrenOf(r)?.forEach(add);
    return t;
}

function nearest(values: number[], lines: SnapLine[], threshold: number) {
    let best: { delta: number; line: SnapLine } | null = null;
    for (const v of values) {
        for (const line of lines) {
            const delta = line.v - v;
            if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
                best = { delta, line };
            }
        }
    }
    return best;
}

export function snapMove(
    box: Rect,
    targets: SnapTargets,
    threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
    const bx = nearest([box.x, box.x + box.width / 2, box.x + box.width], targets.xs, threshold);
    const by = nearest([box.y, box.y + box.height / 2, box.y + box.height], targets.ys, threshold);
    const dx = bx?.delta ?? 0;
    const dy = by?.delta ?? 0;
    const guides: Guide[] = [];
    if (bx) {
        const y1 = Math.min(bx.line.from, box.y + dy);
        const y2 = Math.max(bx.line.to, box.y + dy + box.height);
        guides.push({ axis: 'x', at: bx.line.v, from: y1, to: y2 });
    }
    if (by) {
        const x1 = Math.min(by.line.from, box.x + dx);
        const x2 = Math.max(by.line.to, box.x + dx + box.width);
        guides.push({ axis: 'y', at: by.line.v, from: x1, to: x2 });
    }
    return { dx, dy, guides };
}

/** Snaps one edge coordinate (used while resizing). */
export function snapValue(
    v: number,
    axis: 'x' | 'y',
    targets: SnapTargets,
    threshold: number,
    span: [number, number],
): { v: number; guide?: Guide } {
    const hit = nearest([v], axis === 'x' ? targets.xs : targets.ys, threshold);
    if (!hit) return { v };
    return {
        v: hit.line.v,
        guide: {
            axis,
            at: hit.line.v,
            from: Math.min(hit.line.from, span[0]),
            to: Math.max(hit.line.to, span[1]),
        },
    };
}
