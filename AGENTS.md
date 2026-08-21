# aiditor — Codex 工作交接

> 这个文件是给 Codex 看的项目状态说明,任何新的 Codex 会话开始前都必须读完。
> 用户在不同电脑之间切换工作环境,本文件保证上下文不丢失。

---

## 1. 项目是什么

**aiditor** —— 一个纯前端、零依赖、Blender 风格的通用编辑器框架。

当前产品边界分四块:

1. **AIditor Core/UI**:稳定零依赖内核,提供 Dock/Panel/Component、UI 组件库、主题、signal/log/bus/settings/history/workspace contract。
2. **AIditor AI Host**:可选上层模块,提供 agent runtime、provider、tools/context/operations、permissions、ChangeSet、compaction。它依赖 Core/UI,但 Core/UI 不依赖 AI。
3. **AIditor Extension Runtime**:可选上层模块,把 component/tool/context/reference/operation/settings/command/menu/dock panel contribution 安装进已有 registry。它不是第二套组件或 AI 模型。
4. **Demo Project Runtime**:示例宿主应用,用于演示“打开 workspace、加载文件、注册组件、挂到 dock”。它不属于框架层概念,不得写进 `src/` 的通用设计。

AIditor 仍坚持零依赖、零模块系统、单命名空间和 file:// 可运行。AI Host 和 Extension Runtime 是框架提供的可选能力,不是把 Core/UI 变成业务编辑器。

- **零构建**:经典 `<script>` 标签,直接 `file://` 双击 `index.html` 就能跑
- **零依赖**:不用 npm,不用打包工具,不用任何框架
- **单命名空间**:所有东西挂在 `window.aiditor` 下
- **三层架构**:Dock(布局容器)/ Panel(内容单元)/ Component(UI 组件)
- **核心机制**:不可变 N 叉分割树 + 自研 ~70 行响应式 signal + 按 dock id 的 keyed reconciliation

### 核心思想(读完这一段等于看懂了一半)

整个框架就是这一张图:

```
Layout(Blender 风格的 N 叉分割树)
 └─ Dock ×M                      ← 可以被分裂 / 合并 / 调整大小的矩形容器
     ├─ Toolbar(可选,top/bottom/left/right 四选一条)
     │   ├─ Static Items          ← dock 配置写死的(方向、初始按钮等)
     │   └─ Dynamic Items         ← active panel 动态贡献的,切 active 自动装卸
     └─ Panel ×N(同一时刻只有 1 个 active,也可能 0 个)
         └─ Component(真正渲染内容的 UI 组件)
```

**关键结论**(每一条都是一条硬约束,后面章节会细化):

1. **Dock 里装 0 ~ N 个 panel**,有 panel 时**总有一个 active**,只 active 的那个显示。
2. **Dock 的显示 = toolbar + panel content**,toolbar 可无,content 区永远存在(空 dock 时是空 div)。
3. **Toolbar 组件不分种类**:`tab-standard`、"关闭按钮"、"文件切换器"全都是平等的 toolbar 组件。tab component 的"特殊性"仅仅是它订阅了所在 dock 的 `panels` 和 `activeId` signal 从而能渲染成 tab 栏 —— 但框架不给它开任何特权 API,它用的 ctx 和别的 toolbar 组件完全一样。
4. **Toolbar 组件有两种来源**:
   - **Static**:dock 配置里写的,随 dock 生命周期存在
   - **Dynamic**:active panel 在 PanelData 里声明的 `toolbarItems[]`,panel 激活时自动挂到 toolbar,切走自动卸载。panel 跨 dock 移动时,动态 items 自然跟着 panel 走。
5. **Panel 可跨 dock 拖放,也可弹独立窗口**。Dock 可以配 `accept` 白名单限定只接受哪些 component 类型的 panel。跨 dock 拖放和同 dock 切 active 共享同一条 detach/re-attach 代码路径;跨窗口则走 `serialize`/`deserialize` 协议(architecture-decisions.md 第 14 条)。
6. **多 panel 的性能要求是真的"只有 active 存在"**:非 active panel 的 contentEl **直接从 DOM detach**(不是 display:none,不是 content-visibility:hidden),浏览器对它零 layout、零 paint、零事件开销。切回 active 时 re-append,DOM 状态和 JS 对象完全保留。这是 architecture-decisions.md 第 3 条的唯一实现路径。
7. **Panel / Dock 之间通讯走一条统一的解耦总线 `aiditor.bus`**:pub/sub,topic + payload,通过 `ctx.bus` 自动在 panel dispose 时取消订阅。没人直接持有别人的引用。

本文件是**最高优先级的工作交接与硬规则权威**。当前架构细节以 `doc/*.md` 为准,但不得违反本文件里的产品边界、零依赖、零模块系统、设计先行和代码风格红线。`doc/old/**` 只作历史资料。

---

## 2. 硬规则(不可违反)

这些是和用户多次对话后确立的红线,违反会让用户失望。

### 2.1 零应用级快捷键
**框架代码绝对不许内置"应用级/业务级"快捷键**。
我们是通用库,不是某个特定的编辑器应用。Focus Mode、关闭 panel、切换 tab、保存、命令面板、撤销/重做……所有"属于应用决策"的快捷键都**只暴露 API**(例如 `ctx.dock.toggleFocus()`),由调用方决定要不要绑键、绑哪个键。Demo 里可以演示一种绑法,但绝不写进 `src/`。

**但"组件内部语义键"允许,且必须有**——这不是快捷键,是组件自身功能的一部分,删掉组件就废了:
- **输入/编辑组件的编辑键**:textarea 的 Tab 缩进、codeInput 的 Tab、input 的 Enter 提交等。浏览器默认行为不满足组件语义时,组件必须自己 `preventDefault` + 处理
- **Overlay 的 dismiss 键**:modal / drawer / popover / menu 按 ESC 关闭最上层(由 `_overlay.js` 统一管,LIFO 栈)
- **Focus trap 的 Tab 循环**:modal 打开时 Tab 在 modal 内部循环,防止焦点跑到背后不可见元素。这是 WAI-ARIA 对 modal dialog 的硬性要求
- **进行中的交互的取消键**:拖拽 splitter / 拖 panel 过程中按 ESC 取消本次拖拽

判据很简单:**这个键绑了之后,是在替用户决定应用该怎么响应,还是在完成组件自己必须做的事?** 前者禁止(写 API 让调用方绑),后者允许(组件自己绑)。拿不准就当作前者。

### 2.2 零构建、零模块系统
**不许用 ES modules,不许引入打包工具,不许写 `import/export`。**
所有源文件都是 IIFE,挂载到 `window.aiditor`:
```js
;(function (aiditor) {
  'use strict'
  // ...
  aiditor.something = something
})(window.aiditor = window.aiditor || {})
```
HTML 用 `<script src="...">` 按依赖顺序加载。用户必须能双击 `index.html` 直接看到运行效果。

### 2.3 设计先行(Design-First)
**任何非平凡的改动,先写计划,等用户明确说"开始"再动代码。**
顺序:
1. 列数据模型 / 文件清单 / API 表面
2. 列出待决问题并明确请用户拍板
3. 用户回复后修订计划,可能多轮
4. 用户回复"开始" / "go" / "确认开始"才动代码

用户在动代码之前更正过设计方向多次。如果你跳过这一步直接动手,会浪费工作量。当用户说"先不着急改代码"或类似的话,意思就是只设计不写代码。

### 2.4 一个独立功能一个文件
独立的功能单元住在独立的文件里。`src/` 下用子目录把相关关注点分组(`core/`、`tree/`、`components/`、`dock/`、`style/`)。不要把 6 个不相关的概念塞进一个 800 行的文件。但也不要把 30 行的"焦点模式"硬拆出去 —— 见 § 5 的目录方案。

### 2.5 不写防御性代码
框架内部相互调用是受信任的契约,不需要 try/catch、null 检查、参数兜底。**只有在用户 component 调用边界用 `safeCall` 包裹**(因为用户代码可能抛错)。不为不可能发生的情况写代码。

### 2.6 不擅自加功能
- 没让你做的功能不要做("顺手清理一下"、"加点配置项"、"补个 docstring"全都不要)
- 没让你重构的代码不要重构
- 修 bug 时不连带改无关代码
- 不在没改的代码上加注释 / 类型 / 文档
- 不为假想的未来需求做准备

### 2.7 不擅自破坏性操作
不未经允许:`git push --force`、`git reset --hard`、删文件、改 git 配置、`--no-verify`。

---

## 3. 目录与已知坑

> 实现清单的唯一权威是 `doc/implementation-map.md`;不要用旧对话、旧阶段或 `doc/old/**` 推断当前架构。

### 3.1 目录(实际落盘)

```
aiditor/
  index.html                       # demo 入口 — 引用 dist/aiditor-full.{css,js} + demo widgets
  AGENTS.md                        # 本文件 — 工作交接与硬规则权威
  doc/
    old/editor_style.html          # 视觉调色板历史参考(只读,不改)

  tools/
    build.mjs                      # § 2.2 零构建承诺的载体:cat 带 banner,
                                   # 拼出轻量切片和 classic bundles;支持 --watch

  dist/                            # 已 commit 的 bundle 产物(保证零环境双击运行)
    aiditor-theme.js / .css        # 独立主题 runtime + tokens + 内置主题
    aiditor-mini.js / .css         # 独立网页常用 UI + 主题,不含编辑器重组件
    aiditor-editor.js / .css       # 独立完整通用编辑器 UI,不含 Dock/AI
    aiditor-kernel.js / .css       # Core services + tree + Dock runtime
    aiditor-ui.js / .css           # Kernel 之上的 UI/panel add-on
    aiditor-ai.js / .css           # AI Host + Extension Runtime add-on
    aiditor-core.js / .css         # Kernel + UI
    aiditor-full.js / .css         # Core + AI Host + Extension Runtime
    aiditor.js / .css              # core alias,保持经典路径可用

  .Codex/
    launch.json                    # Codex Preview 的 dev server 配置
                                   # (npx http-server -p 5570)

  src/
    core/                          # ⚠ 原 src/core/ 已并入这里(重构后的现状)
      signal.js                    # signal / effect / derived / batch / onCleanup
      log.js                       # aiditor.log signal + reportError + safeCall + 全局 window 兜底
      runtime.js                   # runtime script loader + owner-scoped contribution cleanup
      bus.js                       # aiditor.bus pub/sub + auto-unsubscribe
      workspace.js                 # Workspace V2 bounded filesystem adapters
      workspace-watch.js           # Browser FSA verified change owner + fallback
      registry.js                  # registerComponent / resolveComponent / componentDefaults
      context.js                   # ComponentContext 工厂(panel + dock + bus + signals)
    tree/
      tree.js                      # 不可变 N 叉树所有纯函数 + 框架级 transient 预览槽驱逐
    dock/
      runtime.js                   # PanelRuntime 生命周期 + activate + LRU + detached DOM
      render.js                    # reconcile / build / toolbar 两段渲染
      interactions.js              # splitter 拖拽 + 角拖 split/merge + 3×3 hover
      panel-drag.js                # tab tear-out + 跨 dock drop + pop-out(architecture-decisions.md 第 14 条)
      migrate.js                   # 跨窗口 BroadcastChannel 协议 + serialize/deserialize
      layout.js                    # createDockLayout 入口胶水 + LayoutHandle(含 promotePanel)
    style/
      theme.css                    # 主题 v2 token(authoring → primitive/ramp → role → component)+ dark/dracula/light
      dock.css / component.css        # 框架自己的 dock + tab + toolbar 样式
      ui-base.css / ui-form.css / ui-property.css / ui-editor.css / ui-container.css / ui-data.css / ui-overlay.css / dock-tabs.css / ui-ai.css
    ai/
      permission.js                # 统一 permission resolver + audit + path rules
      schema.js                    # tool/output 共用 JSON schema normalize/validate
      contribution-registry.js     # AI contribution exact-owner lifecycle primitive
      agent/                       # Agent store/request/runtime/orchestration/persistence/compaction/checkpoint/eval
      tool/registry.js             # Tool schema/capability/availability registry
      tool/runtime.js              # tool-call lifecycle + run context helpers
      context/                     # factual Context providers + targets + rich prompt
      skill/                       # Skill registry/read/list/builtins/packages
      operation/                   # grouped ChangeSet review/apply
      reference.js                 # references + operation protocol/gateways
      provider*.js / adapter.js    # provider/connection/auth/transport/message tool protocol
      panels/                      # AI panel components(chat/transcript/settings/rich prompt 等)
    extensions/
      manifest.js                  # manifest normalize / public ids / trust + validation helpers
      install.js                   # contribution installers into existing registries
      runtime.js                   # Optional Extension Runtime lifecycle/review/storage/recovery/dock panels
      ai.js                        # Extension Runtime ↔ AI Host bridge(operations/tools)
    ui/                            # ⭐ UI 组件库(aiditor.ui.* 命名空间),按类别分目录
      _internal/                   # _portal / _floating / _drag / _signal / _overlay
      base/                        # button / iconButton / icon / tooltip / popover / kbd / badge / tag / spinner / divider
      form/                        # input / textarea / number / vector / slider / rangeSlider / checkbox / switch / radio /
                                   # segmented / select / combobox / colorInput / enumInput / tagInput / tab
      editor/                      # gradientInput / curveInput / codeInput / pathInput / fileInput
      container/                   # section / propRow / card / view / scrollArea / tabPanel
      timeline/                    # neutral numeric-axis layout + controlled Canvas/input surface
      data/                        # list / tree / table / collectionBrowser / fileBrowser preset / breadcrumbs / progressBar(数据视口全部虚拟化)
      overlay/                     # menu / modal / drawer / alert / toast
      panel/                       # 能被 registerComponent 注册的 "panel 级" 内置 component
                                   # panel-list / inspector / dock-tabs(tab-standard/compact/collapsible/sidebar 预设) / log

  demo/                            # ⚠ 上一个 Codex 做了一次重构:单文件 ui-showcase.js 拆成 4 份
    catalog.js                     # 全部组件的 catalog(signals / mount / editFor)数据
    state.js                       # window.Demo 命名空间(selected / select / openCategory / signal cache)
    components/
      ui-gallery.js                # 组件库浏览与预览,展示内置/项目组件
      demo.css                     # demo component 的额外样式
```

**关键提示给下一个会话的 Codex**:
- **目录分层**:
  - `src/core/` = 零依赖底层 + component registry + context 工厂
  - `src/ai/` = Optional AI Host(agent/provider/tool/context/reference/operation/ChangeSet/permission/runtime)
  - `src/extensions/` = Optional Extension Runtime,安装 contribution 到已有 registry,并通过 owner 精确卸载
  - `src/ui/` = `aiditor.ui.*` 通用 UI 元件库(50+ 个)
  - `src/ui/panel/` = 内置 panel 级 component(panel-list / dock-tabs / history / log 等),用 `registerComponent` 注册,能直接塞进 dock
  - `demo/` = 用户层 demo,catalog+state 负责数据,components/ 负责示例面板
- 改完 `src/` 下任何文件**必须** `node tools/build.mjs` 重新生成 `dist/aiditor-core.*` / `dist/aiditor-full.*` / `dist/aiditor.*`,index.html 是直接引用 full dist 的,不重建就看不到改动
- **`demo/` 下的文件不进 bundle** —— index.html 直接 `<script>` 加载 demo/*.js,改完 reload 即可
- 写 dev server 时用 `.Codex/launch.json` 已配好的 `aiditor-demo`(端口 5570),不要自己拉新端口
- 文件加载顺序看 `tools/build.mjs` 的 `JS_ORDER` / `CSS_ORDER` 数组,**那是依赖序的唯一权威**

### 3.3 已知坑(给下一个 Codex 的避雷指南)

1. **`ui.bind(el, sig, fn)` 会同步触发一次 fn**。任何在 `fn` 里访问的变量必须在 `bind` 之前已经声明并初始化,否则 TDZ 报错。`src/style/theme-settings.js` 修过这个坑(`allSigs` / `refreshAll` 必须在绑定写入前定义好闭包关系)。
2. **`aiditor.effect(() => ...)` 也是同步触发**。如果 effect 体里向 `documentElement.style` 写 inline CSS variable,初次挂载那一刻就会把当前 signal 值写成 inline 样式,**inline specificity 会覆盖 `[data-aiditor-theme="light"]` 之类的属性选择器,主题切换从此失效**。修复模板:在 effect 里读 `getComputedStyle` 的 effective value,和想写的 literal 比较,相同就 return 跳过写入 —— 初次挂载零污染,只有用户真的编辑才写 inline。详见 `src/style/theme-settings.js` 的 `bindWriter`。
3. **不要在 component `factory(propsSig, ctx)` 里调 `ctx.panel.updateProps()` 高频化**(architecture-decisions.md 第 9 条已警告)。它写回 tree 触发 reconcile,keystroke 级别会卡。
4. **改了 `src/` 没 rebuild = 看不到改动**。每次都跑 `node tools/build.mjs`(或 `--watch`)。**改 `demo/` 不用 rebuild**,demo 是 `<script>` 直挂的,reload 即可。
5. **`registerComponent` 重名 throw**。同一个 component 不能注册两次,reload 时如果 demo component 文件被加载两次会炸。`index.html` 里 demo component 用 `<script>` 标签,默认不会重复。
6. **dist/aiditor-core.* / dist/aiditor-full.* / dist/aiditor.* 是已 commit 的产物**。改了源码之后 commit 时记得把 dist 一起 commit,否则克隆出去的人看不到效果。
7. **focus mode 有 CSS containing block 限制**(architecture-decisions.md 第 5 条已记录)。aiditor root 的祖先不能有 `transform/filter/perspective/will-change`。
8. **`addPanel(..., { transient: true })` 自动驱逐同 dock 已有 transient**(architecture-decisions.md 第 4 条框架级预览槽语义)。调用方不用自己写"找到现有 transient 再删"的胶水 —— tree 层已经做了。`LayoutHandle.promotePanel(panelId)` 负责"单击→preview / 双击→固定"的升级路径。
9. **所有可调常数的唯一存储是 `src/style/theme.css` 的 `--aiditor-*` token**。**不要**在 JS 里新写任何"默认时长 220ms / 默认阈值 6px / icon 映射表"。判据:"JS 要不要对这个值做数值运算?" 否 → CSS `var()`/`calc(var())`/`content: var()`;是 → `aiditor.ui.readNum('--aiditor-xxx', fallback)`。消费者看 `drawer.js` / `interactions.js` / `panel-drag.js` 的写法,不要复制旧习惯。
10. **多 Tool 审批恢复必须继续同一条 assistant message 的未完成 ToolCall**。不能因为一个调用已审批就直接开启下一 provider Turn,也不能看到仍有 pending 就空返回;批次只有全部进入终态后才能继续模型。ToolCall status 是唯一批次进度,不要再造 cursor/snapshot。

---

## 4. 架构决策(全部要遵守)

15 条子系统行为契约(Split/Merge 语义、Detached DOM、Transient Panel、Focus Mode、Component 注册表、数据模型、Toolbar、通讯总线、跨 dock 拖放、明确不做的)已迁至 **[doc/architecture-decisions.md](doc/architecture-decisions.md)**。分层与不变量见 [doc/architecture.md](doc/architecture.md)。

这些是和用户反复讨论后定下的，**不要再改**。如果觉得某条不对，先问用户，不要自作主张。

## 5. 目录与维护规则

目录边界必须表达概念边界:

```text
src/core/          Core primitives, registry, context, settings, commands, workspace
src/tree/          Immutable dock tree pure functions
src/dock/          Dock runtime, render, interactions, drag, migration, layout
src/ui/            Generic UI component library
src/ai/            Optional AI Host
src/extensions/    Optional Extension Runtime + AI bridge
demo/              Host/demo app code, not framework design
```

唯一权威映射:

- 文件职责看 `doc/implementation-map.md`。
- 架构边界看 `doc/architecture.md`。
- AI registry / permission / context 细节看 `doc/ai*.md`。
- Extension 最终语义看 `doc/extensions.md`。
- 构建加载顺序看 `tools/build.mjs` 的 `JS_ORDER` / `CSS_ORDER`。

维护规则:

- 改 `src/` 后必须跑 `node tools/build.mjs`,并提交 `dist/aiditor-core.*` / `dist/aiditor-full.*` / `dist/aiditor.*`。
- 改 `demo/` 不需要 rebuild,但需要 reload demo 验证。
- `src/` 继续保持 IIFE + `window.aiditor` 单命名空间;不写 `import/export`。
- 新 framework 能力必须进正确层:Core/UI、AI Host、Extension Runtime、Demo Runtime 不能互相偷概念。
- Extension contribution 发布 dotted public name,但生命周期 owner 是 `extension:<id>`;卸载/禁用用 owner 精确清理。
- AI Host 的 model-facing 主概念保持 Agent / Skill / Tool / Context Reference / Operation / ChangeSet。Skill 是始终可见、可读取的说明与 Tool 组织单元,没有激活/加载状态;`toolDisclosure: always | onRead` 控制 Tool Schema 是默认投影还是在主 `skill.read` 后投影,resource 读取不投影 Tool。默认目录只含 Skill id、描述和 Tool 数量;仅目录预算发生省略时暴露确定性分页 `skill.list`,没有语义 `skill.search`。请求按 `available(ctx)` 过滤,执行仍按 Tool 名字和参数并再次检查当前可用性,Permission 独立于 Skill。targets、attachments、rich prompt、quests 是 runtime/UX 细节。
- AI Run 默认没有总回合、总 token 或总时长限制;`maxTurns` / `maxTokens` / `timeoutMs` 只来自宿主或委派任务的显式预算,长任务通过 compaction 继续。Tool 参数纠错只在连续纠错链内识别重复失败,合法 Tool 调用必须结束该链,不得跨整个 Run 累计错误后强制终止。
- 所有组件和 toolbar item 引用 component 都只能用已注册 string name。
- CSS 可调常数优先放在 `src/style/theme.css` 的 `--aiditor-*` token;JS 只有需要数值计算时用 `aiditor.ui.readNum(...)`。

## 6. 验证入口

常规门禁:

```powershell
node tools/build.mjs
npm.cmd run check
npm.cmd run check:dist
git diff --check
```

当前 `npm.cmd run check` 覆盖语法检查、signal/tree/theme/history/i18n/settings/commands/workspace、UI scope/edit session、project runtime、ChangeSet、AI provider/retry/stream/tools/workdir/orchestration/quest/structured output/checkpoint/eval/persistence/compaction/target/reference/resource permission、Extension Runtime、rich prompt 等测试。

`git diff --check` 在 Windows 上可能打印 LF/CRLF 替换 warning;只要没有 whitespace error 即可。

## 7. 与用户协作的方式

- 用户用中文,你也用中文回复。
- 用户要求审查时,先讲真实问题,不要为了显得乐观把风险淡化。
- 用户要求按最终形态判断时,不要用“暂时不做”当理由;只判断最终模型是否简洁、优雅、稳定。
- 非平凡改动遵守 design-first:先列模型/API/文件清单,等用户明确说“开始”再改代码。
- 如果文档和代码冲突,先确认是文档落后还是代码没实现;不要盖错方向。
- 有更好的方案要直说,但保持简洁,不要长篇自我解释。
- 新踩的坑要回写到 § 3.3 或对应 `doc/*.md`,不要留在对话里。
