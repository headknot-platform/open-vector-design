/** Inspector sections for spec §6: auto layout on containers, resizing / constraints on children. */
import {
    type AnyNode,
    type Dim,
    type FrameNode,
    type HConstraint,
    type Layout,
    type Sizing,
    type VConstraint,
    locate,
    tokenNumber,
} from '@workspace/ovd-core';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@workspace/ui/components/select';
import { Switch } from '@workspace/ui/components/switch';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group';
import {
    ArrowDown,
    ArrowRight,
    MoveHorizontal,
    MoveVertical,
    Minus,
    Plus,
    WrapText,
} from 'lucide-react';
import type { Draft } from 'immer';
import { editNodes } from '../state/edit';
import { addAutoLayout, removeAutoLayout } from '../state/layout';
import { useDocRoots, useTokens } from '../state/store';
import {
    MIXED,
    type Maybe,
    NumberField,
    Row,
    Section,
    TokenButton,
    TokenPicker,
    common,
} from './fields';

type Container = FrameNode | Extract<AnyNode, { type: 'component' }>;

function SmallSelect<T extends string>({
    value,
    options,
    onChange,
    label,
}: {
    value: Maybe<T> | undefined;
    options: [T, string][];
    onChange: (v: T) => void;
    label: string;
}) {
    return (
        <Select value={value === MIXED ? undefined : value} onValueChange={(v) => onChange(v as T)}>
            <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label={label}>
                <SelectValue placeholder="Mixed" />
            </SelectTrigger>
            <SelectContent>
                {options.map(([v, l]) => (
                    <SelectItem key={v} value={v} className="text-xs">
                        {l}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    );
}

function DimField({
    label,
    title,
    dims,
    onChange,
}: {
    label: React.ReactNode;
    title: string;
    dims: Dim[];
    onChange: (d: Dim, live?: boolean) => void;
}) {
    const tokens = useTokens();
    const shown = dims.map((d) =>
        d.token && tokens ? (tokenNumber(tokens, d.token) ?? d.value) : d.value,
    );
    const token = common(dims.map((d) => d.token));
    const bound = typeof token === 'string';
    return (
        <div className="flex min-w-0 items-center gap-0.5">
            <NumberField
                className="min-w-0 flex-1"
                label={label}
                title={bound ? `${title}: ${token}` : title}
                min={0}
                value={common(shown)}
                onCommit={(v, live) => onChange({ value: v }, live)}
            />
            <TokenPicker
                type="dimension"
                value={bound ? token : undefined}
                onPick={(ref) =>
                    onChange(
                        ref
                            ? { value: 0, token: ref }
                            : { value: common(shown) === MIXED ? 0 : (shown[0] ?? 0) },
                    )
                }
            >
                <span>
                    <TokenButton bound={bound} />
                </span>
            </TokenPicker>
        </div>
    );
}

const SIZING: [Sizing, string][] = [
    ['fixed', 'Fixed'],
    ['hug', 'Hug contents'],
    ['fill', 'Fill container'],
];

export function AutoLayoutSection({ nodes, ids }: { nodes: AnyNode[]; ids: string[] }) {
    const containers = nodes.filter(
        (n) => n.type === 'frame' || n.type === 'component',
    ) as Container[];
    if (!containers.length || containers.length !== nodes.length) return null;
    const flex = containers.every((n) => n.layout.mode === 'flex');
    const any = containers.some((n) => n.layout.mode === 'flex');
    const set = (fn: (l: Draft<Layout>, n: Draft<Container>) => void, live = false) =>
        editNodes(
            ids,
            (n) => {
                if (n.type === 'frame' || n.type === 'component')
                    fn(n.layout, n as Draft<Container>);
            },
            live,
        );
    const l = <K extends keyof Layout>(k: K) => common(containers.map((n) => n.layout[k]));
    const pad = (i: number) => containers.map((n) => n.layout.padding[i]!);

    return (
        <Section
            title="Auto layout"
            action={
                any ? (
                    <button
                        className="hover:bg-accent text-muted-foreground rounded p-1"
                        onClick={() => removeAutoLayout(ids)}
                        aria-label="Remove auto layout"
                        title="Remove auto layout"
                    >
                        <Minus className="size-3.5" />
                    </button>
                ) : (
                    <button
                        className="hover:bg-accent text-muted-foreground rounded p-1"
                        onClick={() => addAutoLayout()}
                        aria-label="Add auto layout"
                        title="Add auto layout (⇧A)"
                    >
                        <Plus className="size-3.5" />
                    </button>
                )
            }
        >
            {flex && (
                <>
                    <Row>
                        <ToggleGroup
                            type="single"
                            size="sm"
                            variant="outline"
                            value={(l('direction') as string) ?? ''}
                            onValueChange={(v) =>
                                v && set((x) => void (x.direction = v as Layout['direction']))
                            }
                        >
                            <ToggleGroupItem value="column" aria-label="Vertical">
                                <ArrowDown className="size-3.5" />
                            </ToggleGroupItem>
                            <ToggleGroupItem value="row" aria-label="Horizontal">
                                <ArrowRight className="size-3.5" />
                            </ToggleGroupItem>
                        </ToggleGroup>
                        <label className="text-muted-foreground flex items-center justify-end gap-2 text-[11px]">
                            <WrapText className="size-3.5" />
                            Wrap
                            <Switch
                                checked={l('wrap') === true}
                                onCheckedChange={(v) => set((x) => void (x.wrap = v))}
                            />
                        </label>
                    </Row>
                    <Row>
                        <DimField
                            label="⇆"
                            title="Gap"
                            dims={containers.map((n) => n.layout.gap)}
                            onChange={(d, live) => set((x) => void (x.gap = d), live)}
                        />
                    </Row>
                    <Row>
                        <DimField
                            label={<MoveHorizontal className="size-3" />}
                            title="Horizontal padding"
                            dims={pad(3)}
                            onChange={(d, live) =>
                                set((x) => {
                                    x.padding[1] = d;
                                    x.padding[3] = d;
                                }, live)
                            }
                        />
                        <DimField
                            label={<MoveVertical className="size-3" />}
                            title="Vertical padding"
                            dims={pad(0)}
                            onChange={(d, live) =>
                                set((x) => {
                                    x.padding[0] = d;
                                    x.padding[2] = d;
                                }, live)
                            }
                        />
                    </Row>
                    <Row>
                        <SmallSelect
                            label="Align items"
                            value={l('align') as Maybe<Layout['align']>}
                            options={[
                                ['start', 'Align start'],
                                ['center', 'Align center'],
                                ['end', 'Align end'],
                                ['stretch', 'Stretch'],
                            ]}
                            onChange={(v) => set((x) => void (x.align = v))}
                        />
                        <SmallSelect
                            label="Justify content"
                            value={l('justify') as Maybe<Layout['justify']>}
                            options={[
                                ['start', 'Pack start'],
                                ['center', 'Pack center'],
                                ['end', 'Pack end'],
                                ['space-between', 'Space between'],
                            ]}
                            onChange={(v) => set((x) => void (x.justify = v))}
                        />
                    </Row>
                    <Row>
                        <SmallSelect
                            label="Width"
                            value={common(containers.map((n) => n.sizing?.h ?? 'fixed'))}
                            options={SIZING.filter(([s]) => s !== 'fill')}
                            onChange={(v) =>
                                set((_, n) => void (n.sizing = { h: v, v: n.sizing?.v ?? 'fixed' }))
                            }
                        />
                        <SmallSelect
                            label="Height"
                            value={common(containers.map((n) => n.sizing?.v ?? 'fixed'))}
                            options={SIZING.filter(([s]) => s !== 'fill')}
                            onChange={(v) =>
                                set((_, n) => void (n.sizing = { h: n.sizing?.h ?? 'fixed', v }))
                            }
                        />
                    </Row>
                </>
            )}
        </Section>
    );
}

const H: [HConstraint, string][] = [
    ['left', 'Left'],
    ['right', 'Right'],
    ['left-right', 'Left & right'],
    ['center', 'Center'],
    ['scale', 'Scale'],
];
const V: [VConstraint, string][] = [
    ['top', 'Top'],
    ['bottom', 'Bottom'],
    ['top-bottom', 'Top & bottom'],
    ['center', 'Center'],
    ['scale', 'Scale'],
];

/** Resizing (children of flex frames) or constraints (children of layout=none frames). */
export function ChildLayoutSection({ nodes, ids }: { nodes: AnyNode[]; ids: string[] }) {
    const roots = useDocRoots();
    const parents = nodes.map((n) => locate(roots, n.id)?.parent ?? null);
    if (parents.some((p) => !p || (p.type !== 'frame' && p.type !== 'component'))) return null;
    const containers = parents as Container[];
    const inFlex = containers.every((p) => p.layout.mode === 'flex');
    const inNone = containers.every((p) => p.layout.mode !== 'flex');
    if (!inFlex && !inNone) return null;

    if (inFlex) {
        const absolute = common(nodes.map((n) => n.position === 'absolute'));
        return (
            <Section
                title="Resizing"
                action={
                    <label
                        className="text-muted-foreground flex items-center gap-2 text-[11px]"
                        title="Ignore the parent's auto layout"
                    >
                        Absolute
                        <Switch
                            checked={absolute === true}
                            onCheckedChange={(v) =>
                                editNodes(ids, (n) => void (n.position = v ? 'absolute' : 'auto'))
                            }
                        />
                    </label>
                }
            >
                {absolute !== true && (
                    <Row>
                        <SmallSelect
                            label="Horizontal resizing"
                            value={common(nodes.map((n) => n.sizing?.h ?? 'fixed'))}
                            options={SIZING}
                            onChange={(v) =>
                                editNodes(
                                    ids,
                                    (n) => void (n.sizing = { h: v, v: n.sizing?.v ?? 'fixed' }),
                                )
                            }
                        />
                        <SmallSelect
                            label="Vertical resizing"
                            value={common(nodes.map((n) => n.sizing?.v ?? 'fixed'))}
                            options={SIZING}
                            onChange={(v) =>
                                editNodes(
                                    ids,
                                    (n) => void (n.sizing = { h: n.sizing?.h ?? 'fixed', v }),
                                )
                            }
                        />
                    </Row>
                )}
            </Section>
        );
    }

    return (
        <Section title="Constraints">
            <Row>
                <SmallSelect
                    label="Horizontal constraint"
                    value={common(nodes.map((n) => n.constraints?.h ?? 'left'))}
                    options={H}
                    onChange={(v) =>
                        editNodes(
                            ids,
                            (n) => void (n.constraints = { h: v, v: n.constraints?.v ?? 'top' }),
                        )
                    }
                />
                <SmallSelect
                    label="Vertical constraint"
                    value={common(nodes.map((n) => n.constraints?.v ?? 'top'))}
                    options={V}
                    onChange={(v) =>
                        editNodes(
                            ids,
                            (n) => void (n.constraints = { h: n.constraints?.h ?? 'left', v }),
                        )
                    }
                />
            </Row>
        </Section>
    );
}
