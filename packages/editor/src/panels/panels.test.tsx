import { findNode } from '@workspace/ovd-core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { OvdEditor } from '../OvdEditor';
import { docRoots } from '../lib/doc';
import { openStarter } from '../test/starter';
import { editor } from '../state/store';

const node = (id: string) => findNode(docRoots(editor().project!, editor().doc), id)!;

describe('panels', () => {
    beforeEach(() => {
        openStarter();
    });

    it('lists layers front-most first and selects on click', async () => {
        render(<OvdEditor />);
        act(() => editor().select(['t_heading'])); // expands Welcome / Mobile
        const tree = await screen.findByRole('tree', { name: 'Layers' });
        const rows = within(tree)
            .getAllByRole('treeitem')
            .map((r) => r.textContent);
        const i = rows.indexOf('Welcome / Mobile');
        // The last child in the document ("Sign in" secondary button) is drawn on top, so it is listed first.
        expect(rows[i + 1]).toBe('Sign in');
        fireEvent.click(within(tree).getByText('Body'));
        expect(editor().selection).toEqual(['t_body']);
    });

    it('shows Mixed for differing values and commits a typed value as one undo step', async () => {
        render(<OvdEditor />);
        act(() => editor().select(['t_heading', 't_body']));
        expect(await screen.findAllByDisplayValue('Mixed')).not.toHaveLength(0);

        act(() => editor().select(['r_hero']));
        const w = await screen.findByDisplayValue('342');
        fireEvent.focus(w);
        fireEvent.change(w, { target: { value: '200' } });
        fireEvent.keyDown(w, { key: 'Enter' });
        expect(node('r_hero').width).toBe(200);
        expect(editor().past).toHaveLength(1);
    });
});
