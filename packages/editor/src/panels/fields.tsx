/** Compact inspector fields. Edits commit on Enter / blur / scrub, each as one undo step. */
import { type ResolvedToken, type TokenType } from '@workspace/ovd-core';
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover';
import { cn } from '@workspace/ui/lib/utils';
import { Link2, Link2Off } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { editor, useTokens } from '../state/store';

export const MIXED = Symbol('mixed');
export type Maybe<T> = T | typeof MIXED;

/** The shared value of a field across a selection, or MIXED. */
export function common<T>(values: T[]): Maybe<T> | undefined {
    if (!values.length) return undefined;
    const first = values[0]!;
    return values.every((v) => JSON.stringify(v) === JSON.stringify(first)) ? first : MIXED;
}

export function Section({
    title,
    action,
    children,
}: {
    title: string;
    action?: React.ReactNode;
    children?: React.ReactNode;
}) {
    return (
        <section className="border-b px-3 py-2.5">
            <div className="mb-1.5 flex h-5 items-center justify-between">
                <h3 className="text-[11px] font-semibold">{title}</h3>
                {action}
            </div>
            {children && <div className="flex flex-col gap-1.5">{children}</div>}
        </section>
    );
}

export function Row({ children, className }: { children: React.ReactNode; className?: string }) {
    return <div className={cn('grid grid-cols-2 gap-1.5', className)}>{children}</div>;
}

const round = (n: number) => Math.round(n * 100) / 100;

export function NumberField({
    label,
    value,
    onCommit,
    min,
    max,
    step = 1,
    suffix,
    title,
    className,
}: {
    label: React.ReactNode;
    value: Maybe<number> | undefined;
    onCommit: (v: number, live?: boolean) => void;
    min?: number;
    max?: number;
    step?: number;
    suffix?: string;
    title?: string;
    className?: string;
}) {
    const shown = value === undefined ? '' : value === MIXED ? 'Mixed' : String(round(value));
    const [draft, setDraft] = useState(shown);
    const focused = useRef(false);
    useEffect(() => {
        if (!focused.current) setDraft(shown);
    }, [shown]);

    const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    const commit = (text: string) => {
        // Allow simple arithmetic, e.g. "24*2" or "100-8".
        const expr = text.trim();
        if (!/^[-+*/().\d\s]+$/.test(expr)) return setDraft(shown);
        let n: number;
        try {
            n = Number(Function(`"use strict";return (${expr})`)());
        } catch {
            return setDraft(shown);
        }
        if (!Number.isFinite(n)) return setDraft(shown);
        onCommit(clamp(n));
    };

    // Scrub: drag the label horizontally to change the value.
    const scrub = (e: React.PointerEvent) => {
        if (value === undefined || value === MIXED) return;
        const startX = e.clientX;
        const start = value;
        let last = start;
        editor().checkpoint();
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture(e.pointerId);
        const move = (ev: PointerEvent) => {
            const n = clamp(
                round(
                    start + Math.round((ev.clientX - startX) / 2) * step * (ev.shiftKey ? 10 : 1),
                ),
            );
            if (n !== last) {
                last = n;
                onCommit(n, true);
            }
        };
        const up = () => {
            el.removeEventListener('pointermove', move);
            el.removeEventListener('pointerup', up);
        };
        el.addEventListener('pointermove', move);
        el.addEventListener('pointerup', up);
    };

    return (
        <label
            className={cn(
                'bg-muted/60 focus-within:ring-ring hover:bg-muted flex h-7 items-center rounded-md text-xs focus-within:ring-1',
                className,
            )}
            title={title}
        >
            <span
                className="text-muted-foreground flex w-6 shrink-0 cursor-ew-resize justify-center select-none"
                onPointerDown={scrub}
            >
                {label}
            </span>
            <input
                className="w-full min-w-0 bg-transparent pr-1.5 tabular-nums outline-none"
                value={draft}
                onFocus={(e) => {
                    focused.current = true;
                    e.target.select();
                }}
                onBlur={() => {
                    focused.current = false;
                    if (draft !== shown) commit(draft);
                }}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                        commit(draft);
                        (e.target as HTMLInputElement).blur();
                    } else if (e.key === 'Escape') {
                        setDraft(shown);
                        (e.target as HTMLInputElement).blur();
                    } else if (
                        (e.key === 'ArrowUp' || e.key === 'ArrowDown') &&
                        value !== MIXED &&
                        value !== undefined
                    ) {
                        e.preventDefault();
                        const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
                        onCommit(clamp(round(value + d)));
                    }
                }}
            />
            {suffix && <span className="text-muted-foreground pr-2">{suffix}</span>}
        </label>
    );
}

export function TextField({
    value,
    onCommit,
    placeholder,
    className,
}: {
    value: string;
    onCommit: (v: string) => void;
    placeholder?: string;
    className?: string;
}) {
    const [draft, setDraft] = useState(value);
    useEffect(() => setDraft(value), [value]);
    return (
        <input
            className={cn(
                'bg-muted/60 hover:bg-muted focus:ring-ring h-7 w-full rounded-md px-2 text-xs outline-none focus:ring-1',
                className,
            )}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => draft !== value && onCommit(draft)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') {
                    setDraft(value);
                    (e.target as HTMLInputElement).blur();
                }
            }}
        />
    );
}

// ---------------------------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------------------------

export function TokenPicker({
    type,
    value,
    onPick,
    children,
}: {
    type: TokenType | TokenType[];
    value?: string;
    onPick: (ref: string | undefined, token?: ResolvedToken) => void;
    children: React.ReactNode;
}) {
    const tokens = useTokens();
    const [q, setQ] = useState('');
    const [open, setOpen] = useState(false);
    const types = Array.isArray(type) ? type : [type];
    const list = tokens
        ? [...tokens.tokens.values()].filter(
              (t) => types.includes(t.type) && t.path.includes(q.trim()),
          )
        : [];
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>{children}</PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="end">
                <div className="border-b p-2">
                    <input
                        autoFocus
                        className="bg-muted h-7 w-full rounded px-2 text-xs outline-none"
                        placeholder="Search tokens"
                        value={q}
                        onChange={(e) => setQ(e.target.value)}
                        onKeyDown={(e) => e.stopPropagation()}
                    />
                </div>
                <div className="max-h-72 overflow-auto p-1">
                    {value && (
                        <button
                            className="hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs"
                            onClick={() => {
                                onPick(undefined);
                                setOpen(false);
                            }}
                        >
                            <Link2Off className="size-3.5" /> Detach token
                        </button>
                    )}
                    {list.map((t) => (
                        <button
                            key={t.path}
                            className={cn(
                                'hover:bg-accent flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs',
                                value === `{${t.path}}` && 'bg-accent',
                            )}
                            onClick={() => {
                                onPick(`{${t.path}}`, t);
                                setOpen(false);
                            }}
                        >
                            {t.type === 'color' ? (
                                <span
                                    className="size-3.5 shrink-0 rounded-sm border"
                                    style={{ background: t.css }}
                                />
                            ) : (
                                <span className="text-muted-foreground w-10 shrink-0 truncate tabular-nums">
                                    {t.css}
                                </span>
                            )}
                            <span className="truncate">{t.path}</span>
                        </button>
                    ))}
                    {!list.length && (
                        <p className="text-muted-foreground px-2 py-3 text-xs">
                            No matching tokens
                        </p>
                    )}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export function TokenButton({ bound }: { bound: boolean }) {
    return (
        <button
            className={cn(
                'hover:bg-accent flex size-7 shrink-0 items-center justify-center rounded-md',
                bound ? 'text-primary' : 'text-muted-foreground',
            )}
            title={bound ? 'Bound to a token' : 'Bind to a token'}
        >
            <Link2 className="size-3.5" />
        </button>
    );
}

/** A colour: swatch (native picker), CSS value, and a token binding. */
export function ColorField({
    color,
    token,
    onChange,
}: {
    color: Maybe<string> | undefined;
    token?: Maybe<string | undefined>;
    onChange: (paint: { color: string; token?: string }) => void;
}) {
    const tokens = useTokens();
    const tokenRef = token === MIXED ? undefined : token;
    const resolved = tokenRef && tokens?.tokens.get(tokenRef.slice(1, -1))?.css;
    const shown = color === MIXED ? '' : (resolved ?? color ?? '');
    const hex = /^#[0-9a-f]{6}$/i.test(shown)
        ? shown
        : /^#[0-9a-f]{8}$/i.test(shown)
          ? shown.slice(0, 7)
          : '#000000';
    return (
        <div className="flex items-center gap-1">
            <div className="bg-muted/60 flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md pl-1.5">
                <label
                    className="relative size-4 shrink-0 cursor-pointer overflow-hidden rounded-sm border"
                    style={{ background: shown || 'transparent' }}
                >
                    <input
                        type="color"
                        className="absolute inset-0 cursor-pointer opacity-0"
                        value={hex}
                        onChange={(e) => onChange({ color: e.target.value })}
                    />
                </label>
                {tokenRef ? (
                    <span className="text-primary truncate text-xs" title={shown}>
                        {tokenRef.slice(1, -1)}
                    </span>
                ) : (
                    <TextField
                        className="bg-transparent px-0 hover:bg-transparent focus:ring-0"
                        value={color === MIXED ? 'Mixed' : (color ?? '')}
                        onCommit={(v) => v && v !== 'Mixed' && onChange({ color: v })}
                    />
                )}
            </div>
            <TokenPicker
                type="color"
                value={tokenRef}
                onPick={(ref, t) =>
                    onChange(ref ? { color: t?.css ?? shown, token: ref } : { color: shown })
                }
            >
                <span>
                    <TokenButton bound={!!tokenRef} />
                </span>
            </TokenPicker>
        </div>
    );
}
