# Open Vector Design (OVD) Format — Draft Spec v0.1

Sep 29, 2026

> Note: this is the spec as drafted. The sample project in this repository already applies nine
> refinements found while building it (see "What building this taught us" in README.md); they are
> not yet merged into this text.

## 1. Overview

OVD is an open, SVG-based file format for freeform UI design: canvases, frames, components, variants and layout, stored as plain files that any tool can read and any Git host can version. Every OVD file is a valid SVG, so a browser renders it with no special software; OVD-aware editors read an extra `ovd:` namespace to restore editing behaviour. "OVD" (Open Vector Design) is a working name.

**Goals**

- An open alternative to closed formats such as `.fig`, `.sketch` and `.xd`, built only on published standards.
- Files that render anywhere (graceful degradation to plain SVG) and edit fully in OVD-aware tools.
- Components that live in their own files and link together, so designs can be split, shared and reused.
- Design tokens in the W3C Design Tokens Community Group (DTCG) format, shared with code.
- History, branching and review through Git, with readable diffs.

**Non-goals for v0.x**

- Real-time multiplayer editing (Git gives async collaboration first; CRDT sync can come later).
- Full prototyping and animation.
- Lossless round-tripping of every Figma, Sketch or XD feature.

## 2. Principles and standards

OVD invents as little as possible: each concern maps to an existing open standard, and the `ovd:` namespace only fills gaps those standards leave.

1. **Renders without OVD.** Every file is valid SVG 1.1/2. A viewer that ignores `ovd:` attributes can still parse and draw it; for exact, tamper-free viewing, OVD tools export a flattened SVG (section 5).
2. **Standards first.** Use an existing standard before defining anything new; where OVD adds vocabulary, it mirrors CSS names and semantics.
3. **One component, one file.** Small files diff, merge and review well in Git.
4. **Text, not binary.** UTF-8 XML and JSON only. Binary assets sit beside the text, never inside it.
5. **Stable IDs.** Every addressable element has a persistent ID so links, overrides and history survive edits.
6. **Unknown data is preserved.** Tools keep attributes and namespaces they don't understand, so round-trips between tools are lossless.

| Concern | Standard used |
| --- | --- |
| Vector graphics, shapes, groups, masks | [SVG 2](https://www.w3.org/TR/SVG2/) |
| Linking and reuse | SVG `<use>`, `<symbol>`, fragment identifiers; URLs per RFC 3986 |
| Styling | CSS custom properties and CSS values |
| Layout semantics | CSS Flexbox and Grid vocabulary |
| Design tokens | [DTCG Format Module](https://www.designtokens.org/) (`.tokens.json`) |
| Colour | CSS Color Module Level 4 (sRGB, Display P3, OKLCH) |
| Fonts | WOFF2, CSS `@font-face` |
| Raster assets | PNG, JPEG, WebP, AVIF |
| Manifest and metadata | JSON with a published JSON Schema |
| Packaging for transfer | ZIP container (like EPUB and OpenDocument) |
| Versioning | Git |
| Accessibility metadata | ARIA roles and labels, SVG `<title>` and `<desc>` |

## 3. Project structure

An OVD project is a folder (and usually a Git repository) with a manifest at its root. For sharing as a single file, the same folder is zipped with the extension `.ovd`.

```
my-app-design/
├── manifest.json             # manifest (required)
├── tokens/
│   ├── base.tokens.json      # DTCG tokens: colours, spacing, type
│   └── themes/
│       ├── light.tokens.json
│       └── dark.tokens.json
├── components/
│   ├── button.svg            # one component (with its variants)
│   ├── input.svg
│   └── card.svg
├── pages/
│   ├── onboarding.svg        # a page = a canvas holding frames
│   └── dashboard.svg
├── assets/
│   ├── images/hero.webp
│   └── fonts/Inter.woff2
├── exports/                  # flattened, view-only SVGs (generated)
├── comments/                 # optional, one JSON file per thread
└── .gitattributes            # marks assets for Git LFS
```

**Manifest (`manifest.json`)**

```json
{
  "$schema": "https://ovd.dev/schema/0.1/manifest.json",
  "version": "0.1",
  "name": "My App Design",
  "id": "urn:uuid:6f1c2a4e-8d3b-4c1a-9e7f-2b5d8a0c3e11",
  "exports": "exports/",
  "tokens": ["tokens/base.tokens.json"],
  "themes": {
    "light": ["tokens/themes/light.tokens.json"],
    "dark": ["tokens/themes/dark.tokens.json"]
  },
  "pages": [
    { "file": "pages/onboarding.svg", "name": "Onboarding" },
    { "file": "pages/dashboard.svg", "name": "Dashboard" }
  ],
  "libraries": [
    { "name": "core-ui", "url": "https://github.com/acme/core-ui-ovd", "ref": "v1.2.0" }
  ]
}
```

External libraries are other OVD projects, pinned to a Git tag or commit, so a shared design system is versioned like a code dependency.

## 4. Document format

A page file is an SVG whose root declares the `ovd` namespace. Frames are `<g>` elements with `ovd:type="frame"`; layers are ordinary SVG elements; editor-only data lives in `ovd:` attributes or an `<ovd:meta>` block inside `<metadata>`.

```xml
<svg xmlns="http://www.w3.org/2000/svg"
     xmlns:ovd="https://ovd.dev/ns/0.1"
     ovd:version="0.1" ovd:type="page" ovd:name="Onboarding"
     viewBox="0 0 2400 1600">

  <g id="f_welcome" ovd:type="frame" ovd:name="Welcome / Mobile"
     transform="translate(100 100)"
     ovd:width="390" ovd:height="844" ovd:clip="true"
     ovd:layout="flex" ovd:direction="column" ovd:gap="{spacing.md}"
     ovd:padding="{spacing.lg}">
    <title>Welcome screen</title>
    <rect width="390" height="844" fill="var(--color-surface, #ffffff)"
          ovd:fill="{color.surface}"/>

    <text id="t_heading" ovd:type="text" ovd:text-style="{typography.heading.xl}"
          x="24" y="120" fill="var(--color-text, #111111)">Welcome</text>

    <use id="i_cta" href="../components/button.svg#c_button"
         ovd:type="instance" ovd:variant="primary"
         x="24" y="760"/>
  </g>
</svg>
```

**Element types (`ovd:type`)**

| Value | SVG element | Meaning |
| --- | --- | --- |
| `page` | `<svg>` root | A canvas holding frames |
| `frame` | `<g>` | Artboard or container; may clip and have layout |
| `group` | `<g>` | Plain grouping, no layout |
| `component` | `<symbol>` | Reusable definition (section 5) |
| `instance` | `<use>` | Placement of a component |
| `text` | `<text>` or `<foreignObject>` | Text layer (section 7) |
| `image` | `<image>` | Raster or vector asset |
| `shape` | `<rect>`, `<ellipse>`, `<path>`, … | Vector shape (default if omitted) |

**Rules**

- Geometry uses real SVG attributes (`x`, `width`, `transform`, `d`). `ovd:width` and `ovd:height` exist only where SVG has no native size, such as on `<g>`.
- Token references use DTCG alias syntax, `{group.token}`. Each one must be paired with a resolved fallback in plain SVG/CSS (for example `fill="var(--color-surface, #ffffff)"`) so the file renders without OVD.
- Every element an OVD tool creates gets a stable `id`, unique within its file. Cross-file references use `path#id`.
- Layer order is document order, as in SVG. Hidden and locked states are `ovd:hidden="true"` (plus `visibility="hidden"` for rendering) and `ovd:locked="true"`.

## 5. Components, instances and variants

A component is an SVG `<symbol>`; an instance is a `<use>` pointing at it, in the same file or another. Variants are sibling symbols grouped into a set, and overrides are declared on the instance by the target layer's ID.

**Component file (`components/button.svg`)**

```xml
<svg xmlns="http://www.w3.org/2000/svg" xmlns:ovd="https://ovd.dev/ns/0.1"
     ovd:type="library">
  <defs>
    <symbol id="c_button" ovd:type="component-set" ovd:name="Button"
            ovd:props='{"variant":["primary","secondary"],"size":["md","sm"],"label":"text","icon":"boolean"}'
            ovd:default="variant=primary,size=md">

      <symbol id="c_button__primary_md" ovd:type="component"
              ovd:variant="variant=primary,size=md"
              viewBox="0 0 160 48" width="160" height="48"
              ovd:layout="flex" ovd:direction="row" ovd:align="center"
              ovd:padding="{spacing.sm} {spacing.md}" ovd:sizing="hug">
        <rect id="bg" width="160" height="48" rx="8"
              fill="var(--color-primary, #4f46e5)" ovd:fill="{color.primary}"/>
        <text id="label" ovd:prop="label" x="80" y="30" text-anchor="middle"
              fill="#ffffff">Button</text>
      </symbol>
      <!-- more variants … -->
    </symbol>
  </defs>
</svg>
```

**Instance with overrides**

```xml
<use id="i_cta" href="../components/button.svg#c_button"
     ovd:type="instance" ovd:variant="variant=primary,size=md"
     x="24" y="760">
  <ovd:override target="label" text="Get started"/>
  <ovd:override target="bg" fill="{color.accent}"/>
</use>
```

**Rules**

- `href` resolves to the default variant when no `ovd:variant` is set. Resolution order: same file, relative path, then a manifest library (`core-ui:button.svg#c_button`).
- Component props are typed: an enum (variant axis), `text`, `boolean` (show/hide layer), or `instance` (swap a nested component).
- Overrides may change text, fills, strokes, visibility, nested instance swaps and token references. They may not change structure; that requires detaching.
- Source files hold only the `<use>` link and its overrides, never cached copies. For viewing, the editor exports each page as a flattened, self-contained SVG on every save or commit, into the folder named by the manifest's `exports` field (default `exports/`). Components are resolved, overrides applied, and fonts and images inlined; the same step runs as `ovd export` in CI. Viewers open these exports, so viewing never requires touching or rewriting the source files.
- Detaching an instance replaces the `<use>` with a copy of the resolved content and records `ovd:detached-from`.

## 6. Layout

OVD layout reuses CSS Flexbox and Grid names and semantics, so the rules are already specified and translate directly to code. The editor computes positions and writes the results into plain SVG coordinates; the `ovd:` attributes record the intent.

| Attribute | Values (CSS equivalent) | Applies to |
| --- | --- | --- |
| `ovd:layout` | `none` · `flex` · `grid` | frame, component |
| `ovd:direction` | `row` · `column` (flex-direction) | flex |
| `ovd:wrap` | `nowrap` · `wrap` (flex-wrap) | flex |
| `ovd:gap` | length or token | flex, grid |
| `ovd:padding` | 1–4 lengths or tokens (padding) | flex, grid |
| `ovd:align` | `start` · `center` · `end` · `stretch` · `baseline` (align-items) | flex, grid |
| `ovd:justify` | `start` · `center` · `end` · `space-between` (justify-content) | flex, grid |
| `ovd:grid-template` | CSS grid-template syntax | grid |
| `ovd:sizing` | `fixed` · `hug` · `fill`, per axis as `h v` | any child |
| `ovd:min-width` … `ovd:max-height` | length | any child |
| `ovd:constraints` | `left right top bottom center scale`, e.g. `left-right top` | children of `layout=none` frames |
| `ovd:position` | `auto` · `absolute` (ignore parent layout) | any child |

**Rules**

- Resolved `x`, `y`, `width`, `height` and `transform` are always written, so the file is correct as a static picture.
- On open, an OVD tool recomputes layout from the `ovd:` attributes; if results differ from stored geometry, the attributes win.
- `hug` sizes a container to its content; `fill` takes the remaining space (flex-grow: 1).
- Responsive breakpoints are out of scope for v0.1; use separate frames or variants.

## 7. Text

Text is the weakest part of SVG for design work, because wrapping support (`inline-size`, `shape-inside`) is still patchy across renderers. OVD therefore stores text intent separately from its rendered lines.

```xml
<text id="t_body" ovd:type="text"
      ovd:text-style="{typography.body.md}"
      ovd:box="fixed-width" ovd:width="320"
      ovd:content="Design once, open it anywhere. OVD files are plain SVG."
      font-family="Inter, sans-serif" font-size="16" fill="#333333">
  <tspan x="0" y="20">Design once, open it anywhere. OVD</tspan>
  <tspan x="0" y="44">files are plain SVG.</tspan>
</text>
```

- `ovd:box` is `auto-width` (single line grows), `fixed-width` (wraps) or `fixed` (wraps and clips).
- `ovd:content` holds the source text; `<tspan>` lines are the editor's pre-wrapped render, regenerated on every edit. Rich text is a sequence of `<tspan>` runs with their own style tokens.
- Fonts are referenced by family name and resolved from `assets/fonts/` via `@font-face` in the file's `<style>`, then system fonts.
- `<foreignObject>` with HTML is allowed for export targets that need true reflow, but is not the canonical storage, since many SVG tools don't render it.

## 8. Design tokens (DTCG)

All colours, spacing, radii, typography, shadows and motion values are stored as W3C Design Tokens Community Group tokens in `*.tokens.json` files, with no OVD-specific extensions to the format. The same files can feed Style Dictionary, Tokens Studio or any other DTCG tool, so designers and developers share one source of truth.

```json
{
  "color": {
    "$type": "color",
    "primary": {
      "$value": { "colorSpace": "srgb", "components": [0.31, 0.275, 0.898], "hex": "#4f46e5" }
    },
    "surface": { "$value": "{color.neutral.0}" }
  },
  "spacing": {
    "$type": "dimension",
    "sm": { "$value": { "value": 8, "unit": "px" } },
    "md": { "$value": { "value": 16, "unit": "px" } }
  },
  "typography": {
    "heading": {
      "xl": {
        "$type": "typography",
        "$value": {
          "fontFamily": ["Inter", "sans-serif"],
          "fontSize": { "value": 32, "unit": "px" },
          "fontWeight": 700,
          "lineHeight": 1.2,
          "letterSpacing": { "value": 0, "unit": "px" }
        }
      }
    }
  }
}
```

**How OVD uses tokens**

- In SVG, a token reference is written in DTCG alias syntax in an `ovd:` attribute (`ovd:fill="{color.primary}"`) next to a resolved CSS fallback (`fill="var(--color-primary, #4f46e5)"`).
- Each page file includes a `<style>` block of CSS custom properties generated from the active theme, so plain viewers see correct values.
- Themes (light, dark, brand) are token files layered in the order listed in the manifest; later files override earlier ones. OVD will adopt the DTCG resolver/theming module once it stabilises.
- Supported DTCG types in v0.1: `color`, `dimension`, `fontFamily`, `fontWeight`, `number`, `duration`, `cubicBezier`, `shadow`, `border`, `gradient`, `typography`, `strokeStyle`.
- Changing a token updates every layer that references it on the next open or live in the editor.

## 9. Assets, prototype links and comments

**Assets.** Images and fonts are separate files under `assets/`, referenced by relative path (`<image href="../assets/images/hero.webp">`). Inline `data:` URIs are allowed only in exported single-file SVGs, never in the project, because they bloat diffs.

**Prototype links.** Navigation between frames uses the SVG `<a>` element, so links work in any browser; OVD adds the trigger and transition.

```xml
<a href="dashboard.svg#f_home" ovd:trigger="click"
   ovd:transition="slide-left" ovd:duration="{motion.fast}">
  <use href="../components/button.svg#c_button" ovd:type="instance"/>
</a>
```

**Comments.** Stored outside the SVG so that discussion never creates design diffs. Each thread is a JSON file in `comments/`, anchored to a file, element ID and optional canvas point, and attributed to Git author identities.

```json
{
  "id": "th_01",
  "anchor": { "file": "pages/onboarding.svg", "element": "i_cta", "point": [80, 24] },
  "resolved": false,
  "messages": [
    { "author": "dev@example.com", "time": "2026-09-29T10:12:00Z", "body": "Should this be full-width on mobile?" }
  ]
}
```

## 10. Git-based history

Version history, branching and review use plain Git, so any host (GitHub, GitLab, Gitea, a self-hosted server) works as the backend. For that to be pleasant, OVD requires deterministic output and supplies design-aware diff and merge tools.

**Canonical serialisation (required for writers)**

- Attributes in a fixed order: `id`, `ovd:type`, `ovd:name`, other `ovd:` attributes alphabetically, then SVG attributes alphabetically.
- 2-space indentation, one element per line, LF line endings, UTF-8 without BOM.
- Numbers rounded to 3 decimal places; no trailing zeros; no exponent notation.
- JSON (manifest, tokens, comments) with sorted keys and 2-space indentation.

With these rules, moving one button changes one or two lines, and two people editing different components never conflict.

**Git conventions**

| Git feature | Design meaning |
| --- | --- |
| Commit | A saved version, with a message ("Tighten onboarding spacing") |
| Branch | An exploration or feature ("dark-mode", "checkout-v2") |
| Pull/merge request | Design review, shown with a visual diff |
| Tag | A released library version (`core-ui@1.2.0`) |
| Git LFS | Storage for `assets/` binaries, via `.gitattributes` |
| Submodule or pinned library | A shared design system at a fixed version |

**Tools the project should ship**

1. `ovd diff`: a visual diff (before, after, overlay) plus a semantic summary ("Button/primary: fill changed, padding 12 → 16").
2. `ovd merge`: a Git merge driver registered in `.gitattributes` (`*.svg merge=ovd`) that merges by element ID rather than by line, and flags true conflicts (same property of the same element) for manual choice in the app.
3. `ovd fmt`: rewrites files into canonical form; usable as a pre-commit hook.
4. `ovd validate`: checks files against the JSON Schema and namespace rules.

## 11. Conformance and interop

Tools can support OVD at three levels, so a simple viewer or plugin can adopt it without implementing everything.

| Level | A conforming tool must | Example tools |
| --- | --- | --- |
| 1 · View | Render the exported, flattened SVGs in `exports/` | Browsers, image viewers, docs sites, GitHub previews |
| 2 · Read | Parse the manifest, tokens, components, variants and layout; resolve cross-file links | Code generators, design-to-code plugins, linters |
| 3 · Edit | Everything in level 2, plus write canonical files and preserve unknown `ovd:` and foreign-namespace data | The OVD web app, third-party editors |

**Import and export targets**

| Tool | Source format | Import route | Fidelity expected |
| --- | --- | --- | --- |
| Figma | `.fig` (closed, undocumented) | Figma REST API JSON, with the user's token | Good for frames, components, variants, auto layout, variables → DTCG |
| Sketch | `.sketch` (ZIP of JSON with a published schema) | Direct file parse | Good for symbols, layer styles, text styles |
| Adobe XD | `.xd` (ZIP of JSON, undocumented) | Direct file parse, best effort | Partial; XD is no longer actively developed by Adobe |
| Penpot | `.penpot` export | Direct file parse | Good; also built on web standards |
| Excalidraw | `.excalidraw` (documented JSON) | Direct file parse | Good for freeform shapes and text |

Exports: single-file SVG (flattened, fonts subset and inlined), PNG/PDF, DTCG tokens, and code starters (HTML/CSS, React) from layout and token data.

## 12. Web app MVP and open questions

The first product is a browser-based editor in the spirit of Figma, Sketch and Adobe XD whose native format is OVD, so everything it saves opens in any browser and lives in a Git repo.

**MVP feature set**

1. Infinite canvas with pages and frames; pan, zoom, select, multi-select, snap and guides.
2. Shapes, pen tool for paths, text, images; fills, strokes, radius, shadows.
3. Layers panel and properties panel.
4. Components: create, instance, override, detach; variant sets with props.
5. Auto layout (flex) and constraints.
6. Token manager reading and writing DTCG files; light/dark theme switch.
7. Git: connect a GitHub/GitLab repo or local folder, commit with message, history timeline, branch, visual diff between versions.
8. Share: a read-only link rendering the SVG, plus `.ovd` ZIP and SVG/PNG export.
9. Import from Figma (REST API) and Sketch.

**Suggested building blocks**

| Need | Option |
| --- | --- |
| Language | TypeScript |
| Rendering | SVG DOM for the first version; move to Canvas/WebGL (for example CanvasKit/Skia WASM) when large files get slow |
| Flex layout engine | Yoga (the Flexbox engine behind React Native) |
| Git in the browser | isomorphic-git, with a host API (GitHub/GitLab) for push and pull requests |
| XML parsing and writing | A DOM-based parser plus the `ovd fmt` canonical serialiser |
| Validation | JSON Schema for manifest and tokens |

**Open questions**

- [x] Final name and namespace URL ("OVD" and `ovd.dev` are placeholders; check trademark and domain).
- [x] Viewing: decided — viewers use exported, flattened SVGs; source files carry no cached copies.
- [x] Variant storage: nested `<symbol>` sets (current draft) or one file per variant?
- [x] Real-time multiplayer later: CRDT (for example Yjs) syncing into Git commits, or Git only?
- [ ] Governance: publish the spec under an open licence (CC BY 4.0 for text, MIT/Apache-2.0 for reference code) and propose it to a W3C Community Group once stable?
- [ ] Plugin API shape for third-party tools.
