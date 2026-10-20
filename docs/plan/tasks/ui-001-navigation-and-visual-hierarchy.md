---
id: ui-001
scope: web-navigation-and-visual-hierarchy
depends_on: [web-001, setup-001]
status: done
---

# ui-001: Header navigation, non-gated model setup, and one visual system

## Objective

Give the Web UI a single navigation model and one visual language. The header becomes the only entry point for the three top-level views (upload / library / model configuration), model configuration stops gating startup, and the review console stops looking like a separate product.

## Context

The previous UI had three problems that all showed up as "ugly":

- `body.model-setup-open .topbar-inner { grid-template-columns: 1fr; }` squeezed three header children into three rows, so the sticky header grew tall and clipped the page title underneath it.
- The header carried a hardcoded `case-strip` (Case / Runtime / Review mode) whose values were static and unrelated to the app state.
- Model configuration was a full-screen startup gate plus a separate modal settings dialog. Two entry points meant two visual languages, and the dialog's `.ghost` button was styled for the old dark header, so it was invisible on the dialog's light panel.

## Scope

- Replace the `case-strip` with a `<nav class="top-nav">` of three tabs: `上传` / `资料库` / `模型配置`. The active tab carries `aria-current="page"`.
- Introduce one `setView(view)` function that owns visibility. Visibility is decided by the `hidden` attribute alone; `body` classes only carry a state hook for CSS, never visibility.
- Drop the startup gate: app entry always lands on the selection view. The header `模型配置` tab is the only configuration entry point; the selection view carries no extra notice.
- Delete the modal settings dialog; the full-screen configuration page becomes the only configuration entry.
- Unify the visual system on the existing warm-paper palette: one radius scale (`--radius` / `--radius-sm`), one shadow scale (`--shadow` / `--shadow-sm`), one gutter (`--gutter`), one page width (`--page-width`), and no negative letter-spacing on Chinese headings.
- Give the review console the same panel treatment as the other views instead of 2px borders and hard offset shadows.

## Acceptance

- Desktop only: no mobile breakpoints are maintained.
- All five views (selection / reading / review / library / models) render with no horizontal overflow at 1440px.
- Exactly one `<main>` is visible per view; the active header tab matches the view.
- Clicking the `模型配置` header tab opens the configuration view from any other view.
- An incomplete main model never blocks the selection, reading, or library views.
- `npm run typecheck`, `npm run build`, and all `verify:*` scripts pass.

## Out of Scope

- Backend behavior, request scope, resource limits, session lifecycle, and the model-settings API contract are unchanged.
- No change to the review console's three-column workbench layout.
