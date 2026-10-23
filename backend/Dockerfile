# Versão EXATA do Node, igual à do CI (.github/workflows/ci.yml): a tag flutuante deixa o construtor do deploy
# reaproveitar a camada antiga do cache. 24.22.1 = a correção do boletim do Node de 21/10/2026 (Brotli,
# CVE-2026-111497, e as autoridades da eMudhra); o Node 20 saiu de suporte e não recebe correção.
# ---- build ----
FROM node:24.22.1-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:24.22.1-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# Segurança: NÃO roda como root. O usuário 'node' (uid 1000) já existe na imagem
# oficial; na nuvem o app só lê (mídia→Supabase, dados→Postgres, logs→stdout).
USER node
# Render/Fly injetam a porta via env PORT; o app lê process.env.PORT.
EXPOSE 3000
CMD ["node", "dist/main.js"]
