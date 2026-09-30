/** Right sidebar: properties of the selection, or of the page when nothing is selected. */
import {
    type AnyNode,
    type ImageNode,
    type Paint,
    type ShapeNode,
    type TextNode,
    findNode,
    relayoutText,
} from '@workspace/ovd-core';
import { ScrollArea } from '@workspace/ui/components/scroll-area';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@workspace/ui/components/select';
import { Switch } from '@workspace/ui/components/switch';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/components/toggle-group';
import { AlignCenter, AlignLeft, AlignRight, Minus, Plus, RotateCw } from 'lucide-react';
import type { Draft } from 'immer';
import { docName } from '../lib/doc';
import { canvasMeasure } from '../lib/measure';
import { editNodes, renamePage, setSize } from '../state/edit';
import { applyTextStyle } from '../state/tokens';
import { useDocRoots, useEditor, useTokens } from '../state/store';
import {
    ColorField,
    MIXED,
    NumberField,
    Row,
    Section,
    TextField,
    TokenButton,
    TokenPicker,
    common,
    type Maybe,
} from './fields';
import { InstanceSection, VariantSection } from './ComponentSections';
import { AutoLayoutSection, ChildLayoutSection } from './LayoutSection';

const FONTS = [
    'Inter, sans-serif',
    'system-ui, sans-serif',
    'Georgia, serif',
    'ui-monospace, monospace',
];
const WEIGHTS = [300, 400, 500, 600, 700, 800];

const label = (n: AnyNode) =>
    n.type === 'shape'
        ? n.kind[0]!.toUpperCase() + n.kind.slice(1)
        : n.type[0]!.toUpperCase() + n.type.slice(1);

function IconButton({
    onClick,
    children,
    label: l,
}: {
    onClick: () => void;
    children: React.ReactNode;
    label: string;
}) {
    return (
        <button
            className="hover:bg-accent text-muted-foreground rounded p-1"
            onClick={onClick}
            aria-label={l}
            title={l}
        >
            {children}
        </button>
    );
}

// ---------------------------------------------------------------------------------------------

function GeometrySection({ nodes, ids }: { nodes: AnyNode[]; ids: string[] }) {
    const variantRoot = nodes.every((n) => n.type === 'component');
    const get = (k: 'x' | 'y' | 'width' | 'height' | 'rotation') => common(nodes.map((n) => n[k]));
    const setPos = (k: 'x' | 'y' | 'rotation') => (v: number, live?: boolean) =>
        editNodes(
            ids,
            (n) => {
                (n as Record<typeof k, number>)[k] = v;
            },
            live,
        );
    return (
        <Section title="Position & size">
            {!variantRoot && (
                <Row>
                    <NumberField label="X" value={get('x')} onCommit={setPos('x')} />
                    <NumberField label="Y" value={get('y')} onCommit={setPos('y')} />
                </Row>
            )}
            <Row>
                <NumberField
                    label="W"
                    min={0}
                    value={get('width')}
                    onCommit={(v, live) => setSize(ids, { width: v }, live)}
                />
                <NumberField
                    label="H"
                    min={0}
                    value={get('height')}
                    onCommit={(v, live) => setSize(ids, { height: v }, live)}
                />
            </Row>
            {!variantRoot && (
                <Row>
                    <NumberField
                        label={<RotateCw className="size-3" />}
                        suffix="°"
                        value={get('rotation')}
                        onCommit={setPos('rotation')}
                        title="Rotation"
                    />
                </Row>
            )}
        </Section>
    );
}

function FrameSection({ nodes, ids }: { nodes: AnyNode[]; ids: string[] }) {
    const frames = nodes.filter((n) => n.type === 'frame' || n.type === 'component');
    if (frames.length !== nodes.length) return null;
    const clip = common(frames.map((n) => (n as { clip: boolean }).clip));
    return (
        <Section
            title={nodes[0]!.type === 'component' ? 'Component' : 'Frame'}
            action={
                <label className="text-muted-foreground flex items-center gap-2 text-[11px]">
                    Clip content
                    <Switch
                        checked={clip === true}
                        onCheckedChange={(v) =>
                            editNodes(ids, (n) => {
                                if ('clip' in n) n.clip = v;
                            })
                        }
                    />
                </label>
            }
        />
    );
}

function RadiusRow({ nodes, ids }: { nodes: AnyNode[]; ids: string[] }) {
    const withRadius = nodes.filter(
        (n) =>
            n.type === 'frame' ||
            n.type === 'component' ||
            (n.type === 'shape' && n.kind === 'rect'),
    );
    if (withRadius.length !== nodes.length) return null;
    return (
        <Row>
            <NumberField
                label="R"
                min={0}
                title="Corner radius"
                value={common(withRadius.map((n) => (n as { radius: number }).radius))}
                onCommit={(v, live) =>
                    editNodes(
                        ids,
                        (n) => {
                            if ('radius' in n) n.radius = v;
                        },
                        live,
                    )
                }
            />
        </Row>
    );
}

type Fillable = Draft<AnyNode> & { fill?: Paint };

function FillSection({ nodes, ids }: { nodes: AnyNode[]; ids: string[] }) {
    const fillable = nodes.filter(
        (n) =>
            n.type !== 'instance' && n.type !== 'raw' && n.type !== 'image' && n.type !== 'group',
    );
    if (fillable.length !== nodes.length) return null;
    const lineOnly = nodes.every((n) => n.type === 'shape' && n.kind === 'line');
    if (lineOnly) return null;
    const fills = nodes.map((n) => (n as { fill?: Paint }).fill);
    const has = fills.some(Boolean);
    const color = common(fills.map((f) => f?.color));
    const token = common(fills.map((f) => f?.token));
    const apply = (p: Paint | undefined) =>
        editNodes(ids, (n) => {
            if (n.type === 'text') {
                if (p) n.fill = p;
            } else if (
                'fill' in (n as object) ||
                n.type === 'shape' ||
                n.type === 'frame' ||
                n.type === 'component'
            ) {
                (n as Fillable).fill = p;
            }
        });
    const textOnly = nodes.every((n) => n.type === 'text');
    return (
        <Section
            title="Fill"
            action={
                textOnly ? undefined : has ? (
                    <IconButton label="Remove fill" onClick={() => apply(undefined)}>
                        <Minus className="size-3.5" />
                    </IconButton>
                ) : (
                    <IconButton label="Add fill" onClick={() => apply({ color: '#d9d9d9' })}>
                        <Plus className="size-3.5" />
                    </IconButton>
                )
            }
        >
            {has && (
                <ColorField
                    color={color as Maybe<string>}
                    token={token as Maybe<string | undefined>}
                    onChange={apply}
                />
            )}
        </Section>
    );
}

function StrokeSection({ nodes, ids }: { nodes: AnyNode[]; ids: string[] }) {
    const ok = nodes.every(
        (n) => n.type === 'shape' || n.type === 'frame' || n.type === 'component',
    );
    if (!ok) return null;
    const strokes = nodes.map((n) => (n as ShapeNode).stroke);
    const has = strokes.some(Boolean);
    const set = (
        fn: (s: NonNullable<ShapeNode['stroke']> | undefined) => ShapeNode['stroke'],
        live = false,
    ) =>
        editNodes(
            ids,
            (n) => {
                const s = n as Draft<ShapeNode>;
                s.stroke = fn(s.stroke);
            },
            live,
        );
    return (
        <Section
            title="Stroke"
            action={
                has ? (
                    <IconButton label="Remove stroke" onClick={() => set(() => undefined)}>
                        <Minus className="size-3.5" />
                    </IconButton>
                ) : (
                    <IconButton
                        label="Add stroke"
                        onClick={() => set(() => ({ paint: { color: '#1e1e1e' }, width: 1 }))}
                    >
                        <Plus className="size-3.5" />
                    </IconButton>
                )
            }
        >
            {has && (
                <>
                    <ColorField
                        color={common(strokes.map((s) => s?.paint.color)) as Maybe<string>}
                        token={
                            common(strokes.map((s) => s?.paint.token)) as Maybe<string | undefined>
                        }
                        onChange={(paint) => set((s) => ({ width: s?.width ?? 1, paint }))}
                    />
                    <Row>
                        <NumberField
                            label="W"
                            min={0}
                            step={0.5}
                            title="Stroke width"
                            value={common(strokes.map((s) => s?.width ?? 0))}
                            onCommit={(v, live) =>
                                set(
                                    (s) => ({ paint: s?.paint ?? { color: '#1e1e1e' }, width: v }),
                                    live,
                                )
                            }
                        />
                    </Row>
                </>
            )}
        </Section>
    );
}

function TextSection({ nodes, ids }: { nodes: AnyNode[]; ids: string[] }) {
    const tokens = useTokens();
    if (!nodes.every((n) => n.type === 'text')) return null;
    const texts = nodes as TextNode[];
    const get = <K extends keyof TextNode>(k: K) => common(texts.map((t) => t[k]));
    const set = (fn: (t: Draft<TextNode>) => void, live = false) =>
        editNodes(
            ids,
            (n) => {
                if (n.type !== 'text') return;
                fn(n);
                relayoutText(n as TextNode, canvasMeasure);
            },
            live,
        );
    const family = get('fontFamily');
    const weight = get('fontWeight');
    const style = get('textStyle');
    return (
        <Section title="Text">
            <div className="flex items-center gap-1">
                <div className="bg-muted/60 flex h-7 min-w-0 flex-1 items-center rounded-md px-2 text-xs">
                    {style === MIXED ? (
                        <span className="text-muted-foreground">Mixed styles</span>
                    ) : style ? (
                        <span className="text-primary truncate">
                            {(style as string).slice(1, -1)}
                        </span>
                    ) : (
                        <span className="text-muted-foreground">No text style</span>
                    )}
                </div>
                <TokenPicker
                    type="typography"
                    value={typeof style === 'string' ? style : undefined}
                    onPick={(ref) => applyTextStyle(ids, ref, tokens)}
                >
                    <span>
                        <TokenButton bound={typeof style === 'string'} />
                    </span>
                </TokenPicker>
            </div>
            <Select
                value={family === MIXED ? undefined : family}
                onValueChange={(v) => set((t) => void (t.fontFamily = v))}
            >
                <SelectTrigger size="sm" className="h-7 w-full text-xs">
                    <SelectValue placeholder="Mixed" />
                </SelectTrigger>
                <SelectContent>
                    {[...new Set([...(family && family !== MIXED ? [family] : []), ...FONTS])].map(
                        (f) => (
                            <SelectItem key={f} value={f} className="text-xs">
                                {f.split(',')[0]}
                            </SelectItem>
                        ),
                    )}
                </SelectContent>
            </Select>
            <Row>
                <Select
                    value={weight === MIXED || weight === undefined ? undefined : String(weight)}
                    onValueChange={(v) => set((t) => void (t.fontWeight = Number(v)))}
                >
                    <SelectTrigger size="sm" className="h-7 w-full text-xs">
                        <SelectValue placeholder="Mixed" />
                    </SelectTrigger>
                    <SelectContent>
                        {WEIGHTS.map((w) => (
                            <SelectItem key={w} value={String(w)} className="text-xs">
                                {w}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <NumberField
                    label="Aa"
                    min={1}
                    value={get('fontSize')}
                    onCommit={(v, live) => set((t) => void (t.fontSize = v), live)}
                    title="Font size"
                />
            </Row>
            <Row>
                <NumberField
                    label="LH"
                    min={0.5}
                    step={0.05}
                    value={get('lineHeight')}
                    onCommit={(v, live) => set((t) => void (t.lineHeight = v), live)}
                    title="Line height (× font size)"
                />
                <NumberField
                    label="LS"
                    step={0.1}
                    value={get('letterSpacing')}
                    onCommit={(v, live) => set((t) => void (t.letterSpacing = v), live)}
                    title="Letter spacing (px)"
                />
            </Row>
            <Row>
                <ToggleGroup
                    type="single"
                    size="sm"
                    variant="outline"
                    value={(get('align') as string) ?? ''}
                    onValueChange={(v) => v && set((t) => void (t.align = v as TextNode['align']))}
                >
                    <ToggleGroupItem value="start" aria-label="Align left">
                        <AlignLeft className="size-3.5" />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="middle" aria-label="Align centre">
                        <AlignCenter className="size-3.5" />
                    </ToggleGroupItem>
                    <ToggleGroupItem value="end" aria-label="Align right">
                        <AlignRight className="size-3.5" />
                    </ToggleGroupItem>
                </ToggleGroup>
                <Select
                    value={get('box') === MIXED ? undefined : (get('box') as string)}
                    onValueChange={(v) => set((t) => void (t.box = v as TextNode['box']))}
                >
                    <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label="Text box">
                        <SelectValue placeholder="Mixed" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="auto-width" className="text-xs">
                            Auto width
                        </SelectItem>
                        <SelectItem value="fixed-width" className="text-xs">
                            Auto height
                        </SelectItem>
                        <SelectItem value="fixed" className="text-xs">
                            Fixed size
                        </SelectItem>
                    </SelectContent>
                </Select>
            </Row>
        </Section>
    );
}

function ImageSection({ nodes, ids }: { nodes: AnyNode[]; ids: string[] }) {
    if (!nodes.every((n) => n.type === 'image')) return null;
    const fit = common((nodes as ImageNode[]).map((n) => n.fit));
    return (
        <Section title="Image">
            <Select
                value={fit === MIXED ? undefined : fit}
                onValueChange={(v) =>
                    editNodes(
                        ids,
                        (n) => void (n.type === 'image' && (n.fit = v as ImageNode['fit'])),
                    )
                }
            >
                <SelectTrigger size="sm" className="h-7 w-full text-xs">
                    <SelectValue placeholder="Mixed" />
                </SelectTrigger>
                <SelectContent>
                    <SelectItem value="cover" className="text-xs">
                        Fill (crop)
                    </SelectItem>
                    <SelectItem value="contain" className="text-xs">
                        Fit
                    </SelectItem>
                    <SelectItem value="fill" className="text-xs">
                        Stretch
                    </SelectItem>
                </SelectContent>
            </Select>
        </Section>
    );
}

function EffectsSection({ nodes, ids }: { nodes: AnyNode[]; ids: string[] }) {
    if (nodes.some((n) => n.type === 'raw')) return null;
    const opacity = common(nodes.map((n) => Math.round(n.opacity * 100)));
    const shadows = nodes.map((n) => n.shadow);
    const has = shadows.some(Boolean);
    const setShadow = (fn: (s: NonNullable<AnyNode['shadow']>) => void, live = false) =>
        editNodes(
            ids,
            (n) => {
                n.shadow ??= { x: 0, y: 4, blur: 12, spread: 0, color: '#0000002e' };
                fn(n.shadow);
            },
            live,
        );
    const get = (k: 'x' | 'y' | 'blur') => common(shadows.map((s) => s?.[k] ?? 0));
    return (
        <>
            <Section title="Layer">
                <Row>
                    <NumberField
                        label="%"
                        min={0}
                        max={100}
                        title="Opacity"
                        value={opacity}
                        onCommit={(v, live) =>
                            editNodes(ids, (n) => void (n.opacity = v / 100), live)
                        }
                    />
                </Row>
            </Section>
            <Section
                title="Drop shadow"
                action={
                    has ? (
                        <IconButton
                            label="Remove shadow"
                            onClick={() => editNodes(ids, (n) => void delete n.shadow)}
                        >
                            <Minus className="size-3.5" />
                        </IconButton>
                    ) : (
                        <IconButton label="Add shadow" onClick={() => setShadow(() => {})}>
                            <Plus className="size-3.5" />
                        </IconButton>
                    )
                }
            >
                {has && (
                    <>
                        <Row className="grid-cols-3">
                            <NumberField
                                label="X"
                                value={get('x')}
                                onCommit={(v, l) => setShadow((s) => void (s.x = v), l)}
                            />
                            <NumberField
                                label="Y"
                                value={get('y')}
                                onCommit={(v, l) => setShadow((s) => void (s.y = v), l)}
                            />
                            <NumberField
                                label="B"
                                min={0}
                                value={get('blur')}
                                onCommit={(v, l) => setShadow((s) => void (s.blur = v), l)}
                                title="Blur"
                            />
                        </Row>
                        <ColorField
                            color={common(shadows.map((s) => s?.color)) as Maybe<string>}
                            onChange={(p) => setShadow((s) => void (s.color = p.color))}
                        />
                    </>
                )}
            </Section>
        </>
    );
}

function PageProperties() {
    const project = useEditor((s) => s.project);
    const doc = useEditor((s) => s.doc);
    if (!project || !doc) return null;
    return (
        <Section title={doc.kind === 'page' ? 'Page' : 'Component file'}>
            {doc.kind === 'page' ? (
                <TextField
                    value={docName(project, doc)}
                    onCommit={(v) => v.trim() && renamePage(doc.file, v.trim())}
                />
            ) : (
                <p className="text-muted-foreground text-xs">{doc.file}</p>
            )}
            <p className="text-muted-foreground text-[11px]">{doc.file}</p>
        </Section>
    );
}

export function PropertiesPanel() {
    const roots = useDocRoots();
    const ids = useEditor((s) => s.selection);
    const nodes = ids.map((id) => findNode(roots, id)).filter(Boolean) as AnyNode[];
    if (!nodes.length) {
        return (
            <ScrollArea className="h-full">
                <PageProperties />
            </ScrollArea>
        );
    }
    const title = nodes.length > 1 ? `${nodes.length} layers` : label(nodes[0]!);
    const props = { nodes, ids };
    return (
        <ScrollArea className="h-full">
            <div className="flex h-9 items-center justify-between border-b px-3">
                <span className="text-xs font-semibold">{title}</span>
                {nodes.length === 1 && (
                    <span className="text-muted-foreground truncate pl-2 text-[11px]">
                        {nodes[0]!.name}
                    </span>
                )}
            </div>
            <InstanceSection {...props} />
            <VariantSection {...props} />
            <GeometrySection {...props} />
            <ChildLayoutSection {...props} />
            <AutoLayoutSection {...props} />
            <FrameSection {...props} />
            <div className="px-3 pb-1 empty:hidden [&>*]:mt-0">
                <RadiusRow {...props} />
            </div>
            <FillSection {...props} />
            <StrokeSection {...props} />
            <TextSection {...props} />
            <ImageSection {...props} />
            <EffectsSection {...props} />
        </ScrollArea>
    );
}
