import assert from 'node:assert/strict';
import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';

await access('dist/index.html');
const output = '.cloudflare/output/v0/workers/heatsim';
await rm(output, { recursive: true, force: true });
await mkdir(`${output}/bundle`, { recursive: true });
await cp('dist', `${output}/assets`, { recursive: true });
const config = {
  name: 'heatsim',
  accountId: '2132f9cf03d557cc3be87ca4208e683d',
  compatibilityDate: '2026-10-15',
  domains: ['heatsim.sillyapps.co'],
  workersDev: false,
  previewUrls: false,
};
await writeFile(`${output}/worker.config.json`, `${JSON.stringify(config, null, 2)}\n`);
assert.equal(await readFile(`${output}/assets/index.html`, 'utf8'), await readFile('dist/index.html', 'utf8'));
console.log('Static build prepared for cf deploy --prebuilt.');
