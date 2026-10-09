# Checklist builder follow-ups

These are non-blocking findings from the sub-project 2 task reviews and the final whole-branch review, 2026-10-08. None blocked the merge. Items marked ⚑ are the ones the final review said to do first.

## Product behaviour

- ⚑ **Live edits to published global templates.** Autosaving a global template that is already published takes effect for tenants immediately, and the content is only checked by the lenient draft rules. Either reject saves that have publish issues while the template is published, require unpublishing before editing, or show an "edits are live" warning in the editor. (`apps/api/src/checklists/global-templates.service.ts` `saveContent`)
- **After publishing**, the draft page navigates away and then invalidates `[scope,'checklists']`. This refetches the deleted draft: a wasted 404, and the "no draft" screen can flash for one frame. Remove or exclude the draft key before navigating. (`apps/web/src/features/checklists/editor-pages.tsx`)
- **Publish dialog.**
  - A failed publish closes the dialog and loses the change note. Rethrow from `onPublish`, or show the conflict banner.
  - A failed flush gives no feedback behind the modal.
- **Starting a draft** only refreshes the draft query. Invalidate `[scope,'checklists']` so the list badge and the detail page update.
- **Copying a checklist** always takes its current version. Spec §7.1 says "pick a checklist and version". There is also no per-version "copy" action on the detail page.
- **Template rename.** A role with only `templates.manage` can write templates but gets 403 on `GET /templates`. There is also no UI to rename or recategorise tenant templates (`templates.update` is unused).
- **Platform time zone.** The platform workspace hard-codes the `Asia/Baku` time zone instead of using the tenant's.
- **Platform tenant banner.** The banner looks up the tenant name in the first 200 tenants only.
- **Unsaved-edit warnings.**
  - The `beforeunload` guard covers `dirty` and `saving`, but not `error` or `conflict`.
  - Reducer caps refuse actions silently, with no message to the user.
- **Builder accessibility.**
  - The issue-count badge is `aria-hidden`.
  - `aria-expanded` is hard-coded on sections.
  - The template-picker radios have no roving focus.
  - The canvas input and the inspector textarea share the accessible name "Sualın mətni".
- **Checklists list.** There are no loading or error states, a `TableCell` is styled as a flex container, and the copy source list is capped at 200 and includes deactivated checklists.

## API and database

- **Request size limit.** The 1.5 MB JSON body limit applies to every route. Spec §6.4 scopes it to the content routes.
- **Published-templates view.** Add `WITH (security_barrier)` to `global_templates_published`.
- **`withTenant` actor handling.** A nested `withTenant` silently drops `opts.platformAdminId`. Make it throw on an actor mismatch. Nothing prevents an audit row naming both actors either.
- **Missing FKs.** The platform-admin id columns on `checklists`, `checklist_versions` and `tenant_templates` have no FK to `platform_admins`.
- **Redundant index.** `checklists_tenant_idx` duplicates the unique `(tenant_id, id)` index.
- **Hard-coded table name.** `draftRevisionSql()` uses the literal `"checklists"."id"`, a workaround for Drizzle 0.45 dropping the table qualifier from single-table select lists. Prefer `${checklists}.${sql.identifier('id')}`.
- **Validation order.** `saveDraft` validates content before checking for a deactivated checklist, so a bad save to a deactivated checklist returns 422/413 instead of `CHECKLIST_DEACTIVATED`.
- **Audit noise.** An empty `PATCH` writes an audit row with identical before and after values.
- **OpenAPI.** Create routes are documented as 200 instead of 201.
- **Pre-existing Manager and Auditor roles.** Per spec §5, existing tenants' Manager and Auditor roles did not get the new checklist keys. Decide whether to backfill them.

## Tests

- **Spec §9 audit gaps:** no before/after values for `checklist.updated`, `draft_discarded` and `(de)activated`, and no explicit "autosave writes no audit row" assertion.
- **API gaps:** create from a deactivated tenant template, `hasDraft=true` and status filters, the error-filter `issues`/`currentRevision` emission, the body limit, `AuditService` actor attribution and `recordIn`, and RLS `WITH CHECK` on a cross-tenant insert.
- **Contracts gaps:** caps on sections, rules and options; the `optionLabelRequired` and choice-side `ruleKindMismatch` issue codes; `duplicateId` for options and rules; nested follow-up rule→option remapping in `regenerateIds`.
- **Web gaps:** the `visibilitychange` and unmount autosave flushes; `onDragEnd`; copy mode in the new-checklist dialog; editor-page publish navigation; settings-panel scoring toggles.
- **Isolation suite.** The Foundation 404 rows still assert only the status code.
- **e2e flakiness.**
  - `foundation.spec.ts` uses only `Date.now()` as the signup suffix, so parallel repeats can collide.
  - The local signup rate limit throttles repeated runs.
  - `pnpm --filter @taskop/api start` doesn't load `.env` locally.
- **Mobile Jest** times out at 5 s under parallel `pnpm test` load. It passes on its own or with `--concurrency=1`, so it may flake in CI.

## Process and tooling

- **Prettier drift.** `prettier --check` reports about 114 files repo-wide, most from before this sub-project. CI doesn't enforce it. Do one formatting commit.
- **TDD evidence.** Several tasks wrote the tests and implementation in one pass, with no captured failing run first.
