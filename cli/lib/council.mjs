import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readConfig } from './config.mjs';
import { atomicWrite } from './fsx.mjs';
import { excludeGitEntries } from './git.mjs';
import { runProcess } from './proc.mjs';
import { redactSecrets, resolveReviewer } from './review.mjs';
import { newId } from './run.mjs';

const instructions = `You are one of several independent advisers on a decision. You cannot see the others. Work read-only.

Read what the question points to. Then answer with:
- Recommendation: one option, or a better one you found.
- Why: the evidence, with file paths or sources you checked.
- Strongest case against your recommendation.
- What would change your mind.
- Confidence, and what it rests on.

Disagree with the framing if it is wrong. Say plainly what you do not know.

## Question
`;

function parseArgs(args) {
  const options = { file: '', members: [], minutes: 60 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--members') options.members = String(args[++i]).split(',').map(item => item.trim()).filter(Boolean);
    else if (args[i] === '--timeout-min') options.minutes = Number(args[++i]);
    else if (!options.file && !args[i].startsWith('--')) options.file = args[i];
    else throw new Error(`Unknown council option: ${args[i]}`);
  }
  if (!options.file) throw new Error('usage: ff council <question file> [--members <a,b,c>] [--timeout-min <minutes>]');
  if (!(options.minutes > 0 && Number.isFinite(options.minutes))) throw new Error('--timeout-min must be a positive number');
  return options;
}

export async function council(args, cwd = process.cwd()) {
  const options = parseArgs(args);
  const prompt = redactSecrets(instructions + readFileSync(resolve(cwd, options.file), 'utf8'));
  const { config } = readConfig(cwd);
  const configured = options.members.length ? options.members : config.review.panel?.length ? config.review.panel : [config.roles.reviewer, config.roles.second];
  const members = [...new Set(configured.filter(member => member && member !== 'host'))];
  if (!members.length) { console.error('No headless members are configured. Use read-only host sub-agents with this question.'); return 3; }
  await excludeGitEntries(cwd, ['**/.ff/councils/']);
  const dir = join(cwd, '.ff/councils', newId());
  const answers = await Promise.all(members.map(async (member, index) => {
    const executor = resolveReviewer(config, member);
    if (executor.note) return { member, status: 'absent', note: executor.note };
    const result = await runProcess(executor.command, executor.args, { cwd, input: prompt, timeoutMs: options.minutes * 60000 });
    const answered = result.exitCode === 0 && !result.timedOut && !result.error && result.stdout.trim();
    const file = join(dir, `${index + 1}-${member.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 70)}.md`);
    atomicWrite(file, redactSecrets(result.stdout + (answered ? '' : `\n${result.stderr}`)));
    return { member, status: answered ? 'answered' : 'failed', file };
  }));
  for (const answer of answers) console.log(`${answer.member}: ${answer.status}${answer.file ? ` — ${answer.file}` : ''}${answer.note ? ` — ${answer.note}` : ''}`);
  if (members.length < 2) console.log('Only one member: this is not an independent view.');
  return answers.some(answer => answer.status === 'answered') ? 0 : 2;
}
