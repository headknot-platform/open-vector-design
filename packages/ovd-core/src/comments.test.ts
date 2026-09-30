import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectThreads, readThread, threadPath } from './comments';
import { diffProjects } from './diff';
import { readDir } from './node';
import { type FileMap, readProject, writeProject } from './project';
import { validateProject } from './validate';

const STARTER = join(__dirname, '../../../examples/starter');

// The spec's own example (§9).
const example = {
    id: 'th_01',
    anchor: { file: 'pages/onboarding.svg', element: 'i_cta', point: [80, 24] },
    resolved: false,
    messages: [
        {
            author: 'dev@example.com',
            time: '2026-09-29T10:12:00Z',
            body: 'Should this be full-width on mobile?',
        },
    ],
    'x-other-tool': { keep: true },
};

const withThread = (thread: object): FileMap => ({
    ...readDir(STARTER),
    [threadPath('th_01')]: JSON.stringify(thread),
});

describe('comments (spec §9)', () => {
    it('reads the spec’s thread and writes it back canonically, keeping unknown keys', () => {
        const thread = readThread(example)!;
        expect(thread).toMatchObject({
            id: 'th_01',
            anchor: { file: 'pages/onboarding.svg', element: 'i_cta', point: [80, 24] },
            resolved: false,
            messages: [{ author: 'dev@example.com', body: 'Should this be full-width on mobile?' }],
        });
        const out = writeProject(readProject(withThread(example)))[threadPath('th_01')] as string;
        expect(out.startsWith('{\n  "anchor": {')).toBe(true); // sorted keys, 2-space
        expect(JSON.parse(out)['x-other-tool']).toEqual({ keep: true });
    });

    it('never produces a design diff', () => {
        const before = readProject(readDir(STARTER));
        const added = readProject(withThread(example));
        expect(diffProjects(before, added)).toEqual([]);
        const resolved = readProject(
            withThread({
                ...example,
                resolved: true,
                messages: [
                    ...example.messages,
                    { author: 'a@b.c', time: '2026-09-30T00:00:00Z', body: 'Done' },
                ],
            }),
        );
        expect(diffProjects(added, resolved)).toEqual([]);
        expect(projectThreads(resolved)[0]!.resolved).toBe(true);
    });

    it('warns — not errors — when a thread’s element is gone', () => {
        const project = readProject(
            withThread({ ...example, anchor: { file: 'pages/onboarding.svg', element: 'gone' } }),
        );
        const issues = validateProject(project).filter((i) => i.file === threadPath('th_01'));
        expect(issues).toEqual([
            expect.objectContaining({
                severity: 'warning',
                message: expect.stringMatching(/element gone/),
            }),
        ]);
        expect(
            validateProject(readProject(withThread(example))).filter((i) =>
                i.file.startsWith('comments/'),
            ),
        ).toEqual([]);
    });

    it('ignores files in comments/ that are not threads', () => {
        const project = readProject({
            ...withThread(example),
            'comments/notes.json': '{"hello": 1}',
        });
        expect(projectThreads(project).map((t) => t.id)).toEqual(['th_01']);
        expect(readThread({ id: 1 })).toBeUndefined();
    });
});
