# Regem · Pacote de templates do cardápio digital

Especificação para o **Claude Code** implementar 4 templates novos no cardápio público do Regem (`frontend/src/app/c/[token]`), no mesmo formato do pacote de templates do totem GoGeM (`rodrigotjf1-boop/gogem`, `docs/templates/`): uma base comum feita primeiro e um arquivo por template, cada um com checklist de aceite.

| # | Template | Valor de `menuTheme` | Referência de mercado | Arquivo |
|---|----------|----------------------|-----------------------|---------|
| — | Base comum (fazer primeiro) | — | — | [`00-base-cardapio.md`](00-base-cardapio.md) |
| 1 | Galeria — foto grande, vitrines em carrossel | `galeria` | Brendi | [`01-galeria.md`](01-galeria.md) |
| 2 | Balcão — lista objetiva com abas fixas | `balcao` | Cardápio Web | [`02-balcao.md`](02-balcao.md) |
| 3 | Oferta — promoções e combos na frente | `oferta` | Anota AI | [`03-oferta.md`](03-oferta.md) |
| 4 | **Regem Fluxo** — clean, uma decisão por tela | `fluxo` | próprio do Regem | [`04-regem-fluxo.md`](04-regem-fluxo.md) |
| — | Recursos do cardápio de hoje nos templates (ler junto com a base) | — | — | [`05-recursos-integrados.md`](05-recursos-integrados.md) |
| + | **Eventos sazonais** — camada por cima de qualquer template (Natal, Carnaval, Halloween, Dia do Hambúrguer, Dia de jogo e mais 8); o presidente liga só os que quiser | `temaConfig.eventos` | — | [`06-eventos-sazonais.md`](06-eventos-sazonais.md) |
| + | **Clube de recompra** — raspadinha, álbum de selos, aniversário e meta do mês (sem sorteio, dispensa autorização) · *não implementado* | módulo `clube` | — | [`07-clube-de-recompra.md`](07-clube-de-recompra.md) |
| + | **Eventos nas TVs (RegemBoard)** — a mesma camada de eventos no menu board (cópia de referência) | `contas.aparencia.eventos` | — | [`08-eventos-no-regemboard.md`](08-eventos-no-regemboard.md) |
| — | **O que está implementado**, onde fica, o que ficou diferente do protótipo e como foi conferido | — | — | [`IMPLEMENTACAO.md`](IMPLEMENTACAO.md) |

**Estado (01/10/2026):** os 4 templates e os eventos sazonais estão implementados; o clube de recompra ainda não. **Prompts prontos para colar:** [`PROMPTS.md`](PROMPTS.md) (Regem e RegemBoard).

Todos os templates mantêm os recursos que o cardápio já tem hoje — conta do cliente (pedidos, benefícios, perfil), promoções pelo WhatsApp, aviso de origem do anúncio, sinal e recorrência da encomenda, QR de mesa e os ramos serviços e indústria —, conforme o `05-recursos-integrados.md` (conferido contra `origin/main` em 01/10/2026).

Todos os templates seguem as mesmas regras de **situação da loja** (aberta, só retirada, fechada com agendamento) e de **benefícios** (cupons, cashback, plano de fidelidade, só quando ativos), descritas nas seções 5.5 e 5.6 do `00-base-cardapio.md`.

> "Referência de mercado" indica o **padrão de navegação** que inspirou o template. Não copiar marca, logo, textos, ícones ou cores desses produtos. Os nomes dos templates são do Regem.

## Conteúdo do pacote

```
docs/templates-cardapio/
├── README.md                 ← este arquivo
├── 00-base-cardapio.md       ← arquitetura comum, contrato, regras do checkout em etapas, correções, API/admin
├── 01-galeria.md … 04-regem-fluxo.md
├── 05-recursos-integrados.md ← onde ficam os recursos de hoje em cada template + o que o código faz diferente da base
├── 06-eventos-sazonais.md    ← os 13 eventos, calendário, configuração do presidente, camada no front
├── 07-clube-de-recompra.md   ← raspadinha, selos, aniversário e meta do mês (especificação; não implementado)
├── 08-eventos-no-regemboard.md ← os mesmos eventos nas TVs (cópia da especificação do RegemBoard)
├── IMPLEMENTACAO.md          ← o que entrou no código, onde está e as diferenças para o protótipo
├── PROMPTS.md                ← prompts prontos (Regem e RegemBoard)
└── prototipo/
    └── prototipo-interativo.html   ← protótipo navegável: 4 templates, evento sazonal e clube de recompra (abra no navegador)
```

O protótipo é a **referência visual e de comportamento** (como os `mockups/*.html` do `CLAUDE.md`). Ele usa o cardápio da Mister Burguer como exemplo, com fotos de banco gratuito embutidas só para teste. No cardápio real, tudo vem de `menu.loja`, `menu.produtos`, `menu.bairros` etc.

## Como usar com o Claude Code

O `CLAUDE.md` do Regem pede **plano antes de código** em tarefa grande. Por isso cada PR começa pedindo o plano.

1. **PR 1 — base.** Cole:

   > Leia `CLAUDE.md`, `docs/templates-cardapio/README.md`, `docs/templates-cardapio/00-base-cardapio.md` e `docs/templates-cardapio/05-recursos-integrados.md` por inteiro e abra `docs/templates-cardapio/prototipo/prototipo-interativo.html`. Apresente o plano da **Fase 0 (base comum)** e aguarde minha aprovação. Depois implemente só a Fase 0, sem template novo. Os temas `classic`, `fastfood` e `grid` precisam continuar idênticos. Rode `npm run build` em `backend/` e `frontend/`, abra o PR em PT-BR com o checklist de aceite do 00.

2. **PR 2 a 5 — um template por PR.** Recomendo começar pelo **Regem Fluxo** (é o padrão novo). Para cada um, cole trocando o arquivo:

   > Leia `docs/templates-cardapio/00-base-cardapio.md` e `docs/templates-cardapio/04-regem-fluxo.md`. No protótipo, selecione **Regem Fluxo** e percorra o pedido completo (com e sem "Cliente que já comprou"). Apresente o plano e aguarde aprovação. Implemente o template seguindo o contrato da base, sem mudar regra de negócio do pedido. Compare com o protótipo tela a tela, liste as divergências na descrição do PR e entregue com o checklist de aceite do arquivo.

3. **Eventos sazonais — implementados** (ver `IMPLEMENTACAO.md` §5). O presidente liga os eventos em Delivery → Configurações → Eventos; para ver um evento sem ligar, abra o cardápio com `?evento=natal` (ou o botão "Ver prévia" do painel).

4. **Clube de recompra — a fazer.** O `07-clube-de-recompra.md` traz o resumo, o modelo de dados, as regras e os prompts de 4 PRs. Leia antes a seção "Antes de implementar" dele: o gancho do pedido concluído roda também no servidor da loja.

5. **Fase B (opcional, depois):** itens marcados como Fase B na seção 9 do `00-base-cardapio.md` (vira trio cadastrado, upsell por histórico, recuperação de carrinho etc.). Cada um é um PR próprio porque mexe em backend e migration.

## Como conferir o resultado

- Abra o protótipo e o cardápio real lado a lado, em 375 px de largura, com o mesmo template.
- Faça o pedido completo nos dois: produto com escolha obrigatória, produto simples, sacola, entrega, dados, pagamento Pix e confirmação.
- No protótipo, ligue em "Recursos e cliente" **Loja manda promoção**, **Chegou por anúncio** e **Encomenda com sinal**, e abra o ícone de conta: os quatro templates têm de mostrar os mesmos recursos.
- Use o checklist de aceite no fim de cada arquivo na revisão do PR.
