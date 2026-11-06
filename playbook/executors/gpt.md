# Executor profile: GPT family

Strong at deep code tracing and real probes. The usual failure is doing too much.

- Do the least process that fits. Do not write plan or review files for a clear single change.
- Implement exactly what the card asks, with the smallest diff. Leave style, unrelated refactors, and existing error semantics alone.
- Add no validation, config, state, retry, error code, or abstraction unless the task asks for it.
- For any check you do add, write the specific loss it prevents in the report. If you cannot name one, remove it.
- On a bad item, skip it, keep a diagnostic, and continue. Fail the whole run only for losses the card names.
- Leave rules an external platform enforces to that platform. Validate only response fields you use, against official docs.
- Use a real parser for Markdown, URLs, and HTML.
- Invent no blocking criteria. Business values you had to choose go in `DECISIONS.md`.
- Stop only for what the card lists.
- After fixing a case, sweep for the same pattern.
