# 02 · Template **Balcão** (`menuTheme: 'balcao'`)

> Pré-requisito: Fase 0 do `00-base-cardapio.md`. Referência visual: protótipo, opção **Balcão**.

## 1. Conceito

Lista objetiva, no padrão dos apps de delivery: capa e logo da loja com os dados principais, busca sempre visível, abas fixas que acompanham a rolagem e linhas com foto à direita. Prioriza escanear rápido um cardápio grande.

- **Padrão de mercado de referência:** Cardápio Web.
- **Indicado para:** cardápio grande e cliente que já sabe o que quer.
- **Etapas:** Sacola → Entrega → Dados → Pagamento, com "Etapa N de 4" no cabeçalho.

## 2. Tokens (claro)

```css
.lp-menu[data-menu-theme='balcao']{
  --m-bg:#F2F3F5; --m-surf:#EDEFF2; --m-card:#FFFFFF; --m-ink:#1F2328; --m-mut:#667085;
  --m-line:#E4E7EC; --m-art:#EEF0F3; --m-r:10px; --m-rs:8px; --m-rbtn:8px;
  --m-font:'Rubik'; --m-disp:'Rubik'; --m-num:'Rubik';
}
```
Escuro: `--m-bg:#0E1013; --m-surf:#16191D; --m-card:#1B1F24; --m-ink:#ECEEF1; --m-mut:#9AA3AE; --m-line:#2A2F36; --m-art:#22272D`.

## 3. Vitrine

1. **Capa** 136 px: hoje não existe campo de capa, então usar a imagem do 1º banner ativo; sem banner, faixa na cor da loja. Um campo próprio de capa entra na Fase B (item 6 do 00).
2. **Cabeçalho branco:** logo quadrado 76 px (raio 14, borda branca 3 px) subindo 38 px sobre a capa; "Ver informações" à direita abre o componente comum `InfoLoja` (endereço, horários, formas de pagamento e contatos; o painel não existe hoje — ver `05-recursos-integrados.md` §2.6). O botão redondo da conta fica sobre a capa, no canto superior esquerdo. Nome 20 px 600, status verde "● Aberto agora · fecha às HH:MM" e linha de dados com ícones: tempo, mínimo, frete grátis acima de.
3. **Busca** fixa abaixo do cabeçalho: campo cinza com lupa. Ao digitar, a lista vira "N resultados" (filtra nome e descrição); vazio volta às seções.
4. **Abas** (`position: sticky`): texto 14 px, ativa na cor da loja com sublinhado de 2,5 px. Scroll-spy: a aba acompanha a seção visível e a faixa de abas rola para mantê-la à vista.
5. **Seções:** título 16 px 600 e lista em fundo branco. Linha: selo pequeno na cor da loja, nome 15 px 500, descrição em 2 linhas, preço (com "de" riscado e etiqueta verde "-X%"), foto 92 px à direita (raio 8).
6. **Toque na linha** abre o produto (sempre, mesmo produto simples).
7. **Barra da sacola:** faixa branca fixa com botão na cor da loja de ponta a ponta: "N itens" em etiqueta, "Ver sacola", total.

## 4. Produto (página)

- Barra superior branca: voltar + "Detalhes do item".
- Foto 220 px, bloco branco com nome 20 px, descrição e preço.
- Grupos em **faixas cinza** (nome, regra "Obrigatório · escolha 1" e pílula `n/max`), opções em fundo branco com foto quando houver. Obrigatórios primeiro.
- Observação em bloco branco. Rodapé com quantidade + "Adicionar · R$".

## 5. Checkout

- **Cabeçalho branco** com voltar, título da etapa e "Etapa N de 4" embaixo, em cinza.
- Seções em blocos brancos separados por 8 px de fundo.
- **Sacola:** itens; "Aproveite e leve" em **linhas** (foto 48, nome, "+ R$", botão +); **cupom com sugestões**; subtotal.
- **Entrega:** tipo, endereço, quando.
- **Dados:** nome e WhatsApp, com "Na próxima vez a gente já preenche".
- **Pagamento:** formas, nota, resgates, resumo e pontos.
- **Rodapé:** motivo em cinza acima do botão desabilitado; botão "Continuar", "Ir para dados", "Ir para pagamento", "Fazer pedido", sempre com o valor.

## 6. Checklist de aceite

- [ ] Capa + logo sobreposto + dados da loja; "Ver informações" abre `InfoLoja`; botão da conta sobre a capa.
- [ ] Busca filtra em tempo real e volta às seções ao limpar.
- [ ] Abas fixas com scroll-spy e rolagem horizontal até a aba ativa.
- [ ] Linhas com foto à direita, "-X%" quando há `precoDe`, esgotado sem toque.
- [ ] Produto em página com faixas por grupo, obrigatórios primeiro.
- [ ] Checkout em 4 etapas com "Etapa N de 4"; cupom na sacola.
- [ ] Frete "a calcular" sem bairro; pontos "a caminho" na confirmação.
- [ ] Situação da loja conforme a base §5.5 (aviso no topo; só retirada bloqueia a entrega com o horário; fechada só agenda e o botão final vira "Agendar pedido").
- [ ] Benefícios conforme a base §5.6: cupom, cashback e fidelidade só aparecem quando ativos, no bloco "Seus benefícios" do pagamento.
- [ ] Recursos comuns do `05-recursos-integrados.md` §4: conta do cliente, promoções pelo WhatsApp, origem do anúncio, sinal da encomenda, pós-pedido completo, erro visível, mesa e ramos.
- [ ] Modo escuro; 375 px sem rolagem horizontal; temas antigos intactos.
