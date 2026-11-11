# Changelog

All notable changes to the MxTechies Draggable widget are documented here.

## [2.0.0] - 2026-11-11

Second public release, after 1.0.0. It brings together everything built since 1.0.0 (the internal builds listed
below) and adds free dragging inside list views.

### Added

-   **Raise list rows** (Appearance, on by default): inside a list view, template grid or gallery, the row of an item
    that is dragged, or rests away from its place, is lifted above the other rows and no longer clipped, so every item
    of a list can be dragged on its own and keep its own position (X and Y attributes on each object). Not used in
    sortable mode. The row's own inline styles are restored when the item is back in place.
-   Everything from the internal builds below: resizing, rotation, z-order, drop zones with previews and accept rules,
    snap guides and equal spacing, collision avoidance, auto-scroll, momentum, motion levels, multi-select and lasso,
    sortable lists, grids and kanban moves between lists, touch long-press, layout snapshots, context menu, undo and
    translatable announcements.

### Upgrading from 1.0.0

-   Pages built with 1.0.0 keep working: every new option is off by default, except Raise list rows, which only acts
    inside list views.
-   A move that cannot be saved is now undone and reported instead of silently lost (see Internal build 2.2.0).

## Development history (internal builds between 1.0.0 and 2.0.0)

These builds were never published; their version numbers were internal.

### Internal build 2.2.0 (2026-10-17)

Benchmarks: interact.js, dnd-kit, SortableJS (all MIT) and the documented canvas interactions of Figma and Miro. No
code was copied and no dependency was added; see COMPETITIVE.md.

#### Added

-   **Multi-select and lasso** (`multiSelect`, `lasso`, `lassoSelector`, `groupName`, `selectedAttribute`,
    `onSelectionChange`): Shift/Ctrl/Cmd+click, Ctrl+Space, Ctrl+A and Escape; a rubber band on the background of the
    lasso area (mouse and pen; Shift/Ctrl add to the selection; a plain click clears it). Dragging a selected item moves
    the whole selection, clamped so every member stays inside its own bounds; arrow keys move all selected items; a
    group move is one undo step; the selection count is announced and selected items describe themselves as selected.
    Selected followers that land on a drop zone run their own On drop when the zone accepts their type.
-   **Sortable list and grid mode** (`sortMode`: list, horizontal, grid; `sortContainerSelector`, `sortCrossContainer`,
    `orderAttribute`, `orderOffset`, `sortTimeout`, `onReorder` with `oldIndex`, `newIndex`, `containerId`,
    `fromContainerId`): animated (FLIP) displacement of the other items, a placeholder at the landing slot, moves
    between lists including empty ones, keyboard reorder (Space lifts, arrows / Home / End move, PageUp / PageDown change
    lists, Space drops, Escape cancels) with translatable announcements, order attributes written for every moved item.
    The new order is held on screen (translates only, the widget never reorders the DOM) until the data source shows it;
    when it does not within the timeout the order is rolled back on screen and in the attributes and a Retry message is
    shown. When item keys are known and the list comes back in the old order, the same message is shown.
-   **Equal spacing hints** (`equalSpacing`): snaps to gaps that already exist in the item's row or column and to the
    middle between its two neighbours, with gap labels; combined with the edge / centre guides and the grid.
-   **Rotation** (`rotatable`, `rotationAttribute`, `rotationStep`, `onRotate`): a rotate handle (24 px target) with
    Shift for steps, `[` / `]` keys (Shift for 1 degree), undo, browser persistence under the Remember in browser key.
-   **Z-order** (`zOrder`, `zIndexAttribute`, `onZOrderChange`): bring forward / send backward / to front / to back with
    Ctrl+] / Ctrl+[ (Shift for front / back) or the item menu; layers of the group are normalised to 1..n; undoable.
-   **Drop previews** (`dropPreview`): a ghost at the real landing spot (grid, snapping, Revert / Nudge, Return if not
    dropped), red when the drop would be refused, and `mxt-drop-zone--invalid` on a rejecting zone under the item
    (pointer and keyboard).
-   **Touch long-press** (`touchDelay`, `hapticFeedback`): the drag starts only after the finger rests; swiping over items
    keeps scrolling the page (`touch-action: manipulation` instead of `none`); vibration where supported; the browser's
    long-press menu is suppressed while arming.
-   **Layout snapshots** (`snapshotsEnabled`, `itemKey`, `snapshotAttribute`, `layoutCommand`, `resetSnapshot`,
    `onSnapshot`): named snapshots of position, size, rotation and z-index per group in a String attribute (versioned
    JSON) or the browser; save / restore / delete / reset from the item menu or the command attribute; a restore is one
    undo step; Home / double-click can reset to a snapshot.
-   **Item menu** (`contextMenu`): right-click, Shift+F10 or the Menu key; WAI-ARIA menu with arrow keys, Home / End,
    type-ahead; offers every action the item supports (sorting moves, z-order, rotation, selection, undo, reset,
    snapshots), so each drag has a single-click alternative.
-   **Reliability**: an error boundary around every item (message + Try again); a busy state (`aria-busy`, a spinner
    after 400 ms) while one of the item's actions runs; failures are rolled back and reported with Retry / Dismiss.
-   40 new translatable text templates; Studio Pro hides the new options until their switch is on and checks the new
    combinations.
-   Tests: unit tests for selection, sortable layout, equal spacing, rotation and z-order, snapshots, the long-press gate
    and performance budgets; 20 new component tests; a new browser suite `harness/test-v22.mjs` (79 checks) next to the
    2.1 suite (26 checks); `npm run sbom` writes a CycloneDX 1.5 SBOM to `dist/2.2.0/sbom.cdx.json`.

#### Performance (jest, Node 22, per call, laptop; budgets in `src/utils/__tests__/perf.spec.ts`)

| Work per pointer move | Measured | Budget |
| --- | --- | --- |
| Edge / centre snap against 1,000 siblings | 2.1 ms (was 8.9 ms in 2.1) | 8 ms |
| Equal spacing among 1,000 siblings | 0.12 ms | 8 ms |
| Lasso hit test, 10,000 items | 0.09 ms | 10 ms |
| Sortable list slots, 10,000 items | 0.29 ms | 15 ms |
| Sortable target index, list / grid, 10,000 items | 0.12 / 0.09 ms | 5 / 8 ms |
| Z-order change, 10,000 items | 2.0 ms | 40 ms |
| Collision nudge, 200 obstacles | 1.4 ms | 250 ms |
| Snapshot save / parse, 10,000 items | 15 / 16 ms | 150 ms |

Memory: 200 mount/unmount cycles of a page with every 2.2 feature on leave the registry, held orders and lasso
controllers at the mounted counts and the JS heap unchanged (9.5 MB before and after, harness check with forced GC).

#### Changed

-   The edge / centre snapping (2.0) is now allocation-free: same results, about 4x faster with many siblings.
-   Rotatable items wrap their content in `mxt-draggable__body`, which carries the rotation (the CSS `rotate` property is
    applied before `transform`, so rotating the outer element would also turn its position). Items without Rotatable
    keep the 2.1 DOM.
-   The package description and Studio Pro description mention the new features.

#### Fixed

-   A move on a page whose X / Y attribute is read-only was shown but never saved (silent data loss). It is now undone
    and reported with a Retry button. The new rotation, z-index, order and snapshot attributes behave the same way.

#### Upgrading

-   Replace the .mpk and press F4 (or run `mx update-widgets`). Every new property defaults to off / the 2.1 behaviour.
-   The only behaviour change on existing pages: a move whose X or Y attribute cannot be written (read-only attribute,
    for example a non-editable data view) now springs back and shows "This change could not be saved, so it was
    undone." with Retry, instead of staying where it was dropped without being saved. Make the attribute editable, or
    leave the attributes empty and use Remember in browser / On position change.
-   Text template defaults of the 40 new texts are English; add translations in Studio Pro.

#### Known limitations

-   Sortable mode moves one item at a time (no multi-item sorting), does not combine with resizing or rotation, and a
    reorder is not part of the Ctrl+Z history (it is saved through the data source; undo it there).
-   The sortable mode needs the list to re-render in the new order (sort on the order attribute and refresh, or
    On reorder that commits and refreshes); without On reorder the new order is held on screen without a timeout.
-   Lasso selection is mouse / pen only (a finger on the background scrolls the page). Hit testing, snapping and
    collision use the unrotated layout box of rotated items.
-   Touch long-press hands over to the drag by re-dispatching the touch; browsers without the `TouchEvent` constructor
    skip the delay hand-over (the item then does not drag after the long-press). Chrome, Edge and Android are fine;
    iOS Safari was not tested.
-   Drop preview ghosts and sortable placeholders are measured at drag start; if the page scrolls during the drag
    (auto-scroll) they are off by the scrolled distance.
-   Cross-browser: the browser suites ran in Chrome only (Playwright browsers are not installed; nothing was downloaded).

### Internal build 2.1.0 (2026-10-09)

#### Added

-   **Resizing** (`resizable`): right, bottom and corner handles plus Alt + arrow keys; `minWidth`, `minHeight`,
    `maxWidth`, `maxHeight`, `keepAspectRatio`, grid steps and the bounds element limit the size. Optional
    `widthAttribute` / `heightAttribute`, browser persistence under the Remember in browser key, and `onResize` with the
    variables `width` and `height`. A size badge shows with Show position badge.
-   **Drop zone accept rules**: `dragType` expression and `data-accept` on zones; rejected zones get
    `mxt-drop-zone--rejected`, ignore drops and are announced.
-   **Overlap avoidance** (`collision`: none, revert, nudge) against the other draggables in the container.
-   **Auto-scroll** (`autoScroll`) near the edge of the page or the nearest scrollable container.
-   **Undo** (`undoEnabled`, Ctrl+Z) and **reset** (`resetEnabled`, Home or double-click).
-   **On position change** (`onPositionChange`, variables `x` and `y`) after every committed move.
-   **Motion** (`motion`: full, subtle, off) on top of Animate.
-   Translatable screen reader announcements (14 text templates under Texts).
-   Studio Pro: new options hidden until relevant; checks for min above max sizes and a single size attribute.
-   Tests: unit tests for resizing, limits, collision (revert, nudge, axes, limits), accept rules, auto-scroll speed,
    history and keyboard resize, component tests for undo, reset, resize, size persistence, accept rules, texts and
    motion classes; a browser harness (`npm run harness`, 26 checks); a licence check (`npm run licenses`) and
    THIRD-PARTY-LICENSES.md.

#### Changed

-   TypeScript `importHelpers` is off, so no helper library can be bundled. typescript 5.9.3 is pinned as a direct dev
    dependency.
-   Licence review: react-draggable 4.7.1 and everything it pulls in (clsx, prop-types, react-is, object-assign) are
    MIT, so react-draggable stays.

### Internal build 2.0.0 (2026-10-07)

#### Added

-   **Drop zones**: `Drop zone selector` (e.g. `.drop-zone`) and an **On drop** action with the action variables
    `targetId` (String), `x` and `y` (Integer, the content's top-left corner relative to the zone). The target id is
    read from `data-drop-id`, then a class starting with `Zone id class prefix` (`zone-backlog` gives `backlog`), then
    the `id` attribute, then the `mx-name-` class. While dragging, every zone gets `mxt-drop-zone--armed` and the zone
    under the pointer gets `mxt-drop-zone--over`; nested zones resolve to the smallest one. A click without movement is
    never a drop.
-   **Return if not dropped**: content released outside every zone springs back to where the drag started.
-   **Snap to siblings**: pink alignment guides and snapping to the edges and centres of other draggables in the same
    container (and to the bounds element) within `Snap distance`.
-   **Momentum**: quick releases keep gliding with exponential decay, stay inside the bounds and land on the grid.
-   **Keyboard dragging and accessibility**: the widget is focusable; arrow keys move one grid step (or `Keyboard step`
    pixels), Shift moves ten; Enter or Space picks up and drops onto the zone under the widget's centre; Escape cancels.
    `role="group"`, `aria-roledescription="draggable"`, `aria-grabbed`, `aria-describedby` instructions (configurable
    text) and a polite live region announcing pick-up, moves, zones and drops. Visible `:focus-visible` ring.
-   **Remember in browser (key)**: optional local storage persistence for pages without X and Y attributes. Bound
    attributes always win.
-   **Animate** (on by default): a subtle tilt in the drag direction, a spring glide between grid and keyboard steps, a
    spring return, a decay curve for throws, a small squeeze over a drop zone, a zone flash and a ripple at the drop
    point. All of it is off when the user prefers reduced motion.
-   New state classes: `mxt-draggable--animated`, `--grabbed`, `--glide`, `--settling`, `--over-zone`, `--keyboard`.
-   Unit tests (`npm test`) for hit testing, target ids, snapping, momentum decay, springs, keyboard moves, persistence,
    and the widget's keyboard and mouse behaviour.

#### Changed

-   The widget is now a tab stop by default. Turn off **Keyboard dragging** for the 1.0 behaviour.
-   Keyboard moves write the X and Y attributes and run On drag start / On drag stop like a mouse drag. A burst of arrow
    presses outside a pick-up runs On drag stop once, 450 ms after the last press.
-   Following external attribute changes no longer uses an effect, so there is no extra render on mount.

## [1.0.0] - 2026-09-04

### Added

-   First release, built on react-draggable 4.7.
-   Axis locking (both, horizontal, vertical, none), drag handle and cancel selectors, and a Disabled expression.
-   Bounds: none, parent element, page body, custom CSS selector, or a pixel distance from the start position.
-   Grid snapping with separate horizontal and vertical steps.
-   Position persistence through Integer, Long or Decimal X and Y attributes. Changing the attributes moves the content.
-   On drag start and On drag stop actions. Attributes are written before On drag stop runs.
-   "Show position badge" (live x, y pill while dragging) and "Lift while dragging" (hover and drag shadow).
-   State classes on the widget root: `mxt-draggable--active`, `mxt-draggable--disabled`, `mxt-draggable--grab`.
