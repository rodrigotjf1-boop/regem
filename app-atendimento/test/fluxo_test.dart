import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:regem_atendimento/abrir.dart';
import 'package:regem_atendimento/api.dart';
import 'package:regem_atendimento/avisos.dart';
import 'package:regem_atendimento/main.dart';
import 'package:regem_atendimento/telas/botao_copiloto.dart';

// O FLUXO DO APP contra um servidor FALSO que confere o que o app manda como o servidor de verdade confere: o pareamento
// pelo código (com `tipo: atendimento`), a entrada com o PIN levando os cabeçalhos do celular, a fila com o token E os
// cabeçalhos, "Ocupado" com o motivo, pegar, resolver, a disputa respondida com o PIN, o celular revogado voltando a
// parear. (A rota de verdade está provada no servidor: `atendimento-app-pg.spec.ts` e o roteiro de tela do PR #801.)

class ServidorFalso {
  final pedidos = <http.Request>[];
  String categoria = 'gerente';
  bool revogado = false;
  final casos = <Map<String, dynamic>>[];
  Map<String, dynamic> avisos = {'disputa': {'avisar': true, 'deNovoMin': 2}};
  // As conversas do caso (1.1): o chat do iFood/99, o Direct e o Messenger, pelo id do caso; e o copiloto.
  final conversas = <String, Map<String, dynamic>>{};
  bool copilotoLigado = true;

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
        return _json({'casos': casos, 'contagens': {}, 'eu': 'eu', 'avisos': avisos});
      case 'GET /atendimento/fila/resolvidos':
        return _json([]);
      case 'GET /atendimento/equipe':
        return _json([
          {'id': 'eu', 'nome': 'Ana Gerente', 'eu': true, 'presenca': null},
          {'id': 'b', 'nome': 'Bruno', 'eu': false, 'presenca': {'estado': 'disponivel', 'motivo': null}},
        ]);
      // A conversa do caso do WhatsApp (sem mensagens ainda).
      case 'GET /whatsapp/conversas':
        return _json([]);
      case 'GET /whatsapp/mensagens':
        return _json([]);
      case 'GET /atendimento/copiloto':
        return _json({'ligado': copilotoLigado, 'disponivel': true});
    }
    // A conversa do caso (1.1), como as rotas de verdade: ler é de todos; responder, da gestão (403 para a equipe); a sugestão
    // pede mensagem do cliente (400 sem ela) e só volta o texto — nada é enviado.
    if (partes.length == 4 && partes[1] == 'atendimento' && const {'chat', 'instagram', 'messenger'}.contains(partes[3])) {
      final conv = conversas[partes[2]];
      if (conv == null) return _json({'message': 'Caso não encontrado.'}, 404);
      if (r.method == 'GET') return _json(conv);
      if (categoria == 'execucao') return _json({'message': 'Forbidden resource'}, 403);
      (conv['mensagens'] as List).add({
        'id': 'm${(conv['mensagens'] as List).length + 1}',
        'direcao': 'saida',
        'autor': 'equipe',
        'quem': 'Ana Gerente',
        'autorNome': 'Ana Gerente',
        'texto': corpo['texto'],
        'estado': partes[3] == 'chat' ? 'pendente' : 'enviada',
        'em': DateTime.now().toUtc().toIso8601String(),
        'criadoEm': DateTime.now().toUtc().toIso8601String(),
      });
      return _json({'ok': true}, partes[3] == 'chat' ? 201 : 200);
    }
    if (r.method == 'POST' && partes.length == 4 && partes[1] == 'atendimento' && partes[3] == 'sugestao') {
      final msgs = (corpo['mensagens'] as List?) ?? const [];
      if (!msgs.any((m) => m is Map && m['de'] == 'cliente')) return _json({'message': 'Ainda não há mensagem do cliente para responder.'}, 400);
      return _json({'texto': 'Boa noite! Já estamos vendo o seu pedido.'}, 201);
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
        // O endereço depois que o pedido saiu (PR 3b-2): só 'manter' ou 'nova', como o servidor de verdade.
        case 'endereco-depois-que-saiu':
          if (corpo['taxa'] != 'manter' && corpo['taxa'] != 'nova') return _json({'message': 'Escolha a taxa da entrega.'}, 400);
          final mudado = {
            'em': DateTime.now().toUtc().toIso8601String(),
            'porNome': 'Ana Gerente',
            'taxa': corpo['taxa'] == 'nova' ? 8 : 6,
            'alteracaoId': 'alt-1',
          };
          ((c['detalhe'] as Map)['endereco'] as Map)['mudado'] = mudado;
          c['mudancaDoEndereco'] = {'situacao': 'aplicada', 'motivo': null, 'aviso': null};
          return _json({'ok': true, 'id': id, 'mudado': mudado, 'situacao': 'aplicada'}, 201);
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

/// O caso que o robô abre quando o cliente pede outro endereço com o pedido já na rua (PR 3b-2).
Map<String, dynamic> casoDoEndereco() => {
      'id': 'm1',
      'tipo': 'mudanca',
      'canal': 'whatsapp',
      'cliente': 'Bia',
      'telefone': '5521999990001',
      'pedidoNumero': '951',
      'pedidoStatus': 'despachado',
      'mensagem': 'Motivo: o pedido nº 951 já saiu para a entrega e o cliente quer mudar o endereço',
      'prioridade': 'urgente',
      'situacao': 'fila',
      'responsavelId': null,
      'criadoEm': DateTime.now().subtract(const Duration(minutes: 1)).toUtc().toIso8601String(),
      'posicao': 1,
      'detalhe': <String, dynamic>{
        'robo': {'motivo': 'o pedido nº 951 já saiu e o cliente quer mudar o endereço', 'quer': 'entregar em Rua Ipê, 45', 'jaFez': 'chamei a equipe'},
        'endereco': <String, dynamic>{
          'pedidoId': 'p1',
          'numero': '951',
          'de': {'rua': 'Rua das Flores', 'numero': '120', 'bairro': 'Centro', 'referencia': null},
          'para': {'rua': 'Rua Ipê', 'numero': '45', 'bairro': 'Jardim América', 'bairroId': null, 'referencia': 'casa azul'},
          'taxaAntes': 6,
          'taxaNova': 8,
          'total': 36,
          'aReceber': 36,
          'comANova': {'total': 38, 'aReceber': 38},
          'pagoAntes': false,
          'formaPagamento': 'Dinheiro',
          'trocoPara': 50,
          'entregador': {'nome': 'João Silva', 'telefone': '21988887777', 'saiuEm': DateTime.now().toUtc().toIso8601String()},
          'distancia': {'km': 2.4, 'min': 7, 'pelo': 'caminho'},
          'em': DateTime.now().toUtc().toIso8601String(),
        },
      },
    };

/// O caso "Mensagem no chat" do iFood (o do print do dono, 10/11: só o resumo e os botões, sem conversa).
Map<String, dynamic> casoDoChat() => {
      'id': 'ch1',
      'tipo': 'chat',
      'canal': 'ifood',
      'cliente': 'Isabel Cristina',
      'pedidoNaPlataforma': '5073',
      'mensagem': 'estou indo',
      'prioridade': 'normal',
      'situacao': 'fila',
      'responsavelId': null,
      'criadoEm': DateTime.now().subtract(const Duration(minutes: 1)).toUtc().toIso8601String(),
      'posicao': 1,
      'detalhe': <String, dynamic>{},
    };

Map<String, dynamic> conversaDoChat() => {
      'disponivel': true,
      'canal': 'ifood',
      'ponte': {'ligada': true, 'responde': true},
      'mensagens': <Map<String, dynamic>>[
        {'id': 'm1', 'direcao': 'entrada', 'autor': 'cliente', 'texto': 'Pede para o entregador ligar ao chegar', 'estado': 'recebida', 'em': DateTime.now().toUtc().toIso8601String()},
      ],
    };

Map<String, dynamic> casoDoDirect() => {
      'id': 'ig1',
      'tipo': 'instagram',
      'canal': 'instagram',
      'cliente': 'Rafa',
      'mensagem': 'Vocês abrem amanhã?',
      'prioridade': 'normal',
      'situacao': 'fila',
      'responsavelId': null,
      'criadoEm': DateTime.now().toUtc().toIso8601String(),
      'posicao': 1,
      'detalhe': <String, dynamic>{},
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
    BotaoCopiloto.esquecer();
    await Api.carregar();
  });

  /// O tamanho de um celular comum (360 × 780): o que estoura numa tela assim aparece no teste.
  void celular(WidgetTester t) {
    t.view.physicalSize = const Size(1080, 2340);
    t.view.devicePixelRatio = 3.0;
    addTearDown(t.view.reset);
  }

  /// Rola a tela até o botão aparecer (a lista só monta o que está perto da área visível). `passo` negativo = para cima
  /// (o alvo está acima do que se vê — depois de descer até o campo, por exemplo).
  Future<void> rolarAte(WidgetTester t, Finder alvo, {double passo = 200}) async {
    await t.scrollUntilVisible(alvo, passo, scrollable: find.byType(Scrollable).first);
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

  testWidgets('disputa nova avisa o gerente na hora; "de novo" perto do prazo; o ajuste desligado não avisa', (t) async {
    celular(t);
    final avisados = <String>[];
    Avisos.espiao = (titulo, texto, urgente) => avisados.add('${urgente ? 'URGENTE' : 'normal'}|$titulo|$texto');
    addTearDown(() => Avisos.espiao = null);
    await parearEEntrar(t); // a 1ª leitura é a base: o que já estava não avisa
    servidor.casos.add(casoDaDisputa());
    await t.pump(const Duration(seconds: 11));
    await esperar(t);
    expect(avisados.where((a) => a.startsWith('URGENTE|🔔 Disputa do iFood — só gerente e presidente respondem|Ana P. · pedido iFood 4521 · vence em')), hasLength(1));
    // com 6 min ainda, o "de novo" (2 min) não toca
    await t.pump(const Duration(seconds: 11));
    await esperar(t);
    expect(avisados.where((a) => a.contains('⏰ Disputa sem resposta')), isEmpty);
    // faltando menos que o "de novo" (2 min): o segundo aviso, uma vez só
    servidor.casos.first['prazoEm'] = DateTime.now().add(const Duration(seconds: 90)).toUtc().toIso8601String();
    await t.pump(const Duration(seconds: 11));
    await esperar(t);
    await t.pump(const Duration(seconds: 11));
    await esperar(t);
    expect(avisados.where((a) => a.startsWith('URGENTE|⏰ Disputa sem resposta|')), hasLength(1));
    // a disputa já respondida (ainda na lista, a caminho de fechar) não pede o "de novo"
    servidor.casos.add({
      ...casoDaDisputa(),
      'id': 'd3',
      'cliente': 'Caio',
      'prazoEm': DateTime.now().add(const Duration(seconds: 60)).toUtc().toIso8601String(),
      'detalhe': <String, dynamic>{'disputa': <String, dynamic>{'mensagem': 'x'}, 'resposta': <String, dynamic>{'acao': 'recusar'}},
    });
    for (var i = 0; i < 2; i++) {
      await t.pump(const Duration(seconds: 11));
      await esperar(t);
    }
    expect(avisados.where((a) => a.contains('⏰') && a.contains('Caio')), isEmpty);
    // o ajuste "Avisar o gerente quando chega uma disputa" desligado: a próxima disputa não avisa
    servidor.avisos = {'disputa': {'avisar': false, 'deNovoMin': 2}};
    await t.pump(const Duration(seconds: 11));
    await esperar(t);
    servidor.casos.add({...casoDaDisputa(), 'id': 'd2', 'cliente': 'Bia'});
    await t.pump(const Duration(seconds: 11));
    await esperar(t);
    expect(avisados.where((a) => a.contains('Bia')), isEmpty);
    await fechar(t);
  });

  testWidgets('quem não é gerente não é avisado da disputa (não responde); do caso do WhatsApp, sim', (t) async {
    celular(t);
    servidor.categoria = 'execucao';
    final avisados = <String>[];
    Avisos.espiao = (titulo, texto, urgente) => avisados.add('$titulo|$texto');
    addTearDown(() => Avisos.espiao = null);
    await parearEEntrar(t);
    servidor.casos.add(casoDaDisputa());
    servidor.casos.add({...casoDoWhatsapp(), 'prioridade': 'normal'});
    await t.pump(const Duration(seconds: 11));
    await esperar(t);
    expect(avisados.where((a) => a.contains('Ana P.')), isEmpty);
    expect(avisados.where((a) => a.startsWith('🔔 Problema no pedido|Carlos')), hasLength(1));
    await fechar(t);
  });

  testWidgets('o endereço depois que o pedido saiu: o bloco, "Cobrar a nova", o "Não dá" no campo e o "Mudar" que abre o WhatsApp do entregador', (t) async {
    celular(t);
    final abertos = <Uri>[];
    final original = Abrir.link;
    Abrir.link = (u) async {
      abertos.add(u);
      return true;
    };
    addTearDown(() => Abrir.link = original);
    servidor.casos.add(casoDoEndereco());
    await parearEEntrar(t);
    await t.tap(find.text('Pegar'));
    await esperar(t, 10);
    // O bloco com o que o robô anotou (os mesmos textos da tela do computador).
    expect(find.text('Endereço novo · pedido nº 951'), findsOneWidget);
    expect(find.text('🛵 Já saiu para entrega'), findsOneWidget);
    expect(find.text('Rua das Flores, 120 · Centro'), findsOneWidget);
    expect(find.text('2,4 km pelo caminho (≈ 7 min de moto)'), findsOneWidget);
    expect(find.text(r'R$ 8,00 (o pedido pagou R$ 6,00)'), findsOneWidget);
    expect(find.text(r'Dinheiro · troco para R$ 50,00'), findsOneWidget);
    expect(find.textContaining('João Silva · saiu às'), findsOneWidget);
    // A taxa: "Cobrar a nova" mostra o total novo.
    await rolarAte(t, find.text(r'Cobrar a nova (R$ 8,00) na entrega'));
    await t.tap(find.text(r'Cobrar a nova (R$ 8,00) na entrega'));
    await t.pump();
    expect(find.text(r'O pedido passa para R$ 38,00.'), findsOneWidget);
    // "Não dá": o rascunho vai para o campo da conversa (nada é enviado).
    await rolarAte(t, find.text('Não dá: responder ao cliente'));
    await t.tap(find.text('Não dá: responder ao cliente'));
    await esperar(t);
    final campo = t.widget<TextField>(find.byType(TextField).last);
    expect(campo.controller!.text, startsWith('Não conseguimos mudar o endereço do pedido nº 951: o entregador já está a caminho da Rua das Flores, 120.'));
    expect(servidor.pedidos.where((r) => r.url.path.endsWith('/whatsapp/enviar')), isEmpty);
    // "Mudar o endereço e avisar o entregador": o servidor recebe a taxa escolhida e a mensagem pronta abre no WhatsApp dele.
    // O botão fica ACIMA do campo onde o "Não dá" deixou a tela (a conversa ganhou o copiloto na 1.1): sobe até ele.
    await rolarAte(t, find.text('Mudar o endereço e avisar o entregador'), passo: -200);
    await t.tap(find.text('Mudar o endereço e avisar o entregador'));
    await esperar(t, 10);
    final mudou = servidor.pedidos.lastWhere((r) => r.url.path.endsWith('/atendimento/m1/endereco-depois-que-saiu'));
    expect(jsonDecode(mudou.body), {'taxa': 'nova'});
    expect(mudou.headers['x-terminal-id'], 'term-1');
    expect(abertos, hasLength(1));
    expect(abertos.single.host, 'wa.me');
    expect(abertos.single.path, '/5521988887777');
    expect(abertos.single.queryParameters['text'],
        r'Oi, João! O endereço do pedido nº 951 mudou: agora é Rua Ipê, 45 · Jardim América (casa azul). Receber R$ 38,00 (troco para R$ 50,00).');
    // Depois de mudar: o estado (a fila relida) e o formulário sai.
    await rolarAte(t, find.textContaining('✓ Endereço mudado'));
    expect(find.textContaining(r'Rua Ipê, 45 · Jardim América, entrega passou para R$ 8,00.'), findsOneWidget);
    expect(find.text('O cliente recebe a mensagem em instantes.'), findsOneWidget);
    expect(find.text('Mudar o endereço e avisar o entregador'), findsNothing);
    expect(find.text('Abrir a mensagem para o João'), findsOneWidget);
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

  // ===================== As conversas do caso (1.1 — o print do dono de 10/11: "só os botões abaixo") =====================

  List<http.Request> postsDa(String rota) => servidor.pedidos.where((r) => r.method == 'POST' && r.url.path.endsWith(rota)).toList();

  testWidgets('gerente: o chat do iFood no caso — lê, usa a pronta e envia pela ponte; a mensagem fica "na fila da ponte"', (t) async {
    celular(t);
    servidor.casos.add(casoDoChat());
    servidor.conversas['ch1'] = conversaDoChat();
    await parearEEntrar(t);
    await t.tap(find.text('Pegar'));
    await esperar(t, 10);
    expect(find.text('Mensagem no chat'), findsWidgets); // antes: "Atendimento"
    expect(find.text('Chat do iFood com Isabel Cristina'), findsOneWidget);
    expect(find.text('Pede para o entregador ligar ao chegar'), findsOneWidget);
    await rolarAte(t, find.text('Vou confirmar e já te respondo por aqui.'));
    await t.tap(find.text('Vou confirmar e já te respondo por aqui.'));
    await t.pump();
    await rolarAte(t, find.text('Enviar pelo iFood'));
    await t.tap(find.text('Enviar pelo iFood'));
    await esperar(t, 10);
    final envio = postsDa('/atendimento/ch1/chat');
    expect(envio, hasLength(1));
    expect(jsonDecode(envio.single.body), {'texto': 'Vou confirmar e já te respondo por aqui.'});
    await rolarAte(t, find.text('⏳ na fila da ponte'));
    expect(find.text('⏳ na fila da ponte'), findsOneWidget);
    await fechar(t);
  });

  testWidgets('no chat da plataforma, telefone não sai: o aviso aparece e nada é enviado', (t) async {
    celular(t);
    servidor.casos.add(casoDoChat());
    servidor.conversas['ch1'] = conversaDoChat();
    await parearEEntrar(t);
    await t.tap(find.text('Pegar'));
    await esperar(t, 10);
    await rolarAte(t, find.text('Enviar pelo iFood'));
    await t.enterText(find.byType(TextField).last, 'me liga no 21 99999-0000');
    await t.pump();
    await t.tap(find.text('Enviar pelo iFood'));
    await esperar(t);
    expect(find.textContaining('a plataforma proíbe'), findsWidgets);
    expect(postsDa('/atendimento/ch1/chat'), isEmpty);
    await fechar(t);
  });

  testWidgets('o copiloto: "✨ Sugerir resposta" manda a conversa e põe a sugestão no campo — nada sai sozinho', (t) async {
    celular(t);
    servidor.casos.add(casoDoChat());
    servidor.conversas['ch1'] = conversaDoChat();
    await parearEEntrar(t);
    await t.tap(find.text('Pegar'));
    await esperar(t, 10);
    await rolarAte(t, find.text('✨ Sugerir resposta'));
    await t.tap(find.text('✨ Sugerir resposta'));
    await esperar(t, 10);
    final pedido = postsDa('/atendimento/ch1/sugestao');
    expect(pedido, hasLength(1));
    final corpo = jsonDecode(pedido.single.body) as Map<String, dynamic>;
    expect(corpo['mensagens'], [
      {'de': 'cliente', 'texto': 'Pede para o entregador ligar ao chegar'},
    ]);
    expect((corpo['prontas'] as List), hasLength(4));
    final campo = t.widget<TextField>(find.byType(TextField).last);
    expect(campo.controller!.text, 'Boa noite! Já estamos vendo o seu pedido.');
    expect(find.text('✨ Outra sugestão'), findsOneWidget);
    expect(postsDa('/atendimento/ch1/chat'), isEmpty);
    await fechar(t);
  });

  testWidgets('copiloto desligado na empresa: nenhum botão de sugestão', (t) async {
    celular(t);
    servidor.copilotoLigado = false;
    servidor.casos.add(casoDoChat());
    servidor.conversas['ch1'] = conversaDoChat();
    await parearEEntrar(t);
    await t.tap(find.text('Pegar'));
    await esperar(t, 10);
    await rolarAte(t, find.text('Enviar pelo iFood'));
    expect(find.text('✨ Sugerir resposta'), findsNothing);
    await fechar(t);
  });

  testWidgets('a equipe (execução) lê o chat e não tem campo: "quem responde é a gerência ou a supervisão"', (t) async {
    celular(t);
    servidor.categoria = 'execucao';
    servidor.casos.add(casoDoChat());
    servidor.conversas['ch1'] = conversaDoChat();
    await parearEEntrar(t);
    await t.tap(find.text('Pegar'));
    await esperar(t, 10);
    expect(find.text('Pede para o entregador ligar ao chegar'), findsOneWidget);
    await rolarAte(t, find.textContaining('Quem responde é a gerência ou a supervisão'));
    expect(find.text('Enviar pelo iFood'), findsNothing);
    expect(find.text('✨ Sugerir resposta'), findsNothing);
    await fechar(t);
  });

  testWidgets('o Direct com a janela de 24 h fechada: lê, diz por quê e não deixa escrever', (t) async {
    celular(t);
    servidor.casos.add(casoDoDirect());
    servidor.conversas['ig1'] = {
      'conectada': true,
      'janela': {'aberta': false, 'ate': null},
      'perfil': {'usuario': 'rafa', 'nome': 'Rafa', 'segue': true},
      'conta': 'misterburguer',
      'mensagens': <Map<String, dynamic>>[
        {'id': 'i1', 'direcao': 'entrada', 'autor': 'cliente', 'tipo': 'texto', 'texto': 'Vocês abrem amanhã?', 'estado': 'recebida', 'criadoEm': DateTime.now().toUtc().toIso8601String()},
        {'id': 'i2', 'direcao': 'entrada', 'autor': 'cliente', 'tipo': 'imagem', 'texto': null, 'estado': 'recebida', 'criadoEm': DateTime.now().toUtc().toIso8601String()},
      ],
    };
    await parearEEntrar(t);
    await t.tap(find.text('Pegar'));
    await esperar(t, 10);
    expect(find.text('Direct do Instagram com Rafa'), findsOneWidget);
    await rolarAte(t, find.text('[foto]'));
    await rolarAte(t, find.textContaining('Passaram 24 h da última mensagem do cliente'));
    expect(find.text('A janela de 24 h fechou.'), findsOneWidget);
    expect(find.text('Enviar no Direct'), findsNothing);
    await fechar(t);
  });
}
