import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';

// Shared attachment helpers import legacy configuration. Neutral constants keep
// that module usable without loading the receiving release's .env or credentials.
const legacyDefaults = { AUTH_BASE_URL: '', AUTH_USERNAME: '', AUTH_PASSWORD: '', AI_PROVIDER: '', ROUTER_BASE_URL: '', ROUTER_API_KEY: '', ROUTER_POLL_INTERVAL_MS: '1500', ROUTER_TIMEOUT_MS: '330000' };
const result = await esbuild.build({ entryPoints: ['src/outgoing/index.js'], bundle: true, write: false,
    format: 'iife', target: 'es2020', define: Object.fromEntries(Object.entries(legacyDefaults).map(([key, value]) => [`process.env.${key}`, JSON.stringify(value)])) });
const meta = await fs.readFile('src/outgoing/meta.js', 'utf8');
await fs.mkdir('dist', { recursive: true });
await fs.writeFile('dist/idesk_outgoing.user.js', meta.trim() + '\n\n' + result.outputFiles[0].text);
console.log('Built dist/idesk_outgoing.user.js');
