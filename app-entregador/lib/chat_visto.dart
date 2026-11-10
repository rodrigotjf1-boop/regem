import 'dart:math';
import 'package:shared_preferences/shared_preferences.dart';

/// O que o entregador já viu do chat de cada pedido (09/11/2026): a hora da última fala do CLIENTE que ele viu. A lista e
/// a tela do pedido marcam "o cliente escreveu" quando chega uma fala mais nova. Guardado só no aparelho (é conveniência
/// da tela, não dado de negócio); pedidos de mais de 2 dias saem para a chave não crescer.
class ChatVisto {
  static const _prefixo = 'chat_visto_v1:';

  static Future<DateTime?> ultima(String pedidoId) async {
    final p = await SharedPreferences.getInstance();
    final s = p.getString('$_prefixo$pedidoId');
    return s == null ? null : DateTime.tryParse(s);
  }

  static Future<void> marcar(String pedidoId, DateTime em) async {
    final p = await SharedPreferences.getInstance();
    await p.setString('$_prefixo$pedidoId', em.toUtc().toIso8601String());
    // limpeza: tira as marcas velhas
    final limite = DateTime.now().toUtc().subtract(const Duration(days: 2));
    for (final k in p.getKeys().where((k) => k.startsWith(_prefixo))) {
      final d = DateTime.tryParse(p.getString(k) ?? '');
      if (d == null || d.isBefore(limite)) await p.remove(k);
    }
  }

  /// A fala do cliente (`{texto, em}`) é nova para o entregador?
  static Future<bool> temNova(String pedidoId, dynamic ultimaDoCliente) async {
    if (ultimaDoCliente is! Map) return false;
    final em = DateTime.tryParse('${ultimaDoCliente['em'] ?? ''}');
    if (em == null) return false;
    final visto = await ultima(pedidoId);
    return visto == null || em.isAfter(visto);
  }
}

/// Um id v4 para a mensagem (o servidor usa para o reenvio não duplicar).
String novoIdDeMensagem() {
  final r = Random.secure();
  final b = List<int>.generate(16, (_) => r.nextInt(256));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  String h(int i) => b[i].toRadixString(16).padLeft(2, '0');
  final s = List.generate(16, h).join();
  return '${s.substring(0, 8)}-${s.substring(8, 12)}-${s.substring(12, 16)}-${s.substring(16, 20)}-${s.substring(20)}';
}
