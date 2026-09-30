/**
 * The standalone editor's project I/O (#69): a package folder on disk (File System Access API,
 * Chrome / Edge), a folder upload or `.tar.gz` elsewhere, and Sketch import — all reduced to a
 * FileMap and read with ovd-core. A save writes `packageFiles()`: canonical sources plus the
 * flattened `exports/`, exactly what the server writes, so a folder saved here matches.
 */
import { canvasMeasure, editor, useEditor } from '@workspace/editor';
import {
    type FileMap,
    type Project,
    asBytes,
    importSketch,
    packageFiles,
    readProject,
} from '@workspace/ovd-core';
import { unzipSync } from 'fflate';
import { toast } from 'sonner';
import { create } from 'zustand';
import { type Snapshot, discardSnapshot, rememberFolder, snapshotNow } from './autosave';
import { collect, packagePath, packageRoot } from './files';
import { loadStarter } from './starter';
import { tarGz, untarGz } from './tar';

/** Only these may be deleted by a save — a README or CI config beside the package is never touched. */
const MANAGED = /^(manifest\.json$|pages\/|components\/|tokens\/|assets\/|exports\/|comments\/)/;

export const canOpenFolders = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

interface LocalState {
    /** The folder saves go to, by name; null when saving downloads a `.tar.gz`. */
    folder: string | null;
    saving: boolean;
    lastSaved: string | null;
}

export const useLocal = create<LocalState>(() => ({
    folder: null,
    saving: false,
    lastSaved: null,
}));

let folder: FileSystemDirectoryHandle | null = null;
/** What the folder held after the last read or write; null = not read since a reload. */
let onDisk: FileMap | null = null;

export const openFolderHandle = () => folder;

function slug(s: string): string {
    return (
        s
            .toLowerCase()
            .replace(/[^\w-]+/g, '-')
            .replace(/^-+|-+$/g, '') || 'project'
    );
}

function same(a: string | Uint8Array | undefined, b: string | Uint8Array): boolean {
    if (a === undefined) return false;
    if (typeof a === 'string' && typeof b === 'string') return a === b;
    const x = asBytes(a);
    const y = asBytes(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
}

function download(bytes: Uint8Array, name: string, type: string): void {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function fail(action: string, e: unknown): void {
    if ((e as DOMException)?.name === 'AbortError') return; // a picker was cancelled
    toast.error(`${action} failed`, { description: (e as Error)?.message ?? String(e) });
}

function load(
    project: Project,
    name: string,
    target: FileSystemDirectoryHandle | null,
    disk: FileMap | null,
): void {
    folder = target;
    onDisk = disk;
    editor().loadProject(project, { kind: 'local', name });
    useLocal.setState({ folder: target?.name ?? null, saving: false, lastSaved: null });
}

/** Marks the open project as never saved anywhere (a new project, an import, a restored copy). */
function markUnsaved(): void {
    useEditor.setState({ savedProject: null });
}

// ---------------------------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------------------------

async function readFolder(dir: FileSystemDirectoryHandle, prefix = ''): Promise<FileMap> {
    const entries: [string, Uint8Array][] = [];
    const walk = async (d: FileSystemDirectoryHandle, at: string) => {
        for await (const [name, handle] of d.entries()) {
            const path = at + name;
            if (packagePath(path) === 'skip') continue;
            if (handle.kind === 'directory')
                await walk(handle as FileSystemDirectoryHandle, `${path}/`);
            else {
                const file = await (handle as FileSystemFileHandle).getFile();
                entries.push([path, new Uint8Array(await file.arrayBuffer())]);
            }
        }
    };
    await walk(dir, prefix);
    return collect(entries);
}

async function writable(dir: FileSystemDirectoryHandle): Promise<void> {
    if ((await dir.queryPermission?.({ mode: 'readwrite' })) === 'granted') return;
    if ((await dir.requestPermission?.({ mode: 'readwrite' })) !== 'granted')
        throw new Error('Permission to edit the folder was not granted');
}

async function dirFor(root: FileSystemDirectoryHandle, path: string, create: boolean) {
    let dir = root;
    const parts = path.split('/');
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part, { create });
    return { dir, name: parts.at(-1)! };
}

async function openHandle(handle: FileSystemDirectoryHandle): Promise<void> {
    await writable(handle);
    const files = await readFolder(handle);
    if (!('manifest.json' in files))
        throw new Error(`${handle.name} has no manifest.json — pick the package folder itself`);
    load(readProject(files), handle.name, handle, files);
    await rememberFolder(handle);
}

export async function openFolder(): Promise<void> {
    try {
        const handle = await window.showDirectoryPicker!({ mode: 'readwrite', id: 'ovd-package' });
        await openHandle(handle);
    } catch (e) {
        fail('Open folder', e);
    }
}

/** Reopens a folder from the recent list; access is asked for again after a reload. */
export async function openRecent(handle: FileSystemDirectoryHandle): Promise<boolean> {
    try {
        await openHandle(handle);
        return true;
    } catch (e) {
        fail(`Open ${handle.name}`, e);
        return false;
    }
}

/** Writes `files` into the folder: only what changed, and deletes only managed files. */
async function writeFolder(dir: FileSystemDirectoryHandle, files: FileMap): Promise<number> {
    await writable(dir);
    const before = onDisk ?? (await readFolder(dir));
    let written = 0;
    for (const [path, content] of Object.entries(files)) {
        if (same(before[path], content)) continue;
        const { dir: parent, name } = await dirFor(dir, path, true);
        const w = await (await parent.getFileHandle(name, { create: true })).createWritable();
        await w.write(typeof content === 'string' ? content : new Blob([content as BlobPart]));
        await w.close();
        written++;
    }
    for (const path of Object.keys(before)) {
        if (path in files || !MANAGED.test(path)) continue;
        try {
            const { dir: parent, name } = await dirFor(dir, path, false);
            await parent.removeEntry(name);
        } catch {
            /* already gone */
        }
    }
    onDisk = {
        ...Object.fromEntries(Object.entries(before).filter(([p]) => !MANAGED.test(p))),
        ...files,
    };
    return written;
}

// ---------------------------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------------------------

/** A folder chosen with `<input webkitdirectory>`: read-only here, saved by download. */
export async function openUpload(list: FileList | File[]): Promise<void> {
    try {
        const entries: [string, Uint8Array][] = [];
        for (const file of Array.from(list))
            entries.push([
                file.webkitRelativePath || file.name,
                new Uint8Array(await file.arrayBuffer()),
            ]);
        const files = packageRoot(collect(entries));
        const project = readProject(files);
        load(project, project.manifest.name, null, null);
    } catch (e) {
        fail('Open folder', e);
    }
}

export async function openArchive(file: File): Promise<void> {
    try {
        const files = packageRoot(collect(untarGz(new Uint8Array(await file.arrayBuffer()))));
        load(readProject(files), file.name.replace(/\.(tar\.gz|tgz)$/i, ''), null, null);
    } catch (e) {
        fail(`Open ${file.name}`, e);
    }
}

/** A `.sketch` file as a new, unsaved OVD project (spec §11). */
export async function importSketchFile(file: File): Promise<void> {
    try {
        const { project, warnings } = importSketch(
            unzipSync(new Uint8Array(await file.arrayBuffer())),
            {
                name: file.name.replace(/\.sketch$/i, ''),
                measure: canvasMeasure,
            },
        );
        load(project, project.manifest.name, null, null);
        markUnsaved();
        const summary = `${project.pages.length} page(s), ${project.components[0]?.sets.length ?? 0} symbol(s)`;
        if (warnings.length)
            toast.warning(`Imported ${file.name} — ${warnings.length} layer(s) not imported`, {
                description: [summary, ...warnings.slice(0, 4)].join('\n'),
                duration: 10000,
            });
        else toast.success(`Imported ${file.name}`, { description: summary });
    } catch (e) {
        fail('Sketch import', e);
    }
}

export function newProject(): void {
    load(loadStarter(), 'Untitled', null, null);
    markUnsaved();
}

/** The browser copy from before a reload; its folder, if any, is re-read on the first save. */
export function restore(snap: Snapshot): void {
    load(readProject(snap.files), snap.name, snap.folder ?? null, null);
    if (snap.dirty) markUnsaved();
}

// ---------------------------------------------------------------------------------------------
// Save
// ---------------------------------------------------------------------------------------------

const filesOf = (project: Project) => packageFiles(project, { measure: canvasMeasure });

export function downloadArchive(): void {
    const { project, source } = editor();
    if (!project) return;
    const name = slug(source?.name ?? project.manifest.name);
    download(tarGz(filesOf(project), name), `${name}.tar.gz`, 'application/gzip');
    if (!folder) editor().markSaved(project);
    void snapshotNow(folder);
}

/** ⌘S: into the open folder, or a `.tar.gz` download when there is none. */
export async function save(): Promise<void> {
    const { project } = editor();
    if (!project) return;
    if (!folder) return downloadArchive();
    useLocal.setState({ saving: true });
    try {
        await writeFolder(folder, filesOf(project));
        editor().markSaved(project);
        useLocal.setState({ lastSaved: new Date().toISOString() });
        void snapshotNow(folder);
    } catch (e) {
        fail('Save', e);
    } finally {
        useLocal.setState({ saving: false });
    }
}

/** Chooses a folder and saves the project into it; later saves go there. */
export async function saveAsFolder(): Promise<void> {
    const { project } = editor();
    if (!project) return;
    try {
        const handle = await window.showDirectoryPicker!({ mode: 'readwrite', id: 'ovd-package' });
        await writable(handle);
        const existing = await readFolder(handle);
        const manifest = existing['manifest.json'];
        if (
            manifest !== undefined &&
            !window.confirm(
                `${handle.name} already holds an OVD package. Replace it with this project?`,
            )
        )
            return;
        folder = handle;
        onDisk = existing;
        useLocal.setState({ folder: handle.name });
        useEditor.setState({ source: { kind: 'local', name: handle.name }, savedProject: null });
        await save();
        await rememberFolder(handle);
    } catch (e) {
        fail('Save to folder', e);
    }
}

export async function closeProject(): Promise<void> {
    const { project, savedProject } = editor();
    if (
        project &&
        project !== savedProject &&
        !window.confirm(
            'Close without saving? Unsaved changes stay in this browser until you open something else.',
        )
    )
        return;
    folder = null;
    onDisk = null;
    useEditor.setState({ project: null, savedProject: null, past: [], future: [], doc: null });
    useLocal.setState({ folder: null, saving: false, lastSaved: null });
    if (project === savedProject) await discardSnapshot();
}
