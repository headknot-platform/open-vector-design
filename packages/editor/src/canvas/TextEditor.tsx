/** In-place text editing: a textarea laid over the text layer (spec §7 — content is the source,
 *  lines are regenerated on every edit). */
import { type TextNode, findNode, locate, relayoutText } from '@workspace/ovd-core';
import { useEffect, useRef } from 'react';
import { docRoots } from '../lib/doc';
import { absOrigin } from '../lib/geometry';
import { canvasMeasure } from '../lib/measure';
import { editor, useDocRoots, useEditor, useViewport } from '../state/store';

export function TextEditor() {
    const id = useEditor((s) => s.editingText);
    const roots = useDocRoots();
    const vp = useViewport();
    const ref = useRef<HTMLTextAreaElement>(null);
    const node = id ? (findNode(roots, id) as TextNode | undefined) : undefined;

    const changed = useRef(false);
    useEffect(() => {
        if (!id) return;
        changed.current = false;
        const t = ref.current;
        if (t) {
            t.focus();
            t.select();
        }
    }, [id]);

    if (!node || node.type !== 'text') return null;
    const o = absOrigin(roots, node.id);
    const z = vp.zoom;
    const left = (node.x + o.x) * z + vp.x;
    const top = (node.y + o.y) * z + vp.y;

    const setContent = (content: string) => {
        // One undo step per editing session, recorded only once something actually changes.
        if (!changed.current) {
            editor().checkpoint();
            changed.current = true;
        }
        editor().update(
            (d) => {
                const n = findNode(docRoots(d, editor().doc), node.id) as TextNode | undefined;
                if (!n) return;
                n.content = content;
                if (n.name === n.content.slice(0, 40) || n.name === 'Text')
                    n.name = content.slice(0, 40) || 'Text';
                relayoutText(n, canvasMeasure);
            },
            { history: false },
        );
    };

    // Ending an edit with no text removes the layer, so a stray click with the text tool leaves
    // nothing behind.
    const finish = () => {
        const s = editor();
        s.setEditingText(null);
        const current = s.project && findNode(docRoots(s.project, s.doc), node.id);
        if (current && current.type === 'text' && !current.content.trim()) {
            s.update(
                (d) => {
                    const loc = locate(docRoots(d, s.doc), node.id);
                    if (loc) loc.list.splice(loc.index, 1);
                },
                { history: false },
            );
            s.select([]);
        }
    };

    return (
        <textarea
            ref={ref}
            value={node.content}
            onChange={(e) => setContent(e.target.value)}
            onBlur={finish}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape' || (e.key === 'Enter' && (e.metaKey || e.ctrlKey))) {
                    e.preventDefault();
                    finish();
                }
            }}
            onPointerDown={(e) => e.stopPropagation()}
            spellCheck={false}
            className="ring-selection absolute resize-none overflow-hidden border-0 bg-transparent p-0 ring-1 outline-none"
            style={{
                left,
                top,
                width: Math.max(node.width, 20) * z + 4,
                height: Math.max(node.height, node.fontSize * node.lineHeight) * z,
                fontFamily: node.fontFamily,
                fontSize: node.fontSize * z,
                fontWeight: node.fontWeight,
                lineHeight: node.lineHeight,
                letterSpacing: node.letterSpacing * z,
                textAlign:
                    node.align === 'middle' ? 'center' : node.align === 'end' ? 'right' : 'left',
                color: node.fill.token
                    ? `var(--${node.fill.token.slice(1, -1).replace(/\./g, '-')}, ${node.fill.color})`
                    : node.fill.color,
                whiteSpace: node.box === 'auto-width' ? 'pre' : 'pre-wrap',
                transform: node.rotation ? `rotate(${node.rotation}deg)` : undefined,
            }}
        />
    );
}
