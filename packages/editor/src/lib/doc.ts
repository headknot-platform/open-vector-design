/**
 * The editor edits one "document" at a time: a page, or a component file (whose variants are shown
 * side by side like frames). Everything the canvas does goes through these helpers.
 */
import type { AnyNode, ComponentFile, Page, Project } from '@workspace/ovd-core';

export interface DocRef {
    kind: 'page' | 'component';
    file: string;
}

export function findPage(project: Project, file: string): Page | undefined {
    return project.pages.find((p) => p.file === file);
}

export function findComponentFile(project: Project, file: string): ComponentFile | undefined {
    // `core-ui:components/button.svg` — a loaded library's file (#42), read-only.
    const lib = /^([\w-]+):(?!\/\/)(.+)$/.exec(file);
    if (lib) return project.libraries?.[lib[1]!]?.components.find((c) => c.file === lib[2]);
    return project.components.find((c) => c.file === file);
}

/** The top-level nodes of a document. Mutations through the result reach the project when called
 *  on an immer draft. */
export function docRoots(project: Project, doc: DocRef | null): AnyNode[] {
    if (!doc) return [];
    if (doc.kind === 'page') return findPage(project, doc.file)?.children ?? [];
    return findComponentFile(project, doc.file)?.sets.flatMap((s) => s.variants) ?? [];
}

export function docName(project: Project, doc: DocRef | null): string {
    if (!doc) return '';
    if (doc.kind === 'page') return findPage(project, doc.file)?.name ?? doc.file;
    return findComponentFile(project, doc.file)?.name ?? doc.file;
}

export function docExists(project: Project, doc: DocRef | null): boolean {
    if (!doc) return false;
    return doc.kind === 'page'
        ? !!findPage(project, doc.file)
        : !!findComponentFile(project, doc.file);
}

const VARIANT_GAP = 48;

/**
 * Places a component file's variants side by side, one row per set. Symbols carry no position in
 * the file (the writer never emits x/y for `<symbol>`), so this never shows up as a diff.
 */
export function arrangeVariants(file: ComponentFile): void {
    let y = 0;
    for (const set of file.sets) {
        let x = 0;
        let rowHeight = 0;
        for (const v of set.variants) {
            v.x = x;
            v.y = y;
            x += v.width + VARIANT_GAP;
            rowHeight = Math.max(rowHeight, v.height);
        }
        y += rowHeight + VARIANT_GAP * 2;
    }
}
