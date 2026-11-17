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
      enviar: (id, cod, local) async => id == 'p1' ? {'ok': true, 'valid': true} : {'ok': true, 'valid': true, 'jaFeito': true},
    );
    expect(r.confirmadas, 2);
    expect(r.recusadas, isEmpty);
    expect(await Outbox.pendentes(), 0);
  });

  test('200 com valid:false (código errado na 99) volta como RECUSADA com o motivo — não como entregue', () async {
    await guardar('p7', codigo: '0000');
    final r = await Outbox.flush(
      enviar: (id, cod, local) async => {'ok': false, 'valid': false, 'msg': 'Código não aceito pela 99Food'},
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
    final r = await Outbox.flush(enviar: (id, cod, local) async {
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
    await Outbox.flush(enviar: (id, cod, local) async {
      enviados.add(cod);
      return {'ok': true, 'valid': true};
    });
    expect(enviados, ['2222']);
  });

  // Pedido sem código (a loja desligou o código — mig 348): o servidor confere se o "Entregue" foi tocado perto do
  // endereço. A fila guarda a posição DO TOQUE e a reenvia — não a de onde o entregador está quando o sinal volta.
  test('a posição do toque vai junto ao reenviar; pedido sem posição vai sem', () async {
    await Outbox.enfileirar('p5', null, numero: '5', local: {'lat': -22.9, 'lng': -43.2, 'precisao': 12.0});
    await Outbox.enfileirar('p6', null, numero: '6');
    final enviados = <String, Map<String, dynamic>?>{};
    final r = await Outbox.flush(enviar: (id, cod, local) async {
      enviados[id] = local;
      return {'ok': true, 'valid': true};
    });
    expect(r.confirmadas, 2);
    expect(enviados['p5'], {'lat': -22.9, 'lng': -43.2, 'precisao': 12.0});
    expect(enviados['p6'], isNull);
  });

  test('longe do endereço é recusa: sai da fila e o entregador é avisado com a distância', () async {
    await Outbox.enfileirar('p8', null, numero: '8', local: {'lat': -22.911, 'lng': -43.2});
    final r = await Outbox.flush(
      enviar: (id, cod, local) async => throw const ApiErro(400, 'Você está a 1,2 km do endereço do cliente.'),
    );
    expect(r.recusadas.single['motivo'], contains('1,2 km'));
    expect(await Outbox.pendentes(), 0);
  });

  // ── Revisão de 17/11/2026 ──────────────────────────────────────────────────────────────────────────────────────────
  test('a entrega guardada DURANTE o reenvio continua na fila (antes o fim do reenvio a apagava)', () async {
    await guardar('p1', codigo: '1111');
    final r = await Outbox.flush(enviar: (id, cod, local) async {
      // o entregador marca outra entrega sem sinal enquanto a p1 está sendo enviada
      await guardar('p2', codigo: '2222');
      return {'ok': true, 'valid': true};
    });
    expect(r.confirmadas, 1);
    expect(await Outbox.pendentesIds(), {'p2'});
  });

  test('dois reenvios ao mesmo tempo (abrir o app + a conexão voltando): cada entrega vai UMA vez', () async {
    await guardar('p1', codigo: '1');
    await guardar('p2', codigo: '2');
    final enviados = <String>[];
    Future<Map<String, dynamic>> enviar(String id, String? cod, Map<String, dynamic>? local) async {
      enviados.add(id);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      return {'ok': true, 'valid': true};
    }

    final a = Outbox.flush(enviar: enviar);
    final b = Outbox.flush(enviar: enviar);
    final ra = await a;
    final rb = await b;
    expect(enviados, ['p1', 'p2']);
    expect(ra.confirmadas, 2);
    expect(rb.confirmadas, 2); // o segundo recebe o mesmo resultado
    expect(await Outbox.pendentes(), 0);
    // terminado, um reenvio novo roda de novo (nada na fila: nada enviado)
    expect((await Outbox.flush(enviar: enviar)).confirmadas, 0);
  });

  test('401 (a sessão venceu) não é recusa: a entrega fica para depois do novo login', () async {
    await guardar('p3', codigo: '3');
    final r = await Outbox.flush(
      enviar: (id, cod, local) async => throw const ApiErro(401, 'Sua sessão venceu. Entre de novo com seu usuário e senha.'),
    );
    expect(r.recusadas, isEmpty);
    expect(await Outbox.pendentesIds(), {'p3'});
    expect(const ApiErro(401, '').sessao, isTrue);
    expect(const ApiErro(401, '').recusa, isFalse);
    expect(const ApiErro(403, '').recusa, isTrue);
  });
}
