// Loaded only for Forge Flow's Pi reviewers (`pi --no-extensions -e <this file>`), never from the package's extensions folder.
import { runGitRead } from './git-read.mjs';

export default function gitRead(pi) {
  pi.registerTool({
    name: 'git_read',
    label: 'Git (read-only)',
    description: 'Run one read-only git command in the project: log, show, blame, diff, ls-files, grep, rev-parse, or cat-file -p/-t/-s. Pass the arguments as an array starting with the subcommand, for example ["log", "--oneline", "-n", "20", "--", "src/app.js"]. No shell is used. Options that write files or run programs are refused. Long output is truncated.',
    promptSnippet: 'Read git history and diffs with read-only git commands (log, show, blame, diff, ls-files, grep, rev-parse, cat-file)',
    promptGuidelines: ['Use git_read for git history, blame, and diffs between commits; pass the git arguments as an array starting with the subcommand.'],
    parameters: {
      type: 'object',
      properties: {
        args: { type: 'array', items: { type: 'string' }, description: 'git arguments, starting with the subcommand, e.g. ["show", "HEAD~1", "--stat"]' },
      },
      required: ['args'],
      additionalProperties: false,
    },
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const result = await runGitRead(params?.args, { cwd: ctx?.cwd ?? process.cwd(), signal });
      return {
        content: [{ type: 'text', text: result.text }],
        details: { exitCode: result.exitCode ?? null, truncated: Boolean(result.truncated), refused: Boolean(result.refused) },
        ...(result.ok ? {} : { isError: true }),
      };
    },
  });
}
