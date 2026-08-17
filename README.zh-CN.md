# dsh-fold-turns

[English](./README.md) | 简体中文

> 实验性项目：本插件依赖 DeepSeek Harness 尚未稳定公开的浏览器与 Chat DOM 契约。请配合下方经过验证的宿主版本使用，并预留回退方案。

`dsh-fold-turns` 是一个仅用于 Web 端的 DeepSeek Harness 插件。它会折叠符合条件的已完成对话轮次中的中间过程，同时保留宿主原生渲染器及其本地状态。

## 安装

将已发布的 npm 包安装到 Web profile：

```sh
dsh plugin --profile web add dsh-fold-turns
```

安装或更新后请重启 Web 进程。DSH 会在启动时组合客户端模块列表。

也可以安装下载好的 release tarball：

```sh
dsh plugin --profile web add ./dsh-fold-turns-0.1.4.tgz
```

卸载命令：

```sh
dsh plugin --profile web remove dsh-fold-turns
```

项目有意不支持通过 GitHub 源码 URL 直接安装。仓库不会在安装阶段通过 `prepare` 构建，请使用 npm 包或已经构建好的 release tarball。

## 行为与风险

开放中的对话轮次一旦能够确定源消息，就会显示一行静态的 `Running for …` 状态，同时保持原生输出展开。符合条件的轮次完成后，准确的最终耗时会替换该状态，中间过程也会折叠。没有可折叠过程内容的轮次不会显示控制按钮。

插件按故障时保持展开的原则设计。历史记录不完整、出现未知的 Chat 节点类型、轮次异常结束或 DOM 不兼容时，原生内容都应保持可见。实现仍然依赖宿主的私有 DOM 结构，因此每次升级 DSH 后都需要用真实会话重新验证。自动化浏览器契约会检查 bundle 注册和 CSS 注入；可选的真实宿主冒烟测试会检查 tarball 安装和 Web 启动；基于源码检出的会话门禁会验证真实对话、折叠、焦点、会话切换和分页行为。辅助技术检查和视觉检查仍属于发布前的人工步骤。

## 兼容性

| DSH 宿主 | 构建与打包 | Tarball 安装与 Web 启动 | 真实会话折叠 | 状态 |
| --- | --- | --- | --- | --- |
| `0.1.0-rc.6` | 自动验证 | 可选自动门禁 | 源码自动门禁 + 人工辅助技术检查 | 实验性，已验证基线 |
| 其他版本 | CI 可能通过兼容的 peer 依赖完成编译 | 不作保证 | 不作保证 | 重新验证前不支持 |

React 和 `@deepseek-ai/dsh-client-*` peer 模块由 DSH 浏览器模块表提供，不会打进客户端 bundle。它们被标记为可选 peer 依赖，避免独立 profile 安装时重复安装宿主已有的实例。

## 从克隆的仓库构建

需要 Node `22.19+`（或 `24+`）和 pnpm：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm run test:browser
pnpm pack
```

生成的 `dsh-fold-turns-<version>.tgz` 可以直接使用上方的 tarball 命令安装。`pnpm pack` 会通过 `prepack` 执行构建，因此从干净仓库开始时不需要提交 `lib/` 产物。

如需在本地检查真实 DSH 启动过程，请安装经过验证的 DSH CLI 和 Chromium，然后运行：

```sh
pnpm exec playwright install chromium
REQUIRE_REAL_DSH=1 pnpm run test:dsh
```

未设置 `REQUIRE_REAL_DSH=1` 时，如果系统中没有 `dsh`，该脚本会报告跳过。CLI 版本必须与 `EXPECTED_DSH_VERSION` 一致，默认值为 `0.1.0-rc.6`。当仓库变量 `RUN_REAL_DSH_SMOKE` 为 `true` 时，CI 会启用 tarball 启动冒烟测试。这个可选任务不能替代基于源码检出的会话门禁。

发布前，请针对已经构建好的 DeepSeek Harness 源码检出运行确定性的真实会话门禁。它会把一份经过字节校验的测试临时复制到 Harness 测试目录，完成后将其删除，不会修改 Harness 中已跟踪的文件。测试会重放一个分两步完成的工具调用轮次，操作上下两个折叠按钮，检查 DOM 与焦点顺序，切换到预置的长历史记录，并验证分页后读者的滚动锚点保持不变：

```sh
DSH_SOURCE_DIR=../deepseek-harness pnpm run test:dsh-session
```

`test:dsh-session` 会先构建插件。如果 DSH 源码检出的 package 版本与 `EXPECTED_DSH_VERSION` 不一致，命令会直接拒绝执行。该变量默认为 `0.1.0-rc.6`，只有在验证并准备发布新的宿主兼容基线时才应显式修改。

## 维护者发布检查

```sh
pnpm install --frozen-lockfile
export DSH_SOURCE_DIR=../deepseek-harness
export EXPECTED_DSH_VERSION=0.1.0-rc.6
pnpm run verify:release
pnpm run verify:host
pnpm pack --dry-run
pnpm publish
```

`verify:release` 覆盖可移植构建、单元测试、Chromium bundle 测试、依赖审计和包契约。`verify:host` 还要求本机安装匹配的真实 DSH CLI，用于 tarball 安装和 Web 启动检查，并要求提供匹配的 DSH 源码检出，用于确定性会话门禁。普通的克隆构建不需要这两个宿主依赖。`prepublishOnly` 会重复执行两层验证和一次打包预演，因此只要任何真实宿主门禁缺失或失败，`pnpm publish` 就会失败。发布操作、provenance 证明、Git tag、GitHub Release 和仓库变量配置仍需维护者在外部完成。

单元测试覆盖折叠规则、控制器更新边界、会话状态、渲染器可访问性、DOM 所有权与清理、延迟的 React 提交，以及 DSH 浏览器模块 ABI。Chromium 测试会在真实 DOM 中执行实际构建出的浏览器 factory。
