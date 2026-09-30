/**
 * Renders the model as SVG. Colours bound to tokens render as `var(--token, fallback)`; the canvas
 * root defines the previewed theme's variables, so switching theme re-renders no nodes.
 *
 * Each node is memoised on its object identity — immer keeps untouched nodes identical, so an edit
 * re-renders only the path from the root to the changed node.
 */
import {
    type AnyNode,
    type ComponentNode,
    type FrameNode,
    type ImageNode,
    type InstanceNode,
    type Paint,
    type Project,
    type SceneNode,
    type ShapeNode,
    type TextNode,
    anchorX,
    baselineY,
    cssVarName,
    instanceContent,
    resolveRelative,
    serializeXml,
} from '@workspace/ovd-core';
import { createContext, memo, useContext, useId, useMemo } from 'react';
import { canvasMeasure } from '../lib/measure';
import { useEditor, useTokens } from '../state/store';

/** The file whose scene is being rendered — instance and image hrefs are relative to it. */
export const FileContext = createContext('');
/** Inside instance content nothing is individually pickable. */
const InsideInstance = createContext(false);

export function paintCss(p: Paint | undefined): string {
    if (!p) return 'none';
    return p.token ? `var(${cssVarName(p.token)}, ${p.color})` : p.color;
}

function rotate(n: { rotation: number; width: number; height: number }, ox = 0, oy = 0) {
    return n.rotation ? ` rotate(${n.rotation} ${ox + n.width / 2} ${oy + n.height / 2})` : '';
}

function shadowCss(n: AnyNode): string | undefined {
    const s = n.shadow;
    return s ? `drop-shadow(${s.x}px ${s.y}px ${s.blur / 2}px ${s.color})` : undefined;
}

function usePick(id: string): { 'data-id'?: string } {
    const inside = useContext(InsideInstance);
    return inside ? {} : { 'data-id': id };
}

// ---------------------------------------------------------------------------------------------

export const NodeView = memo(function NodeView({ node }: { node: AnyNode }) {
    if (node.hidden) return null;
    switch (node.type) {
        case 'frame':
        case 'component':
            return <FrameView node={node} />;
        case 'group':
            return <GroupView node={node} />;
        case 'shape':
            return <ShapeView node={node} />;
        case 'text':
            return <TextView node={node} />;
        case 'image':
            return <ImageView node={node} />;
        case 'instance':
            return <InstanceView node={node} />;
        case 'raw':
            return <g dangerouslySetInnerHTML={{ __html: serializeXml(node.xml) }} />;
    }
});

function FrameBody({ node }: { node: FrameNode | ComponentNode }) {
    const clipId = useId();
    const clip = node.clip;
    return (
        <>
            {clip && (
                <clipPath id={clipId}>
                    <rect width={node.width} height={node.height} rx={node.radius || undefined} />
                </clipPath>
            )}
            <g clipPath={clip ? `url(#${clipId})` : undefined}>
                {(node.fill || node.stroke) && (
                    <rect
                        width={node.width}
                        height={node.height}
                        rx={node.radius || undefined}
                        style={{
                            fill: paintCss(node.fill),
                            stroke: node.stroke ? paintCss(node.stroke.paint) : undefined,
                            strokeWidth: node.stroke?.width,
                        }}
                    />
                )}
                {node.children.map((c) => (
                    <NodeView key={c.id} node={c} />
                ))}
            </g>
        </>
    );
}

function FrameView({ node }: { node: FrameNode | ComponentNode }) {
    const pick = usePick(node.id);
    return (
        <g
            {...pick}
            transform={`translate(${node.x} ${node.y})${rotate(node)}`}
            opacity={node.opacity}
            style={{ filter: shadowCss(node) }}
        >
            <FrameBody node={node} />
        </g>
    );
}

function GroupView({ node }: { node: Extract<SceneNode, { type: 'group' }> }) {
    const pick = usePick(node.id);
    return (
        <g
            {...pick}
            transform={`translate(${node.x} ${node.y})${rotate(node)}`}
            opacity={node.opacity}
        >
            {node.children.map((c) => (
                <NodeView key={c.id} node={c} />
            ))}
        </g>
    );
}

function ShapeView({ node }: { node: ShapeNode }) {
    const pick = usePick(node.id);
    const style = {
        fill: paintCss(node.fill),
        stroke: node.stroke ? paintCss(node.stroke.paint) : undefined,
        strokeWidth: node.stroke?.width,
        filter: shadowCss(node),
    };
    const common = { ...pick, opacity: node.opacity, style };
    switch (node.kind) {
        case 'rect':
            return (
                <rect
                    {...common}
                    x={node.x}
                    y={node.y}
                    width={Math.max(0, node.width)}
                    height={Math.max(0, node.height)}
                    rx={node.radius || undefined}
                    transform={rotate(node, node.x, node.y).trim() || undefined}
                />
            );
        case 'ellipse':
            return (
                <ellipse
                    {...common}
                    cx={node.x + node.width / 2}
                    cy={node.y + node.height / 2}
                    rx={Math.abs(node.width / 2)}
                    ry={Math.abs(node.height / 2)}
                    transform={rotate(node, node.x, node.y).trim() || undefined}
                />
            );
        case 'line':
            return (
                <line
                    {...common}
                    x1={node.x}
                    y1={node.y}
                    x2={node.x + node.width}
                    y2={node.y + node.height}
                    style={{ ...style, fill: undefined, strokeLinecap: 'round' }}
                    transform={rotate(node, node.x, node.y).trim() || undefined}
                />
            );
        case 'path':
            return (
                <path
                    {...common}
                    d={node.d}
                    transform={`translate(${node.x} ${node.y})${rotate(node)}`}
                    style={{ ...style, strokeLinejoin: 'round', strokeLinecap: 'round' }}
                />
            );
    }
}

function TextView({ node }: { node: TextNode }) {
    const pick = usePick(node.id);
    const editing = useEditor((s) => s.editingText === node.id);
    const x = anchorX(node);
    return (
        <g
            {...pick}
            transform={`translate(${node.x} ${node.y})${rotate(node)}`}
            opacity={editing ? 0 : node.opacity}
        >
            {/* Transparent hit area: glyphs alone are hard to click. */}
            <rect
                width={Math.max(node.width, 1)}
                height={Math.max(node.height, 1)}
                fill="transparent"
            />
            <text
                style={{
                    fill: paintCss(node.fill),
                    fontFamily: node.fontFamily,
                    fontSize: node.fontSize,
                    fontWeight: node.fontWeight,
                    letterSpacing: node.letterSpacing || undefined,
                    filter: shadowCss(node),
                    whiteSpace: 'pre',
                }}
                textAnchor={node.align === 'start' ? undefined : node.align}
            >
                {node.lines.map((line, i) => (
                    <tspan key={i} x={x} y={baselineY(node, i)}>
                        {line}
                    </tspan>
                ))}
            </text>
        </g>
    );
}

// ---------------------------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------------------------

const urlCache = new WeakMap<Uint8Array, string>();

const MIME: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    avif: 'image/avif',
    gif: 'image/gif',
    svg: 'image/svg+xml',
};

export function assetUrl(project: Project, fromFile: string, href: string): string | undefined {
    if (/^(data:|https?:|blob:)/.test(href)) return href;
    const path = resolveRelative(fromFile, href);
    const bytes = project.assets[path];
    if (!bytes) return undefined;
    let url = urlCache.get(bytes);
    if (!url) {
        const ext = path.split('.').pop()?.toLowerCase() ?? '';
        url = URL.createObjectURL(
            new Blob([bytes as BlobPart], { type: MIME[ext] ?? 'application/octet-stream' }),
        );
        urlCache.set(bytes, url);
    }
    return url;
}

function ImageView({ node }: { node: ImageNode }) {
    const pick = usePick(node.id);
    const file = useContext(FileContext);
    const url = useEditor((s) => (s.project ? assetUrl(s.project, file, node.href) : undefined));
    const par =
        node.fit === 'fill' ? 'none' : node.fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet';
    const transform = rotate(node, node.x, node.y).trim() || undefined;
    if (!url) {
        return (
            <g {...pick} transform={transform}>
                <rect
                    x={node.x}
                    y={node.y}
                    width={node.width}
                    height={node.height}
                    fill="#e5e7eb"
                    stroke="#9ca3af"
                    strokeDasharray="4 4"
                />
            </g>
        );
    }
    return (
        <image
            {...pick}
            href={url}
            x={node.x}
            y={node.y}
            width={node.width}
            height={node.height}
            preserveAspectRatio={par}
            opacity={node.opacity}
            transform={transform}
            style={{ filter: shadowCss(node) }}
        />
    );
}

// ---------------------------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------------------------

function InstanceView({ node }: { node: InstanceNode }) {
    const pick = usePick(node.id);
    const file = useContext(FileContext);
    const project = useEditor((s) => s.project);
    const components = project?.components;
    const tokens = useTokens();
    const content = useMemo(
        () =>
            project && tokens
                ? instanceContent(project, file, node, { tokens, measure: canvasMeasure })
                : undefined,
        // Re-resolve when this instance, any component or the tokens change — not on every edit.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [node, components, tokens, file],
    );
    const transform = `translate(${node.x} ${node.y})${rotate(node)}`;
    if (!content) {
        return (
            <g {...pick} transform={transform}>
                <rect
                    width={node.width || 100}
                    height={node.height || 40}
                    fill="#fee2e2"
                    stroke="#ef4444"
                    strokeDasharray="4 4"
                />
                <text x={6} y={16} fontSize={11} fill="#b91c1c">
                    Missing component
                </text>
            </g>
        );
    }
    return (
        <g
            {...pick}
            transform={transform}
            opacity={node.opacity}
            style={{ filter: shadowCss(node) }}
        >
            <FileContext.Provider value={content.file.file}>
                <InsideInstance.Provider value={true}>
                    <FrameBody node={content.root} />
                </InsideInstance.Provider>
            </FileContext.Provider>
        </g>
    );
}

// ---------------------------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------------------------

/** The previewed theme's tokens as CSS custom properties (`--color-primary: …`). */
export function useTokenVars(): React.CSSProperties {
    const tokens = useTokens();
    return useMemo(() => {
        const out: Record<string, string> = {};
        if (tokens) for (const [path, t] of tokens.tokens) if (t.css) out[cssVarName(path)] = t.css;
        return out as React.CSSProperties;
    }, [tokens]);
}

/** A thumbnail of a component variant, drawn with the canvas renderer. */
export function ComponentPreview({
    node,
    file,
    className,
}: {
    node: ComponentNode;
    file: string;
    className?: string;
}) {
    const vars = useTokenVars();
    return (
        <svg
            viewBox={`0 0 ${Math.max(1, node.width)} ${Math.max(1, node.height)}`}
            className={className}
            style={{ ...vars, overflow: 'visible' }}
            aria-hidden
        >
            <FileContext.Provider value={file}>
                <InsideInstance.Provider value={true}>
                    <FrameBody node={node} />
                </InsideInstance.Provider>
            </FileContext.Provider>
        </svg>
    );
}
