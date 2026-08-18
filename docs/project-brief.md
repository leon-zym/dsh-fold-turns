# dsh-fold-turns 项目说明

## 项目目的

DeepSeek Harness 的 Web 对话会完整展示任务执行过程。一个复杂 turn 可能包含多轮思考、上下文注入、工具调用、命令结果、重试和压缩信息。任务完成后，这些内容会把用户消息与最终回复隔开，阅读历史时很难快速找到真正需要关注的部分。

`dsh-fold-turns` 要把每个已完成 turn 的中间过程默认折叠，只保留用户发出的消息、折叠控制栏和最终 assistant 回复。用户仍然可以随时展开全部原生过程，再次点击即可收起。

插件只改变 Web 页面的展示，不修改会话日志、模型上下文、工具执行或服务端数据。

## 交付形态

插件在独立仓库中开发，不修改 deepseek-harness 上游源码。普通用户应能通过 DSH 的标准插件命令安装：

```bash
dsh plugin --profile web add dsh-fold-turns
```

发布物需要是完整的 DSH bundle，包含 Node 入口、`cordis.patch.yml` 和预构建的浏览器客户端模块。卸载插件后，Web 对话页应恢复原生行为，不要求用户手工修复 profile 配置。

## 基本概念

### turn

一个 turn 从普通 user 消息开始，直到该轮任务结束。任务执行期间可能产生多个 step，也可能接收用户追加的 next-step steering 消息。

每个 turn 是独立的折叠 block。新 turn 开始或完成时，不能改变其他 turn 的展开状态。

### 中间过程

中间过程指用户消息与最终 assistant 回复之间、由任务执行产生的原生内容，包括但不限于：

- 中间 assistant step 和 Think 内容。
- tool 调用、运行状态和结果。
- context 注入消息。
- command、retry 和 compaction 等过程节点。
- 后续版本中确认属于任务过程的其他节点。

插件应保留并复用这些原生节点，展开时不能用简化后的自绘内容代替。

### closing assistant

closing assistant 是该 turn 最后一条包含非空正文的 settled assistant 消息。它是折叠后的最终回复，不应简单按“最后一个 assistant 节点”猜测。

### steering

steering 是用户在 turn 执行期间追加的 next-step 指令。它仍然属于当前 turn，但内容来自用户，因此折叠后保持原位可见。

## 默认展示

### turn 执行期间

流式输出、工具运行和其他执行过程保持原生展示。插件不能在 turn 运行中自动隐藏内容；在来源消息已确定后显示一条不可交互的 `Running for …` 状态栏，完成后再原位变为折叠控制栏。

### turn 完成后

结构完整的 turn 自动进入折叠态：

```text
用户消息
Worked for 2m 03s
最后一条 assistant 消息
```

顶部控制栏既是信息分隔线，也是展开按钮。文字靠左，显示该 turn 的总耗时。

### 用户展开后

```text
用户消息
顶部 toggle
所有原生过程
底部 toggle
最后一条 assistant 消息正文
```

顶部和底部 toggle 操作同一个状态。底部 toggle 让用户在读完整个过程后直接收起，不需要返回顶部。

### 包含 steering 的 turn

steering 始终可见，折叠后的顺序为：

```text
初始 user 消息
顶部 toggle
steering 消息 1
steering 消息 2
最后一条 assistant 消息
```

展开后，steering 仍处在原生位置。任务过程可能被它分成几个区间，但这些区间共享一个 turn 状态和一条总耗时。

## toggle 交互

toggle 使用真正的 `<button>`，整条分隔栏都可点击，并支持键盘操作。折叠态只显示顶部 toggle，展开态同时显示顶部和底部 toggle。

文案格式固定为：

```text
Worked for 12s
Worked for 2m 03s
Worked for 1h 02m 03s
```

耗时来自 turn 的开始和结束时间。数据不完整时不自行估算，也不使用组件挂载时间替代。

两条 toggle 需要保持一致的 `aria-expanded`、可访问名称、焦点样式和展开图标。若折叠时焦点位于即将隐藏的内容中，应先把焦点移到触发按钮。

## 动画与滚动

用户手动展开或收起时直接切换稳定状态，不做高度、margin 或透明度动画。切换不能通过卸载原生内容制造，内部工具卡片和 Think 行的局部状态应继续保留。

已完成 turn 在首次打开 session、切换回 session 或历史重新挂载时直接进入稳定折叠态，不播放入场动画，避免完整内容先闪现再消失。系统启用 `prefers-reduced-motion: reduce` 时立即切换状态。

滚动处理分两种情况：

- 用户贴近页面底部时，沿用宿主的底部跟随行为。
- 用户正在阅读历史时，以触发 toggle 或稳定的 Chat 行作为锚点，折叠前后补偿位置变化。

特别要覆盖从底部 toggle 收起的场景。此时大量内容从按钮上方消失，如果不补偿滚动位置，触发按钮会跳出视口。

## 状态生命周期

折叠状态只保存在当前页面内存中，按 session 和 turn 隔离：

```ts
Map<sessionId, Map<turnNumber, "collapsed" | "expanded">>
```

预期行为：

- 已完成 turn 默认折叠。
- 用户手动展开后，新 turn 不影响它。
- 用户切换到其他 session 再返回时，保留此前操作。
- 页面刷新、关闭后重新打开或客户端重新初始化时，状态清空。
- 不写入 localStorage、sessionStorage、会话日志或服务端设置。

## 折叠边界

同一个 turn 的节点索引可能包含锚定在普通 user 消息之前的 context，比如审批策略、权限说明或插件提示。这些内容不在用户消息与最终回复之间，不能被折叠，也不能作为 toggle 的位置锚点。

折叠起点是该 turn 中最后一个普通 `user` 节点。只有 `anchorSeq` 更大的过程节点才进入隐藏集合。`steering` 是单独的节点类型，不参与普通 user 起点的计算。

历史只加载了部分 turn、普通 user 未加载、closing assistant 缺失或节点顺序无法确定时，插件保持原生展开。

## 兼容与失败行为

插件依赖 DSH 的客户端节点快照和 Web 行锚点。上游仍处于预发布阶段，插件必须声明并测试明确的 DSH 兼容版本。

兼容检查失败时采用 fail-open：不隐藏任何内容，保留完整原生对话，并输出一次明确诊断。插件不能只折叠已经找到的部分节点，也不能按 DOM 兄弟位置猜测 turn。

实现不得：

- 修改 deepseek-harness 上游文件。
- 移动 React 管理的原生 Chat 行到新父节点。
- 覆盖并重写完整 ChatView。
- 依赖一个宽泛 CSS sibling selector 推断过程范围。
- 为折叠状态增加持久化。
- 在展开时丢失原生节点或内部交互状态。

## 当前范围之外

以下内容不进入首个版本：

- 按 Think 或工具调用分段的段级自动折叠。
- token、tokens/s、缓存命中率等额外指标。
- 用户自定义折叠规则或持久化偏好。
- TUI、桌面原生视图或其他非 Web surface。
- 修改上游以增加 turn wrapper 或新的列表扩展点。

段级折叠以后可以增加，但应作为独立策略实现。它可以复用节点适配、动画、滚动和状态基础设施，不能改变整回合折叠的默认行为。

## 首个版本的验收场景

- 普通多 step turn 在运行期间完整展示，结束后自动折叠。
- 折叠顺序为 user、顶部 toggle、closing assistant。
- 展开顺序为 user、顶部 toggle、全部原生过程、底部 toggle、最后一条 assistant 消息正文。
- 无 tool-call 的 Think-only 或 context-only turn 也能折叠。
- user 前后的 context 能被正确区分，折叠不越过普通 user。
- 一条或多条 steering 消息在折叠态保持可见。
- 多个 turn 和多个 session 的状态互不影响。
- 切换 session 保留操作，页面刷新恢复默认折叠。
- 展开和折叠不播放布局动画，也没有首次挂载闪烁。
- 页面位于底部、历史中部和底部 toggle 附近时，滚动位置稳定。
- 历史分页、不完整 turn、error、max tokens、取消和无 closing assistant 时保持原生展示。
- 键盘、焦点和屏幕阅读器可以操作 toggle。
- 插件可以通过 `dsh plugin --profile web add` 安装和卸载。
- 上游兼容探针失败时，页面仍能展示完整对话。

## 相关文档

- [可行性与技术方案](./feasibility.md)：记录客户端事实、选定架构、兼容策略和验证计划。
