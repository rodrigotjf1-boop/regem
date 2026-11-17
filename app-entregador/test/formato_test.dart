import 'package:flutter_test/flutter_test.dart';
import 'package:regem_entregador/formato.dart';

// O dinheiro na tela do pedido (revisão de 17/11/2026): "R$ 40,50", como no resto do app — antes saía "R$ 40.50".
void main() {
  test('reais com vírgula e duas casas', () {
    expect(reais(40.5), r'R$ 40,50');
    expect(reais(0), r'R$ 0,00');
    expect(reais(9), r'R$ 9,00');
    expect(reais(132.9), r'R$ 132,90');
  });
}
