import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pin } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import type { EditorHost, HostTool, ToolPointerEvent } from './host';
import { OvdEditor } from './OvdEditor';
import { editor } from './state/store';
import { openStarter } from './test/starter';

const openFileMenu = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole('button', { name: 'File menu' }));
    return screen.findByRole('menu');
};

describe('the host interface (#66)', () => {
    it('works with no host: built-in tools only, and Undo / Redo in the File menu', async () => {
        const user = userEvent.setup();
        openStarter();
        render(<OvdEditor />);
        const tools = screen.getByRole('toolbar', { name: 'Tools' });
        expect(within(tools).getByRole('button', { name: 'Rectangle' })).toBeInTheDocument();
        expect(within(tools).queryByRole('button', { name: 'Comment' })).toBeNull();
        await user.keyboard('c'); // no built-in tool on C any more
        expect(editor().tool).toBe('move');

        const menu = await openFileMenu(user);
        expect(
            within(menu)
                .getAllByRole('menuitem')
                .map((i) => i.textContent),
        ).toEqual(['Undo⌘Z', 'Redo⇧⌘Z']);
    });

    it('adds host tools to the toolbar and keymap, and hands them the pointer', async () => {
        const user = userEvent.setup();
        const seen: Omit<ToolPointerEvent, 'event' | 'roots'>[] = [];
        const pin: HostTool = {
            id: 'pin',
            label: 'Pin',
            icon: Pin,
            key: 'K',
            onPointerDown: ({ world, hit, file }) => void seen.push({ world, hit, file }),
        };
        openStarter();
        const { container } = render(<OvdEditor host={{ tools: [pin] }} />);
        expect(screen.getByRole('button', { name: 'Pin' })).toBeInTheDocument();
        await user.keyboard('k');
        expect(editor().tool).toBe('pin');

        // Viewport (80, 80, 1): client (120, 200) is world (40, 120), on the hero rectangle.
        act(() => editor().setViewport({ x: 80, y: 80, zoom: 1 }));
        const hero = container.querySelector('[data-id="r_hero"]')!;
        fireEvent.pointerDown(hero, { clientX: 120, clientY: 200, button: 0, pointerId: 1 });
        expect(seen).toEqual([
            { world: { x: 40, y: 120 }, hit: 'r_hero', file: 'pages/onboarding.svg' },
        ]);
        expect(editor().selection).toEqual([]); // a host tool does not select
    });

    it('draws host canvas layers with the viewport', () => {
        openStarter();
        const Layer = ({ vp }: { vp: { zoom: number } }) => (
            <div data-testid="layer">zoom {vp.zoom}</div>
        );
        render(<OvdEditor host={{ canvasLayers: [Layer] }} />);
        act(() => editor().setViewport({ x: 0, y: 0, zoom: 2 }));
        expect(screen.getByTestId('layer')).toHaveTextContent('zoom 2');
    });

    it('puts host File-menu entries above its own, and top-bar content in its slots', async () => {
        const user = userEvent.setup();
        const save = vi.fn();
        const host: EditorHost = {
            fileMenu: {
                label: 'Starter · local',
                sections: [[{ label: 'Save', shortcut: '⌘S', onSelect: save }]],
            },
            commands: { save },
            topBar: {
                status: <span>All saved</span>,
                actions: <button>Share</button>,
                end: <button>Account</button>,
            },
            overlays: <div role="dialog" aria-label="Host dialog" />,
        };
        openStarter();
        render(<OvdEditor host={host} />);
        expect(screen.getByText('All saved')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Account' })).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Host dialog' })).toBeInTheDocument();

        await user.keyboard('{Meta>}s{/Meta}');
        expect(save).toHaveBeenCalledTimes(1);

        const menu = await openFileMenu(user);
        expect(within(menu).getByText('Starter · local')).toBeInTheDocument();
        expect(
            within(menu)
                .getAllByRole('menuitem')
                .map((i) => i.textContent),
        ).toEqual(['Save⌘S', 'Undo⌘Z', 'Redo⇧⌘Z']);
        await user.click(within(menu).getByRole('menuitem', { name: /Save/ }));
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('shows library status from the host, and locks the list when not editable', async () => {
        const user = userEvent.setup();
        openStarter();
        act(() =>
            editor().update((d) => {
                d.manifest.libraries = [
                    { name: 'core-ui', url: 'https://example.com/core-ui', ref: 'v1.0.0' },
                ];
            }),
        );
        const sha = 'abcdef1234567890abcdef1234567890abcdef12';
        render(
            <OvdEditor
                host={{
                    libraries: {
                        status: [{ name: 'core-ui', ref: 'v1.0.0', sha, error: null }],
                        editable: false,
                    },
                }}
            />,
        );
        await user.click(screen.getByRole('tab', { name: 'Assets' }));
        const section = screen.getByRole('region', { name: 'Libraries' });
        expect(within(section).getByText(/pinned abcdef1/)).toBeInTheDocument();
        expect(within(section).getByLabelText('core-ui version')).toBeDisabled();
        expect(within(section).queryByRole('button', { name: 'Add library' })).toBeNull();
    });
});
