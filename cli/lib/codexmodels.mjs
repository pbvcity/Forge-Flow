// Codex accepts only full model slugs (gpt-6.2-sol), so `codex:sol` resolves the family to the newest
// slug Codex has listed. Several local Codex clients (CLI, desktop, IDE) rewrite ~/.codex/models_cache*.json
// and an older one lists older models, so every slug ever listed is kept in ~/.ff/codex-models-seen.json
// and an older client's rewrite cannot downgrade the choice.
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from './fsx.mjs';

const slugPattern = /^gpt-(\d+(?:\.\d+)*)-(.+)$/;
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

export const seenFile = (home = homedir()) => join(home, '.ff', 'codex-models-seen.json');
export const isFullSlug = name => /\d/.test(name);

export function compareVersions(a, b) {
  const x = a.split('.').map(Number), y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

const parse = slug => { const match = slug.match(slugPattern); return match && { slug, version: match[1], family: match[2] }; };
const newest = (slugs, family) => slugs.map(parse).filter(item => item?.family === family)
  .reduce((best, item) => !best || compareVersions(item.version, best.version) > 0 ? item : best, null)?.slug;

function caches(home, env) {
  const dir = env.CODEX_HOME || join(home, '.codex');
  let names = [];
  try { names = readdirSync(dir).filter(name => /^models_cache.*\.json$/.test(name)).sort(); } catch {}
  return names.map(name => {
    const value = readJson(join(dir, name));
    const slugs = (Array.isArray(value?.models) ? value.models : []).filter(model => model?.visibility !== 'hide' && typeof model?.slug === 'string').map(model => model.slug);
    return { file: join(dir, name), client: typeof value?.client_version === 'string' ? value.client_version : '', slugs };
  });
}

// Merges the caches into the record and returns every known slug with the caches it came from.
export function knownModels({ home = homedir(), env = process.env } = {}) {
  const found = caches(home, env);
  const recorded = readJson(seenFile(home))?.slugs;
  const slugs = new Set(Array.isArray(recorded) ? recorded.filter(slug => typeof slug === 'string') : []);
  const before = slugs.size;
  for (const cache of found) for (const slug of cache.slugs) slugs.add(slug);
  if (slugs.size !== before) {
    try { atomicWrite(seenFile(home), `${JSON.stringify({ updatedAt: new Date().toISOString(), slugs: [...slugs].sort() }, null, 2)}\n`); } catch {}
  }
  return { slugs: [...slugs], caches: found };
}

export function resolveCodexModel(name, options) {
  if (isFullSlug(name)) return { slug: name };
  const { slugs, caches: found } = knownModels(options);
  const slug = newest(slugs, name);
  if (slug) return { slug, family: name };
  if (!found.length && !slugs.length) return { error: `codex:${name}: no Codex model list yet (no ~/.codex/models_cache*.json). Start Codex once so it fetches the list, or use plain codex for the model in ~/.codex/config.toml, or pin a full slug such as codex:gpt-6.2-${name}.` };
  const families = [...new Set(slugs.map(parse).filter(Boolean).map(item => item.family))].sort();
  return { error: `codex:${name}: no known Codex model in family "${name}"${families.length ? `; known families: ${families.join(', ')}` : ''}.` };
}

// One row per family: the slug ff uses, and any cache whose list stops below it (an older client wrote it last).
export function familyReport(options) {
  const { slugs, caches: found } = knownModels(options);
  const families = [...new Set(slugs.map(parse).filter(Boolean).map(item => item.family))].sort();
  return families.map(family => {
    const slug = newest(slugs, family);
    const behind = found.filter(cache => cache.slugs.length && newest(cache.slugs, family) !== slug)
      .map(cache => ({ file: cache.file, client: cache.client, best: newest(cache.slugs, family) ?? 'none' }));
    return { family, slug, behind };
  });
}

// Codex names the model in its rejection ("The 'gpt-6.2-sol' model is not supported ..."), so only a line
// that names the resolved slug counts; a worker's own output about some other model does not.
const rejected = /not supported|not found|does not exist|unknown model|invalid model|unsupported model/i;
export const modelRejectedNote = (builder, text) => builder?.family && text.split(/\r?\n/).some(line => line.includes(builder.model) && rejected.test(line))
  ? `Codex rejected ${builder.model}, the newest ${builder.family} model ff has seen. If it was withdrawn, remove it from ${seenFile()}, or pin a full slug in the role (codex:<slug>).`
  : '';
