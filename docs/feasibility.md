# dsh-fold-turns 可行性与技术方案

调研日期：2026-08-17

当前开发基线：DeepSeek Harness 源码提交 `47f943859bef60e4160492346772ded9b24f765a`，仓库版本 `0.1.0-rc.5`。本机正在运行的 `0.1.0-rc.6` Web 产物用于补充核对浏览器结构，不作为运行时版本限制。

## 结论

`dsh-fold-turns` 可以作为独立外部插件开发，通过 `dsh plugin add` 安装，不需要修改 deepseek-harness 上游代码。

在“不改上游、必须作用于原生 Chat”的约束下，推荐方案仍是：用 Conversation Definition 和 `conversation.chat.node` 添加上下两条 toggle，原生 Chat 行保持原有父子关系，插件按精确 node key 控制过程行的显示、动画和滚动。

DOM wrapper 会移动 React 管理的行；renderer shadow 会复制原生 renderer 及其子插槽契约，并在折叠时卸载原生组件；覆盖 ChatView 则要重新实现分页、pending steering、滚动恢复和底部跟随。三条路线的维护成本和运行风险都高于当前混合方案。

插件不按 DSH 版本号决定是否启用。当前源码实现是第一个开发和验证基线，运行时由能力探针确认公共服务、快照和 DOM 契约。未来 DSH 发生 breaking change 时，只调整宿主适配层；稳定的折叠规则、交互状态和组件不随宿主结构一起改写。

方案可以开始实施，但不能把动画和滚动的静态推导当成已验证结果。独立 bundle 启动、closing assistant 内 Think 的可逆隐藏、首帧无闪烁、历史阅读位置和分页并发属于发布门禁。任一门禁无法稳定通过时，插件保持原生展示，不发布不完整的折叠行为。

## 目标行为

流式输出期间保持原生展示。turn 以 `completed` 原因结束且结构完整后，默认自动折叠：

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

图示省略宿主已有的 turn-tail 操作行。它继续由宿主渲染并保持可见，插件不复制其中的消息操作、分支操作或扩展插槽。

每个 turn 独立保存展开状态。新 turn 开始或结束时，不修改旧 turn 的状态。

session 切换后，当前页面生命周期内的状态继续保留。刷新页面或重新打开 Web 应用后，状态重新初始化，符合条件的已完成 turn 默认折叠。状态不写入 localStorage、sessionStorage、服务器设置或 session log。

## 独立安装和浏览器加载

DeepSeek Harness 支持把外部 npm 包作为 bundle 安装到 profile：

```bash
dsh plugin --profile web add dsh-fold-turns
```

卸载命令为：

```bash
dsh plugin --profile web remove dsh-fold-turns
```

发布包需要同时提供 Node 和浏览器两部分：

- `package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml`。
- bundle patch 插入以包根名为 `name` 的 Loader row，不能只挂载包内子路径。
- Node 入口提供空 `apply()`，让纯浏览器插件仍能被 Loader 和客户端模块注册表发现。
- `package.json` 的 `dsh.client.platform` 为 `"web"`。
- `exports["./client"]` 指向预构建的浏览器 bundle。
- npm 包包含 Node 入口、patch、浏览器 bundle 和类型声明，并建议附带 source map。

`dsh.client.inject` 记录浏览器包之间的依赖图，供预检和 HMR 使用，不负责 Cordis 服务的激活顺序。浏览器模块还要导出真实的服务依赖：

```ts
export const inject = ['conversationEvents', 'slots', 'sessions', 'locale']
```

Cordis 根据这组服务依赖等待插件激活。报告和实现中必须区分包依赖图与服务注入，不能把二者写成同一机制。

浏览器构建不能直接引用 deepseek-harness monorepo 内部的 `packages/client/tsdown.client.ts`。外部仓库需要自带构建配置，并遵守当前模块表协议：

- 产物是注册到 `window.__ModuleLoader__.load({ id, factory })` 的 CJS factory，`id` 与包名一致。
- React、React DOM、Cordis、ui-slots、web-react、ui-primitives、ui-attachment 和 schema-form 使用宿主模块表中的共享实例。
- 当前实现还允许精确的 `@deepseek-ai/dsh-client-runtime/client` 作为 external；上游已把它标为临时例外，兼容测试必须覆盖这条构建 ABI。
- `@deepseek-ai/dsh-client-ui-conversation/client` 只做 type-only import，不能在浏览器 bundle 中导入它的运行时值或原生 renderer。
- CSS 由插件 bundle 注入并带插件所有权标识，卸载时可完整删除。

默认发布预构建 npm 包或 tarball。直接从 GitHub 安装需要 `prepare`，pnpm 还要求用户允许安装期构建，不适合作为普通用户的默认路径。

上游依据：

- `docs/user/develop/basic/publish.md`
- `packages/client/modules/src/index.ts`
- `packages/client/modules/src/client/system.ts`
- `packages/client/web/src/platform.ts`
- `packages/client/tsdown.client.ts`
- `apps/cli/src/plugin.ts`

## 当前客户端提供的事实

### turn 边界和耗时

客户端快照包含 `ChatSnapshot.timeline`。每个 `TurnLocation` 提供 turn 编号、开始和结束事件、状态、steps 以及 turn 级业务数据。

耗时使用 `turn.end.time - turn.start.time`。缺少任一边界或结果为负数时，数据无效，该 turn 保持原生展开。插件不把负数钳制为 0，也不使用组件挂载时间补算。

`TurnLocation.status === "closed"` 只表示结束事件存在，不足以证明正常完成。插件只接受 `turn.end.data.reason.kind === "completed"`；`aborted`、`blocked`、`error`、`max-tokens`、`interrupted` 和未来新增终态全部 fail-open。

### turn 的原生节点

`chat.locations.getTurn(turn)` 返回该 turn 当前已加载的有序 node key，`chat.nodes.get(key)` 可以读取节点的 kind、位置、排序序号和数据。Chat 节点按 `anchorSeq` 排序，同一锚点再按 key 排序。

折叠计划只使用快照中的节点归属和顺序。DOM 负责把已算出的 key 映射到对应行，不能依靠 sibling 位置反推 turn。

### 折叠起点是最后一个普通 user 节点

同一个 turn 中可能存在锚定在普通 user 消息之前的 context 注入。这些节点属于 turn，但不在“用户消息与最终回复之间”，不能被折叠，也不能作为顶部 toggle 的锚点。

插件从该 turn 的节点中找到 `kind === "user"` 且 `anchorSeq` 最大的节点，把它作为折叠起点。只有排序在它之后、closing assistant 之前的已分类过程节点进入隐藏集合。`steering` 不参与普通 user 起点计算，并且始终原位可见。

当前窗口没有加载普通 user 节点时，turn 保持原生展开。无 user 的宿主主动 turn 不与普通对话共用推断逻辑，后续若要支持，应增加明确的产品规则和单独测试。

### closing assistant

上游 `turn-tail` Definition 在 turn 结束后发布 turn 级数据。`closing` 是最后一条包含非空正文的 settled assistant 消息，并提供 `finalNode.seq`。

插件读取这项数据，不复制 closing 判定规则。`closing` 缺失、`branchUnavailable === true`、closing 节点未加载或无法唯一确定时，turn 保持原生展开。

closing assistant 的一个原生 Chat 行可以同时包含 reasoning 和正文。折叠态保留正文，但 closing 行内的 Think 仍属于中间过程，必须由 DOM 适配层可逆隐藏。适配层按 `[data-variant="think"]` 查找 reasoning 行，并核对其数量与 closing node 中的 reasoning blocks；任一项对不上时，该 turn fail-open。

### 当前扩展点的边界

`conversation.chat.node` 是 session-scoped keyed slot，可以渲染插件新增的节点 kind，但只能控制单个节点内容。它不能包住整个 turn、删除其他 Definition 的节点、改变原生节点的 `visibility`，也不能为一组已有兄弟节点增加共同父容器。

`conversation.view` 可以增加新标签页，也可以覆盖默认 Chat。覆盖后需要重做完整对话视图，无法低成本复用原生分页、工具渲染、文件操作、pending steering 和滚动行为。

## 选定架构

实现分为四层。稳定核心不读取 DOM，也不依赖某个 DSH 版本的内部 Definition key。

| 层 | 职责 | 生命周期 |
| --- | --- | --- |
| `FoldCore` | 把归一化 turn/node DTO 计算为 `TurnFoldPlan` | 纯函数 |
| `FoldModelController` | 订阅公开的 `SessionFace`，在结构变化时生成每个 turn 的计划 | 每个 session |
| `FoldStateStore` | 保存用户显式展开的 turn | slot framework 按 session 管理 |
| `DshHostAdapter` | 注册 Definition、投影快照、探测 DOM、执行隐藏、动画、滚动和清理 | 插件和当前 view |

### FoldCore 只处理折叠语义

宿主适配层先把 DSH 快照投影为普通 DTO，`FoldCore` 再生成 JSON 兼容的计划：

```ts
interface TurnFoldPlan {
  turn: number
  eligible: boolean
  reason?: string
  startCandidateKey?: string
  closingKey?: string
  endToggleKey?: string
  hiddenKeys: readonly string[]
  closingReasoningCount: number
  durationMs?: number
}
```

核心只回答哪些节点保留、哪些节点隐藏、为什么 fail-open。它不知道 CSS selector、ChatNodeSeat、flex gap 或滚动容器。未来 DSH 改变快照字段或 DOM 时，只需修改 adapter 到 DTO 的投影和 DOM 操作。

### FoldModelController 在 renderer 外计算计划

`SessionFace` 提供公开的 `getSnapshot()` 和 `subscribe()`。插件通过 `ctx.sessions.binding(sessionId)` 得到 session，并为它创建一份 `FoldModelController`。

Controller 接收 session 更新后，先比较 `chat.order`、timeline 以及已跟踪 candidate 和 `turn-tail` 节点的引用。只有边界、节点归属、节点顺序或终态签名变化时，才重算受影响的 turn；普通 streaming 内容更新可以直接退出，不遍历 Chat 节点集合。

Controller 发布稳定的 observable。上下两个 slot entry 通过各自的 `inject(sessionId, actions)` 返回同一份 `{ hooks: { foldModel } }`，框架把它绑定为 renderer 可用的 selector hook。renderer 只按自己的 candidate key 或 turn 编号做 O(1) 查询，不扫描 ChatSnapshot。

Controller 必须在创建 observable 时同步读取当前 session 快照，保证已完成历史在 renderer 首次 layout effect 前已有计划。session 销毁、插件卸载或 slot registration 撤销时，订阅随插件 effect 一起清理。

### 展开状态使用 session-scoped slot store

上下 toggle 共享一份在 `apply` 内创建的 store handle：

```ts
defineStore({
  init: () => ({ expandedByTurn: {} as Record<string, true> }),
  actions: {
    expand: (draft, turn: number) => {
      draft.expandedByTurn[String(turn)] = true
    },
    collapse: (draft, turn: number) => {
      delete draft.expandedByTurn[String(turn)]
    },
  },
})
```

store 不声明 `persist`。同一个 handle 传给 `fold-start` 和 `fold-end` 两个 session-scoped registration 后，框架为每个 session 创建一份实例，并在两个 entry 间共享。

默认没有记录，表示 eligible turn 折叠；对象中存在 turn key，表示用户显式展开。新 turn 和其他 turn 的状态变化不会改写已有记录。store 只保存 JSON 形态的交互状态，不保存 DOM 元素、动画句柄、兼容探针或 session 业务快照。

### toggle 由两个 Conversation Node 提供

插件注册两个 Chat 节点类型：

- `fold-start` 位于最后一个普通 user 消息之后，eligible turn 在折叠和展开时都显示。
- `fold-end` 位于 closing assistant 之前，只在展开时显示。

两个节点都通过 `conversation.chat.node` 注册 React renderer，不向 Chat 列表手工插入 DOM 兄弟节点。

#### fold-start

`user/message` 本身不携带 turn 编号，同一种事件还可能被上游分类为 steering。`fold-start` 为每个 `source.kind === "user"` 的 append `user/message` 创建候选节点，候选数据记录消息 id 和 seq。

Controller 在最终 ChatSnapshot 中匹配同 seq 的原生节点。原生 kind 为 `user`，且它是该 turn 最后一个普通 user 时，计划把该 candidate key 标记为顶部 toggle；原生 kind 为 `steering`、同 turn 还有更晚的普通 user，或节点归属不完整时，candidate 保持空内容。

这条路径复用上游已经发布的 `user` 和 `steering` 分类，不读取私有的 `inbox-next-step` Definition key，也不复制其状态结构。

候选节点使用当前 adapter 提供的相对 `anchorSeq`，排在原消息之后。小数偏移是当前 DSH 的排序能力，不是 FoldCore 契约；adapter 的结构测试和能力探针负责发现碰撞或排序变化。

#### fold-end

`fold-end` 在 `turn/end` 上创建。Conversation assembler 会先发布 location data，再构建 view nodes，因此 `fold-end.buildViewNode()` 可以从当前 `TurnLocation.data` 读取 `turn-tail.closing`，把自身锚点放在 closing assistant 之前。

closing 不可用时，Definition 仍保持稳定 key，但节点不可见或 renderer 返回空内容。增量更新后不能撤回已 materialize 的 node key。

折叠态下 `fold-end` renderer 返回空内容，展开态渲染与顶部相同的按钮。当前宿主用 `.flowItem:empty { display: none }` 消除空 seat 的 flex gap；adapter 启动时验证该能力。若未来宿主删除这条规则，adapter 必须在首次 layout effect 中精确隐藏插件自己的空 seat，不能让 core 依赖 `:empty`。

### 节点分类必须穷举

FoldCore 对当前 adapter 声明的 kind 做穷举分类。默认规则如下：

| 类别 | 折叠态处理 |
| --- | --- |
| 最后一个普通 `user` 及之前的节点 | 保留 |
| `fold-start` | 保留 |
| `fold-end` | 折叠态为空，展开态显示 |
| 所有 `steering` | 原位保留 |
| closing `assistant-step` 的正文 | 保留 |
| closing 行内 reasoning | 隐藏但不卸载 |
| 非 closing `assistant-step` | 隐藏 |
| tool、context、command、retry、compaction、workflow-run | 隐藏 |
| `turn-tail` 和其中的原生操作 | 保留 |
| 明确表示人类输入的扩展节点，如 `command-input` | 保留 |
| 错误、截断、取消和其他非 completed 终态 | 整个 turn fail-open |
| 未分类或未知 kind | 整个 turn fail-open |

插件自己的两个 node kind 要在分类表中显式列出。未来 DSH 或其他插件增加 node kind 时，不能只把未知节点单独显示并继续折叠其余过程；adapter 确认新 kind 的语义并更新分类表前，整个 turn 保持原生展开。

如果计划中的 `hiddenKeys` 为空，插件不显示 toggle。展开一个没有可折叠内容的 turn 不产生任何可见变化，保留按钮只会增加噪声。

## DOM 宿主适配层

### 能力探针分三层

插件不按版本字符串拒绝宿主，按下面三层检查实际能力：

1. 启动检查确认 `conversationEvents`、`slots`、`sessions`、`conversation.chat.node` 和客户端模块 ABI 可用。失败时插件不注册折叠行为，并输出一次诊断。
2. view 检查确认 `data-chat-flow`、`data-conversation-scroll`、直属稳定行和 key 属性存在。静态结构不符时，恢复当前 view 中插件拥有的全部写入并禁用 adapter。
3. turn 检查确认语义完整、所有 key 一一映射、相对顺序正确、closing reasoning 数量一致。失败只让该 turn 保持原生展开。

预期完整的 turn 出现 key 重复、跨 session 映射或 DOM ownership 冲突，说明 adapter 假设已失效。此时不能只跳过一行，应恢复当前 view 的所有折叠并禁用该 adapter。

### 只按精确 key 映射

当前 ChatNodeSeat 为每个节点渲染一条直属行，带有：

```text
data-chat-anchor-key
data-chat-flow-key
data-chat-flow-kind
```

兼容层按下面的顺序工作：

1. 从 `TurnFoldPlan` 取得目标 key，不从 DOM 猜 turn。
2. 在当前 `data-chat-flow` 内遍历行并比较 `dataset.chatAnchorKey`。
3. 验证每个目标 key 只映射到一行，且所有行属于当前 session view。
4. 验证 user、顶部 toggle、过程、底部 toggle、closing assistant 和 turn-tail 的相对顺序。
5. 验证通过后，一次性应用该 turn 的稳定状态或动画状态。

若用 CSS selector 查 key，必须经过 `CSS.escape()`。直接遍历元素并比较 dataset 可以减少 selector 拼接错误。

### 不移动 React 管理的行

ChatView 直接把 `order` 映射为直属 ChatNodeSeat。插件不得把这些行移动到新 wrapper，也不得增删 React 管理的 children。允许的写入只有 adapter 明确拥有的 `data-dsh-fold-*` 属性、`inert`、`aria-hidden` 和约定的内联动画属性。

每次写入都记录旧值、插件写入值和 ownership epoch。清理时只恢复仍等于插件写入值的属性；若宿主或其他插件已经改写，清理不覆盖新值。React 开始管理某个现有属性时，view probe 应在任何折叠前失败。

### closing Think 保持挂载

closing assistant 行内的 `[data-variant="think"]` 不通过 renderer shadow 或条件渲染隐藏。adapter 对匹配元素设置自有属性、`inert`、`aria-hidden` 和稳定隐藏样式，展开时恢复原值。

reasoning 行内部的 React state 始终保留。用户展开 turn 后，Think disclosure 回到折叠前的局部展开状态；插件卸载或 view 重挂载也要恢复宿主原值。

### 首帧和后续结构变化

已完成历史首次挂载或 session 重挂载时不播放动画。Controller 同步提供 FoldModel，`fold-start` 的 layout effect 在浏览器绘制前完成映射并应用稳定折叠态。

首次 layout effect 无法确认完整映射时，该 turn 在本次 mount 中保持原生展开。后续检查成功也不突然无动画折叠。只有两种情况可以自动折叠：初始 paint 前已经验证完整；当前页面亲历 turn 从 open 变为 completed，并以正常动画收起。

分页后才补全的历史 turn 默认保持展开，等下一次 view mount 重新判断。这样不会把用户正在阅读的内容突然移走。

## 动画、焦点和滚动

### 动画状态机

稳定折叠态把完整过程 ChatNodeSeat 设为 `display: none`，closing Think 使用相同的可逆隐藏策略。展开态清除插件拥有的稳定隐藏属性。

动画作用于每条待隐藏的原生行和 closing reasoning 子行，不增加 turn wrapper：

1. 读取元素当前高度和 Chat 列表的 computed flex gap。
2. 固定起始高度，设置 `overflow: hidden`。
3. 折叠到 `height: 0`、`opacity: 0`，并抵消对应 flex gap。
4. 完成后进入稳定隐藏态，清除临时尺寸和 margin。
5. 展开时从稳定隐藏态恢复为可测量状态，执行反向动画，结束后清除内联尺寸。

每个 turn 保存 desired state 和 animation epoch。连续点击会取消旧动画，旧 completion 只有 epoch 仍匹配时才能提交最终状态。session 切换、view 卸载、插件卸载和 `prefers-reduced-motion: reduce` 都直接归一化到目标稳定态。

### 焦点

动画开始时立即为待隐藏区域设置 `inert` 和 `aria-hidden="true"`。展开开始时先移除这两个属性。

焦点位于过程区域时，收起前移到顶部 toggle。用户点击底部 toggle 收起时，底部按钮本身也会消失，因此必须在更新 store 前调用顶部按钮的 `focus({ preventScroll: true })`，不能把焦点留在触发按钮上。

### 滚动位置

折叠前先判断用户是否处于宿主底部跟随区域。

- 用户贴近底部时，插件不写 `scrollTop`，让 ChatView 的 ResizeObserver 和 bottom-follow 处理高度变化。
- 用户正在阅读历史时，选择 closing assistant、顶部 toggle 或其他不会消失的稳定行作为锚点，记录其相对滚动容器的位置。每帧或动画结束后按位置差补偿 `scrollTop`。

ChatView 使用私有 `observedTopRef` 区分程序写入和用户滚动。外部插件无法同步这份 ledger，历史锚点补偿可能被宿主当成 reader input。该交互必须由真实浏览器测试证明，不能从源码推导为稳定契约。

`loadingOlder` 期间不启动折叠动画，也不与宿主 prepend 锚点同时写 `scrollTop`。adapter 等分页结构提交后再应用稳定状态；无法判断双方所有权时，该次操作 fail-open。

## 自动折叠条件

一个 turn 只有同时满足以下条件才 eligible：

- `TurnLocation.status === "closed"`。
- `turn/start` 和 `turn/end` 都在当前历史窗口中。
- `turn.end.data.reason.kind === "completed"`。
- 最后一个普通 user 节点及其顺序可确定。
- `turn-tail.closing` 存在且 `branchUnavailable === false`。
- closing assistant 节点已加载且唯一。
- duration 为有限非负数。
- 节点分类穷举完成，没有未知 kind。
- `hiddenKeys` 非空。
- 当前 view 的能力探针通过。
- 每个目标 key 都映射到唯一 DOM 行。
- closing reasoning blocks 与 DOM Think 行数量一致。

下面的情况保持原生展开：

- turn 仍在运行或以非 completed 原因结束。
- 历史分页只加载了半个 turn。
- 当前窗口没有普通 user，或存在无法确定顺序的普通 user。
- closing 缺失、branch 不可用或最终正文节点不唯一。
- duration 缺失、不是有限数或小于 0。
- 出现未知 node kind、未知终态或未分类的插件节点。
- 快照 key 与 DOM 行不能一一对应。
- 首帧未完成完整映射。
- 上游模块 ABI、slot、快照或 DOM 结构不满足当前 adapter 的能力要求。

## toggle 交互

toggle 使用真实 `<button>`，左侧显示横向间隔线和耗时：

```text
Worked for 12s
Worked for 2m 03s
Worked for 1h 02m 03s
```

折叠态只显示顶部 toggle，展开态同时显示顶部和底部 toggle。两者操作同一个 turn 状态，并提供一致的：

- `aria-expanded`。
- 包含 turn 编号和当前动作的可访问名称。
- 键盘 focus 样式。
- 展开和折叠图标。

耗时格式：

- 小于一分钟：`Worked for 12s`。
- 小于一小时：`Worked for 2m 03s`。
- 一小时及以上：`Worked for 1h 02m 03s`。

## 兼容和迁移策略

插件维护“已验证宿主矩阵”，不维护按版本号启用的 allowlist。版本号和源码提交用于复现、CI 和诊断，实际启用由能力探针决定。

首个 adapter 可命名为 `chat-flow-v1`，名字表示它依赖的一组宿主能力，不表示只支持某个 DSH 版本。矩阵记录每个 DSH 版本或提交通过了哪些测试：源码契约、bundle boot、DOM probe、组件测试和真实浏览器流程。

开发依赖和 lockfile 固定当前 DSH 包版本，以保证插件构建可复现；这不等于运行时只允许该版本。新 DSH 保持相同能力时无需修改插件，能力变化时更新现有 adapter 或增加新的 adapter，并在矩阵中记录结果。

运行时探针只能处理插件已经成功加载后的差异。模块表、closure wrapper 或 external 列表发生变化时，bundle 可能在 `apply` 前失败，无法由 DOM probe 自救。因此每次准备支持新的 DSH 实现，都要执行 pack、install、boot 测试。

兼容失败按范围处理：

- 单个 turn 的历史、终态或节点语义不完整，只展开该 turn。
- 当前 view 的 DOM 映射或 ownership 失效，恢复该 view 的所有折叠并禁用 adapter。
- 插件模块无法加载，由安装 smoke 和 CI 阻止发布。

诊断只输出一次，包含可取得的宿主版本或源码标识、adapter capability signature 和失败项，不包含 session 内容或用户消息。

## 独立仓库结构

```text
dsh-fold-turns/
  package.json
  cordis.patch.yml
  tsconfig.json
  tsdown.config.ts
  build/
    dsh-client-bundle.ts
  src/
    index.ts
    invariant.ts
    client/
      index.ts
      apply.ts
      fold-core.ts
      fold-model-controller.ts
      fold-store.ts
      definitions/
        fold-start.ts
        fold-end.ts
      components/
        FoldToggle.tsx
        FoldToggle.module.css
      host/
        contract.ts
        chat-flow-v1.ts
        dom-coordinator.ts
        animation.ts
        scroll.ts
      locales/
        zh.ts
        en.ts
  tests/
    fold-core.spec.ts
    fold-model-controller.spec.ts
    fold-store.spec.ts
    dom-coordinator.spec.ts
    components.spec.tsx
    browser/
      fold-turns.e2e.ts
```

Node 入口只负责 Loader 占位。浏览器 `apply` 创建 Controller registry 和共享 store handle，注册两个 Definition 及其 keyed renderer。`host/` 是所有 DSH 私有结构和 DOM 假设的唯一入口，其他目录不能直接查询 `data-chat-*` 或依赖内部 Definition key。

## 不采用的方案

### 移动原生行到 wrapper

wrapper 能自然实现双 toggle 和自动高度动画，但会改变 React 记录的 DOM 父子关系。后续 reconciliation 可能造成视觉错乱或运行错误，因此不采用。

### shadow 原生节点 renderer

renderer shadow 没有“委托下一个 renderer”的正式接口。插件需要复制 user、assistant、tool、command 和 turn-tail 的原生组合规则，声明子插槽的节点还会产生所有权冲突。折叠时替换 renderer 内容会卸载原生组件，无法满足工具卡片和 Think 状态保留要求。

### 覆盖完整 ChatView

覆盖 ChatView 可以完全控制节点过滤和滚动，但必须复制分页、pending steering、session 状态、工具回调、底部跟随和位置恢复。上游每次修改 ChatView 都可能要求同步重写，不适合作为独立插件的首选方案。

### 只用 CSS sibling selector

纯 CSS 无法从扁平 DOM 中可靠恢复 turn、steering、closing 和未知节点语义。用 sibling 位置猜边界违反 fail-open 原则。

### 持久化展开状态

项目要求刷新后恢复默认折叠。持久化到浏览器存储、服务器设置或 session log 都不符合该语义。

### 长期最优的上游扩展

如果 deepseek-harness 将来提供 turn wrapper、节点 visibility override 或 scroll compensation API，插件应优先迁移到正式扩展点并删除对应 DOM adapter。当前方案不要求上游改动，也不阻止后续迁移。

## 实施顺序和验证

### 可以直接开始的实现

以下工作已有足够的源码依据，可以直接实施：

- 独立 bundle 骨架和自包含浏览器构建。
- 纯 `FoldCore`、节点分类和 fail-open 原因。
- `FoldModelController` 与稳定 observable。
- session-scoped `FoldStateStore`。
- `fold-start`、`fold-end` Definition 和 O(1) renderer。
- 无动画的 DOM 精确映射、closing Think 隐藏和完整 cleanup。

动画与滚动可以在稳定折叠成立后继续实现，但发布前必须完成真实浏览器验证。

### 单元测试

- 只有 `completed` turn 可以 eligible，其他终态和未来未知值 fail-open。
- `fold-start` 只为最后一个普通 user 显示，steering candidate 为空。
- `fold-end` 排在 closing assistant 之前，并在 location data 可用后读取 closing。
- closing 缺失、`branchUnavailable`、负 duration 和不完整边界保持展开。
- 节点分类表覆盖 adapter 声明的全部 kind，未知 kind 整 turn fail-open。
- hidden key 不包含 user、steering、closing 正文、turn-tail 和人类输入节点。
- hidden key 为空时不显示 toggle。
- Controller 只在结构或终态变化时重算，streaming 内容更新不扫描节点集合。
- 每个 session、每个 turn 的展开状态独立，store 不持久化。
- 同一 turn 内位于最后一个普通 user 之前的 context 不进入隐藏集合。

### DOM 与组件测试

- node key 到 DOM 行一一映射，不改变任何原生行的 `parentElement`。
- 空插件 seat 在折叠态和无效 candidate 下不占 flex gap。
- closing reasoning blocks 与 `[data-variant="think"]` 一一对应。
- Think 和工具组件折叠前后的局部状态不丢失。
- `inert`、`aria-hidden`、`aria-expanded` 和焦点转移正确。
- 底部 toggle 收起前把焦点移到顶部 toggle。
- ownership ledger 只恢复插件仍拥有的属性。
- 连续点击、旧 animation completion 和卸载 cleanup 受 epoch 保护。
- session 重挂载在首次 paint 前进入稳定折叠态。
- 首帧映射失败后保持原生展示，不发生后续突然折叠。
- view probe 失败后恢复所有插件写入。

### 真实浏览器测试

- 流式输出期间不折叠，`turn/end completed` 后自动动画折叠。
- 包含多 step、tool、context、retry、compaction 和 workflow-run 的 turn。
- think-only、context-only 和没有 tool-call 的 turn。
- closing assistant 同时包含 reasoning 和正文。
- 一条或多条 steering 消息原位可见。
- user 前后分别存在 context 注入。
- 用户贴近底部和阅读历史时，页面位置稳定。
- 分页只加载半个 turn，以及 `loadingOlder` 与 toggle 并发。
- error、max tokens、取消、blocked、interrupted 和无 final assistant。
- session 切换保留状态，刷新页面恢复默认折叠。
- 快速连续点击、动画中切 session、卸载和两个 turn 同时操作。
- 字体、图片和工具 disclosure 在动画期间改变高度。
- `prefers-reduced-motion`、键盘和屏幕阅读器基本操作。
- 上游增加未知 node kind 或改变 DOM 属性时正确 fail-open。

### 安装和迁移验证

用 `pnpm pack` 生成 tarball，在干净 Web profile 中安装：

```bash
dsh plugin --profile web add ./dsh-fold-turns-0.1.0.tgz
dsh --profile web --dump-config
dsh --profile web
```

确认 bundle layer、包根 Loader row、Node 入口、client graph 和浏览器 factory 都已加载，再运行真实 session 流程。安装验证还要覆盖 update、remove 和进程重启，确认插件卸载后不残留样式、属性或 profile row。

每次适配新的 DSH 实现时，重复 pack、install、boot、DOM probe 和浏览器流程，并更新已验证宿主矩阵。版本相同但 capability signature 不同的构建也要分别记录。

## 发布门禁

满足以下条件后才能发布：

- 不修改 deepseek-harness 上游文件。
- tarball 能通过 `dsh plugin --profile web add` 安装、启动、更新和卸载。
- turn 运行期间保持原生展示，completed 后按规则自动折叠。
- 已完成历史首次挂载和 session 重挂载没有入场闪烁。
- 展开后显示全部原生过程，工具卡片和 Think 的内部状态不丢失。
- 折叠范围从最后一个普通 user 之后开始，不越过 user 消息。
- steering、turn-tail 和人类输入节点保持原位可见。
- 异常终态、未知 kind、截断历史和能力探针失败均 fail-open。
- 折叠与展开不移动原生 Chat 行，卸载后完整恢复 adapter 拥有的写入。
- 多个 turn 和多个 session 的状态互不影响。
- 顶部和底部 toggle 的键盘、焦点与无障碍行为正确。
- 底部跟随、历史锚点和分页并发在真实浏览器中稳定。
- 当前开发基线及计划验证的其他 DSH 构建都通过兼容矩阵中的必需测试。

首帧、closing Think、浏览器 bundle ABI 和滚动补偿是硬门禁。若其中任一项无法在原生 Chat 上稳定实现，应暂停发布，等待 deepseek-harness 提供 turn wrapper、节点 visibility 或滚动协调扩展点。
