import 'dart:async';
import 'package:flutter/material.dart';
import 'package:connectivity_plus/connectivity_plus.dart';
import '../api.dart';
import '../location.dart';
import '../outbox.dart';
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
  Map<String, dynamic>? _saida; // { saida, paradas: [...] } — roteiro multi-parada
  Map<String, dynamic>? _ganhos;
  bool _compartilhaContato = false; // opt-in: mandar meu contato no aviso ao cliente
  bool _pegandoSaida = false;
  String? _erro;
  bool _carregando = true;
  bool _online = true; // indicador de conexão (offline-first)
  int _pendentes = 0; // entregas na fila local aguardando envio
  StreamSubscription<List<ConnectivityResult>>? _connSub;

  @override
  void initState() {
    super.initState();
    _carregar();
    _sincronizarPendentes();
    _connSub = Connectivity().onConnectivityChanged.listen((r) {
      final on = r.any((x) => x != ConnectivityResult.none);
      if (mounted) setState(() => _online = on);
      if (on) _sincronizarPendentes(); // reconectou → esvazia a fila
    });
  }

  @override
  void dispose() {
    _connSub?.cancel();
    super.dispose();
  }

  // Esvazia a fila offline e atualiza o contador de pendentes. Se algo saiu,
  // recarrega para refletir os status já atualizados no servidor.
  Future<void> _sincronizarPendentes() async {
    final enviados = await Outbox.flush();
    final p = await Outbox.pendentes();
    if (mounted) setState(() => _pendentes = p);
    if (enviados > 0) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('$enviados entrega(s) pendente(s) enviada(s) ✅')),
        );
      }
      _carregar();
    }
  }

  String _brl(dynamic centavos) {
    final v = (num.tryParse('${centavos ?? 0}') ?? 0) / 100.0;
    return 'R\$ ${v.toStringAsFixed(2).replaceAll('.', ',')}';
  }

  Future<void> _carregar() async {
    setState(() => _erro = null);
    try {
      final p = await Api.perfil();
      final peds = await Api.pedidos();
      Map<String, dynamic>? saida;
      try {
        saida = await Api.saida();
      } catch (_) {}
      // Ganhos do dia — best-effort (se a loja não configurou, vem zerado).
      Map<String, dynamic> g = {};
      try {
        g = await Api.ganhos();
      } catch (_) {}
      bool pref = false;
      try {
        pref = await Api.preferencia();
      } catch (_) {}
      if (mounted) {
        setState(() {
          _perfil = p;
          _pedidos = peds;
          _saida = saida;
          _ganhos = g;
          _compartilhaContato = pref;
          _carregando = false;
        });
      }
      // GPS só com entrega ativa (LGPD + bateria): pede permissão em contexto.
      if (peds.isNotEmpty) {
        LocationSender.iniciar();
      } else {
        LocationSender.parar();
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

  Future<void> _toggleContato(bool v) async {
    setState(() => _compartilhaContato = v);
    try {
      final r = await Api.salvarPreferencia(v);
      if (mounted) setState(() => _compartilhaContato = r);
    } catch (e) {
      if (mounted) {
        setState(() => _compartilhaContato = !v); // desfaz no erro
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))),
        );
      }
    }
  }

  List<dynamic> get _roteiro => (_saida?['paradas'] as List?) ?? [];

  Future<void> _pegarSaida() async {
    setState(() => _pegandoSaida = true);
    try {
      final s = await Api.proximaSaida();
      if (!mounted) return;
      final paradas = (s['paradas'] as List?) ?? [];
      if (paradas.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Nenhum pedido pronto para roteirizar agora.')),
        );
      }
      await _carregar();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(e.toString().replaceFirst('Exception: ', '')),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _pegandoSaida = false);
    }
  }

  Widget _paradaCard(dynamic parada, int idx) {
    final m = parada as Map<String, dynamic>;
    final entregue = m['entregue'] == true;
    final ordem = m['ordemParada'] ?? (idx + 1);
    // Próxima = 1ª parada ainda não entregue (todas as anteriores já entregues).
    final proxima = !entregue && _roteiro.take(idx).every((x) => (x as Map)['entregue'] == true);
    const gold = Color(0xFFE2A340);
    return Card(
      color: proxima ? gold.withValues(alpha: 0.10) : null,
      child: ListTile(
        leading: CircleAvatar(
          radius: 15,
          backgroundColor: entregue ? Colors.green : (proxima ? gold : Colors.grey),
          child: entregue
              ? const Icon(Icons.check, color: Colors.white, size: 18)
              : Text('$ordem', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        ),
        title: Text('#${m['numero'] ?? ''} · ${m['cliente'] ?? 'Cliente'}'),
        subtitle: Text(m['endereco']?.toString() ?? ''),
        trailing: entregue
            ? const Text('entregue', style: TextStyle(color: Colors.green, fontSize: 12))
            : const Icon(Icons.chevron_right),
        onTap: entregue ? null : () => _abrir(m),
      ),
    );
  }

  Future<void> _sair() async {
    LocationSender.parar();
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
        if (!_online || _pendentes > 0)
          Card(
            color: (_online ? Colors.orange : Colors.grey).withValues(alpha: 0.12),
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Row(
                children: [
                  Icon(_online ? Icons.sync : Icons.cloud_off,
                      size: 18, color: _online ? Colors.orange.shade800 : Colors.grey.shade700),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      !_online
                          ? (_pendentes > 0
                              ? 'Sem conexão · $_pendentes entrega(s) na fila, enviam ao reconectar.'
                              : 'Sem conexão · você ainda pode concluir entregas offline.')
                          : '$_pendentes entrega(s) na fila, enviando…',
                      style: TextStyle(
                        fontSize: 12,
                        color: _online ? Colors.orange.shade900 : Colors.grey.shade800,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
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
          const SizedBox(height: 12),
        ],
        if (_ganhos != null && _perfil?['ehEntregador'] == true) ...[
          Card(
            color: const Color(0xFFE2A340).withValues(alpha: 0.12),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _ganhos!['estimado'] == true ? 'Meus ganhos estimados' : 'Meus ganhos',
                        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600),
                      ),
                      Text('${_ganhos!['entregas'] ?? 0} entrega(s)',
                          style: const TextStyle(fontSize: 12, color: Colors.black54)),
                      if ((_ganhos!['pendentesConferencia'] ?? 0) > 0)
                        Text(
                          '${_ganhos!['pendentesConferencia']} aguardando conferência',
                          style: const TextStyle(fontSize: 11, color: Color(0xFF7A5011)),
                        ),
                    ],
                  ),
                  Text(
                    _brl(_ganhos!['total']),
                    style: const TextStyle(
                        fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF0F2230)),
                  ),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (_perfil?['ehEntregador'] == true) ...[
          Card(
            child: SwitchListTile(
              value: _compartilhaContato,
              onChanged: _toggleContato,
              title: const Text('Compartilhar meu contato no aviso'),
              subtitle: const Text(
                'Ao avisar o cliente que estou chegando, enviar também meu nome e telefone para facilitar o contato.',
              ),
            ),
          ),
          const SizedBox(height: 16),
        ],
        if (_roteiro.isNotEmpty) ...[
          Row(
            children: [
              const Icon(Icons.route, size: 18),
              const SizedBox(width: 6),
              Text('Roteiro da saída · ${_roteiro.length} parada(s)',
                  style: const TextStyle(fontWeight: FontWeight.w600)),
            ],
          ),
          const SizedBox(height: 8),
          ..._roteiro.asMap().entries.map((e) => _paradaCard(e.value, e.key)),
        ] else ...[
          if (_perfil?['ehEntregador'] == true)
            FilledButton.icon(
              onPressed: _pegandoSaida ? null : _pegarSaida,
              icon: const Icon(Icons.route),
              label: Text(_pegandoSaida ? 'Montando roteiro…' : 'Pegar próxima saída'),
            ),
          const SizedBox(height: 12),
          if (_pedidos.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 32),
              child: Center(
                child: Text(
                  'Nenhum pedido em rota.\nPegue uma saída ou escaneie o cupom.',
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
      ],
    );
  }
}
