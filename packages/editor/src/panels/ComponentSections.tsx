/** Inspector sections for components (spec §5): instances and variants. */
import {
    type AnyNode,
    type ComponentNode,
    type InstanceNode,
    type SceneNode,
    type TextNode,
    findComponent,
    instanceContent,
    parseVariant,
    walk,
} from '@workspace/ovd-core';
import { Button } from '@workspace/ui/components/button';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@workspace/ui/components/select';
import { Switch } from '@workspace/ui/components/switch';
import { Component, ExternalLink, Plus, RotateCcw, Unlink } from 'lucide-react';
import { findComponentFile } from '../lib/doc';
import {
    addVariant,
    detachInstance,
    exposeTextProp,
    resetOverrides,
    setInstanceVariant,
    setOverride,
    setVariantValue,
} from '../state/components';
import { editor, useEditor } from '../state/store';
import { Section, TextField } from './fields';

function textLayers(nodes: SceneNode[]): TextNode[] {
    const out: TextNode[] = [];
    walk(nodes, (n) => {
        if (n.type === 'text') out.push(n as TextNode);
        if (n.type === 'instance') return false;
    });
    return out;
}

function propLayers(nodes: SceneNode[], prop: string): AnyNode[] {
    const out: AnyNode[] = [];
    walk(nodes, (n) => {
        if (n.prop === prop) out.push(n);
    });
    return out;
}

export function InstanceSection({ nodes }: { nodes: AnyNode[] }) {
    const project = useEditor((s) => s.project);
    const doc = useEditor((s) => s.doc);
    if (nodes.length !== 1 || nodes[0]!.type !== 'instance' || !project || !doc) return null;
    const inst = nodes[0] as InstanceNode;
    const hit = findComponent(project, doc.file, inst.href);
    const content = instanceContent(project, doc.file, inst);
    if (!hit || !content) {
        return (
            <Section title="Instance">
                <p className="text-destructive text-xs">Missing component: {inst.href}</p>
            </Section>
        );
    }
    const { set, variant } = content;
    const current = parseVariant(variant.variant);
    const axes = Object.entries(set.props).filter(([, d]) => Array.isArray(d)) as [
        string,
        string[],
    ][];
    const booleans = Object.entries(set.props)
        .filter(([, d]) => d === 'boolean')
        .map(([k]) => k);
    const override = (target: string) => inst.overrides.find((o) => o.target === target);
    const texts = textLayers(variant.children);

    return (
        <Section
            title="Instance"
            action={
                <div className="flex items-center gap-0.5">
                    <button
                        className="hover:bg-accent text-muted-foreground rounded p-1"
                        onClick={() => editor().openDoc({ kind: 'component', file: hit.file.file })}
                        aria-label="Go to component"
                        title="Go to component"
                    >
                        <ExternalLink className="size-3.5" />
                    </button>
                    <button
                        className="hover:bg-accent text-muted-foreground rounded p-1 disabled:opacity-40"
                        disabled={!inst.overrides.length}
                        onClick={() => resetOverrides(inst.id)}
                        aria-label="Reset overrides"
                        title="Reset overrides"
                    >
                        <RotateCcw className="size-3.5" />
                    </button>
                </div>
            }
        >
            <div className="text-primary flex items-center gap-1.5 text-xs">
                <Component className="size-3.5" />
                <span className="truncate font-medium">{set.name}</span>
                <span className="text-muted-foreground ml-auto truncate text-[11px]">
                    {hit.file.file}
                </span>
            </div>
            {axes.map(([axis, values]) => (
                <label
                    key={axis}
                    className="grid grid-cols-[72px_1fr] items-center gap-1.5 text-xs"
                >
                    <span className="text-muted-foreground truncate">{axis}</span>
                    <Select
                        value={current[axis]}
                        onValueChange={(v) => setInstanceVariant(inst.id, axis, v)}
                    >
                        <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label={axis}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {values.map((v) => (
                                <SelectItem key={v} value={v} className="text-xs">
                                    {v}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </label>
            ))}
            {booleans.map((prop) => {
                const layers = propLayers(variant.children, prop);
                const hidden =
                    layers.length > 0 &&
                    layers.every((l) => (override(l.id)?.hidden ?? l.hidden) === true);
                return (
                    <label
                        key={prop}
                        className="grid grid-cols-[72px_1fr] items-center gap-1.5 text-xs"
                    >
                        <span className="text-muted-foreground truncate">{prop}</span>
                        <Switch
                            checked={!hidden}
                            onCheckedChange={(on) =>
                                layers.forEach((l) =>
                                    setOverride(inst.id, l.id, {
                                        hidden: on ? (l.hidden ? false : undefined) : true,
                                    }),
                                )
                            }
                        />
                    </label>
                );
            })}
            {texts.map((t) => (
                <label
                    key={t.id}
                    className="grid grid-cols-[72px_1fr] items-center gap-1.5 text-xs"
                >
                    <span
                        className="text-muted-foreground truncate"
                        title={t.prop ? `text prop "${t.prop}"` : `layer ${t.id}`}
                    >
                        {t.prop ?? t.name}
                    </span>
                    <TextField
                        value={override(t.id)?.text ?? t.content}
                        onCommit={(v) =>
                            setOverride(inst.id, t.id, { text: v === t.content ? undefined : v })
                        }
                    />
                </label>
            ))}
            <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => detachInstance(inst.id)}
            >
                <Unlink className="size-3.5" /> Detach instance
            </Button>
        </Section>
    );
}

export function VariantSection({ nodes }: { nodes: AnyNode[] }) {
    const project = useEditor((s) => s.project);
    const doc = useEditor((s) => s.doc);
    if (
        nodes.length !== 1 ||
        nodes[0]!.type !== 'component' ||
        !project ||
        doc?.kind !== 'component'
    )
        return null;
    const v = nodes[0] as ComponentNode;
    const file = findComponentFile(project, doc.file);
    const set = file?.sets.find((s) => s.variants.some((x) => x.id === v.id));
    if (!set) return null;
    const props = parseVariant(v.variant);
    const axes = Object.entries(set.props)
        .filter(([, d]) => Array.isArray(d))
        .map(([k]) => k);
    const texts = textLayers(v.children);
    return (
        <Section
            title={set.isSet ? `Variant of ${set.name}` : 'Component'}
            action={
                <button
                    className="hover:bg-accent text-muted-foreground flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]"
                    onClick={() => addVariant(v.id)}
                    title="Add a variant based on this one"
                >
                    <Plus className="size-3" /> Variant
                </button>
            }
        >
            {axes.map((axis) => (
                <label
                    key={axis}
                    className="grid grid-cols-[72px_1fr] items-center gap-1.5 text-xs"
                >
                    <span className="text-muted-foreground truncate">{axis}</span>
                    <TextField
                        value={props[axis] ?? ''}
                        onCommit={(val) => setVariantValue(v.id, axis, val)}
                    />
                </label>
            ))}
            {texts.length > 0 && (
                <div className="flex flex-col gap-1">
                    <p className="text-muted-foreground text-[11px]">Text props</p>
                    {texts.map((t) => (
                        <label
                            key={t.id}
                            className="grid grid-cols-[72px_1fr] items-center gap-1.5 text-xs"
                        >
                            <span className="truncate">{t.name}</span>
                            <TextField
                                value={t.prop ?? ''}
                                placeholder="not a prop"
                                onCommit={(p) => p.trim() && exposeTextProp(v.id, t.id, p.trim())}
                            />
                        </label>
                    ))}
                </div>
            )}
        </Section>
    );
}
