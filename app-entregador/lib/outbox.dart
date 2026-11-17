import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';

/// Resultado de um reenvio da fila: quantas entregas o servidor confirmou e quais foram
/// RECUSADAS (código errado, pedido fora de rota…) — estas o entregador precisa saber.
class ResultadoEnvio {
  final int confirmadas;
  final List<Map<String, dynamic>> recusadas; // { pedidoId, numero, canal, motivo }
  const ResultadoEnvio(this.confirmadas, this.recusadas);
}

/// Fila local (offline-first) das entregas marcadas SEM conexão. Cada item guarda o
/// pedido + o código digitado; ao reconectar, `flush()` reenvia. Idempotente: o
/// backend não refaz nem volta ao canal se o pedido já estiver entregue.
///
/// Só entra aqui o que PODE esperar: o código da loja (já conferido pelo hash no aparelho) e o código
/// da 99 que bate com os 4 últimos números do telefone do cliente (conferido no aparelho; a 99 confirma
/// ao voltar o sinal — ERR-427). O do iFood e o da 99 que não bate só valem online — nem entram.
class Outbox {
  static const _key = 'outbox_entregue_v1';

  static Future<List<Map<String, dynamic>>> _ler() async {
    final p = await SharedPreferences.getInstance();
    final s = p.getString(_key);
    if (s == null || s.isEmpty) return [];
    try {
      return (jsonDecode(s) as List).map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> _salvar(List<Map<String, dynamic>> itens) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_key, jsonEncode(itens));
  }

  static Future<int> pendentes() async => (await _ler()).length;

  static Future<Set<String>> pendentesIds() async =>
      (await _ler()).map((e) => e['pedidoId'] as String).toSet();

  static Future<bool> temPendente(String pedidoId) async =>
      (await _ler()).any((e) => e['pedidoId'] == pedidoId);

  /// `local` = a posição do TOQUE no "Entregue" (pedido sem código): vai junto ao reenviar, para o servidor
  /// conferir onde o entregador estava quando marcou — não onde ele está quando o sinal volta.
  static Future<void> enfileirar(String pedidoId, String? codigo,
      {Object? numero, String? canal, Map<String, dynamic>? local}) async {
    final itens = await _ler();
    // Mesmo pedido de novo (o entregador corrigiu o código): vale o último digitado.
    itens.removeWhere((e) => e['pedidoId'] == pedidoId);
    itens.add({
      'pedidoId': pedidoId,
      'codigo': codigo,
      'numero': numero?.toString(),
      'canal': canal,
      if (local != null) 'local': local,
      'ts': DateTime.now().toIso8601String(),
    });
    await _salvar(itens);
  }

  static bool ehErroDeRede(String msg) =>
      msg.contains('SocketException') ||
      msg.contains('Failed host lookup') ||
      msg.contains('Connection') ||
      msg.contains('timed out') ||
      msg.contains('TimeoutException') ||
      msg.contains('Network is unreachable') ||
      msg.contains('ClientException');

  /// Reenvia tudo. Três destinos para cada item:
  ///  • CONFIRMADA — o servidor aceitou (inclusive "já estava entregue") → sai da fila;
  ///  • RECUSADA — `{valid:false}` ou erro 4xx: reenviar não adianta → sai da fila e volta na
  ///    lista de recusadas, para o app AVISAR o entregador (o pedido segue em rota). Antes a
  ///    recusa sumia calada: 200 com `valid:false` contava como entregue (LIC-073) e o 4xx era
  ///    descartado (LIC-039);
  ///  • fica — sem rede, 5xx, 401 (a sessão venceu: sai depois do novo login), 408, 429: tenta de novo depois.
  ///
  /// UM reenvio por vez (revisão de 17/11/2026): abrir o app e duas trocas de conexão seguidas (Wi-Fi → 4G) disparavam
  /// reenvios juntos — quem chama durante um reenvio recebe o MESMO resultado. E o fim do reenvio grava por cima da fila
  /// de AGORA, não da cópia lida no começo: a entrega guardada sem sinal durante o reenvio sumia.
  static Future<ResultadoEnvio>? _emCurso;

  static Future<ResultadoEnvio> flush({
    Future<Map<String, dynamic>> Function(String pedidoId, String? codigo, Map<String, dynamic>? local)? enviar,
  }) {
    final atual = _emCurso;
    if (atual != null) return atual;
    final f = _reenviar(enviar).whenComplete(() => _emCurso = null);
    _emCurso = f;
    return f;
  }

  /// A identidade de um item da fila: o pedido e a hora em que foi guardado (o mesmo pedido guardado de novo é outro).
  static String _chave(Map<String, dynamic> e) => '${e['pedidoId']}|${e['ts']}';

  static Future<ResultadoEnvio> _reenviar(
    Future<Map<String, dynamic>> Function(String pedidoId, String? codigo, Map<String, dynamic>? local)? enviar,
  ) async {
    final envia = enviar ??
        (String id, String? cod, Map<String, dynamic>? local) => Api.finalizar(id, codigo: cod, local: local);
    final itens = await _ler();
    if (itens.isEmpty) return const ResultadoEnvio(0, []);
    final tratados = <String>{}; // confirmados e recusados: saem da fila
    final recusadas = <Map<String, dynamic>>[];
    var confirmadas = 0;
    for (final e in itens) {
      try {
        final local = e['local'];
        final r = await envia(
          e['pedidoId'] as String,
          e['codigo'] as String?,
          local is Map ? Map<String, dynamic>.from(local) : null,
        );
        if (r['valid'] == false) {
          recusadas.add({...e, 'motivo': r['msg']?.toString() ?? 'Código recusado.'});
        } else {
          confirmadas++;
        }
        tratados.add(_chave(e));
      } on ApiErro catch (err) {
        if (err.recusa) {
          recusadas.add({...e, 'motivo': err.mensagem});
          tratados.add(_chave(e));
        }
        // o resto (5xx, 401, 408, 429) fica para tentar de novo depois
      } catch (err) {
        // sem rede ou falha desconhecida → fica para tentar de novo depois
      }
    }
    final agora = await _ler();
    await _salvar(agora.where((e) => !tratados.contains(_chave(e))).toList());
    return ResultadoEnvio(confirmadas, recusadas);
  }
}
