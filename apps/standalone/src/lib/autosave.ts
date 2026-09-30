/**
 * The browser copy (#69): the working project goes to IndexedDB shortly after every change, so a
 * closed tab or a crash loses nothing, and the start screen offers it back. Picked folders are
 * remembered too — a folder handle survives a reload; access is asked for again on reopen.
 *
 * IndexedDB can be missing or refused (private modes, blocked site data): every call is guarded,
 * and the editor works without it.
 */
import { type FileMap, writeProject } from '@workspace/ovd-core';
import { useEditor } from '@workspace/editor';
import { del, get, set } from 'idb-keyval';

const SNAPSHOT = 'ovd:standalone:snapshot';
const RECENT = 'ovd:standalone:recent';
const DELAY = 800;
const RECENT_MAX = 6;

export interface Snapshot {
    files: FileMap;
    name: string;
    /** The folder it came from, if any. */
    folder?: FileSystemDirectoryHandle;
    /** Changes that were not saved to a folder or downloaded. */
    dirty: boolean;
    savedAt: string;
}

export interface RecentFolder {
    name: string;
    handle: FileSystemDirectoryHandle;
    openedAt: string;
}

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
        if (typeof indexedDB === 'undefined') return undefined;
        return await fn();
    } catch {
        return undefined;
    }
}

export async function readSnapshot(): Promise<Snapshot | undefined> {
    const snap = await safe(() => get<Snapshot>(SNAPSHOT));
    return snap?.files ? snap : undefined;
}

export async function discardSnapshot(): Promise<void> {
    await safe(() => del(SNAPSHOT));
}

/** Writes the snapshot after each change or save; `folder()` is the open folder, if any. */
export function startAutosave(folder: () => FileSystemDirectoryHandle | null): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => void snapshotNow(folder()), DELAY);
    };
    const unsubscribe = useEditor.subscribe((s, prev) => {
        if (!s.project) return;
        if (s.project === prev.project && s.savedProject === prev.savedProject) return;
        schedule();
    });
    // The project was loaded (a new one, an import) before the editor — and this — mounted.
    schedule();
    return () => {
        clearTimeout(timer);
        unsubscribe();
    };
}

export async function snapshotNow(folder: FileSystemDirectoryHandle | null): Promise<void> {
    const { project, savedProject, source } = useEditor.getState();
    if (!project) return;
    const snap: Snapshot = {
        files: writeProject(project),
        name: source?.name ?? project.manifest.name,
        ...(folder ? { folder } : {}),
        dirty: project !== savedProject,
        savedAt: new Date().toISOString(),
    };
    await safe(() => set(SNAPSHOT, snap));
}

export async function recentFolders(): Promise<RecentFolder[]> {
    return (await safe(() => get<RecentFolder[]>(RECENT))) ?? [];
}

export async function rememberFolder(handle: FileSystemDirectoryHandle): Promise<void> {
    const list = await recentFolders();
    const kept: RecentFolder[] = [];
    for (const r of list)
        if (!(await r.handle.isSameEntry?.(handle).catch(() => false))) kept.push(r);
    const next = [{ name: handle.name, handle, openedAt: new Date().toISOString() }, ...kept];
    await safe(() => set(RECENT, next.slice(0, RECENT_MAX)));
}

export async function forgetFolder(handle: FileSystemDirectoryHandle): Promise<void> {
    const list = await recentFolders();
    const kept: RecentFolder[] = [];
    for (const r of list)
        if (!(await r.handle.isSameEntry?.(handle).catch(() => false))) kept.push(r);
    await safe(() => set(RECENT, kept));
}
