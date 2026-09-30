/**
 * The manifest's libraries (#42, spec §3): other OVD packages pinned to a Git tag or commit. Editing
 * a ref is an ordinary manifest edit; the host resolves it (`host.libraries` reports the pinned
 * commit) and hands the files back with `editor().setLibraries`.
 */
import type { ManifestLibrary } from '@workspace/ovd-core';
import { Button } from '@workspace/ui/components/button';
import { Input } from '@workspace/ui/components/input';
import { ChevronDown, ChevronRight, Library, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { type LibraryStatus, useHost } from '../host';
import { editor, useEditor } from '../state/store';

const NAME = /^[\w-]{1,40}$/;
// A constant, not `?? []`: a selector must return the same value for the same state, or the
// store re-renders forever (this crashed the Assets tab for projects without libraries).
const NO_LIBRARIES: ManifestLibrary[] = [];
const NO_STATUS: LibraryStatus[] = [];

function setLibraries(fn: (libs: { name: string; url: string; ref: string }[]) => void) {
    editor().update((d) => {
        const libs = [...(d.manifest.libraries ?? [])];
        fn(libs);
        if (libs.length) d.manifest.libraries = libs;
        else delete d.manifest.libraries;
    });
}

export function LibrariesSection() {
    const libraries = useEditor((s) => s.project?.manifest.libraries ?? NO_LIBRARIES);
    const { libraries: host } = useHost();
    const status = host?.status ?? NO_STATUS;
    const canEdit = host?.editable ?? true;
    const [open, setOpen] = useState(libraries.length > 0);
    const [draft, setDraft] = useState({ name: '', url: '', ref: '' });
    const taken = libraries.some((l) => l.name === draft.name);
    const valid =
        NAME.test(draft.name) && !taken && /^https?:\/\//.test(draft.url) && draft.ref.trim();

    return (
        <section aria-label="Libraries" className="border-b pb-2">
            <button
                className="hover:bg-accent/60 flex h-6 w-full items-center gap-1 rounded px-1 text-[11px] font-semibold"
                onClick={() => setOpen(!open)}
            >
                {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
                <Library className="size-3" /> Libraries
                <span className="text-muted-foreground ml-auto font-normal">
                    {libraries.length || ''}
                </span>
            </button>
            {open && (
                <div className="flex flex-col gap-1.5 px-1 pt-1">
                    {libraries.map((lib, i) => {
                        const s = status.find((x) => x.name === lib.name && x.ref === lib.ref);
                        return (
                            <div
                                key={`${lib.name}@${lib.ref}`}
                                className="rounded border p-1.5 text-[11px]"
                            >
                                <div className="flex items-center gap-1">
                                    <span className="truncate font-medium">{lib.name}</span>
                                    <span className="text-muted-foreground">@</span>
                                    <Input
                                        className="h-6 min-w-0 flex-1 px-1.5 text-[11px]"
                                        defaultValue={lib.ref}
                                        disabled={!canEdit}
                                        aria-label={`${lib.name} version`}
                                        onKeyDown={(e) => e.stopPropagation()}
                                        onBlur={(e) => {
                                            const ref = e.target.value.trim();
                                            if (ref && ref !== lib.ref)
                                                setLibraries((l) => {
                                                    l[i] = { ...l[i]!, ref };
                                                });
                                        }}
                                    />
                                    {canEdit && (
                                        <button
                                            className="text-muted-foreground hover:text-destructive"
                                            aria-label={`Remove ${lib.name}`}
                                            onClick={() => setLibraries((l) => void l.splice(i, 1))}
                                        >
                                            <Trash2 className="size-3" />
                                        </button>
                                    )}
                                </div>
                                <p className="text-muted-foreground truncate" title={lib.url}>
                                    {s?.error
                                        ? `⚠ ${s.error}`
                                        : s?.sha
                                          ? `pinned ${s.sha.slice(0, 7)} · ${lib.url}`
                                          : lib.url}
                                </p>
                            </div>
                        );
                    })}
                    {canEdit && (
                        <form
                            className="grid gap-1"
                            onKeyDown={(e) => e.stopPropagation()}
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (!valid) return;
                                setLibraries(
                                    (l) =>
                                        void l.push({
                                            name: draft.name,
                                            url: draft.url.trim(),
                                            ref: draft.ref.trim(),
                                        }),
                                );
                                setDraft({ name: '', url: '', ref: '' });
                            }}
                        >
                            <div className="grid grid-cols-2 gap-1">
                                <Input
                                    className="h-6 text-[11px]"
                                    placeholder="name (core-ui)"
                                    aria-label="Library name"
                                    value={draft.name}
                                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                                />
                                <Input
                                    className="h-6 text-[11px]"
                                    placeholder="tag or commit"
                                    aria-label="Library version"
                                    value={draft.ref}
                                    onChange={(e) => setDraft({ ...draft, ref: e.target.value })}
                                />
                            </div>
                            <Input
                                className="h-6 text-[11px]"
                                placeholder="https://github.com/acme/core-ui-ovd"
                                aria-label="Library repository"
                                value={draft.url}
                                onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                            />
                            {taken && (
                                <p className="text-destructive text-[11px]">That name is taken.</p>
                            )}
                            <Button
                                type="submit"
                                size="sm"
                                className="h-6 text-[11px]"
                                disabled={!valid}
                            >
                                Add library
                            </Button>
                        </form>
                    )}
                </div>
            )}
        </section>
    );
}
