# Taskop — Sub-project 2: Checklist Builder & Templates — Design Spec

- **Date:** 2026-10-08
- **Status:** Draft for review
- **Source requirements:** `docs/PS Checkly 20293009 v05.pdf` — FR-06, FR-07, FR-08, FR-24 (also shapes data for FR-12, FR-13, FR-15.07)
- **Builds on:** `docs/superpowers/specs/2026-10-07-foundation-design.md` (tenancy, RLS, roles, scopes, audit, platform admin)

## 1. Context and decisions

Sub-project 2 lets a tenant define **what gets inspected**: checklists made of sections and questions, with answer types, required flags, conditional follow-ups, evidence rules, problem flags and score weights. It covers versioning, copying, deactivating checklists, and a template library. It does **not** cover who runs a checklist, where or when.

Decisions made during brainstorming:

| Topic | Decision |
|---|---|
| Scope split | **Content only.** Site, assignees, start/end times and recurrence (the rest of FR-06.03) belong to sub-project 3, whose "assignments" bind a checklist version to sites, people and times. One checklist is reused at many sites. |
| Conditional logic | **Nested follow-ups.** Choice and number items can have rules. A matching answer shows follow-up items, nested up to 3 levels deep, and can require a note, photo or video. There is no global rule engine. |
| Scoring | **Problem flags + weights.** A rule can mark an answer as a problem (`normal` or `critical`). Items have a score weight, and checklist settings control scoring. Per-item "live evidence only" toggle. Stored now; used by sub-projects 4, 6 and 7. |
| Templates | **Platform builder.** Platform admins author global templates in the same visual builder. They can also build checklists inside a tenant (FR-24.03). A few starter templates are seeded. |
| Versioning | **Draft → publish.** At most one editable draft per checklist. Publishing freezes it as an immutable numbered version. |
| Permissions | `checklists.view` / `checklists.manage` / `checklists.publish`, plus `templates.manage`. Data scope does not filter checklists; they are tenant-wide content. |
| Storage | **One JSON document per version** (`content jsonb`), typed by a Zod schema shared by the API, web and (later) mobile. |

## 2. Goals and non-goals

**Goals.** At the end of this sub-project:

1. A user with `checklists.manage` can create a checklist (blank, from a template, or as a copy), build it in a visual web builder, and save it as a draft.
2. A user with `checklists.publish` can publish the draft as an immutable version. Editing later produces v2, v3… and earlier versions never change.
3. The builder supports all FR-08.01 answer types, required/optional items, nested conditional follow-ups, per-answer evidence requirements, problem flags and weights. Items can be reordered by drag-and-drop and by "Move to…".
4. Checklists can be deactivated and reactivated without losing any version.
5. Tenants can browse Taskop's global templates by industry, create a checklist from one, and save their own checklists as private templates.
6. Platform admins can author global templates and build or publish checklists inside a customer's tenant, with honest attribution in the audit log.
7. Pure functions in `packages/contracts` decide which items are visible, what is still missing, and the score. Sub-project 4 reuses them unchanged.

**Non-goals:**

- Assignment, scheduling, site binding, shifts (sub-project 3)
- Executing checklists and enforcing FR-08.06 at completion time (sub-project 4); this sub-project only stores the rules and provides the evaluation functions
- The problem workflow with an owner, due date and resolution (sub-projects 4/5); alerts (sub-project 6); score reporting (sub-project 7)
- Selling professional checklist configuration as a paid service (FR-24.04, sub-project 9)
- Version diff view, an "N/A" answer, rich-text instructions (plain text with line breaks only), and languages other than `az`
- Any mobile app changes

## 3. Checklist content document

`ChecklistContent` is a typed JSON tree, defined with Zod in `packages/contracts/src/checklist-content.ts`.

```
ChecklistContent
├─ schemaVersion: 1
├─ instructions?: string                 special instructions (FR-06.03), ≤ 5,000 chars
├─ scoring: { enabled: boolean, problemsReduceScore: boolean }   (FR-13.06)
└─ sections: Section[]                   ≥ 1 (publish), ≤ 50

Section
├─ id: uuid
├─ title: string                         ≤ 200 chars
├─ instructions?: string                 ≤ 2,000 chars
└─ items: Item[]

Item (discriminated union on `type`)
  common:
    id: uuid
    type
    label: string                        ≤ 500 chars
    helpText?: string                    ≤ 2,000 chars
    required: boolean                    (FR-08.02)
    weight: number                       0–100, default 1
    evidence: {
      photo: 'none' | 'optional' | 'required',
      video: 'none' | 'optional' | 'required',
      liveOnly: boolean                  camera only, no gallery (FR-12.05–06)
    }
  type-specific:
    yes_no         options fixed: [{id, key:'yes'}, {id, key:'no'}]
    confirm_deny   options fixed: [{id, key:'confirm'}, {id, key:'deny'}]
    single_choice  options: [{id, label}]   2–50
    multi_choice   options: [{id, label}]   2–50
    number         unit?: string, min?: number, max?: number, decimals: 0–4
    text           short single-line answer, maxLength ≤ 500
    comment        multi-line free note, maxLength ≤ 5,000
    photo          minCount ≥ 0, maxCount ≤ 20
    video          minCount ≥ 0, maxCount ≤ 5
    datetime       mode: 'date' | 'time' | 'datetime'
  rules?: Rule[]   (only for yes_no, confirm_deny, single_choice, multi_choice, number)

Rule
├─ id: uuid
├─ when:
│    { kind: 'options', optionIds: uuid[] }      choice items; matches if any selected option is listed
│    { kind: 'number', op: 'lt'|'lte'|'gt'|'gte'|'eq', value }
│    { kind: 'number', op: 'between'|'outside', min, max }    inclusive bounds
└─ then:
     problem?: 'normal' | 'critical'     (FR-13.01, FR-15.07)
     requireNote?: boolean
     requirePhoto?: boolean              (FR-08.05)
     requireVideo?: boolean
     followUps: Item[]                   (FR-08.04); nested depth ≤ 3
```

The labels of the fixed options (yes/no, confirm/deny) come from i18n keys, not from the document.

### 3.1 Stable IDs

Every section, item, option and rule has a UUID. Editing a draft and publishing new versions keep these IDs, so results stored per node ID (sub-project 4) stay comparable across versions. `regenerateIds(content)` assigns fresh IDs and rewrites the internal references (rule → option). It is used when copying a checklist, creating from a template and saving as a template.

### 3.2 Validation levels

- **Draft schema (lenient):** checks the structure and types, the size limits (the whole payload ≤ 1 MB) and that IDs are well-formed. Empty labels, a section with no items and a choice item with fewer than 2 options are allowed. Every autosave must pass this schema.
- **Publish schema (strict):** the draft schema, plus:
  - every label and title is non-empty
  - at least 1 section and 1 item in total
  - choice items have 2–50 options with unique, non-empty labels
  - a rule's `optionIds` refer to options of the same item
  - number rules: `min ≤ max`, and the values fit the item's `min`/`max`
  - follow-up depth ≤ 3
  - IDs are unique across the whole document
  - ≤ 500 items in total, including follow-ups
  - `photo`/`video` items: `minCount ≤ maxCount`, and a required item needs `minCount ≥ 1`
- `validateForPublish(content)` returns `issues: { path: (string|number)[], code: string }[]`. Each issue `code` is an i18n key, so the builder can highlight the exact field.
- `schemaVersion` lets the format change later without rewriting stored versions. Clients refuse a `schemaVersion` newer than they understand.

### 3.3 Evaluation functions (shared)

These are pure functions in `packages/contracts/src/checklist-logic.ts`, used by the web preview now and by mobile and the API later. `Answers` maps an item ID to its value (option ID(s), number, string, ISO date-time, media references, note).

- **`visibleItems(content, answers)`** returns the ordered list of visible items. A follow-up is visible when its parent item is visible and one of the parent's rules matching the current answer lists it.
- **`requirements(content, answers)`** returns what is still missing among visible items:
  - required items without an answer
  - evidence required by the item (`evidence.photo/video = 'required'`) or by a matching rule (`requirePhoto`/`requireVideo`)
  - notes required by a matching rule
  - photo/video item counts below `minCount`

  Completion is allowed only when this list is empty (FR-08.06).
- **`computeScore(content, answers)`** returns `{ earned, possible, percent | null, problems: {itemId, severity}[] }`.
  - Only visible, answered items of type `yes_no`, `confirm_deny`, `single_choice`, `multi_choice` and `number` that have at least one rule with `problem` are scored.
  - Such an item adds its `weight` to `possible`. It adds its `weight` to `earned` unless one of its matching rules sets `problem`.
  - If `scoring.problemsReduceScore` is false, problems are still listed but `earned = possible`.
  - `percent` is `null` when `scoring.enabled` is false or `possible = 0`.
- **`regenerateIds(content)`**, see §3.1.

## 4. Data model

The Foundation rules apply: UUIDv7 IDs, `timestamptz` in UTC, `tenant_id` with an index that starts with it, and RLS with `FORCE ROW LEVEL SECURITY` on tenant tables. Nothing here is ever hard-deleted, except a discarded draft version.

### 4.1 Tables

**`checklists`**
- `id`, `tenant_id`, `name` (≤ 200), `description?` (≤ 2,000)
- `category?`: `template_category` enum (§4.3)
- `status`: `active` | `deactivated`
- `current_version_id?` → `checklist_versions`: the latest published version; null until the first publish
- `latest_version_number int not null default 0`
- `source_template_kind?` (`global` | `tenant`), `source_template_id?`, `source_version_id?`: where the checklist came from (no FK for global templates)
- `created_by_user_id?`, `created_by_platform_admin_id?`. Exactly one is set; a check constraint enforces this.
- `created_at`, `updated_at`
- Names are not unique.

**`checklist_versions`**
- `id`, `tenant_id`, `checklist_id` → `checklists` (FK including `tenant_id`, as in the Foundation)
- `state`: `draft` | `published`
- `number int?`: null while a draft, set on publish
- `content jsonb not null`
- `change_note?` (≤ 500)
- `revision int not null default 1`: incremented on every draft save
- `created_by_user_id?` / `created_by_platform_admin_id?`
- `published_by_user_id?` / `published_by_platform_admin_id?`, `published_at?`
- `created_at`, `updated_at`
- Constraints:
  - `unique (checklist_id, number)`
  - partial unique index `(checklist_id) where state = 'draft'`, so there is at most one draft
  - check: `state = 'published'` ⇔ `number`, `published_at` and one `published_by_*` are not null

**`tenant_templates`**
- `id`, `tenant_id`, `name`, `description?`, `category` (required)
- `content jsonb`, `revision int`
- `status`: `active` | `deactivated`
- `source_checklist_id?`, `source_version_id?`
- `created_by_user_id?` / `created_by_platform_admin_id?`
- `created_at`, `updated_at`
- Templates are not versioned. Saving one replaces its content (with a `revision` check). Templates only ever seed a draft, so saving one requires the **draft** schema; strict-schema issues come back as hints, as with drafts.

**`global_templates`** (no `tenant_id`, no RLS)
- `id`, `name`, `description?`, `category`
- `content jsonb`, `revision`
- `published bool not null default false`: whether tenants can see it
- `sort_order int`
- `created_by_platform_admin_id`, `created_at`, `updated_at`

### 4.2 Database protections

- **Immutable published versions.** A `BEFORE UPDATE OR DELETE` trigger on `checklist_versions` raises an error when `OLD.state = 'published'`. The draft → published transition is an `UPDATE` where `OLD.state = 'draft'`, so it is allowed. The only `DELETE` allowed is of a draft (NFR-06, FR-06.11).
- **Grants:**
  - `taskop_app` gets `SELECT, INSERT, UPDATE` on `checklists` and `tenant_templates`, and `SELECT, INSERT, UPDATE, DELETE` on `checklist_versions`; the trigger limits that `DELETE` to drafts.
  - On `global_templates`, `taskop_app` gets `SELECT` only, through the view `global_templates_published` (`where published`), and has no direct table access.
  - `taskop_platform` has full DML on `global_templates`.
- **Migration:** adds the new tables, enums, trigger, grants, RLS policies, and the new permission keys for existing Owner and Admin roles (§5).

### 4.3 Template categories

`TEMPLATE_CATEGORIES` is a code enum in `contracts`, with i18n labels and a matching pg enum `template_category`. It has the values `cleaning`, `restaurant`, `retail`, `safety`, `production`, `warehouse`, `quality`, `maintenance` and `other` (FR-07.02). There is no categories table.

### 4.4 Lifecycle

```
create (blank | from template | copy of a version) ──► checklist (active) + draft
draft ──autosave: PUT {content, revision}──► draft (revision+1); stale revision → 409
draft ──publish (strict validation)──► version N+1, immutable; current_version_id = it
published ──"edit"──► new draft cloned from the latest published version (same IDs)
older version ──"restore as draft"──► new draft cloned from it (fails if a draft exists)
draft ──discard──► deleted
checklist ──deactivate / reactivate──► status change; versions untouched (FR-06.06/11/12)
published version ──"save as template"──► tenant_template (regenerated IDs)
```

- **Blank create:** the draft starts with one empty section and scoring `{enabled: true, problemsReduceScore: true}`.
- **Copy:** creates a new checklist named "<name> (surət)", with a draft whose content is the chosen version with regenerated IDs. Its `source_*` fields record the original.
- **Publish:**
  - Locks the checklist row (`SELECT … FOR UPDATE`).
  - Checks that `revision` matches the draft and that the content passes the strict schema.
  - Sets `number = latest_version_number + 1`, `state = published` and the publisher fields.
  - Updates `checklists.current_version_id` and `latest_version_number`.
  - Writes the audit entry.
  - All of this runs in one transaction.
- **Deactivated checklists are read-only:** draft writes, publishing and creating drafts all return `CHECKLIST_DEACTIVATED`. Reading, copying and saving as a template still work. Sub-project 3 will refuse to assign a deactivated checklist.
- **Executions** (sub-project 4) will reference `checklist_versions.id`. New executions use `current_version_id`; executions already started keep their version.

## 5. Permissions

New keys in `PERMISSION_GROUPS`:

| Group | Key | Allows |
|---|---|---|
| checklists | `checklists.view` | List and read checklists and their versions and drafts |
| checklists | `checklists.manage` | Create, copy, edit metadata, autosave and discard drafts, deactivate/reactivate; browse templates |
| checklists | `checklists.publish` | Publish a draft |
| templates | `templates.manage` | Create, edit and deactivate the tenant's own templates; save a version as a template |

Built-in role defaults (in `SYSTEM_ROLE_DEFAULTS` for new tenants; added to existing tenants by migration for Owner and Admin only):

| Role | Keys |
|---|---|
| Owner | all (resolved at runtime, as today) |
| Admin | all four |
| Manager | `checklists.view`, `checklists.manage` |
| Auditor | `checklists.view` |
| Worker | none (workers receive content through their executions in sub-project 4) |

Routes that change a checklist (`manage`/`publish`) also require `checklists.view`; the guard checks both. Data scope does not filter checklists or templates.

## 6. API

All endpoints are under `/api/v1`, follow the Foundation conventions (Zod contracts, OpenAPI, cursor pagination, error format), and run inside the tenant transaction.

### 6.1 Tenant endpoints

| Endpoint | Permission | Notes |
|---|---|---|
| `GET /checklists` | view | Filters: `status`, `category`, `q` (name search), `hasDraft`. Rows: metadata, current version number, draft revision if one exists |
| `GET /checklists/:id` | view | Metadata + version list (`id`, `number`, `state`, publisher, `published_at`, `change_note`), without content |
| `GET /checklists/:id/versions/:versionId` | view | Full version, including content |
| `GET /checklists/:id/draft` | view | The draft with its content and `revision`; 404 `CHECKLIST_NO_DRAFT` if none |
| `POST /checklists` | manage | `{ name, description?, category?, from?: { kind: 'global'\|'tenant', templateId } \| { kind: 'version', versionId } }` → checklist + draft |
| `PATCH /checklists/:id` | manage | `name`, `description`, `category` |
| `POST /checklists/:id/draft` | manage | `{ fromVersionId? }`: starts a draft from that version, or from the current version; 409 `CHECKLIST_DRAFT_EXISTS` |
| `PUT /checklists/:id/draft` | manage | `{ content, revision }` → `{ revision, issues }`. The content must pass the draft schema (422 otherwise); `issues` lists strict-schema issues as hints. 409 `CHECKLIST_DRAFT_CONFLICT` with `currentRevision` |
| `DELETE /checklists/:id/draft` | manage | Discards the draft |
| `POST /checklists/:id/publish` | publish | `{ revision, changeNote? }` → the new version metadata; 422 `CHECKLIST_INVALID_CONTENT` with `issues` |
| `POST /checklists/:id/deactivate`, `/reactivate` | manage | |
| `POST /checklists/:id/versions/:versionId/save-as-template` | templates.manage | `{ name, description?, category }` → tenant template |
| `GET /templates` | manage | Published global templates and the tenant's own. Filters: `source` (`global`\|`tenant`), `category`, `status` (own only), `q`. Without content |
| `GET /templates/global/:id`, `GET /templates/tenant/:id` | manage | With content |
| `POST /templates` | templates.manage | `{ name, description?, category, content }` (a blank template starts from the blank content) |
| `PATCH /templates/:id` | templates.manage | Metadata |
| `PUT /templates/:id/content` | templates.manage | `{ content, revision }` → `{ revision, issues }`; draft schema; 409 `TEMPLATE_CONFLICT` on a stale revision |
| `POST /templates/:id/deactivate`, `/reactivate` | templates.manage | |

### 6.2 Platform endpoints (FR-07.01, FR-24.03)

These use the platform-admin JWT audience, as in the Foundation.

- **Global templates** (platform connection): `GET /platform/templates`, `GET /platform/templates/:id`, `POST /platform/templates`, `PATCH /platform/templates/:id`, `PUT /platform/templates/:id/content` (draft schema, revision), `POST /platform/templates/:id/publish` (requires the strict schema, 422 with `issues` otherwise) and `/unpublish`. They are audited as platform-scope `audit_log` rows: `tenant_id` null and `actor_platform_admin_id` set. The migration makes `audit_log.tenant_id` nullable, adding a check that a null `tenant_id` requires `actor_platform_admin_id`. RLS already hides such rows from every tenant, and the platform connection reads them.
- **Building inside a tenant:** `/platform/tenants/:tenantId/checklists/*` and `/platform/tenants/:tenantId/templates/*` mirror §6.1.
  - A `PlatformTenantContext` guard checks that the tenant exists (it may be suspended, so support can still prepare content).
  - It then opens the normal **app** connection transaction with `app.tenant_id = :tenantId`, so RLS still applies.
  - It runs the same services with a `PlatformActor` principal that holds all checklist and template permissions.
  - Writes set the `*_platform_admin_id` columns, and audit rows record `actor_platform_admin_id`.

### 6.3 Audit actions

All are written in the same transaction as the change, with before/after values:

- `checklist.created` (after includes `source`), `checklist.updated` (metadata), `checklist.published` (number, change note), `checklist.draft_started`, `checklist.draft_discarded`, `checklist.deactivated`, `checklist.reactivated`
- `template.created`, `template.updated` (metadata or content; content changes record the new revision only), `template.deactivated`, `template.reactivated`
- `global_template.created`, `global_template.updated`, `global_template.published`, `global_template.unpublished`

Draft autosaves are **not** audited. The published version itself is the record of the content (NFR-07, FR-26.02).

### 6.4 Error codes

New entries in the contracts error enum:

- `CHECKLIST_NOT_FOUND`, `CHECKLIST_VERSION_NOT_FOUND`, `CHECKLIST_NO_DRAFT`
- `CHECKLIST_DRAFT_EXISTS` (409), `CHECKLIST_DRAFT_CONFLICT` (409, `currentRevision`)
- `CHECKLIST_INVALID_CONTENT` (422, `issues`), `CHECKLIST_CONTENT_TOO_LARGE` (413)
- `CHECKLIST_DEACTIVATED` (409)
- `TEMPLATE_NOT_FOUND`, `TEMPLATE_CONFLICT` (409), `TEMPLATE_DEACTIVATED` (409)

These are thrown as `AppError`s with their own status, as in the Foundation.

Size limit: the JSON body limit for the draft, content and template routes is raised to 1.5 MB. The service checks the serialised content against 1 MB and throws `CHECKLIST_CONTENT_TOO_LARGE`. Larger bodies still get the body parser's 413, which the error filter maps to `VALIDATION_FAILED`, unchanged from the Foundation.

## 7. Web app

New libraries: **dnd-kit** (latest; sortable and keyboard sensors). Everything else is the existing stack.

### 7.1 Navigation and screens

The sidebar gets **Checklists** (`checklists.view`) and **Templates** (`checklists.manage`).

- **Checklists list:** a table with name, category, status, current version, a "draft" badge and last updated. Filters and search.
  - "New checklist" opens a dialog with three choices: blank, from a template (opens the gallery picker), or copy an existing checklist (pick a checklist and version).
- **Checklist detail:**
  - Metadata (editable), and actions: open draft / edit, copy, save as template, deactivate/reactivate.
  - Version history table. Each version can be opened as a read-only builder view or restored as a draft.
- **Template gallery:** tabs for "Taskop" and "Our templates", category cards with counts (FR-07.02), and a template preview (read-only builder). "Use template" asks for a name and creates the checklist (FR-07.03). In "Our templates", there is edit and deactivate (`templates.manage`).
- **Builder:** described below. It runs in *checklist draft* mode or *template* mode (save only, no publish or versions).
- **Platform area:**
  - "Templates": a list with publish/unpublish, plus the builder in template mode.
  - On the tenant detail page, a "Checklists" tab that reuses the checklist list, detail and builder screens, pointed at the `/platform/tenants/:tenantId/...` API.
  - The API client takes a base-path option so the same screens work in both places.

### 7.2 Builder

**Layout (three panes):**

- **Outline (left):** a tree of sections → items → rule follow-ups. Each node shows its type icon, label, and required, problem and evidence markers.
  - Drag-and-drop reorders items within a section, moves them across sections, and reorders sections. Follow-ups can be reordered within their rule (FR-06.08, FR-06.10).
  - Every node has **"Move to…"**: choose the target section (or parent rule for follow-ups) and the position number. This gives fast moves in long lists and full keyboard access (FR-06.09).
- **Canvas (centre):** the selected section's item cards in order.
  - Labels are edited inline.
  - An "add item" type picker appears between cards and at the end.
  - Each card has duplicate (with regenerated IDs) and delete.
  - Sections can be added, renamed and deleted (deleting a non-empty section asks for confirmation).
- **Inspector (right):** settings for the selected node, as react-hook-form fields validated by the contracts schemas:
  - type-specific fields
  - required
  - weight (shown only when scoring is enabled)
  - evidence (photo/video none/optional/required, live only)
  - the **rules editor**: "When [options ▾ | number op/value] → problem [none/normal/critical], require note/photo/video, follow-ups [+ add]". New follow-ups appear in the outline and are edited by selecting them.
  - With nothing selected, it shows the checklist settings: instructions and scoring toggles.
- **Top bar:**
  - name
  - save state: *Saving… / Saved / Not saved — conflict*
  - issues count, which opens a list; clicking an issue selects and focuses the field
  - undo/redo
  - **Preview**
  - **Publish**, shown only with `checklists.publish`, disabled while there are issues; it opens a change-note dialog

**State and saving:**

- Content lives in a reducer (actions: add, update, move, delete, duplicate, rule edits) with undo/redo history of 50 steps. Moves and deletes go through pure helpers that are unit-tested.
- **Autosave:**
  - Runs 1.5 s after the last change, and on `visibilitychange`/`pagehide`.
  - Only one save runs at a time; the latest state is coalesced into the next save.
  - Each save sends the last known `revision`. A 409 stops autosave and shows a banner ("This draft was changed elsewhere — reload"); reloading discards local changes after a confirmation.
- `issues` from the save response are mapped to node IDs and fields and shown inline. For immediate feedback, the client also runs `validateForPublish` locally.
- **Preview:** renders the checklist inside a phone-width frame as answerable inputs (media items are placeholders). It uses `visibleItems`, `requirements` and `computeScore`, so authors can see follow-ups appear, the missing-requirements list and the score.
- A builder opened for a published version, a deactivated checklist, or a user without `checklists.manage` is read-only. It uses the same panes with editing disabled.

## 8. Seed data

- **Global templates:** 8 starter templates, one per category except `other`. Each has 10–25 Azerbaijani items and uses at least one rule with follow-ups, one problem flag and one evidence requirement. They live as TypeScript fixtures in `apps/api/src/scripts/seed/global-templates/` and are inserted by `pnpm db:seed` through the platform connection (an upsert by fixed ID, so re-running doesn't duplicate them). They are published by default and can be edited afterwards in the platform builder.
- **Demo tenant:** "Gündəlik təmizlik yoxlaması" with v1 and v2 published, and "Anbar qəbulu" with a draft only. Plus one tenant template.

## 9. Testing

- **Contracts (Vitest):**
  - Draft and strict schemas: one passing and one failing case per rule, with exact issue paths and codes; depth, count and size limits.
  - `visibleItems`, `requirements` and `computeScore`, table-driven: nested follow-ups up to depth 3, number ops including `between`/`outside`, multi-choice matching, hidden items excluded from requirements and score, rule-triggered evidence and note requirements, `problemsReduceScore` off, scoring disabled.
  - `regenerateIds`: all IDs are new and unique, and rule → option references still resolve.
- **API integration (Vitest + Testcontainers):**
  - Lifecycle: create → autosave → publish v1 → start draft → publish v2. v1's content and metadata are unchanged.
  - A stale revision returns 409. Concurrent publishes produce distinct consecutive numbers.
  - Discard draft; restore an old version as a draft.
  - Create from a global template, a tenant template and a version (copy). The result has regenerated IDs and records its source.
  - Save as template; deactivate/reactivate, with writes blocked while deactivated.
  - **Trigger:** raw SQL `UPDATE`/`DELETE` of a published version as `taskop_app` fails.
  - **Permissions:** Manager can draft but gets 403 on publish; Auditor can only read; Worker gets 403 everywhere.
  - **Tenant isolation:** the suite is extended to every new endpoint, including tenant B passing tenant A's template, checklist or version IDs as a `from` source, and B probing A's IDs on every route.
  - **Global templates:** unpublished templates are invisible and unusable through tenant routes, and `taskop_app` cannot write `global_templates`.
  - **Platform:** building inside a tenant writes rows that are visible to that tenant only, with platform-admin attribution columns and `actor_platform_admin_id` in the audit log.
  - **Audit:** each listed action writes exactly one entry with correct before/after values; autosave writes none.
- **Web (Vitest + Testing Library):** reducer actions (moves within and across sections and follow-up lists, undo/redo), "Move to…" dialog, rules editor, autosave coalescing and the conflict banner, permission-gated Publish button, and preview showing or hiding follow-ups.
- **Playwright end-to-end:** create from a template → add a yes/no item with a "Yes → problem (critical) + required photo" follow-up → reorder by "Move to…" → publish v1 → edit → publish v2 → the version history shows v1 and v2, and v1 still opens with the original content.

## 10. Delivery

There is one spec and two implementation plans, following the Foundation workflow (parallel tracks in separate worktrees, subagent-driven):

1. **contracts + API:** content schemas and logic functions first (the web track depends on them), then migration (tables, enums, trigger, grants, RLS, permissions), services, tenant and platform endpoints, error-filter fix, seed, tests.
2. **web:** builder (reducer, outline with dnd-kit, canvas, inspector, rules editor, autosave, preview), checklist list and detail, template gallery, platform screens, tests, and the Playwright test.

Track 2 starts once the contracts part of track 1 is merged into the feature branch.

## 11. Requirement traceability

| Requirement | Where it's covered |
|---|---|
| FR-06.01–02 | Permissions (§5), web builder (§7) |
| FR-06.03 | Name, description, sections/inspection points, questions, evidence, instructions (§3, §4). Site, assignee, times and recurrence → sub-project 3 |
| FR-06.04 | Copy (§4.4, §6.1) |
| FR-06.05 | Draft → publish editing (§4.4) |
| FR-06.06, FR-06.11–12 | Deactivate/reactivate, immutable versions (§4.2, §4.4) |
| FR-06.07 | Versions (§4) |
| FR-06.08–10 | Drag-and-drop and "Move to…" (§7.2) |
| FR-07.01–02 | Global templates by category (§4.1, §4.3, §6.2, §8) |
| FR-07.03 | Create from a template (§6.1, §7.1) |
| FR-07.04 | Save as tenant template (§6.1) |
| FR-08.01 | Item types (§3) |
| FR-08.02–03 | `required` (§3); skipping optional items is enforced in sub-project 4 using `requirements` |
| FR-08.04 | Rules with nested follow-ups (§3) |
| FR-08.05, FR-12.03–06 | Evidence settings and rule requirements (§3) |
| FR-08.06 | `requirements()` (§3.3); enforced in sub-project 4 |
| FR-13.06 (data) | Weights, problem flags, scoring settings, `computeScore` (§3, §3.3) |
| FR-24.01–02 | Visual builder (§7.2) |
| FR-24.03 | Platform builder inside a tenant (§6.2, §7.1) |
| FR-24.04 | Out of scope (sub-project 9) |
| FR-26.02, NFR-07.01–02, NFR-07.06 | Audit actions (§6.3) |
| NFR-06.01–03, NFR-06.06 | Immutable versions, no deletes (§4.2) |

## 12. Open items for later sub-projects (not blockers)

- How sub-project 3 assignments pick a version: "always the current version at execution start" is assumed (§4.4).
- Per-item results storage keyed by node ID, and per-question reports (sub-projects 4, 7).
- Whether a critical problem flag triggers alerts by default or by tenant rule (sub-project 6, FR-15.09).
- Version diff view and an "N/A" answer, if customers ask.
