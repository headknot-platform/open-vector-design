import { useEffect } from 'react';
import {
    deleteSelection,
    duplicateSelection,
    frameSelection,
    groupSelection,
    nudge,
    pasteSvg,
    reorder,
    selectAll,
    selectionAsSvg,
    setHidden,
    setLocked,
    ungroupSelection,
    zoomBy,
    zoomTo,
    zoomToFit,
    zoomToSelection,
} from '../state/actions';
import { insertImageFiles } from '../lib/images';
import { addAutoLayout } from '../state/layout';
import { createComponentFromSelection } from '../state/components';
import type { HostCommands, HostTool } from '../host';
import { type BuiltinTool, editor } from '../state/store';

const TOOL_KEYS: Record<string, BuiltinTool> = {
    v: 'move',
    h: 'hand',
    f: 'frame',
    a: 'frame',
    r: 'rect',
    o: 'ellipse',
    l: 'line',
    p: 'pen',
    t: 'text',
};

function typing(e: Event): boolean {
    const el = e.target as HTMLElement | null;
    return (
        !!el &&
        (el.tagName === 'INPUT' ||
            el.tagName === 'TEXTAREA' ||
            el.tagName === 'SELECT' ||
            el.isContentEditable)
    );
}

/** The editor's one keymap, plus the host's commands and tool keys. */
export function useShortcuts(commands: HostCommands = {}, tools: HostTool[] = []) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (typing(e) || editor().editingText) return;
            const mod = e.metaKey || e.ctrlKey;
            const k = e.key.toLowerCase();
            const s = editor();
            const run = (fn: () => void) => {
                e.preventDefault();
                fn();
            };

            if (mod && k === 'z') return run(() => (e.shiftKey ? s.redo() : s.undo()));
            if (mod && k === 'y') return run(() => s.redo());
            if (mod && k === 's') return run(() => commands.save?.());
            if (mod && k === 'o') return run(() => commands.open?.());
            if (mod && k === 'e' && e.shiftKey) return run(() => commands.exportPage?.());
            if (mod && k === 'd') return run(() => duplicateSelection());
            if (mod && k === 'a') return run(() => selectAll());
            if (mod && e.altKey && (k === 'k' || e.code === 'KeyK'))
                return run(() => createComponentFromSelection());
            if (mod && e.altKey && (k === 'g' || e.code === 'KeyG'))
                return run(() => frameSelection());
            if (mod && k === 'g')
                return run(() => (e.shiftKey ? ungroupSelection() : groupSelection()));
            if (mod && e.key === ']') return run(() => reorder(e.altKey ? 'front' : 'forward'));
            if (mod && e.key === '[') return run(() => reorder(e.altKey ? 'back' : 'backward'));
            if (mod && e.shiftKey && k === 'h') return run(() => setHidden(s.selection));
            if (mod && e.shiftKey && k === 'l') return run(() => setLocked(s.selection));
            if (mod && k === '0') return run(() => zoomTo(1));
            if (mod && (e.key === '=' || e.key === '+')) return run(() => zoomBy(1.25));
            if (mod && e.key === '-') return run(() => zoomBy(0.8));
            if (mod) return;

            if (e.shiftKey && k === 'a') return run(() => addAutoLayout());
            if (e.key === 'Backspace' || e.key === 'Delete') return run(() => deleteSelection());
            if (e.key === 'Escape')
                return run(() => (s.tool !== 'move' ? s.setTool('move') : s.select([])));
            if (e.key === 'Enter' && s.selection.length === 1) return;
            const step = e.shiftKey ? 10 : 1;
            if (e.key === 'ArrowLeft') return run(() => nudge(-step, 0));
            if (e.key === 'ArrowRight') return run(() => nudge(step, 0));
            if (e.key === 'ArrowUp') return run(() => nudge(0, -step));
            if (e.key === 'ArrowDown') return run(() => nudge(0, step));
            if (e.shiftKey && e.key === '!') return run(() => zoomToFit());
            if (e.shiftKey && e.key === '@') return run(() => zoomToSelection());
            if (e.shiftKey && e.code === 'Digit1') return run(() => zoomToFit());
            if (e.shiftKey && e.code === 'Digit2') return run(() => zoomToSelection());
            if (e.key === '+' || e.key === '=') return run(() => zoomBy(1.25));
            if (e.key === '-') return run(() => zoomBy(0.8));
            if (!e.shiftKey && !e.altKey && TOOL_KEYS[k])
                return run(() => s.setTool(TOOL_KEYS[k]!));
            const hostTool = tools.find((t) => t.key?.toLowerCase() === k);
            if (!e.shiftKey && !e.altKey && hostTool) return run(() => s.setTool(hostTool.id));
        };

        // Native clipboard events: no permission prompt, and the payload is OVD/SVG text.
        const onCopy = (e: ClipboardEvent) => {
            if (typing(e) || editor().editingText) return;
            const svg = selectionAsSvg();
            if (!svg) return;
            e.preventDefault();
            e.clipboardData?.setData('text/plain', svg);
            e.clipboardData?.setData('image/svg+xml', svg);
        };
        const onCut = (e: ClipboardEvent) => {
            onCopy(e);
            if (e.defaultPrevented) deleteSelection();
        };
        const onPaste = (e: ClipboardEvent) => {
            if (typing(e) || editor().editingText) return;
            const files = [...(e.clipboardData?.files ?? [])].filter((f) =>
                f.type.startsWith('image/'),
            );
            if (files.length) {
                e.preventDefault();
                void insertImageFiles(files);
                return;
            }
            const text =
                e.clipboardData?.getData('image/svg+xml') ||
                e.clipboardData?.getData('text/plain') ||
                '';
            if (pasteSvg(text)) e.preventDefault();
        };

        window.addEventListener('keydown', onKey);
        window.addEventListener('copy', onCopy);
        window.addEventListener('cut', onCut);
        window.addEventListener('paste', onPaste);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('copy', onCopy);
            window.removeEventListener('cut', onCut);
            window.removeEventListener('paste', onPaste);
        };
    }, [commands, tools]);
}
