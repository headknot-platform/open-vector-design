import type { ManifestLibrary } from '@workspace/ovd-core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Pin } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import type { EditorHost, HostTool, ResolvedLibrary, ToolPointerEvent } from './host';
import { OvdEditor } from './OvdEditor';
import { editor } from './state/store';
import { loadStarter, openStarter } from './test/starter';

const SHA = 'abcdef1234567890abcdef1234567890abcdef12';
const CORE_UI = (ref: string) => ({ name: 'core-ui', url: 'https://example.com/core-ui', ref });
const lib = loadStarter();

/** The starter with one library in its manifest, opened as a host would open it. */
function openWithLibrary(ref: string) {
    const project = loadStarter();
    project.manifest.libraries = [CORE_UI(ref)];
    editor().loadProject(project, { kind: 'local', name: 'Starter' });
}

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
        ).toEqual(['Validate project…', 'Undo⌘Z', 'Redo⇧⌘Z']);
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
        ).toEqual(['Save⌘S', 'Validate project…', 'Undo⌘Z', 'Redo⇧⌘Z']);
        await user.click(within(menu).getByRole('menuitem', { name: /Save/ }));
        expect(save).toHaveBeenCalledTimes(2);
    });

    it('resolves libraries on open, shows status and locks the list when not editable', async () => {
        const user = userEvent.setup();
        const resolve = vi.fn(async (libs: ManifestLibrary[]) =>
            libs.map((l) => ({ name: l.name, ref: l.ref, sha: SHA, error: null, project: lib })),
        );
        openWithLibrary('v1.0.0');
        render(<OvdEditor host={{ libraries: { resolve, editable: false } }} />);
        await waitFor(() => expect(editor().libraryStatus).toHaveLength(1));
        expect(resolve).toHaveBeenCalledTimes(1);
        expect(resolve.mock.calls[0]![0]).toEqual([CORE_UI('v1.0.0')]);
        expect(editor().project!.libraries).toEqual({ 'core-ui': lib });
        // Library files are not an edit: no undo step, nothing unsaved.
        expect(editor().past).toHaveLength(0);
        expect(editor().project).toBe(editor().savedProject);

        await user.click(screen.getByRole('tab', { name: 'Assets' }));
        const section = screen.getByRole('region', { name: 'Libraries' });
        expect(within(section).getByText(/pinned abcdef1/)).toBeInTheDocument();
        expect(within(section).getByLabelText('core-ui version')).toBeDisabled();
        expect(within(section).queryByRole('button', { name: 'Add library' })).toBeNull();
    });

    it('resolves again when the list changes, not on other edits, and drops a stale answer', async () => {
        let first!: (v: ResolvedLibrary[]) => void;
        const resolve = vi
            .fn<(libs: ManifestLibrary[]) => Promise<ResolvedLibrary[]>>()
            .mockImplementationOnce(() => new Promise((r) => (first = r)))
            .mockImplementation(async (libs) =>
                libs.map((l) => ({ name: l.name, ref: l.ref, sha: SHA, error: null })),
            );
        openWithLibrary('v1.0.0');
        render(<OvdEditor host={{ libraries: { resolve } }} />);
        expect(resolve).toHaveBeenCalledTimes(1);

        act(() => editor().update((d) => void (d.manifest.name = 'Renamed')));
        expect(resolve).toHaveBeenCalledTimes(1); // not a library edit

        act(() => editor().update((d) => void (d.manifest.libraries![0]!.ref = 'v2.0.0')));
        await waitFor(() => expect(editor().libraryStatus[0]?.ref).toBe('v2.0.0'));
        expect(resolve).toHaveBeenCalledTimes(2);

        // The first call answers late, for v1.0.0: it must not overwrite v2.0.0.
        await act(async () => first([{ name: 'core-ui', ref: 'v1.0.0', sha: SHA, error: null }]));
        expect(editor().libraryStatus[0]?.ref).toBe('v2.0.0');

        act(() => editor().undo()); // back to v1.0.0 is a list change too
        await waitFor(() => expect(editor().libraryStatus[0]?.ref).toBe('v1.0.0'));
        expect(resolve).toHaveBeenCalledTimes(3);
    });

    it('shows the resolver error on each library', async () => {
        openWithLibrary('v1.0.0');
        const resolve = vi.fn(async () => {
            throw new Error('Library host unreachable');
        });
        render(<OvdEditor host={{ libraries: { resolve } }} />);
        await waitFor(() =>
            expect(editor().libraryStatus).toEqual([
                { name: 'core-ui', ref: 'v1.0.0', sha: null, error: 'Library host unreachable' },
            ]),
        );
    });
});
