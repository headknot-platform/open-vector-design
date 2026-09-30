/** Token manager (spec §8): browse, edit, add and delete DTCG tokens. */
import { type ResolvedToken, TOKEN_TYPES, type TokenType } from '@workspace/ovd-core';
import { Button } from '@workspace/ui/components/button';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@workspace/ui/components/dialog';
import { Input } from '@workspace/ui/components/input';
import { Label } from '@workspace/ui/components/label';
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover';
import { ScrollArea } from '@workspace/ui/components/scroll-area';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@workspace/ui/components/select';
import { Plus, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { addToken, removeToken, tokenFiles, updateToken } from '../state/tokens';
import { useEditor, useTokens } from '../state/store';

const PATH_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/;

function isObject(v: unknown): v is Record<string, unknown> {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Text shown in the editor for a raw $value. */
function toText(value: unknown, type: TokenType): string {
    if (typeof value === 'string') return value;
    if (type === 'color' && isObject(value) && typeof value['hex'] === 'string')
        return value['hex'];
    if (type === 'dimension' && isObject(value)) return `${value['value']}${value['unit'] ?? 'px'}`;
    if (typeof value === 'number') return String(value);
    return JSON.stringify(value);
}

/** Parses what the user typed back into a DTCG $value. */
export function parseTokenValue(text: string, type: TokenType): unknown {
    const t = text.trim();
    if (/^\{[^{}]+\}$/.test(t)) return t; // alias
    switch (type) {
        case 'color':
            return t;
        case 'dimension': {
            const m = /^(-?[\d.]+)\s*(px|rem|em)?$/.exec(t);
            return m ? { value: Number(m[1]), unit: m[2] ?? 'px' } : t;
        }
        case 'number':
            return Number(t);
        case 'fontWeight':
            return /^\d+$/.test(t) ? Number(t) : t;
        case 'duration': {
            const m = /^(-?[\d.]+)\s*(ms|s)?$/.exec(t);
            return m ? { value: Number(m[1]), unit: m[2] ?? 'ms' } : t;
        }
        default:
            try {
                return JSON.parse(t);
            } catch {
                return t;
            }
    }
}

function Swatch({ t }: { t: ResolvedToken }) {
    if (t.type === 'color')
        return <span className="size-4 shrink-0 rounded border" style={{ background: t.css }} />;
    return (
        <span className="text-muted-foreground w-4 shrink-0 text-center text-[10px] uppercase">
            {t.type.slice(0, 2)}
        </span>
    );
}

function TokenEditor({ t, onDone }: { t: ResolvedToken; onDone: () => void }) {
    const initial = toText(t.value, t.type);
    const [text, setText] = useState(initial);
    const hex = /^#[0-9a-f]{6}/i.test(t.css) ? t.css.slice(0, 7) : '#000000';
    const commit = (v = text) => {
        if (v.trim() === initial.trim()) return;
        // Keep the colour-object form when the file used it and the user entered a plain hex.
        let value = parseTokenValue(v, t.type);
        if (
            t.type === 'color' &&
            isObject(t.value) &&
            typeof value === 'string' &&
            /^#[0-9a-f]{6}$/i.test(value)
        ) {
            const n = parseInt(value.slice(1), 16);
            value = {
                colorSpace: 'srgb',
                components: [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(
                    (c) => Math.round((c / 255) * 1000) / 1000,
                ),
                hex: value.toLowerCase(),
            };
        }
        updateToken(t.source, t.path, value);
    };
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium">{t.path}</span>
                <span className="text-muted-foreground text-[11px]">{t.type}</span>
            </div>
            <div className="flex items-center gap-1.5">
                {t.type === 'color' && (
                    <input
                        type="color"
                        className="size-7 shrink-0 cursor-pointer rounded border bg-transparent"
                        value={hex}
                        onChange={(e) => {
                            setText(e.target.value);
                            commit(e.target.value);
                        }}
                        aria-label="Pick colour"
                    />
                )}
                <Input
                    className="h-7 text-xs"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                            commit();
                            onDone();
                        }
                    }}
                    onBlur={() => commit()}
                />
            </div>
            <p className="text-muted-foreground text-[11px]">
                {t.aliasOf ? `→ {${t.aliasOf}} = ${t.css}` : t.css}
                <br />
                in {t.source}
            </p>
            <Button
                variant="ghost"
                size="sm"
                className="text-destructive h-7 justify-start text-xs"
                onClick={() => {
                    removeToken(t.source, t.path);
                    onDone();
                }}
            >
                <Trash2 className="size-3.5" /> Delete token
            </Button>
        </div>
    );
}

function TokenRow({ t }: { t: ResolvedToken }) {
    const [open, setOpen] = useState(false);
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    className="hover:bg-accent flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs"
                    title={t.description}
                >
                    <Swatch t={t} />
                    <span className="min-w-0 flex-1 truncate">
                        {t.path.split('.').slice(1).join('.') || t.path}
                    </span>
                    <span className="text-muted-foreground max-w-20 shrink-0 truncate text-[11px] tabular-nums">
                        {t.aliasOf ? `{${t.aliasOf}}` : t.type === 'color' ? '' : t.css}
                    </span>
                </button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" className="w-64">
                <TokenEditor t={t} onDone={() => setOpen(false)} />
            </PopoverContent>
        </Popover>
    );
}

function AddTokenDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
}) {
    const project = useEditor((s) => s.project);
    const theme = useEditor((s) => s.previewTheme);
    const tokens = useTokens();
    const files = project ? tokenFiles(project, theme) : [];
    const [path, setPath] = useState('');
    const [type, setType] = useState<TokenType>('color');
    const [value, setValue] = useState('#4f46e5');
    const [file, setFile] = useState(files[0] ?? '');
    const error = !PATH_RE.test(path)
        ? 'Use dot-separated names, e.g. color.brand'
        : tokens?.tokens.has(path)
          ? 'A token with this path exists'
          : null;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                    <DialogTitle>New token</DialogTitle>
                </DialogHeader>
                <form
                    className="grid gap-3"
                    onSubmit={(e) => {
                        e.preventDefault();
                        if (error || !file) return;
                        addToken(file, path, type, parseTokenValue(value, type));
                        onOpenChange(false);
                        setPath('');
                    }}
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <div className="grid gap-1.5">
                        <Label htmlFor="tk-path">Path</Label>
                        <Input
                            id="tk-path"
                            placeholder="color.brand"
                            value={path}
                            onChange={(e) => setPath(e.target.value)}
                            autoFocus
                        />
                        {path && error && <p className="text-destructive text-xs">{error}</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div className="grid gap-1.5">
                            <Label>Type</Label>
                            <Select value={type} onValueChange={(v) => setType(v as TokenType)}>
                                <SelectTrigger className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {TOKEN_TYPES.map((t) => (
                                        <SelectItem key={t} value={t}>
                                            {t}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-1.5">
                            <Label htmlFor="tk-value">Value</Label>
                            <Input
                                id="tk-value"
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="grid gap-1.5">
                        <Label>File</Label>
                        <Select value={file} onValueChange={setFile}>
                            <SelectTrigger className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {files.map((f) => (
                                    <SelectItem key={f} value={f}>
                                        {f}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <DialogFooter>
                        <Button type="submit" disabled={!!error || !file}>
                            Add token
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function TokensPanel() {
    const tokens = useTokens();
    const theme = useEditor((s) => s.previewTheme);
    const [q, setQ] = useState('');
    const [adding, setAdding] = useState(false);
    const groups = useMemo(() => {
        const g = new Map<string, ResolvedToken[]>();
        if (!tokens) return g;
        const query = q.trim().toLowerCase();
        for (const t of [...tokens.tokens.values()].sort((a, b) => a.path.localeCompare(b.path))) {
            if (
                query &&
                !t.path.toLowerCase().includes(query) &&
                !t.css.toLowerCase().includes(query)
            )
                continue;
            const key = t.path.split('.')[0]!;
            g.set(key, [...(g.get(key) ?? []), t]);
        }
        return g;
    }, [tokens, q]);
    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-1.5 p-2">
                <Input
                    className="h-7 text-xs"
                    placeholder={`Search tokens${theme ? ` (${theme})` : ''}`}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                />
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 shrink-0"
                    onClick={() => setAdding(true)}
                    aria-label="New token"
                    title="New token"
                >
                    <Plus className="size-3.5" />
                </Button>
            </div>
            {tokens && tokens.errors.length > 0 && (
                <p className="text-destructive px-3 pb-2 text-[11px]">
                    {tokens.errors.length} token problem(s): {tokens.errors[0]!.path}{' '}
                    {tokens.errors[0]!.message}
                </p>
            )}
            <ScrollArea className="min-h-0 flex-1">
                <div className="flex flex-col gap-2 px-1 pb-4">
                    {[...groups].map(([group, list]) => (
                        <section key={group}>
                            <h3 className="text-muted-foreground px-2 py-1 text-[11px] font-semibold tracking-wide uppercase">
                                {group}
                            </h3>
                            {list.map((t) => (
                                <TokenRow key={t.path} t={t} />
                            ))}
                        </section>
                    ))}
                    {!groups.size && (
                        <p className="text-muted-foreground px-2 text-xs">No tokens match.</p>
                    )}
                </div>
            </ScrollArea>
            <AddTokenDialog open={adding} onOpenChange={setAdding} />
        </div>
    );
}
