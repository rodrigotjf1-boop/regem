# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM node:20-alpine
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
