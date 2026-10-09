# Scheduling & assignment — follow-ups

Items found while building sub-project 3 that are out of its scope. ⚑ marks the ones to look at first.

- ⚑ **Tenant timezone change.** Occurrences already generated keep their instants; only new ones use the new zone. Decide whether `PATCH /tenant` with a new timezone should regenerate future pending occurrences (like an assignment edit).
- ⚑ **Sub-project 4 must call `EligibilityService.canStart`** when a worker starts an occurrence, then move it to `started` through `OccurrenceWriter.recordTransitions` so history stays complete. `canStart` does not re-check the user's status today; SP4 must also refuse users who were deactivated since the snapshot was taken.
- **Assignee targeting by team, job title or whole site** (rest of FR-09.07) — not built; specific users only.
- **Per-site timezones** — not built; every site uses the tenant timezone.
- **Notifications** — `occurrence.status_changed` has no listeners yet (sub-project 6: FR-15.02/04/05/06).
- **Shift moved to another site** — `PATCH /shifts/:id` with a new `siteId` does not check existing roster rows or assignments at other sites.
- **Calendar (month grid) view** of occurrences — only a day/week list exists.
- **Shift hours change vs. window cap** — changing a shift's hours regenerates its assignments without re-checking the 24-hour window cap (FR-09.05/06), and the window length uses nominal minutes, so on DST nights the real window can differ by an hour.
- **"Copy to other sites" resets shift timing** — picking a site in the copied editor turns shift-based timing back into fixed timing (shifts may differ per site); keep it when the shift is available at the new site.
- **Roster save racing the cron materialise** — a roster save that commits while the cron is materialising can leave a newly created occurrence's assignee snapshot stale until the next roster change for that site and day.
- **Deactivating a site does not pause its assignments** — they keep generating occurrences; decide whether site deactivation should auto-pause like checklist deactivation does.
