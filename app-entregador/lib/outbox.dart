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
/// Só entra aqui o que PODE esperar: o código da loja (já conferido pelo hash no aparelho) e
/// o código da 99 (conferido na 99 ao voltar o sinal). O do iFood só vale online — nem entra.
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

  static Future<void> enfileirar(String pedidoId, String? codigo,
      {Object? numero, String? canal}) async {
    final itens = await _ler();
    // Mesmo pedido de novo (o entregador corrigiu o código): vale o último digitado.
    itens.removeWhere((e) => e['pedidoId'] == pedidoId);
    itens.add({
      'pedidoId': pedidoId,
      'codigo': codigo,
      'numero': numero?.toString(),
      'canal': canal,
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
  ///  • fica — sem rede, 5xx, 408, 429: tenta de novo depois.
  static Future<ResultadoEnvio> flush({
    Future<Map<String, dynamic>> Function(String pedidoId, String? codigo)? enviar,
  }) async {
    final envia = enviar ?? (String id, String? cod) => Api.finalizar(id, codigo: cod);
    final itens = await _ler();
    if (itens.isEmpty) return const ResultadoEnvio(0, []);
    final restantes = <Map<String, dynamic>>[];
    final recusadas = <Map<String, dynamic>>[];
    var confirmadas = 0;
    for (final e in itens) {
      try {
        final r = await envia(e['pedidoId'] as String, e['codigo'] as String?);
        if (r['valid'] == false) {
          recusadas.add({...e, 'motivo': r['msg']?.toString() ?? 'Código recusado.'});
        } else {
          confirmadas++;
        }
      } on ApiErro catch (err) {
        if (err.recusa) {
          recusadas.add({...e, 'motivo': err.mensagem});
        } else {
          restantes.add(e);
        }
      } catch (err) {
        restantes.add(e); // sem rede ou falha desconhecida → tenta de novo depois
      }
    }
    await _salvar(restantes);
    return ResultadoEnvio(confirmadas, recusadas);
  }
}
