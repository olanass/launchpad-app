const esbuild = require('esbuild');
const path = require('path');

async function bundlePrivy() {
  console.log('⚡ Bundling official @privy-io/react-auth connector...');
  try {
    await esbuild.build({
      entryPoints: [path.join(__dirname, '..', 'packages', 'public', 'privy-bridge-src.jsx')],
      bundle: true,
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
