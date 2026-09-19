const esbuild = require('esbuild-wasm');
const fs = require('fs');
const path = require('path');
const { buildDocs } = require('./build-docs');

const projectRoot = path.resolve(__dirname, '..');
const clientDir = path.join(projectRoot, 'src', 'client');
const publicDir = path.join(projectRoot, 'public');

async function buildClient() {
  await buildDocs();
  console.log('Bundling the @privy-io/react-auth connector...');
  try {
    await esbuild.build({
      absWorkingDir: projectRoot,
      tsconfigRaw: {},
      entryPoints: [path.join(clientDir, 'integrations', 'privy-bridge.jsx')],
      bundle: true,
      nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
      outfile: path.join(clientDir, 'generated', 'privy-bridge.bundle.js'),
      format: 'iife',
      globalName: 'PrivyBridge',
      platform: 'browser',
      define: {
        'process.env.NODE_ENV': '"production"',
        'global': 'window'
      },
      minify: true,
      sourcemap: false
    });

    fs.rmSync(publicDir, { recursive: true, force: true });
    fs.cpSync(clientDir, publicDir, { recursive: true });

    console.log('Privy bridge created at src/client/generated/privy-bridge.bundle.js');
    console.log('Vercel static assets copied to public/.');
  } catch (err) {
    console.error('Client build failed:', err);
    process.exitCode = 1;
  }
}

buildClient();
