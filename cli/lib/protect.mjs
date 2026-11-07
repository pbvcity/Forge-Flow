import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { git } from './git.mjs';

const MARKER = '# forge-flow protect';
const HOOK = 'hooks/commit-msg';

function hookText(branches) {
  return `#!/bin/sh
${MARKER}
[ -n "$FF_ALLOW_MAIN" ] && exit 0
branch=$(git symbolic-ref --short -q HEAD) || exit 0
case "$branch" in
  ${branches.join('|')}) ;;
  *) exit 0 ;;
esac
first=$(sed -n '/^[^#]/{p;q;}' "$1")
case "$first" in
  docs:*|docs\\(*|Merge\\ *) exit 0 ;;
esac
echo "Commit refused on $branch. Work on a branch, or start the message with docs: for a docs-only change." >&2
echo "To override once: FF_ALLOW_MAIN=1 git commit ..." >&2
exit 1
`;
}

async function hookFile(cwd) {
  const result = await git(cwd, ['rev-parse', '--git-path', HOOK]);
  return result.exitCode === 0 ? resolve(cwd, result.stdout.trim()) : null;
}

export async function protectionState(cwd) {
  const file = await hookFile(cwd);
  if (!file) return 'not a git repository';
  if (!existsSync(file)) return 'off';
  const text = readFileSync(file, 'utf8');
  return text.includes(MARKER) ? `on (${text.match(/^ {2}(.+)\) ;;$/m)?.[1].split('|').join(', ')})` : 'another commit-msg hook is installed';
}

async function originDefault(cwd) {
  const result = await git(cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD']);
  return result.exitCode === 0 ? [result.stdout.trim().replace(/^origin\//, '')] : [];
}

export async function protect(args, cwd = process.cwd()) {
  const file = await hookFile(cwd);
  if (!file) { console.error('Not a git repository.'); return 1; }
  const ours = existsSync(file) && readFileSync(file, 'utf8').includes(MARKER);
  if (args[0] === '--status') { console.log(`Branch protection: ${await protectionState(cwd)}`); return 0; }
  if (args[0] === '--remove') {
    if (ours) rmSync(file);
    console.log(ours ? 'Branch protection removed.' : 'Branch protection was not installed.');
    return 0;
  }
  const extra = [];
  for (let index = 0; index < args.length; index += 2) {
    if (args[index] !== '--branch' || !/^[\w./-]+$/.test(args[index + 1] ?? '')) { console.error('usage: ff protect [--branch <name>]... | --status | --remove'); return 2; }
    extra.push(args[index + 1]);
  }
  if (existsSync(file) && !ours) { console.error(`${file} already exists and is not ours. Add the check to it by hand, or move it aside.`); return 1; }
  mkdirSync(dirname(file), { recursive: true });
  const branches = [...new Set(['main', 'master', ...await originDefault(cwd), ...extra])];
  writeFileSync(file, hookText(branches));
  chmodSync(file, 0o755);
  const hooksPath = (await git(cwd, ['config', 'core.hooksPath'])).stdout.trim();
  const reach = hooksPath && !isAbsolute(hooksPath) ? 'only this worktree, because core.hooksPath is relative. Run it in each other worktree' : 'every worktree of this repository';
  console.log(`Branch protection on for ${branches.join(', ')}. It covers ${reach}.`);
  return 0;
}
