import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from './git.mjs';
import { diffOptions } from './diff.mjs';

async function output(cwd, args) {
  const result = await git(cwd, args);
  if (result.exitCode !== 0 || result.timedOut || result.outputTruncated) {
    throw new Error(result.stderr || result.error || 'Git output unavailable or incomplete');
  }
  return result.stdout;
}

async function defaultBase(cwd) {
  const remotes = await output(cwd, ['remote']);
  if (!remotes.trim()) return 'HEAD~1';
  const head = await git(cwd, ['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD']);
  let ref = head.stdout.trim();
  if (!ref) {
    for (const name of ['main', 'master']) {
      const candidate = `refs/remotes/origin/${name}`;
      if ((await git(cwd, ['rev-parse', '--verify', candidate])).exitCode === 0) { ref = candidate; break; }
    }
  }
  if (!ref) throw new Error('Origin default branch unavailable; use --base <ref>');
  return (await output(cwd, ['merge-base', 'HEAD', ref])).trim();
}

function globPattern(glob) {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') { pattern += '(?:.*/)?'; i++; }
      else pattern += '.*';
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

export async function docsHints(cwd, base) {
  cwd = (await output(cwd, ['rev-parse', '--show-toplevel'])).trim();
  base ??= await defaultBase(cwd);
  const changed = new Set([
    ...(await output(cwd, ['diff', '--name-only', '-z', base, '--'])).split('\0'),
    ...(await output(cwd, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0'),
  ].filter(Boolean));
  const paths = (await output(cwd, ['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'docs/'])).split('\0');
  const covering = [], diagnostics = [];
  for (const path of new Set(paths.filter(path => /\.md$/i.test(path)))) {
    try {
      const patterns = readFileSync(join(cwd, path), 'utf8').split(/\r?\n/).slice(0, 20)
        .filter(line => line.startsWith('Covers:'))
        .flatMap(line => line.slice(7).split(',').map(glob => glob.trim()).filter(Boolean));
      if (patterns.length) covering.push({ path, patterns: patterns.map(globPattern) });
    } catch (error) {
      if (error.code !== 'ENOENT') diagnostics.push(`Docs unavailable (${path}): ${error.message}`);
    }
  }
  const updates = [], uncovered = [];
  for (const file of [...changed].sort()) {
    if (file.startsWith('docs/') || /\.md$/i.test(file)) continue;
    const matches = covering.filter(doc => doc.patterns.some(pattern => pattern.test(file)));
    if (!matches.length) uncovered.push(file);
    for (const doc of matches) if (!changed.has(doc.path)) updates.push(`update?  ${doc.path}  for ${file}`);
  }
  return { changed: [...changed].sort(), covered: covering.length > 0, updates, uncovered, diagnostics };
}

export async function docs(args, cwd = process.cwd()) {
  try {
    const base = args.length ? diffOptions(args).base : undefined;
    const result = await docsHints(cwd, base);
    for (const diagnostic of result.diagnostics) console.error(diagnostic);
    if (!result.covered) {
      console.log('No docs have Covers: lines in their first 20 lines.');
      const groups = new Map();
      for (const path of result.changed) {
        const group = path.includes('/') ? path.split('/')[0] : '(root)';
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push(path);
      }
      for (const [group, paths] of groups) {
        console.log(`${group}/:`);
        for (const path of paths) console.log(`  ${path}`);
      }
    } else {
      for (const line of result.updates) console.log(line);
      console.log(`no doc covers: ${result.uncovered.length}`);
      for (const path of result.uncovered.slice(0, 20)) console.log(`  ${path}`);
    }
  } catch (error) { console.error(`Docs unavailable: ${error.message}`); }
  return 0;
}
