/**
 * `ovd` command line (spec §10).
 *
 *   pnpm --filter @workspace/ovd-core ovd fmt <project-dir>
 *   pnpm --filter @workspace/ovd-core ovd validate <project-dir>
 *   pnpm --filter @workspace/ovd-core ovd export <project-dir>
 *   pnpm --filter @workspace/ovd-core ovd diff <before-dir> <after-dir>
 */
import { resolve } from 'node:path';
import { diffProjects, formatDiff } from './diff';
import { exportDir, formatDir, readDir } from './node';
import { readProject } from './project';
import { validateProject } from './validate';

const USAGE =
    'usage: ovd <fmt|validate|export> <project-dir>\n       ovd diff <before-dir> <after-dir>';

function main(argv: string[]): number {
    const [cmd, dirArg, otherArg] = argv;
    if (
        !cmd ||
        !dirArg ||
        !['fmt', 'validate', 'export', 'diff'].includes(cmd) ||
        (cmd === 'diff' && !otherArg)
    ) {
        console.error(USAGE);
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

    if (cmd === 'validate') {
        const issues = validateProject(readProject(readDir(root)));
        for (const i of issues) {
            console.log(`${i.severity.padEnd(7)} ${i.file}${i.id ? `#${i.id}` : ''}  ${i.message}`);
        }
        console.log(issues.length ? `${issues.length} issue(s)` : 'ok');
        return issues.some((i) => i.severity === 'error') ? 1 : 0;
    }

    if (cmd === 'export') {
        const { written, removed } = exportDir(root);
        for (const path of written) console.log(`exported ${path}`);
        for (const path of removed) console.log(`removed  ${path}`);
        console.log(
            written.length || removed.length
                ? `${written.length} written, ${removed.length} removed`
                : 'exports up to date',
        );
        return 0;
    }

    const written = formatDir(root);
    for (const path of written) console.log(`formatted ${path}`);
    console.log(written.length ? `${written.length} file(s) formatted` : 'already canonical');
    return 0;
}

process.exitCode = main(process.argv.slice(2));
