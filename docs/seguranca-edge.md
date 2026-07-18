# Proteção do appliance edge — runbook (Fase 1)

> Objetivo: reduzir a superfície de clonagem/leitura da lógica no PC da loja, sem
> atrapalhar o funcionamento. Princípio: **não dá para esconder 100% código on-prem**;
> a estratégia é (1) tornar o clone **inerte**, (2) proteger **segredos**, (3) não
> **vazar fonte/lógica** no pacote. Este arquivo NÃO vai para a loja (fica só no repo).

## O que o pacote do edge envia (e o que foi cortado)
`edge/package.mjs` monta `regem-edge-dist/` com: `dist/` (backend compilado), `web/`
(Next standalone), `database/migrations`, `edge/` (daemons + scripts) e `node_modules`
de produção. **NÃO** envia `docs/`, `mockups/`, `CLAUDE.md`.

**Fase 1 — corte de vazamento de fonte/lógica** (`package.mjs`):
- Filtro `VAZA_LOGICA` remove do pacote **`.map`** (sourcemaps reconstroem o TS com
  comentários), **`.d.ts`** (estrutura interna) e **`.md`** (docs de instalação/build).
- Comentários já saem do `dist` (`removeComments: true` no tsconfig).
- **Guard** no fim do `package.mjs`: o build **falha** se algum `.md/.map/.d.ts` nosso
  (fora de `node_modules`) escapar — impede regressão em updates futuros.

## Segredos (o risco mais grave)
- **JWT_SECRET é único por loja** (instalador gera `Rand 40`). NUNCA usar o da nuvem.
- **Nunca** colocar segredos MESTRES da nuvem no edge (`SUPABASE_SERVICE_KEY`, JWT da
  nuvem). O edge só tem credenciais locais + o `SYNC_TOKEN` escopado da loja.
  - ✅ *Resolvido:* o reconcile de mídia (P4) NÃO usa mais a service key no edge — o
    `MidiaReconcileProcessor` posta a imagem local no endpoint `POST /midia/edge/upload`
    (x-sync-token) e a NUVEM sobe ao Supabase (a service key fica só na nuvem). O edge
    precisa apenas de `CLOUD_API` + `SYNC_TOKEN` (`temCloud()`), nunca da service key.
- **ACL**: o instalador restringe o `.env.local` a `SYSTEM` + `Administradores` (icacls).
- **Criptografia em repouso (DPAPI, opt-in):**
  - `edge/proteger-env.ps1 -EnvFile <.env.local>` cifra `DATABASE_URL`,
    `EDGE_DATABASE_URL`, `JWT_SECRET`, `SYNC_TOKEN` com DPAPI **LocalMachine** → prefixo
    `enc:`. O blob **não decifra em outra máquina** (anti-cópia dos segredos).
  - No boot, `src/secure-env.ts` (`carregarEnvSeguro`, chamado no topo do `main.ts`)
    decifra os `enc:` via `edge/decrypt-dpapi.ps1` **antes** do Nest. **NO-OP quando não
    há `enc:`** (nuvem e edges sem criptografia) → seguro rodar sempre.
  - Ativar na instalação: `instalar-tudo.ps1 -ProtegerSegredos` (opt-in enquanto valida
    em edge de teste). Falha de decifra derruba o boot de propósito (não sobe com segredo
    quebrado). **Validar num edge de teste antes de ligar por padrão.**

## Clone inerte (licença)
- `licenca.service.ativar(token, fingerprint)` **prende na 1ª ativação**: fingerprint
  diferente = rejeita (anti-clonagem). Lease amarrado a CNPJ + device.
- `LicenseInterceptor` corta **ESCRITA** sem lease válido (GET/rotas públicas seguem);
  no edge a licença é verificada offline via `LICENSE_PUBLIC_KEY_B64` + `sync_state`.
- Efeito: copiar a pasta para outra máquina → fingerprint muda → lease inválido →
  operação/sync bloqueados. A cópia nasce **inerte**.

## Fora do escopo da Fase 1 (fases seguintes)
- **Bytecode (bytenode)** no `dist` — proteção forte da lógica (fase própria; testar boot).
- **Telemetria de erro local → nuvem** (Frente A) — observabilidade p/ reparo rápido.
- **Lógica crítica na nuvem** (thin edge) — proteção definitiva, arquitetural.
- Ofuscação foi **descartada** (quebra a DI do NestJS por depender de nomes de classe).

## Ordem no build de release (não quebrar updates)
`npm run build` (comments off) → `node edge/package.mjs` (filtro + guard) → zipar sem
`node_modules` (`publicar.ps1`). No install: ACL sempre; `-ProtegerSegredos` p/ DPAPI.
