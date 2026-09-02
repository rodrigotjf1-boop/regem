import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api.dart';
import '../location.dart';

/// Mostra a NOSSA rota (OSRM) do entregador até o destino do pedido num mapa dentro do app
/// (OpenStreetMap), com ETA e distância. O botão "Navegar" abre o Google Maps/Waze para a
/// direção por voz enquanto dirige. Se o OSRM estiver fora, mostra só os marcadores.
class RotaScreen extends StatefulWidget {
  final Map<String, dynamic> pedido;
  const RotaScreen({super.key, required this.pedido});

  @override
  State<RotaScreen> createState() => _RotaScreenState();
}

class _RotaScreenState extends State<RotaScreen> {
  final _map = MapController();
  bool _carregando = true;
  String? _erro;
  LatLng? _destino;
  LatLng? _origem;
  List<LatLng> _tracado = [];
  int? _etaMin;
  int? _distanciaM;

  static const _ouro = Color(0xFFE2A340);
  static const _navy = Color(0xFF0F2230);

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() {
      _carregando = true;
      _erro = null;
    });
    try {
      final pos = await LocationSender.posicaoAtual();
      final r = await Api.rota(
        widget.pedido['id'] as String,
        lat: pos?.latitude,
        lng: pos?.longitude,
      );
      final dest = r['destino'] as Map<String, dynamic>?;
      final from = r['from'] as Map<String, dynamic>?;
      final rota = r['rota'] as Map<String, dynamic>?;
      if (dest == null) {
        setState(() {
          _erro = 'Endereço do pedido sem coordenadas.';
          _carregando = false;
        });
        return;
      }
      final destino = LatLng((dest['lat'] as num).toDouble(), (dest['lng'] as num).toDouble());
      final origem = from != null
          ? LatLng((from['lat'] as num).toDouble(), (from['lng'] as num).toDouble())
          : (pos != null ? LatLng(pos.latitude, pos.longitude) : null);
      final tracado = (rota != null && rota['geometry'] != null)
          ? _decodePolyline6(rota['geometry'].toString())
          : <LatLng>[];
      setState(() {
        _destino = destino;
        _origem = origem;
        _tracado = tracado;
        _etaMin = (rota?['duracaoMin'] as num?)?.round();
        _distanciaM = (rota?['distanciaM'] as num?)?.round();
        _carregando = false;
      });
      _enquadrar();
    } catch (e) {
      setState(() {
        _erro = e.toString().replaceFirst('Exception: ', '');
        _carregando = false;
      });
    }
  }

  void _enquadrar() {
    final pts = <LatLng>[
      if (_origem != null) _origem!,
      if (_destino != null) _destino!,
      ..._tracado,
    ];
    if (pts.isEmpty) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      try {
        if (pts.length == 1) {
          _map.move(pts.first, 15);
        } else {
          _map.fitCamera(CameraFit.coordinates(
            coordinates: pts,
            padding: const EdgeInsets.all(48),
            maxZoom: 16,
          ));
        }
      } catch (_) {/* mapa ainda não montou — ignora */}
    });
  }

  // Decodifica polyline6 (OSRM geometries=polyline6) → lista de LatLng, p/ desenhar no mapa.
  List<LatLng> _decodePolyline6(String str) {
    final coords = <LatLng>[];
    int index = 0, lat = 0, lng = 0;
    while (index < str.length) {
      int b, shift = 0, result = 0;
      do {
        b = str.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
      shift = 0;
      result = 0;
      do {
        b = str.codeUnitAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += (result & 1) != 0 ? ~(result >> 1) : (result >> 1);
      coords.add(LatLng(lat / 1e6, lng / 1e6));
    }
    return coords;
  }

  Future<void> _navegar() async {
    final end = widget.pedido['endereco']?.toString().trim();
    final Uri uri;
    if (_destino != null) {
      // Coordenadas do destino = preciso; o seletor do sistema oferece Google Maps/Waze.
      uri = Uri.parse(
        'https://www.google.com/maps/dir/?api=1&destination=${_destino!.latitude},${_destino!.longitude}&travelmode=driving',
      );
    } else if (end != null && end.isNotEmpty) {
      uri = Uri.parse(
        'https://www.google.com/maps/dir/?api=1&destination=${Uri.encodeComponent(end)}&travelmode=driving',
      );
    } else {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Pedido sem destino para navegar.')),
      );
      return;
    }
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Não foi possível abrir o mapa.')),
      );
    }
  }

  String _fmtKm(int m) => m >= 1000 ? '${(m / 1000).toStringAsFixed(1)} km' : '$m m';

  @override
  Widget build(BuildContext context) {
    final p = widget.pedido;
    final endereco = p['endereco']?.toString() ?? '';
    return Scaffold(
      appBar: AppBar(title: Text('Rota · Pedido #${p['numero'] ?? ''}')),
      body: Column(
        children: [
          if (!_carregando && _erro == null)
            Container(
              width: double.infinity,
              color: const Color(0xFFF8ECD6),
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
              child: Row(
                children: [
                  const Icon(Icons.motorcycle, color: _navy),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          _etaMin != null
                              ? '~$_etaMin min${_distanciaM != null ? ' · ${_fmtKm(_distanciaM!)}' : ''}'
                              : 'Rota indisponível agora — siga pelos marcadores',
                          style: const TextStyle(fontWeight: FontWeight.bold, color: _navy),
                        ),
                        if (endereco.isNotEmpty)
                          Text(
                            endereco,
                            style: const TextStyle(fontSize: 12.5, color: _navy),
                          ),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          Expanded(
            child: _carregando
                ? const Center(child: CircularProgressIndicator())
                : _erro != null
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Column(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.map_outlined, size: 40, color: Colors.grey),
                              const SizedBox(height: 8),
                              Text(_erro!, textAlign: TextAlign.center),
                              const SizedBox(height: 12),
                              OutlinedButton(
                                onPressed: _carregar,
                                child: const Text('Tentar de novo'),
                              ),
                            ],
                          ),
                        ),
                      )
                    : FlutterMap(
                        mapController: _map,
                        options: MapOptions(
                          initialCenter: _destino ?? const LatLng(-14.235, -51.925),
                          initialZoom: _destino != null ? 14 : 4,
                        ),
                        children: [
                          TileLayer(
                            urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                            userAgentPackageName: 'com.dmsregem.regem_entregador',
                            maxZoom: 19,
                          ),
                          if (_tracado.isNotEmpty)
                            PolylineLayer(
                              polylines: [
                                Polyline(points: _tracado, color: _ouro, strokeWidth: 5),
                              ],
                            ),
                          MarkerLayer(
                            markers: [
                              if (_origem != null)
                                Marker(
                                  point: _origem!,
                                  width: 40,
                                  height: 40,
                                  child: const _Badge(
                                    cor: _ouro,
                                    child: Text('🛵', style: TextStyle(fontSize: 18)),
                                  ),
                                ),
                              if (_destino != null)
                                Marker(
                                  point: _destino!,
                                  width: 40,
                                  height: 40,
                                  child: const _Badge(
                                    cor: _navy,
                                    child: Icon(Icons.location_on, color: Colors.white, size: 20),
                                  ),
                                ),
                            ],
                          ),
                        ],
                      ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: FilledButton.icon(
                onPressed: _navegar,
                icon: const Icon(Icons.navigation),
                label: const Padding(
                  padding: EdgeInsets.all(10),
                  child: Text('Navegar (Google Maps / Waze)'),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _Badge extends StatelessWidget {
  final Color cor;
  final Widget child;
  const _Badge({required this.cor, required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: cor,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2),
        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 4)],
      ),
      alignment: Alignment.center,
      child: child,
    );
  }
}
