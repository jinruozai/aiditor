// aiditor single-file bundler.
//
// The framework stays zero-build for consumers, so this is not a build tool in
// the webpack sense: it is `cat` with banners. Source files are IIFEs already;
// we concatenate them in dependency order into dist/aiditor-core.* and
// dist/aiditor-full.*. dist/aiditor.* is the Core/UI alias. The output is
// committed so consumers, including our own demo, can double-click index.html
// and have it work without ever running node.
//
// Usage:
//   node tools/build.mjs            one-shot build
//   node tools/build.mjs --watch    rebuild on file change (100ms debounce)

import { readFileSync, writeFileSync, mkdirSync, watch } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateApiDocs } from './api-docs.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC  = join(ROOT, 'src')
const DIST = join(ROOT, 'dist')

// load order
// Must match classic <script> dependency order. This array is the source of
// truth for the full bundle. The core bundle is derived by excluding optional
// AI Host and Extension Runtime files.

const JS_ORDER = [
  // Layer 0 - reactivity & log
  'core/signal.js',
  'core/log.js',
  'core/names.js',
  'core/runtime.js',
  'core/theme.js',
  'core/bus.js',
  'core/shortcuts.js',
  'core/history.js',
  'core/i18n.js',
  'core/settings.js',
  'core/commands.js',
  'core/workspace.js',

  // Layer 1 - tree (pure data)
  'tree/tree.js',

  // Layer 2 - registry & component context
  'core/registry.js',
  'core/context.js',

  // Layer 2.5 - AI session/agent runtime (no UI dependency)
  'ai/name-generator.js',
  'ai/serialize.js',
  'ai/trace.js',
  'ai/context-pack.js',
  'ai/permission.js',
  'ai/store.js',
  'ai/memory.js',
  'ai/compaction.js',
  'ai/connection.js',
  'ai/adapter.js',
  'ai/provider.js',
  'ai/provider-auth.js',
  'ai/provider-transports.js',
  'ai/provider-connections.js',
  'ai/registries.js',
  'ai/context.js',
  'ai/skills.js',
  'ai/workdir.js',
  'ai/code.js',
  'ai/git.js',
  'ai/verify.js',
  'ai/reference.js',
  'ai/api-docs.generated.js',
  'ai/api-reference.js',
  'ai/skill-reference.js',

  // Layer 2.6 - optional extension runtime
  'extensions/manifest.js',
  'extensions/install.js',
  'extensions/runtime.js',
  'extensions/ai.js',

  // Layer 2.7 - AI review, targets, request assembly, and runtime
  'ai/change-set.js',
  'ai/target.js',
  'ai/rich-prompt.js',
  'ai/orchestration.js',
  'ai/request.js',
  'ai/runtime.js',

  // Layer 3 - dock runtime
  'dock/runtime.js',
  'dock/menu.js',
  'dock/render.js',
  'dock/interactions.js',
  'dock/panel-drag.js',
  'dock/migrate.js',
  'dock/layout.js',

  // Layer 5 - UI library internals
  'ui/_internal/_css.js',
  'ui/_internal/_portal.js',
  'ui/_internal/_floating.js',
  'ui/_internal/_drag.js',
  'ui/_internal/_signal.js',
  'ui/_internal/_edit-session.js',
  'ui/_internal/_scope.js',
  'ui/_internal/_box-style.js',
  'ui/_internal/_text-style.js',
  'ui/_internal/_render-tree.js',
  'ui/_internal/_overlay.js',
  'ui/_internal/_dnd.js',

  // Layer 6 - UI library: base
  'ui/base/icon-set.js',
  'ui/base/icon.js',
  'ui/base/image.js',
  'ui/base/button.js',
  'ui/base/iconButton.js',
  'ui/base/actionMenu.js',
  'ui/base/actionBar.js',
  'ui/base/stateButton.js',
  'ui/base/copyButton.js',
  'ui/base/tooltip.js',
  'ui/base/popover.js',
  'ui/base/kbd.js',
  'ui/base/badge.js',
  'ui/base/tag.js',
  'ui/base/spinner.js',
  'ui/base/divider.js',
  'ui/base/text.js',

  // Layer 7 - UI library: form
  'ui/form/input.js',
  'ui/form/searchInput.js',
  'ui/form/textarea.js',
  'ui/form/numberInput.js',
  'ui/form/vectorInput.js',
  'ui/form/slider.js',
  'ui/form/rangeSlider.js',
  'ui/form/checkbox.js',
  'ui/form/switch.js',
  'ui/form/radio.js',
  'ui/form/segmented.js',
  'ui/form/select.js',
  'ui/form/combobox.js',
  'ui/form/colorInput.js',
  'ui/form/dateInput.js',
  'ui/form/enumInput.js',
  'ui/form/tagInput.js',
  'ui/form/tab.js',
  // TypeConfig + schema-driven property editing depends on the form widgets
  // above; it dispatches to them. Keep at the end of the form layer.
  'ui/form/typeconfig.js',
  'ui/form/schema.js',
  'ui/form/structInput.js',
  'ui/form/dictInput.js',
  'ui/form/arrayEditor.js',
  'ui/form/arrayInput.js',
  'ui/form/editorFor.js',
  'ui/form/propertyForm.js',
  'ui/form/propertyList.js',
  'ui/inspector.js',

  // Layer 8 - UI library: editor specials
  'ui/editor/gradientInput.js',
  'ui/editor/curveInput.js',
  'ui/editor/codeInput.js',
  'ui/editor/pathInput.js',
  'ui/editor/fileInput.js',
  'ui/editor/filePathInput.js',

  // Layer 9 - UI library: containers
  'ui/container/section.js',
  'ui/container/propRow.js',
  'ui/container/card.js',
  'ui/container/view.js',
  'ui/container/scrollArea.js',
  'ui/container/tabPanel.js',
  'ui/container/_layout-rect.js',
  'ui/container/absolute.js',
  'ui/container/vbox.js',
  'ui/editor/anchorPicker.js',

  // Layer 10 - UI library: data
  'ui/data/list.js',
  'ui/data/gridSelection.js',
  'ui/data/tree.js',
  'ui/data/tree-dnd.js',
  'ui/data/table.js',
  'ui/data/breadcrumbs.js',
  'ui/data/progressBar.js',
  'ui/data/assetBrowser.js',
  'ui/data/changeReview.js',

  // Layer 11 - UI library: overlays
  'ui/overlay/menu.js',
  'ui/overlay/quickPick.js',
  'ui/overlay/modal.js',
  'ui/overlay/drawer.js',
  'ui/overlay/banner.js',
  'ui/overlay/toast.js',
  'ui/overlay/dialogs.js',

  // Layer 12 - built-in panel components
  'ai/message-markdown.js',
  'ai/message-renderers.js',
  'ai/panels/agents.js',
  'ai/panels/rich-prompt-input.js',
  'ai/panels/chat.js',
  'ai/panels/message-live-strip.js',
  'ai/panels/message-virtualizer.js',
  'ai/panels/transcript.js',
  'ai/panels/chat-combined.js',
  'ui/panel/settings.js',
  'ai/panels/settings-ai.js',
  'style/theme-settings.js',
  'ui/panel/panel-list.js',
  'ui/panel/inspector.js',
  'ui/panel/dock-tabs.js',
  'ui/panel/history.js',
  'ui/panel/log.js',

  // Layer 13 - palette metadata for built-in ui.* components. Must come last.
  'ui/_internal/_register-builtins.js',
]

const CSS_ORDER = [
  'style/theme.css',
  'style/themes/dark.css',
  'style/themes/dracula.css',
  'style/themes/harbor.css',
  'style/themes/linen.css',
  'style/themes/sakura.css',
  'style/themes/abyss.css',
  'style/themes/hadal.css',
  'style/themes/forest.css',
  'style/themes/neon.css',
  'style/themes/light.css',
  'style/dock.css',
  'style/component.css',
  'style/ui-base.css',
  'style/ui-form.css',
  'style/ui-editor.css',
  'style/ui-container.css',
  'style/ui-data.css',
  'style/ui-overlay.css',
  'style/ui-ai.css',
  'style/ui-settings.css',
]

function isCoreJs(rel) {
  return rel.indexOf('ai/') !== 0 && rel.indexOf('extensions/') !== 0
}

function isKernelJs(rel) {
  return rel.indexOf('core/') === 0 || rel.indexOf('tree/') === 0 || rel.indexOf('dock/') === 0
}

function isUiJs(rel) {
  return rel.indexOf('ui/') === 0 || rel === 'style/theme-settings.js'
}

function isAiJs(rel) {
  return rel.indexOf('ai/') === 0 || rel.indexOf('extensions/') === 0
}

function isCoreCss(rel) {
  return rel !== 'style/ui-ai.css'
}

function isKernelCss(rel) {
  return rel === 'style/theme.css' || rel.indexOf('style/themes/') === 0 || rel === 'style/dock.css' || rel === 'style/component.css'
}

function isUiCss(rel) {
  return !isKernelCss(rel) && rel !== 'style/ui-ai.css'
}

function isAiCss(rel) {
  return rel === 'style/ui-ai.css'
}

const KERNEL_JS_ORDER = JS_ORDER.filter(isKernelJs)
const UI_JS_ORDER = JS_ORDER.filter(isUiJs)
const AI_JS_ORDER = JS_ORDER.filter(isAiJs)
const CORE_JS_ORDER = JS_ORDER.filter(isCoreJs)
const KERNEL_CSS_ORDER = CSS_ORDER.filter(isKernelCss)
const UI_CSS_ORDER = CSS_ORDER.filter(isUiCss)
const AI_CSS_ORDER = CSS_ORDER.filter(isAiCss)
const CORE_CSS_ORDER = CSS_ORDER.filter(isCoreCss)

function readOptional(path) {
  try { return readFileSync(path, 'utf8') }
  catch (e) { if (e.code === 'ENOENT') return null; throw e }
}

function bundle(order, kind) {
  const parts = []
  const missing = []
  for (const rel of order) {
    const abs = join(SRC, rel)
    const txt = readOptional(abs)
    if (txt == null) { missing.push(rel); continue }
    parts.push('/* ---- ' + rel + ' ---- */\n' + txt.replace(/\s+$/, '') + '\n')
  }
  const banner =
    '/* aiditor bundled ' + kind + '\n' +
    ' * Generated by tools/build.mjs from src/. Do not edit by hand.\n' +
    ' * Sources: ' + (order.length - missing.length) + ' files concatenated in dependency order.\n' +
    ' */\n\n'
  return { text: banner + parts.join('\n'), missing }
}

function buildOnce() {
  mkdirSync(DIST, { recursive: true })
  const apiDocs = generateApiDocs()
  const kernelJs  = bundle(KERNEL_JS_ORDER, 'Kernel JS')
  const kernelCss = bundle(KERNEL_CSS_ORDER, 'Kernel CSS')
  const uiJs      = bundle(UI_JS_ORDER, 'UI JS')
  const uiCss     = bundle(UI_CSS_ORDER, 'UI CSS')
  const aiJs      = bundle(AI_JS_ORDER, 'AI JS')
  const aiCss     = bundle(AI_CSS_ORDER, 'AI CSS')
  const coreJs  = bundle(CORE_JS_ORDER, 'Core JS')
  const coreCss = bundle(CORE_CSS_ORDER, 'Core CSS')
  const fullJs  = bundle(JS_ORDER, 'Full JS')
  const fullCss = bundle(CSS_ORDER, 'Full CSS')
  writeFileSync(join(DIST, 'aiditor-kernel.js'), kernelJs.text)
  writeFileSync(join(DIST, 'aiditor-kernel.css'), kernelCss.text)
  writeFileSync(join(DIST, 'aiditor-ui.js'), uiJs.text)
  writeFileSync(join(DIST, 'aiditor-ui.css'), uiCss.text)
  writeFileSync(join(DIST, 'aiditor-ai.js'), aiJs.text)
  writeFileSync(join(DIST, 'aiditor-ai.css'), aiCss.text)
  writeFileSync(join(DIST, 'aiditor-core.js'), coreJs.text)
  writeFileSync(join(DIST, 'aiditor-core.css'), coreCss.text)
  writeFileSync(join(DIST, 'aiditor-full.js'), fullJs.text)
  writeFileSync(join(DIST, 'aiditor-full.css'), fullCss.text)
  writeFileSync(join(DIST, 'aiditor.js'), coreJs.text)
  writeFileSync(join(DIST, 'aiditor.css'), coreCss.text)
  const stamp = new Date().toLocaleTimeString()
  console.log('[' + stamp + '] built dist/aiditor-kernel.js (' + kernelJs.text.length + ' bytes, ' +
              (KERNEL_JS_ORDER.length - kernelJs.missing.length) + '/' + KERNEL_JS_ORDER.length + ' files), ' +
              'dist/aiditor-kernel.css (' + kernelCss.text.length + ' bytes, ' +
              (KERNEL_CSS_ORDER.length - kernelCss.missing.length) + '/' + KERNEL_CSS_ORDER.length + ' files)')
  console.log('[' + stamp + '] built dist/aiditor-ui.js (' + uiJs.text.length + ' bytes, ' +
              (UI_JS_ORDER.length - uiJs.missing.length) + '/' + UI_JS_ORDER.length + ' files), ' +
              'dist/aiditor-ui.css (' + uiCss.text.length + ' bytes, ' +
              (UI_CSS_ORDER.length - uiCss.missing.length) + '/' + UI_CSS_ORDER.length + ' files)')
  console.log('[' + stamp + '] built dist/aiditor-ai.js (' + aiJs.text.length + ' bytes, ' +
              (AI_JS_ORDER.length - aiJs.missing.length) + '/' + AI_JS_ORDER.length + ' files), ' +
              'dist/aiditor-ai.css (' + aiCss.text.length + ' bytes, ' +
              (AI_CSS_ORDER.length - aiCss.missing.length) + '/' + AI_CSS_ORDER.length + ' files)')
  console.log('[' + stamp + '] built dist/aiditor-core.js (' + coreJs.text.length + ' bytes, ' +
              (CORE_JS_ORDER.length - coreJs.missing.length) + '/' + CORE_JS_ORDER.length + ' files), ' +
              'dist/aiditor-core.css (' + coreCss.text.length + ' bytes, ' +
              (CORE_CSS_ORDER.length - coreCss.missing.length) + '/' + CORE_CSS_ORDER.length + ' files)')
  console.log('[' + stamp + '] built dist/aiditor-full.js (' + fullJs.text.length + ' bytes, ' +
              (JS_ORDER.length - fullJs.missing.length) + '/' + JS_ORDER.length + ' files), ' +
              'dist/aiditor-full.css (' + fullCss.text.length + ' bytes, ' +
              (CSS_ORDER.length - fullCss.missing.length) + '/' + CSS_ORDER.length + ' files)')
  console.log('[' + stamp + '] generated dist/aiditor-api.json (' + apiDocs.entries.length + ' entries)')
  if (kernelJs.missing.length || kernelCss.missing.length || uiJs.missing.length || uiCss.missing.length ||
      aiJs.missing.length || aiCss.missing.length || coreJs.missing.length || coreCss.missing.length ||
      fullJs.missing.length || fullCss.missing.length) {
    const all = kernelJs.missing.concat(kernelCss.missing, uiJs.missing, uiCss.missing, aiJs.missing, aiCss.missing, coreJs.missing, coreCss.missing, fullJs.missing, fullCss.missing)
    console.log('  - skipped (not yet created): ' + all.join(', '))
  }
}

function watchMode() {
  buildOnce()
  let timer = null
  const debounced = () => { clearTimeout(timer); timer = setTimeout(buildOnce, 100) }
  watch(SRC, { recursive: true }, (event, file) => {
    if (!file) return
    if (file.endsWith('.js') || file.endsWith('.css')) {
      console.log('  - changed: ' + relative(ROOT, join(SRC, file)))
      debounced()
    }
  })
  console.log('[watch] watching src/ for .js / .css changes (Ctrl+C to stop)')
}

if (process.argv.includes('--watch') || process.argv.includes('-w')) watchMode()
else buildOnce()
