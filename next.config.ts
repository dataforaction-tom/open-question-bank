import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // `pg` is a server-only dependency; keep it out of client/edge bundling.
  serverExternalPackages: ['pg'],
}

export default nextConfig
