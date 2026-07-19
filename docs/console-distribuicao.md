# Console da Distribuição — planejamento (NÃO implementar ainda)

> **Status: PLANEJADO, não iniciado.** Só implementar **depois de concluídas as fases
> anteriores** (ver §9 Pré-requisitos) — para não deixar pendência perdida. Este
> documento é a fonte da verdade do épico. Fica só no repo (`docs/` não vai para a loja).

## 1. Objetivo e escopo
Um plano de controle **da distribuição (Regem)** — separado das lojas (tenants) — para
operar a frota de edges: ver saúde/telemetria, publicar/reverter updates, gerir
licenças/leases e o financeiro das contas. Expande o `/frota` que já existe. É
**cross-tenant** (enxerga todas as lojas), com **RBAC próprio** e acesso mínimo por perfil.

## 2. Princípios
- **Realm de auth separado**: usuários da DISTRIBUIÇÃO, distintos dos usuários das lojas.
- **Least-privilege**: cada perfil lê/controla só o necessário.
- **LGPD**: perfis técnicos **não** veem dado pessoal de clientes das lojas (redigir).
- **Auditoria imutável** de toda ação da distribuição (quem, o quê, quando, alvo).
- **Nada disso vai para o edge**: tabelas marcadas `@cloud-only` (o `apply-all-local`
  já pula no edge) ou schema próprio `distribuicao`.

## 3. Onde os dados vivem (decisão)
- **Agora: Supabase com isolamento lógico** — tabelas da distribuição em schema
  `distribuicao` (ou marcadas `@cloud-only`, como a `telemetria_evento`). Simples,
  mesmo backend, RBAC/isolamento limpos.
- **Futuro (se precisar):** (a) **projeto Supabase separado** para isolamento físico
  (a nuvem das lojas cair não derruba o painel da distribuição); (b) **Sentry/GlitchTip
  self-host** só para telemetria de erro, se o volume/observabilidade crescer.
- **Nunca no local** (é dado centralizado da distribuição).

## 4. Modelo de auth
- Tabela `usuario_distribuicao` (id, nome, email, senha_hash, perfil, ativo, mfa_*).
  Separada de `colaborador` (lojas). Login próprio (ex.: `admin.dmsregem.com` ou
  `/distribuicao`), sem relação com `tenant_id` de loja.
- Sessão/JWT com claim `escopo: 'distribuicao'` + `perfilDist`. Guard dedicado
  (`DistribuicaoGuard`) que **nunca** aceita token de loja e vice-versa.
- Recomendado: **MFA** + **allowlist de IP** no login da distribuição.

## 5. Perfis + matriz de acesso
| Perfil | Frota/health | Telemetria | Atualizações | Licenças/Leases | Financeiro | PII das lojas |
|---|---|---|---|---|---|---|
| **Diretoria** (C&O/presidente da distribuição) | ✔ ler | ✔ ler/resolver | ✔ publicar/reverter | ✔ gerir | ✔ tudo | limitado (LGPD) |
| **Técnico** (manutenção) | ✔ ler | ✔ ler/resolver | ✔ publicar/reverter/reprocessar | ✔ ler status/fingerprint | ✘ | ✘ (redigido) |
| **Financeiro** | ✔ ler (básico) | ✘ | ✘ | ✔ status/renovar | ✔ cobrança/inadimplência | ✘ |

(Least-privilege: começar restritivo; abrir só o que a operação exigir.)

## 6. Superfícies do console
- **Frota**: lojas (tenant), versão do edge, online/heartbeat, última atualização, modo (nuvem/local).
- **Telemetria**: erros por loja/versão, ocorrências, "resolver", atrelado à versão (base `telemetria_evento`).
- **Atualizações**: publicar zip/versão (hoje manual via env), ver adoção por loja, disparar rollback remoto.
- **Licenças/Leases**: status, fingerprint, renovar/revogar, trial.
- **Financeiro**: assinatura, cobrança, inadimplência.

## 7. Regras invioláveis
- Cross-tenant **escopado por perfil** (técnico não vê financeiro; financeiro não vê logs técnicos).
- LGPD: telemetria/logs **redigem** PII antes de exibir ao técnico.
- **Auditoria** append-only de toda ação (publicar update, revogar lease, resolver erro…).
- Ações remotas destrutivas (rollback, revogar) exigem **confirmação** + registro.

## 8. Fases de implementação (quando liberado)
1. ✅ **FEITA (18/07/2026) — Auth + perfis da distribuição**: mig **123** `@cloud-only` (`usuario_distribuicao` + `distribuicao_auditoria`); módulo `distribuicao` (login com secret próprio `DIST_JWT_SECRET`/escopo `distribuicao`, `DistribuicaoGuard` + `PerfilDistGuard` + `@PerfilDist`, auditoria append-only, bootstrap do 1º diretoria por `DIST_BOOTSTRAP_SECRET`); frontend `/distribuicao/login` + `/distribuicao` (home com gestão de usuários p/ diretoria + placeholders dos painéis). Smoke-test ponta a ponta OK. **Decisões:** rota no Next atual (não app separado); sem MFA nesta fase.
2. **Painel Frota + Telemetria** — consumir `edge_heartbeat` + `telemetria_evento`; view técnica (sem PII).
3. **Licenças/Leases + Financeiro** — reaproveitar o modelo de lease/licença existente.
4. **Ações remotas** — publicar update / rollback remoto / reprocessar, com auditoria + confirmação.

## 9. Pré-requisitos (concluir ANTES de iniciar — para não ficar pendência perdida)
- [ ] Lote atual em `dev-local` **mergeado + deployado** (PR #200) e **migrations 119–122
      aplicadas na nuvem**.
- [ ] **Zip do edge** publicado com as fases (proteção Fase 1 + telemetria) e testado num edge real.
- [x] **Pendência P4 (RESOLVIDA):** reconcile de mídia sobe por endpoint na nuvem
      (`POST /midia/edge/upload`, sync-token); o edge não tem a service key.
- [ ] **DPAPI**: validar o boot com segredos cifrados num **edge de teste** antes de ligar por padrão.
- [ ] (Opcional) Fases seguintes de proteção (bytenode / lógica crítica na nuvem) — não bloqueiam o console.

## 10. Decisões em aberto (confirmar antes de implementar)
- Schema `distribuicao` no mesmo projeto Supabase **vs** projeto separado.
- Subdomínio do console (`admin.dmsregem.com`) e se é app à parte ou rota no mesmo Next.
- Provedor de MFA (TOTP próprio vs serviço).
- Telemetria fica no Supabase ou migra para Sentry/GlitchTip.
