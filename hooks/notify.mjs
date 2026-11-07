#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { handleHook } from '../cli/lib/notify.mjs';

try { await handleHook(JSON.parse(readFileSync(0, 'utf8'))); } catch {}
process.exit(0);
