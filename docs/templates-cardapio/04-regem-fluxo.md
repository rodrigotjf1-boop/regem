# 04 · Template **Regem Fluxo** (`menuTheme: 'fluxo'`)

> Pré-requisito: Fase 0 do `00-base-cardapio.md`. Referência visual: protótipo, opção **Regem Fluxo** (ligue também "Cliente que já comprou").

## 1. Conceito

O template próprio do Regem e o **padrão recomendado** para lojas novas. Clean e minimalista, com recursos organizados para converter: **uma decisão por tela** e um botão principal que sempre diz o que falta para seguir.

Pega o melhor dos outros três:

| Vem de | O que entra no Fluxo |
|---|---|
| Galeria (Brendi) | "Peça de novo" para quem já comprou, peça também no checkout, Pix em destaque |
| Balcão (Cardápio Web) | lista fácil de escanear, abas fixas com scroll-spy, busca |
| Oferta (Anota AI) | meta de frete grátis visível o tempo todo, oferta de trio logo depois do lanche avulso |
| Próprio | botão que diz o que falta e leva até o campo; obrigatórios numerados e adicionais recolhidos; + direto no que não tem escolha; etapa de dados pulada para cliente conhecido; cupom recolhido; frete só com bairro; pontos "a caminho"; previsão de horário |

- **Indicado para:** padrão do Regem, qualquer loja.
- **Etapas:** Sacola → Entrega → Seus dados → Pagamento ("Seus dados" some para cliente reconhecido).

## 2. Tokens (claro)

```css
.lp-menu[data-menu-theme='fluxo']{
  --m-bg:#FFFFFF; --m-surf:#F5F7F9; --m-card:#FFFFFF; --m-ink:#0F2230; --m-mut:#5B6B7A;
  --m-line:#E6EAEF; --m-art:#F3F5F7; --m-r:16px; --m-rs:12px; --m-rbtn:12px;
  --m-font:'Figtree'; --m-disp:'Archivo'; --m-num:'JetBrains Mono';
  --m-pts-bg:#FBF1DF; --m-pts-ink:#7A4E0E;   /* dourado Regem só para fidelidade */
}
```
Escuro: `--m-bg:#0B1620; --m-surf:#12212E; --m-card:#0F1C27; --m-ink:#E8EEF3; --m-mut:#93A4B3; --m-line:#22384A; --m-art:#16283A; --m-pts-bg:#2A2416; --m-pts-ink:#F0C77A`.

Regras de cor: a **cor da loja aparece só na ação principal** (botões, seleção, barra de frete). Abas ativas e numeração usam a tinta navy. Preços e números em JetBrains Mono (identidade Regem). Separadores são hairlines de 1 px, sem caixas em volta das linhas.

## 3. Vitrine

1. **Topo:** nome da loja em Archivo 800, 23 px; linha "● Aberto até HH:MM · entrega ~N min · mínimo R$ X"; botão de busca redondo com contorno.
2. **Linha de chips:** "Frete grátis acima de R$ X" e, em dourado, "1 ponto por real" (ou o saldo, para cliente conhecido).
3. **Peça de novo** (com `ultimoPedido`): cartão com contorno, foto 52, "PEÇA DE NOVO", nome e complementos do último pedido e botão escuro "Adicionar" → `reordenarUltimo()` (entra direto na sacola, sem modal).
4. **Mais pedidos:** carrossel compacto de cards 152 px (foto 116, nome, preço). Toque abre o produto.
5. **Abas de texto** fixas: 14 px 600, ativa em navy com sublinhado de 2 px. Sem a aba "Mais pedidos" (já está acima). Scroll-spy.
6. **Seções:** título Archivo 17 com a contagem de itens em mono ao lado. Linhas sem card: foto 76 (raio 14) à esquerda, selo pequeno ("Mais pedido" na cor da loja, outros em cinza), nome 15/600, descrição em 2 linhas, preço mono. Separador hairline começando depois da foto.
7. **Ação à direita da linha:**
   - produto **sem** escolha obrigatória: botão redondo **+** com contorno → entra direto (toast "X está na sacola" + bump na barra);
   - produto **com** escolha obrigatória: pílula **"Montar ›"** → abre o produto.
8. **Barra da sacola:** branca, hairline no topo, barra fina de 3 px (cor da loja) com o progresso até o frete grátis; à esquerda total em mono e "N itens · faltam R$ X p/ frete grátis"; à direita botão "Ver sacola ›".

## 4. Produto (folha de baixo, 92% da altura)

- Cabeçalho compacto: foto 88 à esquerda, nome Archivo 20, descrição, preço mono; fechar redondo à direita.
- **Obrigatórios primeiro e numerados** (círculo navy com 1, 2…). Regra "Obrigatório · escolha 1" fica na cor da loja enquanto incompleto; a pílula `n/max` fica verde com ✓ ao completar.
- **Opcionais recolhidos:** cabeçalho "Adicionais · Opcional · até 10" com "Ver opções ▾". Abre/fecha sem perder o que já foi marcado.
- "＋ Adicionar observação" abre o campo só quando tocado.
- **Rodapé:** quantidade + botão.
  - incompleto: botão neutro (fundo `--m-surf`, contorno) com **"Escolha a batata ▾"** (rótulo do primeiro grupo que falta); tocar rola até o grupo, destaca por 1 s e não adiciona;
  - completo: botão na cor da loja "Adicionar · R$ total".

### 4.1 "Vira trio?" depois do lanche avulso

Quando um lanche de categoria com combo vinculado entra na sacola **sem** ser trio, abre um cartão de baixo (não bloqueante): "Vira trio por + R$ X?", texto do que vem junto, chips das bebidas, **Agora não** e **Quero o trio** (habilita ao escolher a bebida). Aceitar troca aquela linha da sacola (se a linha tinha quantidade > 1, separa uma unidade). Aparece no máximo uma vez por produto por sessão. Sem combo vinculado no cadastro, não aparece (ver Fase B no 00).

## 5. Checkout

- **Cabeçalho:** voltar, no centro "2 DE 4" (mono 11) sobre o título da etapa (Archivo 17), fechar à direita (volta à vitrine). Embaixo, barra de progresso de 3 px em navy.
- **Rodapé — a regra principal do template:**
  - falta algo: botão neutro com o **motivo** ("Escolha o bairro ▾", "Informe seu WhatsApp ▾", "Escolha como vai pagar ▾"). Tocar rola até o campo, destaca e foca o input;
  - nada falta: botão na cor da loja "Continuar · R$" / "Fazer pedido · R$".
- **Sacola:** itens, "Adicionar mais itens", barra de frete grátis, "Combina com seu pedido" em linhas (foto 48, nome, "+ R$", +), subtotal e a nota "Entrega e pagamento nas próximas etapas". **Sem cupom aqui.**
- **Entrega:** tipo; para cliente conhecido, endereço salvo em cartão com **Trocar** (e a taxa do bairro escrita embaixo); para novo, bairro (com a taxa na opção) → rua → complemento + número; quando.
- **Seus dados:** "Quem vai receber?", nome e WhatsApp. **Pulada** para cliente reconhecido.
- **Pagamento:** cliente reconhecido vê "Pedido de {nome} · {telefone} · Trocar" no topo. Formas em dois grupos ("Pague agora", "Pague na entrega"), Pix com "Mais rápido"; troco; nota; resgates; **"Tenho um cupom"** recolhido (abre o `CupomBox`); resumo; "Você ganha N pontos neste pedido" em dourado.

## 6. Confirmação

Igual à base (5.5), com Archivo no título, horário previsto em mono 24 e pontos em dourado.

## 7. Checklist de aceite

- [ ] Vitrine com topo enxuto, chips, "Mais pedidos" compacto, abas de texto com scroll-spy.
- [ ] + direto em produto simples; "Montar ›" em produto com obrigatório.
- [ ] "Peça de novo" sem modal, só com `ultimoPedido`.
- [ ] Barra da sacola com progresso de frete grátis.
- [ ] Produto: obrigatórios numerados primeiro, adicionais recolhidos, observação sob demanda.
- [ ] Botão do produto mostra "Escolha {grupo}" e rola até ele; só adiciona completo.
- [ ] "Vira trio?" só com combo vinculado, uma vez por produto por sessão.
- [ ] Checkout em 4 etapas; "Seus dados" pulada para cliente reconhecido e reinserida pelo Trocar.
- [ ] Rodapé do checkout com o motivo e foco no campo; valor no botão quando completo.
- [ ] Cupom recolhido no pagamento; frete "a calcular" sem bairro.
- [ ] Confirmação com Pix pendente, previsão, linha do tempo e pontos a caminho.
- [ ] Modo escuro; 375 px sem rolagem horizontal; temas antigos intactos.
