import 'package:url_launcher/url_launcher.dart';

/// Abre um link FORA do app — a mensagem pronta no WhatsApp do entregador (`wa.me`). Os testes trocam por um espião
/// (no teste não há o Android para abrir o link).
class Abrir {
  static Future<bool> Function(Uri link) link = (u) => launchUrl(u, mode: LaunchMode.externalApplication);
}
