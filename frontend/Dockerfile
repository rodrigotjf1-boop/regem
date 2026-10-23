# Versão EXATA do Node, igual à do CI (.github/workflows/ci.yml): a tag flutuante deixa o construtor do deploy
# reaproveitar a camada antiga do cache. 24.22.1 = a correção do boletim do Node de 21/10/2026 (Brotli,
# CVE-2026-111497, e as autoridades da eMudhra); o Node 20 saiu de suporte e não recebe correção.
# ---- build ----
FROM node:24.22.1-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
# NEXT_PUBLIC_* é embutido no bundle no BUILD — precisa estar presente aqui.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
# Chave do Google Maps (mapa da loja + geocodificação). Passar como build arg.
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
# WhatsApp de suporte (landing/planos) e URL do instalador do servidor local.
ARG NEXT_PUBLIC_WHATSAPP_SUPORTE
ENV NEXT_PUBLIC_WHATSAPP_SUPORTE=$NEXT_PUBLIC_WHATSAPP_SUPORTE
ARG NEXT_PUBLIC_EDGE_INSTALLER_URL
ENV NEXT_PUBLIC_EDGE_INSTALLER_URL=$NEXT_PUBLIC_EDGE_INSTALLER_URL
RUN npm run build

# ---- runtime (Next.js standalone) ----
FROM node:24.22.1-alpine
WORKDIR /app
ENV NODE_ENV=production
# Necessário para o server standalone aceitar conexões do proxy do EasyPanel.
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
