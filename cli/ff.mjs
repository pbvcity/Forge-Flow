#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { doctor } from './lib/doctor.mjs';
import { init } from './lib/init.mjs';
import { status, runCard } from './lib/run.mjs';
import { review } from './lib/review.mjs';
import { audit } from './lib/audit.mjs';
import { docs } from './lib/docs.mjs';
import { council } from './lib/council.mjs';
import { runAll } from './lib/all.mjs';
import { update } from './lib/update.mjs';
import { archive } from './lib/archive.mjs';
import { notify } from './lib/notify.mjs';
import { protect } from './lib/protect.mjs';
import { stop } from './lib/stop.mjs';
import { wait } from './lib/wait.mjs';
import { cleanup } from './lib/cleanup.mjs';
import { wt } from './lib/worktree.mjs';
import { followups } from './lib/followups.mjs';
import { agents } from './lib/agents.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const commands = {
  doctor,
  init,
  status: args => status(process.cwd(), args),
  followups,
  agents: args => agents(args, root),
  stop,
  wait,
  run: args => args.includes('--all') ? runAll(args, root) : runCard(args, root),
  update,
  archive,
  cleanup,
  wt,
  notify,
  protect,
  review: args => review(args, root),
  audit,
  docs,
  council,
  version() {
    const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    console.log(version);
  },
};

const [name, ...args] = process.argv.slice(2);
if (!Object.hasOwn(commands, name ?? '')) {
  console.error(`usage: ff <${Object.keys(commands).join('|')}>`);
  process.exit(2);
}
try {
  if (Number(process.versions.node.split('.')[0]) < 22 && name !== 'doctor') {
    console.error('Node 22+ required'); process.exitCode = 1;
  } else process.exitCode = (await (name === 'doctor' ? commands[name]() : commands[name](args))) ?? 0;
} catch (error) {
  console.error(error.message); process.exitCode = 1;
}
