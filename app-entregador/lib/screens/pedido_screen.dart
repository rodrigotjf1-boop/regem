import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:crypto/crypto.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api.dart';
import '../outbox.dart';
import 'rota_screen.dart';

class PedidoScreen extends StatefulWidget {
  final Map<String, dynamic> pedido;
  const PedidoScreen({super.key, required this.pedido});

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

  // Entrega própria em marketplace (99food delivery_type=2 / iFood MERCHANT) exige
  // o código do cliente. Cardápio nativo conclui sem código.
  bool get _entregaPropria {
    final raw = widget.pedido['raw'];
    if (raw is! Map) return false;
    final canal = widget.pedido['canal'];
    if (canal == '99food' && raw['delivery_type']?.toString() == '2') return true;
    final d = raw['delivery'];
    if (canal == 'ifood' &&
        d is Map &&
        d['deliveredBy']?.toString().toUpperCase() == 'MERCHANT') {
      return true;
    }
    return false;
  }

  // Exige código quando: entrega própria de marketplace (código do canal) OU entrega
  // própria do cardápio/local com código de 4 díg. (backend manda precisaCodigo).
  bool get _precisaCodigo => _entregaPropria || widget.pedido['precisaCodigo'] == true;

  // Verifica o código OFFLINE pelo HASH (SHA-256) que o backend mandou — sem internet,
  // sem expor o código. Sem hash (marketplace) → deixa o servidor validar.
  bool _codigoConfere(String code) {
    final hash = widget.pedido['codigoEntregaHash']?.toString();
    if (hash == null || hash.isEmpty) return true;
    return sha256.convert(utf8.encode(code)).toString() == hash;
  }

  static bool _ehErroDeRede(String msg) =>
      msg.contains('SocketException') ||
      msg.contains('Failed host lookup') ||
      msg.contains('Connection') ||
      msg.contains('timed out') ||
      msg.contains('Network is unreachable') ||
      msg.contains('ClientException');

  Future<void> _finalizar() async {
    final code = _codigo.text.trim();
    if (_precisaCodigo && code.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Digite o código de entrega do cliente.')),
      );
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
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(r['msg']?.toString() ?? 'Código inválido.'),
            backgroundColor: Colors.red,
          ),
        );
        setState(() => _finalizando = false);
        return;
      }
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Entrega concluída!')));
      Navigator.pop(context, true);
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      // Sem conexão → enfileira (offline-first) e conclui localmente; envia ao reconectar.
      if (_ehErroDeRede(msg)) {
        await Outbox.enfileirar(id, _precisaCodigo ? code : null);
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Sem conexão — entrega registrada ✅ Será enviada ao reconectar.'),
          ),
        );
        Navigator.pop(context, true);
        return;
      }
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg.replaceFirst('Exception: ', '')), backgroundColor: Colors.red),
      );
      setState(() => _finalizando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.pedido;
    final itens = (p['itens'] as List?) ?? [];
    final total = (p['total'] as num?)?.toStringAsFixed(2) ?? '0.00';
    final taxa = (p['taxaEntrega'] as num?) ?? 0;
    return Scaffold(
      appBar: AppBar(title: Text('Pedido #${p['numero'] ?? ''}')),
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
            p['pago'] == true
                ? 'Pago online'
                : 'A receber: R\$ $total  (${p['formaPagamento'] ?? ''})',
            style: const TextStyle(fontWeight: FontWeight.bold),
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
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(
                  labelText: 'Código de entrega do cliente',
                  border: OutlineInputBorder(),
                ),
              ),
            ),
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
