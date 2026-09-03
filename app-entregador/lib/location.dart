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
  static Timer? _pulso; // pulso periódico com getCurrentPosition (fallback do stream)

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

  /// Uma leitura PONTUAL da posição (p/ pedir a rota in-app ao backend). Tenta a atual com
  /// timeout curto; cai na última conhecida; null se sem permissão/indisponível. Não liga o
  /// stream de envio — é só para mandar o ponto de partida da rota.
  static Future<Position?> posicaoAtual() async {
    try {
      if (!await _garantirPermissao()) return await Geolocator.getLastKnownPosition();
      return await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      ).timeout(const Duration(seconds: 6));
    } catch (_) {
      try {
        return await Geolocator.getLastKnownPosition();
      } catch (_) {
        return null;
      }
    }
  }

  /// Começa a enviar (a cada 10s, inclusive em 2º plano no Android) se houver permissão.
  /// Idempotente.
  static Future<void> iniciar() async {
    if (_sub != null || _pulso != null) return;
    if (!await _garantirPermissao()) return;
    // PULSO periódico com getCurrentPosition (localização fundida — funciona mesmo onde o
    // getPositionStream de alta precisão + foreground service NÃO emite, ex.: Android 14/15).
    // Garante atualização a cada 12s COM O APP ABERTO — antes o app postava só a posição inicial
    // e parava, o rastreio envelhecia (10 min) e sumia. O stream abaixo dá updates mais finos +
    // 2º plano quando o foreground service sobe.
    Future<void> pulsar() async {
      final p = await posicaoAtual();
      if (p != null) {
        Api.enviarLocalizacao(p.latitude, p.longitude, precisao: p.accuracy);
      }
    }

    pulsar(); // imediata
    _pulso = Timer.periodic(const Duration(seconds: 12), (_) => pulsar());
    _sub = Geolocator.getPositionStream(locationSettings: _settings()).listen(
      (pos) {
        Api.enviarLocalizacao(pos.latitude, pos.longitude, precisao: pos.accuracy);
      },
      // Stream morreu (erro do provedor / foreground service / SO): zera _sub p/ reabrir no
      // próximo iniciar(). O pulso acima continua postando enquanto isso.
      onError: (_) {
        _sub?.cancel();
        _sub = null;
      },
      cancelOnError: true,
    );
  }

  static void parar() {
    _sub?.cancel();
    _sub = null;
    _pulso?.cancel();
    _pulso = null;
  }
}
