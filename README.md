# dsh-fold-turns

English | [简体中文](./README.zh-CN.md)

`dsh-fold-turns` keeps long [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Chat conversations easy to read. After a turn finishes, the plugin folds its intermediate reasoning, context injection, and tool activity into a compact **Worked for …** row. The final answer stays visible, and the complete process is always one click away.

- Completed process rows fold automatically.
- Running turns stay expanded and show live elapsed time.
- Expanding restores DSH's native content and local UI state.
- Incomplete or incompatible turns stay visible instead of being hidden.

This is a Web-only plugin. It does not change the agent's output or conversation data.

## Demo

### Folded

The intermediate process is replaced by a compact duration row while the final answer remains visible.

![A completed DeepSeek Harness turn folded into a compact duration row](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-fold.png)

### Expanded

Click either duration row to restore the original context, reasoning, and tool activity.

![The upper part of an expanded DeepSeek Harness turn](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-1.png)

![The lower part of an expanded DeepSeek Harness turn](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-2.png)

## Install

Install the published npm package into the DSH Web profile:

```sh
dsh plugin --profile web add dsh-fold-turns
```

Restart the Web process after installing or updating the plugin. DSH composes its client module list at startup.

To install a downloaded release tarball instead:

```sh
dsh plugin --profile web add ./dsh-fold-turns-0.1.4.tgz
```

Remove the plugin with:

```sh
dsh plugin --profile web remove dsh-fold-turns
```

Direct installation from a GitHub source URL is intentionally unsupported. Use the npm package or a prebuilt release tarball.

## Using the plugin

No configuration is required. An active turn stays fully expanded and shows a passive `Running for …` row once its source message is known. When an eligible turn completes, that row changes to the exact final duration and the intermediate process folds automatically.

Click either duration row to expand or collapse the turn. A turn without foldable process content gets no control.

The plugin is designed to fail open. Incomplete history, unknown Chat node kinds, abnormal completion, or an incompatible DOM should leave DSH's native content visible.

## Compatibility

> Experimental: the plugin relies on DeepSeek Harness browser and Chat DOM contracts that are not yet stable public APIs. Keep a rollback path and recheck real conversations after every DSH upgrade.

| DSH host | Status |
| --- | --- |
| `0.1.0-rc.6` | Experimental, verified baseline |
| Other releases | Unsupported until revalidated |

## Development

### Build from a clone

Node `22.19+` (or `24+`) and pnpm are required:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm run test:browser
pnpm pack
```

The resulting `dsh-fold-turns-<version>.tgz` is directly installable with the tarball command above. `pnpm pack` runs the build through `prepack`, so a clean clone does not need checked-in `lib/` output.

React and the `@deepseek-ai/dsh-client-*` peer modules are supplied by the DSH browser module table. They remain external to the client bundle; optional peer metadata prevents a standalone profile install from duplicating host-owned instances.

### Host verification

For a real local DSH boot check, install the verified DSH CLI and Chromium, then run:

```sh
pnpm exec playwright install chromium
REQUIRE_REAL_DSH=1 pnpm run test:dsh
```

Without `REQUIRE_REAL_DSH=1`, that script reports a skip when `dsh` is unavailable. The CLI version must match `EXPECTED_DSH_VERSION`, which defaults to `0.1.0-rc.6`. CI enables this tarball boot smoke when the repository variable `RUN_REAL_DSH_SMOKE` is `true`.

Before a release, run the deterministic real-session gate against a built DeepSeek Harness source checkout:

```sh
DSH_SOURCE_DIR=../deepseek-harness pnpm run test:dsh-session
```

`test:dsh-session` builds the plugin first and rejects a DSH checkout whose package version differs from `EXPECTED_DSH_VERSION`. It replays a two-step tool turn, exercises both controls, checks DOM and focus order, switches sessions, and verifies that paging preserves the reader's scroll anchor.

### Verification coverage

| DSH host | Build/package | Tarball install + Web boot | Real session folding |
| --- | --- | --- | --- |
| `0.1.0-rc.6` | Automated | Automated optional gate | Automated source gate + manual assistive-technology review |
| Other releases | CI may compile against compatible peers | Not claimed | Not claimed |

The unit suite covers fold rules, controller update boundaries, session state, renderer accessibility, DOM ownership and cleanup, late React commits, and the DSH browser-module ABI. The Chromium suite executes the built browser factory in a real DOM. Visual and assistive-technology checks remain manual release steps.

### Maintainer release checks

```sh
pnpm install --frozen-lockfile
export DSH_SOURCE_DIR=../deepseek-harness
export EXPECTED_DSH_VERSION=0.1.0-rc.6
pnpm run verify:release
pnpm run verify:host
pnpm pack --dry-run
pnpm publish
```

`verify:release` covers the portable build, unit suite, Chromium bundle tests, dependency audit, and package contracts. `verify:host` additionally requires the matching real DSH CLI and source checkout. `prepublishOnly` repeats both verification layers and a dry-run pack, so `pnpm publish` fails when either real-host gate is unavailable or red.

Publishing, provenance attestation, Git tags, GitHub Releases, and repository-variable configuration remain external maintainer actions.
