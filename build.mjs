import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

function loadEnv() {
    const envPath = path.join(process.cwd(), '.env');
    const envVars = {};
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const line of content.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx > 0) {
                const key = trimmed.slice(0, eqIdx).trim();
                let val = trimmed.slice(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                envVars[key] = val;
            }
        }
    }
    return envVars;
}

async function build() {
    const metaContent = fs.readFileSync(path.join(process.cwd(), 'src', 'meta.js'), 'utf-8');
    const envVars = loadEnv();

    const authBaseUrl = process.env.AUTH_BASE_URL || envVars.AUTH_BASE_URL || 'http://localhost:5000';
    const authUsername = process.env.AUTH_USERNAME || envVars.AUTH_USERNAME || 'fe-server-prod';
    const authPassword = process.env.AUTH_PASSWORD || envVars.AUTH_PASSWORD || 'secret_password';
    const aiProvider = process.env.AI_PROVIDER || envVars.AI_PROVIDER || 'local-router';
    const routerBaseUrl = process.env.ROUTER_BASE_URL || envVars.ROUTER_BASE_URL || 'http://127.0.0.1:8000';
    const routerApiKey = process.env.ROUTER_API_KEY || envVars.ROUTER_API_KEY || '';
    const routerPollIntervalMs = process.env.ROUTER_POLL_INTERVAL_MS || envVars.ROUTER_POLL_INTERVAL_MS || '1500';
    const routerTimeoutMs = process.env.ROUTER_TIMEOUT_MS || envVars.ROUTER_TIMEOUT_MS || '330000';

    const result = await esbuild.build({
        entryPoints: ['./src/index.js'],
        bundle: true,
        write: false,
        format: 'iife',
        minify: false,
        target: 'es2020',
        define: {
            'process.env.AUTH_BASE_URL': JSON.stringify(authBaseUrl),
            'process.env.AUTH_USERNAME': JSON.stringify(authUsername),
            'process.env.AUTH_PASSWORD': JSON.stringify(authPassword),
            'process.env.AI_PROVIDER': JSON.stringify(aiProvider),
            'process.env.ROUTER_BASE_URL': JSON.stringify(routerBaseUrl),
            'process.env.ROUTER_API_KEY': JSON.stringify(routerApiKey),
            'process.env.ROUTER_POLL_INTERVAL_MS': JSON.stringify(routerPollIntervalMs),
            'process.env.ROUTER_TIMEOUT_MS': JSON.stringify(routerTimeoutMs)
        }
    });

    const code = result.outputFiles[0].text;
    const warningBanner = `
// ==============================================================================
// ⚠️ FILE TỰ ĐỘNG SINH RA (AUTO-GENERATED BUNDLE). KHÔNG SỬA TRỰC TIẾP FILE NÀY!
// 💡 Vui lòng sửa code tại các file module trong thư mục src/ (vd: src/config.js,
//    src/services/ai.js, src/ui/dashboard.js...), sau đó gõ "pnpm run build".
// ==============================================================================
`;
    const finalScript = metaContent.trim() + '\n' + warningBanner + '\n' + code;

    const targetPath = path.join(process.cwd(), 'src', 'idesk_automation.user.js');
    fs.writeFileSync(targetPath, finalScript, 'utf-8');

    // Also output to dist/
    const distDir = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(distDir)) {
        fs.mkdirSync(distDir, { recursive: true });
    }
    fs.writeFileSync(path.join(distDir, 'idesk_automation.user.js'), finalScript, 'utf-8');

    console.log(' Successfully built idesk_automation.user.js');
}

build().catch(err => {
    console.error(' Build failed:', err);
    process.exit(1);
});
