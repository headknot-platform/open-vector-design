import { type FontSpec, type Measure, approxMeasure } from '@workspace/ovd-core';

let ctx: CanvasRenderingContext2D | null | undefined;
const cache = new Map<string, number>();

function context(): CanvasRenderingContext2D | null {
    if (ctx !== undefined) return ctx;
    // jsdom has no canvas and logs an error for trying; use the metric-free estimate quietly.
    if (/jsdom/i.test(navigator.userAgent)) return (ctx = null);
    try {
        ctx = document.createElement('canvas').getContext('2d');
    } catch {
        ctx = null; // jsdom: no canvas implementation
    }
    return ctx;
}

/** Text width with the browser's real font metrics; the metric-free estimate where there is no canvas. */
export const canvasMeasure: Measure = (text: string, font: FontSpec) => {
    const c = context();
    if (!c) return approxMeasure(text, font);
    const css = `${font.weight} ${font.size}px ${font.family}`;
    const key = `${css}|${font.letterSpacing}|${text}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    c.font = css;
    const width = c.measureText(text).width + Math.max(0, text.length - 1) * font.letterSpacing;
    cache.set(key, width);
    return width;
};

/** Measurements taken before web fonts finished loading used fallback metrics. */
export function resetMeasureCache(): void {
    cache.clear();
}
