# dsh-fold-turns

[English](./README.md) | 简体中文

`dsh-fold-turns` 让冗长的 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) Chat 对话更容易阅读。一个轮次完成后，插件会把中间的思考、上下文注入和工具活动折叠为简洁的 **Worked for …** 耗时栏。最终回答始终可见，需要时点击一下即可查看完整过程。

- 已完成轮次的过程内容会自动折叠。
- 运行中的轮次保持展开，并实时显示已用时间。
- 展开后仍使用 DSH 的原生内容和本地界面状态。
- 无法安全折叠的轮次会保持原样，不会隐藏内容。

本插件仅用于 Web 端，不会修改 Agent 的输出或对话数据。

## 效果演示

### 折叠状态

中间过程被一行简洁的耗时信息代替，最终回答保持可见。

![DeepSeek Harness 已完成轮次折叠为简洁耗时栏](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-fold.png)

### 展开状态

点击任意一个耗时栏，即可恢复原始的上下文、思考和工具活动。

![DeepSeek Harness 展开轮次的上半部分](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-1.png)

![DeepSeek Harness 展开轮次的下半部分](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-2.png)

## 安装

将已发布的 npm 包安装到 DSH Web profile：

```sh
dsh plugin --profile web add dsh-fold-turns
```

安装或更新插件后，请重启 Web 进程。DSH 会在启动时组合客户端模块列表。

也可以安装下载好的 release tarball：

```sh
dsh plugin --profile web add ./dsh-fold-turns-0.1.4.tgz
```

卸载插件：

```sh
dsh plugin --profile web remove dsh-fold-turns
```

项目有意不支持通过 GitHub 源码 URL 直接安装。请使用 npm 包或已经构建好的 release tarball。

## 使用方式

插件无需配置。运行中的轮次保持完整展开；一旦能够确定其源消息，界面就会显示一行静态的 `Running for …` 状态。符合条件的轮次完成后，这一行会显示准确的最终耗时，中间过程则自动折叠。

点击任意一侧的耗时栏即可展开或折叠轮次。没有可折叠过程内容的轮次不会显示控制按钮。

插件按故障时保持展开的原则设计。历史记录不完整、出现未知的 Chat 节点类型、轮次异常结束或 DOM 不兼容时，DSH 原生内容都应保持可见。

## 兼容性

> 实验性项目：本插件依赖 DeepSeek Harness 尚未稳定公开的浏览器与 Chat DOM 契约。请预留回退方案，并在每次升级 DSH 后重新检查真实对话。

| DSH 宿主 | 状态 |
| --- | --- |
| `0.1.0-rc.6` | 实验性，已验证基线 |
| 其他版本 | 重新验证前不支持 |

## 开发

### 从克隆的仓库构建

需要 Node `22.19+`（或 `24+`）和 pnpm：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm run test:browser
pnpm pack
```

生成的 `dsh-fold-turns-<version>.tgz` 可以直接使用上方的 tarball 命令安装。`pnpm pack` 会通过 `prepack` 执行构建，因此从干净仓库开始时不需要提交 `lib/` 产物。

React 和 `@deepseek-ai/dsh-client-*` peer 模块由 DSH 浏览器模块表提供，不会打进客户端 bundle。它们被标记为可选 peer 依赖，避免独立 profile 安装时重复安装宿主已有的实例。

### 宿主验证

如需在本地检查真实 DSH 启动过程，请安装经过验证的 DSH CLI 和 Chromium，然后运行：

```sh
pnpm exec playwright install chromium
REQUIRE_REAL_DSH=1 pnpm run test:dsh
```

未设置 `REQUIRE_REAL_DSH=1` 时，如果系统中没有 `dsh`，该脚本会报告跳过。CLI 版本必须与 `EXPECTED_DSH_VERSION` 一致，默认值为 `0.1.0-rc.6`。当仓库变量 `RUN_REAL_DSH_SMOKE` 为 `true` 时，CI 会启用 tarball 启动冒烟测试。

发布前，请针对已经构建好的 DeepSeek Harness 源码检出运行确定性的真实会话门禁：

```sh
DSH_SOURCE_DIR=../deepseek-harness pnpm run test:dsh-session
```

`test:dsh-session` 会先构建插件，并拒绝 package 版本与 `EXPECTED_DSH_VERSION` 不一致的 DSH 源码检出。测试会重放一个分两步完成的工具调用轮次，操作上下两个控制按钮，检查 DOM 与焦点顺序，切换会话，并验证分页后读者的滚动锚点保持不变。

### 验证范围

| DSH 宿主 | 构建与打包 | Tarball 安装与 Web 启动 | 真实会话折叠 |
| --- | --- | --- | --- |
| `0.1.0-rc.6` | 自动验证 | 可选自动门禁 | 源码自动门禁 + 人工辅助技术检查 |
| 其他版本 | CI 可能通过兼容的 peer 依赖完成编译 | 不作保证 | 不作保证 |

单元测试覆盖折叠规则、控制器更新边界、会话状态、渲染器可访问性、DOM 所有权与清理、延迟的 React 提交，以及 DSH 浏览器模块 ABI。Chromium 测试会在真实 DOM 中执行构建后的浏览器 factory。视觉检查和辅助技术检查仍属于发布前的人工步骤。

### 维护者发布检查

```sh
pnpm install --frozen-lockfile
export DSH_SOURCE_DIR=../deepseek-harness
export EXPECTED_DSH_VERSION=0.1.0-rc.6
pnpm run verify:release
pnpm run verify:host
pnpm pack --dry-run
pnpm publish
```

`verify:release` 覆盖可移植构建、单元测试、Chromium bundle 测试、依赖审计和包契约。`verify:host` 还要求提供匹配的真实 DSH CLI 和源码检出。`prepublishOnly` 会重复执行两层验证和一次打包预演，因此只要任一真实宿主门禁缺失或失败，`pnpm publish` 就会失败。

发布操作、provenance 证明、Git tag、GitHub Release 和仓库变量配置仍需维护者在外部完成。
