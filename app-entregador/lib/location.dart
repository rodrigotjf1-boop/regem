import 'dart:async';
import 'dart:io';
import 'package:geolocator/geolocator.dart';
// AndroidSettings/AppleSettings/ForegroundNotificationConfig não vêm do pacote principal.
import 'package:geolocator_android/geolocator_android.dart';
import 'package:geolocator_apple/geolocator_apple.dart';
import 'api.dart';

/// Envia a localização durante a ENTREGA ATIVA (LGPD: permissão pedida em contexto, ao
/// iniciar entregas). No Android usa FOREGROUND SERVICE → continua enviando com a tela
/// apagada / app em 2º plano (antes parava, com `Timer.periodic` o SO suspendia). Para
/// quando não há mais entregas.
class LocationSender {
  static StreamSubscription<Position>? _sub;

  static Future<bool> _garantirPermissao() async {
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) {
      p = await Geolocator.requestPermission();
    }
    // whileInUse já permite começar; o foreground service estende pro 2º plano. Se o
    // entregador conceder "Permitir o tempo todo" (always), o Android mantém a precisão
    // mesmo com o app fechado. Recusou de vez → não envia.
    return p == LocationPermission.always || p == LocationPermission.whileInUse;
  }

  // Envia a cada 10s (inclusive em 2º plano no Android, via foreground service).
  static LocationSettings _settings() {
    if (Platform.isAndroid) {
      return AndroidSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 0,
        intervalDuration: const Duration(seconds: 10),
        foregroundNotificationConfig: const ForegroundNotificationConfig(
          notificationTitle: 'Entrega em andamento',
          notificationText: 'Compartilhando sua localização durante a entrega.',
          enableWakeLock: true,
        ),
      );
    }
    if (Platform.isIOS) {
      return AppleSettings(
        accuracy: LocationAccuracy.high,
        distanceFilter: 0,
        allowBackgroundLocationUpdates: true,
        pauseLocationUpdatesAutomatically: false,
        showBackgroundLocationIndicator: true,
      );
    }
    return const LocationSettings(accuracy: LocationAccuracy.high, distanceFilter: 0);
  }

  /// Começa a enviar (a cada 10s, inclusive em 2º plano no Android) se houver permissão.
  /// Idempotente.
  static Future<void> iniciar() async {
    if (_sub != null) return;
    if (!await _garantirPermissao()) return;
    _sub = Geolocator.getPositionStream(locationSettings: _settings()).listen(
      (pos) {
        Api.enviarLocalizacao(pos.latitude, pos.longitude, precisao: pos.accuracy);
      },
      onError: (_) {}, // silencioso — não atrapalha a entrega
    );
  }

  static void parar() {
    _sub?.cancel();
    _sub = null;
  }
}
