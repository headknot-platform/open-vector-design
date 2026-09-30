/**
 * Creation tools: frame, rectangle, ellipse, line, text (drag or click) and the pen. New layers go
 * into the deepest frame under the pointer, as in Figma. Each creation is one undo step.
 */
import {
    type AnyNode,
    type FrameNode,
    type PathCmd,
    type SceneNode,
    ID_PREFIX,
    childrenOf,
    collectIds,
    createFrame,
    createShape,
    createText,
    findNode,
    locate,
    mapPath,
    newId,
    pathBounds,
    relayoutText,
    serializePath,
} from '@workspace/ovd-core';
import { type ReactNode, useEffect, useState } from 'react';
import { docRoots } from '../lib/doc';
import { type Point, absOrigin, absRect, rectContains } from '../lib/geometry';
import { canvasMeasure } from '../lib/measure';
import { type Tool, editor, useViewport } from '../state/store';

export interface CreationTool {
    down(p: Point, e: React.PointerEvent): void;
    move(p: Point, e: React.PointerEvent): void;
    up(p: Point, e: React.PointerEvent): void;
    hover(p: Point): void;
    preview: ReactNode;
}

const DEFAULT_SIZE: Partial<Record<Tool, [number, number]>> = {
    frame: [100, 100],
    rect: [100, 100],
    ellipse: [100, 100],
    line: [100, 0],
};

/** The deepest frame (or component variant) containing the point; null = top level. */
export function containerAt(roots: AnyNode[], p: Point, exclude?: string): AnyNode | null {
    let best: AnyNode | null = null;
    const visit = (list: AnyNode[]) => {
        for (const n of list) {
            if (n.id === exclude || n.hidden) continue;
            if (
                (n.type === 'frame' || n.type === 'component') &&
                rectContains(absRect(roots, n.id)!, p)
            ) {
                best = n;
                const kids = childrenOf(n);
                if (kids) visit(kids);
            }
        }
    };
    visit(roots);
    return best;
}

function toolNode(tool: Tool, id: string): SceneNode | null {
    switch (tool) {
        case 'frame':
            return createFrame(id, { name: 'Frame' });
        case 'rect':
            return createShape(id, 'rect');
        case 'ellipse':
            return createShape(id, 'ellipse');
        case 'line':
            return createShape(id, 'line');
        default:
            return null;
    }
}

function prefixFor(tool: Tool): string {
    return tool === 'rect' ? ID_PREFIX['rect']! : (ID_PREFIX[tool] ?? 'n');
}

// ---------------------------------------------------------------------------------------------

interface Drag {
    start: Point;
    id: string;
    parentOrigin: Point;
    moved: boolean;
}

interface PenPoint {
    x: number;
    y: number;
    /** Outgoing handle, relative to the point (the incoming one mirrors it). */
    hx: number;
    hy: number;
}

export function useCreationTool(): CreationTool {
    const vp = useViewport();
    const [drag, setDrag] = useState<Drag | null>(null);
    const [pen, setPen] = useState<PenPoint[]>([]);
    const [penDragging, setPenDragging] = useState(false);
    const [cursor, setCursor] = useState<Point | null>(null);

    const place = (p: Point, node: SceneNode): { id: string; origin: Point } | null => {
        const s = editor();
        if (!s.project || !s.doc) return null;
        const roots = docRoots(s.project, s.doc);
        let parent = containerAt(roots, p);
        if (!parent && s.doc.kind === 'component') parent = roots[0] ?? null;
        const origin = parent ? absOrigin(roots, parent.id) : { x: 0, y: 0 };
        const po = parent ? { x: origin.x + parent.x, y: origin.y + parent.y } : { x: 0, y: 0 };
        node.x = Math.round(p.x - po.x);
        node.y = Math.round(p.y - po.y);
        s.update((d) => {
            const rs = docRoots(d, s.doc);
            const list = parent ? childrenOf(findNode(rs, parent.id)!)! : (rs as SceneNode[]);
            node.id = newId(node.id, collectIds(rs));
            list.push(node);
        });
        return { id: node.id, origin: po };
    };

    // -----------------------------------------------------------------------------------------
    // Pen

    const finishPen = (close: boolean) => {
        const pts = pen;
        {
            if (pts.length >= 2) {
                const cmds: PathCmd[] = [{ c: 'M', x: pts[0]!.x, y: pts[0]!.y }];
                const seg = (a: PenPoint, b: PenPoint) => {
                    if (!a.hx && !a.hy && !b.hx && !b.hy) cmds.push({ c: 'L', x: b.x, y: b.y });
                    else
                        cmds.push({
                            c: 'C',
                            x1: a.x + a.hx,
                            y1: a.y + a.hy,
                            x2: b.x - b.hx,
                            y2: b.y - b.hy,
                            x: b.x,
                            y: b.y,
                        });
                };
                for (let i = 1; i < pts.length; i++) seg(pts[i - 1]!, pts[i]!);
                if (close) {
                    seg(pts[pts.length - 1]!, pts[0]!);
                    cmds.push({ c: 'Z' });
                }
                const b = pathBounds(cmds);
                const node = createShape('p', 'path', {
                    name: 'Path',
                    width: Math.max(1, b.width),
                    height: Math.max(1, b.height),
                    fill: close ? { color: '#d9d9d9' } : undefined,
                    stroke: { paint: { color: '#1e1e1e' }, width: 2 },
                });
                node.d = serializePath(mapPath(cmds, (x, y) => [x - b.x, y - b.y]));
                const placed = place({ x: b.x, y: b.y }, node);
                // place() rounds the origin; the path data stays relative to the true corner.
                if (placed) editor().select([placed.id]);
            }
        }
        setPen([]);
        setCursor(null);
        editor().setTool('move');
    };

    // -----------------------------------------------------------------------------------------

    const tool = () => editor().tool;

    return {
        down(p, e) {
            const t = tool();
            if (t === 'pen') {
                const first = pen[0];
                if (
                    first &&
                    pen.length > 2 &&
                    Math.hypot(first.x - p.x, first.y - p.y) * vp.zoom < 8
                ) {
                    finishPen(true);
                    return;
                }
                setPen((pts) => [...pts, { x: p.x, y: p.y, hx: 0, hy: 0 }]);
                setPenDragging(true);
                return;
            }
            if (t === 'text') {
                const node = createText(ID_PREFIX['text']!, {
                    content: '',
                    lines: [''],
                    name: 'Text',
                });
                node.height = node.fontSize * node.lineHeight;
                node.width = 1;
                const placed = place(p, node);
                if (placed)
                    setDrag({ start: p, id: placed.id, parentOrigin: placed.origin, moved: false });
                return;
            }
            const node = toolNode(t, prefixFor(t));
            if (!node) return;
            node.width = 0;
            node.height = 0;
            if (e.shiftKey && t === 'line') node.height = 0;
            const placed = place(p, node);
            if (placed)
                setDrag({ start: p, id: placed.id, parentOrigin: placed.origin, moved: false });
        },

        move(p, e) {
            const t = tool();
            if (t === 'pen') {
                if (penDragging) {
                    setPen((pts) => {
                        const last = pts[pts.length - 1];
                        if (!last) return pts;
                        return [
                            ...pts.slice(0, -1),
                            { ...last, hx: p.x - last.x, hy: p.y - last.y },
                        ];
                    });
                }
                setCursor(p);
                return;
            }
            if (!drag) return;
            let dx = p.x - drag.start.x;
            let dy = p.y - drag.start.y;
            if (!drag.moved && Math.hypot(dx, dy) * vp.zoom < 3) return;
            drag.moved = true;
            if (e.shiftKey) {
                if (t === 'line') {
                    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
                    const len = Math.hypot(dx, dy);
                    dx = Math.cos(angle) * len;
                    dy = Math.sin(angle) * len;
                } else {
                    const m = Math.max(Math.abs(dx), Math.abs(dy));
                    dx = Math.sign(dx || 1) * m;
                    dy = Math.sign(dy || 1) * m;
                }
            }
            let x1 = drag.start.x;
            let y1 = drag.start.y;
            if (e.altKey && t !== 'line') {
                x1 -= dx;
                y1 -= dy;
                dx *= 2;
                dy *= 2;
            }
            editor().update(
                (d) => {
                    const n = findNode(docRoots(d, editor().doc), drag.id);
                    if (!n) return;
                    if (n.type === 'shape' && n.kind === 'line') {
                        n.x = Math.round(x1 - drag.parentOrigin.x);
                        n.y = Math.round(y1 - drag.parentOrigin.y);
                        n.width = Math.round(dx);
                        n.height = Math.round(dy);
                        return;
                    }
                    n.x = Math.round(Math.min(x1, x1 + dx) - drag.parentOrigin.x);
                    n.y = Math.round(Math.min(y1, y1 + dy) - drag.parentOrigin.y);
                    n.width = Math.round(Math.abs(dx));
                    n.height = Math.round(Math.abs(dy));
                    if (n.type === 'text') {
                        n.box = 'fixed-width';
                        relayoutText(n, canvasMeasure);
                    }
                },
                { history: false },
            );
        },

        up() {
            const t = tool();
            if (t === 'pen') {
                setPenDragging(false);
                return;
            }
            if (!drag) return;
            const id = drag.id;
            const moved = drag.moved;
            setDrag(null);
            if (!moved && t !== 'text') {
                // A click: default size, centred on the click.
                const [w, h] = DEFAULT_SIZE[t] ?? [100, 100];
                editor().update(
                    (d) => {
                        const n = findNode(docRoots(d, editor().doc), id);
                        if (!n) return;
                        n.x -= Math.round(w / 2);
                        n.y -= Math.round(h / 2);
                        n.width = w;
                        n.height = h;
                    },
                    { history: false },
                );
            }
            editor().select([id]);
            editor().setTool('move');
            if (t === 'text') editor().setEditingText(id);
            else if (t === 'frame') moveOverlappingIntoFrame(id);
        },

        hover(p) {
            if (tool() === 'pen' && pen.length) setCursor(p);
        },

        preview:
            pen.length > 0 ? (
                <PenPreview
                    points={pen}
                    cursor={cursor}
                    zoom={vp.zoom}
                    onFinish={() => finishPen(false)}
                />
            ) : null,
    };
}

function PenPreview({
    points,
    cursor,
    zoom,
    onFinish,
}: {
    points: PenPoint[];
    cursor: Point | null;
    zoom: number;
    onFinish: () => void;
}) {
    // Enter / Escape finish an open path.
    useKeyOnce(['Enter', 'Escape'], onFinish);
    let d = `M${points[0]!.x} ${points[0]!.y}`;
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        d += ` C${a.x + a.hx} ${a.y + a.hy} ${b.x - b.hx} ${b.y - b.hy} ${b.x} ${b.y}`;
    }
    const last = points[points.length - 1]!;
    const sw = 1.5 / zoom;
    return (
        <g pointerEvents="none">
            <path d={d} fill="none" className="stroke-selection" strokeWidth={sw} />
            {cursor && (
                <line
                    x1={last.x}
                    y1={last.y}
                    x2={cursor.x}
                    y2={cursor.y}
                    className="stroke-selection"
                    strokeWidth={sw}
                    strokeDasharray={`${4 / zoom} ${3 / zoom}`}
                />
            )}
            {points.map((p, i) => (
                <g key={i}>
                    {(p.hx || p.hy) && (
                        <line
                            x1={p.x - p.hx}
                            y1={p.y - p.hy}
                            x2={p.x + p.hx}
                            y2={p.y + p.hy}
                            className="stroke-selection"
                            strokeWidth={sw}
                        />
                    )}
                    <rect
                        x={p.x - 3.5 / zoom}
                        y={p.y - 3.5 / zoom}
                        width={7 / zoom}
                        height={7 / zoom}
                        className="fill-background stroke-selection"
                        strokeWidth={sw}
                    />
                </g>
            ))}
        </g>
    );
}

function useKeyOnce(keys: string[], fn: () => void) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (keys.includes(e.key)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                fn();
            }
        };
        window.addEventListener('keydown', onKey, { capture: true });
        return () => window.removeEventListener('keydown', onKey, { capture: true });
    });
}

/** A new top-level frame drawn over existing top-level layers adopts them, as in Figma. */
function moveOverlappingIntoFrame(frameId: string) {
    const s = editor();
    if (!s.project || s.doc?.kind !== 'page') return;
    const roots = docRoots(s.project, s.doc);
    const loc = locate(roots, frameId);
    if (!loc || loc.parent) return;
    const frame = loc.list[loc.index] as FrameNode;
    const fr = absRect(roots, frameId)!;
    const inside = roots.filter((n) => {
        if (n.id === frameId || n.type === 'frame') return false;
        const r = absRect(roots, n.id)!;
        return (
            r.x >= fr.x &&
            r.y >= fr.y &&
            r.x + r.width <= fr.x + fr.width &&
            r.y + r.height <= fr.y + fr.height
        );
    });
    if (!inside.length) return;
    s.update(
        (d) => {
            const rs = docRoots(d, s.doc) as SceneNode[];
            const f = rs.find((n) => n.id === frameId) as FrameNode;
            for (const n of inside) {
                const i = rs.findIndex((x) => x.id === n.id);
                const [moved] = rs.splice(i, 1);
                moved!.x -= frame.x;
                moved!.y -= frame.y;
                f.children.push(moved!);
            }
            // Keep the frame behind what it adopted.
            rs.splice(rs.indexOf(f), 1);
            const firstIdx = Math.min(...inside.map((n) => roots.indexOf(n)));
            const below = rs.filter((x) => roots.indexOf(x) < firstIdx).length;
            rs.splice(below, 0, f);
        },
        { history: false },
    );
}
