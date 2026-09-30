/** What the standalone editor shows with no project open: start something, or pick up where you were. */
import { Button } from '@workspace/ui/components/button';
import { FilePlus2, FolderOpen, History, Import, Package, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
    type RecentFolder,
    type Snapshot,
    discardSnapshot,
    forgetFolder,
    readSnapshot,
    recentFolders,
} from './lib/autosave';
import { canOpenFolders, newProject, openFolder, openRecent, restore } from './lib/local';
import { usePickers } from './Pickers';

const when = (iso: string) =>
    new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export function StartScreen() {
    const pickers = usePickers();
    const [snapshot, setSnapshot] = useState<Snapshot>();
    const [recent, setRecent] = useState<RecentFolder[]>([]);

    useEffect(() => {
        void readSnapshot().then((s) => setSnapshot(s?.dirty ? s : undefined));
        void recentFolders().then(setRecent);
    }, []);

    return (
        <main className="bg-canvas grid min-h-full place-items-center p-6">
            {pickers.inputs}
            <div className="flex w-full max-w-md flex-col gap-6">
                <header className="flex items-center gap-3">
                    <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-9" />
                    <div>
                        <h1 className="text-lg font-semibold">OVD Editor</h1>
                        <p className="text-muted-foreground text-xs">
                            Open Vector Design — your files stay on your computer.
                        </p>
                    </div>
                </header>

                {snapshot && (
                    <section
                        aria-label="Unsaved work"
                        className="bg-background flex items-center gap-3 rounded-lg border p-3"
                    >
                        <History className="text-primary size-5 shrink-0" />
                        <div className="min-w-0 flex-1 text-sm">
                            <p className="truncate font-medium">Unsaved work: {snapshot.name}</p>
                            <p className="text-muted-foreground text-xs">
                                Kept in this browser, {when(snapshot.savedAt)}
                            </p>
                        </div>
                        <Button size="sm" onClick={() => restore(snapshot)}>
                            Recover
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            aria-label="Discard unsaved work"
                            onClick={() =>
                                void discardSnapshot().then(() => setSnapshot(undefined))
                            }
                        >
                            <X className="size-4" />
                        </Button>
                    </section>
                )}

                <nav aria-label="Start" className="grid grid-cols-2 gap-2">
                    <Button variant="outline" className="h-16 flex-col gap-1" onClick={newProject}>
                        <FilePlus2 className="size-5" /> New project
                    </Button>
                    <Button
                        variant="outline"
                        className="h-16 flex-col gap-1"
                        onClick={canOpenFolders ? () => void openFolder() : pickers.pickUpload}
                    >
                        <FolderOpen className="size-5" /> Open folder
                    </Button>
                    <Button
                        variant="outline"
                        className="h-16 flex-col gap-1"
                        onClick={pickers.pickArchive}
                    >
                        <Package className="size-5" /> Open .tar.gz
                    </Button>
                    <Button
                        variant="outline"
                        className="h-16 flex-col gap-1"
                        onClick={pickers.pickSketch}
                    >
                        <Import className="size-5" /> Import Sketch
                    </Button>
                </nav>
                {!canOpenFolders && (
                    <p className="text-muted-foreground text-xs">
                        This browser cannot save into folders: a folder opens as a copy, and Save
                        downloads a .tar.gz. Chrome and Edge can edit the folder in place.
                    </p>
                )}

                {recent.length > 0 && (
                    <section aria-label="Recent folders" className="flex flex-col gap-1">
                        <h2 className="text-muted-foreground text-xs font-medium">
                            Recent folders
                        </h2>
                        <ul className="bg-background divide-y rounded-lg border">
                            {recent.map((r) => (
                                <li key={r.openedAt} className="flex items-center">
                                    <button
                                        className="hover:bg-accent flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left text-sm"
                                        onClick={() => void openRecent(r.handle)}
                                    >
                                        <FolderOpen className="text-muted-foreground size-4 shrink-0" />
                                        <span className="truncate">{r.name}</span>
                                        <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                                            {when(r.openedAt)}
                                        </span>
                                    </button>
                                    <button
                                        className="text-muted-foreground hover:text-foreground px-2"
                                        aria-label={`Forget ${r.name}`}
                                        onClick={() =>
                                            void forgetFolder(r.handle)
                                                .then(recentFolders)
                                                .then(setRecent)
                                        }
                                    >
                                        <X className="size-3.5" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    </section>
                )}
            </div>
        </main>
    );
}
