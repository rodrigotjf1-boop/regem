import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../tema.dart';

/// "PRIMEIRA VEZ NESTE APARELHO" (protótipo, tela 1): o código de 6 números que o gestor gera em Configurações ›
/// Equipamentos. Igual aos outros aparelhos da loja; o celular revogado lá volta para cá.
class TelaParear extends StatefulWidget {
  final String? aviso;
  final VoidCallback aoParear;
  const TelaParear({super.key, this.aviso, required this.aoParear});

  @override
  State<TelaParear> createState() => _TelaParearState();
}

class _TelaParearState extends State<TelaParear> {
  final _codigo = TextEditingController();
  bool _enviando = false;
  String? _erro;

  @override
  void dispose() {
    _codigo.dispose();
    super.dispose();
  }

  Future<void> _parear() async {
    final c = _codigo.text.replaceAll(RegExp(r'\D'), '');
    if (c.length != 6) {
      setState(() => _erro = 'O código tem 6 números.');
      return;
    }
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      await Api.parear(c);
      widget.aoParear();
    } on ApiErro catch (e) {
      setState(() => _erro = e.mensagem);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  const Text('Regem Atendimento', style: TextStyle(fontSize: 14, fontWeight: FontWeight.w700, color: kTinta2)),
                  const SizedBox(height: 8),
                  const Text('Primeira vez neste aparelho', style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: kNavy)),
                  const SizedBox(height: 12),
                  if (widget.aviso != null) ...[
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(color: kPerigo.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(12)),
                      child: Text(widget.aviso!, style: const TextStyle(color: kPerigo, fontWeight: FontWeight.w600)),
                    ),
                    const SizedBox(height: 12),
                  ],
                  const Text(
                    'No computador, abra Configurações › Equipamentos › Novo equipamento e escolha "App de atendimento (celular)". '
                    'O código de 6 números aparece lá (vale 15 minutos). Digite aqui:',
                    style: TextStyle(fontSize: 15, color: kTinta2, height: 1.4),
                  ),
                  const SizedBox(height: 20),
                  TextField(
                    controller: _codigo,
                    keyboardType: TextInputType.number,
                    inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
                    textAlign: TextAlign.center,
                    autofocus: true,
                    style: const TextStyle(fontSize: 32, letterSpacing: 10, fontWeight: FontWeight.w700),
                    decoration: const InputDecoration(hintText: '000000', counterText: ''),
                    onSubmitted: (_) => _parear(),
                  ),
                  if (_erro != null) ...[
                    const SizedBox(height: 10),
                    Text(_erro!, style: const TextStyle(color: kPerigo, fontWeight: FontWeight.w600)),
                  ],
                  const SizedBox(height: 16),
                  FilledButton(onPressed: _enviando ? null : _parear, child: Text(_enviando ? 'Pareando…' : 'Parear')),
                  const SizedBox(height: 16),
                  const Text(
                    'O celular precisa de internet: o app fala com o Regem na nuvem. Depois de parear, cada pessoa entra com o PIN dela.',
                    style: TextStyle(fontSize: 13, color: kTinta2, height: 1.4),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
