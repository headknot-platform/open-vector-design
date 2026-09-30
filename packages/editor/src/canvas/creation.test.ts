import { createFrame, createShape } from '@workspace/ovd-core';
import { describe, expect, it } from 'vitest';
import { containerAt } from './creation';

const roots = [
    createFrame('outer', {
        x: 100,
        y: 100,
        width: 400,
        height: 400,
        children: [
            createFrame('inner', { x: 50, y: 50, width: 100, height: 100 }),
            createShape('r', 'rect', { x: 200, y: 200 }),
        ],
    }),
];

describe('containerAt (new layers go into the deepest frame under the pointer)', () => {
    it('finds a nested frame in document coordinates', () => {
        expect(containerAt(roots, { x: 175, y: 175 })?.id).toBe('inner');
    });

    it('finds the outer frame elsewhere inside it', () => {
        expect(containerAt(roots, { x: 400, y: 400 })?.id).toBe('outer');
    });

    it('returns null on empty canvas', () => {
        expect(containerAt(roots, { x: 10, y: 10 })).toBeNull();
    });

    it('never nests a node into itself', () => {
        expect(containerAt(roots, { x: 175, y: 175 }, 'inner')?.id).toBe('outer');
    });
});
