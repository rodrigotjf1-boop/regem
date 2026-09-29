import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:regem_entregador/api.dart';
import 'package:regem_entregador/outbox.dart';
import 'package:shared_preferences/shared_preferences.dart';

// Fila offline das entregas: o que o servidor RECUSA nunca pode sumir calado.
void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  Future<void> guardar(String id, {String? codigo, String canal = '99food'}) =>
      Outbox.enfileirar(id, codigo, numero: id.replaceAll(RegExp(r'\D'), ''), canal: canal);

  test('confirmada sai da fila; "já estava entregue" também conta como confirmada', () async {
    await guardar('p1', codigo: '5107');
    await guardar('p2', codigo: '1234');
    final r = await Outbox.flush(
      enviar: (id, cod) async => id == 'p1' ? {'ok': true, 'valid': true} : {'ok': true, 'valid': true, 'jaFeito': true},
    );
    expect(r.confirmadas, 2);
    expect(r.recusadas, isEmpty);
    expect(await Outbox.pendentes(), 0);
  });

  test('200 com valid:false (código errado na 99) volta como RECUSADA com o motivo — não como entregue', () async {
    await guardar('p7', codigo: '0000');
    final r = await Outbox.flush(
      enviar: (id, cod) async => {'ok': false, 'valid': false, 'msg': 'Código não aceito pela 99Food'},
    );
    expect(r.confirmadas, 0);
    expect(r.recusadas, hasLength(1));
    expect(r.recusadas.first['numero'], '7');
    expect(r.recusadas.first['motivo'], 'Código não aceito pela 99Food');
    expect(await Outbox.pendentes(), 0); // reenviar não adianta: sai da fila e o app avisa
  });

  test('4xx é recusa (avisa); 5xx, 408, 429 e falta de rede ficam para tentar de novo', () async {
    for (final id in ['p1', 'p2', 'p3', 'p4', 'p5']) {
      await guardar(id, codigo: '1');
    }
    final r = await Outbox.flush(enviar: (id, cod) async {
      switch (id) {
        case 'p1':
          throw const ApiErro(400, 'O pedido precisa estar em rota para confirmar a entrega com o código.');
        case 'p2':
          throw const ApiErro(502, 'Erro 502');
        case 'p3':
          throw const ApiErro(429, 'Muitas requisições');
        case 'p4':
          throw const SocketException('Failed host lookup');
        default:
          throw const ApiErro(408, 'Tempo esgotado');
      }
    });
    expect(r.recusadas.map((e) => e['pedidoId']), ['p1']);
    expect(r.recusadas.first['motivo'], contains('em rota'));
    expect(await Outbox.pendentesIds(), {'p2', 'p3', 'p4', 'p5'});
  });

  test('o mesmo pedido guardado de novo vale com o último código digitado', () async {
    await guardar('p9', codigo: '1111');
    await guardar('p9', codigo: '2222');
    final enviados = <String?>[];
    await Outbox.flush(enviar: (id, cod) async {
      enviados.add(cod);
      return {'ok': true, 'valid': true};
    });
    expect(enviados, ['2222']);
  });
}
