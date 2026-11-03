import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:regem_atendimento/api.dart';
import 'package:regem_atendimento/main.dart';

// O FLUXO DO APP contra um servidor FALSO que confere o que o app manda como o servidor de verdade confere: o pareamento
// pelo código (com `tipo: atendimento`), a entrada com o PIN levando os cabeçalhos do celular, a fila com o token E os
// cabeçalhos, "Ocupado" com o motivo, pegar, resolver, a disputa respondida com o PIN, o celular revogado voltando a
// parear. (A rota de verdade está provada no servidor: `atendimento-app-pg.spec.ts` e o roteiro de tela do PR #801.)

class ServidorFalso {
  final pedidos = <http.Request>[];
  String categoria = 'gerente';
  bool revogado = false;
  final casos = <Map<String, dynamic>>[];

  http.Response _json(Object corpo, [int status = 200]) =>
      http.Response(jsonEncode(corpo), status, headers: {'content-type': 'application/json; charset=utf-8'});

  bool _doCelular(http.Request r) => r.headers['x-terminal-id'] == 'term-1' && r.headers['x-terminal-secret'] == 'seg-1';

  Future<http.Response> responder(http.Request r) async {
    pedidos.add(r);
    final caminho = r.url.path.replaceFirst('/api/v1', '');
    final corpo = r.body.isEmpty ? <String, dynamic>{} : jsonDecode(r.body) as Map<String, dynamic>;
    if (caminho == '/publico/terminal/parear') {
      if (corpo['tipo'] != 'atendimento') return _json({'message': 'sem tipo'}, 400);
      return corpo['codigo'] == '123456'
          ? _json({'terminalId': 'term-1', 'segredo': 'seg-1', 'tipo': 'atendimento', 'nome': 'Celular do balcão'}, 201)
          : _json({'message': 'Código não encontrado. Gere um novo no Regem.'}, 400);
    }
    if (revogado) return _json({'message': 'Este celular foi revogado no Regem.', 'code': 'TERMINAL_REVOGADO'}, 403);
    if (!_doCelular(r)) return _json({'message': 'Este celular não foi reconhecido.', 'code': 'TERMINAL_NAO_RECONHECIDO'}, 403);
    if (caminho == '/atendimento/app/entrar') {
      if (corpo['pin'] != '2468') return _json({'message': 'PIN inválido.'}, 401);
      return _json({
        'access_token': 'tok-1',
        'colaboradorId': 'eu',
        'nome': 'Ana Gerente',
        'categoria': categoria,
        'unidadeId': 'loja-a',
        'loja': 'Loja Centro',
        'aparelho': {'id': 'term-1', 'nome': 'Celular do balcão'},
      }, 201);
    }
    if (r.headers['authorization'] != 'Bearer tok-1') return _json({'message': 'Esta sessão é do app de atendimento.'}, 401);
    final partes = caminho.split('/');
    switch ('${r.method} $caminho') {
      case 'GET /atendimento/app/presenca':
        return _json({'eu': null, 'equipe': [], 'valeMin': 3});
      case 'PUT /atendimento/app/presenca':
        return _json({'estado': corpo['estado'], 'motivo': corpo['motivo'], 'desde': DateTime.now().toIso8601String(), 'valeMin': 3});
      case 'POST /atendimento/app/sair':
        return _json({'ok': true}, 201);
      case 'GET /atendimento/fila':
        return _json({'casos': casos, 'contagens': {}, 'eu': 'eu'});
      case 'GET /atendimento/fila/resolvidos':
        return _json([]);
      case 'GET /atendimento/equipe':
        return _json([
          {'id': 'eu', 'nome': 'Ana Gerente', 'eu': true, 'presenca': null},
          {'id': 'b', 'nome': 'Bruno', 'eu': false, 'presenca': {'estado': 'disponivel', 'motivo': null}},
        ]);
    }
    if (r.method == 'POST' && partes.length == 4 && partes[1] == 'atendimento') {
      final id = partes[2];
      final c = casos.firstWhere((x) => x['id'] == id);
      switch (partes[3]) {
        case 'pegar':
          c['responsavelId'] = 'eu';
          c['situacao'] = 'com_alguem';
          c['pegoEm'] = DateTime.now().toUtc().toIso8601String();
          return _json({'ok': true}, 201);
        case 'resolver':
          casos.remove(c);
          return _json({'ok': true}, 201);
        case 'disputa':
          (c['detalhe'] as Map)['resposta'] = {'acao': corpo['acao'], 'motivo': corpo['motivo'], 'por': 'Ana Gerente'};
          return _json({'ok': true, 'resposta': {'acao': corpo['acao']}}, 201);
      }
    }
    return _json({'message': 'rota que o teste não conhece: ${r.method} $caminho'}, 404);
  }
}

Map<String, dynamic> casoDoWhatsapp() => {
      'id': 'c1',
      'tipo': 'erro',
      'canal': 'whatsapp',
      'cliente': 'Carlos',
      'telefone': null,
      'mensagem': 'Cadê meu lanche?',
      'prioridade': 'urgente',
      'situacao': 'fila',
      'responsavelId': null,
      'criadoEm': DateTime.now().subtract(const Duration(minutes: 4)).toUtc().toIso8601String(),
      'posicao': 1,
      'detalhe': {
        'robo': {'motivo': 'atraso', 'quer': 'saber quando chega', 'jaFez': 'mandou o rastreio'},
      },
    };

Map<String, dynamic> casoDaDisputa() => {
      'id': 'd1',
      'tipo': 'disputa',
      'canal': 'ifood',
      'cliente': 'Ana P.',
      'pedidoNaPlataforma': '4521',
      'prioridade': 'normal',
      'situacao': 'fila',
      'responsavelId': null,
      'prazoEm': DateTime.now().add(const Duration(minutes: 6)).toUtc().toIso8601String(),
      'criadoEm': DateTime.now().toUtc().toIso8601String(),
      'detalhe': <String, dynamic>{
        'disputa': <String, dynamic>{'mensagem': 'Faltou a batata.', 'acaoAutomatica': 'ACCEPT_CANCELLATION', 'alternativas': [], 'motivosParaAceitar': []},
      },
    };

Future<void> esperar(WidgetTester t, [int vezes = 6]) async {
  for (var i = 0; i < vezes; i++) {
    await t.pump(const Duration(milliseconds: 120));
  }
}

/// Fecha o app (cancela os relógios da fila) — sem isso o teste acaba com relógio pendente.
Future<void> fechar(WidgetTester t) async {
  await t.pumpWidget(const SizedBox());
  await t.pump(const Duration(seconds: 1));
}

Future<void> parearEEntrar(WidgetTester t) async {
  await t.pumpWidget(const AppAtendimento());
  await esperar(t);
  expect(find.text('Primeira vez neste aparelho'), findsOneWidget);
  await t.enterText(find.byType(TextField), '123456');
  await t.tap(find.text('Parear'));
  await esperar(t);
  expect(find.text('Quem vai atender?'), findsOneWidget);
  for (final d in ['2', '4', '6', '8']) {
    await t.tap(find.text(d));
    await t.pump();
  }
  await t.tap(find.text('Entrar'));
  await esperar(t, 10);
}

void main() {
  late ServidorFalso servidor;

  setUp(() async {
    FlutterSecureStorage.setMockInitialValues({});
    servidor = ServidorFalso();
    Api.cliente = MockClient(servidor.responder);
    await Api.carregar();
  });

  /// O tamanho de um celular comum (360 × 780): o que estoura numa tela assim aparece no teste.
  void celular(WidgetTester t) {
    t.view.physicalSize = const Size(1080, 2340);
    t.view.devicePixelRatio = 3.0;
    addTearDown(t.view.reset);
  }

  /// Rola a tela até o botão aparecer (a lista só monta o que está perto da área visível).
  Future<void> rolarAte(WidgetTester t, Finder alvo) async {
    await t.scrollUntilVisible(alvo, 200, scrollable: find.byType(Scrollable).first);
    await t.pump();
  }

  testWidgets('pareia pelo código, entra com o PIN e a fila aparece — com o token E os cabeçalhos do celular', (t) async {
    celular(t);
    servidor.casos.add(casoDoWhatsapp());
    await parearEEntrar(t);
    expect(find.text('Loja Centro'), findsOneWidget);
    expect(find.text('Carlos'), findsOneWidget);
    expect(find.text('🚨 Urgente'), findsOneWidget);
    expect(find.text('atraso · saber quando chega'), findsOneWidget);
    final pareou = servidor.pedidos.firstWhere((r) => r.url.path.endsWith('/publico/terminal/parear'));
    expect(jsonDecode(pareou.body)['tipo'], 'atendimento');
    final entrou = servidor.pedidos.firstWhere((r) => r.url.path.endsWith('/atendimento/app/entrar'));
    expect(entrou.headers['x-terminal-id'], 'term-1');
    expect(jsonDecode(entrou.body), {'pin': '2468'});
    final fila = servidor.pedidos.lastWhere((r) => r.url.path.endsWith('/atendimento/fila'));
    expect(fila.headers['authorization'], 'Bearer tok-1');
    expect(fila.headers['x-terminal-secret'], 'seg-1');
    // entrou = disponível
    final presenca = servidor.pedidos.lastWhere((r) => r.method == 'PUT' && r.url.path.endsWith('/atendimento/app/presenca'));
    expect(jsonDecode(presenca.body)['estado'], 'disponivel');
    await fechar(t);
  });

  testWidgets('código errado e PIN errado mostram o motivo do servidor e ficam na tela', (t) async {
    celular(t);
    await t.pumpWidget(const AppAtendimento());
    await esperar(t);
    await t.enterText(find.byType(TextField), '999999');
    await t.tap(find.text('Parear'));
    await esperar(t);
    expect(find.text('Código não encontrado. Gere um novo no Regem.'), findsOneWidget);
    await t.enterText(find.byType(TextField), '123456');
    await t.tap(find.text('Parear'));
    await esperar(t);
    for (final d in ['1', '1', '1', '1']) {
      await t.tap(find.text(d));
      await t.pump();
    }
    await t.tap(find.text('Entrar'));
    await esperar(t);
    expect(find.text('PIN inválido.'), findsOneWidget);
    expect(find.text('Quem vai atender?'), findsOneWidget);
    await fechar(t);
  });

  testWidgets('"Ocupado": escolhe o motivo e o servidor recebe o estado com ele', (t) async {
    celular(t);
    await parearEEntrar(t);
    await t.tap(find.text('Ocupado'));
    await esperar(t);
    await t.tap(find.text('Ocupado: embalando'));
    await esperar(t);
    final ultima = servidor.pedidos.lastWhere((r) => r.method == 'PUT' && r.url.path.endsWith('/atendimento/app/presenca'));
    expect(jsonDecode(ultima.body), {'estado': 'ocupado', 'motivo': 'embalando'});
    expect(find.text('Você está ocupado: o app só toca para o que tem prazo. Os outros casos vão para quem está disponível.'), findsOneWidget);
    await fechar(t);
  });

  testWidgets('pegar abre o caso; resolver confirma e tira da fila', (t) async {
    celular(t);
    servidor.casos.add(casoDoWhatsapp());
    await parearEEntrar(t);
    await t.tap(find.text('Pegar'));
    await esperar(t, 10);
    expect(servidor.pedidos.any((r) => r.url.path.endsWith('/atendimento/c1/pegar')), isTrue);
    expect(find.text('O ROBÔ RESUMIU'), findsOneWidget);
    await t.tap(find.text('Resolver'));
    await esperar(t);
    await t.tap(find.widgetWithText(FilledButton, 'Resolver').last);
    await esperar(t, 10);
    expect(servidor.pedidos.any((r) => r.url.path.endsWith('/atendimento/c1/resolver')), isTrue);
    expect(find.text('Carlos'), findsNothing);
    await fechar(t);
  });

  testWidgets('gerente responde à disputa do iFood com o PIN dele', (t) async {
    celular(t);
    servidor.casos.add(casoDaDisputa());
    await parearEEntrar(t);
    await t.tap(find.text('Ver e responder'));
    await esperar(t, 10);
    expect(find.textContaining('o iFood aceita sozinho'), findsOneWidget);
    await rolarAte(t, find.text('Recusar'));
    await t.tap(find.text('Recusar'));
    await esperar(t);
    await t.tap(find.text('Pedido incorreto'));
    await esperar(t);
    await t.enterText(find.byType(TextField).last, '2468');
    await t.tap(find.text('Confirmar'));
    await esperar(t, 10);
    final resp = servidor.pedidos.lastWhere((r) => r.url.path.endsWith('/atendimento/d1/disputa'));
    expect(jsonDecode(resp.body), {'acao': 'recusar', 'pin': '2468', 'motivo': 'WRONG_ORDER'});
    await fechar(t);
  });

  testWidgets('quem não é gerente vê a disputa sem os botões: "chame o gerente"', (t) async {
    celular(t);
    servidor.categoria = 'execucao';
    servidor.casos.add(casoDaDisputa());
    await parearEEntrar(t);
    expect(find.text('Ver · só o gerente responde'), findsOneWidget);
    await t.tap(find.text('Ver · só o gerente responde'));
    await esperar(t, 10);
    expect(find.text('Só gerente e presidente respondem à disputa. Chame o gerente.'), findsOneWidget);
    expect(find.text('Recusar'), findsNothing);
    await fechar(t);
  });

  testWidgets('celular revogado em Equipamentos: o app esquece o pareamento e volta a pedir o código', (t) async {
    celular(t);
    await parearEEntrar(t);
    expect(find.text('Loja Centro'), findsOneWidget);
    servidor.revogado = true;
    await t.pump(const Duration(seconds: 11)); // a próxima leitura da fila
    await esperar(t, 10);
    expect(find.text('Primeira vez neste aparelho'), findsOneWidget);
    expect(find.textContaining('Este celular foi revogado no Regem'), findsOneWidget);
    expect(Api.pareado, isFalse);
    await fechar(t);
  });

  testWidgets('"Sair" tira da vez e volta ao PIN — o celular continua pareado', (t) async {
    celular(t);
    await parearEEntrar(t);
    await t.tap(find.text('Eu'));
    await esperar(t);
    await t.tap(find.text('Sair (fim do turno)'));
    await esperar(t);
    await t.tap(find.widgetWithText(FilledButton, 'Sair'));
    await esperar(t, 10);
    expect(servidor.pedidos.any((r) => r.url.path.endsWith('/atendimento/app/sair')), isTrue);
    expect(find.text('Quem vai atender?'), findsOneWidget);
    expect(Api.pareado, isTrue);
    await fechar(t);
  });
}
