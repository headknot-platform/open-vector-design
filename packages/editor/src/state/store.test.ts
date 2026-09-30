import { findNode } from '@workspace/ovd-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { docRoots } from '../lib/doc';
import { loadStarter } from '../test/starter';
import { deleteSelection, duplicateSelection, groupSelection, nudge } from './actions';
import { editor } from './store';

const node = (id: string) => findNode(docRoots(editor().project!, editor().doc), id);

describe('editor store', () => {
    beforeEach(() => {
        editor().loadProject(loadStarter(), { kind: 'local', name: 'Starter' });
    });

    it('opens the first page', () => {
        expect(editor().doc).toEqual({ kind: 'page', file: 'pages/onboarding.svg' });
        expect(editor().project).toBe(editor().savedProject);
    });

    it('undoes and redoes an edit', () => {
        editor().select(['r_hero']);
        nudge(10, 0);
        expect(node('r_hero')!.x).toBe(34);
        expect(editor().project).not.toBe(editor().savedProject);
        editor().undo();
        expect(node('r_hero')!.x).toBe(24);
        editor().redo();
        expect(node('r_hero')!.x).toBe(34);
    });

    it('records a whole gesture as one undo step', () => {
        editor().checkpoint();
        for (let i = 1; i <= 5; i++) {
            editor().update(
                (d) => {
                    findNode(docRoots(d, editor().doc), 'r_hero')!.x = 24 + i;
                },
                { history: false },
            );
        }
        expect(node('r_hero')!.x).toBe(29);
        editor().undo();
        expect(node('r_hero')!.x).toBe(24);
        expect(editor().past).toHaveLength(0);
    });

    it('drops selected ids that undo removed', () => {
        editor().select(['t_heading']);
        duplicateSelection();
        const copy = editor().selection[0]!;
        expect(copy).not.toBe('t_heading');
        editor().undo();
        expect(editor().selection).toEqual([]);
    });

    it('deletes and groups', () => {
        editor().select(['e_orb_1', 'e_orb_2']);
        groupSelection();
        const g = node(editor().selection[0]!)!;
        expect(g.type).toBe('group');
        expect([g.x, g.y, g.width, g.height]).toEqual([80, 140, 216, 156]);
        deleteSelection();
        expect(node(g.id)).toBeUndefined();
    });
});
