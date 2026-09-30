import { type FileMap, type Project, readProject } from '@workspace/ovd-core';

const PREFIX = '../../../../examples/starter/';

// "New project" starts from examples/starter — the round-trip-tested fixture, bundled at build time.
const raw = import.meta.glob('../../../../examples/starter/**/*', {
    query: '?raw',
    import: 'default',
    eager: true,
}) as Record<string, string>;

export function starterFiles(): FileMap {
    const out: FileMap = {};
    for (const [path, content] of Object.entries(raw)) out[path.slice(PREFIX.length)] = content;
    return out;
}

export function loadStarter(): Project {
    return readProject(starterFiles());
}
