# Deploy do Regen no EasyPanel (VPS)

Hospeda tudo na sua **VPS Hostinger** com **EasyPanel** (já instalado), sob o seu domínio.
Arquitetura: **frontend + backend** na sua VPS (Docker via EasyPanel) · **DB** no Supabase.

Suposição de domínios (troque pelos seus):
- API:      `https://api.SEU-DOMINIO`
- App/web:  `https://app.SEU-DOMINIO`

## 0. Pré-requisitos
- Código no **GitHub** (o EasyPanel faz deploy a partir do repo).
- DB no **Supabase** com migrations `001`–`006` aplicadas.
- Apontar no seu provedor de DNS os subdomínios `api` e `app` para o IP da VPS
  (o EasyPanel emite o HTTPS automaticamente via Let's Encrypt).

## 1. Subir o código para o GitHub
```powershell
cd C:\Regen
git remote add origin https://github.com/<voce>/regen.git
git push -u origin main
```

## 2. EasyPanel → Projeto
- Crie um **Project** chamado `regen`.

## 3. Serviço da API (backend)
- **+ Service → App**, nome `regen-api`.
- **Source:** GitHub → repositório `regen`, branch `main`.
  - Se houver campo de **subdiretório/mono-repo**, aponte para `backend`.
- **Build:** método **Dockerfile**.
  - Dockerfile: `Dockerfile` (contexto = pasta `backend`).
- **Environment** (aba de variáveis):
  - `DATABASE_URL` = connection string do Supabase
  - `JWT_SECRET` = um segredo forte
  - `CORS_ORIGIN` = `https://app.SEU-DOMINIO`
  - `PORT` = `3000`
- **Ports/Proxy:** porta do container **3000**; **Domain** = `api.SEU-DOMINIO`.
- **Deploy.** Teste: `https://api.SEU-DOMINIO/api/v1/health` → `{"status":"ok"}`.

## 4. Serviço do App (frontend)
- **+ Service → App**, nome `regen-web`.
- **Source:** mesmo repo; subdiretório `frontend` (se aplicável).
- **Build:** **Dockerfile** (`Dockerfile`, contexto = pasta `frontend`).
  - **Build Arg** (importante — o Next embute isso no build):
    `NEXT_PUBLIC_API_URL` = `https://api.SEU-DOMINIO/api/v1`
- **Ports/Proxy:** porta **3000**; **Domain** = `app.SEU-DOMINIO`.
- **Deploy.**

> Atenção: `NEXT_PUBLIC_API_URL` precisa ser **Build Arg** (não só env de runtime),
> porque o Next.js grava esse valor no bundle do navegador durante o build.
> Se mudar a URL da API depois, é preciso **rebuildar** o frontend.

## 5. Testar em produção
- Abra `https://app.SEU-DOMINIO` no celular.
- Crie a conta (uma vez, via API):
  ```powershell
  $b='https://api.SEU-DOMINIO/api/v1'
  Invoke-RestMethod -Method Post $b/auth/register -ContentType 'application/json' -Body (@{empresaNome='Bar do Zé';nome='Gerente';email='gerente@regen.test';senha='senha123'} | ConvertTo-Json)
  ```
- Login no app → **Cadastros → Aplicar Food Service** → navegue.

## Notas
- **Convive com o n8n:** o EasyPanel roteia cada serviço pelo seu domínio; Regen e n8n coexistem na mesma VPS sem conflito.
- **Deploy automático:** ligue o auto-deploy no push (ou clique em Deploy a cada `git push`).
- **Migrations futuras:** rode `node backend/scripts/apply-sql.mjs ../database/migrations/NNN.sql` com o `.env` apontando para o banco de produção, ou cole o SQL no editor do Supabase.
- **DB próprio (opcional):** dá para criar um serviço **Postgres** no próprio EasyPanel e migrar do Supabase depois; por ora, manter o Supabase é mais simples.
