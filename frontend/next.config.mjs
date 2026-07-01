/** @type {import('next').NextConfig} */
const nextConfig = {
  // Não falhar o build da Vercel por lint (checagem de tipos continua ativa).
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
