import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { readConfig } from './config.mjs';
import { excludeGitEntries, git } from './git.mjs';
import { planningDir, tempDir, worktreeRoot } from './paths.mjs';
import { runExcludes } from './run.mjs';

const nameOf = (cwd, path) => relative(cwd, path).replaceAll('\\', '/');
function readOptional(path) {
  try { return readFileSync(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw error; }
}

export async function initState(cwd, config) {
  const planning = nameOf(cwd, planningDir(cwd, config));
  const temp = nameOf(cwd, tempDir(cwd, config));
  const worktrees = nameOf(cwd, worktreeRoot(cwd, config));
  const rules = existsSync(join(cwd, 'AGENTS.md')) ? 'AGENTS.md' : existsSync(join(cwd, 'CLAUDE.md')) ? 'CLAUDE.md' : 'AGENTS.md';
  const text = readOptional(join(cwd, rules));
  const hasBlock = text.split(/\r?\n/).some(line => line.trimEnd() === '## Files and folders');
  const ignored = await git(cwd, ['check-ignore', '-q', `${temp}/x`]);
  return { planning, temp, worktrees, rules, text, hasBlock, tempIgnored: ignored.exitCode === 0 };
}

function rulesBlock({ planning, temp, worktrees }) {
  return `## Files and folders

- \`docs/\`: how the shipped system works. \`docs/README.md\` routes to each area's README. Update the doc a change made wrong before committing; \`ff docs\` lists candidates.
- \`${planning}/\`: plans, open decisions (\`DECISIONS.md\`), and dated follow-ups (\`FOLLOWUPS.md\`). Tracked.
- State lives in the plan, git, and \`ff status\`. After compaction or resume, reread the plan and run \`ff status\` before acting.
- \`${temp}/\` (git-ignored): throwaway work, sorted by kind: \`scripts/<task>/\`, \`logs/<task>/\`, \`scratch/<task>/\`, \`snapshots/\`, \`backups/\`. Nothing at its root, nothing outside the repository.
- Secrets live only in ignored files or the user's environment, never in \`docs/\`, \`${planning}/\`, or \`${temp}/\`.
- Worktrees: \`${worktrees}/<branch>/\`, branched from the latest main. Remove them after their branch merges: \`ff wt clean\`.
- Delete by exact path only. Never delete a path containing \`backup\`, \`bak\`, or \`备份\` without asking.
`;
}

export async function init(args = [], cwd = process.cwd()) {
  if (args.some(arg => arg !== '--apply')) throw new Error('usage: ff init [--apply]');
  const apply = args.includes('--apply');
  const { config } = readConfig(cwd);
  const state = await initState(cwd, config);
  const { planning, temp, worktrees, rules, text, hasBlock, tempIgnored } = state;
  console.log(`Planning: ${planning}/\nTemp: ${temp}/\nWorktrees: ${worktrees}/`);
  let changed = 0;
  for (const dir of ['docs', planning, temp, ...['scripts', 'logs', 'scratch', 'snapshots', 'backups', 'worktree-archive'].map(name => join(temp, name))]) {
    if (existsSync(join(cwd, dir))) continue;
    if (apply) mkdirSync(join(cwd, dir), { recursive: true });
    console.log(`${apply ? 'Created' : 'Would create'} ${dir}/`);
    changed++;
  }
  if (!tempIgnored) {
    if (apply) {
      const path = join(cwd, '.gitignore'), original = readOptional(path);
      appendFileSync(path, `${original && !original.endsWith('\n') ? '\n' : ''}/${temp}/\n`, 'utf8');
    }
    console.log(`${apply ? 'Appended' : 'Would append'} /${temp}/ to .gitignore`);
    changed++;
  } else console.log(`Temp already ignored: ${temp}/`);
  console.log(`${apply ? 'Ensuring' : 'Would ensure'} runtime entries in common git info/exclude: ${runExcludes.join(', ')}`);
  if (apply) await excludeGitEntries(cwd, runExcludes);
  if (hasBlock) console.log(`${rules}: Files and folders already present; unchanged`);
  else {
    if (apply) appendFileSync(join(cwd, rules), `${text ? text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n' : ''}${rulesBlock(state)}`, 'utf8');
    console.log(`${apply ? 'Appended' : 'Would append'} Files and folders to ${rules}`);
    changed++;
  }
  console.log(`${apply ? 'Initialized' : 'Preview'}: ${changed} directory/rules/ignore changes${apply ? '.' : '; no files changed. Use --apply to initialize.'}`);
  return 0;
}
