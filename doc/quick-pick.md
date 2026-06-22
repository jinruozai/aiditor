# Quick Pick

`aiditor.ui.quickPick` is the generic quick filter picker primitive.

It is used when an editor needs to search a bounded in-memory collection and
choose one item. The item can represent anything owned by the host: a panel
component, command target, schema type, resource descriptor, rule descriptor, or
any other opaque object. AIditor only owns the filtering UI, active-row state,
keyboard interaction, grouping, rendering hooks, and selection callback.

Quick Pick replaces the older searchable menu idea. There should be one public
primitive for "filter a list and pick an item"; menu remains for actions,
select remains for short form value selection, and combobox remains for editable
text with suggestions.

## Boundary

Quick Pick owns:

- anchored popover placement;
- search input state;
- local filtering of the provided item collection;
- active row, hover row, keyboard navigation, and `scrollIntoView`;
- optional group headers;
- disabled row affordance;
- optional custom item rendering;
- calling `onSelect(item, ctx)` when the user chooses an item;
- scoped overlay cleanup through the existing UI overlay system.

Quick Pick does not own:

- project, file, asset, GameData, ref id, command, rule, or engine semantics;
- data mutation;
- form value persistence;
- history, transactions, permissions, or validation;
- remote loading or async search;
- application shortcut policy;
- command palette semantics.

Host code owns item meaning and the effect of selection. If selecting an item
changes application data, the host should route that through its normal command
or history path from `onSelect`.

## API

```js
aiditor.ui.quickPick({
  anchor,        // HTMLElement
  pos,           // optional { x, y } viewport point anchor
  items,         // Array<T> | Signal<Array<T>>

  getKey,        // (item, index) => string
  getLabel,      // (item, index) => string
  getDescription,// optional (item, index) => string | null
  getDetail,     // optional (item, index) => string | null
  getIcon,       // optional (item, index) => string | null
  getSearchText, // optional (item, index) => string | string[]
  getGroup,      // optional (item, index) => string | null
  getDisabled,   // optional (item, index) => boolean
  renderItem,    // optional (item, ctx) => HTMLElement

  selectedKey,   // optional string | Signal<string|null>, visual only
  onSelect,      // (item, ctx) => void | Promise<void>

  placeholder,
  emptyText,
  width,
  maxHeight,
  side,
  align,
})
```

The call returns a small overlay handle:

```js
{
  el,       // popover root element
  close,    // close without choosing
}
```

All item callbacks receive the original item. The framework never clones,
normalizes, or interprets item data beyond the values returned by the accessor
callbacks.

Default accessors:

```text
getKey(item, index)         item.id ?? item.key ?? item.value ?? index
getLabel(item, index)       item.label ?? item.title ?? item.name ?? item.value
getDescription(item, index) item.description ?? item.meta ?? null
getDetail(item, index)      item.detail ?? item.subLabel ?? null
getIcon(item, index)        item.icon ?? null
getSearchText(item, index)  label + description + detail
getGroup(item, index)       item.group ?? null
getDisabled(item, index)    !!item.disabled
```

`getKey` should be provided when the item collection can refresh, reorder, or
contain duplicate labels. Index fallback is only for small static lists.

`selectedKey` is display state only. It marks the matching row as selected but
does not turn Quick Pick into a form input and does not write a value.

## Row Context

`renderItem(item, ctx)` receives:

```js
{
  key,
  label,
  description,
  detail,
  icon,
  group,
  index,
  query,
  active,    // read-only signal<boolean>
  selected,  // read-only signal<boolean>
  disabled,  // read-only signal<boolean>
}
```

`renderItem` renders row content only. Quick Pick still owns the row shell,
hover state, click handling, keyboard active state, ARIA attributes, disabled
behavior, selected classes, and focus management. Custom content must not create
its own selectable row wrapper, attach competing row click handlers, set
`role="option"`, or decide whether a disabled item can be chosen. A custom row
may read `active`, `selected`, and `disabled` to adjust its internal display,
but the framework remains the interaction authority.

The default row uses a fixed information hierarchy:

```text
icon  label        description
      detail
```

`label` is the primary text. `description` is weak same-line metadata, such as a
short id, type, or source. `detail` is weaker second-line context. Missing values
collapse without leaving empty chrome. This keeps default Quick Pick rows
consistent across dock panels, Inspectors, settings, and host pickers.

## Interaction

The search input receives focus when the picker opens.

Keyboard behavior:

```text
ArrowDown  move active row to the next enabled row
ArrowUp    move active row to the previous enabled row
Enter      choose active row when it is enabled
Escape     close without choosing
```

Pointer behavior:

- hovering an enabled row makes it active;
- clicking an enabled row chooses it;
- disabled rows are visible but cannot become active or be chosen;
- group headers are not rows and are skipped by keyboard navigation;
- changing the query resets active row to the first visible item;
- the active row is kept visible with `scrollIntoView({ block: "nearest" })`.

The popover closes after selection. It also closes through the shared overlay
dismiss path, so outside click, owner cleanup, and Escape behave like other
AIditor floating UI.

Selection closes immediately. If `onSelect` returns a Promise, Quick Pick does
not wait for it, does not show progress, and does not reopen on failure. Async
work, errors, command dispatch, and history behavior belong to the host that
provided `onSelect`.

## Filtering

Filtering is local, deterministic, and case-insensitive. The normalized query is
matched against:

```text
getSearchText(item, index)
getLabel(item, index)
getDescription(item, index)
getDetail(item, index)
getGroup(item, index)
```

`getSearchText` may return a string or an array of strings. Arrays are joined
with spaces after nullish entries are removed. This lets callers expose compact
search fields such as `[id, label, path, type]` without building their own join
logic.

Hosts that need custom search ranking should pre-sort or pre-filter `items`
before passing them to Quick Pick, or provide a compact `getSearchText` that
contains the searchable fields. Quick Pick should not grow a fuzzy-search
engine, scoring model, remote loading protocol, or domain-specific matcher.

## Grouping

Grouping is optional. A group header is rendered when adjacent visible rows have
different non-empty group labels. Quick Pick preserves the order of the filtered
items; it does not sort groups by itself. Hosts that want sorted groups should
sort the item collection before passing it in.

This keeps the primitive predictable and avoids hiding host-owned ordering
policy inside the framework.

## Accessibility

Quick Pick follows the editable combobox plus listbox shape:

- DOM focus stays in the search input;
- the search input exposes `role="combobox"`, `aria-expanded`,
  `aria-controls`, and `aria-activedescendant`;
- the list exposes `role="listbox"`;
- selectable rows expose `role="option"` and `aria-selected`;
- disabled rows expose `aria-disabled="true"`;
- group headers are labels, not options.

The visual active row and selected row must remain distinct. Active means the row
under keyboard or pointer focus. Selected means the optional `selectedKey`
matches the row. `Escape` closes the picker without changing host state.

## Reconcile And Performance

Quick Pick is optimized for editor-scale choice lists, not huge data grids.

Expected constraints:

- typical item counts are dozens to hundreds;
- every query recomputes the filtered list in memory;
- DOM rows reconcile by `getKey`;
- unchanged keyed rows keep their DOM when `items` refreshes or the query
  changes without removing that row;
- only rows that enter, leave, or change order are created, moved, or disposed.

The primitive should not rebuild the whole list on every hover or active-row
change. Active and selected state should update row classes/signals in place.

When `items` is a signal and refreshes, the current query is preserved. Active
state is key-based: if the active key still exists in the filtered list and is
enabled, it remains active. If the active item disappears or becomes disabled,
Quick Pick moves to the next enabled row near the previous position; if there is
no later enabled row, it falls back to the first enabled row. If no enabled rows
exist, there is no active row.

Virtualization is not part of this primitive. If a host needs thousands of
rows, it should use `ui.list` or a domain-specific panel surface instead of a
small popover picker.

## Relationship To Nearby Components

Use `aiditor.ui.quickPick` when the user is choosing one object from a
filterable collection.

Use `aiditor.ui.menu` when the user is choosing an action. Menus can contain
submenus, separators, keyboard labels, danger styles, and command-backed items.
They are action surfaces, not object pickers.

Use `aiditor.ui.select` for compact form values with a short option list.
`select` writes a value and belongs inside forms.

Use `aiditor.ui.combobox` when the input text itself is the value and the list is
only a suggestion source. A model-id input that allows arbitrary text is a
combobox; choosing a registered model object from a bounded collection is a
Quick Pick.

Use `aiditor.ui.list`, `tree`, or `table` for persistent panel content.
Quick Pick is an anchored overlay that closes after selection.

## Replacement Rule

There should not be both `searchMenu` and `quickPick` as public primitives.
`searchMenu` expressed the same concept with a narrower menu-shaped data model:

```js
{ label, value, icon, group, onSelect }
```

Final framework shape:

- new code calls `aiditor.ui.quickPick`;
- the dock Add Panel picker uses `quickPick`;
- documentation names only `quickPick`;
- `searchMenu` is removed rather than maintained as a parallel abstraction.

This keeps the concept budget small and prevents future UI code from having to
choose between several similar searchable picker APIs.
