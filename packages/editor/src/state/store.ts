/**
 * The editor store. Every change to the document goes through `update(recipe)`, which is what
 * makes undo cover everything — canvas gestures and property edits alike.
 *
 * History holds whole `Project` references: immer shares every unchanged object between versions,
 * so a step costs only the nodes it touched.
 */
import {
    type AnyNode,
    type Project,
    type TokenSet,
    collectIds,
    defaultTheme,
    layoutAll,
    projectTokens,
} from '@workspace/ovd-core';
import { type Draft, produce } from 'immer';
import { create } from 'zustand';
import { type DocRef, arrangeVariants, docExists, docRoots, findComponentFile } from '../lib/doc';
import type { LibraryStatus } from '../host';
import { canvasMeasure } from '../lib/measure';

export type BuiltinTool =
    'move' | 'hand' | 'frame' | 'rect' | 'ellipse' | 'line' | 'pen' | 'text' | 'image';
/** A built-in tool, or the `id` of a host tool (see host.tsx). */
export type Tool = BuiltinTool | (string & {});

export interface Viewport {
    /** screen = world × zoom + (x, y) */
    x: number;
    y: number;
    zoom: number;
}

export interface Guide {
    axis: 'x' | 'y';
    /** Position on the snapped axis, in document space. */
    at: number;
    from: number;
    to: number;
}

const HISTORY_LIMIT = 200;

export interface EditorState {
    project: Project | null;
    /** Where the project came from, for the title bar and Save. */
    source: { kind: 'server' | 'local'; name: string } | null;
    doc: DocRef | null;
    selection: string[];
    hover: string | null;
    tool: Tool;
    viewports: Record<string, Viewport>;
    /** Theme the canvas previews. Files are always written with the default theme (spec note 14). */
    previewTheme: string | undefined;
    editingText: string | null;
    /** The page to return to from a component file. */
    lastPage: string | null;
    guides: Guide[];
    past: Project[];
    future: Project[];
    /** The project as last saved; `project !== savedProject` means unsaved changes. */
    savedProject: Project | null;
    /** What the host's resolver reported for the manifest's libraries (#67). */
    libraryStatus: LibraryStatus[];
}

export interface EditorActions {
    loadProject(project: Project, source: EditorState['source']): void;
    /** Marks `project` (default: the current one) as what the server holds. */
    markSaved(project?: Project): void;
    /**
     * Loaded manifest libraries (#42), set on every version of the project — current, saved, undo
     * and redo — so they are neither an undo step nor an unsaved change.
     */
    setLibraries(libraries: Record<string, Project>): void;
    setLibraryStatus(status: LibraryStatus[]): void;
    /** Swaps in a whole project (e.g. a restored version) as one undo step. */
    replaceProject(project: Project): void;
    /** Applies a change to the project, then re-lays out the active document. */
    update(recipe: (draft: Draft<Project>) => void, opts?: { history?: boolean }): void;
    /** Records an undo step now — call at the start of a gesture, then update with history: false. */
    checkpoint(): void;
    undo(): void;
    redo(): void;
    openDoc(doc: DocRef): void;
    select(ids: string[], mode?: 'replace' | 'toggle' | 'add'): void;
    setHover(id: string | null): void;
    setTool(tool: Tool): void;
    setViewport(vp: Viewport): void;
    setPreviewTheme(theme: string | undefined): void;
    setEditingText(id: string | null): void;
    setGuides(guides: Guide[]): void;
}

export type Store = EditorState & EditorActions;

// ---------------------------------------------------------------------------------------------
// Derived data
// ---------------------------------------------------------------------------------------------

const tokenCache = new WeakMap<object, Map<string, TokenSet>>();

/** Resolved tokens for a theme, memoised on the tokens object (unchanged across most edits). */
export function tokenSetFor(project: Project, theme: string | undefined): TokenSet {
    let byTheme = tokenCache.get(project.tokens);
    if (!byTheme) {
        byTheme = new Map();
        tokenCache.set(project.tokens, byTheme);
    }
    const key = theme ?? '';
    let set = byTheme.get(key);
    if (!set) {
        set = projectTokens(project, theme);
        byTheme.set(key, set);
    }
    return set;
}

function relayout(draft: Project, doc: DocRef | null, theme: string | undefined): void {
    const roots = docRoots(draft, doc) as AnyNode[];
    layoutAll(roots, { tokens: tokenSetFor(draft, theme), measure: canvasMeasure });
}

function pruneSelection(
    project: Project | null,
    doc: DocRef | null,
    selection: string[],
): string[] {
    if (!project || !selection.length) return selection;
    const ids = collectIds(docRoots(project, doc));
    const kept = selection.filter((id) => ids.has(id));
    return kept.length === selection.length ? selection : kept;
}

// ---------------------------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------------------------

export const DEFAULT_VIEWPORT: Viewport = { x: 80, y: 80, zoom: 1 };

export const useEditor = create<Store>()((set, get) => ({
    project: null,
    source: null,
    doc: null,
    selection: [],
    hover: null,
    tool: 'move',
    viewports: {},
    previewTheme: undefined,
    editingText: null,
    lastPage: null,
    guides: [],
    past: [],
    future: [],
    savedProject: null,
    libraryStatus: [],

    loadProject(project, source) {
        const theme = defaultTheme(project.manifest);
        const firstPage = project.pages[0];
        const doc: DocRef | null = firstPage ? { kind: 'page', file: firstPage.file } : null;
        const laid = produce(project, (d) => relayout(d, doc, theme));
        set({
            project: laid,
            source,
            doc,
            selection: [],
            hover: null,
            tool: 'move',
            viewports: {},
            previewTheme: theme,
            editingText: null,
            lastPage: null,
            guides: [],
            past: [],
            future: [],
            savedProject: laid,
            libraryStatus: [],
        });
    },

    markSaved(project) {
        set({ savedProject: project ?? get().project });
    },

    setLibraryStatus(libraryStatus) {
        set({ libraryStatus });
    },

    setLibraries(libraries) {
        const { project, savedProject, past, future } = get();
        // Same version in, same version out: `project === savedProject` must survive.
        const seen = new Map<Project, Project>();
        const withLibs = (p: Project | null) => {
            if (!p) return p;
            let next = seen.get(p);
            if (!next) {
                next = produce(p, (d) => {
                    d.libraries = libraries as Draft<Record<string, Project>>;
                });
                seen.set(p, next);
            }
            return next;
        };
        set({
            project: withLibs(project),
            savedProject: withLibs(savedProject),
            past: past.map((p) => withLibs(p)!),
            future: future.map((p) => withLibs(p)!),
        });
    },

    replaceProject(incoming) {
        const { project, past, doc, previewTheme } = get();
        if (!project) return;
        const firstPage = incoming.pages[0];
        const nextDoc: DocRef | null = docExists(incoming, doc)
            ? doc
            : firstPage
              ? { kind: 'page', file: firstPage.file }
              : null;
        const laid = produce(incoming, (d) => relayout(d, nextDoc, previewTheme));
        set({
            project: laid,
            doc: nextDoc,
            past: [...past, project].slice(-HISTORY_LIMIT),
            future: [],
            selection: [],
            editingText: null,
        });
    },

    update(recipe, opts = {}) {
        const { project, doc, previewTheme, past } = get();
        if (!project) return;
        const next = produce(project, (d) => {
            recipe(d);
            relayout(d, doc, previewTheme);
        });
        if (next === project) return;
        const history = opts.history ?? true;
        set({
            project: next,
            past: history ? [...past, project].slice(-HISTORY_LIMIT) : past,
            future: history ? [] : get().future,
        });
    },

    checkpoint() {
        const { project, past } = get();
        if (!project) return;
        set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
    },

    undo() {
        const { past, future, project, doc, selection } = get();
        const prev = past[past.length - 1];
        if (!prev || !project) return;
        set({
            project: prev,
            past: past.slice(0, -1),
            future: [project, ...future],
            selection: pruneSelection(prev, doc, selection),
            editingText: null,
        });
    },

    redo() {
        const { past, future, project, doc, selection } = get();
        const next = future[0];
        if (!next || !project) return;
        set({
            project: next,
            past: [...past, project],
            future: future.slice(1),
            selection: pruneSelection(next, doc, selection),
            editingText: null,
        });
    },

    openDoc(doc) {
        const { project, previewTheme } = get();
        if (!project || !docExists(project, doc)) return;
        const next = produce(project, (d) => {
            if (doc.kind === 'component') {
                const file = findComponentFile(d, doc.file);
                if (file) arrangeVariants(file);
            }
            relayout(d, doc, previewTheme);
        });
        const prev = get().doc;
        set({
            doc,
            project: next,
            selection: [],
            hover: null,
            editingText: null,
            guides: [],
            lastPage: prev?.kind === 'page' ? prev.file : get().lastPage,
        });
    },

    select(ids, mode = 'replace') {
        const current = get().selection;
        let next: string[];
        if (mode === 'replace') next = ids;
        else if (mode === 'add') next = [...new Set([...current, ...ids])];
        else {
            const s = new Set(current);
            for (const id of ids) {
                if (s.has(id)) s.delete(id);
                else s.add(id);
            }
            next = [...s];
        }
        set({ selection: next });
    },

    setHover(id) {
        if (get().hover !== id) set({ hover: id });
    },

    setTool(tool) {
        set({ tool, editingText: null });
    },

    setViewport(vp) {
        const doc = get().doc;
        if (!doc) return;
        set({ viewports: { ...get().viewports, [doc.file]: vp } });
    },

    setPreviewTheme(theme) {
        const { project, doc } = get();
        if (!project) return;
        // Token-bound dimensions (gap, padding) can differ per theme.
        const next = produce(project, (d) => relayout(d, doc, theme));
        set({ previewTheme: theme, project: next });
    },

    setEditingText(id) {
        set({ editingText: id });
    },

    setGuides(guides) {
        if (guides.length === 0 && get().guides.length === 0) return;
        set({ guides });
    },
}));

// ---------------------------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------------------------

export function useViewport(): Viewport {
    return useEditor((s) => (s.doc && s.viewports[s.doc.file]) || DEFAULT_VIEWPORT);
}

const rootsCache = new WeakMap<Project, Map<string, AnyNode[]>>();

/** docRoots with a stable identity per project version — selectors must not return fresh arrays. */
export function cachedDocRoots(project: Project, doc: DocRef | null): AnyNode[] {
    if (!doc) return EMPTY;
    let byDoc = rootsCache.get(project);
    if (!byDoc) {
        byDoc = new Map();
        rootsCache.set(project, byDoc);
    }
    const key = `${doc.kind}:${doc.file}`;
    let roots = byDoc.get(key);
    if (!roots) {
        roots = docRoots(project, doc);
        byDoc.set(key, roots);
    }
    return roots;
}

export function useDocRoots(): AnyNode[] {
    return useEditor((s) => (s.project ? cachedDocRoots(s.project, s.doc) : EMPTY));
}

export function useTokens(): TokenSet | null {
    return useEditor((s) => (s.project ? tokenSetFor(s.project, s.previewTheme) : null));
}

const EMPTY: AnyNode[] = [];

/** Non-reactive access for event handlers. */
export const editor = () => useEditor.getState();
