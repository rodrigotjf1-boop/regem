import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:crypto/crypto.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api.dart';
import '../outbox.dart';
import 'rota_screen.dart';

class PedidoScreen extends StatefulWidget {
  final Map<String, dynamic> pedido;
  // Aberto logo depois de escanear o cupom: o campo do código já vem com o teclado aberto.
  final bool focarCodigo;
  const PedidoScreen({super.key, required this.pedido, this.focarCodigo = false});

  @override
  State<PedidoScreen> createState() => _PedidoScreenState();
}

class _PedidoScreenState extends State<PedidoScreen> {
  final _codigo = TextEditingController();
  bool _finalizando = false;
  bool _avisando = false;

  Future<void> _chegando() async {
    setState(() => _avisando = true);
    try {
      await Api.chegando(widget.pedido['id'] as String);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Cliente avisado — você está chegando 🛵')),
        );
      }
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
      if (mounted) setState(() => _avisando = false);
    }
  }

  @override
  void dispose() {
    _codigo.dispose();
    super.dispose();
  }

  // E3 — abre a NOSSA rota (OSRM) num mapa DENTRO do app; lá dentro há o botão "Navegar"
  // que abre o Google Maps/Waze para a direção por voz. Antes este botão abria o mapa
  // externo direto (sem a nossa rota).
  void _verRota() {
    Navigator.push(
      context,
      MaterialPageRoute(builder: (_) => RotaScreen(pedido: widget.pedido)),
    );
  }

  // Contato do cliente: só dígitos; com DDI 55 para o wa.me (WhatsApp).
  String _telDigits({bool comDdi = false}) {
    var d = (widget.pedido['telefone']?.toString() ?? '').replaceAll(RegExp(r'\D'), '');
    if (comDdi && d.isNotEmpty && !d.startsWith('55')) d = '55$d';
    return d;
  }

  Future<void> _abrirUri(Uri uri, String erro) async {
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(erro)));
    }
  }

  Future<void> _ligar() async {
    final d = _telDigits();
    if (d.isEmpty) return;
    await _abrirUri(Uri.parse('tel:$d'), 'Não foi possível abrir o discador.');
  }

  Future<void> _whatsapp() async {
    final d = _telDigits(comDdi: true);
    if (d.isEmpty) return;
    await _abrirUri(Uri.parse('https://wa.me/$d'), 'Não foi possível abrir o WhatsApp.');
  }

  // QUEM decide a regra do código é o servidor (`modoEntrega`, `codigoDoCanal`, `conferencia`).
  // Servidor antigo (sem esses campos): o app deduz do pedido bruto, como fazia antes.
  bool get _servidorDecide => widget.pedido.containsKey('modoEntrega');

  // Entrega própria em marketplace (99food delivery_type=2 / iFood MERCHANT) — só a dedução
  // antiga, para servidor sem `codigoDoCanal`.
  String? get _canalDeduzido {
    final raw = widget.pedido['raw'];
    if (raw is! Map) return null;
    final canal = widget.pedido['canal'];
    if (canal == '99food' && raw['delivery_type']?.toString() == '2') return '99food';
    final d = raw['delivery'];
    if (canal == 'ifood' && d is Map && d['deliveredBy']?.toString().toUpperCase() == 'MERCHANT') {
      return 'ifood';
    }
    return null;
  }

  /// 'ifood' | '99food' quando o código é o que o cliente recebeu do CANAL; null = código do
  /// Regem (ou nenhum).
  String? get _codigoDoCanal =>
      _servidorDecide ? widget.pedido['codigoDoCanal']?.toString() : _canalDeduzido;

  bool get _precisaCodigo => _codigoDoCanal != null || widget.pedido['precisaCodigo'] == true;

  /// Onde o código é conferido: 'hash' (no aparelho), 'depois' (99: sem sinal guarda e confere
  /// ao voltar), 'online' (iFood: só com internet, na hora — decisão do dono, 29/09/2026).
  String? get _conferencia {
    final c = widget.pedido['conferencia']?.toString();
    if (c != null && c.isNotEmpty) return c;
    if (_codigoDoCanal == 'ifood') return 'online';
    if (_codigoDoCanal == '99food') return 'depois';
    return _precisaCodigo ? 'hash' : null;
  }

  String get _nomeCanal => _codigoDoCanal == 'ifood' ? 'iFood' : '99';

  String get _rotuloCodigo => _codigoDoCanal == 'ifood'
      ? 'Código de entrega do iFood'
      : _codigoDoCanal == '99food'
          ? 'Código de entrega da 99'
          : 'Código de entrega do cliente';

  String get _ajudaCodigo => _codigoDoCanal == 'ifood'
      ? 'O cliente vê o código no app do iFood. A conferência é na hora e precisa de internet.'
      : _codigoDoCanal == '99food'
          ? 'O cliente vê o código no app da 99.'
          : 'Peça ao cliente o código de 4 números do pedido.';

  Map<String, dynamic>? get _entrega99 {
    final e = widget.pedido['entrega99'];
    return e is Map ? Map<String, dynamic>.from(e) : null;
  }

  // Verifica o código OFFLINE pelo HASH (SHA-256) que o backend mandou — sem internet,
  // sem expor o código. Sem hash (marketplace) → deixa o servidor validar.
  bool _codigoConfere(String code) {
    final hash = widget.pedido['codigoEntregaHash']?.toString();
    if (hash == null || hash.isEmpty) return true;
    return sha256.convert(utf8.encode(code)).toString() == hash;
  }

  void _aviso(String msg, {bool erro = false}) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: erro ? Colors.red : null),
    );
  }

  Future<void> _finalizar() async {
    final code = _codigo.text.trim();
    if (_precisaCodigo && code.isEmpty) {
      _aviso('Digite o ${_rotuloCodigo.toLowerCase()}.');
      return;
    }
    // Validação OFFLINE por hash (funciona sem conexão).
    if (_precisaCodigo && !_codigoConfere(code)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Código inválido — confira com o cliente.'),
          backgroundColor: Colors.red,
        ),
      );
      return;
    }
    setState(() => _finalizando = true);
    final id = widget.pedido['id'] as String;
    try {
      final r = await Api.finalizar(id, codigo: _precisaCodigo ? code : null);
      if (!mounted) return;
      if (r['valid'] == false) {
        _aviso(r['msg']?.toString() ?? 'Código inválido.', erro: true);
        setState(() => _finalizando = false);
        return;
      }
      _aviso(r['jaFeito'] == true ? 'Esta entrega já estava confirmada.' : 'Entrega concluída!');
      Navigator.pop(context, true);
    } on ApiErro catch (e) {
      if (!mounted) return;
      // Servidor/canal fora do ar (5xx, 408, 429) conta como falta de conexão; recusa (4xx) não.
      if (!e.recusa) return _semConexao(id, code);
      _aviso(e.mensagem, erro: true);
      setState(() => _finalizando = false);
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      if (Outbox.ehErroDeRede(msg)) return _semConexao(id, code);
      _aviso(msg.replaceFirst('Exception: ', ''), erro: true);
      setState(() => _finalizando = false);
    }
  }

  /// Sem internet: o que pode esperar vai para a fila e conclui aqui; o do iFood, não.
  Future<void> _semConexao(String id, String code) async {
    if (_conferencia == 'online') {
      _aviso(
        'Sem internet — o código do iFood só é conferido online. Tente de novo quando o sinal voltar.',
        erro: true,
      );
      setState(() => _finalizando = false);
      return;
    }
    await Outbox.enfileirar(
      id,
      _precisaCodigo ? code : null,
      numero: widget.pedido['numero'],
      canal: _codigoDoCanal,
    );
    if (!mounted) return;
    _aviso(_conferencia == 'depois'
        ? 'Sem internet — entrega guardada. Confiro o código com a 99 quando o sinal voltar e aviso se ela recusar.'
        : 'Sem conexão — entrega registrada ✅ Será enviada ao reconectar.');
    Navigator.pop(context, true);
  }

  Future<void> _copiarLocalizador(String loc) async {
    await Clipboard.setData(ClipboardData(text: loc));
    if (mounted) _aviso('Localizador copiado.');
  }

  // Plano B da 99: a página da 99 onde o entregador digita o localizador + o código do cliente.
  Widget _planoB99() {
    final e = _entrega99;
    final loc = e?['localizador']?.toString();
    final pagina = e?['pagina']?.toString();
    if ((loc == null || loc.isEmpty) && (pagina == null || pagina.isEmpty)) {
      return const SizedBox.shrink();
    }
    return Card(
      color: Colors.orange.withValues(alpha: 0.08),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Se o código não passar aqui',
              style: TextStyle(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 4),
            const Text(
              'Abra a página de entrega da 99 e digite o localizador deste pedido junto com o código do cliente.',
              style: TextStyle(fontSize: 13),
            ),
            if (loc != null && loc.isNotEmpty)
              ListTile(
                contentPadding: EdgeInsets.zero,
                dense: true,
                title: const Text('Localizador', style: TextStyle(fontSize: 12)),
                subtitle: Text(
                  loc,
                  style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: 2),
                ),
                trailing: IconButton(
                  icon: const Icon(Icons.copy),
                  tooltip: 'Copiar localizador',
                  onPressed: () => _copiarLocalizador(loc),
                ),
              ),
            if (pagina != null && pagina.isNotEmpty)
              OutlinedButton.icon(
                onPressed: () =>
                    _abrirUri(Uri.parse(pagina), 'Não foi possível abrir a página da 99.'),
                icon: const Icon(Icons.open_in_new),
                label: const Text('Abrir página de entrega da 99'),
              ),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.pedido;
    final itens = (p['itens'] as List?) ?? [];
    final taxa = (p['taxaEntrega'] as num?) ?? 0;
    // Quanto cobrar na porta vem CALCULADO do servidor (`aReceber`), que abre pagamento
    // dividido e reconhece o pré-pago dos marketplaces. `total` só entra como reserva
    // para app falando com servidor antigo — usá-lo direto fazia o entregador cobrar de
    // novo de quem já tinha pago online.
    final temCobranca = p['aReceber'] != null;
    final aReceber = (p['aReceber'] as num?) ?? (p['total'] as num?) ?? 0;
    final prepago = temCobranca ? (p['prepago'] == true) : (p['pago'] == true);
    final jaPagoOnline = (p['jaPagoOnline'] as num?) ?? 0;
    final troco = p['troco'] as num?;
    final trocoPara = p['trocoPara'] as num?;
    final formas = (p['formasNaEntrega'] as List?) ?? [];
    return Scaffold(
      appBar: AppBar(
        title: Text(_codigoDoCanal != null
            ? 'Pedido #${p['numero'] ?? ''} · $_nomeCanal'
            : 'Pedido #${p['numero'] ?? ''}'),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(p['cliente']?.toString() ?? 'Cliente',
              style: Theme.of(context).textTheme.titleLarge),
          if (_telDigits().isNotEmpty)
            Row(
              children: [
                Expanded(child: Text(p['telefone'].toString())),
                IconButton(
                  icon: const Icon(Icons.phone),
                  color: Colors.green,
                  tooltip: 'Ligar',
                  onPressed: _ligar,
                ),
                IconButton(
                  icon: const Icon(Icons.chat),
                  color: const Color(0xFF25D366),
                  tooltip: 'WhatsApp',
                  onPressed: _whatsapp,
                ),
              ],
            ),
          const SizedBox(height: 8),
          if (p['endereco'] != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.location_on),
                title: Text(p['endereco'].toString()),
                trailing: IconButton(
                  icon: const Icon(Icons.directions),
                  tooltip: 'Ver rota',
                  onPressed: _verRota,
                ),
                onTap: _verRota,
              ),
            ),
          const SizedBox(height: 8),
          if (p['endereco'] != null)
            OutlinedButton.icon(
              onPressed: _verRota,
              icon: const Icon(Icons.map),
              label: const Text('Ver rota'),
            ),
          const SizedBox(height: 8),
          ...itens.map((it) {
            final m = it as Map;
            return ListTile(
              dense: true,
              leading: Text('${m['quantidade'] ?? 1}×'),
              title: Text('${m['descricao'] ?? m['nome'] ?? ''}'),
            );
          }),
          const Divider(),
          Text(
            prepago
                ? 'Pago online — não cobrar'
                : 'A receber: R\$ ${aReceber.toStringAsFixed(2)}'
                    '  (${formas.isNotEmpty ? formas.map((f) => (f as Map)['rotulo']).join(' + ') : p['formaPagamento'] ?? ''})',
            style: TextStyle(
              fontWeight: FontWeight.bold,
              fontSize: 16,
              color: prepago ? Colors.green.shade800 : null,
            ),
          ),
          // Pedido parcialmente pago: sem esta linha, "A receber: R$ 40" num pedido de
          // R$ 100 parece erro do app.
          if (!prepago && jaPagoOnline > 0)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'R\$ ${jaPagoOnline.toStringAsFixed(2)} já pago online — cobre só a diferença.',
                style: TextStyle(color: Colors.green.shade800),
              ),
            ),
          if (troco != null && trocoPara != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'Troco para R\$ ${trocoPara.toStringAsFixed(2)} → levar R\$ ${troco.toStringAsFixed(2)}',
                style: const TextStyle(fontWeight: FontWeight.w600),
              ),
            ),
          if (taxa > 0)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                'Taxa de entrega: R\$ ${taxa.toStringAsFixed(2)}',
                style: TextStyle(
                  color: Colors.green.shade800,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          const SizedBox(height: 24),
          if (_precisaCodigo)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: TextField(
                controller: _codigo,
                autofocus: widget.focarCodigo,
                keyboardType: TextInputType.number,
                inputFormatters: [
                  FilteringTextInputFormatter.digitsOnly,
                  LengthLimitingTextInputFormatter(8),
                ],
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 26, fontWeight: FontWeight.w800, letterSpacing: 6),
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _finalizando ? null : _finalizar(),
                decoration: InputDecoration(
                  labelText: _rotuloCodigo,
                  helperText: _ajudaCodigo,
                  helperMaxLines: 2,
                  border: const OutlineInputBorder(),
                ),
              ),
            ),
          if (_codigoDoCanal == '99food') _planoB99(),
          OutlinedButton.icon(
            onPressed: _avisando ? null : _chegando,
            icon: const Icon(Icons.notifications_active),
            label: Text(_avisando ? 'Avisando…' : 'Avisar cliente (estou chegando)'),
          ),
          const SizedBox(height: 8),
          FilledButton(
            onPressed: _finalizando ? null : _finalizar,
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Text(_finalizando ? 'Finalizando…' : 'Concluir entrega'),
            ),
          ),
        ],
      ),
    );
  }
}
