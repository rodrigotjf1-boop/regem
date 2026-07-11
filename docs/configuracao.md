# Regem — Guia de configuração (para não errar e perder horas)

> Toda variável de ambiente, **onde vai**, **o que faz**, **formato**, **exemplo**
> e o **erro comum**. Antes de mexer em config, ache a variável aqui.

## Mapa: 3 lugares diferentes

| Onde | O quê | Como muda |
|---|---|---|
| **`regem-api`** (EasyPanel · nuvem) | backend da nuvem | variável de ambiente → **Restart** |
| **`regem-web`** (EasyPanel · nuvem) | frontend Next.js | variável **`NEXT_PUBLIC_*`** → **REBUILD** (não basta restart!) |
| **`.env.local`** (PC da loja · edge) | servidor local | editar o arquivo → reiniciar serviços |

> ⚠️ **Regra de ouro nº 1:** `NEXT_PUBLIC_*` é "assado" no **build** do frontend.
> Mudou? Tem que **REBUILD** do `regem-web`, não só restart. (Foi o que travou a
> chave do Google Maps.)

---

## 1. `regem-api` (nuvem) — variáveis

| Variável | O que faz | Formato / Exemplo | Erro comum |
|---|---|---|---|
| `DATABASE_URL` | Postgres da nuvem (Supabase) | `postgresql://user:senha@host:5432/db` | senha com `@`/`:` sem URL-encode |
| `JWT_SECRET` | assina os tokens de login | texto **≥ 16 chars** | fraco/curto → o app **não sobe** |
| `CORS_ORIGIN` | origens liberadas (obrigatório em prod) | `https://app.dmsregem.com` (vírgula p/ várias) | faltando em prod → **não sobe** |
| `NODE_ENV` | ambiente | `production` | — |
| `SWAGGER_ENABLED` | liga o /docs em prod | `true` (opcional) | — |
| `OTP_WEBHOOK_URL` | fallback global do OTP | URL do **workflow de STATUS** do n8n | apontar pro workflow do **bot** (não envia OTP) |
| `EVOLUTION_API_URL` | base da Evolution (WhatsApp) | `https://sua-evolution` | com `/` no fim → ok (tratado) |
| `EVOLUTION_API_KEY` | apikey global da Evolution | segredo | — |
| `N8N_BOT_WEBHOOK_URL` | webhook do workflow multi-tenant | URL do n8n | — |
| `BOT_RESOLVER_SECRET` | protege o resolver do bot | segredo | **tem que bater** com o secret no nó do n8n |
| `LICENSE_PRIVATE_KEY_B64` | **assina** o lease de licença | base64 (do `gen-license-keys.mjs`) | **NUNCA** colocar isto no edge! |
| `LICENSE_PUBLIC_KEY_B64` | verifica o lease | base64 (pública) | — |
| `LICENSE_KID` | id da chave (rotação) | `k1` | trocar a chave sem trocar o kid |
| `APP_URL` | base dos links (cardápio/robô) | `https://app.dmsregem.com` | — |

## 2. `regem-web` (nuvem) — variáveis (⚠️ build-time)

| Variável | O que faz | Exemplo | Erro comum |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | base da API | `https://api.dmsregem.com/api/v1` | mudou e **não deu rebuild** |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | mapa/geocodificação | a chave do Google | setar e **não rebuildar** → mapa não aparece |

> A chave do Maps é **opcional** (sem ela, CEP + GPS + OSM funcionam). Precisa de
> **rebuild** do `regem-web` pra valer (o Dockerfile já a repassa como build arg).

## 3. Edge (`backend/.env.local` no PC da loja)

| Variável | O que faz | Exemplo | Erro comum |
|---|---|---|---|
| `DATABASE_URL` / `EDGE_DATABASE_URL` | Postgres **local** | `postgresql://postgres:senha@localhost:5432/regem_local` | usar o banco da nuvem por engano |
| `JWT_SECRET` | login local | segredo forte | — |
| `PORT` | porta do edge | `3001` | mudar e não atualizar os clientes |
| `EDGE_MODE` | liga o mDNS + modo edge | `true` | esquecer → não anuncia `regem.local` |
| `EDGE_UNIDADE_ID` | id da loja | uuid da unidade | — |
| `APP_VERSION` | versão (telemetria) | `1` | — |
| `EDGE_TLS_CERT` / `EDGE_TLS_KEY` | HTTPS local | caminho do `server.crt`/`.key` | sem eles → HTTP → **sem câmera/SW** |
| `LICENSE_PUBLIC_KEY_B64` | verifica o lease **offline** | base64 **pública** | colocar a **privada** aqui (grave falha) |
| `LICENSE_KID` | id da chave | `k1` | não bater com a nuvem |
| `LICENSE_GRACE_DAYS` | dias offline até bloquear | `30` | — |
| `CLOUD_API` | base da nuvem (sync) | `https://api.dmsregem.com/api/v1` | esquecer o `/api/v1` |
| `SYNC_TOKEN` | token do equipamento `servidor_local` | do cadastro de Equipamentos | usar token de outro tipo |
| `SYNC_INTERVAL_MS` | intervalo do sync | `30000` | — |

---

## Erros comuns (a lista que economiza horas)

1. **`NEXT_PUBLIC_*` sem rebuild** → o frontend continua com o valor antigo. **Rebuild** o `regem-web`.
2. **Chave PRIVADA da licença no edge** → falha de segurança grave. No edge vai **só a pública**.
3. **OTP apontando pro workflow do bot** → o código não chega. Aponte pro workflow de **status**.
4. **`BOT_RESOLVER_SECRET` diferente** entre a nuvem e o nó do n8n → resolver recusa.
5. **Dois pushes seguidos na `main`** → o EasyPanel **cancela o build anterior** (`context canceled`). **Um push por vez**, deixe terminar.
6. **Telefone com/sem `55`** no bot: o `remoteJid` vem `5521...`; o cardápio usa `21...`. O nó do n8n tira o `55` (`.replace(/^55/,'')`) — senão vira cliente duplicado.
7. **Migration não aplicada** antes do deploy → erros de coluna inexistente. Aplique **antes** de mesclar/deploy.
8. **Edge com `DATABASE_URL` da nuvem** → o edge vira um cliente da nuvem (perde o offline). Confira que aponta pro **localhost**.
9. **Cert local não confiado** nos clientes → aviso de segurança + câmera/SW não funcionam. Importe o `ca.pem` em cada equipamento.

## Checklist antes de um deploy
- [ ] Migration nova? **Aplicada** na nuvem (e no edge, se for o caso).
- [ ] Mexeu em `NEXT_PUBLIC_*`? **Rebuild** do `regem-web`.
- [ ] CI **verde** e **um push por vez**.
- [ ] Segredos novos setados no serviço **certo** (api ≠ web ≠ edge).
- [ ] Chave **privada** da licença só na `regem-api`.

## Como gerar as chaves da licença
```bash
cd backend
node scripts/gen-license-keys.mjs
```
Cole a **privada** em `regem-api` (`LICENSE_PRIVATE_KEY_B64`), a **pública** em
`regem-api` **e** no edge (`LICENSE_PUBLIC_KEY_B64`), e `LICENSE_KID=k1`.
Guarde a privada num cofre; se vazar, gere `k2` e rotacione.
