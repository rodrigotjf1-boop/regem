# 03 · Template **Oferta** (`menuTheme: 'oferta'`)

> Pré-requisito: Fase 0 do `00-base-cardapio.md`. Referência visual: protótipo, opção **Oferta**.

## 1. Conceito

Cardápio de quem vende pela oferta do dia. Promoções, combos e a meta de frete grátis aparecem antes do cardápio comum, e o lanche avulso oferece "Transforme em trio" dentro da própria tela do produto.

- **Padrão de mercado de referência:** Anota AI.
- **Indicado para:** loja de promoções e combos.
- **Etapas:** Sacola → Entrega e contato → Pagamento (`dadosNaEntrega: true`), com passos numerados.

## 2. Tokens (claro)

```css
.lp-menu[data-menu-theme='oferta']{
  --m-bg:#FFFFFF; --m-surf:#F5F5F5; --m-card:#FFFFFF; --m-ink:#1A1A1A; --m-mut:#707070;
  --m-line:#ECECEC; --m-art:#F4F4F4; --m-r:16px; --m-rs:12px; --m-rbtn:12px;
  --m-font:'Lexend'; --m-disp:'Lexend'; --m-num:'Lexend';
  --m-hot:#FFC531; --m-hot-ink:#3A2B00; --m-hot-soft:#FFF6DB;  /* amarelo de promoção, fixo */
}
```
Escuro: `--m-bg:#111111; --m-surf:#1C1C1C; --m-card:#181818; --m-ink:#F2F2F2; --m-mut:#A0A0A0; --m-line:#2A2A2A; --m-art:#222222; --m-hot-soft:#2B2410; --m-hot-ink:#FFD866`.

O amarelo é só para promoção (selo de %, faixa de frete grátis, pílula do título). A cor da loja fica na faixa do topo, nos preços promocionais, nas pílulas ativas e nos botões.

## 3. Vitrine

1. **Faixa do topo** 150 px na cor da loja com a imagem do 1º banner por cima em `mix-blend-mode: multiply` (55%); sem banner, só a cor.
2. **Logo redondo 88 px** centralizado subindo 44 px, borda branca 4 px. Nome 19 px 700 centralizado. Chips: "● Aberto até HH:MM" (verde), tempo, mínimo.
3. **Frete grátis** (se `freteGratisAcima`): cartão amarelo-claro "Frete grátis acima de R$ X · faltam R$ Y" com barra de progresso amarela. Ao atingir: "Você ganhou frete grátis!".
4. **Promoções de hoje** (`produtosPromo`, produtos com `precoDe`): título + pílula amarela com o maior desconto; subtítulo com a validade real da promoção (só se o cadastro tiver data; senão omitir). Carrossel de cards 170 px: foto 120 px com selo "-X%" amarelo, nome, de/por (por na cor da loja).
5. **Pílulas de categoria** fixas (`sticky`): fundo cinza; ativa preenchida na cor da loja. Scroll-spy como nos outros.
6. **Seções:** cards brancos com borda de 1 px e raio 16: etiqueta (COMBO para categoria de combos, TRIO para trios, ou o selo do produto em amarelo), nome, descrição, de/por; foto 100 px à direita com "-X%".
7. **Barra da sacola:** fundo branco com sombra; linha "Faltam R$ X para o frete grátis" e botão na cor da loja com quantidade, "Ver sacola" e total.

## 4. Produto (folha de baixo, 92% da altura)

- Foto 210 px com alça e botão fechar; selo "-X%" quando houver.
- Nome 21 px, descrição, de/por.
- **"Transforme em trio"** (só produtos de categoria lanche): cartão amarelo-claro com interruptor "Batata média + refri lata por + R$ X". Ligado, insere os grupos de batata e bebida como obrigatórios e soma o extra. Fase A: usa um produto-combo vinculado se existir no cadastro; sem vínculo, o cartão não aparece (o valor fixo do protótipo é só exemplo; ver Fase B no 00).
- Grupos com foto nas opções, obrigatórios primeiro. Observação. Rodapé com quantidade e "Adicionar · R$".

## 5. Checkout

- **Cabeçalho:** voltar + título; abaixo, 3 passos em círculo numerado ligados por linha (concluído = verde com ✓, atual = cor da loja, futuro = cinza), com rótulo embaixo: Sacola, Entrega, Pagamento.
- **Sacola:** itens; barra de frete grátis; "Combina com seu pedido" em cards; **cupom com sugestões** (aberto); subtotal.
- **Entrega e contato:** tipo, endereço, quando, nome e WhatsApp.
- **Pagamento:** formas com "Mais rápido" no Pix, nota, resgates, resumo e pontos.
- **Rodapé:** motivo em cinza + botão desabilitado; botão com o valor.

## 6. Checklist de aceite

- [ ] Faixa + logo central + chips; cartão de frete grátis com progresso real.
- [ ] Carrossel de promoções só com produtos que têm `precoDe`; validade só se cadastrada.
- [ ] Pílulas fixas com scroll-spy; etiquetas COMBO/TRIO/selo nos cards.
- [ ] "Transforme em trio" só com combo vinculado; ligar exige a bebida e soma o extra.
- [ ] Passos numerados no checkout; cupom e frete grátis na sacola.
- [ ] Frete "a calcular" sem bairro; confirmação com Pix pendente e pontos a caminho.
- [ ] Situação da loja conforme a base §5.5 (aviso no topo; só retirada bloqueia a entrega com o horário; fechada só agenda e o botão final vira "Agendar pedido").
- [ ] Benefícios conforme a base §5.6: cupom, cashback e fidelidade só aparecem quando ativos, no bloco "Seus benefícios" do pagamento.
- [ ] Recursos comuns do `05-recursos-integrados.md` §4: conta do cliente, promoções pelo WhatsApp, origem do anúncio, sinal da encomenda, pós-pedido completo, erro visível, mesa e ramos.
- [ ] Modo escuro; 375 px sem rolagem horizontal; temas antigos intactos.
