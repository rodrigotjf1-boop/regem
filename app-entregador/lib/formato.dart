/// Dinheiro como no Brasil: "R$ 40,50" (revisão de 17/11/2026 — a tela do pedido mostrava "R$ 40.50", com ponto, e a
/// tela inicial "R$ 40,50"). `v` em reais.
String reais(num v) => 'R\$ ${v.toStringAsFixed(2).replaceAll('.', ',')}';
