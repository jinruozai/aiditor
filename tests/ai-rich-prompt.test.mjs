import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

global.window = { aiditor: {} }
vm.runInThisContext(readFileSync('src/ai/context/rich-prompt.js', 'utf8'), { filename: 'ai/context/rich-prompt.js' })

const rich = window.aiditor.ai.richPrompt

let draft = rich.empty()
draft = rich.insertText(draft, 0, 'Compare ')
draft = rich.insertRef(draft, draft.text.length, {
  id: 'att_icon',
  title: 'icon.png',
  kind: 'file.image',
  uri: 'file://upload/icon.png',
})
draft = rich.insertText(draft, draft.text.length, ' with ')
draft = rich.insertRef(draft, draft.text.length, {
  id: 'att_icon_2',
  title: 'icon2.png',
  kind: 'file.image',
})

assert.equal(draft.text.length, 'Compare '.length + 1 + ' with '.length + 1)
const firstToken = draft.text['Compare '.length]
assert.deepEqual(rich.refs(draft), ['att_icon', 'att_icon_2'])
assert.equal(rich.toPlainText(draft), 'Compare [icon.png] with [icon2.png]')
assert.equal(rich.toModelText(draft), 'Compare [icon.png](ref:att_icon) with [icon2.png](ref:att_icon_2)')
assert.equal(draft.tokens[firstToken].refId, 'att_icon')
assert.equal('resourceId' in draft.tokens[firstToken], false)

const withoutFirst = rich.deleteRange(draft, 'Compare '.length, 'Compare '.length + 1)
assert.equal(withoutFirst.tokens[firstToken], undefined)
assert.deepEqual(rich.refs(withoutFirst), ['att_icon_2'])

const sliced = rich.slice(draft, 'Compare '.length, draft.text.length)
assert.equal(rich.toPlainText(sliced), '[icon.png] with [icon2.png]')
assert.deepEqual(rich.refs(sliced), ['att_icon', 'att_icon_2'])

const inserted = rich.insertDraft(rich.insertText(rich.empty(), 0, 'Use '), 4, sliced)
assert.equal(rich.toPlainText(inserted), 'Use [icon.png] with [icon2.png]')
assert.deepEqual(rich.refs(inserted), ['att_icon', 'att_icon_2'])

const targetWithToken = rich.insertRef(rich.insertText(rich.empty(), 0, 'Keep '), 5, {
  id: 'att_keep',
  title: 'keep.png',
})
const merged = rich.insertDraft(targetWithToken, targetWithToken.text.length, sliced)
assert.equal(rich.toPlainText(merged), 'Keep [keep.png][icon.png] with [icon2.png]')
assert.deepEqual(rich.refs(merged), ['att_keep', 'att_icon', 'att_icon_2'])

const orphan = rich.normalize({
  text: 'A' + firstToken + 'B',
  tokens: {},
})
assert.equal(orphan.text, 'AB')

const content = rich.content(draft)
assert.equal(content.type, 'rich-prompt')
assert.equal(content.renderedText, rich.toModelText(draft))
assert.deepEqual(rich.fromContent(content), draft)

let skillDraft = rich.insertSkill(rich.empty(), 0, {
  id: 'review.code',
  title: 'Code Review',
})
skillDraft = rich.insertText(skillDraft, skillDraft.text.length, ' inspect this change')
assert.deepEqual(rich.skills(skillDraft), ['review.code'])
assert.deepEqual(rich.refs(skillDraft), [])
assert.equal(rich.toPlainText(skillDraft), '/review.code inspect this change')
assert.equal(rich.toModelText(skillDraft), '[Skill: Code Review] inspect this change')
assert.equal(rich.isEmpty(rich.insertSkill(rich.empty(), 0, { id: 'review.code' })), false)
const copiedSkill = rich.insertDraft(rich.empty(), 0, skillDraft)
assert.deepEqual(rich.skills(copiedSkill), ['review.code'])

console.log('ai rich prompt tests ok')
