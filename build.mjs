import * as esbuild from 'esbuild';
import fs from 'node:fs/promises';

async function build() {
    const result = await esbuild.build({
        entryPoints: ['src/outgoing/index.js'],
        bundle: true,
        write: false,
        format: 'iife',
        target: 'es2020'
    });

    const meta = await fs.readFile('src/outgoing/meta.js', 'utf8');
    await fs.mkdir('dist', { recursive: true });
    await fs.writeFile('dist/idesk_outgoing.user.js', meta.trim() + '\n\n' + result.outputFiles[0].text);
    console.log('Successfully built dist/idesk_outgoing.user.js');
}

build().catch(err => {
    console.error('Build failed:', err);
    process.exit(1);
});
