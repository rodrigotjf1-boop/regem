import 'package:flutter_test/flutter_test.dart';
import 'package:regem_atendimento/modelo.dart';

// O app fala igual à tela do computador (`frontend/src/lib/atendimento.ts`): título do caso, tempos, o número do
// WhatsApp e o aviso ao gerente.
void main() {
  test('o título: cliente + plataforma + número (o da plataforma quando há)', () {
    expect(Caso({'cliente': 'Ana P.', 'canal': 'ifood', 'pedidoNaPlataforma': '4521', 'pedidoNumero': '12'}).titulo, 'Ana P. · pedido iFood 4521');
    expect(Caso({'cliente': 'Carlos', 'canal': 'whatsapp', 'pedidoNumero': '1180'}).titulo, 'Carlos · pedido #1180');
    expect(Caso({'pedidoCliente': 'Juliana'}).titulo, 'Juliana');
    expect(Caso({}).titulo, 'Cliente');
  });

  test('os tempos: desde e até o prazo', () {
    final agora = DateTime(2026, 11, 2, 19, 54);
    expect(tempoDesde(agora.subtract(const Duration(seconds: 30)), agora), 'agora');
    expect(tempoDesde(agora.subtract(const Duration(minutes: 4)), agora), '4 min');
    expect(tempoDesde(agora.subtract(const Duration(minutes: 80)), agora), '1 h 20 min');
    expect(tempoAte(agora.add(const Duration(minutes: 6, seconds: 12)), agora), '06:12');
    expect(tempoAte(agora.add(const Duration(hours: 1, minutes: 2, seconds: 3)), agora), '1:02:03');
    expect(tempoAte(agora.subtract(const Duration(seconds: 1)), agora), 'venceu');
  });

  test('o número do WhatsApp: 55 + DDD + número; o mesmo número com ou sem 55 e 9', () {
    expect(numeroDoWhatsapp('(21) 98765-4321'), '5521987654321');
    expect(numeroDoWhatsapp('2187654321'), '552187654321');
    expect(mesmoNumero('5521987654321', '21987654321'), isTrue);
    expect(mesmoNumero('552187654321', '5521987654321'), isTrue); // sem o 9
    expect(mesmoNumero('5521987654321', '5511912345678'), isFalse);
    expect(mesmoNumero('', '5521987654321'), isFalse);
  });

  test('o aviso ao gerente só vale com o caso na fila', () {
    final marca = {'escalado': {'em': '2026-11-02T22:50:00.000Z', 'minutos': 3}};
    expect(Caso({'situacao': 'fila', 'detalhe': marca}).escalado?.minutos, 3);
    expect(Caso({'situacao': 'com_alguem', 'detalhe': marca}).escalado, isNull);
    expect(Caso({'situacao': 'fila', 'detalhe': <String, dynamic>{}}).escalado, isNull);
  });

  test('a linha curta: o resumo do robô, senão a mensagem', () {
    expect(Caso({'detalhe': {'robo': {'motivo': 'atraso', 'quer': 'saber quando chega'}}, 'mensagem': 'x'}).linhaCurta, 'atraso · saber quando chega');
    expect(Caso({'mensagem': '  Veio sem\n o refrigerante '}).linhaCurta, 'Veio sem o refrigerante');
    expect(Caso({}).linhaCurta, isNull);
  });

  test('caso da plataforma: disputa e pedidos da 99 (sem "aguardar" e "resolver" à mão)', () {
    expect(Caso({'tipo': 'disputa'}).daPlataforma, isTrue);
    expect(Caso({'tipo': 'reembolso_99'}).daPlataforma, isTrue);
    expect(Caso({'tipo': 'humano'}).daPlataforma, isFalse);
  });

  test('os textos da 99 e o dinheiro', () {
    expect(traduzir(motivoCancelamento99, 'Preparing'), 'O pedido já está em preparo');
    expect(traduzir(motivoCancelamento99, 'algo novo'), 'algo novo');
    expect(brl(1290), r'R$ 12,90');
  });
}
