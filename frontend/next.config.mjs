/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'standalone' gera um server.js autossuficiente para rodar em container (EasyPanel/Docker).
  output: 'standalone',
  // Não falhar o build por lint (checagem de tipos continua ativa).
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
