# RLS por tenant (Row-Level Security) — defesa em profundidade

> Status: **mecanismo entregue e INERTE**. Não muda nada em produção até a ativação
> encenada (abaixo). Objetivo: se o código esquecer um `WHERE tenant_id` (ou houver
> SQL injection), o **banco** recusa linhas de outro tenant.

## Contexto

Hoje o app conecta como **um** role (`regem_app`, com `BYPASSRLS`) pelo **pooler da
Supabase em modo transação** (Supavisor:6543). A isolação de tenant é 100% na
aplicação (todo query filtra `tenant_id`). RLS está ligada nas tabelas, mas sem
policy — então hoje ela só protege a **API REST anônima** (role `anon`), não o app.

## Como funciona o mecanismo (já no código, gated)

1. **`RLS_ENABLED`** (env, default `false`) liga tudo. Desligado = passthrough puro.
2. **Interceptor** [`rls.interceptor.ts`](../backend/src/auth/rls.interceptor.ts): em cada
   request autenticado (tenant no JWT), abre **uma transação** e fixa o tenant com
   `select set_config('app.tenant', <tenant>, true)` (LOCAL à transação — obrigatório
   no pooler em modo transação, onde `SET` de sessão não gruda).
3. **Contexto** [`tenant-context.ts`](../backend/src/db/tenant-context.ts): guarda essa
   transação num `AsyncLocalStorage`.
4. **Proxy do DRIZZLE** [`drizzle.module.ts`](../backend/src/db/drizzle.module.ts): roteia
   **todo** `this.db.select()/insert()/…` para a transação ambiente — **zero mudança
   nos serviços**. Sem transação ambiente (RLS off, job, rota pública) → pool real.
5. **Policies** [`191_rls_tenant_policies.sql`](../database/migrations/191_rls_tenant_policies.sql)
   (`@cloud-only`): por tabela com `tenant_id`, `tenant_isolation TO regem_rls` deixa
   ver/gravar só o tenant do GUC; tabelas globais recebem `app_global_read TO regem_rls`
   (liberadas ao app, protegidas por RBAC). Como são `TO regem_rls`, a API anônima
   segue bloqueada.

Enquanto o app usar `regem_app` (BYPASSRLS), as policies são **ignoradas** → merge não
muda nada. Só passam a valer sob `regem_rls` (NOBYPASSRLS) + `RLS_ENABLED=true`.

## Pré-requisitos ANTES de ativar (o mecanismo não cobre sozinho)

O interceptor só fixa o GUC em rotas **autenticadas com tenant no JWT**. Faltam, e
precisam ser tratados na ativação com o helper `comTenant(db, tenantId, fn)`:

- **Cardápio público / webhooks** (tenant vem do token/correlação, não do JWT):
  envolver o trecho que resolve o tenant em `comTenant(...)`.
- **Jobs / pollers** (fora do ciclo HTTP): cada laço por tenant roda dentro de
  `comTenant(this.db, tenantId, (tx) => …)`, OU manter um role de serviço com bypass
  para o processo de background.
- **Linhas legadas com `tenant_id` nulo** (dados pré-multitenant): ficam invisíveis
  sob RLS — auditar e backfillar antes.

## Runbook de ativação (encenado, reversível)

> Faça em **staging/loja de teste** primeiro. Cada passo é reversível.

### 1. Criar o role sem bypass (Supabase → SQL Editor, como admin)
```sql
create role regem_rls login password 'TROQUE_por_senha_forte_alfanumerica' nobypassrls;
grant usage on schema public to regem_rls;
grant select, insert, update, delete on all tables in schema public to regem_rls;
grant usage, select on all sequences in schema public to regem_rls;
alter default privileges in schema public grant select, insert, update, delete on tables to regem_rls;
alter default privileges in schema public grant usage, select on sequences to regem_rls;
```

### 2. Aplicar a migration das policies (depois do passo 1)
```
node scripts/apply-sql.mjs ../database/migrations/191_rls_tenant_policies.sql
```
Deve logar `RLS: policies (re)criadas para o role regem_rls.` (se logar que o role não
existe, volte ao passo 1).

### 3. Trocar a conexão do backend para o role sem bypass
```
Onde: EasyPanel → serviço regem-api → aba Environment
Variável DATABASE_URL (troque o usuário, mesma senha/host do formato do pooler):
  postgresql://regem_rls.yhwcehdoaqhexkriyehv:<senha do passo 1>@aws-1-us-west-2.pooler.supabase.com:6543/postgres
Adicione também:
  RLS_ENABLED = true
Salvar → Deploy.
```

### 4. Validar
- Login, dashboard, cardápio, KDS, impressão: tudo funciona.
- Log do boot: `Conexão Postgres — TLS: verify-full`.
- Teste de isolamento: um usuário do tenant A **não** vê dado do tenant B em nenhuma tela.
- Jobs/pollers rodam sem erro de "0 linhas" (se der, faltou `comTenant` — passo dos pré-requisitos).

### Rollback (imediato)
No EasyPanel → `regem-api` → Environment: `RLS_ENABLED=false` **e** volte `DATABASE_URL`
para `regem_app…` → Deploy. As policies podem ficar (são inertes sob bypass).

## Fases (todas implementadas no código; ativação é operacional)

| Fase | Entregue |
|---|---|
| 0 · Fundação | `tenant-context.ts` (ALS + `comTenant`), proxy do DRIZZLE, gate `RLS_ENABLED` |
| 1 · PoC | mecanismo por request (interceptor) + policy por tabela |
| 2 · Middleware | interceptor global transparente (proxy → sem reescrever query) |
| 3 · Rollout | migration cria policy em **todas** as tabelas (com/sem tenant_id) |
| 4 · Cutover | passo 3 do runbook (troca `DATABASE_URL`; `regem_app` fica de rollback) |
| 5 · Endurecer | após validação: revogar bypass de `regem_app`, aposentar role antigo |
