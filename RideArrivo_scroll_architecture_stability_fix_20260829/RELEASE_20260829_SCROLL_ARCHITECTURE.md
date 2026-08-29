# RideArrivo Workspace - Scroll Architecture Stabilisation

Date: 2026-08-29

## Objective

Remove the competing desktop scroll surfaces that made the workstation feel unstable on Windows laptops and other scaled displays.

## Critical findings

The application had several historical CSS layers defining viewport height, sidebar overflow, main overflow and responsive breakpoints independently. The final rendered result could therefore expose both a sidebar scrollbar and a main-content scrollbar. Section changes also reused the previous main scroll position, which made newly opened workspaces appear to jump.

## Changes

- Added `src/shell-stability.css` as the final application-shell ownership layer.
- The browser document is locked to the viewport while the authenticated workspace is open.
- The RideArrivo frame, sidebar and header remain anchored.
- Main content is the only desktop scroll owner. Its native scrollbar is visually hidden while wheel, trackpad, keyboard and touch scrolling remain available.
- Desktop sidebar navigation no longer scrolls independently.
- Long navigation is grouped into Communication, Company and Workstations accordions. Only one secondary group needs to be open at a time.
- Dashboard, Tasks and Projects stay immediately visible.
- Settings and Administration stay immediately visible when authorised.
- Opening a different section resets the main content to the top instead of retaining an unrelated scroll position.
- Compact desktop/tablet keeps access to all destinations with a hidden rail scrollbar only where the physical viewport is too narrow to fit every icon.
- Phone navigation flattens the groups back into the existing horizontal navigation rail.

## Intentional local scrolling

Data-heavy components such as message histories, wide tables and repository lists may still own local scrolling where the content itself requires it. These are not application-shell scroll surfaces and should not move the workstation frame.

## Deployment

No database migration, Supabase function or gateway change is required.

Run:

```bash
npm run build
npm run gateway:test
```

Then hard refresh the affected Windows laptop with `Ctrl + Shift + R`.
