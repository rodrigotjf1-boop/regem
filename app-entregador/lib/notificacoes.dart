import 'package:flutter_local_notifications/flutter_local_notifications.dart';

/// OS AVISOS DO ATENDIMENTO NO CELULAR (mig 391, 10/11/2026): o cliente perguntando pelo pedido, reclamando da demora, o
/// atendimento encaminhando um problema. Avisos LOCAIS (o mesmo pacote do app de atendimento): o app pede os avisos a
/// cada volta enquanto está aberto ou em segundo plano — durante a entrega o serviço de localização mantém o app vivo,
/// então o aviso toca com o celular no bolso. Com o app fechado de vez, o aviso aparece quando ele abre (o push pelo
/// Firebase fica para depois).
class Notificacoes {
  static final _plugin = FlutterLocalNotificationsPlugin();
  static bool _pronto = false;
  static int _id = 0;

  static Future<void> iniciar() async {
    try {
      await _plugin.initialize(settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')));
      // Android 13+: pede a permissão de avisar na primeira vez (o entregador pode negar — o app segue, só sem o toque).
      await _plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.requestNotificationsPermission();
      _pronto = true;
    } catch (_) {
      _pronto = false; // sem notificação neste aparelho: o aviso continua na tela do app
    }
  }

  static Future<void> mostrar(String titulo, String texto) async {
    if (!_pronto) return;
    const android = AndroidNotificationDetails(
      'avisos_atendimento',
      'Avisos do atendimento',
      channelDescription: 'O cliente perguntando pelo pedido, reclamando da demora ou um recado do atendimento',
      importance: Importance.max,
      priority: Priority.high,
      category: AndroidNotificationCategory.message,
    );
    try {
      await _plugin.show(id: ++_id, title: titulo, body: texto, notificationDetails: const NotificationDetails(android: android));
    } catch (_) {/* a notificação não pode derrubar a lista */}
  }
}
