# 00 · Base comum dos templates do cardápio digital

> Documento de engenharia para o Claude Code. Leia inteiro antes de mexer no código. Os 4 arquivos de template (`01` a `04`) dependem deste.

## 1. Objetivo

Adicionar 4 templates ao cardápio público (`/c/[token]`), selecionáveis por loja em **Delivery → Configurações → Estilo do cardápio (layout)**:

| Valor `menuTheme` | Nome no admin | Identidade |
|---|---|---|
| `galeria` | Galeria (foto grande e vitrines) | branco, cards com foto grande, carrosséis, botão flutuante da sacola |
| `balcao` | Balcão (lista com abas fixas) | cinza claro, capa + logo, busca fixa, lista com foto à direita |
| `oferta` | Oferta (promoções e combos) | branco, faixa na cor da loja, amarelo de promoção, frete grátis em destaque |
| `fluxo` | Regem Fluxo (clean, recomendado) | branco, tinta navy, hairlines, cor da loja só na ação principal |

Cada template muda **layout e comportamento de navegação**, não só cores. Todos compartilham uma mudança grande: **o checkout deixa de ser uma tela única e passa a ser em etapas**.

**Não muda:** regras do pedido (idempotência por `clientRef`, validação de complementos no servidor, cupom, fidelidade, cashback, prêmios, cupom fiscal, agendamento/recorrência, raio/bairro, Pix via Mercado Pago, origem do clique, beacons do funil, QR de mesa, ramos `servicos`/`industria`).

Os temas `classic`, `fastfood` e `grid` **continuam funcionando exatamente como hoje** (são o fallback). Nenhum seletor novo pode vazar para eles.

## 2. Como o código está hoje (levantado do repositório)

- Página: `frontend/src/app/c/[token]/page.tsx` (~1.280 linhas, 33 `useState`). Concentra dados, regras, beacons, scroll-spy, busca e todo o JSX dos 3 temas.
- Tema/layout: `loja.menuTheme` (`classic | fastfood | grid`) validado em `backend/src/modules/cardapio/cardapio.service.ts` (2 lugares: gravação ~l.374 e leitura pública ~l.1366). Coluna `cardapio_config.menu_theme text` (mig. 110), sem `check`.
- Estilos dos temas: `app/c/[token]/menu-theme.css`, sempre escopados por `.lp-menu[data-menu-theme='…']`.
- Componentes em `frontend/src/components/loja/`:
  - `item-sheet.tsx` — produto (variação, grupos min/max, observação, quantidade). Já tem modo rico para `fastfood`/`grid`.
  - `cart-sheet.tsx` — **tudo do checkout numa tela**: itens, frete grátis, peça também, cupom e sugestões, entrega/retirada, endereço (bairro ou raio), nome/telefones, CPF na nota, quando/agendamento/recorrência, CNPJ (indústria), pagamento (+ bandeira, troco), prêmios, cashback, totais.
  - `bottom-nav.tsx`, `banner-carousel.tsx`, `promos-panel.tsx`, `pedidos-panel.tsx`, `cliente-panel.tsx`, `aviso-origem.tsx`, `tipos.ts`.
- Confirmação/acompanhamento: `app/c/[token]/pedido/[id]/page.tsx`.
- Admin: `components/delivery/config-panel.tsx` (select "Estilo do cardápio (layout)").
- Cor da loja: `loja.temaConfig.corPrimaria` → `TEMA[ramo]` → `#E2A340`. Modo escuro: `loja.tema` + escolha do cliente (classe `tema-escuro` no body).

> Antes de começar, **confirme cada ponto acima em `origin/main`** (regra do `CLAUDE.md`). Se algo mudou, siga o código e anote a diferença no PR.

## 3. Problemas do cardápio atual que a base corrige

Levantados nas telas da Mister Burguer em produção. As correções 3.1 a 3.5 valem para **todos** os templates novos (e podem ser levadas ao `classic` num PR separado, se aprovado).

| # | Hoje | Correção |
|---|------|----------|
| 3.1 | Checkout numa tela só, rolagem longa, informações misturadas. | Checkout em etapas (seção 5). |
| 3.2 | No produto, os grupos aparecem na ordem do cadastro: no Trio 08, 10 adicionais vêm antes de Batata e Bebida, que são obrigatórios. | Ordenar **obrigatórios primeiro** (mantendo a ordem relativa do cadastro dentro de cada bloco). |
| 3.3 | "Fazer pedido" fica desbotado sem dizer o que falta. | Toda etapa tem `falta()` (seção 5.3); o template mostra o motivo. |
| 3.4 | O resumo mostra frete **Grátis** antes do endereço (`taxa` cai em `?? 0`). | Novo estado `taxaPendente`: com entrega e sem bairro (ou sem localização no modo raio), mostrar **"a calcular"**. O total exibido não soma frete enquanto pendente, e o botão final não habilita. |
| 3.5 | Checkout mostra "+29 pts"; a confirmação diz "Você tem 0 pontos". | Confirmação mostra **"29 pontos a caminho · entram no saldo quando o pedido for concluído"** e, se houver, o saldo atual separado. |
| 3.6 | O aviso pede CEP, mas não há campo de CEP. | Ordem: bairro (com a taxa na própria opção) → rua → número → complemento. No modo raio, "Usar minha localização" vem antes da rua. O texto do aviso acompanha o modo. |
| 3.7 | Cupom e "Peça também" disputam espaço com o formulário. | Sugestões na etapa Sacola; cupom na Sacola ou recolhido no Pagamento (cada template diz onde). |
| 3.8 | Depois de adicionar, abre a pergunta "continuar comprando ou finalizar" (`perguntaAdd`). | Nos templates novos: toast curto + "bump" na barra da sacola. Sem modal. |
| 3.9 | A confirmação não diz quando o pedido chega. | Previsão de horário (`criadoEm + tempoEntregaMin/tempoRetiradaMin`) e linha do tempo do status. |

## 4. Fase 0 — base comum (PR 1)

### 4.1 Separar regra de apresentação

Hoje a lógica e o JSX estão juntos em `page.tsx`. Crie um hook que **move a lógica sem alterá-la**:

```
frontend/src/components/loja/cardapio/
├── use-cardapio.ts        ← tudo que hoje é estado/efeito/derivado em page.tsx
├── etapas.ts              ← definição das etapas e falta() (puro, sem React)
├── tipos-template.ts      ← contrato CardapioTemplate + props
└── registro.ts            ← templateDe(menuTheme)
```

`useCardapio(token, mesa)` devolve um objeto estável com, no mínimo:

- **dados:** `menu`, `loja`, `produtos`, `categorias`, `bairros`, `destaques`, `produtosPromo`, `upsell` (peça também já resolvido), `ultimoPedido`, `temCliente`, `abertaAgora`, `abertoPorTipo`, `tipos`.
- **carrinho:** `cart`, `qtdItens`, `subtotal`, `onAdd(item)`, `mudarQtd(key, d)`, `removeItem(key)`, `addUpsell(p)`, `reordenarUltimo()`.
- **checkout:** `chk`, `setChk`, `taxa`, `taxaPendente`, `desc`, `premio*`, `cashback*`, `totalFinal`, `pontosPrevistos`, `cupomOk`, `aplicarCupom(c)`, `cuponsSugeridos`, `enderecos`, `submitPedido()`, `enviando`, `erro`.
- **UI comum:** `accent`, `dark`, `alternarTema()`, `busca`, `setBusca`, `resultadosBusca`, `beacon(tipo)`.

`page.tsx` fica assim:

```tsx
const c = useCardapio(token, mesa);
const tpl = templateDe(c.loja?.menuTheme);
if (tpl) return <tpl.Pagina c={c} />;   // galeria | balcao | oferta | fluxo
return <CardapioLegado c={c} />;         // classic | fastfood | grid: JSX atual, intacto
```

`CardapioLegado` é o JSX de hoje recortado para um componente, lendo de `c`. **Teste de regressão do PR 1:** os três temas antigos renderizam pixel a pixel iguais antes e depois (comparar screenshots em 375 px e 1280 px, claro e escuro).

### 4.2 Contrato do template

```ts
// tipos-template.ts
export type Etapa = 'sacola' | 'entrega' | 'dados' | 'pagamento';

export interface CardapioTemplate {
  chave: 'galeria' | 'balcao' | 'oferta' | 'fluxo';
  /** Etapas do checkout, na ordem. A base remove etapas que não se aplicam (seção 5.2). */
  etapas: Etapa[];
  /** true = campos de "dados" vão dentro da etapa entrega (Galeria e Oferta). */
  dadosNaEntrega?: boolean;
  Vitrine: React.FC<{ c: Cardapio; onAbrir(p): void; onAddRapido(p): void; onSacola(): void }>;
  Produto: React.FC<ProdutoProps>;          // sheet ou página, conforme o template
  CheckoutCabecalho: React.FC<{ etapa: Etapa; indice: number; total: number; onVoltar(): void; onFechar(): void }>;
  CheckoutRodape: React.FC<{ etapa: Etapa; falta: Falta | null; valor: number; ultimo: boolean; onAvancar(): void }>;
  BarraSacola: React.FC<{ c: Cardapio; onAbrir(): void }>;
  /** Opções das seções comuns do checkout (onde fica o cupom, estilo do upsell etc.). */
  opcoes: OpcoesCheckout;
}
```

O **conteúdo** de cada etapa (itens, endereço, pagamento…) é um componente comum em `components/loja/checkout/` (seção 6), estilizado pelos tokens do template. O template desenha a vitrine, o produto, o cabeçalho e o rodapé do checkout.

### 4.3 Tokens e escopo de CSS

- Cada template declara seus tokens como variáveis CSS num arquivo próprio `app/c/[token]/temas/<chave>.css`, **escopado** por `.lp-menu[data-menu-theme='<chave>']`. Nada fora desse escopo.
- Variáveis mínimas: `--m-bg --m-surf --m-card --m-ink --m-mut --m-line --m-art --m-r --m-rs --m-rbtn --m-font --m-disp --m-num`. A cor da loja continua chegando por `--brand-primary` (já existe) e a cor do texto sobre ela por `--brand-on` (nova: escura quando a luminância da cor > 0,45; senão branca).
- Modo escuro: cada template define os mesmos tokens sob `body.tema-escuro .lp-menu[data-menu-theme='<chave>']`.
- Fontes: `next/font/google` (self-hosted no build, sem request ao Google em runtime), carregadas **só** quando o template é usado.

| Template | Display | Texto | Números |
|---|---|---|---|
| Galeria | Bricolage Grotesque 600–800 | DM Sans 400–700 | DM Sans |
| Balcão | Rubik 400–600 | Rubik | Rubik |
| Oferta | Lexend 600–800 | Lexend 400–600 | Lexend |
| Regem Fluxo | Archivo 700–800 | Figtree 400–700 | JetBrains Mono 500–700 (identidade Regem) |

### 4.4 Backend e admin

1. `cardapio.service.ts`: nos **dois** pontos de validação, troque a lista por uma constante exportada `MENU_THEMES = ['classic','fastfood','grid','galeria','balcao','oferta','fluxo'] as const`.
2. `schema.ts`: atualize o comentário da coluna `menuTheme`.
3. **Sem migration** (coluna `text` sem `check`). Se o Claude Code achar um `check` em `origin/main`, criar a próxima migration na sequência, idempotente.
4. `docs/openapi.json`: regenerar (`npm run build && npm run openapi`) se o DTO tiver enum.
5. Admin (`config-panel.tsx`): acrescentar as 4 opções com os rótulos da seção 1, com **Regem Fluxo** marcado "(recomendado)". Abaixo do select, uma linha de ajuda que muda com a opção escolhida (o "Indicado para" de cada arquivo de template).
6. Registrar a decisão em `docs/decisoes-design.md` §6 (changelog).

### 4.5 Aceite da Fase 0

- [ ] `useCardapio` criado; `page.tsx` só escolhe entre template novo e `CardapioLegado`.
- [ ] `classic`, `fastfood` e `grid` idênticos ao `origin/main` (screenshots antes/depois anexados ao PR).
- [ ] `etapas.ts` com `etapasAtivas()` e `falta()` (seção 5) + correções 3.2 a 3.5 disponíveis para os templates.
- [ ] Componentes comuns do checkout (seção 6) criados, ainda sem uso visível.
- [ ] Backend aceita as 4 chaves; admin lista as 4 (enquanto um template não existir, `templateDe` devolve `null` e cai no legado).
- [ ] `npm run build` verde em `backend/` e `frontend/`; CI verde.

## 5. Checkout em etapas (vale para os 4 templates)

### 5.1 As etapas

| Etapa | Conteúdo | Sai quando |
|---|---|---|
| **Sacola** | itens (foto, nome, complementos em linha pequena, total da linha, quantidade/lixeira), "Adicionar mais itens", barra de frete grátis (se o template usa), peça também, cupom (se o template põe aqui), subtotal | há itens e subtotal ≥ `pedidoMinimo` |
| **Entrega** | Entrega/Retirada/Consumir no local (conforme `tipos` e `abertoPorTipo`), endereço (salvo ou novo), quando (agora/agendar, encomenda, recorrência) | endereço completo para entrega; horário escolhido se agendar |
| **Dados** | nome, WhatsApp, telefone 2 (opcional), CNPJ (indústria), profissional (serviços) | nome e telefone com DDD válidos |
| **Pagamento** | forma (online primeiro: Pix, cartão online; depois na entrega: dinheiro, maquininha + bandeira, VR), troco, CPF/CNPJ na nota (só se `emiteNota`), prêmio, cashback, cupom (se o template põe aqui), resumo completo, pontos previstos | forma escolhida; documento válido se marcou nota; sem `taxaPendente` |

### 5.2 Etapas ativas

`etapasAtivas(template, contexto)`:

- Começa de `template.etapas`.
- **QR de mesa** (`menu.modo === 'mesa' && mesa`): só `sacola` → envio direto, como hoje.
- `dadosNaEntrega`: `dados` não existe; os campos entram no fim da etapa `entrega`.
- **Regem Fluxo:** usa `dadosNaEntrega` (3 etapas para cliente novo). Cliente reconhecido (`temCliente` com nome, telefone, endereço do `ultimoPedido` e última forma de pagamento) vai em **pedido expresso**: `sacola → revisar` (ver `04-regem-fluxo.md` §5.1). Qualquer "Trocar" na revisão volta ao fluxo normal na etapa certa.
- Ramo `servicos`: a etapa `entrega` vira **"Atendimento"** (profissional + horário).

### 5.3 `falta(etapa)`

Função pura em `etapas.ts`. Devolve `null` ou `{ campo, mensagem }`, sempre na ordem em que os campos aparecem na tela:

```
sacola:    'Sua sacola está vazia' | 'Faltam R$ X para o pedido mínimo'
entrega:   'Escolha o bairro' | 'Use sua localização' (raio) | 'Informe a rua' | 'Informe o número' | 'Escolha o horário'
           (+ regras de dados, quando dadosNaEntrega)
dados:     'Informe seu nome' | 'Informe seu WhatsApp com DDD' | 'Informe o CNPJ'
pagamento: 'Escolha como vai pagar' | 'Escolha a bandeira' | 'Confira o CPF ou CNPJ'
```

O rodapé de cada template usa `falta` (veja cada arquivo). `campo` é o `id` do input/âncora para rolar e focar. `submitPedido()` continua com as validações dele (defesa em profundidade).

### 5.4 Navegação

- Cabeçalho: **Voltar** volta uma etapa (na primeira, fecha o checkout e volta à vitrine com a rolagem preservada). **Fechar** (quando o template tem) volta à vitrine sem perder nada.
- O botão "voltar" do navegador/Android volta uma etapa: cada etapa empurra um estado no `history` (`?etapa=entrega`), sem recarregar.
- A rolagem do corpo da etapa vai ao topo ao trocar de etapa.
- O rodapé é fixo, com o **valor** no botão: na Sacola, subtotal menos desconto; nas demais, total (sem frete enquanto `taxaPendente`).
- Os beacons do funil continuam: `checkout` ao abrir a Sacola; acrescentar `etapa_entrega`, `etapa_dados`, `etapa_pagamento` (uma vez por sessão). Isso alimenta o funil por etapa no painel.

### 5.5 Situação da loja (vale para todos os templates)

Fonte: `menu.abertaAgora`, `menu.abertoPorTipo { entrega, retirada, local }`, `menu.horarioLabel` ("Aberta até 23:00" / "Abre às 18:00" / "Abre sex 18:00"), `menu.tipos`, `loja.encomenda` e as regras de agendamento que o `cart-sheet` já aplica. O servidor continua sendo quem libera ou recusa.

| Situação | Vitrine | Checkout |
|---|---|---|
| **Aberta** | status verde com `horarioLabel` | normal |
| **Só retirada agora** (`abertoPorTipo.entrega=false`, `retirada=true`) | status laranja "Só retirada · entrega a partir das HH:MM" + aviso no topo com o endereço da loja; faixa/barra de frete grátis somem | `tipo` começa em `retirada`; o botão Entrega fica desabilitado com "a partir das HH:MM" |
| **Só entrega agora** (o inverso) | status com "retirada a partir das HH:MM" | Retirada desabilitada com o horário |
| **Fechada** (`abertaAgora=false`) | status vermelho "Fechado agora · abre às HH:MM" + aviso "Monte seu pedido e agende o horário"; o cardápio continua navegável e o carrinho funciona | "O quanto antes" desabilitado ("fechado agora"); `quando='agendar'` com `datetime-local` `min` = próxima abertura; botão final "Agendar pedido" |
| **Fechada sem agendamento** | aviso "Abrimos às HH:MM" | botão da sacola desabilitado com "Loja fechada · abre às HH:MM" (comportamento de hoje) |
| `loja.aberto=false` (toggle manual) | "Fechada" sem horário | como fechada sem agendamento |

Regras: o aviso fica **no topo da vitrine** (não só no checkout) para o cliente saber antes de montar o pedido; o horário de volta sai do `horarioLabel`/`horarios` por tipo (`horariosRetirada` quando o horário não é único); a confirmação de pedido agendado mostra "Agendado para HH:MM" e a linha do tempo começa em "Pedido agendado".

### 5.6 Benefícios: cupons, cashback e fidelidade

Os três são **opcionais por loja**. Quando a loja não usa um deles, nada dele aparece (nem campo vazio, nem "0 pontos").

| Recurso | Quando aparece | De onde vem | Onde aparece |
|---|---|---|---|
| **Cupom** | a loja tem cupom ativo (`cardapioCupons`/`cuponsDisponiveis` não vazio) | `cardapioCuponsDisponiveis(telefone, subtotal)`; validação em `cardapioCupomValidar` | campo/sugestões no lugar que cada template define; o primeiro cupom disponível para o cliente aparece pronto para aplicar; cupom de primeira compra não aparece para cliente reconhecido; sem cupom ativo, **sem campo de cupom** |
| **Cashback** | a loja tem plano de cashback ativo | `cardapioCashback` (`valor`, `pontos`, `vales`, `planos` com `percentual`) | vitrine: "X% de volta" (ou o saldo do cliente); pagamento: "Usar meu cashback · R$ X disponível" (marcado por padrão, como hoje) e "Você recebe R$ Y de cashback"; resumo: linha "Cashback usado"; confirmação: "R$ Y de cashback a caminho" |
| **Fidelidade** | `loja.fidelidadeAtiva` | `cardapioPontos` (`planos` com `nome`, `pontosMeta`, saldo do cliente) e `cardapioFidelidadePremios` (prêmios prontos, abate automático como hoje) | vitrine: nome do plano e saldo/meta; pagamento: barra de progresso do saldo atual + os pontos deste pedido, com "Faltam N para {prêmio}" ou "Com este pedido você completa e ganha {prêmio}"; prêmio pronto aparece aplicado com opção de não usar; confirmação: "N pontos a caminho" |

Cálculo de exibição (o servidor recalcula tudo no pedido): `total = subtotal + frete − cupom − prêmio − cashbackUsado`; pontos previstos sobre o total; cashback a ganhar sobre `subtotal − descontos` × `percentual`. Os templates agrupam esses itens num bloco **"Seus benefícios"** no pagamento (componente `Beneficios`).

### 5.7 Confirmação

Na tela de pedido enviado (e em `/c/[token]/pedido/[id]`):
- Pix pendente: título **"Falta só o Pix"**, ícone de relógio na cor da loja (não o check verde), copia e cola com botão Copiar e contador de expiração; a linha do tempo começa em "Aguardando o Pix".
- Previsão de horário em destaque, linha do tempo do status, pontos a caminho (3.5), WhatsApp da loja como texto selecionável, **Fazer outro pedido**.

## 6. Componentes comuns (`components/loja/checkout/`)

| Componente | Função |
|---|---|
| `ItensSacola` | lista com quantidade/lixeira; linha some com animação de 250 ms ao remover |
| `BarraFreteGratis` | "Faltam R$ X para o frete grátis" + barra; some se `freteGratisAcima` vazio/0 ou retirada |
| `PecaTambem` | variantes `cards` (carrossel 132 px) e `linhas`; usa `addUpsell` (abre o produto quando há escolha obrigatória, como hoje) |
| `CupomBox` | input + Aplicar + chips de `cuponsSugeridos` + mensagem; variante `sugerido` (cartão com o 1º cupom disponível + "Tenho outro código"); não renderiza sem cupom ativo |
| `AvisoLoja` | aviso do topo da vitrine conforme 5.5 (só retirada / fechada) |
| `Beneficios` | bloco "Seus benefícios": `CupomBox`, usar cashback, `ProgressoFidelidade`, cashback a ganhar (5.6) |
| `ProgressoFidelidade` | barra com saldo atual + pontos deste pedido e o texto do prêmio |
| `TipoRecebimento` | segmentado Entrega/Retirada/Local com o tempo de cada um |
| `Endereco` | salvo (cartão com Trocar) ou novo: bairro (com taxa na opção) ou localização (raio) → rua → número → complemento |
| `Quando` | agora/agendar, encomenda (min/max), recorrência; sempre `datetime-local` nativo |
| `DadosCliente` | nome, WhatsApp, telefone 2, CNPJ/profissional conforme ramo |
| `FormasPagamento` | grupos "Pague agora" / "Pague na entrega"; selo "Mais rápido" no Pix quando o template pede; bandeiras; troco |
| `NotaFiscal` | caixa "CPF/CNPJ na nota" só com `emiteNota` |
| `Resgates` | prêmio de fidelidade e cashback (como hoje) |
| `Resumo` | subtotal, entrega ("a calcular" / "Grátis" / valor), descontos, total |
| `PontosPrevistos` | substituído por `ProgressoFidelidade` |
| `Grupos` | grupos do produto: obrigatórios primeiro; radio (`max==1`) ou contador; pílula `n/max` que fica verde ao completar; opção indisponível desabilitada; foto da opção quando existir |

Todos recebem `variante`/tokens do template; nenhuma regra fica no template.

## 7. Regras de UI (todos os templates)

- 375 px é o alvo principal; o cardápio centraliza em `max-w-[640px]` no desktop.
- Alvos de toque ≥ 44 px. Inputs com fonte 16 px (evita zoom no iOS).
- `aria-pressed` em opções e segmentos, `aria-expanded` em recolhíveis, foco visível, `prefers-reduced-motion` desliga carrossel automático, bump e animações.
- Imagens com `loading="lazy"` e `sizes` corretos; fotos recortadas (PNG/WebP com transparência) usam `object-fit: contain` sobre `--m-art`.
- Produto esgotado: sem toque, com selo "Esgotado". Categoria pausada: como hoje.
- Textos em pt-BR, sentence case, voz ativa (regra do `CLAUDE.md`).
- `localStorage` só para conveniências que já existem (tema do cliente, prefill). Nada novo de negócio.

## 8. Testes

O `frontend/` não tem runner de testes hoje. Para não adicionar dependência sem aprovação:
- `etapas.ts` é puro: o PR inclui um script `frontend/scripts/check-etapas.mjs` (Node puro, `assert`) com os casos da seção 5.3, chamado por `npm run check:etapas`. Se aprovarem um runner (vitest), migrar depois.
- Checklist manual de cada template com screenshots 375 px claro/escuro no PR.

## 9. Fase B — depois dos templates (cada item é um PR, com aprovação)

1. **Vira trio cadastrado.** Campo no produto `comboSugerido { produtoComboId | grupoId, precoExtra }` + UI no admin. Hoje o "Vira trio?" do protótipo usa preço fixo de exemplo.
2. **Peça também por histórico.** Ordenar `cardapioPecaTambem` por co-ocorrência nos pedidos dos últimos 60 dias (consulta set-based, por tenant).
3. **Recuperação de carrinho.** Com WhatsApp informado e pedido não concluído em 20 min, disparo via modelos de WhatsApp existentes (opt-in, LGPD).
4. **Funil por etapa no painel** com os beacons novos (5.4).
5. **Selos padronizados** (`mais_pedido`, `novo`, `promo`, `veg`) já existem em `SELO`; permitir escolher a cor do selo por template.
6. **Capa da loja.** Campo `temaConfig.capaRef` (upload de mídia que já existe) para Balcão e Oferta; até lá, eles usam o 1º banner.
