# 04 · Template **Regem Fluxo** (`menuTheme: 'fluxo'`)

> Pré-requisito: Fase 0 do `00-base-cardapio.md`. Referência visual: protótipo, opção **Regem Fluxo**. Teste no painel do protótipo as combinações de **Situação da loja** (aberta, só retirada, fechada) e **Recursos e cliente** (cupons, cashback, fidelidade, cliente que já comprou).

## 1. Conceito

O template próprio do Regem e o **padrão recomendado** para lojas novas. Clean e minimalista, com recursos organizados para converter: **uma decisão por tela** e um botão principal que sempre diz o que falta para seguir.

Pega o melhor dos outros três:

| Vem de | O que entra no Fluxo |
|---|---|
| Galeria (Brendi) | "Peça de novo" para quem já comprou, peça também no checkout, Pix em destaque |
| Balcão (Cardápio Web) | lista fácil de escanear, abas fixas com scroll-spy, busca |
| Oferta (Anota AI) | meta de frete grátis visível o tempo todo, oferta de trio para o lanche avulso |
| Próprio | "Entregar em" no topo; pedido expresso para quem já comprou; botão que diz o que falta; obrigatórios numerados e adicionais recolhidos; + direto no que não tem escolha; "Vira trio?" dentro da sacola; benefícios (cupom, cashback, fidelidade) num bloco só; previsão de horário |

- **Indicado para:** padrão do Regem, qualquer loja.
- **Etapas:**
  - cliente novo: **Sacola → Entrega e contato → Pagamento** (`dadosNaEntrega: true`);
  - cliente que já comprou: **Sacola → Revisar e pedir** (pedido expresso, §5.1).

## 2. Tokens (claro)

```css
.lp-menu[data-menu-theme='fluxo']{
  --m-bg:#FFFFFF; --m-surf:#F5F7F9; --m-card:#FFFFFF; --m-ink:#0F2230; --m-mut:#5B6B7A;
  --m-line:#E6EAEF; --m-art:#F3F5F7; --m-r:16px; --m-rs:12px; --m-rbtn:12px;
  --m-font:'Figtree'; --m-disp:'Archivo'; --m-num:'JetBrains Mono';
  --m-pts-bg:#FBF1DF; --m-pts-ink:#7A4E0E;   /* dourado Regem só para fidelidade */
  --m-cb-bg:#E7F5EF;  --m-cb-ink:#0E7C66;    /* verde ok só para cashback */
}
```
Escuro: `--m-bg:#0B1620; --m-surf:#12212E; --m-card:#0F1C27; --m-ink:#E8EEF3; --m-mut:#93A4B3; --m-line:#22384A; --m-art:#16283A; --m-pts-bg:#2A2416; --m-pts-ink:#F0C77A; --m-cb-bg:#10291F; --m-cb-ink:#3FB79A`.

Regras de cor: a **cor da loja aparece só na ação principal** (botões, seleção, barra de frete, cupom sugerido). Abas ativas e numeração usam a tinta navy. Dourado = fidelidade; verde = cashback e "ok". Preços e números em JetBrains Mono. Separadores são hairlines de 1 px, sem caixas em volta das linhas.

## 3. Vitrine

1. **Topo:** nome da loja em Archivo 800, 23 px; linha de status com bolinha (verde aberta, laranja só retirada, vermelha fechada) + texto da base §5.5 + "~N min · mínimo R$ X"; busca redonda com contorno.
2. **Aviso da loja** (`AvisoLoja`, base §5.5) logo abaixo do topo quando a loja está só retirada ou fechada.
3. **Faixa de chips** (rolagem horizontal, nesta ordem):
   - **"Entregar em: escolha o bairro ▾"** (pílula com contorno navy). Abre uma folha "Onde você está?" com cada bairro e a taxa ("Entrega R$ 5,00 · grátis acima de R$ 80,00") e a opção "Vou retirar na loja". Escolher grava `chk.bairroId`/`chk.tipo` e a taxa passa a aparecer na barra da sacola desde o primeiro item. No modo raio, a folha oferece "Usar minha localização" e endereço. Rodapé da folha: "Não achou seu bairro? A loja ainda não entrega aí, mas você pode retirar." Com a loja só em retirada, o chip vira texto fixo "Retirada na loja".
   - Frete: "Entrega R$ X · grátis acima de R$ Y" (só com entrega).
   - **Cupom** (só se houver cupom ativo): código e benefício do 1º cupom disponível, na cor suave da loja.
   - **Cashback** (só se ativo): "X% de volta" ou o saldo do cliente.
   - **Fidelidade** (só se ativa): "saldo/meta pts" ou "meta pts = {prêmio}".
4. **Peça de novo** (com `ultimoPedido`): cartão com contorno, foto 52, "PEÇA DE NOVO", nome e complementos, botão escuro "Adicionar" → `reordenarUltimo()`, sem modal.
5. **Mais pedidos:** carrossel compacto de cards 152 px (foto 116, nome, preço).
6. **Abas de texto** fixas, ativa em navy com sublinhado de 2 px, scroll-spy.
7. **Seções:** título Archivo 17 + contagem em mono. Linhas sem card: foto 76 à esquerda, selo, nome 15/600, descrição em 2 linhas, preço mono, hairline depois da foto.
8. **Ação da linha:** **+** com contorno para produto sem escolha obrigatória (entra direto, toast + bump); **"Montar ›"** para produto com escolha obrigatória.
9. **Barra da sacola:** total mono à esquerda e uma linha de contexto: "N itens · entrega R$ 5,00 · faltam R$ X p/ grátis" (bairro escolhido), "faltam R$ X p/ frete grátis" (sem bairro), "frete grátis garantido" ou "retirada na loja · grátis". Barra fina de 3 px com o progresso do frete grátis (some na retirada). Botão "Ver sacola ›".

## 4. Produto (folha de baixo, 92% da altura)

- Cabeçalho compacto: foto 88, nome Archivo 20, descrição, preço mono, fechar.
- **Obrigatórios primeiro e numerados**; regra na cor da loja enquanto incompleto; pílula `n/max` verde com ✓ ao completar.
- **Opcionais recolhidos** ("Adicionais · Opcional · até 10 · Ver opções ▾").
- "＋ Adicionar observação" abre o campo só quando tocado.
- **Rodapé:** incompleto = botão neutro "Escolha a batata ▾" (rola até o grupo e destaca); completo = "Adicionar · R$ total".

## 5. Checkout

- **Cabeçalho:** voltar, "N DE M" (mono 11) sobre o título, fechar (volta à vitrine). Barra de progresso de 3 px em navy.
- **Rodapé (regra principal):** falta algo → botão neutro com o motivo de `falta()` ("Escolha o bairro ▾", "Agende o horário do pedido ▾", "Escolha como vai pagar ▾"), que rola até o campo e foca. Nada falta → botão na cor da loja com o valor: "Continuar", "Ir para pagamento", "Fazer pedido" ou **"Agendar pedido"** (loja fechada ou horário agendado).
- **Sacola:** itens; **"Vira trio?" dentro da sacola** (§5.2); "Adicionar mais itens"; barra de frete grátis; "Combina com seu pedido" em linhas; subtotal e a nota "Entrega e pagamento nas próximas etapas". Sem cupom aqui.
- **Entrega e contato (cliente novo):** tipo (com indisponível bloqueado e o horário de volta, base §5.5); endereço (bairro já vem do chip do topo, se escolhido) → rua → complemento + número; quando (agora / agendar, com `min` na próxima abertura quando fechada); nome e WhatsApp.
- **Pagamento:** formas em dois grupos, Pix com "Mais rápido"; troco; nota; **"Seus benefícios"** (base §5.6) com o cupom sugerido em cartão + "Tenho outro código", "Usar meu cashback", progresso do plano de fidelidade e cashback a ganhar; resumo com "Cashback usado" quando houver.

### 5.1 Pedido expresso (cliente que já comprou)

Quando o cliente é reconhecido e tem endereço e forma de pagamento do último pedido, o checkout tem **2 etapas: Sacola → Revisar e pedir**. A tela de revisão traz:

1. "Usamos os dados do seu último pedido. Confira e peça."
2. Cartões com **Trocar**: endereço (com bairro e taxa), quando (com campo de agendamento direto se a loja estiver fechada), forma de pagamento ("Pix · último usado"), nome e WhatsApp.
3. "Seus benefícios" (igual ao pagamento).
4. Resumo e o botão final.

"Trocar" sai do expresso e abre o fluxo normal na etapa do item (endereço → Entrega e contato com o formulário aberto; pagamento → Pagamento). Se a loja estiver só em retirada, a revisão já vem com "Retirar na loja" e uma nota com o horário de volta da entrega.

### 5.2 "Vira trio?" na sacola

Para cada linha de lanche (categoria com combo vinculado) que ainda não é trio, aparece logo abaixo da linha um bloco cinza: "Vira trio por + R$ X?", o que vem junto, chips das bebidas e o botão "Quero o trio" (habilita ao escolher a bebida) e um × para dispensar. Aceitar troca a linha (separa uma unidade se a quantidade for maior que 1). Dispensado, não volta naquela sessão. Sem combo vinculado no cadastro, não aparece (Fase B no 00).

## 6. Confirmação

Base §5.7, com Archivo no título e horário em mono 24. Pedido agendado: "Agendado para HH:MM" e linha do tempo começando em "Pedido agendado". Pix pendente: "Falta só o Pix". Fidelidade: "N pontos a caminho" (dourado), só se ativa. Cashback: "R$ X de cashback a caminho" (verde), só se ativo.

## 7. Checklist de aceite

- [ ] Status e aviso do topo corretos nas 3 situações (aberta, só retirada, fechada) e com `loja.aberto=false`.
- [ ] Chip "Entregar em" abre a folha de bairros (ou localização no modo raio) e a taxa aparece na barra da sacola.
- [ ] Chips de cupom, cashback e fidelidade só aparecem quando o recurso está ativo.
- [ ] + direto em produto simples; "Montar ›" no que tem obrigatório; "Peça de novo" sem modal.
- [ ] Produto: obrigatórios numerados primeiro, adicionais recolhidos, botão "Escolha {grupo}" que rola até ele.
- [ ] "Vira trio?" dentro da sacola, só com combo vinculado, dispensável.
- [ ] Cliente novo em 3 etapas; cliente reconhecido em 2 (Sacola → Revisar e pedir); "Trocar" volta ao fluxo normal.
- [ ] Loja só retirada: Entrega desabilitada com o horário; tipo começa em retirada; frete grátis some.
- [ ] Loja fechada: "O quanto antes" desabilitado, agendamento com `min` na abertura, botão "Agendar pedido".
- [ ] "Seus benefícios": cupom sugerido (sem cupom de 1ª compra para cliente reconhecido), usar cashback, progresso do plano, cashback a ganhar; resumo com "Cashback usado".
- [ ] Sem cupom ativo, nenhum campo de cupom; sem fidelidade, nenhum ponto em lugar nenhum.
- [ ] Confirmação: agendado, Pix pendente, pontos e cashback a caminho conforme os recursos.
- [ ] Modo escuro; 375 px sem rolagem horizontal; temas antigos intactos.
