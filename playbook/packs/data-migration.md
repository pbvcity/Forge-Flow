# Pack: data and migrations

Read when a change touches schema, stored data, bulk writes, or deletion. Treat production migrations as high tier.

## Before

- [ ] Back up, and confirm the backup restores. Check free disk first.
- [ ] Count affected rows read-only on the real data. Rule changes often affect zero or far more rows than expected.
- [ ] Read the real schema. Names and ORM models lie, so query the database's own catalog.
- [ ] Run on a copy with production-shaped data. Mocks hide query syntax, key ordering in JSON columns, and type coercion.
- [ ] Write down the way back, and how long it takes.
- [ ] Stop dev services that auto-sync schema before switching branches. A branch missing a table can drop it. Restart what you stopped.

## During

- Expand, migrate, contract. Old and new code should both run on the schema during rollout.
- Make steps idempotent and resumable, so a rerun after failure is safe.
- Batch large writes, with a lock timeout. Avoid long table locks on busy tables.
- A row lock only lasts for its transaction. Confirm the lock and the work share one.
- Add new required columns as nullable or with a default, backfill, then tighten.
- Log counts per batch. Do not log row contents, credentials, or personal data.

## After

- [ ] Compare before and after read-only: counts, sums, a sample, and URL or key sets where those matter.
- [ ] Exercise the real read and write paths once.
- [ ] Keep old data until an observation period passes. The user sets that period.

## Deleting

- Name exact targets and list them before acting. No wildcards, and no targets built by a command.
- An empty filter deletes nothing. Test zero, negative, and missing values for any computed cutoff.
- List links before recursive deletion. Following one removes what it points at.
- Before cleanup, keep every path that unfinished work refers to.
- Judge a backup by its content. Ask before deleting one.

## Bulk file edits

- Assert line counts before writing back, and check each result. A dropped slice can silently remove thousands of lines.

## Stops

Ask the user before irreversible production writes, deleting data they own, or changing retention. Data shape choices with business meaning, such as what counts as an active customer, are theirs too.
