import { createShape } from '@workspace/ovd-core';
import { describe, expect, it } from 'vitest';
import { inferLayout } from './layout';

const box = (x: number, y: number, w = 40, h = 20) =>
    createShape(`r${x}${y}`, 'rect', { x, y, width: w, height: h });

describe('inferLayout (adding auto layout keeps the arrangement)', () => {
    it('reads a horizontal row with its gap and padding', () => {
        const l = inferLayout({
            width: 200,
            height: 60,
            children: [box(10, 20), box(62, 20), box(114, 20)],
        });
        expect(l.direction).toBe('row');
        expect(l.gap).toEqual({ value: 12 });
        expect(l.padding!.map((p) => p.value)).toEqual([20, 46, 20, 10]);
    });

    it('reads a vertical stack', () => {
        const l = inferLayout({
            width: 100,
            height: 200,
            children: [box(8, 8), box(8, 36), box(8, 64)],
        });
        expect(l.direction).toBe('column');
        expect(l.gap).toEqual({ value: 8 });
    });

    it('never infers a negative gap for overlapping layers', () => {
        expect(
            inferLayout({ width: 100, height: 100, children: [box(0, 0), box(20, 0)] }).gap,
        ).toEqual({ value: 0 });
    });
});
