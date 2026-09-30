import { createFrame, createGroup, createShape } from '@workspace/ovd-core';
import { describe, expect, it } from 'vitest';
import { collectSnapTargets, pickDeeper, pickTarget, snapMove } from './interaction';

const roots = [
    createFrame('f', {
        width: 400,
        height: 400,
        children: [
            createGroup('g', {
                x: 10,
                y: 10,
                width: 100,
                height: 100,
                children: [
                    createShape('a', 'rect', { width: 50, height: 50 }),
                    createShape('b', 'rect', { x: 50, width: 50, height: 50 }),
                ],
            }),
            createShape('locked', 'rect', { x: 200, y: 200, locked: true }),
        ],
    }),
    createShape('top', 'rect', { x: 500, y: 0, width: 100, height: 100 }),
];

describe('pickTarget', () => {
    it('treats a top-level frame as transparent and picks its direct child', () => {
        expect(pickTarget(roots, 'a', [])).toBe('g');
    });

    it('selects the frame itself when its background is clicked', () => {
        expect(pickTarget(roots, 'f', [])).toBe('f');
    });

    it('stays at the depth of the current selection', () => {
        expect(pickTarget(roots, 'b', ['a'])).toBe('b');
    });

    it('picks the innermost layer with ⌘/Ctrl', () => {
        expect(pickTarget(roots, 'a', [], { deep: true })).toBe('a');
    });

    it('never picks a locked layer', () => {
        expect(pickTarget(roots, 'locked', [])).toBe('f');
    });

    it('goes one level deeper on double-click', () => {
        expect(pickDeeper(roots, 'g', 'a')).toBe('a');
        expect(pickDeeper(roots, 'a', 'a')).toBeNull();
    });
});

describe('snapMove', () => {
    const targets = collectSnapTargets(roots, ['g']);

    it('snaps a near edge and reports a guide', () => {
        // Moving box's left edge 3px off the frame's left edge (x = 0).
        const r = snapMove({ x: 3, y: 150, width: 100, height: 100 }, targets, 6);
        expect(r.dx).toBe(-3);
        expect(r.guides.some((g) => g.axis === 'x' && g.at === 0)).toBe(true);
    });

    it('snaps centres', () => {
        // Frame centre is x = 200; a 100-wide box at x = 148 has its centre at 198.
        expect(snapMove({ x: 148, y: 150, width: 100, height: 100 }, targets, 6).dx).toBe(2);
    });

    it('does nothing outside the threshold', () => {
        expect(snapMove({ x: 20, y: 150, width: 10, height: 10 }, targets, 6)).toMatchObject({
            dx: 0,
            guides: [],
        });
    });
});
