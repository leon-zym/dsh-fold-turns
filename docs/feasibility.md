# 🥷 dsh-fold-turns 可行性与技术方案

调研日期：2026-08-17

调研基线：DeepSeek Harness `0.1.0-rc.5` 源码与 `0.1.0-rc.6` Web 运行产物。

## 结论

`dsh-fold-turns` 可以作为独立外部插件开发，通过 `dsh plugin add` 安装，不需要修改 deepseek-harness 上游代码。

插件可以沿用现有 bundle 和客户端模块机制进入 Web 应用，也能读取 turn 边界、Chat 节点顺序、最后一条 assistant 消息和 turn 耗时。当前扩展 API 没有提供 turn wrapper、原生节点过滤或列表重排能力，因此折叠原生过程仍需一层版本相关的 DOM 兼容适配。

`conversation.chat.node` 的 cell shadowing 可以覆盖既有节点 renderer，但不适合作为本插件的主要隐藏机制。它需要寻找并委托原生 renderer；遇到 `tool-call`、`command`、`turn-tail` 等声明子插槽的节点时，还要复制宿主的 `renderSlot` 组合契约。折叠时替换 renderer 内容也可能卸载原生组件，丢失工具卡片和 Think 行的局部展开状态。

推荐的实现方式由两部分组成：

- 使用 Conversation Definition 和 `conversation.chat.node` 插槽添加上下两条 toggle，由 React 和 Cordis 管理它们的生命周期。
- 保留所有原生 Chat 行的父子关系，按精确 node key 修改过程行的样式、可访问性属性和滚动位置。

兼容检查失败时，插件停止折叠并保留完整原生对话。插件不得猜测 DOM 结构，也不得移动 React 管理的原生行。

## 目标行为

流式输出期间保持原生展示。turn 完成且结构完整后，默认自动折叠：

```text
用户消息
Worked for 2m 03s
最后一条 assistant 消息
```

展开后的顺序为：

```text
用户消息
顶部 toggle
所有原生过程
底部 toggle
最后一条 assistant 消息
```

每个 turn 独立保存展开状态。新 turn 开始时，不修改之前 turn 的状态。

session 切换后，当前页面生命周期内的状态继续保留。刷新页面或重新打开 Web 应用后，状态重新初始化，所有符合条件的已完成 turn 默认折叠。状态不写入 localStorage、sessionStorage、服务器设置或 session log。

## 独立安装链路

DeepSeek Harness 已支持把外部 npm 包作为 bundle 安装到 profile：

```bash
dsh plugin --profile web add dsh-fold-turns
```

卸载命令为：

```bash
dsh plugin --profile web remove dsh-fold-turns
```

发布包需要同时提供 Node 和浏览器两部分：

- `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`。
- bundle patch 把包的 Node 入口挂入 Web profile。
- `package.json` 的 `dsh.client` 声明 `platform: "web"` 和所需注入。
- `exports["./client"]` 指向预构建的浏览器 bundle。
- npm 包包含 Node 入口、patch、浏览器 bundle 和类型声明。

建议发布预构建 npm 包或 tarball。直接从 GitHub 安装需要 `prepare`，pnpm 还要求用户允许安装期构建，不适合作为普通用户的默认路径。

上游依据：

- `docs/user/develop/basic/publish.md`
- `packages/client/modules/src/index.ts`
- `apps/cli/src/plugin.ts`

## 可用的客户端事实

### turn 边界和耗时

客户端快照包含 `ChatSnapshot.timeline`。每个 `TurnLocation` 提供：

- turn 编号。
- `turn/start` 和 `turn/end` 事件。
- `open`、`closed` 或 `unknown` 状态。
- 该 turn 下的 steps。
- turn 级业务数据。

耗时使用 `turn.end.time - turn.start.time`。负值按 0 处理；缺少任一时间时不折叠，也不使用组件挂载时间补算。

### turn 的原生节点

`chat.locations.getTurn(turn)` 返回该 turn 当前已加载的有序 node key。`chat.nodes.get(key)` 可以读取节点的 kind、位置、排序序号和数据。

这组 API 应作为折叠集合的唯一来源。DOM 只用于把已经算出的 key 映射到对应行，不能依靠兄弟位置反推 turn。

### 折叠起点是最后一个普通 user 节点

同一个 turn 的位置索引中，可能包含锚定在普通 user 消息之前的 context 注入，比如审批策略、权限说明或插件提示。这些节点虽然属于同一个 turn，却不在“用户消息与最终回复之间”，不能被折叠，也不能作为顶部 toggle 的锚点。

插件需要从该 turn 的已加载节点中找到 `kind === "user"` 且 `anchorSeq` 最大的节点，把它作为折叠起点。只有 `anchorSeq` 更大的过程节点才进入隐藏集合。`steering` 是单独的 kind，不参与普通 user 起点的计算。

如果当前窗口没有加载普通 user 节点，默认保持原生展开。无 user 的宿主主动 turn 是否允许折叠，可以在原型验证后作为独立策略增加，不能与普通对话共用推断逻辑。

### 最后一条 assistant 消息

上游 `turn-tail` Definition 在 turn 完成后发布 turn 级数据，其中 `closing` 是最后一条包含非空正文的 settled assistant 消息，包含 `finalNode.seq`。

插件应读取这项现成数据，不复制 closing assistant 的判定规则。`closing` 缺失或 `branchUnavailable` 表示后续证据不完整时，该 turn 保持原生展开。

上游依据：

- `packages/client/runtime/src/client/contract/conversation.ts`
- `packages/client/ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts`
- `packages/client/ui-conversation/src/client/conversation-nodes/turn-tail.ts`
- `packages/client/ui-conversation/src/client/conversation-nodes/message.ts`

## 当前扩展点的限制

`conversation.chat.node` 是 keyed 插槽，可以渲染插件新增的节点 kind，但它只控制单个节点的内容。它不能：

- 包住一个 turn 的全部节点。
- 从 ChatView 的 `order` 中删除原生节点。
- 改变其他 Definition 发布的 `visibility`。
- 给一组现有兄弟节点增加共同父容器。

`conversation.view` 可以增加新的视图标签页，也可以用同 id 的高优先级 cell 覆盖默认 Chat。两种方式都需要重做完整对话视图，无法低成本复用原生分页、工具渲染、文件操作、pending steering 和滚动行为。

## 选定架构

### toggle 由 Conversation Node 提供

插件注册两个 Chat 节点类型：

- `fold-start`：位于 turn 中最后一个普通 user 消息之后，折叠和展开时都显示。
- `fold-end`：位于 closing assistant 之前，仅在展开时显示。

这两个节点通过 `conversation.chat.node` 注册 React renderer。toggle 不作为手工插入的 DOM 兄弟节点存在。

#### fold-start

`user/message` 本身不携带 turn 编号，且同一种事件还可能被上游归类为 steering。`fold-start` 应按下面的方式建立：

1. 对每个 `source.kind === "user"` 的 append `user/message` 创建候选节点。
2. 候选节点使用消息序号加一个受控小数偏移，排在原消息之后。
3. renderer 从当前 Chat 快照找到同序号的原生消息节点。
4. 原生节点 kind 为 `user`，且它是该 turn 中 `anchorSeq` 最大的普通 user 时，这个候选节点才是顶部 toggle。
5. 原生节点 kind 为 `steering`，或同一 turn 中还有更晚的普通 user 时，renderer 返回空内容。
6. turn 仍为 open、unknown 或结构不完整时，renderer 返回空内容。

这种做法复用上游对 user 和 steering 的分类，不复制 `inbox-next-step` 的内部判断。

#### fold-end

`fold-end` 可以在 `turn/end` 上创建。它从该事件的 `TurnLocation.data` 读取 `turn-tail.closing`，把 `anchorSeq` 放在 closing assistant 的序号之前。closing 不可用时不发布可见内容。

折叠态下，`fold-end` renderer 返回空内容；展开态下，它渲染与顶部相同的操作按钮。

### 状态由插件服务持有

插件级 Cordis Service 保存：

```ts
Map<sessionId, Map<turnNumber, 'collapsed' | 'expanded'>>
```

缺少显式记录时，符合折叠条件的 closed turn 按 `collapsed` 处理。用户点击后写入明确状态。新 turn、其他 turn 的完成事件和 session 切换都不覆盖已有记录。

Service 还负责：

- 兼容探针结果。
- 当前动画句柄和清理。
- session 或视图重挂载后的状态重放。
- 插件卸载时恢复插件添加的样式和属性。

### 折叠集合按 node key 计算

对一个可折叠 turn，先读取 `chat.locations.getTurn(turn)`，再逐项检查 `chat.nodes`。

计算前先确定该 turn 中最后一个普通 `user` 节点。锚定在它之前或与它相同位置的 context、状态行和其他节点全部保留。

默认隐藏：

- 非 closing 的 `assistant-step`。
- tool 调用和结果。
- context 注入。
- retry、compaction 和 command 等过程节点。
- 已知属于过程展示的其他节点。

默认保留：

- 最后一个普通 `user`，以及位于它之前的其他 user 节点。
- `fold-start`。
- 所有 `steering`。
- closing assistant。
- 必要的 turn 结束操作和状态。
- 位于最后一个普通 user 节点之前或同一锚点的节点。
- 未知 kind。

未知节点采用 fail-open：保持显示。插件升级并确认新 kind 的含义后，才能把它加入隐藏集合。

### steering 保持原位可见

next-step steering 是用户在同一个 turn 中追加的意图。隐藏它会让最终回复缺少可见前因。

一个带 steering 的折叠态可以是：

```text
初始 user 消息
顶部 toggle
steering 消息 1
steering 消息 2
closing assistant
```

原生过程可能被 steering 分成多个不连续区间。插件仍对同一个 turn 使用一份展开状态和一条总耗时，不把 steering 解释为新的 turn。

## DOM 兼容层

### 只做精确映射

ChatNodeSeat 当前为每个节点渲染一个带以下属性的行 wrapper：

```text
data-chat-anchor-key
data-chat-flow-key
data-chat-flow-kind
```

Chat 列表容器带有 `data-chat-flow`，滚动容器带有 `data-conversation-scroll`。

兼容层按下面的顺序工作：

1. 从快照得到应隐藏的精确 key 集合。
2. 在当前 `data-chat-flow` 中查找 `data-chat-anchor-key` 相同的行。
3. 验证每个 key 只映射到一行，且所有目标行都属于当前 session 视图。
4. 验证最后一个普通 user、toggle 和 closing assistant 的相对顺序。
5. 验证成功后才修改样式和属性。

key 进入 CSS selector 时必须经过 `CSS.escape()`，也可以遍历元素后比较 `dataset.chatAnchorKey`，避免拼接选择器。

### 不移动 React 管理的行

ChatView 直接把 `order` 映射为直属的 ChatNodeSeat 列表。插件不能把这些行移动到新 wrapper，也不能在列表中插入非 React 管理的 toggle 兄弟节点。

React 官方说明，修改、添加或移除 React 管理元素的 children 可能造成视觉不一致或崩溃：

- <https://react.dev/learn/manipulating-the-dom-with-refs#best-practices-for-dom-manipulation-with-refs>

允许的 DOM 操作限于 ChatNodeSeat wrapper 上 React 当前没有声明的样式和属性。上游开始管理其中任一属性时，兼容探针和版本测试必须及时发现冲突。

### 默认折叠不能闪烁

已完成 turn 在首次挂载或 session 重挂载时不播放动画。`fold-start` renderer 在 layout effect 中完成兼容检查，并在浏览器绘制前应用稳定折叠态。

如果无法在首帧确认完整映射，则先显示原生内容。后续检查成功后可以无动画切换到默认折叠，不能先隐藏一部分内容。

稳定折叠态可以直接把完整 ChatNodeSeat 行设为 `display: none`，确保外层 flex gap 一并消失。动画期间才使用可测量的临时高度、透明度和 margin；不能靠空 renderer 或只隐藏行内内容来占住一条空白间距。

## 动画

当前列表没有 turn 级共同父容器，动画作用于每个待隐藏的原生行。

折叠过程：

1. 读取每行当前高度和 Chat 列表的实际 flex gap。
2. 固定行的起始像素高度和 `overflow: hidden`。
3. 动画到 `height: 0`、`opacity: 0`。
4. 同时把每个隐藏行的末端 margin 动画到负的 flex gap，抵消折叠途中多出的列表间距。
5. 动画完成后设置稳定的 `display: none`，并清理临时高度和 margin。

展开时执行反向过程：先恢复可测量状态，读取实际高度，从 0 动画到目标高度，结束后清除内联尺寸。

建议时长为 160 到 200 ms。命中 `prefers-reduced-motion: reduce` 时立即切换稳定状态。

动画开始时立即设置 `inert` 和 `aria-hidden="true"`。展开开始时先移除它们。若焦点位于即将隐藏的过程行内，先把焦点移到触发 toggle。

## 滚动位置

折叠前先判断用户是否处于底部跟随区域。

- 用户贴近底部时，不主动补偿 `scrollTop`，让 ChatView 现有的 ResizeObserver 和 bottom-follow 继续工作。
- 用户正在阅读历史时，选择触发 toggle 或第一个可见的稳定 Chat 行作为锚点，记录它相对滚动容器的位置。动画期间或结束后按位置差补偿 `scrollTop`。

分页 prepend 也使用 `data-chat-anchor-key` 维持阅读位置。真实浏览器测试必须覆盖分页与折叠同时发生的时序，避免上游和插件各补偿一次。

## 自动折叠条件

只有同时满足以下条件才折叠：

- `TurnLocation.status === "closed"`。
- `turn/start` 和 `turn/end` 均在当前历史窗口中。
- 最后一个普通 user 节点及其 `anchorSeq` 可确定。
- `turn-tail.closing` 存在。
- closing assistant 节点已加载且唯一。
- 当前 turn 的节点归属和顺序可确定。
- 每个待隐藏 key 都能映射到唯一 DOM 行。
- 兼容探针通过。
- turn 没有要求保留原生展示的错误或未知终态。

下面的情况保持原生展开：

- turn 仍在运行。
- 历史分页只加载了半个 turn。
- 当前窗口没有普通 user 节点，或存在多个无法确定先后的普通 user 节点。
- turn 异常中断或没有 closing assistant。
- `turn-error`、`turn-max-tokens` 等终态无法安全纳入目标结构。
- 出现未知节点或 DOM 映射缺失。
- 上游结构与当前兼容版本不符。

## toggle 交互

toggle 使用 `<button>`，左侧显示横向间隔线和耗时：

```text
Worked for 12s
Worked for 2m 03s
Worked for 1h 02m 03s
```

折叠态只显示顶部 toggle。展开态同时显示顶部和底部 toggle。两者操作同一个 turn 状态，并提供一致的：

- `aria-expanded`。
- 包含 turn 编号和当前动作的可访问名称。
- 键盘 focus 样式。
- 展开和折叠图标。

时长格式：

- 小于一分钟：`Worked for 12s`。
- 小于一小时：`Worked for 2m 03s`。
- 一小时及以上：`Worked for 1h 02m 03s`。

## 版本策略

DeepSeek Harness 仍处于预发布阶段，客户端类型和 DOM 结构可能变化。插件应固定到明确版本，不使用 `next` 或宽泛 semver：

```text
dsh-fold-turns 0.1.x -> DeepSeek Harness 0.1.0-rc.6
```

每次增加一个支持版本，都要执行完整兼容测试并更新兼容表。启动探针至少检查：

- `conversationEvents`、slots 和 sessions 服务可用。
- `conversation.chat.node` 可注册插件节点。
- `data-chat-flow`、`data-chat-anchor-key` 和 `data-conversation-scroll` 存在。
- 快照 key 与 DOM 行一一对应。
- Chat 列表仍是原生稳定行结构。

探针失败时输出一次明确警告，禁用所有折叠行为。原生对话继续工作。

## 独立仓库结构

建议结构：

```text
dsh-fold-turns/
  package.json
  cordis.patch.yml
  tsdown.config.ts
  src/
    index.ts
    invariant.ts
    client/
      index.ts
      apply.ts
      definitions.ts
      fold-model.ts
      store.ts
      FoldToggle.tsx
      dom-compat.ts
      animation.ts
      styles.module.css
  tests/
    definitions.test.ts
    store.test.ts
    dom-compat.test.ts
    animation.test.ts
    browser/
      fold-turns.spec.ts
```

Node 入口只负责让 bundle 成为已挂载的 loader entry。业务逻辑位于浏览器 bundle。

外部仓库需要自己的浏览器构建配置。构建时把 React、React DOM、Cordis、dsh 客户端运行时、slot 和 UI 包声明为 external，由宿主浏览器模块表解析。

## 不采用的方案

### 移动原生行到 wrapper

这种方式能用单一容器做自动高度动画，但会改变 React 管理的父子关系。后续节点插入、移除、重排和卸载都可能与 React reconciliation 冲突。

### 整体 shadow 原生节点 renderer

用更低 priority 覆盖 `assistant-step`、`tool-call`、`context` 等 renderer，可以在 React 渲染期输出隐藏标记，首帧行为比事后 DOM 修改直接。但插件拿不到“下一个 renderer”的正式委托接口，只能按 priority 查找原生组件。带子插槽的 renderer 还需要复制 `renderSlot`、locale、store 和注入 props 的组合规则，与其他覆盖同一 cell 的插件也难以协作。

MVP 不采用整体 renderer shadow。后续可以只对没有子插槽、没有局部状态且委托契约稳定的叶子节点做实验，DOM 兼容层仍是统一兜底。

### 覆盖完整 ChatView

覆盖默认 chat cell 或提供新的 view 需要重新实现分页、pending steering、工具详情、文件动作、滚动和后续上游功能。维护范围超过插件目标。

### 只用 CSS sibling selector

用两个 toggle 之间的 DOM 兄弟关系选择内容，无法可靠处理 steering、未知节点、分页和上游结构变化。折叠集合必须从 Chat 快照计算。

### 持久化展开状态

localStorage 或服务端设置会让刷新后的默认状态不符合要求，也会引入清理和迁移。页面内存足够。

## 验证计划

### 单元测试

- `fold-start` 只为该 turn 中最后一个普通 user 显示，steering 候选为空。
- `fold-end` 排在 closing assistant 之前。
- 耗时格式正确。
- 每个 session、每个 turn 的状态独立。
- 同一 turn 内位于最后一个普通 user 之前的 context 不进入隐藏集合。
- steering 不改变普通 user 起点，并始终保持可见。
- 没有 tool-call 的 think-only 和 context-only turn 仍可折叠。
- 未知节点、异常终态和不完整边界保持展开。
- 隐藏 key 集合不包含 user、steering、closing assistant 和必要终态。

### DOM 与组件测试

- node key 到 DOM 行的一一映射。
- 不改变任何原生行的 parentElement。
- 折叠与展开后的 `inert`、`aria-hidden` 和 `aria-expanded`。
- flex gap 补偿不会在动画结束时跳动。
- 多个 turn 互不影响。
- session 重挂载无入场闪烁。
- 兼容探针失败后页面保持原生结构。

### 真实浏览器测试

- 流式输出期间不折叠，`turn/end` 后自动折叠。
- 包含多 step、tool、context、retry 和 compaction 的 turn。
- 一条或多条 steering 消息原位可见。
- user 之前和 user 之后分别存在 context 注入。
- 用户位于底部和历史阅读位置时，页面不跳动。
- 历史分页只加载部分 turn。
- error、max tokens、取消和无 final assistant。
- session 切换保留状态，刷新页面恢复默认折叠。
- `prefers-reduced-motion`。
- 键盘与屏幕阅读器基本操作。
- 上游增加未知节点 kind。

### 安装验证

把 `pnpm pack` 生成的 tarball 安装到干净 Web profile：

```bash
dsh plugin --profile web add ./dsh-fold-turns-0.1.0.tgz
dsh --profile web --dump-config
dsh --profile web
```

确认 bundle layer、Node 入口和浏览器 bundle 都已加载，再运行真实 session 流程。

## 原型通过标准

- 不修改 deepseek-harness 上游文件。
- tarball 能通过 `dsh plugin --profile web add` 安装和卸载。
- turn 运行期间保持原生展示，完成后无闪烁地自动折叠。
- 展开后显示全部原生过程，内部工具卡片状态不丢失。
- 折叠范围严格从最后一个普通 user 节点之后开始，不越过 user 消息。
- 折叠与展开不移动原生 Chat 行。
- 多个 turn 和多个 session 的状态互不影响。
- steering、错误、截断和不完整历史按本方案处理。
- 点击前后的阅读位置稳定。
- 页面刷新后，所有可折叠 turn 恢复默认折叠。
- 缺少必需 DOM 属性时，插件禁用折叠并保留完整原生对话。

滚动补偿和无闪烁首帧是原型阶段的主要验证项。如果其中任一项无法在真实 Web 流程中稳定工作，应暂停发布，等待上游提供正式的 turn wrapper 或节点可见性扩展点。
