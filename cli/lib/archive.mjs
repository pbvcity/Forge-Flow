import { constants, copyFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { readConfig } from './config.mjs';
import { planPath, planningDir } from './paths.mjs';
import { readPlan } from './plan.mjs';

export function archive(args = [], cwd = process.cwd()) {
  let path, force = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--force') force = true;
    else if (args[i] === '--plan') {
      path = args[++i];
      if (!path || path.startsWith('--')) throw new Error('--plan needs a path');
    } else throw new Error(`Unknown archive option: ${args[i]}`);
  }
  const { config } = readConfig(cwd);
  path = planPath(cwd, config, path);
  const plan = readPlan(cwd, path);
  if (!force && plan.tasks.some(task => !task.done)) {
    throw new Error(`${path} has unticked tasks; finish them or use --force to archive anyway.`);
  }
  const source = resolve(cwd, path), directory = join(planningDir(cwd, config), 'done');
  mkdirSync(directory, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  for (let suffix = 1; ; suffix++) {
    const destination = join(directory, `PLAN-${date}${suffix === 1 ? '' : `-${suffix}`}.md`);
    try {
      copyFileSync(source, destination, constants.COPYFILE_EXCL);
    } catch (error) {
      if (error.code === 'EEXIST') continue;
      throw error;
    }
    unlinkSync(source);
    console.log(`Archived ${path} to ${destination}`);
    return 0;
  }
}
