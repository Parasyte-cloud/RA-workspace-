# RA Workspace Responsive Liquid Glass Redesign

Date: 2026-10-15
Status: Design for approval
Project: Parasyte-cloud/RA-workspace-

## 1. Purpose

Redesign the RideArrivo RA Workspace user experience across desktop, laptop, phones, tablets, and iPads so the product feels coherent, professional, intuitive, and polished while preserving existing business logic, permissions, workflows, and data boundaries.

The redesign will establish one responsive design system and one application shell instead of continuing to accumulate module-specific layout fixes. The visual direction is a restrained liquid-glass interface: translucent navigation and contextual surfaces, readable work surfaces, clear typography, strong hierarchy, and consistent interaction patterns.

The project also includes one narrowly scoped Chat behavior change: show sender names visibly on incoming messages in group/room conversations. Direct-message behavior remains unchanged.

## 2. Goals

1. Make RA Workspace easy to use on desktop, laptop, phone, tablet, and iPad.
2. Replace inconsistent responsive behavior with a shared set of layout rules and reusable primitives.
3. Introduce a polished liquid-glass visual system without reducing readability or performance.
4. Improve navigation, spacing, typography, hierarchy, touch ergonomics, forms, tables, dialogs, sheets, cards, and empty/loading/error states.
5. Preserve existing roles, authorization rules, data flows, Supabase policies, and business workflows.
6. Make essential actions discoverable without relying on hover.
7. Make all primary work surfaces usable with keyboard, touch, and pointer input.
8. Show sender identity visibly in Chat rooms while keeping direct messages compact.
9. Add rigorous responsive verification, especially for Chat and shell/navigation behavior.

## 3. Explicit non-goals

This project will not:

- weaken or redesign Partnership room authorization;
- change Chat membership semantics;
- redesign Chat receipts, mentions, calls, attachments, or message authorization;
- change department permissions or role-based access;
- replace Supabase or alter the existing backend architecture;
- rebuild RA Workspace from scratch;
- remove working functionality merely to simplify the UI;
- introduce a second parallel navigation system.

## 4. Product design principles

### 4.1 Readability over decoration

Liquid-glass effects are used to clarify hierarchy, not to make all surfaces transparent. Primary content areas remain sufficiently opaque for sustained reading and data work. Translucency is concentrated in navigation, command bars, floating controls, contextual sheets, selected cards, and overlays.

### 4.2 One responsive system

Responsive behavior is governed by shared layout modes and design tokens. Modules should consume shared primitives rather than creating independent breakpoint logic whenever practical.

### 4.3 Progressive disclosure

Primary actions are visible. Secondary actions move into menus, sheets, or details panels when space is limited. Phone layouts should show one main task at a time rather than compress desktop complexity into a small screen.

### 4.4 Preserve workflow meaning

A responsive transformation may change layout and presentation, but it must not change what a workflow means, who can perform it, or which backend operation is invoked.

### 4.5 Touch and keyboard parity

No essential action may depend only on hover. Focus states must remain visible. Interactive controls must be comfortably tappable.

## 5. Responsive layout modes

The implementation should use layout modes rather than targeting named devices.

### Compact

Approximate target: up to 599px CSS width.

Typical devices: phones in portrait, small phones, narrow browser windows.

Behavior:

- single primary content column;
- bottom navigation for highest-value destinations;
- remaining navigation in a More sheet;
- dialogs become bottom sheets or full-screen sheets when appropriate;
- forms become one column;
- dense tables become structured record cards or explicitly scrollable tables where preserving columns matters;
- sticky controls respect safe-area insets;
- page gutters shrink without crowding content;
- touch-first affordances replace hover-only actions.

### Medium

Approximate target: 600px to 1023px.

Typical devices: tablets, iPads, large foldables, phones in landscape.

Behavior:

- compact navigation rail or collapsible drawer;
- two-pane layouts where useful;
- larger contextual sheets instead of full-screen replacement views;
- grids commonly use two columns;
- tables remain tables when readable, otherwise use adaptive cards;
- details panels may coexist with primary content when space permits.

### Wide

Approximate target: 1024px and above.

Typical devices: laptops and desktops.

Behavior:

- collapsible left navigation;
- compact top command bar;
- multi-column dashboards where useful;
- side panels and dialogs rather than full-screen sheets;
- denser information presentation with improved spacing and hierarchy;
- contextual details can remain visible beside primary work.

The exact breakpoints may be tuned during implementation based on actual component behavior, but the three-mode mental model must remain consistent.

## 6. Design tokens

Create or consolidate shared tokens for:

- page gutters;
- content max widths;
- spacing scale;
- corner radii;
- surface opacity;
- border opacity;
- blur strength;
- shadow/elevation;
- typography scale;
- line height;
- control heights;
- icon sizing;
- touch target minimums;
- navigation dimensions;
- safe-area spacing;
- animation timing;
- z-index layers.

Tokens should use existing RideArrivo brand colors and CSS variables where possible rather than duplicating brand definitions.

## 7. Liquid-glass visual language

### 7.1 Glass surfaces

Use backdrop blur and translucency selectively on:

- desktop side navigation;
- tablet navigation rail;
- phone bottom navigation;
- compact command bars;
- selected/floating cards;
- sheets and contextual overlays;
- floating action controls;
- transient menus.

### 7.2 Solid work surfaces

Use more opaque surfaces for:

- tables;
- long forms;
- document views;
- text-heavy dashboards;
- financial/legal/admin data;
- Chat message history backgrounds;
- modal content containing dense information.

### 7.3 Fallback behavior

If backdrop-filter is unsupported or performance-constrained, surfaces must remain readable through solid/translucent background fallbacks.

### 7.4 Contrast

Text, icons, controls, focus rings, status indicators, and disabled states must remain readable over all glass surfaces. Styling must not rely on background imagery or blur to create legibility.

## 8. Global application shell

### 8.1 Desktop and laptop

- collapsible left navigation;
- compact top command bar;
- consistent page title region;
- contextual page actions aligned predictably;
- content width and gutters controlled by shared tokens;
- global notifications/profile/search remain reachable without consuming excessive vertical space.

### 8.2 Tablet and iPad

- compact navigation rail or controlled drawer;
- labels expand on demand where helpful;
- primary content and contextual details can coexist in split layouts;
- touch targets enlarged versus desktop;
- portrait and landscape both explicitly supported.

### 8.3 Phone

- bottom navigation exposes the 4-5 most important destinations;
- additional destinations appear in a More sheet;
- page headers become compact;
- contextual actions move into a consistent action sheet/menu when space is limited;
- back navigation is explicit in nested experiences;
- safe-area insets are respected on devices with home indicators/notches.

## 9. Navigation behavior

The redesign evolves the existing phone/navigation infrastructure rather than introducing a parallel system.

Requirements:

- role-based visibility remains authoritative;
- active destination is visually obvious;
- navigation state survives normal route/module changes;
- More sheet groups lower-frequency destinations logically;
- no critical destination requires horizontal scrolling;
- tablet navigation avoids simply stretching the phone bottom bar;
- desktop navigation can collapse without hiding discoverability;
- icons support labels rather than replacing them where ambiguity would result.

## 10. Page and module standards

### 10.1 Dashboards

- use a clear summary-first hierarchy;
- cards reflow by available width;
- avoid oversized decorative cards on phones;
- primary KPIs remain scannable;
- secondary information collapses or moves lower in the flow;
- no fixed-width card should force page-level horizontal scrolling.

### 10.2 Department workstations

Engineering, Marketing, Finance, Legal, Admin, and Manager/leadership workstations should share the same shell and responsive rules while preserving department-specific tools.

- common section header pattern;
- consistent action placement;
- consistent tab/segmented navigation behavior;
- adaptive tool grids;
- long tool lists become grouped, searchable, or collapsible where needed;
- side-by-side panels stack predictably on compact screens.

### 10.3 Tables and data grids

Use one of two responsive strategies based on semantic need:

1. preserve tabular relationships with controlled horizontal scrolling and sticky key columns; or
2. transform rows into structured record cards on compact screens.

Do not automatically convert every table into cards. Finance/admin data that depends on column comparison may remain tabular.

### 10.4 Forms

- desktop multi-column forms collapse into one logical column on phones;
- labels remain above or clearly associated with controls;
- validation messages do not cause layout breakage;
- primary submit actions remain easy to find;
- sticky submit bars may be used for long forms on compact devices;
- keyboard type/inputmode/autocomplete should be correct where applicable;
- controls must not zoom unexpectedly on iOS due to too-small text.

### 10.5 Dialogs, drawers, and sheets

- desktop: centered dialogs or contextual side panels;
- tablet: larger sheets/drawers based on task;
- phone: bottom or full-screen sheets when the action is substantial;
- destructive confirmations remain visually distinct;
- background scroll is controlled correctly;
- focus is trapped and restored for accessible dialogs.

### 10.6 File/document areas

- metadata and actions remain readable on phones;
- previews scale to available width;
- download/request-access controls remain distinct;
- long filenames wrap or truncate predictably;
- no accidental download action should be placed immediately beside general row navigation without adequate separation.

### 10.7 Room7 and communication surfaces

- meeting controls are touch-friendly;
- primary call actions remain persistent;
- secondary controls move into accessible menus where space is tight;
- participant and content panels adapt to orientation;
- responsive changes must not alter meeting permissions or media/session logic.

## 11. Chat sender-name change

### 11.1 Current behavior

Chat already resolves message sender identities through the people map, but incoming sender names are not visibly rendered in the normal bubble UI. The sender name is effectively available only through a title/tooltip.

### 11.2 Desired behavior

For non-direct room/group conversations:

- visibly render the sender's full display name above incoming messages;
- do not add a redundant sender-name line to direct messages;
- do not render a sender-name label above the current user's own messages;
- group consecutive messages from the same sender visually so the name does not repeat unnecessarily when messages are adjacent and belong to the same logical cluster;
- if the profile lookup is unavailable, use the existing display-name fallback behavior rather than exposing a raw UUID;
- preserve message actions, attachments, receipts, replies, editing, deletion, mentions, and timestamps.

### 11.3 Sender grouping

A message begins a new sender group when any of the following is true:

- it is the first message in the rendered message sequence;
- the previous rendered message is from a different sender;
- a day divider/call/system row separates the messages;
- a sufficiently large time gap warrants a new visual cluster if the existing Chat grouping logic already supports such a concept.

Do not introduce complex new grouping rules solely for this change. Prefer the minimal rule set needed for clarity.

## 12. Chat responsive protection

Although only sender identity is a Chat behavior change, Chat is a critical responsive surface and must be checked rigorously while the global responsive system is applied.

Protect the following behaviors:

- conversation list -> thread -> details navigation on phones;
- room details accessibility on touch devices;
- direct-message and room rendering;
- mentions and typing UI;
- multiline composer;
- Enter/Return remains newline;
- send icon remains the send action;
- attachments, images, files, and voice notes;
- replies, edits, deletes;
- delivery/read receipts;
- call rows and call controls;
- unread/mention state;
- older-message loading;
- scrolling and scroll anchoring;
- realtime updates;
- composer positioning when mobile keyboards open;
- safe-area padding;
- portrait/landscape transitions.

Responsive work must not change these semantics.

## 13. Mobile viewport strategy

Replace brittle viewport assumptions with dynamic viewport-aware behavior.

Requirements:

- prefer `100dvh`/dynamic viewport calculations for full-height application surfaces;
- provide sensible fallback where necessary;
- use `env(safe-area-inset-*)` for fixed/sticky phone controls;
- avoid nested fixed heights that trap scroll;
- define one owner for vertical scrolling per major full-screen surface;
- prevent composer/footer controls from being hidden by mobile browser chrome or virtual keyboards;
- use `min-height: 0` correctly inside flex/grid containers that contain scrollable regions.

## 14. Accessibility requirements

- visible keyboard focus indicators;
- semantic heading hierarchy;
- accessible names for icon-only controls;
- minimum comfortable touch targets;
- no color-only status communication;
- readable contrast on glass surfaces;
- support `prefers-reduced-motion`;
- maintain reasonable zoom behavior;
- dialogs/sheets manage focus correctly;
- content should remain usable at browser zoom levels above 100%.

## 15. Motion

Motion should communicate structure, not decorate every interaction.

Allowed examples:

- navigation rail expansion;
- sheet/modal entrance;
- tab/segmented selection transitions;
- subtle card hover/press feedback;
- context panel transitions.

Avoid large parallax, constant shimmer, or heavy animated blur.

All non-essential motion must reduce or disable under `prefers-reduced-motion`.

## 16. Performance constraints

- do not apply full-screen backdrop blur to every layer;
- avoid multiple stacked high-radius blur layers;
- prefer CSS transforms/opacity for transitions;
- avoid layout-thrashing resize handlers;
- use CSS/container queries or media queries before JavaScript viewport listeners where practical;
- preserve lazy loading and current route/module splitting;
- do not add a large UI framework solely for this redesign;
- reuse existing dependencies unless a new dependency is clearly justified.

## 17. Error, loading, and empty states

Create consistent patterns for:

- initial page loading;
- partial panel loading;
- empty result sets;
- permission/access state;
- recoverable error with retry;
- destructive failure;
- offline/network disruption where relevant.

States should explain what happened and what the user can do next without exposing raw backend errors when a user-facing explanation is available.

## 18. Testing strategy

### 18.1 Test-first requirement

Behavioral changes must start with a failing regression test before production code is changed.

The Chat sender-name change specifically requires tests proving:

- incoming room messages display a visible sender name;
- sender names are not redundantly added to DMs;
- own messages do not receive a sender-name label;
- consecutive same-sender room messages do not create unnecessary repeated labels if grouping is implemented;
- existing message actions and receipts remain present.

### 18.2 Existing automated verification

Every implementation batch must pass the relevant focused tests plus:

- TypeScript typecheck;
- project test suite;
- production build;
- `git diff --check`;
- any existing responsive/navigation contract tests.

### 18.3 Responsive viewport matrix

At minimum, manually/visually verify:

Phones:
- 320px
- 360px
- 375px
- 390px
- 430px

Tablets/iPads:
- 768px portrait
- 810px portrait
- 820px portrait
- 1024px landscape/tablet-wide
- representative landscape states

Desktop/laptop:
- 1280px
- 1440px
- 1600px or wider where practical

### 18.4 Chat-specific QA matrix

At the target viewports verify:

- conversation list;
- room thread;
- direct thread;
- room sender names;
- long sender names;
- multiline message body;
- long unbroken content/links where supported;
- reply preview;
- edit mode;
- delete controls;
- attachments;
- image preview;
- audio/voice note;
- receipts;
- mentions;
- unread state;
- call rows;
- details view;
- composer with keyboard open;
- composer with keyboard closed;
- orientation change;
- scroll near top and bottom;
- old-message loading;
- empty room;
- realtime incoming message.

## 19. Implementation batches

### Batch 1: Foundation and shell

Scope:

- design tokens;
- global page/layout primitives;
- liquid-glass surface primitives;
- desktop navigation refinement;
- tablet navigation behavior;
- phone bottom navigation and More sheet refinement;
- page/header/action patterns;
- safe-area and viewport foundations.

Verification:

- navigation contract tests;
- typecheck;
- focused shell tests;
- full tests;
- production build;
- visual viewport checks.

### Batch 2: Core work modules

Scope:

- dashboards;
- department workstations;
- forms;
- tables/data surfaces;
- files/documents;
- admin/legal/finance surfaces;
- common cards and tool panels.

Verification:

- module-specific tests;
- responsive regression tests where present;
- typecheck;
- full tests;
- production build;
- visual viewport checks.

### Batch 3: Communication and Room7 responsive migration

Scope:

- communication surfaces;
- Room7 responsive layout polish;
- touch controls;
- contextual panels;
- sheet/dialog adaptation;
- no backend/media/session logic changes.

Verification:

- communication/Room7 tests;
- typecheck;
- full tests;
- production build;
- visual viewport checks.

### Batch 4: Chat sender identity and final cross-app QA

Scope:

- visible room sender names;
- sender grouping if minimal and stable;
- final Chat responsive hardening caused by shared shell changes;
- cross-application consistency pass.

Verification:

- RED/GREEN sender-name tests;
- all Chat regression tests;
- navigation tests;
- typecheck;
- full project tests;
- production build;
- full viewport matrix;
- final `git diff --check`.

## 20. Git and integration strategy

Use one isolated feature branch/worktree for the redesign so unrelated local artifacts are never touched.

Recommended branch name:

`feat/responsive-liquid-glass-ui`

Rules:

- never use `git add .`;
- stage only intended files;
- do not clean or remove unrelated untracked files;
- verify the exact staged path list before every commit;
- keep commits aligned with implementation batches;
- do not push until the full local verification for the intended batch passes;
- before merge, run final typecheck, full tests, production build, and diff check on the complete branch;
- create a PR into `main`;
- require CI to pass;
- do not force merge through failed checks or requested changes;
- squash merge only after the branch is confirmed mergeable;
- update local `main` with a fast-forward pull after merge and verify `origin/main...HEAD` is `0 0`.

## 21. Rollout and regression control

This redesign should be additive and incremental.

- preserve backend schemas and permissions unless a specific UI feature already depends on them;
- avoid simultaneous backend rewrites;
- use shared tokens/primitives first, then migrate modules;
- visual regressions discovered in one module should be fixed at the shared primitive level when the underlying cause is shared;
- module-specific exceptions are acceptable only when the workflow truly needs them.

## 22. Completion criteria

The redesign is complete only when:

1. the shared responsive shell is in use across the application;
2. phones, tablets/iPads, laptops, and desktops are all intentionally supported;
3. no major primary workflow depends on hover;
4. primary forms and data surfaces are usable without broken horizontal overflow on compact screens;
5. navigation is coherent in compact, medium, and wide layouts;
6. liquid-glass styling remains readable and performant;
7. Chat room sender names are visibly displayed as specified;
8. existing Chat semantics remain intact;
9. full automated verification passes;
10. the responsive viewport matrix is manually/visually checked;
11. CI passes on the pull request;
12. the PR is merged and local `main` is synchronized.
