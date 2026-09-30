/**
 * Assets: the project's components (spec §5) and those of its libraries (#42, read-only). Click to
 * place, drag onto the canvas, or — for the project's own — edit.
 */
import type { ComponentFile, Project } from '@workspace/ovd-core';
import { ScrollArea } from '@workspace/ui/components/scroll-area';
import { cn } from '@workspace/ui/lib/utils';
import { Component, PencilLine } from 'lucide-react';
import { ComponentPreview } from '../canvas/NodeView';
import { insertInstance } from '../state/components';
import { editor, useEditor } from '../state/store';
import { LibrariesSection } from './LibrariesSection';

export const COMPONENT_MIME = 'application/x-ovd-component';

/** One component file's sets. `file` is qualified (`name:components/x.svg`) for a library. */
function ComponentGrid({
    file,
    component,
    title,
    editable,
}: {
    file: string;
    component: ComponentFile;
    title: string;
    editable: boolean;
}) {
    const doc = useEditor((s) => s.doc);
    return (
        <section>
            <div className="flex h-6 items-center justify-between px-1">
                <h3 className="truncate text-[11px] font-semibold">{title}</h3>
                {editable && (
                    <button
                        className={cn(
                            'hover:bg-accent text-muted-foreground flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]',
                            doc?.file === file && 'text-primary',
                        )}
                        onClick={() => editor().openDoc({ kind: 'component', file })}
                        title={`Edit ${file}`}
                    >
                        <PencilLine className="size-3" /> Edit
                    </button>
                )}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
                {component.sets.map((set) => {
                    const preview = set.variants[0];
                    if (!preview) return null;
                    return (
                        <button
                            key={set.id}
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.setData(
                                    COMPONENT_MIME,
                                    JSON.stringify({ file, setId: set.id }),
                                );
                                e.dataTransfer.effectAllowed = 'copy';
                            }}
                            onClick={() => insertInstance(file, set.id)}
                            className="hover:border-primary group bg-muted/40 flex flex-col overflow-hidden rounded-md border text-left"
                            title={`Place ${set.name} (or drag onto the canvas)`}
                        >
                            <div className="bg-canvas flex h-16 items-center justify-center p-2">
                                <ComponentPreview
                                    node={preview}
                                    file={file}
                                    className="max-h-full max-w-full"
                                />
                            </div>
                            <div className="flex items-center gap-1 px-1.5 py-1 text-[11px]">
                                <Component className="text-primary size-3 shrink-0" />
                                <span className="truncate">{set.name}</span>
                                {set.isSet && (
                                    <span className="text-muted-foreground ml-auto shrink-0">
                                        {set.variants.length}
                                    </span>
                                )}
                            </div>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

const NO_LIBRARIES: Record<string, Project> = {};

export function AssetsPanel() {
    const components = useEditor((s) => s.project?.components ?? []);
    const libraries = useEditor((s) => s.project?.libraries ?? NO_LIBRARIES);
    const refs = useEditor((s) => s.project?.manifest.libraries);
    const libraryFiles = Object.entries(libraries).flatMap(([name, lib]) =>
        lib.components.map((c) => ({ name, component: c })),
    );
    return (
        <ScrollArea className="h-full">
            <div className="flex flex-col gap-3 p-2">
                <LibrariesSection />
                {!components.length && !libraryFiles.length && (
                    <p className="text-muted-foreground px-1 text-xs">
                        No components yet. Select a frame and press ⌥⌘K to make one.
                    </p>
                )}
                {components.map((c) => (
                    <ComponentGrid
                        key={c.file}
                        file={c.file}
                        component={c}
                        title={c.name}
                        editable
                    />
                ))}
                {libraryFiles.map(({ name, component }) => (
                    <ComponentGrid
                        key={`${name}:${component.file}`}
                        file={`${name}:${component.file}`}
                        component={component}
                        title={`${component.name} · ${name}@${refs?.find((r) => r.name === name)?.ref ?? ''}`}
                        editable={false}
                    />
                ))}
            </div>
        </ScrollArea>
    );
}
