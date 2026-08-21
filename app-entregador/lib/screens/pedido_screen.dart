import 'package:flutter/material.dart';
import '../api.dart';

class PedidoScreen extends StatefulWidget {
  final Map<String, dynamic> pedido;
  const PedidoScreen({super.key, required this.pedido});

  @override
  State<PedidoScreen> createState() => _PedidoScreenState();
}

class _PedidoScreenState extends State<PedidoScreen> {
  final _codigo = TextEditingController();
  bool _finalizando = false;

  @override
  void dispose() {
    _codigo.dispose();
    super.dispose();
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

  Future<void> _finalizar() async {
    if (_entregaPropria && _codigo.text.trim().isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Digite o código de entrega do cliente.')),
      );
      return;
    }
    setState(() => _finalizando = true);
    try {
      final r = await Api.finalizar(
        widget.pedido['id'] as String,
        codigo: _entregaPropria ? _codigo.text.trim() : null,
      );
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
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(e.toString().replaceFirst('Exception: ', '')),
          backgroundColor: Colors.red,
        ),
      );
      setState(() => _finalizando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.pedido;
    final itens = (p['itens'] as List?) ?? [];
    final total = (p['total'] as num?)?.toStringAsFixed(2) ?? '0.00';
    return Scaffold(
      appBar: AppBar(title: Text('Pedido #${p['numero'] ?? ''}')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(p['cliente']?.toString() ?? 'Cliente',
              style: Theme.of(context).textTheme.titleLarge),
          if (p['telefone'] != null) Text(p['telefone'].toString()),
          const SizedBox(height: 8),
          if (p['endereco'] != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.location_on),
                title: Text(p['endereco'].toString()),
              ),
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
          const SizedBox(height: 24),
          if (_entregaPropria)
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
