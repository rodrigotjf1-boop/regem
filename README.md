# Regem

Plataforma de gestão administrativa e operacional **modular, configurável e revendável**, com hierarquia completa do dono à ponta. Âncora de validação (MVP): **food service — bares, restaurantes e fast foods**.

> **Fonte da verdade:** este README é um resumo de alto nível. As regras e o estado
> atuais vivem em [`CLAUDE.md`](CLAUDE.md) e em [`docs/`](docs/) (especificação,
> decisões de design, lógica de negócio). O deploy real está em
> [`DEPLOY-EASYPANEL.md`](DEPLOY-EASYPANEL.md) (EasyPanel na VPS + Supabase).

## Arquitetura (resumo)

- **Nuvem** (PostgreSQL): base consolidada + dashboard do Presidente/C&O + API externa. Serve também de **backup** dos nós locais.
- **Nó local por unidade** (mini-PC Windows/Linux): fonte da verdade no LAN, **opera offline**, sincroniza com a nuvem. Dispositivos da loja (tablet do gerente, terminal do operador, KDS) são clientes do nó local.
- **Sincronização com posse de escrita particionada:** config/cadastros são donos na nuvem (descem); operação (tarefas, checklists, movimentos) é dona no nó local (sobe). Conflito ~ inexistente.
- **Schema sync-ready:** `uuid` como PK, soft delete, `updated_at`, padrão outbox/change-feed, ledger append-only para estoque.

## Personas × superfície

| Persona | Superfície | Dispositivo |
|---|---|---|
| Presidente / C&O | Dashboard analítico (nuvem) | Web / desktop |
| Gerente | App operacional | Tablet (recomendado) / celular / PC fixo |
| Supervisão | App operacional (escopo do setor) | Tablet / celular |
| Execução | POP + folha + aceite | Papel + terminal compartilhado (PIN) |
| Hub / KDS | Alertas e informativos | Mini-PC + tela |

## Front-end

Layout e UX são **prioridade de produto** (usabilidade define a adesão). Construir com as skills de design, por persona, com foco em telas rápidas para uso operacional.

## Stack

- **Banco:** PostgreSQL (nuvem) + réplica/nó local.
- **API:** versionada (`/api/v1/...`), contratos/DTO estáveis, `api_client` + scopes (amarrados a entitlements), webhooks alimentados pelo outbox. **API externa vive na nuvem.**
- **Front-end:** Next.js 14 (App Router) + Tailwind (responsivo, mobile-first para o app do gerente).

## Estrutura

```text
Regen/
  database/
    migrations/        # NNN_nome.sql (PostgreSQL)
  docs/
    MODELO-DADOS.md    # modelo lógico Fases 0–1
  README.md
```

## Status / Roadmap

- **Fase 0 — Fundação:** multi-tenant, RBAC/hierarquia, cadastros base, entitlements, API, auditoria. → migrations `001`, `002` criadas.
- **Fase 1 — Núcleo de valor:** escala (etiquetas) → tarefa → checklist/POP. → migration `003` criada.
- **Fase 2:** desperdício/vistoria/exportação; ocorrências (registro).
- **Pós-MVP / tiers pagos:** estoque completo, gamificação/ranking, dashboard analítico, manutenção, multiunidade, IA, ponto/jornada, marketplace de templates por ramo.

> Visão de produto detalhada mantida na memória do projeto (`project_regen.md`).
