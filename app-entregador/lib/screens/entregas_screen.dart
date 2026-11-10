import 'package:flutter/material.dart';
import '../api.dart';
import '../widgets/logo_do_canal.dart';

/// "MINHAS ENTREGAS" (pedido do dono, 10/11/2026: "clicando em meus ganhos, abre o relatório das entregas do turno"): as
/// entregas que compõem "Meus ganhos" — o mesmo período da loja e as ainda não acertadas —, da mais nova à mais antiga,
/// com o canal, o código do pedido, o cliente, a hora e a taxa. O total vem do cartão de ganhos (a mesma conta).
class EntregasScreen extends StatefulWidget {
  /// O cartão "Meus ganhos" da tela inicial (o total, as entregas e o que espera conferência).
  final Map<String, dynamic>? ganhos;
  const EntregasScreen({super.key, this.ganhos});

  @override
  State<EntregasScreen> createState() => _EntregasScreenState();
}

class _EntregasScreenState extends State<EntregasScreen> {
  Map<String, dynamic>? _dados;
  String? _erro;
  bool _carregando = true;

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
      final r = await Api.entregas();
      if (mounted) setState(() => _dados = r);
    } on ApiErro catch (e) {
      if (mounted) setState(() => _erro = e.mensagem);
    } catch (_) {
      if (mounted) setState(() => _erro = 'Sem internet — tente de novo quando o sinal voltar.');
    } finally {
      if (mounted) setState(() => _carregando = false);
    }
  }

  String _brl(dynamic centavos) {
    final v = (num.tryParse('${centavos ?? 0}') ?? 0) / 100.0;
    return 'R\$ ${v.toStringAsFixed(2).replaceAll('.', ',')}';
  }

  String _hora(dynamic iso) {
    final d = DateTime.tryParse('$iso')?.toLocal();
    if (d == null) return '';
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  String _dia(dynamic iso) {
    final d = DateTime.tryParse('$iso')?.toLocal();
    if (d == null) return '';
    return '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
  }

  String _periodo() {
    final p = _dados?['periodo'];
    final tipo = _dados?['periodicidade']?.toString() ?? 'dia';
    if (p is! Map) return '';
    final ini = DateTime.tryParse('${p['inicio']}');
    final fim = DateTime.tryParse('${p['fim']}');
    String f(DateTime? d) => d == null ? '' : '${d.day.toString().padLeft(2, '0')}/${d.month.toString().padLeft(2, '0')}';
    if (tipo == 'dia') return 'Hoje, ${f(ini)}';
    return '${tipo == 'semana' ? 'Semana' : 'Quinzena'}: ${f(ini)} a ${f(fim)}';
  }

  Widget _resumo() {
    final g = widget.ganhos;
    final lista = (_dados?['entregas'] as List?) ?? const [];
    final pendentes = lista.where((e) => (e as Map)['status'] == 'entregue').length;
    return Card(
      color: const Color(0xFFE2A340).withValues(alpha: 0.12),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(_periodo(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w600)),
            const SizedBox(height: 4),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${lista.length} entrega(s)', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700)),
                if (g != null)
                  Text(_brl(g['total']),
                      style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Color(0xFF0F2230))),
              ],
            ),
            if (pendentes > 0)
              Padding(
                padding: const EdgeInsets.only(top: 2),
                child: Text('$pendentes aguardando a conferência da loja',
                    style: const TextStyle(fontSize: 12, color: Color(0xFF7A5011))),
              ),
            if (g?['estimado'] == true)
              const Text('Valor estimado até a loja conferir as entregas.', style: TextStyle(fontSize: 11, color: Colors.black54)),
          ],
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final lista = (_dados?['entregas'] as List?) ?? const [];
    return Scaffold(
      appBar: AppBar(title: const Text('Minhas entregas')),
      body: RefreshIndicator(
        onRefresh: _carregar,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_carregando && _dados == null)
              const Padding(padding: EdgeInsets.all(32), child: Center(child: CircularProgressIndicator()))
            else if (_erro != null && _dados == null)
              Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  children: [
                    Text(_erro!, textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    OutlinedButton(onPressed: _carregar, child: const Text('Tentar de novo')),
                  ],
                ),
              )
            else ...[
              _resumo(),
              const SizedBox(height: 8),
              if (lista.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: Text('Nenhuma entrega neste período ainda.', textAlign: TextAlign.center)),
                )
              else
                ...lista.map((e) {
                  final m = Map<String, dynamic>.from(e as Map);
                  final conferida = m['status'] == 'concluido';
                  final bairro = m['bairro']?.toString() ?? '';
                  return Card(
                    child: ListTile(
                      leading: LogoDoCanal(canal: m['canal'], logoDaLoja: m['logoDaLoja']?.toString()),
                      title: Text(tituloDoPedido(m), style: const TextStyle(fontWeight: FontWeight.w700)),
                      subtitle: Text(
                        '${m['cliente'] ?? 'Cliente'}${bairro.isNotEmpty ? ' · $bairro' : ''}\n'
                        '${_periodo().startsWith('Hoje') ? '' : '${_dia(m['entregueEm'])} '}'
                        'entregue às ${_hora(m['entregueEm'])} · ${conferida ? 'conferida' : 'aguardando conferência'}',
                      ),
                      isThreeLine: true,
                      trailing: Text(_brl(m['taxaCentavos']), style: const TextStyle(fontWeight: FontWeight.w700)),
                    ),
                  );
                }),
            ],
          ],
        ),
      ),
    );
  }
}
