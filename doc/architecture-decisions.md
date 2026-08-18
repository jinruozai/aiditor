# AIditor Architecture Decisions

> 这些决策是和用户反复讨论后定下的契约，**不要再改**。如果觉得某条不对，先问用户，不要自作主张。
> 分层与不变量见 [architecture.md](./architecture.md)。

这些是和用户反复讨论后定下的,**不要再改**。如果觉得某条不对,先问用户,不要自作主张。

## 1. Split 角拖语义
分裂逻辑是**统一**的 —— 新 dock 是来源 dock 当前工作面的新视图:
- **有 active**:新 dock 初始 panel 克隆来源 dock 的 active `PanelData` 可序列化状态,但生成新的 panel id。也就是复制 `component`、`title/icon/dirty/badge`、`props`、`sourcePath/owner/extensionId`、`toolbarItems` 等数据,不复制 DOM/runtime。
- **无 active**(panels 为空):新 dock 也是空 `{ panels: [], activeId: null }`

来源 dock 的外壳配置也会复制到新 dock: `toolbar`、`accept`、`removeWhenEmpty:false`。不复制 `name`、`collapsed`、`focused`,避免稳定锚点冲突和显示状态泄漏。

也就是说,如果 active panel 是打开了 `foo.ts` 的编辑器,新 dock 出来的是另一个打开同一 `foo.ts` 的编辑器视图;如果 active panel 是打开了 `cube` 场景的 scene panel,新 dock 默认也是打开 `cube` 场景。它和 tab 拖拽不同:tab 拖拽是移动同一个 panel/runtime,角拖 split 是用同一份可序列化 PanelData 创建新的 panel/runtime。

## 2. Merge 语义
合并时**直接吞并**,被吞 dock 的所有 panels 默认**直接丢弃**。winner dock 保持自己的 panels 和 active 不变,只是面积扩大。这是 Blender-correct 的 —— merge 不是数据合并,是几何吞并。

**但是 dirty panel 不能静默丢失**(Blender 的 area 没有 dirty 概念,我们有,这里要偏离原版语义):
- 纯函数 `mergeDocks(tree, winnerId, loserId)` 的返回值是 `{ tree, discardedPanels }`(仍无副作用,`discardedPanels` 是被吞 dock 的 `panels[]` 快照)
- `interactions.js` 在 commit merge 前检查 `discardedPanels.some(p => p.dirty)`:
  - 无 dirty → 正常 commit
  - 有 dirty → 默认**阻止 merge**,preview 回滚,不弹任何 UI(框架不绑对话框)
- 可选钩子 `config.hooks.onDirtyDiscard?: (panels) => 'discard' | 'cancel'`:用户设置后,有 dirty 时调钩子,钩子返回 `'discard'` 才允许 merge。钩子缺省时永远当成 `'cancel'`

## 3. 多 panel 的实现:Detached DOM(高效的本质)
这是最重要的性能决策,也是最简单的那个:**dock 的 content 容器在任何时刻只挂 active panel 的 contentEl,其他 panel 的 contentEl 从 DOM 完全 detach,保留在 runtime map 里作为 reference。**

切 active 的动作就三步:
1. 旧 active 的 `contentEl.remove()`(从 content 容器移除,**不销毁**,runtime map 还持有引用)
2. 新 active 的 `contentEl` 如果没创建过 → 懒调 `component.factory(propsSig, ctx)` 创建
3. `content.appendChild(newActive.contentEl)`

这就带来了架构性的收益:
- **浏览器对非 active panel 零渲染** —— 不 layout、不 paint、不触发 event handler、querySelector 查不到。对于 Monaco / WebGL / video 这种重组件,detached 状态下几乎不占 CPU
- **状态零丢失** —— DOM 节点和 JS 对象都还在,`<input>` 的 value、`scrollTop`、canvas 像素、Monaco 的撤销栈,全部保留。因为没销毁过
- **同窗口内的所有场景共享这一个机制**:切 active、tab 点击、跨 dock 拖放(§ 4.14)全部走同一条"detach → move reference → re-attach"的代码路径。不重建 component,不调序列化。跨窗口迁移是另一个场景,那个必须序列化(§ 4.14)
- **不需要 `content-visibility` / `display: none`** —— 这些还要走 style invalidation,detach 更彻底
- component 内部的定时器 / `setInterval` / WebSocket / `requestAnimationFrame` 框架不代管,component 作者订阅 `ctx.active`(一个 signal,见 § 4.9 ctx 表面)自己决定 detached 时是否暂停

**`ctx.active` 的精确语义**:"我的 `contentEl` 是否挂在 DOM 上"。注意它**不等于**"用户是否看得见我":
- **Collapsed dock**:只是 CSS `display:none` 整个 dock body,内部 contentEl 仍在 DOM 上。`ctx.active` **不受 collapsed 影响**,仍为 true
- 想对"看不看得见"做反应,component 自己订阅 `ctx.dock.collapsed` / `ctx.dock.focused`

"DOM 在不在" 和 "用户看不看得见" 是两个正交维度,框架各给一个 signal,component 按需订阅。

**LRU 作为"内存上限"策略**:
- 默认 `lru.max = -1`(不限,所有创建过的 panel runtime 一直留着)
- `lru.max = N`:runtime map 的条目数上限 = N
  - active panel 永远占一个名额,不会被淘汰
  - dirty panel 跳过淘汰(不丢未保存的东西)
  - 其他候选按 `lastActivatedAt` 升序,最老的**真 dispose**:调 `component.dispose(contentEl)` → 把 detached 的节点丢弃 → runtime map 删条目
  - **PanelData 仍留在 tree 里**,所以下次再 activate 这个 panel 时会重新走 `component.factory(propsSig, ctx)`,相当于"从 props 重建一次"。**只有 transient DOM state 会丢**:scroll 位置、未保存输入框草稿、撤销栈、canvas 像素、运行中的 WebGL context……凡是 component 没主动 `ctx.panel.updateProps(...)` 写回 tree 的东西都会丢。这是显式语义(像浏览器丢弃后台标签页),用户配 `lru.max` 就是在接受这个权衡
- `removePanel()` 也走 dispose 分支,且会**同时把 PanelData 从 tree 移除**(panel 被删就是被删,不是缓存淘汰)

这个模型的美感:**"非 active = detached"的规则统一了 LRU、切 active、tab 点击、跨 dock 拖放所有场景**。跨 dock 拖放的实现同样是 detach + move runtime + re-attach,零额外机制(§ 4.14)。

## 4. Transient Panel
**仅 API 层支持**,不做双击 / 编辑触发的自动升级:
- `addPanel(tree, dockId, panel, { transient: true })` —— 标记瞬态
- `ctx.panel.promote()` —— component 主动升级为常驻
- Tab 上瞬态 panel 标题用斜体显示
- 不监听双击事件,不监听编辑事件

## 5. Focus Mode
**仅 API 层支持**,纯 CSS 切换:
- `ctx.dock.toggleFocus()` / `ctx.dock.setFocus(bool)`
- 实现:给 dock 加 `data-focused` 属性,CSS `position:fixed; inset:0; z-index:100`
- **绝不绑任何快捷键**(参见 § 2.1)
- **已知限制**:当 aiditor root 元素的某个祖先设置了 CSS `transform` / `filter` / `perspective` / `will-change: transform` 时,`position:fixed` 会相对该祖先建立包含块而不是视口,focus 模式的 dock 不会铺满屏幕。这是 CSS 规范行为,框架不兜底;需要时调用方自己把 aiditor root 挂到 `<body>` 直接子级或用 `<dialog>` portal

## 6. Tab Component(就是一种 toolbar 组件,没特权)
Tab component **就是一个普通 toolbar 组件**,没有任何特殊 API。它"像 tab 栏"仅仅是因为:
- 它在 `factory(propsSig, ctx)` 里订阅了 `ctx.dock.panels`(signal)和 `ctx.dock.activeId`(signal)
- 它把每个 panel 渲染成一个按钮
- 点击调 `ctx.dock.activatePanel(id)`
- 关闭按钮调 `ctx.dock.requestClosePanel(id, 'close')`,统一经过异步 `onPanelCloseRequest` hook

任何第三方 component 都能做同样的事。框架不给它开任何后门。

三个内置 tab component,**实现是同一个组件 + 三套预设默认 props**(不要写三份代码):
| Component | 关键默认 props |
|---|---|
| `tab-standard` | `closeButton:'hover'`;默认不显示加号 |
| `tab-compact` | `closeButton:'never', minShowCount:2`(单 panel 时 tab 栏隐藏) |
| `tab-collapsible` | `collapsible:true`(点击已激活 tab 折叠/展开整个 dock) |

tab 加号不是框架默认行为。需要加号时,宿主必须在 toolbar item 的 `props.addPanel` 显式声明要创建哪个 panel:
```js
{ component: 'tab-standard', props: { addPanel: { component: 'scene.empty', title: 'Scene' } } }
```
点击加号时 tab component 会读取 `componentDefaults(addPanel.component)`,再用 `addPanel` 覆盖 defaults 后调用 `ctx.dock.addPanel(...)`。空 dock 没配置 `addPanel` 时不显示无效加号。

**Tab component 永远是 static toolbar item**(写在 `dock.toolbar.items[]` 里,不随 panel 切换),因为它订阅的是整个 dock,不属于任何单一 panel。这意味着 tab component 的 ctx **没有 `ctx.panel`**,只有 `ctx.dock`,写代码时按这个约定即可。
Tab 上的 pointerdown 是 panel drag 会话的起点:tab component 在按钮上挂 pointerdown 监听,识别为 drag 后把控制权交给 `dock/interactions.js`,由它统一处理同 dock reorder / 跨 dock drop / pop out。tab component 自己**不做任何 drag 逻辑**,只负责"起个头"。

## 7. 日志 / 错误处理系统
统一的日志流 + panel 错误隔离:
- `aiditor.log`:`signal([])`,每条 `{ id, time, level, source: { scope, dockId?, panelId?, component?, topic? }, message, error?, stack? }`
- `aiditor.log.push(level, source, message, error?)` / `aiditor.log.clear()` / `aiditor.log.dismiss(id)`
- `aiditor.reportError(source, err)` / `aiditor.safeCall(source, fn)`
- `aiditor.safeCall(source, fn)`:try/catch 包裹,失败 push 到 `aiditor.log` 的 `level:'error'` 条目并返回 `null`
- 所有 component `factory` / `dispose` 的调用都走 `safeCall` 包裹(同步边界)
- 单个 panel 出错只显示红色错误框,**不影响其他 panel**
- 内置 component `log`:订阅 `aiditor.log` 渲染日志/错误列表,用户可以把它放进任何 dock 当 "Problems" 面板用

**异步错误兜底**:`safeCall` 只抓同步调用栈,component 内部 `setTimeout` / `Promise` / `addEventListener` 抛的错抓不到。框架入口(`createDockLayout` 首次调用时)注册一次性的全局监听:
- `window.addEventListener('error', e => aiditor.reportError({ scope: 'global' }, e.error))`
- `window.addEventListener('unhandledrejection', e => aiditor.reportError({ scope: 'global' }, e.reason))`
- source 的 `scope: 'global'` 区分于 `scope: 'component'`,`log` component 可以按 scope 分组或过滤
- component 作用域的异步错误,component 作者可选地用 `ctx.safeCall(fn)` 手动包裹获得 panel-scoped 归因

**`signal.js` 的 effect cleanup 错误走 `console.error`,不路由 `aiditor.log`**。这是架构分层必然的裁决:`log.js` 用 `signal([])` 定义 `aiditor.log`,因此依赖 `signal.js`;反过来若 `signal.js` 调 `aiditor.reportError`,就成了循环依赖。边界划清 —— **signal.js 是零依赖底层,它的错误路径只走 `console.error`**。语义上也是对的:effect cleanup 失败是框架底层契约破裂(component 的 `onCleanup` 回调崩了),属于"fail-loud 到控制台"的范畴,不是归到某个 panel 的软日志列表里可以慢慢看的事。

## 8. Component 注册表(一种形态,无妥协)
**所有 component 必须先注册,panel 和 toolbar item 引用 component 只能用已注册名(string)。** 没有匿名 spec、没有 function 简写、没有未注册 component。这是一条硬规矩 —— 代价换来的是:tree 严格 JSON 可序列化、跨窗口迁移无需特殊分支、`accept` 白名单规则统一、文档只讲一种写法。

```js
aiditor.registerComponent(name, {
  factory: (propsSig, ctx) => HTMLElement,   // 必需
  defaults?: () => ({ title?, icon?, props?, toolbarItems? }),
  dispose?: (el) => void,
  serialize?: (el) => any,                // 可选,跨窗口迁移时用(§ 4.14)
  deserialize?: (el, state) => void,      // 可选,配对
})
```

- `factory(propsSig, ctx)` 必需,返回 component 的根 element;框架把它作为 `contentEl` 挂到 dock 的 content 区(panel component)或 toolbar 区(toolbar component)
- `defaults()` 可选,返回新建 panel 时的默认字段。§ 4.1 角拖分裂调这个。未提供则 fallback 到 `{ title: name, props: {} }`
- `dispose(el)` 可选,component 需要清理资源(取消订阅、关 WebSocket、terminate Worker)时实现
- `serialize` / `deserialize` 可选,**仅跨窗口迁移时调用**(§ 4.14)。同窗口内的 panel 切换、tab 点击、跨 dock 拖放都不经过序列化 —— 那些场景下 contentEl 本身就被整体迁移(detached DOM,§ 4.3)

**硬性 props 约束**:`panel.props` 和 `toolbarItem.props` 必须是 **JSON 可序列化的 plain object**。不许塞函数、DOM node、class instance、Map/Set、循环引用。理由:tree 要能跨窗口 `structuredClone`,要能 JSON 持久化。想传"行为"?通过 bus 发事件或订阅 signal,不要塞进 props。这条约束由调用方保证,框架不做运行时校验(§ 2.5 不写防御性代码)。

**配套 API**:
- `aiditor.registerComponent(name, spec)` —— 注册,重名 throw,名字必须是合法 string
- `aiditor.resolveComponent(name)` —— 查表返回 spec,未注册 throw
- `aiditor.componentDefaults(name)` —— `resolveComponent(name).defaults?.() ?? {}`,调用点不用判空
- 所有内置 component(`panel-list` / `theme-config` / `tab-standard` / `tab-compact` / `tab-collapsible` / `tab-sidebar` / `history` / `log`)本身也通过 `registerComponent` 注册,作为示范,不走后门

## 9. 数据模型(完整,唯一来源)
本节是整个框架**所有数据结构的唯一定义处**。别的章节只讲行为,结构回这里查。

**数据分 6 层,依赖方向自上而下(下层只被上层引用,绝无反向)**:

```
Layer 1 │ LayoutConfig            ← 用户调 createDockLayout 的入参
Layer 2 │ Tree 结构(可序列化)    ← LayoutTree / SplitNode / DockData / PanelData / ToolbarConfig / ToolbarItemSpec
Layer 3 │ 注册表                   ← ComponentSpec(全局 Map)
Layer 4 │ 运行时外壳(内存)       ← LayoutRuntime / DockRuntime
Layer 5 │ Component 运行时            ← ComponentRuntime(3 种 kind 统一)+ ComponentContext
Layer 6 │ 纯函数 API(无 DOM)     ← tree/*.js 的全部写接口 + 返回值约定
```

**关键原则**(贯穿 6 层):
- **Layer 1~2 必须 `structuredClone` 安全**:tree 要能持久化、要能跨窗口 postMessage、要能 JSON 存盘。禁止塞函数 / DOM / Map / Set / class instance / 循环引用
- **Layer 4~5 绝不复制 tree 的状态**:所有"当前标题 / dirty / active / collapsed"都是从 tree 派生的 signal,不是 runtime 里另存一份。**single source of truth = tree**
- **Layer 6 结构共享**:所有写接口返回的新 tree 和旧 tree 共享未改动的子树,`===` 相等 → reconcile 零开销扫过

#### Layer 1 — LayoutConfig(入口契约)

```
createDockLayout(container: HTMLElement, config: LayoutConfig) → LayoutHandle

LayoutConfig = {
  tree:   LayoutTree,                // 初始布局(必填)
  lru?:   { max: number },           // 默认 { max: -1 }(不限,见 § 4.3)
  dockMenu?: boolean,                // 默认 false; true 时安装内置 Dock Menu contribution
  hooks?: {
    onDirtyDiscard?: (panels: PanelData[]) => 'discard' | 'cancel',   // § 4.2
    onPanelCloseRequest?: (request: { reason, panelIds, panels }) => boolean | Promise<boolean>,
    // Hook 内允许保存:原 dirty:true 最终仅变为 dirty:false 时许可仍有效;
    // clean→dirty、保存后再次 dirty、replacement 或其他 PanelData 变化使整批许可失效。
  },
}

LayoutHandle = {
  tree():        LayoutTree,         // 只读快照
  setTree(t):    void,
  subscribe(fn): () => void,         // tree 变化订阅,返回退订

  // 便利 API = 对应纯函数 + setTree + 返回生成的 id
  addPanel(dockId, partial, opts?):               { panelId },
  requestClosePanel(panelId, reason?):            Promise<boolean>,
  requestClosePanels(panelIds, reason?):          Promise<boolean>,
  removePanel(panelId):                           void, // 内部/宿主强制清理,不走关闭请求 hook
  activatePanel(panelId):                         void,
  movePanel(panelId, dstDockId, dstIndex?):       void,
  splitDock(dockId, dir, side, ratio?, opts?):    { newDockId, newPanelId? },
  mergeDocks(winnerId, loserId):                  boolean,   // false = 被 dirty 阻止(§ 4.2)
}
```
LayoutHandle 是用户手里**唯一**持有的引用。想操作布局,就只用它 —— 不要直接持有 DockRuntime / ComponentRuntime(它们是内部实现)。

#### Layer 2 — Tree 结构(可序列化)

整个 tree 是**不可变 + 结构共享**的,任何写操作返回新根,未变的子树 `===` 旧引用。全部节点 JSON 可序列化。

- **LayoutTree**(根):
  ```
  LayoutTree = SplitNode | DockData
  ```
  根可以是一个 split,也可以是单个 dock(极小布局:只有 1 个 dock 填满容器)。

- **SplitNode**(布局骨架,N 叉):
  ```
  {
    type:      'split',
    direction: 'horizontal' | 'vertical',     // horizontal = 行(左→右),vertical = 列(上→下)
    sizes:     number[],                       // 归一化到和 ≈ 1,长度 = children.length
    children:  Array<SplitNode | DockData>,    // n ≥ 1;n = 1 时应被上游压平
  }
  ```
  **SplitNode 无 id** —— 它是结构骨架,没有"这个 split 是哪个"的需求。需要定位时走 `path: number[]`(从根到目标节点的 children 下标序列)。keyed reconcile 的稳定业务 key 仍然是 **dockId**;split/wrapper/splitter 是 renderer 专用 frame,按位置和子 dock 结构原地 patch,不把 split 暴露成公共 identity。

- **DockData**(叶子,矩形容器):
  ```
  {
    id:         string,                        // 框架生成 'dock-N'(§ 4.11)
    type:       'dock',
    panels:     PanelData[],                   // 0 ~ N 个
    activeId:   string | null,                 // panels 为空时必为 null;非空时必指向 panels 里某个 id
    toolbar?:   ToolbarConfig,                 // 无此字段 = 不渲染 toolbar,见 § 4.10
    accept?:    string[] | '*',                // panel 白名单(§ 4.12),默认 '*'
    removeWhenEmpty?: boolean,                 // 默认 true;false 时最后 panel 删除/移走后保留空 dock
    collapsed?: boolean,                        // 默认 false(§ 4.5 的 focused 和这个正交)
    focused?:   boolean,                        // 默认 false,全 tree 至多 1 个 dock 为 true
  }
  ```
  内置 dock 右键菜单启用时,`Panel -> Remove Dock When Empty` 切换同一个 `removeWhenEmpty` 标志。

- **PanelData**(内容单元):
  ```
  {
    id:            string,                     // 框架生成 'panel-N'(§ 4.11)
    component:        string,                     // 必须是已注册 component 名(§ 4.8)
    title?:        string,                     // 默认 = component 名
    icon?:         string,                     // 图标标识(emoji / 名字),可无
    dirty?:        boolean,                    // 默认 false,merge 时用(§ 4.2)
    badge?:        string | null,              // 小角标文字(未读计数等),默认 null
    props?:        object,                     // 传给 component.factory 的 props,默认 {},必须 JSON 可序列化
    transient?:    boolean,                    // 默认 false(§ 4.4,瞬态显示斜体)
    toolbarItems?: ToolbarItemSpec[],          // 此 panel 激活时贡献的动态工具栏项(§ 4.10)
  }
  ```
  **`props` 的硬性约束**(和 § 4.8 同一条):不许塞函数 / DOM / class instance / Map / Set / 循环引用。想传"行为"走 `aiditor.bus`,不要塞进 props。框架不做运行时校验 —— 这是调用方契约(§ 2.5)。
  **`lastActivatedAt` 不在这里** —— 它是运行时缓存,放 ComponentRuntime(见 Layer 5)。

- **ToolbarConfig**(dock 级 toolbar 配置):
  ```
  {
    direction: 'top' | 'bottom' | 'left' | 'right',    // 位置 4 选 1
    items:     ToolbarItemSpec[],                        // static 工具项(§ 4.10)
  }
  ```
  字段缺失 = 不渲染 toolbar。动态 items 来自 active panel 的 `PanelData.toolbarItems`,和这里的 static items 渲染时拼接(见 § 4.10)。

- **ToolbarItemSpec**(工具栏项,static / dynamic 共用同一结构):
  ```
  {
    id:     string,                            // 框架生成 'ti-N'(§ 4.11)
    component: string,                            // 必须是已注册 component 名(§ 4.8)
    props?: object,                            // JSON 可序列化,默认 {}
    align?: 'start' | 'end',                   // 默认 'start'(工具栏的起始端 / 结束端)
  }
  ```
  tab component 也是这种 spec,framework 不给它开任何特权字段(§ 4.6)。

#### Layer 3 — 注册表(ComponentSpec)

**ComponentSpec 的完整字段定义见 § 4.8**,这里不重复。

仅补一条:注册表是进程全局(`Map<string, ComponentSpec>`),不属于任何 LayoutRuntime —— 同一页面多个 createDockLayout 共享一套 component 定义。

#### Layer 4 — 运行时外壳(LayoutRuntime / DockRuntime)

运行时外壳**绝不重复存储 tree 里已有的状态**。它只存"为了给 DOM / component 服务必须有的东西":keyed reconcile 的锚点、component 实例的归属、全局计数器、hooks。

- **LayoutRuntime**(一个 createDockLayout 一份):
  ```
  {
    container:         HTMLElement,                // 调用方传入的根
    treeSig:           Signal<LayoutTree>,          // 唯一 tree 信号
    dockRuntimes:      Map<dockId, DockRuntime>,    // keyed reconcile 用:tree 里还在的 dock 才保留
    activationCounter: number,                      // 全局单调递增,给 ComponentRuntime.lastActivatedAt 派号
    lruMax:            number,                      // 来自 config.lru.max
    hooks:             LayoutConfig['hooks'],
    broadcastChannel:  BroadcastChannel | null,     // 首次 popOut 时懒建(§ 4.14)
  }
  ```
  - `dockRuntimes` 是 reconcile 循环的**keyed 查表**:新 tree 走一遍 → 见到某 dockId 已存在 → 复用 runtime + 复用 DOM;没存在 → 新建 runtime + 建 DOM;旧 tree 里有但新 tree 没有 → 等 surviving docks 完成 active panel re-home 后再 dispose runtime + 丢 DOM。这就是 § 4.3 "keyed reconciliation by dock id" 的实际载体。

- **DockRuntime**(每个 tree 里的 dock 一份):
  ```
  {
    id:                    string,                       // = DockData.id
    dataSig:               Signal<DockData>,              // tree 里该 dock 的实时镜像
    dockEl:                HTMLElement,                   // .aiditor-dock 根(keyed reconcile 的锚点)
    toolbarEl:             HTMLElement | null,            // .aiditor-toolbar(无 toolbar 时为 null)
    contentEl:             HTMLElement,                   // .aiditor-dock-content(active panel 的唯一挂载点)
    panelRuntimes:         Map<panelId, ComponentRuntime>,   // kind='panel',懒建懒销
    staticToolbarRuntimes: ComponentRuntime[],               // kind='toolbar-static',随 dock 生灭
  }
  ```
  - `dataSig` 是 dock 数据的 signal 镜像,`ctx.dock.panels` / `activeId` / `collapsed` 等都是 `derived(() => dataSig().xxx)`。reconcile 里只 `dataSig.set(newDockData)`,component 端自动沿链重算。
  - **动态 toolbar runtimes 不住在这里**,它们挂在贡献者 panel 的 ComponentRuntime 上(跟父 panel 走,见 Layer 5)。这是跨 dock 移动 panel 时"动态 items 自然跟着走"的根本原因。

#### Layer 5 — ComponentRuntime(三 kind 统一)

**所有 component 实例在运行时用统一的 `ComponentRuntime` 结构包装**,住在 DockRuntime 里(panel / static toolbar)或父 panel runtime 的 `dynamicToolbarRuntimes` 数组里(dynamic toolbar)。这是本架构的关键统一点 —— panel component / 静态 toolbar component / 动态 toolbar component **不是三种不同的对象**,而是**一个概念,三种生命周期**。

```
ComponentRuntime = {
  kind,                     // 'panel' | 'toolbar-static' | 'toolbar-dynamic'
  component,                   // string,已注册 component 名(§ 4.8)
  contentEl,                // HTMLElement | null,懒创建 + detached DOM(§ 4.3)
  ctx,                      // ComponentContext(kind 决定暴露哪些字段)
  cleanups,                 // Array<() => void>,dispose 时顺序跑完
  active,                   // signal<boolean>,§ 4.3 的"DOM 是否挂载"语义

  // 仅 kind === 'panel':
  data?,                    // signal<PanelData>,tree 中该 panel 的实时镜像
  dockRef?,                 // signal<string>,当前所在 dockId
  dynamicToolbarRuntimes?,  // Array<ComponentRuntime>,此 panel 贡献的 dynamic items
  lastActivatedAt?,         // 单调递增数字,用于激活选择 + LRU
}
```

**三种 kind 的归属与生命周期**(表):

| kind | 住在哪里 | 生命周期 | ctx 暴露字段 |
|---|---|---|---|
| `panel` | dock 的 `panelRuntimes: Map<panelId, ComponentRuntime>` | `addPanel` 建 / `removePanel` 或 LRU 销 | `ctx.panel` + `ctx.dock`(动态跟随 `dockRef`) |
| `toolbar-static` | dock 的 `staticToolbarRuntimes: ComponentRuntime[]` | 随 dock 整体生灭 | 仅 `ctx.dock`;`ctx.active` 常量 `true` |
| `toolbar-dynamic` | 父 panel runtime 的 `dynamicToolbarRuntimes` 数组 | 跟父 panel 走;父 panel 销则同销 | `ctx.panel` = 贡献方 panel;`ctx.dock` = panel 当前所在 dock(跟父 `dockRef` 动态) |

**三种 runtime 的架构统一点**(不是巧合,是设计):

1. **`cleanups` 字段三种 runtime 都有**。`ctx.bus.on(topic, h)` 永远把退订函数 push 进"当前 runtime 的 cleanups",runtime dispose 时一起跑 —— **订阅泄漏/static toolbar 没挂载点的问题从机制上不存在**。auto-unsubscribe 是 runtime 层的性质,不是 panel 层的特权
2. **`contentEl` 的懒创建 + detached DOM 规则(§ 4.3)三种 kind 共用**。切 active 的 detach / re-attach 代码路径一套
3. **跨 dock 移动**只操作 `kind='panel'` 的 runtime —— 把它从源 dock `panelRuntimes` 挪到目标 dock,改它的 `dockRef` signal。它的 `dynamicToolbarRuntimes` 是 panel runtime 的字段 —— 自然跟着走,零额外逻辑

#### `data` 是 signal,所有 panel 派生字段从它读

单一真源 = tree,单一更新路径 = `tree → data signal → derived`:

- reconcile tree 时,框架对每个 panel runtime 做 `runtime.data.set(newPanelData)`
- tree 是结构共享的不可变树,**未改动的 PanelData 对象在新旧 tree 里是 `===` 同一引用** —— signal 的 `Object.is` 脏检查自动跳过 notify。未变动的 panel 在 reconcile 里走过是零开销
- `ctx.panel.title` / `dirty` / `props` 全部是 `derived(() => runtime.data().xxx)` 形式,没有"runtime 里复制一份"的状态
- `ctx.panel.setTitle(s)` 的实现就是 `treeSig.set(updatePanel(treeSig.peek(), id, { title: s }))` —— 这次写入下一 reconcile 自动沿 data signal 传到 derived

**runtime 没有重复状态,没有同步问题**。

#### 为什么这样分

**为什么 `lastActivatedAt` 放 runtime 不放 PanelData?**
- 每次切 active 都触发 tree 不可变重建太重(新 dock、新 panels 数组、新 panel 对象)
- LRU 淘汰和"关闭 active 后新 active 选谁"两个用途都在 runtime 层查,不用碰 tree
- 跨窗口迁移时对端 `_activationCounter` 从 0 开始,丢失本端的激活历史是**正确的**(新环境自己产生新的"最近使用"序列)

**为什么 `dockRef` 是 signal?**
- Panel 跨 dock 移动(§ 4.14)时,component 订阅的 `ctx.dock.panels` / `activeId` / `collapsed` 等要自动指向新 dock
- 实现:`ctx.dock.panels = derived(() => tree.find(dockRef()).panels)`。dockRef 变 → derived 重算 → component effect 自动 re-run
- component 不感知自己被移动过,代码完全透明

#### ctx 完整表面

**共享部分**(三种 kind 都有):
```
ctx.active               // signal<boolean>
ctx.bus                  // auto-unsub 版 aiditor.bus,on() 自动挂当前 runtime 的 cleanups
ctx.onCleanup(fn)        // 手动注册 cleanup(给非 bus 的场景)
ctx.safeCall(fn)         // 异步回调归因到当前 runtime
ctx.dock = {
  id:        signal<string>,
  panels:    signal<PanelData[]>,
  activeId:  signal<string|null>,
  collapsed: signal<boolean>,
  focused:   signal<boolean>,
  activatePanel(id), requestClosePanel(id, reason), addPanel(partial),
  toggleFocus(), setFocus(b), setCollapsed(b),
}
```

**仅 `kind='panel'` 或 `kind='toolbar-dynamic'` 有**:
```
ctx.panel = {
  id,
  title: signal<string>,   setTitle(s),
  icon:  signal<string>,   setIcon(s),
  dirty: signal<boolean>,  setDirty(b),
  badge: signal<string|null>, setBadge(s),
  props: signal<object>,   updateProps(patch),
  promote(), close(), popOut(),
}
```

**`toolbar-static` component 的 ctx 没有 `ctx.panel`**,按约定使用即可,框架不做 null 检查(§ 2.5)。

#### `ctx.panel.updateProps(patch)` 是低频持久化点

这是 component 把"想持久化的状态"写回 tree 的**唯一通道**。每次调:浅合并到 `PanelData.props` → 提交新 tree → reconcile → derived 沿链传播。这是重操作,**不要在 keystroke / scroll / pointermove 等高频事件里调**。高频状态存 component 内部,在用户显式保存 / panel dispose / pop-out 之前 flush 一次即可。

典型例子:
- monaco component 打开新文件 → 调 `updateProps({ filePath: '...' })`(低频,用户动作触发)
- 实时光标位置 → **不调** updateProps,存在 component 实例字段里,需要时再 flush
- LRU 真 dispose 后重建,`factory(propsSig, ctx)` 拿到的 `props` 只包含被 updateProps 写回去的字段。其他全部是"只存在 contentEl 里"的临时状态 —— 这是显式契约,用户配 `lru.max` 时就在接受

#### Layer 6 — 纯函数 API(tree/tree.js,无 DOM)

所有写接口是**纯函数**:输入旧 tree,输出新 tree(结构共享);契约违反直接 throw(§ 2.5)。约定:**生成 id 的写函数返回 `{ tree, 新id }` 元组;不生成 id 的返回 tree 本身;`mergeDocks` 返回 `{ tree, discardedPanels }`(§ 4.2)。**

| 函数 | 签名 | 返回 | 备注 |
|---|---|---|---|
| `findDock` | `(tree, dockId)` | `{ node, path } \| null` | path = 从根到该 dock 的 children 下标序列 |
| `findPanel` | `(tree, panelId)` | `{ panel, dockId, path } \| null` | path 指向所在 dock |
| `getAt` | `(tree, path)` | `node \| null` | |
| `addPanel` | `(tree, dockId, partial, opts?)` | `{ tree, panelId }` | `opts.transient?: boolean`;`accept` 拒收则 throw(§ 4.12) |
| `removePanel` | `(tree, panelId)` | `tree` | 默认最后 panel 删除后移除非 root dock;`removeWhenEmpty:false` 时保留空 dock |
| `updatePanel` | `(tree, panelId, patch)` | `tree` | 浅合并到 PanelData |
| `activatePanel` | `(tree, panelId)` | `tree` | 只改所在 dock 的 `activeId` |
| `promotePanel` | `(tree, panelId)` | `tree` | 清 transient(§ 4.4) |
| `movePanel` | `(tree, panelId, dstDockId, dstIndex?)` | `tree` | 省略 `dstIndex` = append;`accept` 拒收则 throw;srcDock === dstDock 时退化为 reorder |
| `reorderPanel` | `(tree, panelId, newIndex)` | `tree` | = `movePanel(..., 同 dock, newIndex)` 的语法糖 |
| `updateDock` | `(tree, dockId, patch)` | `tree` | 浅合并 DockData(排除 panels / activeId) |
| `setCollapsed` | `(tree, dockId, bool)` | `tree` | |
| `setFocused` | `(tree, dockId, bool)` | `tree` | 置 true 时自动清其他 dock 的 `focused` |
| `splitDock` | `(tree, dockId, direction, side, ratio?, opts?)` | `{ tree, newDockId, newPanelId? }` | `side: 'before' \| 'after'`;`ratio ∈ (0,1)`,默认 0.5;runtime 默认按 § 4.1 传入 cloned active PanelData 和 dock shell;纯函数只消费 `opts.dock` / `opts.seedPanels` |
| `mergeDocks` | `(tree, winnerId, loserId)` | `{ tree, discardedPanels }` | 仅允许直接兄弟(§ 4.2);dirty 检查由调用方(`interactions.js`)做 |
| `resizeAt` | `(tree, splitPath, newSizes)` | `tree` | 直接改某个 split 的 sizes |
| `swapDocks` | `(tree, dockA, dockB)` | `tree` | 整个 DockData 对换位置(面板全跟着走) |

**id 生成永远走全局计数器**:`aiditor._nextPanelId()` / `aiditor._nextDockId()` / `aiditor._nextToolbarItemId()`,这三个计数器挂在 `aiditor` 上,进程内单调,跨 LayoutRuntime 共享。用户不传 id、不看 id(除非从返回值里读)—— 这是 § 4.11 的硬规矩。

## 10. Toolbar —— 单条,两种来源
**一个 dock 最多 1 条 toolbar,在 4 个方向(top/bottom/left/right)选 1 个。** 位置由 `dock.toolbar.direction` 决定。

**Toolbar 里的组件来自两种来源**(渲染时按顺序拼出来):
1. **Static items** —— 写在 `dock.toolbar.items[]` 里,随 dock 生命周期存在,不随 panel 切换变化
2. **Dynamic items** —— active panel 在 `PanelData.toolbarItems[]` 里声明,**panel 激活则显示,不激活则消失**

**ToolbarItemSpec 的字段定义见 § 4.9 Layer 2**。这里只讲它的行为。

**动态 items 的生命周期**:
- Dynamic items 的 contentEl 跟 panel contentEl 一样走**懒创建 + detached DOM**:panel 第一次激活时调 `component.factory(propsSig, ctx)` 创建,切走 active 时从 toolbar DOM detach(**不销毁**),切回来 re-append
- Panel 跨 dock 移动时,dynamic items 的 contentEl 跟着 panel 走,component 不重建;它们订阅的 `ctx.dock.*` signals 通过 PanelRuntime 的 `dockRef`(§ 4.9)自动指向新 dock
- Panel dispose 时,所有它贡献的 dynamic items 一起 dispose(走 `component.dispose`)

**渲染规则**:
- 切换 active panel 时 toolbar **不整体重建**,只 reconcile dynamic items 部分(static items 永远不动)
- **component 类型决定它能访问哪些 ctx 字段**(契约,不是检查):
  - **Panel component**(出现在 dock content 区):`ctx.panel` 指向自己 + `ctx.dock` 指向所在 dock
  - **Static toolbar component**(写在 `dock.toolbar.items`):只有 `ctx.dock`,没有 `ctx.panel`。tab component 属于这一类
  - **Dynamic toolbar component**(写在 `PanelData.toolbarItems`):`ctx.panel` 指向贡献它的 panel + `ctx.dock` 指向 panel 当前所在的 dock(跟随 `dockRef` 迁移)
  - component 作者按注册场景决定用哪些字段,框架不做 null 检查,不写 fallback

**Dock 无 toolbar 时**:整个 toolbar 区域完全不渲染,content 占满整个 dock。**不要默认插入 `tab-standard`**,这是显式契约 —— 用户没写 toolbar 就真的没有。dynamic items 此时也不显示(没挂载点)—— 这是 panel 作者应自检的边界(想显示就选个会配 toolbar 的 dock)。

**`activeId` 为 null 时**:content 区就是一个空 div,不显示提示文字、不接受 emptyContent 渲染器。想要占位,自己注册一个占位 component 当默认 panel。

## 11. id 生成 & active 自动切换
**所有 id 由框架生成,用户不传、不指定、不看见(除非主动从返回值读)。**
- `panel.id`:框架内部计数器 `panel-1 / panel-2 / ...`
- `dock.id`:框架内部计数器 `dock-1 / dock-2 / ...`
- 对应 API 改为只接 "部分 PanelData"(不含 id),执行后返回新生成的 id:
  - `addPanel(tree, dockId, partial, opts?) → { tree, panelId }`
  - `splitDock(tree, dockId, dir, side, ratio?, opts?) → { tree, newDockId, newPanelId? }`(分裂出空 dock 时 `newPanelId` 为 `undefined`)
  - `createDockLayout(config)` 顶层配置允许用"锚点名"(如 `name: 'sidebar'`)做稳定引用,内部依然生成 id 并维护一张 `name → id` 的查找表
- 重复 id 理论上不会发生(框架生成,全局单调)

**active 切换用激活计数,不用"前/后邻居"。**
- 每个 `LayoutRuntime` 内部维护单调递增 `activationCounter`。
- `activatePanel(panelId)` 执行时,在对应 PanelRuntime 上写 `runtime.lastActivatedAt = ++layout.activationCounter`(这是 runtime 的字段,不写回 tree)。
- 删除 active panel 后,纯 tree 层默认选择剩余 panels 的最后一个;运行时层负责 dispose 被删 panel 并保持 tree/runtime 一致。
- 同一个字段被 § 4.3 的 LRU 复用:`lru.max = N` 时,按 runtime 的 `lastActivatedAt` 升序挑最小的 **dispose**(真 dispose,不是 hide)

## 12. Panel 白名单(dock.accept)
每个 dock 可以声明自己接受哪些类型的 panel —— 这条规则同时服务于跨 dock 拖放的 drop zone 校验(§ 4.14):
- `dock.accept` 默认 `'*'`(接受任何 component 类型)
- 可以写成 `['monaco', 'preview']`(仅接受这两个注册名)
- **校验发生在纯函数层**:`addPanel(tree, dockId, partial)` 和 `movePanel(tree, srcDockId, panelId, dstDockId)` 在构造新 tree 之前检查目标 dock 的 `accept`,不匹配直接 throw(不是防御性代码,是显式契约)
- **拖放 UI 亮灯用的是同一份规则** —— preview 时查一次 `accept`,决定 drop zone 是绿还是红
- 因为 panel.component 字段永远是 string(§ 4.8),这条规则不存在边界 case

## 13. 通讯总线 aiditor.bus(pub/sub,自动清理)
**所有 panel / dock / component 之间的解耦通讯走同一条总线。没人直接持有别人的 reference,也没人直接调别人的方法。**

API 极简:
```js
aiditor.bus.on(topic, handler) → unsubscribe fn
aiditor.bus.off(topic, handler)
aiditor.bus.emit(topic, payload)
```

- `topic` 是任意字符串,命名由用户自定(例如 `'file:opened'` / `'selection:changed'` / `'build:done'`),框架不限制也不校验
- `handler` 同步执行,`emit` 返回后所有订阅者都跑完了
- **每个 handler 都被 `safeCall` 单独包裹**:某个 handler 抛错只会路由到 `aiditor.log` 的 error 条目;通过 `ctx.bus.on` 订阅时 source 带订阅者所在 panel 的 dockId/panelId/component/topic,**不会中断同一 emit 的其他订阅者**。这是 § 4.7 错误隔离规则的延伸 —— 一条总线上互不信任的 component 需要有这个保证
- **auto-unsubscribe**:component 通过 `ctx.bus.on(topic, h)` 订阅时,框架自动把退订函数塞进 panel runtime 的 `cleanups` 列表,panel dispose 时一起清,**不存在订阅泄漏**。component 直接用 `aiditor.bus.on` 就没有自动清理,需要自己管
- 当前实现不内置系统 topic;应用需要系统事件时自行定义 topic。历史计划里的 `aiditor:*` topic 不再视为已实现 API
- **只做单向 emit**,不做 request/response。要"问/答"语义,自己定义两个 topic(`'foo:request'` / `'foo:response'`)+ 自带 correlation id
- bus 不做持久化,不做离线回放,订阅之前 emit 的事件收不到

**Bus vs Signal —— 用哪个?** 框架同时提供两套通讯原语,区分清楚不是教条而是性能和正确性问题:

| 维度 | `signal`(§ core/signal.js) | `bus`(§ 4.13) |
|---|---|---|
| 形态 | **状态**(有"当前值") | **事件**(只有"发生过") |
| 订阅时机 | 晚订阅也能通过 `signal()` 读到当前值 | 晚订阅收不到 emit 之前的事件 |
| 多源 | 一个 signal 一个 owner,谁拥有谁 set | 任何 component 都能 emit 到任何 topic |
| 重复值 | 同值 set 不通知(脏检查) | 每次 emit 都触发 |
| 数据流向 | 内层 → 外层(子组件读父 ctx 的 signal) | 横向(panel ↔ panel,跨 dock) |
| auto-cleanup | `effect` 通过 `onCleanup` 收集 | `ctx.bus.on` 通过 panel runtime cleanups 收集 |

**判定规则(一句话)**:**晚一点订阅的人,需不需要知道"我订阅之前发生的最后一次"?需要 → signal;不需要 → bus。**

具体落地:
- "当前 active panel 是哪个" → **signal**(`ctx.dock.activeId`),因为新挂载的 tab component 必须立刻知道当前是谁
- "panel 已激活" 通知 → **bus**(`aiditor:panel:activated`),因为这是事件,错过了不需要补
- "文件内容已修改"(dirty 标记) → **signal**(`ctx.panel.dirty`),状态
- "文件已保存" → **bus**(`'file:saved'` 之类),事件
- 跨 panel 共享的"当前选中的对象" → **signal**(由某个权威 panel 持有,放在 `aiditor` 上或通过 bus 广播一次拿到 ref;真要解耦还是首选"权威 panel emit 事件,关心方各自维护本地 cache")
- 一次性命令(关闭 / 保存 / 编译) → **bus**

## 14. Panel 跨 dock 拖放 & 弹出独立窗口
**这是核心能力,不是可选扩展。**

**跨 dock 拖放(同窗口内)**:
- Tab 栏上的 panel 可拖出,进入另一个 dock 的 tab 栏或 content 区 → 执行 `movePanel(tree, srcDockId, panelId, dstDockId)`
- 拖放过程中框架 hit-test 目标 dock,查目标 dock 的 `accept` 白名单(§ 4.12),不匹配 → 红色禁入 overlay;匹配 → 绿色 drop zone
- 实现上就是 **detach contentEl from src dock's content → attach to dst dock's content**,不重建 component,不丢状态。PanelRuntime 整个从源 dock 的 map 移到目标 dock 的 map
- 同 dock 内 tab reorder 是这个操作的退化场景(src === dst,只改 panels 数组顺序)

**弹出独立窗口**:
- `ctx.panel.popOut()` 或拖 panel 到窗口外触发
- 框架调 `window.open()` 开一个新 browser 窗口,加载同一份 `index.html`
- 新老窗口通过 `BroadcastChannel('aiditor-layout')` 建立连接
- 源窗口:调 `component.serialize(contentEl) → state`(可选 hook,不提供则 `state = undefined`),`BroadcastChannel.postMessage({ action: 'migrate', panelData, state })`,等目标窗口 ack,收到后才在源窗口 `component.dispose(contentEl)` + `removePanel`
- 目标窗口:收到 migrate → 决定落点 dock → `addPanel` → 懒激活时调 `component.factory(propsSig, ctx)` + 若有 state 再调 `component.deserialize(contentEl, state)`,完成后发 ack
- **Component spec 新增两个可选字段**配合跨窗口:
  ```
  serialize?:   (el) => any         // 返回一个可 structured-clone 的 state
  deserialize?: (el, state) => void // 在新创建的 el 上恢复 state
  ```
- 两个字段都没实现的 component **仍然可以跨窗口迁移**,只是状态只保留 `props`(等于重建)
- 细节:跨窗口期间的"谁拥有这个 panel"竞态用"源先冻结 → 发消息 → 目标 ack → 源清理"的两阶段 handshake 处理
- 独立窗口关闭时,它里面的 panel 消失(跟浏览器关标签页一样,框架不做自动回流)

## 15. 明确不做的(out of scope)
**下列能力项目不做,即使功能上看起来"顺手就能加",也不做。** 要做请单独立项讨论。
- **Transient panel 的双击 / 编辑自动升级**:不监听双击、不监听编辑事件。只保留 `ctx.panel.promote()` API
- **Overlay / Peek**(VS Code 风格的悬浮编辑器):不在范围
- **命令系统**(command palette):框架不提供,用户自己搭
- **菜单系统**(右键菜单、顶栏菜单):同上
- **主题切换运行时 API**:只保证 CSS 变量命名规范(§ 5),不做 `setTheme()`
- **任何内置快捷键**(再次强调,见 § 2.1)

---
