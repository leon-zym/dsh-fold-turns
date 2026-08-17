# dsh-fold-turns

English | [简体中文](./README.zh-CN.md)

> Experimental: this plugin relies on DeepSeek Harness browser and Chat DOM contracts that are not yet stable public APIs. Use it with the verified host version below and keep a rollback path.

`dsh-fold-turns` is a Web-only DeepSeek Harness plugin. It collapses the completed intermediate process of an eligible Chat turn while preserving the host's native renderers and their local state.

## Install

Install the published npm package into the Web profile:

```sh
dsh plugin --profile web add dsh-fold-turns
```

Restart the Web process after installing or updating it; DSH composes the client module roster at startup.

To install a downloaded release tarball instead:

```sh
dsh plugin --profile web add ./dsh-fold-turns-0.1.4.tgz
```

Remove it with:

```sh
dsh plugin --profile web remove dsh-fold-turns
```

Direct installation from a GitHub source URL is intentionally unsupported. The repository does not run an install-time `prepare` build; use the npm package or a prebuilt release tarball.

## Behavior and risk

An open turn shows a passive `Running for …` status row as soon as its source message is known, while native output remains expanded. When an eligible turn completes, the exact final duration replaces that status and the intermediate process rows collapse. A turn without foldable process content gets no control.

The plugin is designed to fail open: incomplete history, unknown Chat node kinds, abnormal completion, or an incompatible DOM should leave native content visible. Because the implementation still depends on private host DOM shape, validate real conversations after every DSH upgrade. The automated browser contract proves bundle registration and CSS injection; the optional real-host smoke proves tarball installation and Web boot; the source-checkout session gate exercises real conversation, folding, focus, session switching, and paging behavior. Assistive-technology checks and visual review remain manual release checks.

## Compatibility

| DSH host | Build/package | Tarball install + Web boot | Real session folding | Status |
| --- | --- | --- | --- | --- |
| `0.1.0-rc.6` | Automated | Automated optional gate | Automated source gate + manual AT review | Experimental, verified baseline |
| Other releases | CI may compile against compatible peers | Not claimed | Not claimed | Unsupported until revalidated |

React and the `@deepseek-ai/dsh-client-*` peer modules are supplied by the DSH browser module table. They remain external to the client bundle; optional peer metadata prevents a standalone profile install from trying to duplicate host-owned instances.

## Build from a clone

Node `22.19+` (or `24+`) and pnpm are required:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm run test:browser
pnpm pack
```

The resulting `dsh-fold-turns-<version>.tgz` is directly installable with the tarball command above. `pnpm pack` runs the build through `prepack`, so a clean clone does not need checked-in `lib/` output.

For a real local DSH boot check, install the verified DSH CLI and Chromium, then run:

```sh
pnpm exec playwright install chromium
REQUIRE_REAL_DSH=1 pnpm run test:dsh
```

Without `REQUIRE_REAL_DSH=1`, that script reports a skip when `dsh` is unavailable. The CLI version must match `EXPECTED_DSH_VERSION`, which defaults to `0.1.0-rc.6`. CI enables this tarball boot smoke when the repository variable `RUN_REAL_DSH_SMOKE` is `true`; the optional job does not replace the source-checkout session gate.

Before a release, run the deterministic real-session gate against a built
DeepSeek Harness source checkout. It temporarily copies a byte-checked test
into the Harness test tree, removes it afterward without changing tracked
Harness files, replays a two-step tool turn, exercises both toggles,
checks DOM/focus order, switches to long seeded history, and verifies paging
keeps the reader's scroll anchor:

```sh
DSH_SOURCE_DIR=../deepseek-harness pnpm run test:dsh-session
```

`test:dsh-session` builds the plugin first and rejects a DSH source checkout whose package version differs from `EXPECTED_DSH_VERSION` (default `0.1.0-rc.6`). Set that variable explicitly only when validating and releasing against a newly supported host baseline.

## Maintainer release checks

```sh
pnpm install --frozen-lockfile
export DSH_SOURCE_DIR=../deepseek-harness
export EXPECTED_DSH_VERSION=0.1.0-rc.6
pnpm run verify:release
pnpm run verify:host
pnpm pack --dry-run
pnpm publish
```

`verify:release` covers the portable build, unit, Chromium bundle, audit, and package contracts. `verify:host` additionally requires the matching real DSH CLI for tarball install/Web boot and the matching DSH source checkout for the deterministic session gate. Ordinary clone builds do not require either host dependency. `prepublishOnly` repeats both verification layers and a dry-run pack, so `pnpm publish` fails when either real-host gate is unavailable or red. Publishing, provenance attestation, Git tags, GitHub Releases, and repository-variable configuration remain external maintainer actions.

The unit suite covers fold rules, controller update boundaries, session state, renderer accessibility, DOM ownership and cleanup, late React commits, and the DSH browser-module ABI. The Chromium suite executes the actual built browser factory in a real DOM.
