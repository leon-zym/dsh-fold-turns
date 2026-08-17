# dsh-fold-turns

`dsh-fold-turns` is a Web-only DeepSeek Harness bundle that collapses the completed intermediate process of an eligible Chat turn while preserving the host's native renderers and their local state.

## Install

Build a tarball, then add it to the Web profile:

```sh
pnpm install
pnpm build
pnpm pack
dsh plugin --profile web add ./dsh-fold-turns-0.1.4.tgz
```

Restart the Web process after installing or updating the tarball; the client
module roster is composed during server startup.

## Behavior

An open turn shows a passive `Running for …` status row as soon as its source
message is known, while native output remains fully expanded. On a completed
turn, the exact final duration replaces that status and eligible process rows
are collapsed. A turn with neither process rows nor closing Think content gets
no fold control. Normal user messages are preferred as the boundary; an
upstream-classified `steering` message is used only when it is the only
matching human-input candidate.

## Verify

```sh
pnpm test
pnpm pack --dry-run
```

The suite covers the pure fold rules, controller update boundaries, per-session
state, renderer accessibility, DOM ownership/cleanup, late React row commits,
and the DSH browser-module ABI.

Remove it with:

```sh
dsh plugin --profile web remove dsh-fold-turns
```

The plugin is intentionally fail-open. Incomplete history, unknown Chat node kinds, non-completed turns, or an incompatible Chat DOM leave the native turn unchanged.
