# dsh-fold-turns

English | [简体中文](./README.zh-CN.md)

`dsh-fold-turns` is a Web plugin for [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) that adds automatic fold/collapse behavior to completed Chat turns. It keeps the user message and final answer visible, while reasoning, context injection, and tool activity are reduced to a compact **Worked for …** row. Click the row to expand the original process whenever you need it.

- Completed turns collapse automatically.
- Running turns stay expanded and show live elapsed time.
- The plugin leaves DSH's native content and local UI state intact when you expand or collapse a turn.
- Incomplete or incompatible turns stay visible.

This is a Web-only plugin. It does not change the agent's output or conversation data.

## Demo

### Folded

The intermediate process is replaced by a compact duration row while the final answer remains visible.

![A completed DeepSeek Harness turn folded into a compact duration row](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-fold.png)

### Expanded

Click either duration row to restore the original context, reasoning, and tool activity.

| Upper process | Lower process and final answer |
| --- | --- |
| [![The upper part of an expanded DeepSeek Harness turn](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-1.png)](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-1.png) | [![The lower part of an expanded DeepSeek Harness turn](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-2.png)](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-2.png) |

## Install

Most users only need these commands. Install the published npm package into the DSH Web profile:

```sh
dsh plugin --profile web add dsh-fold-turns
```

Update an existing installation:

```sh
dsh plugin --profile web update dsh-fold-turns
```

Remove the plugin:

```sh
dsh plugin --profile web remove dsh-fold-turns
```

Restart the Web process after installing, updating, or removing the plugin. DSH composes its client module list at startup.

For local development or a downloaded release tarball instead:

```sh
dsh plugin --profile web add ./dsh-fold-turns-0.1.5.tgz
```

## Using the plugin

No configuration is required. Running turns stay expanded. Once an eligible turn completes, its intermediate process folds automatically and the row shows the exact duration.

Click either duration row to expand or collapse the turn. A turn without foldable process content gets no control.

The plugin is designed to fail open. Incomplete history, unknown Chat node kinds, abnormal completion, or an incompatible DOM should leave DSH's native content visible.

## Compatibility

> Experimental: the plugin relies on DeepSeek Harness browser and Chat DOM contracts that are not yet stable public APIs. Keep a rollback path and recheck real conversations after every DSH upgrade.

| DSH host | Status |
| --- | --- |
| `0.1.0-rc.6` | Experimental, verified baseline |
| Other releases | Unsupported until revalidated |

## Development

### Build from source

Node `22.19+` (or `24+`) and pnpm are required:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm run test:browser
pnpm pack
```

The resulting `dsh-fold-turns-<version>.tgz` is directly installable with the tarball command above. `pnpm pack` runs the build through `prepack`, so a clean clone does not need checked-in `lib/` output.
