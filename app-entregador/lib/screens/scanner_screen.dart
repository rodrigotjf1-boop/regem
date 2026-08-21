import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';
import '../api.dart';

class ScannerScreen extends StatefulWidget {
  const ScannerScreen({super.key});

  @override
  State<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<ScannerScreen> {
  bool _processando = false;

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
      body: Stack(
        children: [
          MobileScanner(onDetect: _detectou),
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
      ),
    );
  }
}
