/** Light/dark for the editor's own chrome — separate from the design's token theme preview. */
import { useEffect, useSyncExternalStore } from 'react';

type Mode = 'light' | 'dark';
const KEY = 'ovd:ui-theme';
const listeners = new Set<() => void>();

function read(): Mode {
    try {
        const v = localStorage.getItem(KEY);
        if (v === 'light' || v === 'dark') return v;
    } catch {
        /* storage unavailable */
    }
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

let mode: Mode = typeof window === 'undefined' ? 'light' : read();

export function setUiTheme(next: Mode): void {
    mode = next;
    try {
        localStorage.setItem(KEY, next);
    } catch {
        /* storage unavailable */
    }
    listeners.forEach((l) => l());
}

export function useUiTheme(): Mode {
    const value = useSyncExternalStore(
        (l) => {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        () => mode,
    );
    useEffect(() => {
        document.documentElement.classList.toggle('dark', value === 'dark');
    }, [value]);
    return value;
}
