/**
 * Manifest libraries (#42, #67): the editor decides *when* they are resolved — when a project opens
 * and whenever its list changes (an edit, undo, a restored version) — and the host decides *how*
 * (`host.libraries.resolve`). The files go onto every version of the project with `setLibraries`,
 * so they are neither an undo step nor an unsaved change; the status goes to the Libraries section.
 */
import type { Project } from '@workspace/ovd-core';
import { useEffect, useRef } from 'react';
import type { EditorHost } from '../host';
import { editor, useEditor } from '../state/store';

type Resolve = NonNullable<NonNullable<EditorHost['libraries']>['resolve']>;

export function useLibraryResolution(resolve: Resolve | undefined): void {
    // Immer keeps this reference until the list itself changes, so other edits never resolve.
    const libs = useEditor((s) => s.project?.manifest.libraries);
    // A host may pass a new function on every render; that alone must not resolve again.
    const latest = useRef(resolve);
    latest.current = resolve;
    const seq = useRef(0);

    useEffect(() => {
        const call = ++seq.current;
        const s = editor();
        if (!libs?.length) {
            if (Object.keys(s.project?.libraries ?? {}).length) s.setLibraries({});
            if (s.libraryStatus.length) s.setLibraryStatus([]);
            return;
        }
        if (!latest.current) return;
        latest.current(libs).then(
            (resolved) => {
                if (call !== seq.current) return; // a newer list is being resolved
                const files: Record<string, Project> = {};
                for (const lib of resolved) if (lib.project) files[lib.name] = lib.project;
                editor().setLibraries(files);
                editor().setLibraryStatus(
                    resolved.map(({ name, ref, sha, error }) => ({ name, ref, sha, error })),
                );
            },
            (e: unknown) => {
                if (call !== seq.current) return;
                const error = e instanceof Error ? e.message : String(e);
                editor().setLibraryStatus(
                    libs.map((l) => ({ name: l.name, ref: l.ref, sha: null, error })),
                );
            },
        );
    }, [libs]);
}
