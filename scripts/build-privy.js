const esbuild = require('esbuild-wasm');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const clientDir = path.join(projectRoot, 'src', 'client');

async function bundlePrivy() {
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
    console.log('Privy bridge created at src/client/generated/privy-bridge.bundle.js');
  } catch (err) {
    console.error('Privy bridge build failed:', err);
    process.exit(1);
  }
}

bundlePrivy();
