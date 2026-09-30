import type { Viewport } from '../state/store';
import type { Point, Rect } from './geometry';

/** Canvas element size, kept current by the canvas's ResizeObserver. */
export const canvasSize = { width: 1200, height: 800 };

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

export function clampZoom(z: number): number {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function toWorld(vp: Viewport, p: Point): Point {
    return { x: (p.x - vp.x) / vp.zoom, y: (p.y - vp.y) / vp.zoom };
}

export function toScreen(vp: Viewport, p: Point): Point {
    return { x: p.x * vp.zoom + vp.x, y: p.y * vp.zoom + vp.y };
}

export function screenRect(vp: Viewport, r: Rect): Rect {
    return {
        x: r.x * vp.zoom + vp.x,
        y: r.y * vp.zoom + vp.y,
        width: r.width * vp.zoom,
        height: r.height * vp.zoom,
    };
}

/** Zooms so the world point under `screen` stays under it. */
export function zoomAround(vp: Viewport, zoom: number, screen: Point): Viewport {
    const z = clampZoom(zoom);
    const w = toWorld(vp, screen);
    return { zoom: z, x: screen.x - w.x * z, y: screen.y - w.y * z };
}

export function fitRect(r: Rect, padding = 64, maxZoom = 1): Viewport {
    // On a narrow canvas a fixed padding would leave no room at all (zoom clamped to the minimum).
    const px = Math.min(padding, canvasSize.width / 8);
    const py = Math.min(padding, canvasSize.height / 8);
    const zw = (canvasSize.width - px * 2) / Math.max(1, r.width);
    const zh = (canvasSize.height - py * 2) / Math.max(1, r.height);
    const zoom = clampZoom(Math.min(zw, zh, maxZoom));
    return {
        zoom,
        x: canvasSize.width / 2 - (r.x + r.width / 2) * zoom,
        y: canvasSize.height / 2 - (r.y + r.height / 2) * zoom,
    };
}

export function viewportCenter(vp: Viewport): Point {
    return toWorld(vp, { x: canvasSize.width / 2, y: canvasSize.height / 2 });
}
