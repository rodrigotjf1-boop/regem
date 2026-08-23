import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import 'package:permission_handler/permission_handler.dart';
import '../api.dart';

class ScannerScreen extends StatefulWidget {
  const ScannerScreen({super.key});

  @override
  State<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<ScannerScreen> {
  // No mobile_scanner 7.x o PRÓPRIO widget MobileScanner inicia a câmera (autoStart)
  // e cuida do ciclo de vida (resume/pause) — não chamamos start()/stop() na mão.
  MobileScannerController? _controller;
  bool _processando = false;
  // null = verificando permissão; true = liberada; false = negada.
  bool? _permitida;
  bool _negadaDeVez = false; // permanentemente negada → mandar pras configurações

  @override
  void initState() {
    super.initState();
    _pedirPermissao();
  }

  // Pede a câmera ANTES de montar o MobileScanner (evita a corrida de o widget tentar
  // iniciar antes do "permitir"). O preview preto anterior era da 5.x no Flutter novo
  // (Impeller) — resolvido subindo o mobile_scanner p/ 7.x.
  Future<void> _pedirPermissao() async {
    final status = await Permission.camera.request();
    if (!mounted) return;
    if (status.isGranted) {
      setState(() {
        _controller = MobileScannerController(
          detectionSpeed: DetectionSpeed.noDuplicates,
          facing: CameraFacing.back,
        );
        _permitida = true;
      });
    } else {
      setState(() {
        _permitida = false;
        _negadaDeVez = status.isPermanentlyDenied;
      });
    }
  }

  @override
  void dispose() {
    _controller?.dispose();
    super.dispose();
  }

  Future<void> _detectou(BarcodeCapture cap) async {
    if (_processando) return;
    final code = cap.barcodes.isNotEmpty ? cap.barcodes.first.rawValue : null;
    if (code == null || code.isEmpty) return;
    setState(() => _processando = true);
    try {
      final r = await Api.scan(code);
      if (!mounted) return;
      final ped = r['pedido'] as Map<String, dynamic>?;
      final ja = r['jaFeito'] == true;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(ja
              ? 'Pedido já estava em rota.'
              : 'Pedido #${ped?['numero'] ?? ''} assumido!'),
        ),
      );
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Colors.red,
        ),
      );
      setState(() => _processando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Escanear cupom')),
      body: _corpo(),
    );
  }

  Widget _corpo() {
    // Permissão negada: explica e oferece o caminho pras configurações.
    if (_permitida == false) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.no_photography, size: 48),
              const SizedBox(height: 12),
              Text(
                _negadaDeVez
                    ? 'A câmera está bloqueada para o app. Abra as configurações e permita o acesso à câmera.'
                    : 'Precisamos da câmera para ler o QR do cupom.',
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 16),
              if (_negadaDeVez)
                FilledButton.icon(
                  onPressed: openAppSettings,
                  icon: const Icon(Icons.settings),
                  label: const Text('Abrir configurações'),
                )
              else
                FilledButton.icon(
                  onPressed: () {
                    setState(() => _permitida = null);
                    _pedirPermissao();
                  },
                  icon: const Icon(Icons.camera_alt),
                  label: const Text('Permitir câmera'),
                ),
            ],
          ),
        ),
      );
    }

    // Verificando permissão / preparando câmera.
    if (_controller == null) {
      return const Center(child: CircularProgressIndicator());
    }

    return Stack(
      children: [
        MobileScanner(controller: _controller, onDetect: _detectou),
        if (_processando)
          const ColoredBox(
            color: Colors.black45,
            child: Center(child: CircularProgressIndicator()),
          ),
        const Align(
          alignment: Alignment.bottomCenter,
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Text(
              'Aponte para o QR do cupom do entregador',
              style: TextStyle(color: Colors.white, backgroundColor: Colors.black54),
            ),
          ),
        ),
      ],
    );
  }
}
