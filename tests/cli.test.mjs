import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ff = fileURLToPath(new URL('../cli/ff.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [ff, ...args], { encoding: 'utf8' });

test('version prints the package version', () => {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  const result = run('version');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), version);
});

test('an unknown command explains usage', () => {
  const result = run('nope');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /usage: ff/);
});
