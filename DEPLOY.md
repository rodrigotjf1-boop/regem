# Deploy do Regen

Arquitetura: **Frontend (Vercel)** → **Backend/API (Render, Docker)** → **DB (Supabase)**.

## 0. Pré-requisitos
- Código no **GitHub** (Render e Vercel fazem deploy a partir do repositório).
- Banco no **Supabase** com as migrations `001`–`006` aplicadas.
- Contas gratuitas em **Render** e **Vercel**.

## 1. Subir o código para o GitHub
```powershell
cd C:\Regen
gh repo create regen --private --source . --push   # requer gh autenticado
# ou, manualmente:
# git remote add origin https://github.com/<voce>/regen.git
# git push -u origin main
```

## 2. Backend na Render
1. Render → **New → Blueprint** → conecte o repo `regen`. Ele lê o `render.yaml`.
2. Em **Environment**, defina os secrets:
   - `DATABASE_URL` = connection string do Supabase (a mesma do `.env` local).
   - `JWT_SECRET` = um segredo forte (gere um aleatório).
   - `CORS_ORIGIN` = deixe em branco por enquanto (preenche no passo 4).
3. Deploy. Ao final você terá uma URL, ex.: `https://regen-api.onrender.com`.
4. Teste: abra `https://regen-api.onrender.com/api/v1/health` → deve responder `{"status":"ok"}`.

> A porta é injetada pela Render via `PORT` (o app já lê `process.env.PORT`). O healthcheck aponta para `/api/v1/health`.

## 3. Frontend na Vercel
1. Vercel → **Add New → Project** → importe o repo `regen`.
2. Em **Root Directory**, selecione **`frontend`**.
3. Framework: **Next.js** (autodetectado). Build/Output: padrão.
4. **Environment Variables**:
   - `NEXT_PUBLIC_API_URL` = `https://regen-api.onrender.com/api/v1` (a URL da Render + `/api/v1`).
5. Deploy. Você terá uma URL, ex.: `https://regen.vercel.app`.

## 4. Ligar CORS (backend ↔ frontend)
1. Volte na Render → serviço `regen-api` → Environment → defina:
   - `CORS_ORIGIN` = `https://regen.vercel.app` (a URL da Vercel).
2. **Redeploy** o backend (a Render redeploya ao salvar env).

## 5. Testar em produção
- Abra a URL da Vercel no celular.
- Registre a conta (não há tela de cadastro de conta; use a API uma vez):
  ```powershell
  $b='https://regen-api.onrender.com/api/v1'
  Invoke-RestMethod -Method Post $b/auth/register -ContentType 'application/json' -Body (@{empresaNome='Bar do Zé';nome='Gerente';email='gerente@regen.test';senha='senha123'} | ConvertTo-Json)
  ```
- Faça login no app → **Cadastros → Aplicar Food Service** → e navegue.

## Notas
- **Cold start:** no plano free da Render o serviço "dorme" e a primeira requisição pode levar ~30s.
- **DB de produção:** por enquanto usa o mesmo Supabase do dev. Para separar, crie outro projeto Supabase, aplique as migrations (`node backend/scripts/apply-sql.mjs ../database/migrations/NNN.sql` com o `.env` apontando pra ele) e troque o `DATABASE_URL` na Render.
- **Novas migrations:** aplique no banco de produção antes/depois do deploy conforme a mudança.
- **Alternativas:** o `Dockerfile` do backend roda em qualquer lugar (Fly.io, Railway, etc.).
