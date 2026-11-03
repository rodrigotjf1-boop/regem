import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// OS AVISOS DO APP (caso novo, urgente, "ninguém pegou"). Por enquanto, avisos LOCAIS: o app avisa enquanto está
/// aberto ou acabou de ir para o fundo (o Android segue rodando o app por um tempo). Com o celular parado há muito
/// tempo, o aviso chega quando o app volta — o "toque com o app fechado" vem com o push (Firebase), depois que o dono
/// criar o projeto (plano da Onda 2).
class Avisos {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _pronto = false;
  static int _id = 0;

  /// Os testes escutam o que seria avisado (o plugin não existe no teste).
  static void Function(String titulo, String texto, bool urgente)? espiao;

  static Future<void> iniciar() async {
    try {
      await _plugin.initialize(settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')));
      // Android 13+: pede a permissão de avisar na primeira vez (a pessoa pode negar — o app segue, sem som).
      await _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.requestNotificationsPermission();
      _pronto = true;
    } catch (_) {
      _pronto = false; // sem avisos neste aparelho: a fila continua na tela
    }
  }

  /// `urgente`: cliente chateado ou "ninguém pegou" — canal de importância máxima.
  static Future<void> mostrar(String titulo, String texto, {bool urgente = false}) async {
    espiao?.call(titulo, texto, urgente);
    if (!_pronto) return;
    final android = AndroidNotificationDetails(
      urgente ? 'atendimento_urgente' : 'atendimento',
      urgente ? 'Atendimento urgente' : 'Atendimento',
      channelDescription: urgente ? 'Cliente chateado ou caso que ninguém pegou' : 'Caso novo na fila',
      importance: urgente ? Importance.max : Importance.high,
      priority: Priority.high,
      category: AndroidNotificationCategory.message,
    );
    try {
      await _plugin.show(id: ++_id, title: titulo, body: texto, notificationDetails: NotificationDetails(android: android));
    } catch (_) {/* o aviso não pode derrubar a fila */}
  }
}
