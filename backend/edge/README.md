# Servidor local (edge) — como rodar

Ver a arquitetura em `docs/arquitetura-edge.md`. O servidor local é o **próprio backend**
apontando para um **Postgres local** + o **daemon de sync** que fala com a nuvem.

## 1. Pré-requisitos
- Node 20+ e **PostgreSQL local** (porta 5432).
- `backend/.env.local` (NÃO commitado) com `DATABASE_URL` do Postgres local, ex.:
  ```
  DATABASE_URL=postgresql://postgres:SENHA@localhost:5432/regem_local
  JWT_SECRET=um-segredo-de-pelo-menos-16-chars
  PORT=3001
  NODE_ENV=development
  CORS_ORIGIN=*
  ```
  O `ConfigModule` prioriza `.env.local` (cai no `.env` quando ausente — nuvem).

## 2. Preparar o banco local
```bash
# cria o banco (uma vez)
node -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:'postgresql://postgres:SENHA@localhost:5432/postgres'});await c.connect();await c.query('create database regem_local').catch(()=>{});await c.end()})()"
# aplica todas as migrations
node scripts/apply-all-local.mjs
```

## 3. Subir o servidor local (serve a LAN)
```bash
npm run build && node dist/main.js     # usa .env.local → Postgres local, porta 3001
```
Os clientes (PDV/KDS/Ponto/tablet) apontam para `http://IP-DO-PC:3001/api/v1`.

## 4. Daemon de sync (nuvem ↔ local)
Precisa de um **equipamento `servidor_local`** cadastrado na nuvem (token). Rode:
```bash
EDGE_DATABASE_URL="postgresql://postgres:SENHA@localhost:5432/regem_local" \
CLOUD_API="https://api.dmsregem.com/api/v1" \
SYNC_TOKEN="<token do equipamento servidor_local>" \
SYNC_INTERVAL_MS="30000" \
node edge/sync-daemon.mjs
```
- **pull:** baixa o controle (empresa/unidade/colaboradores/produtos/fichas…) da nuvem.
- **push:** sobe o operacional (movimento_estoque, ponto, caixa, auditoria) para a nuvem.
- Cursores ficam na tabela `sync_state` do banco local.

> Testado localmente com um 2º banco (`regem_edge`) fazendo o papel da nuvem — pull e push
> validados ponta a ponta.
