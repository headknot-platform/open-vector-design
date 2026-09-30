import { type FileMap, type Project, readProject } from '@workspace/ovd-core';
import { editor } from '../state/store';

const PREFIX = '../../../../examples/starter/';

// Tests load the starter straight from examples/ (the round-trip-tested fixture), so it can never
// drift from a valid, canonical project.
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

/** Opens the starter in the editor, as a host would after loading it. */
export function openStarter(): void {
    editor().loadProject(loadStarter(), { kind: 'local', name: 'Starter' });
}
