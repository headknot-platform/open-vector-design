import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collect, packageRoot } from './files';
import { starterFiles } from './starter';
import { tarGz, untarGz } from './tar';

let tmp: string | undefined;
afterEach(() => tmp && rmSync(tmp, { recursive: true, force: true }));
const hasTar = (() => {
    try {
        execFileSync('tar', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
})();

describe('.tar.gz', () => {
    it('round-trips a package', () => {
        const files = starterFiles();
        const back = packageRoot(collect(untarGz(tarGz(files, 'starter'))));
        expect(back).toEqual(files);
    });

    it.skipIf(!hasTar)('writes archives the system tar reads', () => {
        tmp = mkdtempSync(join(tmpdir(), 'ovd-tar-'));
        const long = `assets/${'deep/'.repeat(20)}logo.svg`; // > 100 characters: ustar prefix
        writeFileSync(
            join(tmp, 'a.tar.gz'),
            tarGz({ 'manifest.json': '{}', [long]: '<svg/>' }, 'pkg'),
        );
        execFileSync('tar', ['-xzf', 'a.tar.gz'], { cwd: tmp });
        expect(readFileSync(join(tmp, 'pkg', long), 'utf8')).toBe('<svg/>');
        expect(readFileSync(join(tmp, 'pkg/manifest.json'), 'utf8')).toBe('{}');
    });

    it.skipIf(!hasTar)('reads archives the system tar writes, skipping clutter', () => {
        tmp = mkdtempSync(join(tmpdir(), 'ovd-tar-'));
        const long = `assets/${'x'.repeat(120)}.svg`; // a long single name: pax or GNU long-name entry
        mkdirSync(join(tmp, 'my-app/assets'), { recursive: true });
        writeFileSync(join(tmp, 'my-app/manifest.json'), '{"name":"x"}');
        writeFileSync(join(tmp, 'my-app', long), '<svg/>');
        writeFileSync(join(tmp, 'my-app/.DS_Store'), 'junk');
        execFileSync('tar', ['-czf', 'b.tar.gz', 'my-app'], { cwd: tmp });
        const files = packageRoot(collect(untarGz(readFileSync(join(tmp, 'b.tar.gz')))));
        expect(files).toEqual({ 'manifest.json': '{"name":"x"}', [long]: '<svg/>' });
    });

    it('refuses what is not an archive, and paths that leave the folder', () => {
        expect(() => untarGz(new Uint8Array([1, 2, 3]))).toThrow(/Not a readable/);
        expect(() => collect([['../evil', new Uint8Array()]])).toThrow(/"\.\."/);
        expect(() => collect([['/etc/passwd', new Uint8Array()]])).toThrow(/relative/);
    });
});
