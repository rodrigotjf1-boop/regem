# 06 · Como os templates foram implementados

> Estado em 01/10/2026. Os arquivos `00` a `05` são a especificação; este diz o que entrou no código, onde está e o que ficou diferente do protótipo.

## 1. Estado

| Entrega | O que faz | Situação |
|---|---|---|
| **A** | Os quatro templates completos, em **prévia** pelo link `?tema=galeria|balcao|oferta|fluxo` (o cardápio da loja no template, sem mudar a escolha dela). O layout de antes continuava valendo para todo mundo. | no ar (PR #601) |
| **B** | Os layouts `classic`, `fastfood` e `grid` saem; loja que estava num deles passa ao **Regem Fluxo**; o painel (Delivery → Configurações → "Modelo do cardápio") lista os quatro templates, com a linha "Indicado para…" e o link **Ver prévia**. `?tema=` continua valendo como prévia. | PR seguinte ao #601 |

## 2. Onde está cada coisa

```
frontend/src/components/loja/cardapio/
├── use-cardapio.ts          toda a regra: dados, carrinho, checkout, pedido, identidade, privacidade, navegação
├── etapas.ts                etapas do checkout e falta() — puro, sem React
├── tipos-template.ts        as 4 chaves, templateDe(), opções por template
├── cardapio-templates.tsx   junta tudo: vitrine + barra da sacola + camadas abertas
├── vitrines.tsx             as 4 vitrines e as 4 barras da sacola
├── produto.tsx              tela do produto (4 apresentações, uma regra)
├── checkout.tsx             Sacola, Entrega, Dados, Pagamento e Revisar
├── confirmacao.tsx          pedido enviado (Pix, linha do tempo, pontos a caminho)
├── conta.tsx                "Sua conta": entrar, Pedidos, Benefícios e Perfil
├── folhas.tsx               busca, informações da loja e "Onde você está?"
├── partes.tsx               ícones, foto, preço, selo, cor sobre a cor da loja
└── fontes.ts                Bricolage Grotesque, DM Sans, Rubik e Lexend (arquivos em src/fonts)
frontend/src/app/c/[token]/temas/templates.css   CSS dos 4 templates, todo sob `.p-root`
frontend/scripts/check-etapas.mjs                asserts das regras das etapas (npm test)
backend/src/modules/cardapio/menu-themes.ts      layouts aceitos, eventos do funil, próxima abertura
```

- **Regra × apresentação.** `useCardapio` concentra a lógica que estava em `page.tsx` (os mesmos efeitos, as mesmas chamadas e o mesmo corpo do `POST /pedido`). Os templates não têm regra nenhuma.
- **Navegação em pilha.** Produto, busca, conta, informações e as etapas do checkout abrem como camadas. Enquanto há camada aberta existe **uma** entrada no histórico do navegador: o "voltar" do aparelho fecha a camada de cima (uma etapa, o produto, a busca) em vez de sair do cardápio.
- **CSS.** Portado do protótipo. Todo seletor fica sob `.p-root` (nada alcança o resto do app); tokens `--p-*` por template; a cor da loja chega por `--p-acc`, com `--p-on` (texto sobre ela) e `--p-acc-soft`. Modo escuro: os mesmos tokens sob `body.tema-escuro`.
- **Fontes.** `next/font/local` com `preload: false` — o navegador só baixa a fonte do template usado, e o build nunca busca nada no Google.
- **Layout antigo.** Não há migration: a coluna guarda o que foi gravado e a troca acontece na LEITURA (`templateDoCardapio` no servidor, `templateDe` na tela) — `classic`, `fastfood`, `grid` ou vazio abrem no Regem Fluxo. Na gravação só entram as 4 chaves; um valor antigo vindo de tela desatualizada não troca o que está gravado. Saíram `item-sheet`, `cart-sheet`, `bottom-nav`, `banner-carousel`, `cliente-panel`, `pedidos-panel`, `promos-panel` e `menu-theme.css`.
- **O que a loja já tinha configurado continua valendo:** cor principal, banners e intervalo, "Itens em destaque", "Últimos pedidos", tema claro/escuro, **cor do cabeçalho** (pinta o bloco com o nome da loja nos quatro templates) e **logo em emoji** (quando não há imagem).
- **Servidor.** `menu_theme` aceita as 4 chaves novas (coluna `text`, sem migration); o funil aceita `etapa_entrega` e `etapa_dados` (a etapa de pagamento usa `pagamento`, que já existia e nunca era enviado); o cardápio público ganha `proximaAbertura { entrega, retirada }` ("18:00" ou "sex 18:00").

## 3. O que ficou diferente do protótipo

| # | No protótipo | No cardápio real | Por quê |
|---|---|---|---|
| 1 | "Vira trio?" na sacola (Fluxo) e "Transforme em trio" no produto (Oferta) | **não entrou** | depende de combo vinculado no cadastro do produto (Fase B, base §9.1); com preço fixo de exemplo seria inventar regra |
| 2 | Sacola barra abaixo do pedido mínimo | o mínimo aparece na vitrine e **não barra** | hoje nem a tela nem o servidor barram (05 §3.1); barrar é mudança de regra e espera a decisão do dono |
| 3 | Sem cupom ativo, nenhum campo de cupom | há sempre "Tenho um cupom" (recolhido) | existem cupons que não são públicos (campanha, ferramenta de anúncios); sem o campo o cliente não teria onde digitar |
| 4 | Dinheiro, maquininha e vale-refeição separados | as formas são as do **cadastro da loja** (`loja.pagamentos`): "Pagar na entrega" (com troco) e as demais | a tela não inventa forma que a loja não cadastrou |
| 5 | Capa (Balcão) e faixa (Oferta) com imagem fixa | mostram os **banners da loja**, em carrossel, com o link de cada um; sem banner, um fundo na cor da loja. O Fluxo ganhou uma faixa de banners | banner com link é recurso de hoje (regra de ouro) |
| 6 | "Mais pedidos" sempre | só com produto marcado como destaque ou com selo "mais pedido"/"novo", e com "Mostrar destaques" ligado | é a regra de hoje |
| 7 | "X% de volta" para qualquer visitante | o percentual de cashback só aparece para o cliente identificado; o valor a ganhar não é mostrado (só o percentual) | a rota pública só devolve o plano com prova de dono; a conta do valor é do servidor |
| 8 | Número do endereço obrigatório | só bairro (ou localização) e rua | é a regra de hoje |
| 9 | "Agendar" sempre disponível | só com o modo encomenda ligado (ou nos serviços) | é a regra de hoje |
| 10 | Endereço: só o formulário | + endereços salvos, "Buscar a rua pelo CEP" e "Salvar este endereço na minha conta" | recursos de hoje |
| 11 | WhatsApp da loja como texto | botão que abre a conversa com a mensagem pronta (desligado enquanto o Pix não cai) | é o comportamento de hoje |
| 12 | Perfil com endereço só de leitura | usar, excluir, novo e **tornar principal** (a rota existia e não tinha botão) + aparência claro/escuro | 05 §2.1 |
| 13 | Adicionais sempre recolhidos (Fluxo) | recolhidos só quando o produto tem escolha obrigatória | sem obrigatório, a tela ficaria vazia |
| 14 | Regem Fluxo sem logo no topo | o logo da loja aparece ao lado do nome (quando a loja tem logo ou emoji) | o layout antigo mostrava o logo; sem ele a loja perderia a marca no template padrão |
| 15 | Cabeçalho sempre na cor do template | com "Cor de fundo" do cabeçalho escolhida em "Editar tema", o bloco do nome da loja usa essa cor e a cor de texto escolhida | configuração que a loja já tinha |

Ainda por fazer: a página de acompanhamento `/c/[token]/pedido/[id]` continua com o visual antigo (05 §2.7, último item).

## 4. Como foi conferido

- **Mesmo pedido, mesmo corpo.** O mesmo pedido (produto com escolha obrigatória + produto simples, entrega por bairro, pagamento na entrega com troco) foi feito no layout antigo e em cada template, contra uma API simulada com o cardápio real da loja piloto: o corpo do `POST /pedido` saiu **idêntico** nos cinco (fora o `clientRef`, que é aleatório).
- **Cenários** (mais de 70 verificações, no build de produção): loja fechada com e sem encomenda, só retirada, QR de mesa, cliente reconhecido e pedido expresso, conta (Pedidos, Benefícios, Perfil, entrar), Pix pendente, recusa do servidor, frete por raio, busca, informações, modo escuro, cupom + CPF + caixinha de promoções, origem do anúncio, ramos serviços e indústria, voltar do aparelho, 375 px sem rolagem horizontal e desktop.
- **Entrega B:** os mesmos pedidos refeitos com o template vindo da loja (sem `?tema=`): corpo idêntico ao do layout antigo; loja com `fastfood` gravado abre no Regem Fluxo; cor de cabeçalho e logo em emoji conferidos nos quatro.
- **Produção (entrega A):** os quatro templates abertos em `app.dmsregem.com` com o cardápio real da loja piloto, só leitura.
- **Regras das etapas:** `npm test` em `frontend/` (13 grupos de casos).
