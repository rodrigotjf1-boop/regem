import 'package:flutter/material.dart';

import '../api.dart';
import '../tema.dart';

/// "✨ Sugerir resposta" — o COPILOTO no app (1.1; no computador desde a mig 376). Aparece só com o copiloto LIGADO na
/// empresa e DISPONÍVEL na distribuição (`GET /atendimento/copiloto`, lido no máximo 1×/min). A sugestão vai para o campo;
/// quem envia é a pessoa — nada sai sozinho. Sem mensagem do cliente o botão fica parado e diz por quê.
class BotaoCopiloto extends StatefulWidget {
  final String casoId;
  final bool temDoCliente;
  final List<Map<String, String>> Function() mensagens;
  final List<String> prontas;
  final void Function(String texto) aoSugerir;

  const BotaoCopiloto({
    super.key,
    required this.casoId,
    required this.temDoCliente,
    required this.mensagens,
    required this.prontas,
    required this.aoSugerir,
  });

  /// O estado do copiloto é da empresa: uma leitura vale 1 min para todas as telas de caso.
  static Future<bool>? _ativo;
  static DateTime _lidoEm = DateTime.fromMillisecondsSinceEpoch(0);

  static Future<bool> ativo() {
    if (_ativo == null || DateTime.now().difference(_lidoEm) > const Duration(minutes: 1)) {
      _lidoEm = DateTime.now();
      _ativo = Api.copiloto().then((e) => e['ligado'] == true && e['disponivel'] == true).catchError((_) => false);
    }
    return _ativo!;
  }

  /// Para os testes: esquece a leitura (cada teste monta o servidor dele).
  static void esquecer() => _ativo = null;

  @override
  State<BotaoCopiloto> createState() => _BotaoCopilotoState();
}

class _BotaoCopilotoState extends State<BotaoCopiloto> {
  bool _ativo = false;
  bool _pedindo = false;
  bool _jaSugeriu = false;
  String? _erro;

  @override
  void initState() {
    super.initState();
    BotaoCopiloto.ativo().then((a) {
      if (mounted) setState(() => _ativo = a);
    });
  }

  Future<void> _pedir() async {
    if (_pedindo) return;
    setState(() {
      _pedindo = true;
      _erro = null;
    });
    try {
      final t = await Api.sugerir(widget.casoId, widget.mensagens(), widget.prontas);
      if (!mounted) return;
      widget.aoSugerir(t);
      setState(() => _jaSugeriu = true);
    } on ApiErro catch (e) {
      if (mounted) setState(() => _erro = e.mensagem);
    } finally {
      if (mounted) setState(() => _pedindo = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (!_ativo) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: 6),
      child: Wrap(crossAxisAlignment: WrapCrossAlignment.center, spacing: 10, runSpacing: 4, children: [
        OutlinedButton(
          onPressed: _pedindo || !widget.temDoCliente ? null : _pedir,
          child: Text(_pedindo ? 'Escrevendo a sugestão…' : (_jaSugeriu ? '✨ Outra sugestão' : '✨ Sugerir resposta')),
        ),
        if (_jaSugeriu && _erro == null)
          const Text('Sugestão do copiloto: confira e mude o que quiser antes de enviar.', style: TextStyle(fontSize: 12, color: kTinta2)),
        if (!widget.temDoCliente) const Text('O copiloto sugere quando houver mensagem do cliente.', style: TextStyle(fontSize: 12, color: kTinta2)),
        if (_erro != null) Text(_erro!, style: const TextStyle(fontSize: 12.5, color: kPerigo)),
      ]),
    );
  }
}
