/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'export',
  distDir: 'dist',
  swcMinify: true,
  experimental: {
    optimizeCss: false,
  },
}

module.exports = nextConfig
