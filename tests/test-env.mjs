// Loaded by npm test before any test file. Fixtures give ff a temporary HOME, but CODEX_HOME
// would still point the Codex agent sync at a real Codex home, so the test run never carries it.
delete process.env.CODEX_HOME;
// The same for Claude Code: claude reviewers read model and effort from CLAUDE_CONFIG_DIR, so tests set their own.
delete process.env.CLAUDE_CONFIG_DIR;
