# AI Message Rendering

AIditor AI messages are rendered through normalized message parts.

The goal is to let the transcript display mainstream model output shapes without
binding the UI to one provider, one project, or one domain object.

## Boundary

Framework responsibilities:

- normalize common provider content blocks into AIditor message parts;
- render ordinary model text as a safe Markdown document;
- render generic parts such as text, code, image, audio, video, file,
  references, attachments, errors, and fallback cards;
- provide a renderer registry for host extensions;
- provide copy text for the same parts shown in the transcript;
- keep transcript virtualization, message shell, footer, status, and tool
  action lifecycle in the built-in AI panel.

Host/project responsibilities:

- register renderer extensions for domain card kinds;
- resolve project-specific URLs into displayable URLs when needed;
- keep domain mutations in commands/tools/operations, not in renderers.

Message renderers are display adapters. They must not mutate agent state,
workspace files, project data, or history.

The pipeline has two complementary paths:

```text
ordinary model text -> safe Markdown renderer
provider/tool/host structured content -> normalized part -> renderer registry
```

Markdown is the portable model-facing presentation format. Structured parts are
the trusted runtime protocol for media, files, tools, and host-defined cards.
They are not competing representations.

## Message Parts

Internal shape:

```js
{ type: 'text', text }
{ type: 'reasoning', text, collapsed: true }
{ type: 'code', lang, text }
{ type: 'json', value }
{ type: 'image', src, mime, title, alt }
{ type: 'audio', src, mime, title }
{ type: 'video', src, mime, title }
{ type: 'file', src, mime, title, size }
{ type: 'tool-call', call }
{ type: 'tool-result', result }
{ type: 'context-ref', id, uri, kind, title }
{ type: 'attachment', id, uri, mime, title, size }
{ type: 'error', error }
{ type: 'card', kind, title, subtitle, data }
```

Provider adapters may keep using provider-native content blocks at the edge, but
the runtime UI consumes normalized parts. For example:

```text
OpenAI text/image blocks
Anthropic text/image/tool blocks
Gemini text/media parts
MCP resources and tool results
```

all normalize into the same part list.

Text normalization preserves one provider text block as one complete Markdown
document. It does not split paragraphs or fenced code during provider
normalization; block parsing belongs to the text renderer.

## Model Text

The built-in text renderer supports a compact CommonMark/GFM-oriented subset:

- headings and paragraphs;
- ordered, unordered, nested, and task lists;
- block quotes and horizontal rules;
- strong, emphasis, strikethrough, inline code, links, and autolinks;
- fenced code with language labels and copy actions;
- tables;
- Markdown images with lazy loading and image preview.

Raw HTML is always rendered as text. Link and image destinations reject unsafe
schemes. Data images are limited to common raster formats. Rendering never uses
model-provided `innerHTML`.

Plain streaming text keeps both its Markdown root and text node connected while
content grows. Rich Markdown keeps the root connected and rebuilds only that
text part's descendants. Transcript rows, tool cards, sibling parts, and other
messages are not remounted.

Reasoning follows the same rule. `collapsed` defines only its initial state; the
mounted `details` element is patched in place while reasoning grows. The
transcript keeps disclosure state locally across virtualized row remounts, so
opening Thinking never mutates the Agent message or interrupts streaming.

The renderer deliberately does not infer UI from arbitrary JSON or code fences.
For example, a model response containing a JSON object with `type: "card"`
remains a code block. A card must arrive as a normalized structured part from a
provider adapter, tool result adapter, or host message:

```js
{
  parts: [{
    type: 'card',
    kind: 'game.item',
    data: { id: 'sword_1', name: 'Iron Sword' },
  }],
}
```

This prevents accidental JSON from becoming interactive UI and keeps model text
portable across providers.

## Built-In Renderers

The framework provides default renderers for:

- `text`
- `reasoning`
- `code`
- `json`
- `image`
- `audio`
- `video`
- `file`
- `context-ref`
- `attachment`
- `error`
- `card`

The built-in `card` renderer is a fallback. It shows title, subtitle, and compact
data. Domain-specific card kinds should register their own renderer.

Tool calls keep their specialized transcript UI because they contain permission,
preview, apply, reject, and resume behavior. They still participate in normalized
message copy text so copying a message includes tool call args/results/errors.

## API

```js
aiditor.ai.messageParts(message)
aiditor.ai.messageCopyText(message, ctx)

aiditor.ai.messageMarkdown.render(text)
aiditor.ai.messageMarkdown.patch(root, text)

aiditor.ai.messageRenderers.register(id, renderer, options)
aiditor.ai.messageRenderers.unregister(id)
aiditor.ai.messageRenderers.unregisterOwner(owner)
aiditor.ai.messageRenderers.list()
aiditor.ai.messageRenderers.normalizeParts(message, options)
aiditor.ai.messageRenderers.renderPart(part, ctx)
aiditor.ai.messageRenderers.renderParts(parent, message, ctx)
aiditor.ai.messageRenderers.copyPart(part, ctx)
aiditor.ai.messageRenderers.copyMessage(message, ctx)
```

Renderer shape:

```js
aiditor.ai.messageRenderers.register('game.item', {
  match(part, ctx) {
    return part.type === 'card' && part.kind === 'game.item'
  },
  render(part, ctx) {
    return renderGameItemCard(part.data)
  },
  copyText(part, ctx) {
    return part.data.name
  },
}, { owner: 'game-aiditor' })
```

`render()` returns an HTMLElement. It renders only the part body. The transcript
still owns the message row, status, footer, scrolling, selection, virtualization,
and cleanup.

`copyText()` should return the user-facing documentation form for the same
content. This keeps message copy aligned with what the user saw.

## Images And Media

Images are first-class generic parts:

```js
{ type: 'image', src: 'blob:...', mime: 'image/png', title: 'generated.png' }
```

Generated images from future models, remote image URLs, data URLs, workspace
object URLs, and image attachments can all display through the same renderer.
Provider-native image blocks, OpenAI image generation results, Anthropic/MCP
base64 image blocks, and Gemini inline data normalize into the same image part.
Standard Markdown images in ordinary model text are also rendered.

The framework renders thumbnails and opens a larger preview. It does not own
project path semantics. If a part uses a project-specific URI such as
`project://logo.png`, the provider adapter or host resolver should turn it into
a displayable URL or attachment before it reaches the generic image renderer.

## Invariants

1. Provider switching should not require transcript UI changes.
2. Project-specific cards are registered by `kind`, not hard-coded in AIditor.
3. Renderers are display-only.
4. Copy text uses the same normalized parts as visual rendering.
5. Unknown structured data falls back to JSON or a generic card.
6. Tool action behavior stays in the AI runtime, not in custom message cards.
7. Raw HTML and arbitrary JSON never become executable UI.
8. Streaming updates preserve the mounted message part root.
