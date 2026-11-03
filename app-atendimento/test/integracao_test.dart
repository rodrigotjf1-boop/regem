import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:regem_atendimento/api.dart';

// O APP CONTRA UM SERVIDOR DE VERDADE (não o falso): pula sem o código. Para rodar, gere o código de um "App de
// atendimento" em Configurações › Equipamentos de um servidor de teste e rode:
//   flutter test test/integracao_test.dart --dart-define=API_URL=http://localhost:3056/api/v1 \
//     --dart-define=CODIGO=123456 --dart-define=PIN=<o PIN de quem vai entrar>
// Prova o formato das respostas que o app lê (parear, entrar, presença, fila, equipe) e as recusas.
const _codigo = String.fromEnvironment('CODIGO');
const _pin = String.fromEnvironment('PIN');

void main() {
  test('pareia, entra com o PIN, marca "Ocupado", lê a fila e a equipe, e sai — no servidor de verdade', () async {
    FlutterSecureStorage.setMockInitialValues({});
    Api.cliente = http.Client();
    await Api.carregar();

    await expectLater(Api.parear('000000'), throwsA(isA<ApiErro>().having((e) => e.status, 'status', 400)));
    await Api.parear(_codigo);
    expect(Api.pareado, isTrue);

    await expectLater(Api.entrar('0000'), throwsA(isA<ApiErro>().having((e) => e.mensagem, 'mensagem', 'PIN inválido.')));
    final s = await Api.entrar(_pin);
    expect(s.token, isNotEmpty);
    expect(s.nome, isNotEmpty);
    expect(s.aparelho, isNotEmpty);

    final m = await Api.marcar('ocupado', motivo: 'embalando');
    expect(m['estado'], 'ocupado');
    expect(m['motivo'], 'embalando');
    final p = await Api.presenca();
    expect((p['eu'] as Map)['motivo'], 'embalando');
    expect(p['valeMin'], 3);

    final f = await Api.fila();
    expect(f['casos'], isA<List>());
    expect(f['eu'], isNotNull);
    expect(await Api.resolvidos(), isA<List>());
    final e = await Api.equipe();
    final eu = e.whereType<Map>().where((x) => x['eu'] == true).toList();
    expect(eu, hasLength(1));
    expect((eu.first['presenca'] as Map)['estado'], 'ocupado');

    // A sessão do app só vale com o celular: sem o id dele, 401; sem o segredo, o celular não é reconhecido.
    final id = Api.terminalId;
    Api.terminalId = null;
    await expectLater(Api.fila(), throwsA(isA<ApiErro>().having((e) => e.status, 'status', 401)));
    Api.terminalId = id;
    final segredo = Api.segredo;
    Api.segredo = 'outro';
    await expectLater(Api.fila(), throwsA(isA<ApiErro>().having((e) => e.codigo, 'codigo', 'TERMINAL_NAO_RECONHECIDO')));
    Api.segredo = segredo;

    await Api.sair();
    expect(Api.sessao, isNull);
    expect(Api.pareado, isTrue);
  }, skip: _codigo.isEmpty ? 'sem o código de pareamento (--dart-define=CODIGO=...)' : false);
}
