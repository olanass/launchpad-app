/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingIncludes: {
    '/api/\\[\\[...path\\]\\]': ['src/client/index.html', 'src/client/generated/llms.txt', 'src/client/generated/docs-markdown/**/*'],
    '/*': ['src/client/index.html']
  },
  async rewrites() {
    const apiRewrites = ['x402', 'facilitator', 'discovery', 'agent-runner', 'mcp'].map(prefix => ({
      source: `/${prefix}/:path*`, destination: `/api/_gateway/${prefix}/:path*`
    }));
    const clientAssetRewrites = ['assets', 'generated', 'integrations', 'scripts', 'styles'].map(prefix => ({
      source: `/${prefix}/:path*`, destination: `/api/_client/${prefix}/:path*`
    }));
    return {
      beforeFiles: [
        ...apiRewrites,
        ...clientAssetRewrites,
        { source: '/og.png', destination: '/api/_client/og.png' },
        { source: '/logo.jpg', destination: '/api/_client/assets/logo.jpg' }
      ]
    };
  },
  turbopack: { root: __dirname }
};

module.exports = nextConfig;
