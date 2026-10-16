# Schema change requests

Only the foundation changes the database schema (`src/db/**`) and the migrations (`drizzle/**`), and only the
foundation runs `npm run db:generate`: two agents generating migrations at the same time produce conflicting journal
entries (ARCHITECTURE section 5.1). Module agents never edit those paths.

## When a module needs a schema change

1. Write `docs/schema-requests/<module-id>.md` (one file per module; append to it if it exists) with, for every
   change:
   - **Table** and **columns** (name, type, nullability, default, foreign key and its `onDelete`), or the index or
     constraint (exact name, columns, partial `where` clause).
   - **Reason**: the requirement IDs (for example `SCH-19`) and why the existing schema cannot express it.
   - **Workaround in use**: what the module does until the change lands (see below), so the integrator can migrate
     existing data if needed.
   - **Expand and contract** impact: the change must be backward compatible with the previous release (new nullable
     columns or columns with defaults, new tables and indexes; no renames or drops in the same release; new enum values
     are added in one release and used in the next).
2. Keep working with the current schema:
   - Store extra fields in the `metadata` jsonb column of the main tables (`users`, `event_types`, `scheduled_events`,
     `invitees`) or the module's existing jsonb columns, under a key named after your module, for example
     `metadata.workflows.lastPreviewAt`. Type it in your own module.
   - Never create tables at runtime and never run DDL from module code.
3. Mention the request in your final report. The integrator applies accepted requests in the foundation schema files,
   regenerates the migration, and tells the module to switch from the workaround.

## Template

```markdown
# Schema requests: <module-id>

## <short title>
- Table: `<table>`
- Change: add column `<name> <type> [not null] [default ...]` / add index `<name>` on (...) [where ...]
- Reason: <requirement IDs and explanation>
- Workaround in use: <metadata key or other>
- Backward compatible: yes (<why>)
```
