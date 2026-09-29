/**
 * `ovd` command line (spec §10).
 *
 *   pnpm --filter @workspace/ovd-core ovd fmt <project-dir>
 *   pnpm --filter @workspace/ovd-core ovd validate <project-dir>
 *   pnpm --filter @workspace/ovd-core ovd diff <before-dir> <after-dir>
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { type FileMap, asBytes, readProject, writeProject } from './project';
import { validateProject } from './validate';
import { diffProjects, formatDiff } from './diff';

const TEXT = /\.(svg|json|md|txt|css)$|^\.git\w+$/;

function readDir(root: string): FileMap {
    const out: FileMap = {};
    const visit = (dir: string) => {
        for (const name of readdirSync(dir)) {
            if (name === '.git' || name === 'node_modules' || name === '.DS_Store') continue;
            const full = join(dir, name);
            if (statSync(full).isDirectory()) visit(full);
            else {
                const rel = relative(root, full).split('\\').join('/');
                const buf = readFileSync(full);
                out[rel] = TEXT.test(name) ? buf.toString('utf8') : new Uint8Array(buf);
            }
        }
    };
    visit(root);
    return out;
}

function same(a: string | Uint8Array | undefined, b: string | Uint8Array): boolean {
    if (a === undefined) return false;
    const x = asBytes(a);
    const y = asBytes(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
}

function main(argv: string[]): number {
    const [cmd, dirArg, otherArg] = argv;
    if (
        !cmd ||
        !dirArg ||
        !['fmt', 'validate', 'diff'].includes(cmd) ||
        (cmd === 'diff' && !otherArg)
    ) {
        console.error(
            'usage: ovd <fmt|validate> <project-dir>\n       ovd diff <before-dir> <after-dir>',
        );
        return 2;
    }
    // pnpm --filter runs scripts from the package directory; resolve against the caller's cwd.
    const cwd = process.env['INIT_CWD'] ?? process.cwd();
    const root = resolve(cwd, dirArg);
    if (cmd === 'diff') {
        const changes = diffProjects(
            readProject(readDir(root)),
            readProject(readDir(resolve(cwd, otherArg!))),
        );
        console.log(changes.length ? formatDiff(changes) : 'no changes');
        return changes.length ? 1 : 0;
    }
    const files = readDir(root);
    const project = readProject(files);

    if (cmd === 'validate') {
        const issues = validateProject(project);
        for (const i of issues) {
            console.log(`${i.severity.padEnd(7)} ${i.file}${i.id ? `#${i.id}` : ''}  ${i.message}`);
        }
        console.log(issues.length ? `${issues.length} issue(s)` : 'ok');
        return issues.some((i) => i.severity === 'error') ? 1 : 0;
    }

    const out = writeProject(project);
    let changed = 0;
    for (const [path, content] of Object.entries(out)) {
        if (same(files[path], content)) continue;
        const full = join(root, path);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, typeof content === 'string' ? content : Buffer.from(content));
        console.log(`formatted ${path}`);
        changed++;
    }
    console.log(changed ? `${changed} file(s) formatted` : 'already canonical');
    return 0;
}

process.exitCode = main(process.argv.slice(2));
