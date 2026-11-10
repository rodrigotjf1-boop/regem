import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

/// O Regem na nuvem (decisão do dono, 02/11/2026: o app fala com a nuvem agora; com o servidor da loja, depois).
/// Para testar contra outro servidor: `flutter run --dart-define=API_URL=http://192.168.0.10:3056/api/v1`.
const String kApiBase = String.fromEnvironment('API_URL', defaultValue: 'https://api.dmsregem.com/api/v1');

/// Erro devolvido pela API. `codigo` separa as recusas do APARELHO (V70): só `TERMINAL_REVOGADO` faz o app esquecer o
/// pareamento; "não reconhecido" e "carregando" deixam o pareamento como está.
class ApiErro implements Exception {
  final int status;
  final String mensagem;
  final String? codigo;
  const ApiErro(this.status, this.mensagem, [this.codigo]);

  bool get revogado => codigo == 'TERMINAL_REVOGADO';
  bool get semRede => status == 0;

  @override
  String toString() => mensagem;
}

/// Quem entrou com o PIN neste celular (a sessão vale só com ESTE celular — o servidor confere).
class Sessao {
  final String token;
  final String colaboradorId;
  final String nome;
  final String categoria;
  final String? unidadeId;
  final String? loja;
  final String aparelho;

  const Sessao({
    required this.token,
    required this.colaboradorId,
    required this.nome,
    required this.categoria,
    required this.unidadeId,
    required this.loja,
    required this.aparelho,
  });

  /// Disputa do iFood e pedido da 99: só gerente e presidente respondem (o servidor confere pelo PIN).
  bool get decide => categoria == 'presidente' || categoria == 'gerente';

  /// A conversa do WhatsApp é da gestão (presidente, gerente e supervisão — o servidor confere).
  bool get conversa => decide || categoria == 'supervisao';

  String get funcao => const {
        'presidente': 'Presidente',
        'gerente': 'Gerente',
        'supervisao': 'Supervisão',
        'execucao': 'Equipe',
      }[categoria] ??
      categoria;

  Map<String, dynamic> toJson() => {
        'token': token,
        'colaboradorId': colaboradorId,
        'nome': nome,
        'categoria': categoria,
        'unidadeId': unidadeId,
        'loja': loja,
        'aparelho': aparelho,
      };

  static Sessao? deJson(Map<String, dynamic> j) {
    final t = j['token'] ?? j['access_token'];
    if (t is! String || t.isEmpty) return null;
    final ap = j['aparelho'];
    return Sessao(
      token: t,
      colaboradorId: '${j['colaboradorId'] ?? ''}',
      nome: '${j['nome'] ?? ''}',
      categoria: '${j['categoria'] ?? 'execucao'}',
      unidadeId: j['unidadeId'] as String?,
      loja: j['loja'] as String?,
      aparelho: ap is Map ? '${ap['nome'] ?? ''}' : '${ap ?? ''}',
    );
  }
}

/// Cliente da API. O celular prova quem é com o id e o segredo do pareamento (cabeçalhos `X-Terminal-Id` e
/// `X-Terminal-Secret`, guardados no cofre do Android) e a pessoa com o PIN; depois, o token da sessão vai em toda
/// chamada junto com os cabeçalhos do celular.
class Api {
  static const _cofre = FlutterSecureStorage();
  static const _tempo = Duration(seconds: 20);

  /// O cliente HTTP — os testes trocam por um servidor falso (`MockClient` do pacote http).
  static http.Client cliente = http.Client();

  static String? terminalId;
  static String? segredo;
  static Sessao? sessao;

  /// A tela principal escuta: sessão vencida (volta ao PIN) ou celular revogado (volta a parear).
  static void Function(ApiErro erro)? aoPerderAcesso;

  static bool get pareado => terminalId != null && segredo != null;

  static Future<void> carregar() async {
    try {
      terminalId = await _cofre.read(key: 'terminal_id');
      segredo = await _cofre.read(key: 'terminal_segredo');
      final s = await _cofre.read(key: 'sessao');
      sessao = s == null ? null : Sessao.deJson(jsonDecode(s) as Map<String, dynamic>);
    } catch (_) {
      // Cofre ilegível (aparelho restaurado de outro): começa do pareamento.
      terminalId = null;
      segredo = null;
      sessao = null;
    }
  }

  static Future<void> esquecerSessao() async {
    sessao = null;
    await _cofre.delete(key: 'sessao');
  }

  /// Só na revogação (V70): o celular precisa de um código novo.
  static Future<void> esquecerPareamento() async {
    terminalId = null;
    segredo = null;
    sessao = null;
    await _cofre.deleteAll();
  }

  static Map<String, String> _cabecalhos() => {
        'Content-Type': 'application/json',
        if (sessao != null) 'Authorization': 'Bearer ${sessao!.token}',
        'X-Terminal-Id': ?terminalId,
        'X-Terminal-Secret': ?segredo,
      };

  static ApiErro _erro(http.Response r) {
    String msg = 'Erro ${r.statusCode}';
    String? codigo;
    try {
      final j = jsonDecode(r.body);
      if (j is Map) {
        final m = j['message'];
        if (m is String && m.isNotEmpty) msg = m;
        if (m is List && m.isNotEmpty) msg = m.join(' ');
        if (j['code'] is String) codigo = j['code'] as String;
      }
    } catch (_) {/* corpo que não é JSON: fica o status */}
    if (r.statusCode == 429) msg = 'Muitas tentativas seguidas. Espere um minuto.';
    return ApiErro(r.statusCode, msg, codigo);
  }

  /// Uma chamada. `daSessao`: a recusa da sessão (401) ou do celular (revogado) avisa a tela principal.
  static Future<dynamic> _chamar(String metodo, String caminho, {Object? corpo, bool daSessao = true}) async {
    final uri = Uri.parse('$kApiBase$caminho');
    http.Response r;
    try {
      final h = _cabecalhos();
      final b = corpo == null ? null : jsonEncode(corpo);
      r = await switch (metodo) {
        'POST' => cliente.post(uri, headers: h, body: b ?? '{}'),
        'PUT' => cliente.put(uri, headers: h, body: b ?? '{}'),
        _ => cliente.get(uri, headers: h),
      }
          .timeout(_tempo);
    } on TimeoutException {
      throw const ApiErro(0, 'O Regem não respondeu a tempo. Confira a internet do celular.');
    } on SocketException {
      throw const ApiErro(0, 'Sem internet no celular. O app tenta de novo sozinho.');
    } on http.ClientException {
      throw const ApiErro(0, 'Sem conexão com o Regem. O app tenta de novo sozinho.');
    }
    if (r.statusCode >= 200 && r.statusCode < 300) return r.body.isEmpty ? null : jsonDecode(r.body);
    final e = _erro(r);
    if (daSessao && (e.revogado || e.status == 401)) aoPerderAcesso?.call(e);
    throw e;
  }

  // ===================== Pareamento e entrada =====================

  /// "Primeira vez neste aparelho": troca o código de 6 números (Configurações › Equipamentos) pelo segredo do celular.
  static Future<void> parear(String codigo) async {
    final r = await _chamar(
      'POST',
      '/publico/terminal/parear',
      corpo: {
        'codigo': codigo,
        // O "qual aparelho" que a tela Equipamentos mostra.
        'fingerprint': _aparelho(),
        'tipo': 'atendimento',
      },
      daSessao: false,
    ) as Map<String, dynamic>;
    final id = r['terminalId'] as String?;
    final s = r['segredo'] as String?;
    if (id == null || s == null) throw const ApiErro(500, 'O Regem não devolveu o pareamento. Tente de novo.');
    terminalId = id;
    segredo = s;
    await _cofre.write(key: 'terminal_id', value: id);
    await _cofre.write(key: 'terminal_segredo', value: s);
  }

  static String _aparelho() {
    final v = Platform.operatingSystemVersion.replaceAll(RegExp(r'\s+'), ' ').trim();
    final t = '${Platform.isAndroid ? 'Android' : Platform.operatingSystem} · $v';
    return t.length > 120 ? t.substring(0, 120) : t;
  }

  /// "Quem vai atender?": o PIN da pessoa (o mesmo do ponto). Guarda a sessão no cofre.
  static Future<Sessao> entrar(String pin) async {
    final r = await _chamar('POST', '/atendimento/app/entrar', corpo: {'pin': pin}, daSessao: false) as Map<String, dynamic>;
    final s = Sessao.deJson(r);
    if (s == null) throw const ApiErro(500, 'O Regem não devolveu a sessão. Tente de novo.');
    sessao = s;
    await _cofre.write(key: 'sessao', value: jsonEncode(s.toJson()));
    return s;
  }

  /// "Sair": tira da vez na hora (o servidor apaga a situação) e esquece a sessão — o pareamento fica.
  static Future<void> sair() async {
    try {
      await _chamar('POST', '/atendimento/app/sair', daSessao: false);
    } catch (_) {/* sem rede: a situação some sozinha em 3 min */}
    await esquecerSessao();
  }

  // ===================== Disponível / Ocupado =====================

  static Future<Map<String, dynamic>> presenca() async => await _chamar('GET', '/atendimento/app/presenca') as Map<String, dynamic>;

  /// Também é o "ainda estou aqui": o app manda a cada minuto (sem aviso por 3 min, a pessoa sai da vez).
  static Future<Map<String, dynamic>> marcar(String estado, {String? motivo}) async => await _chamar(
        'PUT',
        '/atendimento/app/presenca',
        corpo: {'estado': estado, 'motivo': ?motivo},
      ) as Map<String, dynamic>;

  // ===================== A fila e o caso (as mesmas rotas da tela Atendimento) =====================

  static Future<Map<String, dynamic>> fila() async => await _chamar('GET', '/atendimento/fila') as Map<String, dynamic>;

  static Future<List<dynamic>> resolvidos() async {
    final r = await _chamar('GET', '/atendimento/fila/resolvidos');
    if (r is List) return r;
    if (r is Map && r['casos'] is List) return r['casos'] as List;
    return const [];
  }

  static Future<List<dynamic>> equipe() async => (await _chamar('GET', '/atendimento/equipe') as List?) ?? const [];

  static Future<void> pegar(String id) => _chamar('POST', '/atendimento/$id/pegar');
  static Future<void> passar(String id, String? para) => _chamar('POST', '/atendimento/$id/passar', corpo: {'para': para});
  static Future<void> aguardar(String id, bool aguardando) => _chamar('POST', '/atendimento/$id/aguardar', corpo: {'aguardando': aguardando});
  static Future<void> resolver(String id) => _chamar('POST', '/atendimento/$id/resolver');

  /// Disputa do iFood: `corpo` com `acao` (aceitar | recusar | propor), o motivo, a proposta e o `pin` de quem decide.
  static Future<Map<String, dynamic>> responderDisputa(String id, Map<String, dynamic> corpo) async =>
      await _chamar('POST', '/atendimento/$id/disputa', corpo: corpo) as Map<String, dynamic>;

  /// "Mudar o endereço e avisar o entregador" (o caso do pedido que já saiu — PR 3b-2): `taxa` = 'manter' (a do pedido)
  /// ou 'nova' (a da área nova, que o Regem calculou) — nunca um valor digitado. A resposta diz se mudou na hora
  /// (`situacao: aplicada`), se foi ao servidor da loja (`pedida`) ou se já tinha mudado (`repetido`).
  static Future<Map<String, dynamic>> mudarEnderecoDepoisQueSaiu(String id, String taxa) async =>
      await _chamar('POST', '/atendimento/$id/endereco-depois-que-saiu', corpo: {'taxa': taxa}) as Map<String, dynamic>;

  /// Pedido de cancelamento ou reembolso do cliente da 99: `aceita`, o motivo da lista e o `pin` de quem decide.
  static Future<Map<String, dynamic>> responderPedido99(String id, Map<String, dynamic> corpo) async =>
      await _chamar('POST', '/atendimento/$id/pedido99', corpo: corpo) as Map<String, dynamic>;

  /// A foto `n` que o cliente mandou na disputa (o iFood só entrega com a credencial da loja).
  static Future<Uint8List> fotoDaDisputa(String id, int n) async {
    final h = _cabecalhos()..remove('Content-Type');
    final r = await cliente.get(Uri.parse('$kApiBase/atendimento/$id/foto/$n'), headers: h).timeout(_tempo);
    if (r.statusCode >= 200 && r.statusCode < 300) return r.bodyBytes;
    throw _erro(r);
  }

  // ===================== O chat do iFood/99, o Direct e o Messenger do caso (1.1 — as rotas da tela Atendimento) =====================

  /// A conversa do caso: `parte` = chat | instagram | messenger (`caminhoDaConversa`).
  static Future<Map<String, dynamic>> conversaDoCaso(String id, String parte) async =>
      Map<String, dynamic>.from((await _chamar('GET', '/atendimento/$id/$parte') as Map?) ?? const {});

  /// A resposta da equipe: no chat, entra na fila da ponte do PC da loja; no Direct e no Messenger, sai na hora.
  static Future<void> responderNoCaso(String id, String parte, String texto) =>
      _chamar('POST', '/atendimento/$id/$parte', corpo: {'texto': texto});

  /// O copiloto: o botão aparece com ele LIGADO na empresa e DISPONÍVEL na distribuição.
  static Future<Map<String, dynamic>> copiloto() async =>
      Map<String, dynamic>.from((await _chamar('GET', '/atendimento/copiloto') as Map?) ?? const {});

  /// A sugestão de resposta: volta para o campo — nada é enviado.
  static Future<String> sugerir(String id, List<Map<String, String>> mensagens, List<String> prontas) async {
    final r = await _chamar('POST', '/atendimento/$id/sugestao', corpo: {'mensagens': mensagens, 'prontas': prontas});
    final t = r is Map ? '${r['texto'] ?? ''}'.trim() : '';
    if (t.isEmpty) throw const ApiErro(502, 'O copiloto não trouxe uma sugestão. Tente de novo ou escreva a resposta.');
    return t;
  }

  // ===================== A conversa do WhatsApp (a mesma caixa de Delivery › WhatsApp) =====================

  static Future<List<dynamic>> conversas() async => (await _chamar('GET', '/whatsapp/conversas') as List?) ?? const [];

  static Future<List<dynamic>> mensagens(String jids) async =>
      (await _chamar('GET', '/whatsapp/mensagens?jids=${Uri.encodeQueryComponent(jids)}') as List?) ?? const [];

  static Future<void> enviar(String numero, String texto) => _chamar('POST', '/whatsapp/enviar', corpo: {'jid': numero, 'texto': texto});
}
