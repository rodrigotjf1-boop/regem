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
  // UM envio por vez e sem repetir (revisão de 17/11/2026): o stream (10 s) e o pulso (12 s) mandavam os dois — ~11
  // envios por minuto — e, no 4G ruim, os envios presos se empilhavam. Agora o pulso só manda quando o stream ficou
  // mais de 9 s calado, e um envio novo espera o anterior voltar.
  static DateTime? _ultimoEnvio;
  static bool _enviando = false;

  static Future<void> _enviar(double lat, double lng, double? precisao) async {
    if (_enviando) return;
    _enviando = true;
    _ultimoEnvio = DateTime.now();
    try {
      await Api.enviarLocalizacao(lat, lng, precisao: precisao);
    } finally {
      _enviando = false;
    }
  }

  static bool get _streamRecente =>
      _ultimoEnvio != null && DateTime.now().difference(_ultimoEnvio!) < const Duration(seconds: 9);

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
      if (_streamRecente) return; // o stream está mandando: não gasta GPS nem dados de novo
      final p = await posicaoAtual();
      if (p != null) await _enviar(p.latitude, p.longitude, p.accuracy);
    }

    pulsar(); // imediata
    _pulso = Timer.periodic(const Duration(seconds: 12), (_) => pulsar());
    _sub = Geolocator.getPositionStream(locationSettings: _settings()).listen(
      (pos) {
        _enviar(pos.latitude, pos.longitude, pos.accuracy);
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
