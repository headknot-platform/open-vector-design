/** Token manager commands (spec §8). Token files are edited as DTCG JSON, kept canonical on write. */
import {
    type AnyNode,
    type Project,
    type TokenSet,
    type TokenType,
    deleteToken,
    projectTokens,
    relayoutText,
    setToken,
    tokenTypography,
    walk,
} from '@workspace/ovd-core';
import type { Draft } from 'immer';
import { canvasMeasure } from '../lib/measure';
import { editNodes } from './edit';
import { editor } from './store';

/** Re-applies typography tokens to every text layer bound to one, then re-wraps it. */
function syncTypography(d: Draft<Project>, set: TokenSet): void {
    const visit = (nodes: AnyNode[]) =>
        walk(nodes, (n) => {
            if (n.type !== 'text' || !n.textStyle) return;
            const t = tokenTypography(set, n.textStyle);
            if (!t) return;
            const changed =
                n.fontFamily !== t.fontFamily ||
                n.fontSize !== t.fontSize ||
                n.fontWeight !== t.fontWeight ||
                n.lineHeight !== t.lineHeight ||
                n.letterSpacing !== t.letterSpacing;
            if (!changed) return;
            Object.assign(n, t);
            relayoutText(n as never, canvasMeasure);
        });
    for (const p of d.pages) visit(p.children as AnyNode[]);
    for (const c of d.components) for (const s of c.sets) visit(s.variants as AnyNode[]);
}

function withTokens(recipe: (d: Draft<Project>) => void): void {
    const theme = editor().previewTheme;
    editor().update((d) => {
        recipe(d);
        syncTypography(d, projectTokens(d as Project, theme));
    });
}

export function updateToken(file: string, path: string, value: unknown, type?: TokenType): void {
    withTokens((d) => {
        const doc = d.tokens[file];
        if (doc) setToken(doc, path, { $value: value, $type: type });
    });
}

export function addToken(file: string, path: string, type: TokenType, value: unknown): void {
    withTokens((d) => {
        d.tokens[file] ??= {};
        setToken(d.tokens[file]!, path, { $value: value, $type: type });
    });
}

export function removeToken(file: string, path: string): void {
    withTokens((d) => {
        const doc = d.tokens[file];
        if (doc) deleteToken(doc, path);
    });
}

/** Binds text layers to a typography token (or unbinds with undefined), applying its values. */
export function applyTextStyle(ids: string[], ref: string | undefined, set: TokenSet | null): void {
    const t = ref && set ? tokenTypography(set, ref) : undefined;
    editNodes(ids, (n) => {
        if (n.type !== 'text') return;
        n.textStyle = ref;
        if (t) {
            Object.assign(n, t);
            relayoutText(n as never, canvasMeasure);
        }
    });
}

/** Files a new token can be written to: base files, then the previewed theme's files. */
export function tokenFiles(project: Project, theme: string | undefined): string[] {
    const files = [
        ...project.manifest.tokens,
        ...(theme ? (project.manifest.themes[theme] ?? []) : []),
    ];
    return files.length ? files : Object.keys(project.tokens);
}
