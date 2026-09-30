/**
 * The host interface (#66). The editor renders and edits a project and does no I/O of its own;
 * whoever embeds it — the standalone OVD Editor, our app — supplies everything else here: where a
 * project comes from and goes to, extra menu entries, tools, canvas layers and panels.
 *
 * Loading and observing the project go through the store, not this object: a host calls
 * `editor().loadProject(project, source)` and `useEditor.subscribe(...)` to save changes, and
 * `editor().markSaved()` once they are stored.
 */
import type { AnyNode } from '@workspace/ovd-core';
import type { LucideIcon } from 'lucide-react';
import { type ComponentType, type ReactNode, createContext, useContext } from 'react';
import type { Point } from './lib/geometry';
import type { Viewport } from './state/store';

export interface MenuItem {
    label: string;
    /** Shown only; the key itself is bound through `commands` or the host's own handler. */
    shortcut?: string;
    disabled?: boolean;
    onSelect(): void;
}

/** A pointer-down on the canvas while a host tool is active. */
export interface ToolPointerEvent {
    /** The pointer in document coordinates. */
    world: Point;
    /** The id of the layer under the pointer, or null on empty canvas. */
    hit: string | null;
    /** The open document (page or component file). */
    file: string;
    /** The open document's top-level nodes, for geometry helpers such as `absRect`. */
    roots: AnyNode[];
    event: React.PointerEvent;
}

export interface HostTool {
    /** Unique among tools; it becomes the store's `tool` while active. */
    id: string;
    label: string;
    icon: LucideIcon;
    /** Single-letter shortcut, e.g. 'C'. Must not clash with the built-in tools (V H F A R O L P T). */
    key?: string;
    onPointerDown(e: ToolPointerEvent): void;
}

/** What the host knows about a manifest library (spec §3); the editor only shows it. */
export interface LibraryStatus {
    name: string;
    ref: string;
    /** The commit the ref resolved to, once resolved. */
    sha: string | null;
    error: string | null;
}

/** Keyboard commands the host implements; the editor owns the one keymap. */
export interface HostCommands {
    /** ⌘S */
    save?: () => void;
    /** ⌘O */
    open?: () => void;
    /** ⇧⌘E */
    exportPage?: () => void;
}

export interface EditorHost {
    fileMenu?: {
        /** Line at the top of the menu, e.g. the project name. */
        label?: string;
        /** Image for the menu button. */
        logo?: string;
        /** Groups of entries, separated by rules, above the editor's own (Undo, Redo). */
        sections?: MenuItem[][];
    };
    topBar?: {
        /** Beside the document name, e.g. a save indicator. */
        status?: ReactNode;
        /** Right side, before the theme and zoom controls. */
        actions?: ReactNode;
        /** Far right, after the zoom controls, e.g. an account menu. */
        end?: ReactNode;
    };
    tools?: HostTool[];
    /** Drawn over the canvas, in screen space; `toScreen(vp, point)` places document points. */
    canvasLayers?: ComponentType<{ vp: Viewport }>[];
    /**
     * Manifest libraries: what the host resolved, and whether the user may change the list. Without
     * it the list is editable and shown without status. Resolved files reach the canvas through
     * `editor().setLibraries(...)`.
     */
    libraries?: { status: LibraryStatus[]; editable: boolean };
    commands?: HostCommands;
    /** Rendered once inside the editor: the host's dialogs, sheets and hidden file inputs. */
    overlays?: ReactNode;
}

const HostContext = createContext<EditorHost>({});

export const HostProvider = HostContext.Provider;

export function useHost(): EditorHost {
    return useContext(HostContext);
}
