## Summary

<!-- What does this PR change, and why? -->

## Linked issue

Closes #

## Changes

<!-- Bullet the notable changes -->
-

## Testing

<!-- Commands you ran and their result; how a reviewer can verify -->
-

## Screenshots / logs

<!-- UI: before/after. Infra/config: relevant log lines. Delete if N/A. -->

## Risk & rollback

<!-- What could break, and how to revert if it does -->

## Checklist

- [ ] Branch is `type/<issue#>-slug`, based on the latest `dev`
- [ ] PR title is a Conventional Commit (`type(scope): subject`)
- [ ] Linked the issue with `Closes #`
- [ ] Self-reviewed the diff; no debug logs or secrets committed
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm test` passes
- [ ] `pnpm --filter editor build` succeeds
- [ ] Verified in light **and** dark mode, and at mobile width (UI changes)
- [ ] OVD files written by the change are canonical (spec §10) and still render as plain SVG
