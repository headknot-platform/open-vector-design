/** Screen-space chrome over the canvas: selection, handles, guides, marquee and frame labels. */
import { findNode } from '@workspace/ovd-core';
import { absRect, type Rect, unionRects } from '../lib/geometry';
import { screenRect } from '../lib/viewport';
import { useDocRoots, useEditor, useViewport } from '../state/store';

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

const HANDLES: { h: Handle; fx: number; fy: number; cursor: string }[] = [
    { h: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
    { h: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
    { h: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
    { h: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
    { h: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
    { h: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
    { h: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
    { h: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

const round = (n: number) => Math.round(n * 100) / 100;

export function Overlay({ marquee }: { marquee: Rect | null }) {
    const vp = useViewport();
    const roots = useDocRoots();
    const selection = useEditor((s) => s.selection);
    const hover = useEditor((s) => s.hover);
    const guides = useEditor((s) => s.guides);
    const editingText = useEditor((s) => s.editingText);
    const tool = useEditor((s) => s.tool);

    const selRects = selection.map((id) => absRect(roots, id)).filter(Boolean) as Rect[];
    const box = unionRects(selRects);
    const sb = box && screenRect(vp, box);
    const hoverRect = hover && !selection.includes(hover) ? absRect(roots, hover) : undefined;
    const single = selection.length === 1 ? findNode(roots, selection[0]!) : undefined;
    const showHandles = sb && !editingText && tool === 'move' && !single?.locked;

    return (
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
            {/* Frame labels — clicking one selects the frame. */}
            {roots.map((n) => {
                if (n.type !== 'frame' && n.type !== 'component') return null;
                const r = screenRect(vp, absRect(roots, n.id)!);
                const active = selection.includes(n.id);
                return (
                    <text
                        key={n.id}
                        data-frame-label={n.id}
                        x={r.x}
                        y={r.y - 6}
                        className={active ? 'fill-selection' : 'fill-muted-foreground'}
                        style={{ fontSize: 11, pointerEvents: 'all', cursor: 'default' }}
                    >
                        {n.name}
                    </text>
                );
            })}

            {hoverRect && (
                <rect
                    {...screenRect(vp, hoverRect)}
                    fill="none"
                    className="stroke-selection"
                    strokeWidth={1.5}
                />
            )}

            {selRects.map((r, i) => (
                <rect
                    key={i}
                    {...screenRect(vp, r)}
                    fill="none"
                    className="stroke-selection"
                    strokeWidth={1}
                />
            ))}

            {sb && selection.length > 1 && (
                <rect
                    {...sb}
                    fill="none"
                    className="stroke-selection"
                    strokeWidth={1}
                    strokeDasharray="4 3"
                />
            )}

            {showHandles &&
                HANDLES.map(({ h, fx, fy, cursor }) => (
                    <rect
                        key={h}
                        data-handle={h}
                        x={sb.x + sb.width * fx - 4}
                        y={sb.y + sb.height * fy - 4}
                        width={8}
                        height={8}
                        rx={1.5}
                        className="fill-background stroke-selection"
                        strokeWidth={1.5}
                        style={{ pointerEvents: 'all', cursor }}
                    />
                ))}

            {sb && box && (
                <g transform={`translate(${sb.x + sb.width / 2} ${sb.y + sb.height + 16})`}>
                    <rect x={-34} y={-9} width={68} height={18} rx={4} className="fill-selection" />
                    <text textAnchor="middle" y={4} fill="white" style={{ fontSize: 10.5 }}>
                        {round(box.width)} × {round(box.height)}
                    </text>
                </g>
            )}

            {marquee && (
                <rect
                    {...screenRect(vp, marquee)}
                    className="fill-selection/10 stroke-selection"
                    strokeWidth={1}
                />
            )}

            {guides.map((g, i) => {
                const a = g.axis === 'x' ? { x: g.at, y: g.from } : { x: g.from, y: g.at };
                const b = g.axis === 'x' ? { x: g.at, y: g.to } : { x: g.to, y: g.at };
                return (
                    <line
                        key={i}
                        x1={a.x * vp.zoom + vp.x}
                        y1={a.y * vp.zoom + vp.y}
                        x2={b.x * vp.zoom + vp.x}
                        y2={b.y * vp.zoom + vp.y}
                        className="stroke-guide"
                        strokeWidth={1}
                    />
                );
            })}
        </svg>
    );
}
