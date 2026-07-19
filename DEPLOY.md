# Deploy do Regem — documento obsoleto ⚠️

> **Este runbook está OBSOLETO.** Ele descrevia um deploy antigo em
> **Vercel + Render**, que não é mais usado. Foi mantido só para não quebrar links.

O deploy **real e atual** do Regem é:

- **Frontend + Backend:** EasyPanel na VPS (serviços `regem-api` e `regem-web`, Docker)
- **Banco:** Supabase
- **Auto-deploy:** todo push em `main` sobe sozinho (CI verde antes do merge)

👉 **Siga [`DEPLOY-EASYPANEL.md`](DEPLOY-EASYPANEL.md)** (fonte da verdade do deploy)
e as regras em [`CLAUDE.md`](CLAUDE.md).

O edge (servidor local on-premise) tem seu próprio fluxo de publicação/atualização —
ver [`backend/edge/`](backend/edge/) e a documentação de distribuição em [`docs/`](docs/).
