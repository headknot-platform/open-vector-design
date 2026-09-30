/** Left sidebar: pages list and the layers tree (front-most layer at the top, spec §4). */
import { type AnyNode, ancestorsOf, childrenOf } from '@workspace/ovd-core';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { ScrollArea } from '@workspace/ui/components/scroll-area';
import { cn } from '@workspace/ui/lib/utils';
import {
    ChevronRight,
    Circle,
    Component,
    Eye,
    EyeOff,
    FileText,
    Frame,
    Group,
    Image,
    Lock,
    MoreHorizontal,
    PenTool,
    Plus,
    Slash,
    Square,
    SquareDashed,
    Type,
    Unlock,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { docRoots } from '../lib/doc';
import { moveNode, rename, setHidden, setLocked } from '../state/actions';
import { addPage, deletePage, renamePage } from '../state/edit';
import { editor, useDocRoots, useEditor } from '../state/store';

// ---------------------------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------------------------

function InlineName({
    value,
    onCommit,
    onDone,
}: {
    value: string;
    onCommit: (v: string) => void;
    onDone: () => void;
}) {
    const [v, setV] = useState(value);
    return (
        <input
            autoFocus
            className="bg-background ring-ring h-5 w-full min-w-0 rounded-sm px-1 text-xs ring-1 outline-none"
            value={v}
            onFocus={(e) => e.target.select()}
            onChange={(e) => setV(e.target.value)}
            onBlur={() => {
                if (v.trim() && v !== value) onCommit(v.trim());
                onDone();
            }}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                    setV(value);
                    onDone();
                }
            }}
            onClick={(e) => e.stopPropagation()}
        />
    );
}

function PagesSection() {
    const pages = useEditor((s) => s.project?.pages ?? []);
    const doc = useEditor((s) => s.doc);
    const [editing, setEditing] = useState<string | null>(null);
    return (
        <div className="border-b px-2 pt-2 pb-1.5">
            <div className="flex h-6 items-center justify-between px-1">
                <h3 className="text-[11px] font-semibold">Pages</h3>
                <button
                    className="hover:bg-accent text-muted-foreground rounded p-1"
                    onClick={() => addPage(`Page ${pages.length + 1}`)}
                    aria-label="Add page"
                    title="Add page"
                >
                    <Plus className="size-3.5" />
                </button>
            </div>
            <ul className="mt-0.5">
                {pages.map((p) => {
                    const active = doc?.kind === 'page' && doc.file === p.file;
                    return (
                        <li
                            key={p.file}
                            className={cn(
                                'group flex h-7 cursor-default items-center gap-2 rounded-md px-2 text-xs',
                                active ? 'bg-accent font-medium' : 'hover:bg-accent/60',
                            )}
                            onClick={() => editor().openDoc({ kind: 'page', file: p.file })}
                            onDoubleClick={() => setEditing(p.file)}
                        >
                            <FileText className="text-muted-foreground size-3.5 shrink-0" />
                            {editing === p.file ? (
                                <InlineName
                                    value={p.name}
                                    onCommit={(v) => renamePage(p.file, v)}
                                    onDone={() => setEditing(null)}
                                />
                            ) : (
                                <span className="flex-1 truncate">{p.name}</span>
                            )}
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <button
                                        className="hover:bg-background text-muted-foreground rounded p-0.5 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                                        onClick={(e) => e.stopPropagation()}
                                        aria-label={`${p.name} options`}
                                    >
                                        <MoreHorizontal className="size-3.5" />
                                    </button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent
                                    align="end"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <DropdownMenuItem onSelect={() => setEditing(p.file)}>
                                        Rename
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        variant="destructive"
                                        disabled={pages.length <= 1}
                                        onSelect={() => deletePage(p.file)}
                                    >
                                        Delete page
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

// ---------------------------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------------------------

function iconFor(n: AnyNode) {
    switch (n.type) {
        case 'frame':
            return Frame;
        case 'component':
            return Component;
        case 'group':
            return Group;
        case 'text':
            return Type;
        case 'image':
            return Image;
        case 'instance':
            return Component;
        case 'raw':
            return SquareDashed;
        case 'shape':
            return n.kind === 'ellipse'
                ? Circle
                : n.kind === 'line'
                  ? Slash
                  : n.kind === 'path'
                    ? PenTool
                    : Square;
    }
}

type Drop = { id: string; where: 'before' | 'after' | 'inside' } | null;

/** Where a dropped layer goes, in document order. Display is reversed: "above a row" = after it. */
function docIndexFor(roots: AnyNode[], target: AnyNode, where: 'before' | 'after' | 'inside') {
    if (where === 'inside') return { parent: target.id, index: childrenOf(target)!.length };
    const chain = ancestorsOf(roots, target.id);
    const parent = chain[chain.length - 1] ?? null;
    const list = parent ? childrenOf(parent)! : roots;
    const i = list.findIndex((n) => n.id === target.id);
    return { parent: parent?.id ?? null, index: where === 'before' ? i + 1 : i };
}

function LayerRow({
    node,
    depth,
    expanded,
    toggle,
    drop,
    setDrop,
    dragId,
    setDragId,
}: {
    node: AnyNode;
    depth: number;
    expanded: Set<string>;
    toggle: (id: string) => void;
    drop: Drop;
    setDrop: (d: Drop) => void;
    dragId: React.MutableRefObject<string | null>;
    setDragId: (id: string | null) => void;
}) {
    const selected = useEditor((s) => s.selection.includes(node.id));
    const hovered = useEditor((s) => s.hover === node.id);
    const [renaming, setRenaming] = useState(false);
    const rowRef = useRef<HTMLDivElement>(null);
    const kids = childrenOf(node);
    const open = expanded.has(node.id);
    const Icon = iconFor(node);
    const isRoot = node.type === 'component';

    useEffect(() => {
        if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' });
    }, [selected]);

    const onDragOver = (e: React.DragEvent) => {
        if (!dragId.current || dragId.current === node.id) return;
        e.preventDefault();
        const r = e.currentTarget.getBoundingClientRect();
        const f = (e.clientY - r.top) / r.height;
        const where = kids && f > 0.3 && f < 0.7 ? 'inside' : f < 0.5 ? 'before' : 'after';
        if (drop?.id !== node.id || drop.where !== where) setDrop({ id: node.id, where });
    };

    return (
        <>
            <div
                ref={rowRef}
                role="treeitem"
                aria-selected={selected}
                aria-expanded={kids ? open : undefined}
                draggable={!isRoot && !renaming}
                onDragStart={(e) => {
                    setDragId(node.id);
                    e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                    setDragId(null);
                    setDrop(null);
                }}
                onDragOver={onDragOver}
                onDrop={(e) => {
                    e.preventDefault();
                    const id = dragId.current;
                    setDrop(null);
                    setDragId(null);
                    if (!id || !drop) return;
                    const s = editor();
                    const roots = s.project ? docRoots(s.project, s.doc) : [];
                    const { parent, index } = docIndexFor(roots, node, drop.where);
                    moveNode(id, parent, index);
                    s.select([id]);
                }}
                onClick={(e) =>
                    editor().select(
                        [node.id],
                        e.shiftKey || e.metaKey || e.ctrlKey ? 'toggle' : 'replace',
                    )
                }
                onDoubleClick={() => setRenaming(true)}
                onMouseEnter={() => editor().setHover(node.id)}
                onMouseLeave={() => editor().setHover(null)}
                className={cn(
                    'group relative flex h-7 cursor-default items-center gap-1 pr-1 text-xs',
                    selected ? 'bg-primary/10' : hovered ? 'bg-accent/70' : 'hover:bg-accent/70',
                    (node.hidden || node.locked) && !selected && 'text-muted-foreground',
                    depth === 0 && 'font-medium',
                )}
                style={{ paddingLeft: 6 + depth * 14 }}
            >
                {drop?.id === node.id && (
                    <div
                        className={cn(
                            'pointer-events-none absolute right-1 left-1 border-primary',
                            drop.where === 'before' && 'top-0 border-t-2',
                            drop.where === 'after' && 'bottom-0 border-b-2',
                            drop.where === 'inside' && 'inset-y-0 rounded border-2',
                        )}
                    />
                )}
                <button
                    className={cn(
                        'text-muted-foreground flex size-4 shrink-0 items-center justify-center',
                        !kids?.length && 'invisible',
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        toggle(node.id);
                    }}
                    aria-label={open ? 'Collapse' : 'Expand'}
                    tabIndex={-1}
                >
                    <ChevronRight
                        className={cn('size-3 transition-transform', open && 'rotate-90')}
                    />
                </button>
                <Icon
                    className={cn(
                        'size-3.5 shrink-0',
                        node.type === 'instance' || isRoot
                            ? 'text-primary'
                            : 'text-muted-foreground',
                    )}
                />
                {renaming ? (
                    <InlineName
                        value={node.name}
                        onCommit={(v) => rename(node.id, v)}
                        onDone={() => setRenaming(false)}
                    />
                ) : (
                    <span className="flex-1 truncate">{node.name}</span>
                )}
                {!isRoot && (
                    <span
                        className={cn(
                            'flex items-center',
                            !(node.hidden || node.locked) && 'opacity-0 group-hover:opacity-100',
                        )}
                    >
                        <button
                            className={cn(
                                'hover:bg-background rounded p-0.5',
                                !node.locked && 'opacity-0 group-hover:opacity-100',
                            )}
                            onClick={(e) => {
                                e.stopPropagation();
                                setLocked([node.id], !node.locked);
                            }}
                            aria-label={node.locked ? 'Unlock' : 'Lock'}
                            title={node.locked ? 'Unlock (⇧⌘L)' : 'Lock (⇧⌘L)'}
                        >
                            {node.locked ? (
                                <Lock className="size-3" />
                            ) : (
                                <Unlock className="size-3" />
                            )}
                        </button>
                        <button
                            className={cn(
                                'hover:bg-background rounded p-0.5',
                                !node.hidden && 'opacity-0 group-hover:opacity-100',
                            )}
                            onClick={(e) => {
                                e.stopPropagation();
                                setHidden([node.id], !node.hidden);
                            }}
                            aria-label={node.hidden ? 'Show' : 'Hide'}
                            title={node.hidden ? 'Show (⇧⌘H)' : 'Hide (⇧⌘H)'}
                        >
                            {node.hidden ? (
                                <EyeOff className="size-3" />
                            ) : (
                                <Eye className="size-3" />
                            )}
                        </button>
                    </span>
                )}
            </div>
            {kids &&
                open &&
                [...kids]
                    .reverse()
                    .map((k) => (
                        <LayerRow
                            key={k.id}
                            node={k}
                            depth={depth + 1}
                            expanded={expanded}
                            toggle={toggle}
                            drop={drop}
                            setDrop={setDrop}
                            dragId={dragId}
                            setDragId={setDragId}
                        />
                    ))}
        </>
    );
}

function LayersSection() {
    const roots = useDocRoots();
    const selection = useEditor((s) => s.selection);
    const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
    const [drop, setDrop] = useState<Drop>(null);
    const dragId = useRef<string | null>(null);

    // Reveal the selection: expand every ancestor of a selected layer.
    useEffect(() => {
        const need = selection.flatMap((id) => ancestorsOf(roots, id).map((a) => a.id));
        if (need.some((id) => !expanded.has(id))) setExpanded((e) => new Set([...e, ...need]));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection, roots]);

    const toggle = (id: string) =>
        setExpanded((e) => {
            const n = new Set(e);
            if (n.has(id)) n.delete(id);
            else n.add(id);
            return n;
        });

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-8 items-center px-3">
                <h3 className="text-[11px] font-semibold">Layers</h3>
            </div>
            <ScrollArea className="min-h-0 flex-1">
                <div
                    role="tree"
                    aria-label="Layers"
                    className="pb-4"
                    onClick={(e) => e.target === e.currentTarget && editor().select([])}
                >
                    {[...roots].reverse().map((n) => (
                        <LayerRow
                            key={n.id}
                            node={n}
                            depth={0}
                            expanded={expanded}
                            toggle={toggle}
                            drop={drop}
                            setDrop={setDrop}
                            dragId={dragId}
                            setDragId={(id) => (dragId.current = id)}
                        />
                    ))}
                    {!roots.length && (
                        <p className="text-muted-foreground px-3 py-2 text-xs">
                            No layers yet. Pick a tool and draw.
                        </p>
                    )}
                </div>
            </ScrollArea>
        </div>
    );
}

export function LayersPanel() {
    return (
        <div className="flex h-full flex-col">
            <PagesSection />
            <LayersSection />
        </div>
    );
}
