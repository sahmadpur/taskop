# Scheduling & assignment — follow-ups

Items found while building sub-project 3 that are out of its scope. ⚑ marks the ones to look at first.

- ⚑ **Tenant timezone change.** Occurrences already generated keep their instants; only new ones use the new zone. Decide whether `PATCH /tenant` with a new timezone should regenerate future pending occurrences (like an assignment edit).
- ⚑ **Sub-project 4 must call `EligibilityService.canStart`** when a worker starts an occurrence, then move it to `started` through `OccurrenceWriter.recordTransitions` so history stays complete.
- **Assignee targeting by team, job title or whole site** (rest of FR-09.07) — not built; specific users only.
- **Per-site timezones** — not built; every site uses the tenant timezone.
- **Notifications** — `occurrence.status_changed` has no listeners yet (sub-project 6: FR-15.02/04/05/06).
- **Shift moved to another site** — `PATCH /shifts/:id` with a new `siteId` does not check existing roster rows or assignments at other sites.
- **Calendar (month grid) view** of occurrences — only a day/week list exists.
