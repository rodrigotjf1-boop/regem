# Remediação de segurança — tracker (auditoria ago/2026)

> Fonte da verdade do fechamento das brechas achadas na auditoria (edge + nuvem).
> Legenda: ✅ feito (dev-local) · ⏳ pronto p/ aplicar (requer teste em instalação real
> antes do baseline `.exe`) · 🔜 planejado (P1/P2/P3). Ver achados completos na memória
> `auditoria-seguranca-ago2026`.

## Regra de segurança
- Edge sem loja instalada → os P0 do edge entram no **baseline `.exe`** (zero reprovisionamento).
- Nuvem → deploy normal (PR). Alterações de instalador/serviço/Postgres **não** vão às cegas: testar numa instalação real antes de publicar o baseline (regra do instalador defensivo).

---

## P0 — crítico

### ✅ CL-1 · Escalada gerente→presidente (nuvem) — FEITO
**Fix:** `NIVEL`/`podeCriarNivel`/`podeEditarNivel` centralizados em `auth/permissoes.ts`; `funcao.service.create/update` rejeitam `categoria` acima do nível do ator; `colaborador.service.update` bloqueia promover a nível não-atribuível.
**Arquivos:** `auth/permissoes.ts`, `modules/funcao/funcao.service.ts`, `modules/colaborador/colaborador.service.ts`. tsc ✅.

### ✅ CL-2 · Hierarquia em colaborador.update/definirSenha (nuvem) — FEITO
**Fix:** `update` e `definirSenha` chamam `podeEditarNivel(ator, categoriaDoAlvo)` (helper `categoriaDe` = `perfil.nivel ?? funcao.categoria`); gerente não edita/reseta senha de presidente. tsc ✅.

### ✅ CL-3 · Webhook 99food fail-open (nuvem) — FEITO
**Fix:** `food99.service`: assinatura **obrigatória por padrão** (só desliga com `FOOD99_REQUIRE_SIGN=false`); `ingerirNovo` **não usa mais o corpo** — só o GET detail autenticado (poller reconcilia). tsc ✅.
**Deploy:** garantir `FOOD99_REQUIRE_SIGN` **não** setado como `false` na nuvem e o `appSecret` da loja configurado.

### ✅ CL-4 · PII do cliente sem OTP (nuvem) — FEITO (⚠️ follow-up front)
**Fix:** `cliente.service.identificar` devolve só `{ id, nome, requerOtp:true }` — **sem endereços, sem sessão**; `criarLink` não devolve mais `clienteToken`. Sessão+endereços só via `confirmarOtp`. tsc ✅.
**Follow-up front (P1):** `/c/[token]` deve, ao identificar, oferecer OTP para carregar endereços/histórico (fluxo `otp/enviar`→`otp/confirmar` já existe).

### ✅ LE-1 · Update sem assinatura obrigatória (edge) — FEITO
**Fix:** `atualizar.ps1` agora **exige assinatura por padrão** (`-ne 'false'`); `instalar-tudo.ps1` grava `EDGE_REQUIRE_SIGNED_UPDATE=true` no `.env.local`.
**Publicação:** sempre publicar com `EDGE_UPDATE_SIG` (o `publicar.ps1 -Url` já assina).

### ✅ LE-6 · Segredos com CSPRNG (edge) — FEITO
**Fix:** `instalar-tudo.ps1` `Rand()` usa `RandomNumberGenerator` (CSPRNG) com rejeição anti-viés, no lugar de `Get-Random`. Cobre `JWT_SECRET` e senha do Postgres.

### ⏳ LE-8 · ACL da raiz de confiança e do código (edge) — ADIADO (removido do baseline)
> **Testado e removido (22/08):** a manipulação de ACL (`icacls /inheritance:r`) corrompeu o
> filesystem em reinstalações — pastas `backup-*` passaram a negar acesso **até para Admin**
> (`Remove-Item` falhava), e os serviços como SYSTEM saíam com **código 1** (perda de acesso
> a `dist`/`edge`/`node_modules`; `.err.log` nem era escrito). Passamos por 3 variações (varre
> `$root` → cirúrgico edge/dist → por último após o flag) e todas deixaram efeitos colaterais.
> **Baseline não mexe mais em ACL do código** — igual ao install de julho que funcionava.
> A blindagem entra na **rodada testada** junto com LE-4/LE-5/LE-2/LE-3, com os grants na
> ordem certa (ANTES do start dos serviços) e validação em instalação real e limpa.

### ⏳ LE-4 · Serviços Node em conta de baixo privilégio (edge) — ADIADO (revertido no baseline)
> **Testado e revertido (22/08):** ao rodar como `NetworkService`, 3 dos 4 serviços caíram
> (`SERVICE_PAUSED`, sem nem escrever `.err.log`) — a conta não lia o código (`dist`/`edge`)
> nem escrevia em `logs\`; as permissões só entravam na blindagem do fim (tarde demais).
> **Baseline voltou ao default (LocalSystem)**, que funciona. Para reativar com segurança,
> a rodada testada precisa garantir, ANTES do start dos serviços, `NetworkService` com:
> leitura em `dist`/`edge`/`node`/`certs`, escrita em `logs\`, e spawn de powershell (DPAPI).
> Aplicar junto com LE-5/LE-2/LE-3, iterando em instalação real.
> (Mantidos: `.env.local` com `NetworkService:(R)` e LE-8 com `NetworkService:(RX)` — inertes/
> forward-compat com LocalSystem, que roda como SYSTEM e já tem Full.)

### ⏳ LE-5 · Postgres: role `regem_app` não-superusuário (edge) — ADIADO (rodada testada)
> **Por que adiado:** depende do caminho de **update** que roda migrations lendo o
> `.env.local` **cifrado** (`atualizar.ps1:201` não seta env). Trocar a `DATABASE_URL`
> para `regem_app` + admin exige validar esse fluxo cifrado numa instalação real —
> senão risco de o app não conectar ao banco (brick). Aplicar junto com LE-2/LE-3.
**Passos (migration idempotente + instalador):**
1. Criar migration `NNN_regem_app_role.sql` (rodada no install/update via `apply-all-local`):
   ```sql
   DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='regem_app') THEN
       CREATE ROLE regem_app LOGIN PASSWORD :'senha' NOSUPERUSER NOCREATEDB NOCREATEROLE;
     END IF;
   END $$;
   REVOKE ALL ON DATABASE regem_local FROM PUBLIC;
   GRANT CONNECT ON DATABASE regem_local TO regem_app;
   GRANT USAGE ON SCHEMA public TO regem_app;
   GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO regem_app;
   GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO regem_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO regem_app;
   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO regem_app;
   ALTER ROLE regem_app SET statement_timeout = '30s';
   ```
   (a senha do `regem_app` gerada com o `Rand` CSPRNG no instalador; migrations rodam como `postgres`.)
2. **Split de conexão** no `.env.local`:
   - `DATABASE_URL` e `EDGE_DATABASE_URL` → **`regem_app`** (runtime: API + daemons).
   - novo `DATABASE_URL_ADMIN` → **`postgres`** (só migrations).
3. `scripts/apply-all-local.mjs`: preferir `DATABASE_URL_ADMIN` (fallback `DATABASE_URL`).
**Efeito:** mata `COPY … PROGRAM` (RCE) e ignora-RLS por superusuário. **Teste:** app opera com `regem_app`; migrations rodam com admin.

### ⏳ LE-2 · Verificar o lease de fato no edge — PRONTO (server+edge)
**Passos:** o interceptor de licença do edge deve chamar `verificarLease()` sobre `lic_lease` (assinatura Ed25519 com a pública embutida) e conferir `payload.fp == fingerprintForte()` e `payload.exp`. A flag `lic_ativa` deixa de ser fonte da verdade; editar `sync_state`/parar o daemon não basta. **Fechar fail-open** de `statusEdge()`/`license.interceptor.ts` (erro → negar, não `ativa:true`).

### ⏳ LE-3 · `SYNC_TOKEN` atrelado ao dispositivo — PRONTO (server+edge), cuidado
**Passos:** enviar `x-sync-fp` também no `pull`/`push` e **validar server-side** contra o fingerprint preso na ativação (hoje só valida no lease). Permitir **revogação/rotação** do token por unidade. **Risco:** não travar edges legítimos — implementar com período de tolerância + telemetria antes de exigir.

---

## P1 (grave) — 🔜
- Edge: HTTPS/host allowlist no download do update (`atualizar.ps1`); integridade **bloqueante + assinada** cobrindo `edge/*.mjs` (`integridade.ts`/`package.mjs`); API em `127.0.0.1` + **`JwtAuthGuard` global** (`APP_GUARD` + `@Public()`).
- Nuvem: aplicar `urlPublicaSegura()` em `cliente.service.testarWebhook` e no Open Delivery `baseUrl` (CL-5); trocar `@Body() dto:any` por DTO validado nos endpoints de **dinheiro** + `forbidNonWhitelisted` (CL-6); atualizar `drizzle-orm >= 0.45.2` (CL-7); front do OTP (CL-4).

## P2 (intermediária) — 🔜
- Edge: `scram-sha-256` no `initdb`; ACL da pasta `edge\certs\` (`server.key`); embutir node_modules / evitar `npm ci` no update.
- Nuvem: lockout **por conta** no login; PIN 6 dígitos; anti-enumeração (cadastro/timing/workspace/`emailLivre`); rate-limit de OTP **por telefone**; hashear tokens de `equipamento`; validar `unidadeId` do corpo (`venderTotem`); dono do pedido no `entregador.finalizar`; `@RequirePerm` em `fiscal/emitir`; **ativar RLS**; lint/CI anti-tenant-leak; atualizar `next`/`multer`/`nanoid`/`socket.io-parser`.

## P3 (leve) — 🔜
- Edge: CORS local restrito; janela `trust` no reset; filtro do pacote cobrir `.key`; cofre p/ chaves-mestras.
- Nuvem: JWT `algorithm` fixo; `JWT_SECRET` ≥32 + `DIST_JWT_SECRET` obrigatório; política de senha ≥8; `SameSite=Strict`/CSRF; TOTP timing-safe; `clienteToken` com expiração; bot secret em header; throttle no webhook Stripe.

---

## 📱 Camada Android/apps (transversal)
- **`JwtAuthGuard` global fail-closed** (P1) — CORS não protege app nativo.
- Nada de segredo no APK (bot secret → header/config server-side).
- Token com **expiração + refresh** e Android Keystore; **cert pinning** recomendado.
- CL-4 (PII) e CL-15 (dono do pedido) são rotas consumidas pelos apps — prioridade.
