import { afterEach, describe, expect, it } from 'vitest';
import { MIN_ZOOM, canvasSize, fitRect } from './viewport';

const content = { x: 0, y: 0, width: 700, height: 600 }; // about the starter's two frames

afterEach(() => Object.assign(canvasSize, { width: 1200, height: 800 }));

describe('fitRect', () => {
    it('fits with the full padding on a normal canvas', () => {
        Object.assign(canvasSize, { width: 1200, height: 800 });
        const big = { x: 0, y: 0, width: 1400, height: 1200 };
        expect(fitRect(big, 64, 1).zoom).toBeCloseTo((800 - 128) / 1200);
    });

    it('still fits a narrow canvas instead of collapsing to the minimum zoom', () => {
        // A 612 px window leaves 116 px of canvas between the panels.
        Object.assign(canvasSize, { width: 116, height: 811 });
        const { zoom, x } = fitRect(content, 64, 1);
        expect(zoom).toBeGreaterThan(MIN_ZOOM * 5);
        expect(zoom).toBeCloseTo((116 - 2 * (116 / 8)) / 700);
        expect(x + (content.width / 2) * zoom).toBeCloseTo(58); // centred
    });
});
