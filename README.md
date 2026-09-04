# MxTechies Draggable

> MxTechies Draggable turns any Mendix container into draggable content. Place cards, notes, images, panels or small forms inside it and let users move them with the mouse or touch. Lock movement to one axis, start drags from a handle, keep inputs and buttons clickable with a cancel selector, and confine movement to the parent, the page, a custom element, or a fixed distance. Snap to a grid, store the final X and Y in attributes, move content from microflows, and react with drag start and drag stop events.

A Mendix pluggable widget that makes any content draggable with the mouse or touch.
It is a thin wrapper around [react-draggable](https://react-grid-layout.github.io/react-draggable/).

![Dragging a box with the live position badge](docs/dragging.png)

- Mendix 11.0 or newer, web only
- Category: Containers
- License: Apache-2.0

An example module that ports every box from the react-draggable demo page is published separately:
[DraggableDemo](https://github.com/bharathidas/DraggableDemo).

## Installation

Download `com.mxtechies.widget.web.MxTechiesDraggable.mpk` from the
[latest release](https://github.com/bharathidas/MxTechiesDraggable/releases) (or the Mendix Marketplace)
and drop it into the `widgets` folder of your app, then press F4 in Studio Pro.

## Usage

1. Drop **MxTechies Draggable** on a page and place widgets inside it.
2. Optionally bind **X attribute** and **Y attribute** (Integer, Long or Decimal) to remember the position.
   They are written when a drag ends and the content follows them when they change.
3. Add an **On drag stop** action if you want to commit the position or react to the move.

## Properties

| Group | Property | Purpose |
| --- | --- | --- |
| Dragging | Axis | Both, horizontal only, vertical only, or none |
| Dragging | Handle selector | CSS selector of the element that starts the drag, e.g. `.drag-handle` |
| Dragging | Cancel selector | Elements that must not start a drag, e.g. `input, button` |
| Dragging | Disabled | Boolean expression |
| Bounds | Bounds | None, parent element, page body, a custom selector, or a distance from the start position |
| Bounds | Max left / up / right / down | Pixel limits used with "Distance from start", e.g. 100 each = "100px in any direction" |
| Grid snapping | Grid width / height | Snap step in pixels, 0 disables |
| Position | X / Y attribute | Persist and control the offset in pixels |
| Position | Default X / Y | Offset used when no attribute is bound or it is empty |
| Appearance | Width | Fit content (can move sideways in its parent) or full width |
| Appearance | Show position badge | Shows a live "x, y" pill while dragging |
| Appearance | Lift while dragging | Adds a hover shadow and a stronger shadow during the drag |
| Events | On drag start / On drag stop | Actions |

## CSS hooks

The widget root carries these classes so a theme can react to state:

- `mxt-draggable--active` while a drag is in progress (react-draggable also adds `react-draggable-dragging`)
- `mxt-draggable--disabled` when the Disabled expression is true
- `mxt-draggable--grab` when no handle selector is set, i.e. the whole element is the handle

The transform is owned by react-draggable, so animate `box-shadow` or `filter` in your theme, never `transform`.

## Recipes

- **Bounded canvas**: put the widget inside a container with an explicit height and set Bounds to "Parent element".
- **Card with a title bar**: give the title bar a class such as `drag-handle`, set Handle selector to `.drag-handle`.
- **Form inside a draggable panel**: set Cancel selector to `input, textarea, select, button, .btn` so controls stay usable.
- **Move from logic**: bind X and Y attributes and change them in a microflow or nanoflow with "Refresh in client" on.
