import 'dart:async';
import 'package:geolocator/geolocator.dart';
import 'api.dart';

/// Envia a localização durante a ENTREGA ATIVA (LGPD: pede a permissão em
/// contexto, ao iniciar entregas). Para quando não há mais entregas.
class LocationSender {
  static Timer? _timer;

  static Future<bool> _garantirPermissao() async {
    if (!await Geolocator.isLocationServiceEnabled()) return false;
    var p = await Geolocator.checkPermission();
    if (p == LocationPermission.denied) {
      p = await Geolocator.requestPermission();
    }
    return p == LocationPermission.always || p == LocationPermission.whileInUse;
  }

  static Future<void> _tick() async {
    try {
      final pos = await Geolocator.getCurrentPosition();
      await Api.enviarLocalizacao(pos.latitude, pos.longitude, precisao: pos.accuracy);
    } catch (_) {
      // silencioso — não atrapalha a entrega
    }
  }

  /// Começa a enviar (a cada 20s) se houver permissão. Idempotente.
  static Future<void> iniciar() async {
    if (_timer != null) return;
    if (!await _garantirPermissao()) return;
    await _tick();
    _timer = Timer.periodic(const Duration(seconds: 20), (_) => _tick());
  }

  static void parar() {
    _timer?.cancel();
    _timer = null;
  }
}
