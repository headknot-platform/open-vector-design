import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { packageFiles } from './export';
import { exportDir, readDir } from './node';
import { readProject } from './project';

const STARTER = join(__dirname, '../../../examples/starter');
let dir: string;

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('ovd export', () => {
    it('writes the exports a save writes, and removes stale ones', () => {
        dir = mkdtempSync(join(tmpdir(), 'ovd-export-'));
        cpSync(STARTER, dir, { recursive: true });
        writeFileSync(join(dir, 'exports-stale.txt'), 'outside exports/: kept');
        cpSync(join(STARTER, 'manifest.json'), join(dir, 'exports', 'old-page.svg'), {
            recursive: true,
        });

        const { written, removed } = exportDir(dir);
        expect(written).toEqual(['exports/dashboard.svg', 'exports/onboarding.svg']);
        expect(removed).toEqual(['exports/old-page.svg']);
        expect(existsSync(join(dir, 'exports-stale.txt'))).toBe(true);

        const expected = packageFiles(readProject(readDir(STARTER)));
        const onDisk = readDir(dir);
        for (const path of written) expect(onDisk[path]).toBe(expected[path]);
    });

    it('does nothing when the exports are current', () => {
        dir = mkdtempSync(join(tmpdir(), 'ovd-export-'));
        cpSync(STARTER, dir, { recursive: true });
        exportDir(dir);
        expect(exportDir(dir)).toEqual({ written: [], removed: [] });
    });
});
