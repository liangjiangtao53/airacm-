/** @type {import('next').NextConfig} */
const nextConfig = {
  // 容器化:产出自包含的 .next/standalone(含最小 node_modules + server.js)。
  output: 'standalone',
};

export default nextConfig;
