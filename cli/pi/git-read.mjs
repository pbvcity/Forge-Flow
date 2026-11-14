// Read-only git for Pi reviewers. The Pi extension next to this file registers it as the `git_read` tool.
// Arguments arrive as an array and go to git without a shell. Subcommands and options are allowlisted:
// anything not listed is refused, so options that write files or run programs never reach git.
import { spawn } from 'node:child_process';
import { projectGitEnv } from '../lib/git.mjs';

export const gitReadLimit = { bytes: 256 * 1024, args: 64, argChars: 1000, timeoutMs: 60000, setupMs: 10000 };

const history = [
  '--oneline', '--format', '--pretty', '--abbrev-commit', '--no-abbrev-commit', '--abbrev', '--graph', '--decorate', '--no-decorate',
  '--all', '--branches', '--tags', '--remotes', '--max-count', '-n', '--skip', '--since', '--until', '--after', '--before',
  '--author', '--committer', '--grep', '-i', '--regexp-ignore-case', '--invert-grep', '--all-match', '-S', '-G', '--pickaxe-regex',
  '--pickaxe-all', '--follow', '--first-parent', '--merges', '--no-merges', '--reverse', '--date', '--relative-date', '--parents',
  '--children', '--topo-order', '--date-order', '--author-date-order', '--full-history', '--simplify-by-decoration', '--left-right',
  '--cherry-pick', '--cherry-mark', '--boundary', '--source', '--use-mailmap', '--no-walk', '--ancestry-path', '-L', '--no-patch', '-s',
];
const patch = [
  '-p', '--patch', '-u', '-U', '--unified', '--stat', '--numstat', '--shortstat', '--name-only', '--name-status', '--summary', '--raw',
  '--dirstat', '--find-renames', '-M', '--find-copies', '--no-renames', '--ignore-all-space', '-w', '--ignore-space-change', '-b',
  '--ignore-blank-lines', '--ignore-space-at-eol', '--word-diff', '--word-diff-regex', '--minimal', '--patience', '--histogram',
  '--diff-algorithm', '--full-index', '--no-prefix', '--src-prefix', '--dst-prefix', '--relative', '--diff-filter', '--function-context',
  '-W', '--inter-hunk-context', '--text', '-a', '--no-color', '--color', '-z', '--exit-code', '--quiet', '--check', '--merge-base', '-R',
];
const options = {
  log: [...history, ...patch],
  show: [...history, ...patch],
  diff: [...patch, '--cached', '--staged'],
  blame: ['-L', '-l', '-t', '-s', '-e', '-w', '-M', '--porcelain', '--line-porcelain', '--incremental', '--root', '--show-stats',
    '--show-name', '--show-number', '--date', '--reverse', '--first-parent', '--abbrev', '--ignore-rev', '-f', '-n'],
  'ls-files': ['--cached', '--deleted', '-d', '--modified', '-m', '--others', '--ignored', '-i', '--stage', '-s', '--exclude-standard',
    '--directory', '--full-name', '--error-unmatch', '-z', '-t', '--abbrev', '--format', '--exclude', '-x'],
  grep: ['-n', '--line-number', '-i', '--ignore-case', '-w', '--word-regexp', '-v', '--invert-match', '-l', '--files-with-matches',
    '-L', '--files-without-match', '--count', '-e', '-E', '--extended-regexp', '-F', '--fixed-strings', '-P', '--perl-regexp', '-G',
    '--basic-regexp', '-h', '-H', '--full-name', '-I', '--untracked', '--cached', '-A', '-B', '--context', '--after-context',
    '--before-context', '--only-matching', '--max-depth', '--heading', '--break', '--and', '--or', '--not', '--all-match', '-q', '--quiet',
    '-z', '--column', '--show-function', '-p', '--function-context', '-W', '--exclude-standard', '--no-exclude-standard'],
  'rev-parse': ['--abbrev-ref', '--short', '--verify', '--show-toplevel', '--show-prefix', '--is-inside-work-tree', '--symbolic-full-name',
    '--all', '--branches', '--tags', '--quiet', '-q', '--default'],
  'cat-file': ['-p', '-t', '-s'],
};
// Options that git gives a required value, per subcommand. A short one takes the next argument or an attached value (-n5);
// a long one only `--name=value`, so no argument is skipped unchecked. Git bundles other short options (`grep -nO<program>`
// would run a program), so attached text is refused anywhere else.
const historyTakes = ['-n', '--max-count', '--skip', '--since', '--until', '--after', '--before', '--author', '--committer', '--grep', '-S', '-G', '-L'];
const patchTakes = ['--diff-algorithm', '--word-diff-regex', '--src-prefix', '--dst-prefix', '--diff-filter', '--inter-hunk-context'];
const takes = {
  log: [...historyTakes, ...patchTakes], show: [...historyTakes, ...patchTakes], diff: patchTakes,
  blame: ['-L', '--ignore-rev'], 'ls-files': ['--exclude', '-x'], 'rev-parse': ['--default'], 'cat-file': [],
  grep: ['-e', '-A', '-B', '--context', '--after-context', '--before-context', '--max-depth'],
};
// Options with an optional value, only ever attached (`--date=short`, `-M50%`).
const optionalValue = ['--abbrev', '--date', '--color', '--word-diff', '--find-renames', '--find-copies', '--dirstat', '--relative',
  '--decorate', '--stat', '--format', '--pretty', '--short', '--abbrev-ref', '-M', '-U', '--unified'];
// Named only to give a clearer refusal; the allowlist already keeps them out.
const dangerous = new Set(['--output', '-o', '--ext-diff', '--textconv', '-c', '--exec', '--upload-pack', '--receive-pack', '-C', '--git-dir',
  '--work-tree', '--open-files-in-pager', '-O', '--show-signature', '--no-index', '--config-env', '--exec-path', '--paginate', '--output-directory']);

// Returns { args } (the subcommand and its arguments, with output guards) or { error }.
export function gitReadArgs(input) {
  if (!Array.isArray(input) || !input.length) return { error: 'args must be a non-empty array, starting with the subcommand' };
  if (input.length > gitReadLimit.args) return { error: `at most ${gitReadLimit.args} arguments` };
  if (input.some(arg => typeof arg !== 'string' || arg.includes('\0') || arg.length > gitReadLimit.argChars)) return { error: `every argument must be a string under ${gitReadLimit.argChars} characters` };
  const [command, ...rest] = input;
  const allowed = options[command];
  if (!allowed) return { error: `subcommand ${JSON.stringify(command)} is not allowed; use one of ${Object.keys(options).join(', ')}` };
  if (command === 'cat-file' && !(rest.length === 2 && allowed.includes(rest[0]) && !rest[1].startsWith('-'))) return { error: 'cat-file takes exactly one of -p, -t, -s and an object' };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--') break;
    if (!arg.startsWith('-') || arg === '-') continue;
    if (/^-\d+$/.test(arg) && ['log', 'show'].includes(command)) continue;
    const name = arg.startsWith('--') ? arg.split('=')[0] : arg.slice(0, 2);
    if (dangerous.has(name) || dangerous.has(arg)) return { error: `${name} is not allowed: it can write files or run programs` };
    if (!allowed.includes(name)) return { error: `option ${name} is not allowed for git ${command}` };
    const attached = arg.startsWith('--') ? arg.includes('=') : arg.length > 2;
    const take = takes[command].includes(name);
    if (attached && !take && !optionalValue.includes(name)) return { error: `${arg}: ${name} takes no value here; write short options separately` };
    // %G placeholders make git verify signatures, which starts gpg or ssh-keygen.
    if (['--format', '--pretty'].includes(name) && /%G/.test(arg)) return { error: `${name} with a %G placeholder runs signature verification; leave it out` };
    if (!attached && take) {
      if (name.startsWith('--')) return { error: `write ${name}=<value>` };
      if (i + 1 >= rest.length) return { error: `${name} needs a value` };
      const value = rest[++i];
      // Git reads this as the value, but refuse anything that would be dangerous if a Git version read it as an option.
      if (value.startsWith('-') && (dangerous.has(value.split('=')[0]) || dangerous.has(value.slice(0, 2)))) return { error: `the value of ${name} looks like the refused option ${value.split('=')[0]}` };
    }
  }
  const guard = { log: ['--no-ext-diff', '--no-textconv'], show: ['--no-ext-diff', '--no-textconv'], diff: ['--no-ext-diff', '--no-textconv'], blame: ['--no-textconv'], grep: ['--no-textconv'] }[command] ?? [];
  return { command, args: [command, ...guard, ...rest] };
}

// Repository config can name programs that even read commands start. These settings switch off the ones git_read knows of:
// fsmonitor hooks, signature checks and their programs (gpg, gpgsm, ssh-keygen), and every configured clean/smudge/process
// filter. They go through GIT_CONFIG_COUNT (Git 2.31+), where key and value are separate, so a filter name containing `=`
// cannot escape. A program name that does not exist makes any signature check fail instead of running something.
export const noProgram = 'ff-git-read-no-program';
export function gitReadConfig(filterNames = []) {
  const settings = [['core.fsmonitor', 'false'], ['log.showSignature', 'false'],
    ['gpg.program', noProgram], ['gpg.openpgp.program', noProgram], ['gpg.x509.program', noProgram], ['gpg.ssh.program', noProgram]];
  for (const name of filterNames) settings.push([`filter.${name}.clean`, ''], [`filter.${name}.smudge`, ''], [`filter.${name}.process`, ''], [`filter.${name}.required`, 'false']);
  const env = { GIT_CONFIG_COUNT: String(settings.length) };
  settings.forEach(([key, value], index) => { env[`GIT_CONFIG_KEY_${index}`] = key; env[`GIT_CONFIG_VALUE_${index}`] = value; });
  return env;
}

// The empty tree of the repository's hash as the attribute source turns off filters, diff drivers, and textconv on Git 2.40+;
// older Git ignores it, which is why filters are also overridden by name. GIT_NO_LAZY_FETCH stops a partial clone from fetching (Git 2.44+).
export const emptyTrees = { sha1: '4b825dc642cb6eb9a060e54bf8d69288fbee4904', sha256: '6ef19b41225c5369f1c104d45d8d85efa9b057b53b14b4b9b939dd74decc5321' };
export const gitReadEnv = format => {
  const env = { ...projectGitEnv(process.env), GIT_OPTIONAL_LOCKS: '0', GIT_PAGER: 'cat', PAGER: 'cat', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' };
  if (emptyTrees[format]) env.GIT_ATTR_SOURCE = emptyTrees[format];
  delete env.GIT_EXTERNAL_DIFF;
  return env;
};

// A short git query for setup. Resolves { stdout } or { error } on failure, timeout, or abort.
function gitQuery(args, { cwd, env = gitReadEnv(), signal, timeoutMs = gitReadLimit.setupMs }) {
  return new Promise(done => {
    if (signal?.aborted) { done({ error: 'cancelled' }); return; }
    const child = spawn('git', args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const out = [];
    let settled = false;
    const finish = result => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener?.('abort', abort); done(result); };
    const abort = () => { try { child.kill(); } catch {} finish({ error: 'cancelled' }); };
    const timer = setTimeout(() => { try { child.kill(); } catch {} finish({ error: `git ${args[0]} timed out` }); }, timeoutMs);
    signal?.addEventListener?.('abort', abort, { once: true });
    child.stdout.on('data', chunk => out.push(chunk));
    child.on('error', error => finish({ error: error.message }));
    child.on('close', code => finish({ stdout: Buffer.concat(out).toString('utf8'), code }));
  });
}

const formats = new Map();
export async function objectFormat(cwd, options = {}) {
  if (formats.has(cwd)) return formats.get(cwd);
  const result = await gitQuery(['rev-parse', '--show-object-format'], { cwd, ...options });
  const format = result.code === 0 && result.stdout.trim() === 'sha256' ? 'sha256' : 'sha1';
  if (result.code === 0) formats.set(cwd, format);
  return format;
}

// `git config --get-regexp` exits 1 when nothing matches, which is not an error.
async function filterNames(cwd, options) {
  const result = await gitQuery(['config', '-z', '--get-regexp', '^filter\\..+\\.(clean|smudge|process)$'], { cwd, ...options });
  if (result.error) return result;
  return { names: [...new Set(result.stdout.split('\0')
    .map(entry => /^filter\.([\s\S]+)\.(?:clean|smudge|process)$/i.exec(entry.split('\n')[0])?.[1]).filter(Boolean))] };
}

// Runs a validated git read in cwd with bounded output. Never throws for git's own failures.
// It does not run git at all when the filter list cannot be read, because the filters could then not be switched off.
export async function runGitRead(input, { cwd, signal, limit = gitReadLimit.bytes, timeoutMs = gitReadLimit.timeoutMs, setupMs = gitReadLimit.setupMs } = {}) {
  const checked = gitReadArgs(input);
  if (checked.error) return { ok: false, refused: true, text: `git_read refused: ${checked.error}` };
  const query = { env: gitReadEnv(), signal, timeoutMs: setupMs };
  const filters = await filterNames(cwd, query);
  if (filters.error) return { ok: false, text: `git_read did not run git: could not read the repository's filter settings (${filters.error})` };
  const env = { ...gitReadEnv(await objectFormat(cwd, query)), ...gitReadConfig(filters.names) };
  const args = ['--no-pager', ...checked.args];
  return new Promise(done => {
    const child = spawn('git', args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    let size = 0, truncated = false, finished = false;
    const stop = () => { try { child.kill(); } catch {} };
    const timer = setTimeout(stop, timeoutMs);
    signal?.addEventListener?.('abort', stop, { once: true });
    child.stdout.on('data', chunk => {
      if (truncated) return;
      if (size + chunk.length > limit) { out.push(chunk.subarray(0, limit - size)); size = limit; truncated = true; stop(); return; }
      out.push(chunk); size += chunk.length;
    });
    child.stderr.on('data', chunk => { if (err.reduce((sum, part) => sum + part.length, 0) < 16384) err.push(chunk); });
    const finish = (code, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(out).toString('utf8');
      const stderr = Buffer.concat(err).toString('utf8').trim();
      const ok = truncated || (code === 0 && !error);
      const notes = [
        truncated ? `[git_read: output truncated at ${limit} bytes; narrow the command with paths, -n, or -L to see the rest]` : '',
        !ok ? `[git exited ${error ? `with an error: ${error}` : code}]${stderr ? `\n${stderr}` : ''}` : '',
      ].filter(Boolean);
      done({ ok, truncated, exitCode: code, text: [stdout, ...notes].filter(Boolean).join('\n') || '(no output)' });
    };
    child.on('error', error => finish(null, error.message));
    child.on('close', code => finish(code));
  });
}
