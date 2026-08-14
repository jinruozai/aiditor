// Built-in AI Host UI strings. Locale selection remains host-owned.
;(function (aiditor) {
  'use strict'

  const i18n = aiditor.i18n
  const en = {
    'ai.environment.title': 'Agent environment',
    'ai.environment.aria': 'Agent environment capabilities',
    'ai.environment.workspace_ready': 'Workspace · {label}',
    'ai.environment.workspace_missing': 'Workspace · Not open',
    'ai.environment.git_ready': 'Git · Ready',
    'ai.environment.git_missing': 'Git · Not configured',
    'ai.environment.verify_ready': 'Verify · Ready',
    'ai.environment.verify_missing': 'Verify · Not configured',
    'ai.tool.remember': 'Remember',
    'ai.tool.remember_hint': 'After a successful apply, remember permission for the same tool, target, workspace, and risk scope. Rejecting or failing does not save permission.',
    'ai.tool.reject': 'Reject',
    'ai.tool.apply': 'Apply',
    'ai.tool.reject_all': 'Reject all',
    'ai.tool.apply_all': 'Apply all',
    'ai.tool.pending_actions': '{count} pending actions',
    'ai.tool.apply_all_hint': 'Runs each action independently in order. A failure does not roll back earlier successful actions.',
  }
  const zh = {
    'ai.environment.title': 'Agent 环境',
    'ai.environment.aria': 'Agent 环境能力',
    'ai.environment.workspace_ready': '工作区 · {label}',
    'ai.environment.workspace_missing': '工作区 · 未打开',
    'ai.environment.git_ready': 'Git · 已就绪',
    'ai.environment.git_missing': 'Git · 未配置',
    'ai.environment.verify_ready': '验证 · 已就绪',
    'ai.environment.verify_missing': '验证 · 未配置',
    'ai.tool.remember': '记住',
    'ai.tool.remember_hint': '应用成功后，记住对此类工具、目标、工作区与风险范围的授权。拒绝或执行失败不会保存授权。',
    'ai.tool.reject': '拒绝',
    'ai.tool.apply': '应用',
    'ai.tool.reject_all': '全部拒绝',
    'ai.tool.apply_all': '全部应用',
    'ai.tool.pending_actions': '{count} 个待处理操作',
    'ai.tool.apply_all_hint': '按顺序独立执行；失败不会回滚之前已经成功的操作。',
  }

  i18n.register('en', en)
  i18n.register('zh', zh)
  i18n.register('zh-CN', zh)
})(window.aiditor = window.aiditor || {})
