# Schema requests: calendar-integrations

## Access role of a provider calendar (free/busy only calendars)
- Table: `calendars`
- Change: add column `access_role text` (nullable, no default). Values for Google: `owner`, `writer`, `reader`,
  `freeBusyReader` (the calendarList `accessRole`); null for providers without one.
- Reason: docs/SCOPE.md priority 3 ("respect the owner's Google Calendar blocks exactly"). The owner's work calendar is
  shared into their Google account with "See only free/busy" (`accessRole: freeBusyReader`). Such a calendar must be
  listed and checked for conflicts, but its events cannot be read with `events.list`: its busy times come from the
  FreeBusy API, it can never be the calendar to add events to, and it gets no push channel and no change sync. The
  busy cache, the settings page, the push channel job and the change sync job all need to know which calendars are
  free/busy only, and `can_write` alone cannot tell a free/busy only calendar from a read-only one.
- Workaround in use: Google calendar rows carry the marker `google:freeBusyReader` in `calendars.ctag` (a CalDAV only
  column, always null for Google rows otherwise; CalDAV is out of scope). Every read and write of the flag goes through
  `src/lib/calendars/access.ts` (`isBusyOnlyCalendar`, `busyOnlyColumns`, `readableCalendarCondition`), so switching to
  the new column is a change to that file only.
- Data migration when the column lands:
  `update calendars set access_role = 'freeBusyReader', ctag = null where ctag = 'google:freeBusyReader';`
  (other Google rows get their role on the next calendar list refresh, every 6 hours or when the settings page opens).
- Backward compatible: yes (a new nullable column; the previous release ignores it).
