/** `ovd validate` (spec §10): structural checks a writer must satisfy. */
import { resolveInstance } from './components';
import { type Project, type SceneNode, walk } from './model';
import { collectTokenRefs, componentFileNodes } from './refs';
import { listThemes, projectTokens } from './tokens';

function checkTokens(project: Project, issues: Issue[]): void {
    const seen = new Set<string>();
    const themes = listThemes(project.manifest);
    // Each theme layers its own files, so each can introduce its own broken alias.
    for (const theme of themes.length ? themes : [undefined]) {
        for (const e of projectTokens(project, theme).errors) {
            const message = `token {${e.path}} ${e.message}`;
            if (seen.has(e.source + message)) continue;
            seen.add(e.source + message);
            issues.push({ severity: 'error', file: e.source, message });
        }
    }
    const set = projectTokens(project);
    const files = [
        ...project.pages.map((p) => ({ file: p.file, nodes: p.children })),
        ...project.components.map((c) => ({ file: c.file, nodes: componentFileNodes(c) })),
    ];
    for (const { file, nodes } of files) {
        for (const ref of collectTokenRefs(nodes)) {
            if (set.tokens.has(ref)) continue;
            issues.push({
                severity: 'warning',
                file,
                message: `uses token {${ref}}, which does not exist; it falls back to its plain value`,
            });
        }
    }
}

export interface Issue {
    severity: 'error' | 'warning';
    file: string;
    id?: string;
    message: string;
}

function checkScene(
    project: Project,
    file: string,
    nodes: SceneNode[],
    seen: Set<string>,
    issues: Issue[],
): void {
    walk(nodes, (n) => {
        if (n.type === 'raw') return false;
        if (!n.id) {
            issues.push({
                severity: 'error',
                file,
                message: `a ${n.type} layer "${n.name}" has no id`,
            });
        } else if (seen.has(n.id)) {
            issues.push({ severity: 'error', file, id: n.id, message: `duplicate id "${n.id}"` });
        } else {
            seen.add(n.id);
        }
        if (n.type === 'instance' && !resolveInstance(project, file, n)) {
            const lib = /^([\w-]+):(?!\/\/)/.exec(n.href)?.[1];
            const loaded = !!lib && !!project.libraries?.[lib];
            issues.push({
                // Not loaded is not wrong: the host may not have fetched it. Loaded and missing is.
                severity: lib && !loaded ? 'warning' : 'error',
                file,
                id: n.id,
                message: !lib
                    ? `instance refers to ${n.href}, which does not exist`
                    : loaded
                      ? `instance refers to ${n.href}, which is not in library ${lib}`
                      : `instance refers to library component ${n.href}, which is not loaded`,
            });
        }
        if (n.type === 'image' && n.href.startsWith('data:')) {
            issues.push({
                severity: 'error',
                file,
                id: n.id,
                message:
                    'inline data: URIs are only allowed in exports; store the image under assets/ (spec §9)',
            });
        }
    });
}

export function validateProject(project: Project): Issue[] {
    const issues: Issue[] = [];
    for (const page of project.pages) {
        checkScene(project, page.file, page.children, new Set(), issues);
    }
    for (const file of project.components) {
        const seen = new Set<string>();
        for (const set of file.sets) {
            if (set.isSet) {
                if (seen.has(set.id)) {
                    issues.push({
                        severity: 'error',
                        file: file.file,
                        id: set.id,
                        message: `duplicate id "${set.id}"`,
                    });
                }
                seen.add(set.id);
            }
            for (const v of set.variants) {
                if (seen.has(v.id)) {
                    issues.push({
                        severity: 'error',
                        file: file.file,
                        id: v.id,
                        message: `duplicate id "${v.id}"`,
                    });
                }
                seen.add(v.id);
                // Layer ids inside a component are scoped to the component (they are override
                // targets), so each variant gets its own id space.
                checkScene(project, file.file, v.children, new Set(), issues);
            }
        }
    }
    for (const path of [
        ...project.manifest.tokens,
        ...Object.values(project.manifest.themes).flat(),
    ]) {
        if (!project.tokens[path]) {
            issues.push({
                severity: 'error',
                file: 'manifest.json',
                message: `token file ${path} is missing`,
            });
        }
    }
    checkTokens(project, issues);
    return issues;
}
