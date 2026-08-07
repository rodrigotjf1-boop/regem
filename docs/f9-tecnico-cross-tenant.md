# F9 — Acesso de Técnico da Distribuição (impersonação escopada e auditada)

> **Documento de desenho (sem código).** Objetivo: um usuário da **distribuição** (perfil técnico/
> diretoria) acessar as **configurações** de uma loja para dar suporte, **sem** usar as credenciais do
> presidente/C&O da loja e **sem** violar as regras invioláveis (multi-tenant, RBAC no servidor,
> auditoria imutável, LGPD). Fonte: varredura do auth/distribuição/auditoria (file:line abaixo).

## 0. Regras invioláveis que este desenho respeita

1. **Multi-tenant:** a sessão de suporte é amarrada a **exatamente uma loja** (tenant X). Nenhuma query
   sem filtro de tenant; o técnico nunca enxerga outra loja no mesmo acesso.
2. **RBAC no servidor:** as permissões da sessão são um **pacote fixo e restrito**, imposto pelo
   **servidor** (não pelo token). O técnico **nunca** recebe o bypass de `presidente`.
3. **Least privilege:** só **config operacional** (impressão, direcionamento, KDS, cupom, integrações
   técnicas). **Nunca** financeiro (valores R$), PII de clientes, vendas/relatórios, cadastro de pessoas,
   exclusões.
4. **Time-boxed:** sessão curta (ex.: 30 min), expira sozinha.
5. **Consentimento + visibilidade (LGPD):** a loja controla se aceita suporte e **vê** cada ação do
   técnico no seu próprio log de auditoria.
6. **Revogável:** o presidente corta o acesso na hora.
7. **Auditoria imutável:** início/fim + cada mutação entram no `audit_log` da loja (hash-chain) com
   `actor_tipo='suporte'` e o id do técnico.

## 1. O que JÁ existe (reaproveitável) × o que FALTA

**Já existe:**
- Realm de auth **separado e blindado** da distribuição: `DistribuicaoGuard` exige `escopo:'distribuicao'`
  + `DIST_JWT_SECRET`; `PerfilDistGuard`/`@PerfilDist('tecnico','diretoria')` (`distribuicao.guard.ts`).
- **Cross-tenant já implementado** no `distribuicao.service.ts` (frota/licenças/integrações por `tenantId`).
- **Auditoria imutável com hash-chain** no lado da loja: `AuditoriaService.registrar` + `audit_log`
  (`seq/prev_hash/hash`, `auditoria.service.ts:52-85`; `schema.ts:1397-1419`). Coluna **`actor_tipo` já
  existe** (default `'usuario'`, `schema.ts:1403`).
- **Revalidação autoritativa a cada request** no `JwtAuthGuard.estado()` (cache 30s) — dá revogação
  quase em tempo real (`jwt-auth.guard.ts:75-103`).
- **Padrão de toggle por-tenant** com auditoria: `modulo_ativacao` / `entitlement` (`modulo.service.ts`).
- **F8 (recém-feita):** chaves finas `impressoras/kds/direcionamento_impressao/cupom_layout` — a base do
  pacote de permissões do suporte.

**Falta:**
- **Nenhum fluxo de impersonação** hoje: o realm da distribuição só administra frota; nunca "entra" numa
  loja nem emite JWT de tenant a partir de um `usuario_distribuicao`.
- **`actor_tipo` não é gravado:** `AuditEntry` + insert + a função `canonico` do hash **ignoram**
  `actorTipo` (sempre `'usuario'`). Para auditar suporte de forma inviolável é preciso incluí-lo no tipo,
  no insert **e na cadeia de hash**.
- **Sem elo entre as duas trilhas:** ações da distribuição gravam em `distribuicao_auditoria` (SEM
  hash-chain), não no `audit_log` do tenant — o presidente **não vê** hoje.
- **Sem consentimento/escopo/prazo por tenant** (nenhuma flag `empresa.suporte_*`).
- **Sem MFA/IP allowlist** na distribuição (o próprio `console-distribuicao.md` lista como hardening
  pendente).

## 2. Arquitetura (fluxo proposto)

```
Técnico (Console, realm distribuição)
   │ 1) escolhe a loja X → "Acessar configurações (modo suporte)"
   ▼
Consentimento (ver §3)
   │ 2) valida (código temporário / toggle da loja)
   ▼
Backend distribuição (@cloud-only, @PerfilDist('tecnico','diretoria'))
   │ 3) cria suporte_sessao {tenant X, tecnicoId, expira_em, motivo}
   │ 4) grava audit_log da loja: "suporte_iniciado" (actor_tipo='suporte')
   │ 5) emite SUPPORT TOKEN (JWT_SECRET da loja):
   │        sub='sup:<tecnicoId>', tenant=X, cat='suporte',
   │        suporteSessaoId, impersonatedBy=tecnicoId, exp curto
   ▼
App da loja em MODO SUPORTE (banner fixo "MODO SUPORTE — loja X — ações auditadas")
   │ 6) JwtAuthGuard reconhece cat='suporte':
   │      - NÃO é presidente (sem bypass)
   │      - revalida a suporte_sessao (ativa? não expirada? toggle on?) em vez do colaborador
   │      - injeta o PACOTE_SUPORTE do SERVIDOR (ignora perm do token)
   │ 7) cada mutação → audit_log da loja (actor_tipo='suporte', actor_id=tecnicoId)
   ▼
Encerra: expira sozinho | técnico sai | presidente revoga → suporte_sessao.encerrada_em + audit
```

## 3. PACOTE_SUPORTE (permissões fixas do técnico dentro da loja)

Só as chaves de **config** (reaproveita a F8): `impressoras`, `kds`, `direcionamento_impressao`,
`cupom_layout`, `producao_kds`, `servidor`. **Fora do pacote (bloqueado):** `ver_financeiro`, `financeiro`,
`pdv`, `mesas`, `cupons`, `relatorios_vendas`, `turnos`, `auditoria`, `acessos`, `cadastros` (pessoas),
`ponto`, `estoque`, `visao_co`, `unidades`, `fiscal`. Como `cat='suporte'` **não** é `presidente`, o
`PermissoesGuard` já barra tudo que não estiver no pacote — e reforça-se o bloqueio explícito de
financeiro/PII para `cat='suporte'`.

## 4. Mudanças necessárias (mapa — a implementar só após aprovação)

| # | Camada | Mudança | Migration? |
|---|---|---|---|
| F9.0 | Auditoria | incluir `actorTipo` em `AuditEntry` + insert + **na cadeia de hash** (`canonico`) | não |
| F9.1 | Schema | tabela `suporte_sessao` (tenant, tecnicoId, iniciada/expira/encerrada, motivo) + consentimento | **sim** (aditiva) |
| F9.1 | Distribuição | endpoint iniciar/encerrar sessão (valida consentimento) → audita na loja + emite support token | não |
| F9.2 | Auth | `JwtAuthGuard` reconhece `cat='suporte'`: revalida `suporte_sessao` (não colaborador) + injeta PACOTE_SUPORTE | não |
| F9.3 | Front loja | banner "MODO SUPORTE"; oculta telas fora do escopo; tela "Acessos de suporte" (presidente) + revogar | não |
| F9.4 | Console | botão "Acessar em modo suporte" na loja | não |
| F9.5 | Hardening | MFA + IP allowlist na distribuição (pré-requisito recomendado) | não |

## 5. Riscos → mitigação

- **Vazamento cross-tenant:** token amarrado a tenant X; PACOTE_SUPORTE sem nada cross-tenant; tenant
  sempre forçado; revalidação por sessão a cada request.
- **Escalada de privilégio:** `cat='suporte'` nunca é presidente; permissões vêm do **servidor**, não do
  token; endpoints sensíveis exigem perms que o suporte não tem.
- **Abuso silencioso:** tudo no `audit_log` hash-chain **visível ao presidente** + consentimento + TTL
  curto + revogação imediata.
- **LGPD:** sem PII/financeiro no escopo; consentimento + trilha; retenção do log.

## 6. Decisões TOMADAS (travadas)

1. **Consentimento:** **ligado por padrão**, com auditoria + notificação ao presidente + **revogação**
   (toggle "bloquear acesso de suporte" que corta na hora).
2. **Escopo:** **config + integrações + diagnóstico (leitura ampla)** — escrita nas telas de config
   (impressão/KDS/direcionamento/cupom/integrações técnicas) + **leitura** das telas operacionais
   (pedidos/KDS ao vivo) para diagnóstico; **zero** financeiro (R$), PII de clientes, edição de pessoas,
   exclusões.
3. **MFA:** **exigir MFA já** no login da distribuição antes de habilitar a impersonação (F9.5 sobe de
   prioridade).
4. **Épico:** amarrado ao Console da distribuição. Implementar F9 inteira agora, por fases com teste.

### Ajuste do PACOTE_SUPORTE (escopo escolhido)
- **Escrita (config):** `impressoras`, `kds`, `direcionamento_impressao`, `cupom_layout`, `producao_kds`,
  `servidor`.
- **Leitura/diagnóstico:** `pedidos`, `delivery`, `dashboard` — porém `cat='suporte'` entra numa
  **denylist de mutações sensíveis** no servidor (cancelar/estornar, mover dinheiro, excluir, editar
  pessoas), para que "ler pra diagnosticar" não vire "agir".

## 6b. Decisões originais (histórico)

1. **Consentimento** (como a loja autoriza):
   - **(a) Código de suporte por chamado** (recomendado p/ LGPD): o presidente gera um código de 6
     dígitos (validade 15 min) no app e passa ao técnico. Máxima privacidade, alinhado ao padrão de
     pareamento que já existe.
   - **(b) Toggle "permitir suporte"** por loja (opt-in): fica ligado enquanto a loja quiser; menos
     atrito, ainda auditado + revogável.
   - **(c) On por padrão** com auditoria+notificação+revogação: padrão SaaS, menor atrito, menor
     privacidade.
2. **Escopo de acesso:** só as telas de **config** (impressão/direcionamento/KDS/cupom/integrações
   técnicas), leitura+escrita nelas, **zero** financeiro/PII/vendas/pessoas (recomendado). Ampliar depois
   se necessário.
3. **MFA na distribuição** antes de liberar impersonação (recomendado — já é hardening pendente do
   Console): exigir agora ou deixar para F9.5?
4. **Amarrar ao Console da distribuição** (`docs/console-distribuicao.md`) como parte do mesmo épico
   (recomendado).
