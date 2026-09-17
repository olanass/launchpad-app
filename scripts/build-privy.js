const esbuild = require('esbuild-wasm');
const path = require('path');

async function bundlePrivy() {
  console.log('⚡ Bundling official @privy-io/react-auth connector...');
  try {
    await esbuild.build({
      absWorkingDir: path.join(__dirname, '..'),
      tsconfigRaw: {},
      entryPoints: [path.join(__dirname, '..', 'packages', 'public', 'privy-bridge-src.jsx')],
      bundle: true,
      nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
      outfile: path.join(__dirname, '..', 'packages', 'public', 'privy-bridge.bundle.js'),
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
    console.log('✅ Successfully bundled Privy official bridge -> packages/public/privy-bridge.bundle.js');
  } catch (err) {
    console.error('❌ Build failed:', err);
    process.exit(1);
  }
}

bundlePrivy();
