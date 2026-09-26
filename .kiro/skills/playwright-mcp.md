# Skill note: Playwright MCP quick flow

Use this when validating frontend behavior quickly.

## Typical sequence

1. Start app locally (frontend + backend if needed).
2. Open page with Playwright MCP navigate.
3. Capture a snapshot for accessible element refs.
4. Interact via click/type/select tools using refs from snapshot.
5. Verify UI text/state with wait/snapshot.

## Good checks for this repository

- Workspace load and room query param behavior (`?room=...`)
- Real-time updates rendered in the workspace UI
- Dashboard widgets and analytics views

## Guardrails

- Keep tests/scenarios scoped to the task.
- Prefer snapshot-driven actions over brittle selectors.
