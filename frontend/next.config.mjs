/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'standalone' gera um server.js autossuficiente para rodar em container (EasyPanel/Docker).
  output: 'standalone',
  // Não falhar o build por lint (checagem de tipos continua ativa).
  eslint: { ignoreDuringBuilds: true },
  // A página de autorizar aplicativo e a de revogar (trilha C, C1b) nunca podem ser embutidas em
  // outro site: quem enquadra a tela induz o clique em "Autorizar" ou "Revogar" (clickjacking).
  async headers() {
    const semMoldura = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    ];
    // Dois padrões: `:caminho*` sozinho não pega a raiz `/integracoes` (conferido com curl).
    return [
      { source: '/integracoes', headers: semMoldura },
      { source: '/integracoes/:caminho*', headers: semMoldura },
    ];
  },
};

export default nextConfig;
