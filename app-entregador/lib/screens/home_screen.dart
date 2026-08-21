import 'package:flutter/material.dart';
import '../api.dart';
import 'login_screen.dart';
import 'scanner_screen.dart';
import 'pedido_screen.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  Map<String, dynamic>? _perfil;
  List<dynamic> _pedidos = [];
  String? _erro;
  bool _carregando = true;

  @override
  void initState() {
    super.initState();
    _carregar();
  }

  Future<void> _carregar() async {
    setState(() => _erro = null);
    try {
      final p = await Api.perfil();
      final peds = await Api.pedidos();
      if (mounted) {
        setState(() {
          _perfil = p;
          _pedidos = peds;
          _carregando = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _erro = e.toString().replaceFirst('Exception: ', '');
          _carregando = false;
        });
      }
    }
  }

  Future<void> _escanear() async {
    final ok = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => const ScannerScreen()),
    );
    if (ok == true) _carregar();
  }

  Future<void> _abrir(Map<String, dynamic> ped) async {
    final ok = await Navigator.push<bool>(
      context,
      MaterialPageRoute(builder: (_) => PedidoScreen(pedido: ped)),
    );
    if (ok == true) _carregar();
  }

  Future<void> _sair() async {
    await Api.sair();
    if (mounted) {
      Navigator.pushReplacement(
        context,
        MaterialPageRoute(builder: (_) => const LoginScreen()),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Meus pedidos'),
        actions: [
          IconButton(onPressed: _sair, icon: const Icon(Icons.logout)),
        ],
      ),
      body: RefreshIndicator(onRefresh: _carregar, child: _corpo()),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _escanear,
        icon: const Icon(Icons.qr_code_scanner),
        label: const Text('Escanear'),
      ),
    );
  }

  Widget _corpo() {
    if (_carregando) {
      return const Center(child: CircularProgressIndicator());
    }
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (_erro != null)
          Card(
            color: Colors.red.withValues(alpha: 0.08),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Text(_erro!, style: const TextStyle(color: Colors.red)),
            ),
          ),
        if (_perfil != null) ...[
          Text('Olá, ${_perfil!['nome'] ?? 'entregador'}',
              style: Theme.of(context).textTheme.titleMedium),
          if (_perfil!['ehEntregador'] != true)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Sua conta não está marcada como "entregador". Peça ao gestor.',
                style: TextStyle(color: Colors.orange.shade800),
              ),
            ),
          const SizedBox(height: 16),
        ],
        if (_pedidos.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 48),
            child: Center(
              child: Text(
                'Nenhum pedido em rota.\nEscaneie o cupom para assumir uma entrega.',
                textAlign: TextAlign.center,
              ),
            ),
          )
        else
          ..._pedidos.map((p) {
            final m = p as Map<String, dynamic>;
            return Card(
              child: ListTile(
                leading: const Icon(Icons.motorcycle),
                title: Text('#${m['numero'] ?? ''} · ${m['cliente'] ?? 'Cliente'}'),
                subtitle: Text(m['endereco']?.toString() ?? ''),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => _abrir(m),
              ),
            );
          }),
      ],
    );
  }
}
