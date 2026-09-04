# Changelog

All notable changes to the MxTechies Draggable widget are documented here.

## [1.0.0] - 2026-09-04

### Added

- First release, built on react-draggable 4.7.
- Axis locking (both, horizontal, vertical, none), drag handle and cancel selectors, and a Disabled expression.
- Bounds: none, parent element, page body, custom CSS selector, or a pixel distance from the start position.
- Grid snapping with separate horizontal and vertical steps.
- Position persistence through Integer, Long or Decimal X and Y attributes. Changing the attributes moves the content.
- On drag start and On drag stop actions. Attributes are written before On drag stop runs.
- "Show position badge" (live x, y pill while dragging) and "Lift while dragging" (hover and drag shadow).
- State classes on the widget root: `mxt-draggable--active`, `mxt-draggable--disabled`, `mxt-draggable--grab`.
