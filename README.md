# Open Vector Design (OVD)

An open, SVG-based format for UI design — and a free editor for it.

OVD is built on standards that already exist and are maintained in the open: **SVG** (W3C) for
drawings, **DTCG** design tokens for colours, type and spacing, and **Git** for history. A project is
a plain folder of files that diff, review and merge like code.

|                                            |                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [`OVD-spec-v0.1.md`](OVD-spec-v0.1.md)     | The draft format specification                                                                                            |
| [`docs/spec-notes.md`](docs/spec-notes.md) | Decisions where the draft is silent or ambiguous                                                                          |
| [`packages/ovd-core`](packages/ovd-core)   | Format library: read, write, validate, export, diff, Sketch/Figma import — no DOM, no runtime dependencies; the `ovd` CLI |
| [`packages/ui`](packages/ui)               | UI primitives (shadcn/ui) shared by the editor                                                                            |
| [`examples/starter`](examples/starter)     | A starter project in canonical form                                                                                       |

**The OVD Editor** — a free, standalone editor you can run anywhere, with no account and no
server — is being extracted into this repository. It will open and save a project folder on your
disk, keep an autosave in the browser, and build to static files you can host yourself.

## A project is a folder

```
my-design/
  manifest.json      # name, pages, themes, libraries
  pages/*.svg        # one SVG per page
  components/*.svg   # components and their variants
  tokens/*.json      # DTCG tokens, one file per theme
  assets/            # images, fonts
  exports/           # flattened SVGs any browser can open
```

## Develop

Requires Node ≥ 22.13 and pnpm (pinned in `package.json`).

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm lint
```

The `ovd` CLI (spec §10):

```bash
pnpm --filter @workspace/ovd-core ovd fmt examples/starter        # rewrite in canonical form
pnpm --filter @workspace/ovd-core ovd validate examples/starter
pnpm --filter @workspace/ovd-core ovd export examples/starter     # write exports/
pnpm --filter @workspace/ovd-core ovd diff <old> <new>
```

## License

[Apache-2.0](LICENSE) — the code, the specification and the examples. See [`NOTICE`](NOTICE).
Contributions are accepted under the same license; see [`CONTRIBUTING.md`](CONTRIBUTING.md).
