import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  allowedDevOrigins: [
    ".space.z.ai",
  ],
  serverExternalPackages: [
    "bip39",
    "ethers",
    "tweetnacl",
    "ed25519-hd-key",
    "bitcoinjs-lib",
  ],
};

export default nextConfig;
