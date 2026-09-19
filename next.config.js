/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingIncludes: {
    '/api/\\[\\[...path\\]\\]': ['src/client/index.html', 'src/client/generated/llms.txt', 'src/client/generated/docs-markdown/**/*'],
    '/*': ['src/client/index.html']
  },
  async rewrites() {
    return { beforeFiles: ['x402', 'facilitator', 'discovery', 'agent-runner', 'mcp'].map(prefix => ({
      source: `/${prefix}/:path*`, destination: `/api/_gateway/${prefix}/:path*`
    })) };
  },
  turbopack: { root: __dirname }
};

module.exports = nextConfig;
