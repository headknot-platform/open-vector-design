import { editor } from '@workspace/editor';
import { packageFiles } from '@workspace/ovd-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { asHandle, FakeDir } from '../test/fake-fs';
import { requests } from '../test/setup';
import { collect, packageRoot } from './files';
import { closeProject, openRecent, save } from './local';
import { starterFiles } from './starter';
import { untarGz } from './tar';

const text = (files: Record<string, string | Uint8Array>) =>
    Object.fromEntries(
        Object.entries(files).map(([p, c]) => [
            p,
            typeof c === 'string' ? c : new TextDecoder().decode(c),
        ]),
    );

let downloads: Blob[] = [];
beforeEach(() => {
    downloads = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
        downloads.push(b as Blob);
        return 'blob:test';
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});
afterEach(async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await closeProject();
});

describe('standalone project I/O (#69)', () => {
    it('saves into the folder: package files with exports, only what changed, never a README', async () => {
        const dir = FakeDir.from({
            ...starterFiles(),
            'README.md': '# Mine',
            'pages/notes.svg': '<svg/>',
            'exports/deleted.svg': '<svg/>',
        });
        expect(await openRecent(asHandle(dir))).toBe(true);
        expect(editor().source?.name).toBe('my-design');

        editor().update((d) => void (d.manifest.name = 'Renamed'));
        await save();

        const expected = text(packageFiles(editor().project!));
        const onDisk = dir.files();
        expect(onDisk['README.md']).toBe('# Mine'); // not ours: kept
        expect(onDisk['pages/notes.svg']).toBe('<svg/>'); // unknown to the format: preserved
        expect(onDisk['exports/deleted.svg']).toBeUndefined(); // a stale export: removed
        for (const [path, content] of Object.entries(expected)) expect(onDisk[path]).toBe(content);
        expect(Object.keys(expected).some((p) => p.startsWith('exports/'))).toBe(true);
        expect(JSON.parse(onDisk['manifest.json']!).name).toBe('Renamed');
        expect(editor().project).toBe(editor().savedProject);
        expect(requests).toEqual([]);
    });

    it('refuses a folder without a manifest at its root', async () => {
        const dir = FakeDir.from({ 'inner/manifest.json': '{}' });
        expect(await openRecent(asHandle(dir))).toBe(false);
        expect(editor().project).toBeNull();
    });

    it('downloads a .tar.gz when no folder is open, which reopens as the same package', async () => {
        const dir = FakeDir.from(starterFiles());
        await openRecent(asHandle(dir));
        await closeProject();
        const { restore } = await import('./local');
        restore({ files: starterFiles(), name: 'Starter', dirty: true, savedAt: '' });
        expect(editor().project).not.toBe(editor().savedProject);

        await save();
        expect(downloads).toHaveLength(1);
        const files = packageRoot(
            collect(untarGz(new Uint8Array(await downloads[0]!.arrayBuffer()))),
        );
        expect(text(files)).toEqual(text(packageFiles(editor().project!)));
        expect(editor().project).toBe(editor().savedProject);
    });
});
