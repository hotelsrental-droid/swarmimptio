#!/usr/bin/env node
// Tiny build step — copies the live widget.js into apps/site/public so Cloudflare Pages serves it.
// Keeps src/widget.js as the source of truth; site is just the deploy surface.

import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '../../..');

const src = resolve(repoRoot, 'src/widget.js');
const dst = resolve(__dirname, '../public/widget.js');

await mkdir(dirname(dst), { recursive: true });
await copyFile(src, dst);
console.log(`[swarm-site] copied widget.js → ${dst}`);
