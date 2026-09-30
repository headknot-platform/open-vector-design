import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { Fragment } from 'react';
import { useHost } from '../host';
import { editor, useEditor } from '../state/store';

/** The OVD mark, for hosts that bring no logo of their own. */
function OvdMark() {
    return (
        <svg viewBox="0 0 32 32" className="text-primary size-6" aria-hidden>
            <rect width="32" height="32" rx="7" fill="currentColor" />
            <path
                d="M9 11.5 16 7l7 4.5v9L16 25l-7-4.5z"
                fill="none"
                stroke="white"
                strokeWidth="2.2"
                strokeLinejoin="round"
            />
            <circle cx="16" cy="16" r="2.6" fill="white" />
        </svg>
    );
}

/** The host's entries (open, save, import, export …), then the editor's own. */
export function FileMenu() {
    const { fileMenu } = useHost();
    const name = useEditor((s) => s.source?.name);
    const label = fileMenu?.label ?? name ?? 'No project';
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    className="hover:bg-accent flex h-8 items-center gap-1 rounded-md pr-1.5 pl-1"
                    aria-label="File menu"
                >
                    {fileMenu?.logo ? (
                        <img src={fileMenu.logo} alt="" className="size-6" />
                    ) : (
                        <OvdMark />
                    )}
                    <ChevronDown className="text-muted-foreground size-3" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel className="text-muted-foreground text-[11px] font-normal">
                    {label}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {fileMenu?.sections?.map((section, i) => (
                    <Fragment key={i}>
                        {section.map((item) => (
                            <DropdownMenuItem
                                key={item.label}
                                disabled={item.disabled}
                                onSelect={item.onSelect}
                            >
                                {item.label}
                                {item.shortcut && (
                                    <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut>
                                )}
                            </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                    </Fragment>
                ))}
                <DropdownMenuItem onSelect={() => editor().undo()}>
                    Undo
                    <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => editor().redo()}>
                    Redo
                    <DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
