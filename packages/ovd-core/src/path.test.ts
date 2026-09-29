import { describe, expect, it } from 'vitest';
import { parsePath, pathBounds, scalePath, serializePath } from './path';

describe('parsePath', () => {
    it('normalises relative and shorthand commands to absolute M/L/C/Q/Z', () => {
        expect(serializePath(parsePath('m10 10 h20 v20 l-20 0 z'))).toBe(
            'M10 10L30 10L30 30L10 30Z',
        );
    });

    it('treats extra pairs after M as implicit L', () => {
        expect(serializePath(parsePath('M0 0 10 0 10 10'))).toBe('M0 0L10 0L10 10');
    });

    it('reflects control points for S and T', () => {
        const s = parsePath('M0 0C0 10 10 10 10 0S20 -10 20 0');
        expect(s[2]).toMatchObject({ c: 'C', x1: 10, y1: -10 });
        const t = parsePath('M0 0Q5 10 10 0T20 0');
        expect(t[2]).toMatchObject({ c: 'Q', x1: 15, y1: -10 });
    });

    it('converts arcs to cubics that end at the arc endpoint', () => {
        const cmds = parsePath('M0 50A50 50 0 0 1 100 50');
        expect(cmds.every((c) => c.c === 'M' || c.c === 'C')).toBe(true);
        const last = cmds[cmds.length - 1]!;
        expect(last).toMatchObject({ x: 100, y: 50 });
        const b = pathBounds(cmds);
        expect(b.y).toBeCloseTo(0, 0); // top of the half circle
    });

    it('throws on data that does not start with a command', () => {
        expect(() => parsePath('10 10')).toThrow();
    });
});

describe('scalePath', () => {
    it('rescales from one box to another', () => {
        expect(scalePath('M0 0L10 20', { w: 10, h: 20 }, { w: 20, h: 10 })).toBe('M0 0L20 10');
    });
});
