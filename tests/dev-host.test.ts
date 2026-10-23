import { expect, test } from 'vitest';
import { resolveConfig } from 'vite';
import { scripts } from '../package.json';

for (const command of ['dev', 'preview'] as const) {
  test(`${command} resolves to a loopback-only Vite listener`, async () => {
    const args = scripts[command].split(/\s+/);
    const hostIndex = args.indexOf('--host');
    const host = hostIndex < 0 ? undefined : args[hostIndex + 1] ?? true;
    const config = await resolveConfig({
      [command === 'dev' ? 'server' : 'preview']: { host },
    }, 'serve');
    const resolved = command === 'dev' ? config.server.host : config.preview.host;
    expect([undefined, 'localhost', '127.0.0.1', '::1']).toContain(resolved);
  });
}
