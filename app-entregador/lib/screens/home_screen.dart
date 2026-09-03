import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart'; // SystemSound/HapticFeedback — alerta de pedido pronto
import 'package:connectivity_plus/connectivity_plus.dart';
import '../api.dart';
import '../location.dart';
import '../outbox.dart';
import '../theme.dart';
import '../widgets/regem_mark.dart';
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
  Map<String, dynamic>? _fila; // estado do botão da fila (máquina de estados — Frente 2)
  bool _filaBusy = false; // ação da fila em andamento (evita duplo toque)
  Timer? _filaTimer; // poll do estado da fila (posição/pronto)
  bool _alertaProntoArmado = false; // já alertei p/ o pronto atual (não repete a cada poll)
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
    _carregarFila();
    // Poll leve do estado da fila: posição na fila muda quando outros entram/saem, e o
    // botão "Procurar" aparece quando eu viro o 1º. 8s equilibra responsividade × bateria.
    _filaTimer = Timer.periodic(const Duration(seconds: 8), (_) => _carregarFila());
    _connSub = Connectivity().onConnectivityChanged.listen((r) {
      final on = r.any((x) => x != ConnectivityResult.none);
      if (mounted) setState(() => _online = on);
      if (on) _sincronizarPendentes(); // reconectou → esvazia a fila
    });
  }

  @override
  void dispose() {
    _connSub?.cancel();
    _filaTimer?.cancel();
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
      // GPS só com entrega ativa (LGPD + bateria): pedidos avulsos em rota OU paradas pendentes
      // numa saída (roteiro). Antes só olhava `peds` → no roteiro o GPS não ligava.
      final temSaidaAtiva =
          (saida?['paradas'] as List?)?.any((p) => (p as Map)['entregue'] != true) ?? false;
      if (peds.isNotEmpty || temSaidaAtiva) {
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
    if (ok == true) {
      _carregar();
      _carregarFila(); // scan em modo carrinho muda o botão p/ "Iniciar entrega(s)"
    }
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

  // ===== Fila (Frente 2) — máquina de estados do botão =====
  Future<void> _carregarFila() async {
    try {
      final f = await Api.estadoFila();
      if (mounted) setState(() => _fila = f);
      // Frente 2d — alerta ao 1º da fila quando surge pedido pronto p/ puxar. Só quando a
      // condição VIRA verdadeira (não repete a cada poll); rearma quando ela sai (novo pronto
      // volta a alertar). Cobre o caso "entregador distraído" com o app aberto; o push em 2º
      // plano (tela apagada) depende de FCM/Firebase — follow-up documentado.
      final prontos = (f['prontosDisponiveis'] as num?)?.toInt() ?? 0;
      final deveAlertar = f['botao'] == 'procurar' && prontos > 0;
      if (deveAlertar && !_alertaProntoArmado) {
        _alertaProntoArmado = true;
        _alertarPedidoPronto(prontos);
      } else if (!deveAlertar) {
        _alertaProntoArmado = false;
      }
    } catch (_) {/* best-effort — não trava a home */}
  }

  // Alerta sonoro + tátil + banner: "tem pedido pronto, você é o próximo".
  void _alertarPedidoPronto(int n) {
    SystemSound.play(SystemSoundType.alert);
    Future.delayed(const Duration(milliseconds: 600), () => SystemSound.play(SystemSoundType.alert));
    HapticFeedback.heavyImpact();
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(n > 1
          ? '🛵 $n pedidos prontos! Você é o 1º — puxe os pedidos.'
          : '🛵 Pedido pronto! Você é o 1º — puxe o pedido.'),
      backgroundColor: kVerde,
      duration: const Duration(seconds: 6),
    ));
  }

  void _snack(String msg, {bool erro = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: erro ? Colors.red : null),
    );
  }

  Future<void> _entrarFila() async {
    setState(() => _filaBusy = true);
    try {
      final p = await LocationSender.posicaoAtual();
      if (p == null) {
        throw Exception('Não consegui a sua localização. Ative o GPS e tente de novo.');
      }
      final f = await Api.filaEntrar(p.latitude, p.longitude);
      if (mounted) setState(() => _fila = f);
    } catch (e) {
      _snack(e.toString().replaceFirst('Exception: ', ''), erro: true);
    } finally {
      if (mounted) setState(() => _filaBusy = false);
    }
  }

  Future<void> _sairFila() async {
    setState(() => _filaBusy = true);
    try {
      await Api.filaSair();
      await _carregarFila();
      await _carregar();
    } catch (e) {
      _snack(e.toString().replaceFirst('Exception: ', ''), erro: true);
    } finally {
      if (mounted) setState(() => _filaBusy = false);
    }
  }

  Future<void> _procurar() async {
    setState(() => _filaBusy = true);
    try {
      final f = await Api.procurarPedidos();
      if (mounted) setState(() => _fila = f);
      final n = (f['reservados'] as num?)?.toInt() ?? 0;
      _snack(n > 0
          ? '$n pedido(s) no carrinho. Escaneie mais ou inicie a entrega.'
          : 'Nenhum pedido pronto agora. Você pode escanear um cupom ou aguardar.');
    } catch (e) {
      _snack(e.toString().replaceFirst('Exception: ', ''), erro: true);
    } finally {
      if (mounted) setState(() => _filaBusy = false);
    }
  }

  Future<void> _iniciar() async {
    setState(() => _filaBusy = true);
    try {
      await Api.iniciarEntregas();
      await _carregar(); // agora tenho saída → o roteiro aparece
      await _carregarFila(); // botão → em_entrega
    } catch (e) {
      _snack(e.toString().replaceFirst('Exception: ', ''), erro: true);
    } finally {
      if (mounted) setState(() => _filaBusy = false);
    }
  }

  // O botão principal muda conforme o meu estado na fila.
  Widget _botaoFila() {
    final botao = _fila?['botao'] as String? ?? 'entrar_fila';
    final pos = (_fila?['posicao'] as num?)?.toInt();
    final reservados = (_fila?['reservados'] as num?)?.toInt() ?? 0;
    final busy = _filaBusy;
    Widget primary(String label, IconData icon, VoidCallback? onTap) => SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: busy ? null : onTap,
            icon: busy
                ? const SizedBox(
                    width: 18, height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
                : Icon(icon),
            label: Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
          ),
        );
    final sair = TextButton.icon(
      onPressed: busy ? null : _sairFila,
      icon: const Icon(Icons.logout, size: 18),
      label: const Text('Sair da fila'),
    );
    switch (botao) {
      case 'na_fila':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              color: kNavy.withValues(alpha: 0.06),
              child: ListTile(
                leading: const Icon(Icons.groups_rounded, color: kNavy),
                title: Text('${pos ?? '-'}º da fila',
                    style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
                subtitle: const Text('Aguarde a sua vez para puxar pedidos.'),
              ),
            ),
            sair,
          ],
        );
      case 'procurar':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              color: kOuro.withValues(alpha: 0.12),
              child: const ListTile(
                leading: Icon(Icons.emoji_events_rounded, color: kOuro),
                title: Text('Você é o 1º da fila', style: TextStyle(fontWeight: FontWeight.w800)),
                subtitle: Text('Puxe os pedidos prontos ou escaneie os cupons.'),
              ),
            ),
            const SizedBox(height: 8),
            primary('Procurar pedido', Icons.search_rounded, _procurar),
            sair,
          ],
        );
      case 'iniciar':
        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Card(
              color: kVerde.withValues(alpha: 0.10),
              child: ListTile(
                leading: const Icon(Icons.shopping_bag_rounded, color: kVerde),
                title: Text('$reservados no carrinho',
                    style: const TextStyle(fontWeight: FontWeight.w800)),
                subtitle: const Text('Escaneie ou puxe mais, e inicie quando quiser.'),
              ),
            ),
            const SizedBox(height: 8),
            primary('Iniciar entrega(s) ($reservados)', Icons.play_arrow_rounded, _iniciar),
            const SizedBox(height: 6),
            OutlinedButton.icon(
              onPressed: busy ? null : _procurar,
              icon: const Icon(Icons.add, size: 18),
              label: const Text('Puxar mais prontos'),
            ),
            sair,
          ],
        );
      case 'em_entrega':
        return const SizedBox.shrink(); // o roteiro da saída é mostrado abaixo
      default: // entrar_fila
        return primary('Entrar na fila', Icons.login_rounded, _entrarFila);
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
        titleSpacing: 16,
        title: Row(
          children: [
            const RegemMark(size: 34, fundo: kNavy),
            const SizedBox(width: 10),
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: const [
                Text('Regem',
                    style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800, color: kNavy, height: 1)),
                Text('ENTREGADOR',
                    style: TextStyle(fontSize: 9.5, fontWeight: FontWeight.w700, color: kOuro, letterSpacing: 2)),
              ],
            ),
          ],
        ),
        actions: [
          IconButton(onPressed: _sair, icon: const Icon(Icons.logout_rounded), tooltip: 'Sair'),
          const SizedBox(width: 4),
        ],
      ),
      body: RefreshIndicator(onRefresh: _carregar, child: _corpo()),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _escanear,
        backgroundColor: kNavy,
        foregroundColor: Colors.white,
        icon: const Icon(Icons.qr_code_scanner_rounded),
        label: const Text('Escanear', style: TextStyle(fontWeight: FontWeight.w700)),
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
          if (_perfil?['ehEntregador'] == true) _botaoFila(),
          const SizedBox(height: 12),
          if (_pedidos.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 24),
              child: Center(
                child: Text(
                  'Nenhum pedido em rota.\nEntre na fila e puxe ou escaneie os cupons.',
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
