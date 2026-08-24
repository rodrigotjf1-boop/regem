import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'api.dart';

/// Fila local (offline-first) das entregas marcadas SEM conexão. Cada item guarda o
/// pedido + o código digitado; ao reconectar, `flush()` reenvia. Idempotente: o
/// backend (marcarEntregue) não duplica se o pedido já estiver entregue.
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

  static Future<bool> temPendente(String pedidoId) async =>
      (await _ler()).any((e) => e['pedidoId'] == pedidoId);

  static Future<void> enfileirar(String pedidoId, String? codigo) async {
    final itens = await _ler();
    if (itens.any((e) => e['pedidoId'] == pedidoId)) return; // não duplica
    itens.add({
      'pedidoId': pedidoId,
      'codigo': codigo,
      'ts': DateTime.now().toIso8601String(),
    });
    await _salvar(itens);
  }

  static bool _ehErroDeRede(String msg) =>
      msg.contains('SocketException') ||
      msg.contains('Failed host lookup') ||
      msg.contains('Connection') ||
      msg.contains('timed out') ||
      msg.contains('Network is unreachable') ||
      msg.contains('ClientException');

  /// Tenta reenviar todos. Sucesso ou erro de NEGÓCIO (código inválido/já concluído) →
  /// remove (não adianta reenviar). Erro de REDE → mantém pra próxima. Retorna quantos saíram.
  static Future<int> flush() async {
    final itens = await _ler();
    if (itens.isEmpty) return 0;
    final restantes = <Map<String, dynamic>>[];
    var enviados = 0;
    for (final e in itens) {
      try {
        await Api.finalizar(e['pedidoId'] as String, codigo: e['codigo'] as String?);
        enviados++;
      } catch (err) {
        if (_ehErroDeRede(err.toString())) {
          restantes.add(e); // ainda offline → tenta depois
        }
        // erro de negócio → descarta (o offline já validou o código pelo hash)
      }
    }
    await _salvar(restantes);
    return enviados;
  }
}
