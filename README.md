# dsh-fold-turns

`dsh-fold-turns` is a Web-only DeepSeek Harness bundle that collapses the completed intermediate process of an eligible Chat turn while preserving the host's native renderers and their local state.

## Install

Build a tarball, then add it to the Web profile:

```sh
pnpm install
pnpm build
pnpm pack
dsh plugin --profile web add ./dsh-fold-turns-0.1.0.tgz
```

Restart the Web process after installing or updating the tarball; the client
module roster is composed during server startup.

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
