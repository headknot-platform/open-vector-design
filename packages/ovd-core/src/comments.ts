/**
 * Comments (spec §9): one JSON file per thread under `comments/`, outside the SVGs so discussion
 * never creates design diffs. A thread is anchored to a file, an element id and an optional point —
 * relative to that element, so the pin follows it when it moves (spec note 18).
 */
import type { Project } from './model';

export interface CommentMessage {
    /** The author's Git identity (email), as in the spec's example. */
    author: string;
    /** Display name, when known. */
    name?: string;
    /** ISO 8601. */
    time: string;
    body: string;
}

export interface CommentAnchor {
    /** The page or component file. */
    file: string;
    /** The element the thread is about; without it, `point` is on the file's canvas. */
    element?: string;
    /** [x, y] from the element's top-left (or the canvas origin without an element). */
    point?: [number, number];
}

export interface CommentThread {
    id: string;
    anchor: CommentAnchor;
    resolved: boolean;
    resolvedBy?: string;
    resolvedAt?: string;
    messages: CommentMessage[];
}

/** Thread ids are safe file names: `th_` plus letters, digits, `_` and `-`. */
export const COMMENT_ID = /^th_[A-Za-z0-9_-]{1,64}$/;
export const threadPath = (id: string) => `comments/${id}.json`;

const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

/** A thread from its JSON, or undefined when it is not one (other tools' files are left alone). */
export function readThread(value: unknown): CommentThread | undefined {
    if (!isObj(value) || typeof value['id'] !== 'string' || !isObj(value['anchor']))
        return undefined;
    const a = value['anchor'];
    if (typeof a['file'] !== 'string') return undefined;
    const p = a['point'];
    const point =
        Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number')
            ? ([p[0], p[1]] as [number, number])
            : undefined;
    const messages = (Array.isArray(value['messages']) ? value['messages'] : [])
        .filter(isObj)
        .filter((m) => typeof m['body'] === 'string')
        .map((m) => ({
            author: String(m['author'] ?? ''),
            ...(typeof m['name'] === 'string' ? { name: m['name'] } : {}),
            time: String(m['time'] ?? ''),
            body: m['body'] as string,
        }));
    return {
        ...(value as object),
        id: value['id'],
        anchor: {
            file: a['file'],
            ...(typeof a['element'] === 'string' ? { element: a['element'] } : {}),
            ...(point ? { point } : {}),
        },
        resolved: value['resolved'] === true,
        messages,
    } as CommentThread;
}

/** All threads of a project, oldest first. */
export function projectThreads(project: Project): CommentThread[] {
    return Object.values(project.comments)
        .map(readThread)
        .filter((t): t is CommentThread => !!t)
        .sort((a, b) => (a.messages[0]?.time ?? '').localeCompare(b.messages[0]?.time ?? ''));
}
