# 01 · Template **Galeria** (`menuTheme: 'galeria'`)

> Pré-requisito: Fase 0 do `00-base-cardapio.md`. Referência visual: protótipo, opção **Galeria**.

## 1. Conceito

Cardápio que vende pela foto. Abre com banners grandes, categorias em círculos com foto e um carrossel dos mais pedidos; o resto do cardápio vem em grade de 2 colunas. O produto abre em tela cheia, foto primeiro.

- **Padrão de mercado de referência:** Brendi (vitrine visual, upsell, Pix integrado, recompra).
- **Indicado para:** loja com boas fotos e que recebe tráfego pago.
- **Etapas:** Sacola → Entrega e contato → Pagamento (`dadosNaEntrega: true`).

## 2. Tokens (claro)

```css
.lp-menu[data-menu-theme='galeria']{
  --m-bg:#FFFFFF; --m-surf:#F3F4F6; --m-card:#FFFFFF; --m-ink:#111318; --m-mut:#6B7280;
  --m-line:#E7E8EC; --m-art:#F1F2F4; --m-r:22px; --m-rs:14px; --m-rbtn:999px;
  --m-font:'DM Sans'; --m-disp:'Bricolage Grotesque'; --m-num:'DM Sans';
}
```
Escuro: `--m-bg:#0F1115; --m-surf:#1A1D23; --m-card:#15181D; --m-ink:#F3F4F6; --m-mut:#9CA3AF; --m-line:#262A31; --m-art:#1F232A`.

Botões sempre em pílula. A cor da loja aparece no botão + dos cards, no botão principal e nas seleções.

## 3. Vitrine

1. **Topo:** logo redondo 46 px (`logoRef`, senão `logoEmoji`, senão sigla), nome (display 800, 17 px), linha "● Aberta até HH:MM · N min" e botão de busca redondo (abre a busca em tela cheia que já existe).
2. **Banners** (`menu.banners`, `mostrarBanner`): carrossel com snap, altura 200, raio 22, slide em `calc(100% - 20px)` para o próximo aparecer na borda. Legenda sobre degradê: kicker 11 px caixa alta, título display 24, linha de preço. Troca a cada `bannerIntervalo` s (sem `prefers-reduced-motion`). Pontos embaixo: o ativo vira traço de 18 px. Toque abre o produto/categoria do banner (deep-link que já existe).
3. **Fidelidade** (se `fidelidadeAtiva`): faixa cinza "Fidelidade: cada R$ 1 vira 1 ponto" + saldo à direita quando o cliente é conhecido.
4. **Peça de novo** (se `ultimoPedido`): cartão escuro (`--m-ink`) com foto, "PEÇA DE NOVO", resumo do pedido e botão branco com o valor → `reordenarUltimo()`.
5. **Categorias:** círculos 66 px com a foto da categoria (`imagemRef`, senão a foto do 1º produto) e nome curto. Toque rola até a seção.
6. **Seção "Mais pedidos"** (destaques): carrossel de cards 232 px (foto 168 px de altura, selo branco no canto, botão + 38 px no canto inferior direito, nome, descrição em 2 linhas, preço).
7. **Demais categorias:** grade 2 colunas, foto quadrada raio 20, selo (ou "-X%" quando há `precoDe`), botão +, nome (2 linhas) e preço com "de" riscado.
8. **Botão +:** produto sem escolha obrigatória entra direto (toast + bump na barra). Com escolha obrigatória, abre o produto.
9. **Barra da sacola:** pílula flutuante escura (16 px das bordas): bolinha na cor da loja com a quantidade, "Ver sacola", total em pílula branca.

## 4. Produto (tela cheia)

- Foto com 300 px de altura; botão voltar branco redondo no canto superior esquerdo.
- Nome display 26, descrição, preço 18.
- Grupos (componente `Grupos`, obrigatórios primeiro): cabeçalho transparente; cada opção é um bloco cinza arredondado (raio 16) que fica na cor suave da loja quando escolhido; foto da opção à esquerda quando existir.
- Observação (textarea) no fim.
- Rodapé: quantidade em pílula + botão "Adicionar · R$ total", desabilitado até completar os obrigatórios.

## 5. Checkout

- **Cabeçalho:** voltar à esquerda, título centralizado em display 18 ("Sua sacola", "Entrega e contato", "Pagamento") e, abaixo, 3 barrinhas de 4 px (preenchidas até a etapa atual).
- **Sacola:** itens; "Peça também" em **cards** com foto e +; subtotal.
- **Entrega e contato:** tipo, endereço, quando, e no fim nome + WhatsApp.
- **Pagamento:** formas com selo **"Mais rápido"** no Pix; nota; resgates; cupom aberto; resumo; pontos previstos.
- **Rodapé:** quando falta algo, linha cinza com o motivo acima do botão desabilitado. Botão "Continuar · R$" / "Ir para pagamento · R$" / "Fazer pedido · R$".

## 6. Checklist de aceite

- [ ] Banners com snap, pontos e troca automática (desligada com movimento reduzido).
- [ ] Categorias em círculos rolam até a seção certa.
- [ ] Carrossel "Mais pedidos" + grade 2 colunas; esgotado sem toque.
- [ ] + adiciona direto produto simples e abre o produto quando há obrigatório.
- [ ] "Peça de novo" aparece só com `ultimoPedido` e recompõe o carrinho.
- [ ] Produto em tela cheia com obrigatórios primeiro; Adicionar desabilitado até completar.
- [ ] Checkout em 3 etapas com as 3 barrinhas; frete "a calcular" sem bairro.
- [ ] Pix com selo "Mais rápido"; confirmação "Falta só o Pix" quando pendente.
- [ ] Situação da loja conforme a base §5.5 (aviso no topo; só retirada bloqueia a entrega com o horário; fechada só agenda e o botão final vira "Agendar pedido").
- [ ] Benefícios conforme a base §5.6: cupom, cashback e fidelidade só aparecem quando ativos, no bloco "Seus benefícios" do pagamento.
- [ ] Modo escuro com os tokens escuros; 375 px sem rolagem horizontal.
- [ ] Recursos comuns do `05-recursos-integrados.md` §4: conta do cliente, promoções pelo WhatsApp, origem do anúncio, sinal da encomenda, pós-pedido completo, erro visível, mesa e ramos.
- [ ] `classic`, `fastfood`, `grid` intactos.
