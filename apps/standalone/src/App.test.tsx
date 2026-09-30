import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { editor } from '@workspace/editor';
import { describe, expect, it, vi } from 'vitest';
import App from './App';
import { discardSnapshot } from './lib/autosave';
import { requests } from './test/setup';

describe('the standalone editor (#69)', () => {
    it('starts, creates a project, and recovers unsaved work after a reload — with no requests', async () => {
        await discardSnapshot();
        const user = userEvent.setup();
        const first = render(<App />);
        const start = screen.getByRole('navigation', { name: 'Start' });
        expect(screen.queryByRole('region', { name: 'Unsaved work' })).toBeNull();
        await user.click(within(start).getByRole('button', { name: 'New project' }));
        expect(await screen.findByTestId('canvas')).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(/Kept in this browser/);

        act(() => editor().update((d) => void (d.manifest.name = 'My idea')));
        // Autosave is debounced; wait for the snapshot to land.
        await waitFor(
            async () => {
                const { readSnapshot } = await import('./lib/autosave');
                expect((await readSnapshot())?.files['manifest.json']).toContain('My idea');
            },
            { timeout: 3000 },
        );

        // "Reload": nothing open, the app starts again.
        first.unmount();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const { closeProject } = await import('./lib/local');
        await act(() => closeProject());
        render(<App />);
        const card = await screen.findByRole('region', { name: 'Unsaved work' });
        await user.click(within(card).getByRole('button', { name: 'Recover' }));
        await screen.findByTestId('canvas');
        expect(editor().project!.manifest.name).toBe('My idea');
        expect(editor().project).not.toBe(editor().savedProject); // still unsaved

        expect(requests).toEqual([]);
    });

    it('keeps a new project in the browser before any edit', async () => {
        await discardSnapshot();
        const user = userEvent.setup();
        const first = render(<App />);
        const start = screen.getByRole('navigation', { name: 'Start' });
        await user.click(within(start).getByRole('button', { name: 'New project' }));
        await screen.findByTestId('canvas');
        const { readSnapshot } = await import('./lib/autosave');
        await waitFor(async () => expect((await readSnapshot())?.dirty).toBe(true), {
            timeout: 3000,
        });

        first.unmount();
        vi.spyOn(window, 'confirm').mockReturnValue(true);
        const { closeProject } = await import('./lib/local');
        await act(() => closeProject());
        render(<App />);
        const card = await screen.findByRole('region', { name: 'Unsaved work' });
        expect(card).toHaveTextContent('Untitled');
    });
});
