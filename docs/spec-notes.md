# Spec notes — what building the editor taught us

Refinements to [`OVD-spec-v0.1.md`](../OVD-spec-v0.1.md) found while implementing it. Each note says
what the draft leaves open, what `@workspace/ovd-core` does, and a suggested wording, so merging
them into the spec text is mechanical. Numbered in the order they were found.

## Canonical form (§10)

**1. Where namespace declarations go.** §10 fixes the order of `id`, `ovd:type`, `ovd:name`, `ovd:*`
and SVG attributes, but not `xmlns` / `xmlns:*`.
*Implemented:* `xmlns` first, then `xmlns:*` A–Z, then the §10 order.
*Suggested:* add "namespace declarations first" to the attribute-order rule.

**2. Quote character for JSON-valued attributes.** §5 writes `ovd:props='{"variant":[…]}'` in single
quotes; a writer that always double-quotes produces `{&quot;variant&quot;…}`.
*Implemented:* double quotes, unless the value contains `"` and no `'` — then single quotes. The
choice depends only on the value, so output stays deterministic.

**3. Which numbers are rounded.** "Numbers rounded to 3 decimal places; no exponent notation" read
literally rewrites hex colours: `#4f46e5` contains `46e5`.
*Implemented:* rounding applies to a fixed list of geometric attributes (`x`, `y`, `width`, `d`,
`transform`, `viewBox`, `ovd:width`, `ovd:gap`, `ovd:padding`, …), never inside `{token.refs}`.
*Suggested:* state the list, or "numbers in length, coordinate and path-data attributes".

## Document format (§4, §7)

**4. How a frame's background is identified.** The §4 example gives the frame fill as an id-less
first `<rect>`, but no rule says that rect is the frame's fill rather than a layer — and §4 also says
every element a tool creates has an id.
*Implemented:* the first child `<rect>` of a frame (or component symbol) **without an id** is its
background; every layer has an id, so the two cannot collide.

**5. `ovd:clip` needs a real clip path.** `<g>` cannot clip in plain SVG, so `ovd:clip="true"` alone
renders unclipped in a browser (principle 1).
*Implemented:* clipped frames also get `clip-path="url(#<id>__clip)"` and a child
`<clipPath id="<id>__clip">`, which readers recognise as generated and regenerate.

**6. Text position, box and line height.** §7's `<tspan x="0" y="20">` lines are in local
coordinates, so the `<text>` needs a position, and re-wrapping needs the line height, which is not
recoverable from `font-size`.
*Implemented:* `transform="translate(x y)"`, `ovd:width` / `ovd:height` for the box, and
`ovd:line-height` (a multiplier). Baselines are `i·lh + (lh − size)/2 + 0.8·size` — a convention
shared by canvas, file and export, not a font metric.

## Components (§5)

**7. Id scope inside components.** Override targets such as `label` must be the same id in every
variant, so a single file necessarily repeats them — contradicting "unique within its file" (§4).
*Implemented:* symbol ids are unique per file; layer ids are unique per component variant.
*Suggested:* say so explicitly in §4 and §5.

**8. Two forms of `ovd:variant`.** §4 uses `ovd:variant="primary"`, §5 `ovd:variant="variant=primary,size=md"`.
*Implemented:* both. A bare value sets the first enum axis in `ovd:props`; the writer keeps whatever
form was read.

**9. The manifest does not list components.** §3 lists pages and tokens only.
*Implemented:* `components/**/*.svg` are discovered by folder; an optional `components` array in the
manifest overrides discovery.

**10. `<use>` of a component set renders nothing in plain SVG.** A set is a `<symbol>` whose
children are more `<symbol>`s, which are never rendered in place — so a browser shows an empty
instance. This strengthens the decision that viewers open flattened exports (§5, §11 level 1).

## Tokens (§8)

**11. Marking the generated `<style>` block.** Readers need to tell the generated token CSS from
a user's own `<style>`.
*Implemented:* `<style ovd:generated="tokens">`, dropped on read and regenerated from the active theme
on every write.

**12. Shadows have a token type but no attribute.** §8 supports `shadow` tokens, but §4/§6 define no
place to apply one.
*Implemented:* `ovd:shadow="x y blur spread color"` plus a `filter="drop-shadow(…)"` fallback for
plain viewers (CSS drop-shadow has no spread).

**13. Which tokens go in the generated `<style>`.** "A `<style>` block of CSS custom properties
generated from the active theme" could mean every token. Then editing one colour rewrites every page
file in the repo.
*Implemented:* only the tokens the file references, sorted, one declaration per line. Each
token-bound fallback (`var(--x, fallback)`) is also refreshed to the resolved value on write.

**14. "Active theme" when writing.** If files were written with the theme the editor is previewing,
toggling dark mode and saving would rewrite every file.
*Implemented:* files are always written with a default theme — `light` if the manifest has one,
otherwise the first theme A–Z. (Not "the first key": canonical JSON sorts keys, so `dark` would
silently become the default after the first `ovd fmt`.)
*Suggested:* an optional `defaultTheme` in the manifest.

## Rendering (§4, §5)

**15. `var()` in presentation attributes.** §4 pairs every token with `fill="var(--x, fallback)"`
in a presentation attribute. CSS custom properties in presentation attributes are not something every
SVG renderer supports. *Checked:* Chromium (as `<img>` and inline) resolves them correctly — a source
page rasterised with no OVD code shows token colours. *Not yet checked:* Firefox, Safari, and non-browser
renderers (Inkscape, librsvg, image previews on Git hosts). Flattened exports (§5) write literal colours
and are safe everywhere, which is one more reason viewers should read exports.
*Suggested:* state that viewers must not rely on `var()` in source files, or move fallbacks to
`style="fill: var(--x, fallback)"`, which has broader support.

## Packages (§3)

**16. A project is a package folder; there is no `.ovd` file.** §3 says that for sharing as a single
file "the same folder is zipped with the extension `.ovd`", and §12 item 8 lists an "`.ovd` ZIP"
among the share formats. *Decided:* a project has one shape everywhere — on disk, in Git and over the
wire — a **package folder**, like an unpacked Chrome extension. A ZIP is a second format with its own
edge cases (a ZIP of the folder or of its contents, `__MACOSX/`, compression settings changing bytes
for nothing), and it cannot be diffed or versioned, which is what OVD exists for. The editor's
`.ovd` open/download was removed (#37, #38).
*Identified by:* a `manifest.json` at the folder's root. Its `$schema`
(`https://ovd.dev/schema/0.1/manifest.json`) names the format version; `ovd-core` requires the
manifest but does not check `$schema` yet, and should once there is a second version.
*Transfer:* tools move the folder itself — the OVD server stores each package as a folder that is also
a Git repository (`docs/projects.md`), and a download or upload carries the folder's files with their
relative paths. The server sends a download as `<name>.tar.gz` with one top folder (#39): it streams,
it is standard, and macOS, Windows 11 and `tar -xzf` all unpack it — as a folder. The archive is how
the folder travels, not a project format: nothing reads a project from it without unpacking.
*Suggested:* replace the §3 sentence with "An OVD project is a package: a folder with `manifest.json`
at its root, stored and shared as a folder (usually a Git repository). There is no single-file
container." — and in §12 item 8, replace "`.ovd` ZIP" with "a download of the package folder".
