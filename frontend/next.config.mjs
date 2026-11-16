/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'standalone' gera um server.js autossuficiente para rodar em container (EasyPanel/Docker).
  output: 'standalone',
  // Não falhar o build por lint (checagem de tipos continua ativa).
  eslint: { ignoreDuringBuilds: true },
  // Sem o `X-Powered-By: Next.js`: não conta a quem varre o site qual é a pilha.
  poweredByHeader: false,
  // Os cabeçalhos de segurança do app (avaliação interna de segurança, 16/11/2026). Este arquivo serve a NUVEM
  // (app.dmsregem.com) e o SERVIDOR DA LOJA (regem.local) ao mesmo tempo (LIC-517): cada regra diz em qual vale.
  async headers() {
    // Nenhuma tela do app pode ser embutida em outro site: quem enquadra a tela induz o clique em "Autorizar",
    // "Revogar", "Cancelar" ou no PIN do Mister (clickjacking). Nenhum produto da DMS nem programa da loja embute o
    // app (conferido: sem `iframe` nem `webview` no front, na ponte do chat e no edge). Fica de fora só o cardápio
    // público (`/c/...`), que a loja pode querer pôr no próprio site.
    const semMoldura = [
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
    ];
    return [
      // Tudo, menos o segmento `c` (o cardápio): `/caixa`, `/cadastros` e afins começam com "c" e entram.
      { source: '/:caminho((?!c(?:/|$)).*)', headers: semMoldura },
      // O navegador não adivinha o tipo do arquivo: vale para tudo, nos dois lados.
      { source: '/:caminho*', headers: [{ key: 'X-Content-Type-Options', value: 'nosniff' }] },
      // HTTPS sempre, só no endereço da nuvem. No servidor da loja (regem.local, certificado próprio) o HSTS poderia
      // travar o acesso pela rede local de um aparelho que já abriu por HTTPS.
      {
        source: '/:caminho*',
        has: [{ type: 'host', value: 'app.dmsregem.com' }],
        headers: [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }],
      },
    ];
  },
};

export default nextConfig;
