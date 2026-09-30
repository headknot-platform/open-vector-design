import { Kbd } from '@workspace/ui/components/kbd';
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip';
import { cn } from '@workspace/ui/lib/utils';
import {
    Circle,
    Frame,
    Hand,
    ImagePlus,
    MousePointer2,
    PenTool,
    Slash,
    Square,
    Type,
    type LucideIcon,
} from 'lucide-react';
import { useRef } from 'react';
import { insertImageFiles } from '../lib/images';
import { useHost } from '../host';
import { type BuiltinTool, editor, useEditor } from '../state/store';

const TOOLS: { tool: BuiltinTool; icon: LucideIcon; label: string; key: string }[] = [
    { tool: 'move', icon: MousePointer2, label: 'Move', key: 'V' },
    { tool: 'frame', icon: Frame, label: 'Frame', key: 'F' },
    { tool: 'rect', icon: Square, label: 'Rectangle', key: 'R' },
    { tool: 'ellipse', icon: Circle, label: 'Ellipse', key: 'O' },
    { tool: 'line', icon: Slash, label: 'Line', key: 'L' },
    { tool: 'pen', icon: PenTool, label: 'Pen', key: 'P' },
    { tool: 'text', icon: Type, label: 'Text', key: 'T' },
    { tool: 'hand', icon: Hand, label: 'Hand', key: 'H' },
];

function ToolButton({
    active,
    label,
    shortcut,
    onClick,
    children,
}: {
    active?: boolean;
    label: string;
    shortcut?: string;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <button
                    className={cn(
                        'flex size-8 items-center justify-center rounded-md',
                        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
                    )}
                    onClick={onClick}
                    aria-label={label}
                    aria-pressed={active}
                >
                    {children}
                </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="flex items-center gap-2">
                {label}
                {shortcut && <Kbd>{shortcut}</Kbd>}
            </TooltipContent>
        </Tooltip>
    );
}

export function Toolbar() {
    const tool = useEditor((s) => s.tool);
    const file = useRef<HTMLInputElement>(null);
    const host = useHost();
    const tools = [
        ...TOOLS,
        ...(host.tools ?? []).map((t) => ({
            tool: t.id,
            icon: t.icon,
            label: t.label,
            key: t.key,
        })),
    ];
    return (
        <div className="flex items-center gap-0.5" role="toolbar" aria-label="Tools">
            {tools.map(({ tool: t, icon: Icon, label, key }) => (
                <ToolButton
                    key={t}
                    active={tool === t}
                    label={label}
                    shortcut={key}
                    onClick={() => editor().setTool(t)}
                >
                    <Icon className="size-4" />
                </ToolButton>
            ))}
            <ToolButton label="Place image" onClick={() => file.current?.click()}>
                <ImagePlus className="size-4" />
            </ToolButton>
            <input
                ref={file}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/avif,image/gif,image/svg+xml"
                multiple
                hidden
                onChange={(e) => {
                    void insertImageFiles([...(e.target.files ?? [])]);
                    e.target.value = '';
                }}
            />
        </div>
    );
}
