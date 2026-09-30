/**
 * The infinite canvas: renders the active document and turns pointer input into edits.
 * Gestures are a small state machine held in a ref; every gesture is one undo step.
 */
import {
    type AnyNode,
    type FrameNode,
    type SceneNode,
    applyConstraints,
    findNode,
    locate,
    resizeNode,
} from '@workspace/ovd-core';
import { type Draft } from 'immer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useHost } from '../host';
import { docRoots } from '../lib/doc';
import {
    type Point,
    type Rect,
    absOrigin,
    absRect,
    normRect,
    rectContains,
    rectsIntersect,
    unionRects,
} from '../lib/geometry';
import { canvasMeasure } from '../lib/measure';
import { canvasSize, toWorld, zoomAround } from '../lib/viewport';
import { insertImageFiles } from '../lib/images';
import { COMPONENT_MIME } from '../panels/AssetsPanel';
import { insertInstance } from '../state/components';
import { moveNode, zoomToFit } from '../state/actions';
import { flexParentOf } from '../state/layout';
import { editor, tokenSetFor, useDocRoots, useEditor, useViewport } from '../state/store';
import { useCreationTool } from './creation';
import {
    type SnapTargets,
    collectSnapTargets,
    pickDeeper,
    pickTarget,
    snapMove,
    snapValue,
} from './interaction';
import { FileContext, NodeView, useTokenVars } from './NodeView';
import { Overlay, type Handle } from './Overlay';
import { TextEditor } from './TextEditor';

type Gesture =
    | { kind: 'pan'; start: Point; vp: { x: number; y: number; zoom: number } }
    | { kind: 'marquee'; start: Point; base: string[]; additive: boolean }
    | {
          kind: 'move';
          start: Point;
          ids: string[];
          origins: Map<string, Point>;
          box: Rect;
          targets: SnapTargets;
          started: boolean;
      }
    | {
          kind: 'resize';
          handle: Handle;
          start: Point;
          box: Rect;
          items: { id: string; abs: Rect; snapshot: AnyNode }[];
          targets: SnapTargets;
          started: boolean;
      }
    | {
          kind: 'reorder';
          start: Point;
          ids: string[];
          parentId: string;
          row: boolean;
          started: boolean;
      }
    | { kind: 'tool' };

const SNAP_PX = 6;
const DRAG_PX = 3;

function isTypingTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

export function Canvas() {
    const ref = useRef<HTMLDivElement>(null);
    const vp = useViewport();
    const roots = useDocRoots();
    const doc = useEditor((s) => s.doc);
    const tool = useEditor((s) => s.tool);
    const host = useHost();
    const hasViewport = useEditor((s) => !!(s.doc && s.viewports[s.doc.file]));
    const gesture = useRef<Gesture | null>(null);
    const [marquee, setMarquee] = useState<Rect | null>(null);
    const [space, setSpace] = useState(false);
    const creation = useCreationTool();

    // Token CSS variables for the previewed theme, set on the world group.
    const cssVars = useTokenVars();

    // Track canvas size; fit the document the first time it is shown.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const ro = new ResizeObserver(() => {
            canvasSize.width = el.clientWidth;
            canvasSize.height = el.clientHeight;
        });
        ro.observe(el);
        canvasSize.width = el.clientWidth;
        canvasSize.height = el.clientHeight;
        return () => ro.disconnect();
    }, []);
    useEffect(() => {
        if (doc && !hasViewport) zoomToFit();
    }, [doc, hasViewport]);

    // Space = temporary hand tool.
    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.code === 'Space' && !isTypingTarget(e.target) && !editor().editingText) {
                e.preventDefault();
                setSpace(true);
            }
        };
        const up = (e: KeyboardEvent) => {
            if (e.code === 'Space') setSpace(false);
        };
        window.addEventListener('keydown', down);
        window.addEventListener('keyup', up);
        return () => {
            window.removeEventListener('keydown', down);
            window.removeEventListener('keyup', up);
        };
    }, []);

    // Wheel: pinch / ctrl+wheel zooms about the pointer, plain wheel pans. Non-passive to block page zoom.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const s = editor();
            const current = (s.doc && s.viewports[s.doc.file]) || { x: 80, y: 80, zoom: 1 };
            const r = el.getBoundingClientRect();
            const p = { x: e.clientX - r.left, y: e.clientY - r.top };
            if (e.ctrlKey || e.metaKey) {
                const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.01));
                s.setViewport(zoomAround(current, current.zoom * factor, p));
            } else {
                const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
                const dy = e.shiftKey && !e.deltaX ? 0 : e.deltaY;
                s.setViewport({ ...current, x: current.x - dx, y: current.y - dy });
            }
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const screenPoint = useCallback((e: { clientX: number; clientY: number }): Point => {
        const r = ref.current!.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }, []);

    const hitId = (target: EventTarget | null): string | null =>
        (target as Element | null)?.closest?.('[data-id]')?.getAttribute('data-id') ?? null;

    // -----------------------------------------------------------------------------------------

    const startMove = (start: Point, ids: string[]) => {
        const s = editor();
        const rs = docRoots(s.project!, s.doc);
        const movable = ids.filter((id) => {
            const n = findNode(rs, id);
            return n && !n.locked;
        });
        if (!movable.length) return;
        // Children of an auto-layout frame reorder instead of moving freely (spec §6).
        const flex = flexParentOf(rs, movable);
        if (flex && movable.every((id) => findNode(rs, id)?.position !== 'absolute')) {
            gesture.current = {
                kind: 'reorder',
                start,
                ids: movable,
                parentId: flex.id,
                row: flex.layout.direction === 'row',
                started: false,
            };
            return;
        }
        const origins = new Map<string, Point>();
        for (const id of movable) {
            const n = findNode(rs, id)!;
            origins.set(id, { x: n.x, y: n.y });
        }
        const box = unionRects(movable.map((id) => absRect(rs, id)!).filter(Boolean))!;
        gesture.current = {
            kind: 'move',
            start,
            ids: movable,
            origins,
            box,
            targets: collectSnapTargets(rs, movable),
            started: false,
        };
    };

    const onPointerDown = (e: React.PointerEvent) => {
        if (isTypingTarget(e.target)) return;
        const s = editor();
        if (!s.project || !s.doc) return;
        ref.current!.setPointerCapture(e.pointerId);
        const sp = screenPoint(e);
        const wp = toWorld(vp, sp);

        if (e.button === 1 || space || tool === 'hand') {
            gesture.current = { kind: 'pan', start: sp, vp };
            return;
        }
        if (e.button !== 0) return;
        if (s.editingText) s.setEditingText(null);

        const handle = (e.target as Element)
            .closest?.('[data-handle]')
            ?.getAttribute('data-handle') as Handle | null;
        if (handle && s.selection.length) {
            const rs = docRoots(s.project, s.doc);
            const items = s.selection
                .map((id) => ({
                    id,
                    abs: absRect(rs, id)!,
                    snapshot: structuredClone(findNode(rs, id)!),
                }))
                .filter((it) => it.abs && !it.snapshot.locked);
            const box = unionRects(items.map((i) => i.abs));
            if (box) {
                gesture.current = {
                    kind: 'resize',
                    handle,
                    start: wp,
                    box,
                    items,
                    targets: collectSnapTargets(rs, s.selection),
                    started: false,
                };
            }
            return;
        }

        const hostTool = host.tools?.find((t) => t.id === tool);
        if (hostTool) {
            hostTool.onPointerDown({
                world: wp,
                hit: hitId(e.target),
                file: s.doc.file,
                roots: docRoots(s.project, s.doc) as AnyNode[],
                event: e,
            });
            return;
        }

        if (tool !== 'move') {
            gesture.current = { kind: 'tool' };
            creation.down(wp, e);
            return;
        }

        const labelId = (e.target as Element)
            .closest?.('[data-frame-label]')
            ?.getAttribute('data-frame-label');
        const hit = labelId ?? hitId(e.target);
        const rs = docRoots(s.project, s.doc);
        const picked = hit
            ? (labelId ?? pickTarget(rs, hit, s.selection, { deep: e.metaKey || e.ctrlKey }))
            : null;

        if (picked) {
            if (e.shiftKey) {
                s.select([picked], 'toggle');
                return;
            }
            const inSelection = s.selection.includes(picked);
            if (!inSelection) s.select([picked]);
            startMove(wp, inSelection ? s.selection : [picked]);
            return;
        }
        if (!e.shiftKey) s.select([]);
        gesture.current = {
            kind: 'marquee',
            start: wp,
            base: e.shiftKey ? s.selection : [],
            additive: e.shiftKey,
        };
    };

    const onPointerMove = (e: React.PointerEvent) => {
        const s = editor();
        const g = gesture.current;
        const sp = screenPoint(e);
        const wp = toWorld(vp, sp);
        if (!g) {
            if (tool === 'move' && !space && s.project && s.doc) {
                const hit = hitId(e.target);
                s.setHover(hit ? pickTarget(docRoots(s.project, s.doc), hit, s.selection) : null);
            }
            creation.hover(wp);
            return;
        }
        if (g.kind === 'pan') {
            s.setViewport({
                ...g.vp,
                x: g.vp.x + sp.x - g.start.x * 1,
                y: g.vp.y + sp.y - g.start.y,
            });
            return;
        }
        if (g.kind === 'tool') {
            creation.move(wp, e);
            return;
        }
        if (g.kind === 'marquee') {
            const r = normRect(g.start.x, g.start.y, wp.x, wp.y);
            setMarquee(r);
            const rs = docRoots(s.project!, s.doc);
            const hits = rs
                .filter((n) => !n.locked && !n.hidden && rectsIntersect(r, absRect(rs, n.id)!))
                .map((n) => n.id);
            s.select(g.additive ? [...new Set([...g.base, ...hits])] : hits);
            return;
        }
        if (g.kind === 'reorder') {
            if (!g.started) {
                if (Math.hypot(wp.x - g.start.x, wp.y - g.start.y) * vp.zoom < DRAG_PX) return;
                g.started = true;
                s.checkpoint();
            }
            s.update(
                (d) => {
                    const rs = docRoots(d, s.doc);
                    const parent = findNode(rs, g.parentId) as FrameNode | undefined;
                    if (!parent) return;
                    const o = absOrigin(rs, g.parentId);
                    const local = g.row ? wp.x - o.x - parent.x : wp.y - o.y - parent.y;
                    const moving = parent.children.filter((c) => g.ids.includes(c.id));
                    const rest = parent.children.filter((c) => !g.ids.includes(c.id));
                    const flow = rest.filter((c) => c.position !== 'absolute' && !c.hidden);
                    const before = flow.filter(
                        (c) => (g.row ? c.x + c.width / 2 : c.y + c.height / 2) < local,
                    );
                    const anchor = before[before.length - 1];
                    const at = anchor
                        ? rest.indexOf(anchor) + 1
                        : rest.findIndex((c) => flow.includes(c));
                    const next = [...rest];
                    next.splice(at < 0 ? rest.length : at, 0, ...moving);
                    if (next.some((c, i) => c !== parent.children[i])) parent.children = next;
                },
                { history: false },
            );
            return;
        }
        const threshold = SNAP_PX / vp.zoom;
        const noSnap = e.metaKey || e.ctrlKey;

        if (g.kind === 'move') {
            let dx = wp.x - g.start.x;
            let dy = wp.y - g.start.y;
            if (!g.started) {
                if (Math.hypot(dx, dy) * vp.zoom < DRAG_PX) return;
                g.started = true;
                s.checkpoint();
            }
            if (e.shiftKey) {
                if (Math.abs(dx) > Math.abs(dy)) dy = 0;
                else dx = 0;
            }
            let guides: ReturnType<typeof snapMove>['guides'] = [];
            if (!noSnap) {
                const snap = snapMove(
                    { ...g.box, x: g.box.x + dx, y: g.box.y + dy },
                    g.targets,
                    threshold,
                );
                dx += snap.dx;
                dy += snap.dy;
                guides = snap.guides;
            }
            s.setGuides(guides);
            s.update(
                (d) => {
                    const rs = docRoots(d, s.doc);
                    for (const [id, o] of g.origins) {
                        const n = findNode(rs, id);
                        if (n) {
                            n.x = Math.round(o.x + dx);
                            n.y = Math.round(o.y + dy);
                        }
                    }
                },
                { history: false },
            );
            return;
        }

        if (g.kind === 'resize') {
            if (!g.started) {
                if (Math.hypot(wp.x - g.start.x, wp.y - g.start.y) * vp.zoom < DRAG_PX) return;
                g.started = true;
                s.checkpoint();
            }
            const { box, handle } = g;
            let x1 = box.x;
            let y1 = box.y;
            let x2 = box.x + box.width;
            let y2 = box.y + box.height;
            const guides: ReturnType<typeof snapMove>['guides'] = [];
            const snapX = (v: number) => {
                if (noSnap) return v;
                const r = snapValue(v, 'x', g.targets, threshold, [y1, y2]);
                if (r.guide) guides.push(r.guide);
                return r.v;
            };
            const snapY = (v: number) => {
                if (noSnap) return v;
                const r = snapValue(v, 'y', g.targets, threshold, [x1, x2]);
                if (r.guide) guides.push(r.guide);
                return r.v;
            };
            const dx = wp.x - g.start.x;
            const dy = wp.y - g.start.y;
            if (handle.includes('w')) x1 = snapX(box.x + dx);
            if (handle.includes('e')) x2 = snapX(box.x + box.width + dx);
            if (handle.includes('n')) y1 = snapY(box.y + dy);
            if (handle.includes('s')) y2 = snapY(box.y + box.height + dy);
            if (e.altKey) {
                const cx = box.x + box.width / 2;
                const cy = box.y + box.height / 2;
                if (handle.includes('w')) x2 = 2 * cx - x1;
                if (handle.includes('e')) x1 = 2 * cx - x2;
                if (handle.includes('n')) y2 = 2 * cy - y1;
                if (handle.includes('s')) y1 = 2 * cy - y2;
            }
            if (e.shiftKey && box.width && box.height) {
                const ratio = box.width / box.height;
                const w = x2 - x1;
                const h = y2 - y1;
                if (handle === 'n' || handle === 's') {
                    const nw = h * ratio;
                    x1 = box.x + (box.width - nw) / 2;
                    x2 = x1 + nw;
                } else if (handle === 'e' || handle === 'w') {
                    const nh = w / ratio;
                    y1 = box.y + (box.height - nh) / 2;
                    y2 = y1 + nh;
                } else if (Math.abs(w / box.width) > Math.abs(h / box.height)) {
                    const nh = Math.abs(w) / ratio;
                    if (handle.includes('n')) y1 = y2 - nh;
                    else y2 = y1 + nh;
                } else {
                    const nw = Math.abs(h) * ratio;
                    if (handle.includes('w')) x1 = x2 - nw;
                    else x2 = x1 + nw;
                }
            }
            s.setGuides(guides);
            const nb = normRect(x1, y1, x2, y2);
            const sx = box.width ? nb.width / box.width : 1;
            const sy = box.height ? nb.height / box.height : 1;
            const mapX = (x: number) => Math.round(nb.x + (x - box.x) * sx);
            const mapY = (y: number) => Math.round(nb.y + (y - box.y) * sy);
            const ctx = { tokens: tokenSetFor(s.project!, s.previewTheme), measure: canvasMeasure };
            s.update(
                (d) => {
                    const rs = docRoots(d, s.doc);
                    for (const it of g.items) {
                        const loc = locate(rs, it.id);
                        if (!loc) continue;
                        const fresh = structuredClone(it.snapshot) as Draft<AnyNode>;
                        loc.list[loc.index] = fresh as SceneNode;
                        const origin = absOrigin(rs, it.id);
                        const snap = it.snapshot;
                        // Map both corners, so a line keeps its direction.
                        const ax1 = mapX(snap.x + origin.x);
                        const ay1 = mapY(snap.y + origin.y);
                        const ax2 = mapX(snap.x + snap.width + origin.x);
                        const ay2 = mapY(snap.y + snap.height + origin.y);
                        fresh.x = ax1 - origin.x;
                        fresh.y = ay1 - origin.y;
                        if (
                            fresh.type === 'text' &&
                            fresh.box === 'auto-width' &&
                            (handle.includes('e') || handle.includes('w'))
                        ) {
                            fresh.box = 'fixed-width';
                        }
                        if (
                            fresh.type === 'text' &&
                            fresh.box !== 'fixed' &&
                            (handle.includes('n') || handle.includes('s'))
                        ) {
                            fresh.box = 'fixed';
                        }
                        resizeNode(fresh, ax2 - ax1, ay2 - ay1, ctx);
                        if (fresh.type === 'shape' && fresh.kind === 'line') {
                            fresh.width = ax2 - ax1;
                            fresh.height = ay2 - ay1;
                        }
                        if (fresh.type === 'frame' || fresh.type === 'component') {
                            applyConstraints(fresh as FrameNode, snap.width, snap.height, ctx);
                        }
                    }
                },
                { history: false },
            );
        }
    };

    const onPointerUp = (e: React.PointerEvent) => {
        const g = gesture.current;
        gesture.current = null;
        const s = editor();
        ref.current?.releasePointerCapture?.(e.pointerId);
        setMarquee(null);
        s.setGuides([]);
        if (!g) return;
        if (g.kind === 'tool') {
            creation.up(toWorld(vp, screenPoint(e)), e);
            return;
        }
        if (g.kind === 'move' && g.started && s.doc?.kind === 'page') reparentAfterMove(g.ids);
    };

    const onDoubleClick = (e: React.MouseEvent) => {
        const s = editor();
        if (!s.project || tool !== 'move') return;
        const hit = hitId(e.target);
        if (!hit) return;
        const rs = docRoots(s.project, s.doc);
        const sel = s.selection[0];
        const target = sel ? findNode(rs, sel) : undefined;
        if (target?.type === 'text' && sel === hit) {
            s.setEditingText(sel);
            return;
        }
        const deeper = sel ? pickDeeper(rs, sel, hit) : null;
        if (deeper) {
            s.select([deeper]);
            const n = findNode(rs, deeper);
            if (n?.type === 'text') s.setEditingText(deeper);
            return;
        }
        if (target?.type === 'text') s.setEditingText(target.id);
    };

    const cursor =
        gesture.current?.kind === 'pan'
            ? 'grabbing'
            : space || tool === 'hand'
              ? 'grab'
              : tool === 'move'
                ? 'default'
                : 'crosshair';

    return (
        <div
            ref={ref}
            className="bg-canvas relative h-full w-full touch-none overflow-hidden select-none"
            style={{ cursor }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => editor().setHover(null)}
            onDoubleClick={onDoubleClick}
            onContextMenu={(e) => e.preventDefault()}
            onDragOver={(e) => {
                if (
                    e.dataTransfer.types.includes('Files') ||
                    e.dataTransfer.types.includes(COMPONENT_MIME)
                )
                    e.preventDefault();
            }}
            onDrop={(e) => {
                const comp = e.dataTransfer.getData(COMPONENT_MIME);
                if (comp) {
                    e.preventDefault();
                    const { file, setId } = JSON.parse(comp) as { file: string; setId: string };
                    insertInstance(file, setId, toWorld(vp, screenPoint(e)));
                    return;
                }
                const files = [...e.dataTransfer.files];
                if (!files.length) return;
                e.preventDefault();
                void insertImageFiles(files, toWorld(vp, screenPoint(e)));
            }}
            data-testid="canvas"
        >
            <svg className="absolute inset-0 h-full w-full" style={{ overflow: 'visible' }}>
                <g transform={`translate(${vp.x} ${vp.y}) scale(${vp.zoom})`} style={cssVars}>
                    <FileContext.Provider value={doc?.file ?? ''}>
                        {roots.map((n) => (
                            <NodeView key={n.id} node={n} />
                        ))}
                    </FileContext.Provider>
                    {creation.preview}
                </g>
            </svg>
            <Overlay marquee={marquee} />
            {host.canvasLayers?.map((Layer, i) => (
                <Layer key={i} vp={vp} />
            ))}
            <TextEditor />
        </div>
    );
}

/** After a move on a page: a top-level layer dropped inside a top-level frame joins it; a frame's
 *  child dragged out of its frame leaves it. */
function reparentAfterMove(ids: string[]) {
    const s = editor();
    if (!s.project) return;
    const rs = docRoots(s.project, s.doc);
    for (const id of ids) {
        const r = absRect(rs, id);
        const loc = locate(rs, id);
        if (!r || !loc) continue;
        const center = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        const parent = loc.parent;
        const target = rs.find(
            (f) => f.type === 'frame' && f.id !== id && rectContains(absRect(rs, f.id)!, center),
        );
        if (!parent && target) {
            moveNode(id, target.id, (target as FrameNode).children.length);
        } else if (
            parent &&
            !loc.list.includes(target as SceneNode) &&
            rs.includes(parent) &&
            !rectContains(absRect(rs, parent.id)!, center)
        ) {
            moveNode(
                id,
                target?.id ?? null,
                target ? (target as FrameNode).children.length : rs.length,
            );
        }
    }
}
