# RideArrivo Projects & Kanban Release

This overlay fixes the KPI release App.tsx integration regression and adds a company-wide Projects & Kanban workspace.

## Build regression fixed

- Restores the Engineering execution component referenced by the Engineering team workspace.
- Restores the embedded WorkspaceView renderer.
- Restores the shared SectionTitle helper used by Dashboard/Overview.

## Project management

- Adds Projects to employee navigation and the personal dashboard.
- Reuses secure `collaboration_spaces` as project membership rather than creating a second collaboration identity model.
- Reuses `work_items` as the accountable task/evidence model so project delivery contributes to the existing task history and KPI system.
- Adds project-linked work items and Kanban rank.
- Adds To do, In progress, Blocked, Review and Done columns.
- Adds project creation, assignee selection, priority and due dates.
- Uses server-side RPCs for card creation and status movement.
- Project owners/admins can assign project members; ordinary members may create work for themselves.
- Existing Work RLS is extended so project members can read project cards while broad write permission is not granted.

## Migration

`20260829113000_project_management_kanban.sql`
