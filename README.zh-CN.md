# dsh-fold-turns

[English](./README.md) | 简体中文

`dsh-fold-turns` 是一个面向 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness) 的 Web 插件，用于自动折叠已完成对话轮次中的执行过程。它会保留用户消息和最终回答，将思考、上下文注入和工具活动收起为一条简洁的 **Worked for …** 耗时栏。需要查看细节时，点击该栏即可展开原始过程。

- 已完成轮次会自动折叠。
- 运行中的轮次保持展开，并实时显示已用时间。
- 展开和折叠不会改变 DSH 的原生内容和本地界面状态。
- 不完整或不兼容的轮次保持可见。

本插件仅用于 Web 端，不会修改 Agent 的输出或对话数据。

## 效果演示

### 折叠状态

中间过程被一行简洁的耗时信息代替，最终回答保持可见。

![DeepSeek Harness 已完成轮次折叠为简洁耗时栏](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-fold.png)

### 展开状态

点击任意一个耗时栏，即可恢复原始的上下文、思考和工具活动。

| 过程上半部分 | 过程下半部分与最终回答 |
| --- | --- |
| [![DeepSeek Harness 展开轮次的上半部分](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-1.png)](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-1.png) | [![DeepSeek Harness 展开轮次的下半部分](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-2.png)](https://raw.githubusercontent.com/leon-zym/dsh-fold-turns/main/docs/assets/demo-expand-2.png) |

## 安装

普通用户通常只需要以下命令。在 DSH 的 Web profile 中安装已发布的 npm 包：

```sh
dsh plugin --profile web add dsh-fold-turns
```

更新已有安装：

```sh
dsh plugin --profile web update dsh-fold-turns
```

卸载插件：

```sh
dsh plugin --profile web remove dsh-fold-turns
```

安装、更新或卸载插件后，请重启 Web 进程。DSH 会在启动时组合客户端模块列表。

开发者或需要测试本地构建时，也可以直接安装 release tarball：

```sh
dsh plugin --profile web add ./dsh-fold-turns-0.1.5.tgz
```

## 使用方式

插件无需配置。运行中的轮次保持展开；符合条件的轮次完成后，中间过程会自动折叠，耗时栏会显示准确的总耗时。

点击任意耗时栏即可展开或折叠轮次。没有可折叠过程内容的轮次不会显示控制按钮。

插件在无法确认内容结构时会保持展开。历史记录不完整、出现未知的 Chat 节点类型、轮次异常结束或 DOM 不兼容时，DSH 原生内容仍会保持可见。

## 兼容性

> 实验性项目：本插件依赖 DeepSeek Harness 尚未稳定公开的浏览器与 Chat DOM 契约。请预留回退方案，并在每次升级 DSH 后重新检查真实对话。

| DSH 宿主 | 状态 |
| --- | --- |
| `0.1.0-rc.6` | 实验性，已验证基线 |
| 其他版本 | 重新验证前不支持 |

## 开发

### 从源码构建

需要 Node `22.19+`（或 `24+`）和 pnpm：

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm run test:browser
pnpm pack
```

生成的 `dsh-fold-turns-<version>.tgz` 可以直接使用上方的 tarball 命令安装。`pnpm pack` 会在打包前自动执行构建，因此从干净仓库开始时不需要提交 `lib/` 产物。
