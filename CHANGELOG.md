# Changelog

Notable changes to Pfuma, newest first. Each entry says **what** changed, **why**, **which files**, and **what is still open**, so another
developer (or their coding agent) can pick up where the last session stopped.

---

## [Unreleased] – Dashboard tidy-up (started 2026-10-29, by Bruce Chigwa)

Goal: make the school admin's dashboards simpler: one admin home, one Users page, one sidebar section for the admin's own work.
**This work is ongoing, and more dashboard changes will follow.**

### 1. Retired `/system/dashboard`; its "Set up your school" checklist moved to `/admin`

- The checklist now sits at the top of the **Still to do** panel on `/admin`. It has a progress bar ("x of 8 steps done") and a list of
  the unfinished steps, each with its hint and a link. The existing to-dos (students not placed, classes without a teacher or subjects)
  follow below it.
- The visibility rules are unchanged: it shows only to holders of `system.settings.edit`, and only while a step is open or while it is
  pinned in School Settings (`School.setupChecklistPinned`).
- `/system/dashboard` is now a redirect only. Its other content (summary cards, finance stats, charts, upcoming events, recent activity,
  quick actions) is **no longer shown anywhere**. The components still exist and are still unit-tested.
- **New home logic** in `lib/home.ts` (`homeFor(user)`):
  - holders of `system.users.view` land on `/admin`;
  - everyone else lands on the first sidebar page their permissions open;
  - if nothing else is open to them, they land on `/system/profile`.
- `/` resolves the home with `homeFor()`. The middleware sends signed-in users from `/login` to `/`, because the edge only has the JWT
  and cannot run `can()`.
- Old links redirect to `/`: `/system`, `/system/dashboard`, the support-session redirect and the welcome notification.

Files: `app/(dashboard)/page.tsx`, `app/(dashboard)/system/page.tsx`, `app/(dashboard)/system/dashboard/page.tsx` (now a redirect),
`app/(dashboard)/admin/page.tsx`, `lib/home.ts` (new), `middleware.ts`, `lib/nav.ts` (removed the "Dashboard" item),
`components/layout/Breadcrumbs.tsx` (HOME = `/admin`), `components/dashboard/parts.tsx` (`TodoItem.hint`), `lib/auth.ts`,
`app/api/platform/schools/[id]/support/route.ts`.

### 2. Retired `/system/users`; `/admin/users` is now the only Users page

`/admin/users` now uses the full-featured `UsersClient` that `/system/users` had, and keeps the actions that only the old admin page had.
The page opens for `system.users.view`, and each action checks its own permission.

| Action | Was on /admin/users | Was on /system/users | Now on /admin/users |
|---|---|---|---|
| Status tiles (Active / Invited / Deactivated) | – | yes | yes |
| Search, role and status filters, sorting, paging | – | yes | yes |
| Export CSV | – | yes | yes |
| Import users (CSV, invite links) | – | yes | yes |
| Add user (invite link or temporary password, several roles, title, phone) | basic modal | yes | yes (drawer) |
| Edit user | – | yes | yes |
| Manage access (roles, overrides) | – | yes | yes, at `/admin/users/[id]/access` |
| New invite | – | yes | yes |
| Deactivate / Reactivate | yes | yes | yes |
| Reset password (one-time link) | "Reset link" | yes | yes |
| **Temporary password** (one-time, must change at next sign-in) | yes | – | **yes, added to UsersClient** |
| **Sign out one user everywhere** | "Log out" | – | **yes, added to UsersClient** |
| **Log out all sessions** (whole school except you) | yes | – | **yes, page header** |
| View activity (audit log) | – | yes | yes |

- `/system/users` redirects to `/admin/users` and keeps the query string (`?q=`, `?status=`, `?new=1`).
  `/system/users/[id]/access` redirects to `/admin/users/[id]/access`, where the page now lives (moved with `git mv`).
- The "Add user" button on `/admin` opens the add-user drawer directly (`/admin/users?new=1`).
- All internal links now point to `/admin/users`: notifications, the audit log record links, the setup checklist, quick actions, the
  staff card, Roles & Permissions and the exceptions list.
- Deleted `components/admin/AddUserModal.tsx` and `components/admin/UserRowActions.tsx`, which nothing used any more.
- The API is unchanged. UsersClient calls `/api/system/users/*` for most actions, and `/api/admin/users/[id]/reset-password`,
  `/api/admin/users/[id]/logout` and `/api/admin/users/logout-all` for the three admin-only actions. These all need `system.users.edit`.
  `POST/PATCH /api/admin/users` and `/api/admin/users/[id]/reset-link` are no longer called from the UI and could be removed later.

Files: `app/(dashboard)/admin/users/page.tsx`, `app/(dashboard)/admin/users/[id]/access/page.tsx` (moved),
`app/(dashboard)/system/users/page.tsx` and `app/(dashboard)/system/users/[id]/access/page.tsx` (redirects),
`components/system/UsersClient.tsx` (props `canTempPassword` and `canSignOut`, links follow the current path), `lib/nav.ts` (the Users
href is now `/admin/users`), `components/layout/nav-config.ts` (removed the duplicate Setup → Users item), `lib/system/users.ts`,
`lib/system/setup-checklist.ts`, `lib/system/audit-labels.ts`, `components/system/QuickActions.tsx`,
`components/system/ExceptionsClient.tsx`, `components/system/cards/StaffCard.tsx`, `app/(dashboard)/system/roles/page.tsx`.

### 3. Sidebar: the Dashboard & System pages moved into "My work", now at the top

- "My work · <role>" is now the **first** section of the sidebar. It holds the person's own pages (`LEGACY_SECTIONS` in
  `components/layout/nav-config.ts`), followed by the pages that were under "Dashboard & System": Calendar, School Settings, Users,
  Roles & Permissions, Audit Log and Subscription.
- The separate "Dashboard & System" group is no longer shown. **`lib/nav.ts` still lists these pages under the `system` group, on
  purpose:** the page guard (`lib/access/routes.ts`) reads its permission rules from `NAV_GROUPS`. The merge happens only for display,
  in `components/layout/DashboardShell.tsx`.
- Items with the same href are shown once. `/admin`, `/director` and `/library` now highlight only on an exact match
  (`EXACT_MATCH_ROUTES`), so "Dashboard" is no longer highlighted while you are on `/admin/users`.

Files: `components/layout/DashboardShell.tsx`, `components/layout/Sidebar.tsx`.

### Tests updated

- `tests/integration/setup-checklist.test.ts` now checks the checklist block on `/admin` instead of the old dashboard.
- `tests/integration/summary-cards.test.ts` and `tests/integration/dashboard-charts-lists.test.tsx`: removed the tests that only checked
  the old dashboard page's layout. The tests for each card, chart and list are kept.
- `tests/integration/users-page.test.tsx` now imports `/admin/users/page`.
- `tests/unit/access-engine.test.ts` and `tests/unit/platform.test.ts` now expect `/admin/users` for the page paths. The API paths are
  unchanged.

### State of verification and open items for the next session

- [ ] **Not yet run:** `npm run lint`, `npm test`, and a manual check in the browser after deploying. Type-checking in the session was
  hampered by an out-of-date generated Prisma client (`npx prisma generate` fixes it). No new type errors were found in the changed
  files apart from those caused by the out-of-date client.
- [ ] Decide what to do with the old dashboard's components (`components/system/cards/*`, `components/system/charts/*`,
  `components/system/lists/*`, `QuickActions`, `SetupChecklist`, `lib/system/dashboard.ts`, `components/academics/DashboardCards`):
  move some onto `/admin`, or delete them.
- [ ] Possibly remove the unused `/api/admin/users` POST/PATCH and `/api/admin/users/[id]/reset-link` routes.
- [ ] The `system.dashboard.view` permission no longer opens a page. It is kept because roles and tests still refer to it.
- [ ] More dashboard changes are planned by the product owner.
