import 'package:flutter/material.dart';

import '../api.dart';
import '../tema.dart';

/// "QUEM VAI ATENDER?" (protótipo, tela 2): o PIN da pessoa (o mesmo do ponto). O PIN diz quem pegou cada caso e libera
/// o que o perfil pode (disputa e 99: só gerente e presidente). O aparelho pode ser de uso comum.
class TelaPin extends StatefulWidget {
  final String? aviso;
  final VoidCallback aoEntrar;
  final VoidCallback aoEsquecer;
  const TelaPin({super.key, this.aviso, required this.aoEntrar, required this.aoEsquecer});

  @override
  State<TelaPin> createState() => _TelaPinState();
}

class _TelaPinState extends State<TelaPin> {
  String _pin = '';
  bool _enviando = false;
  String? _erro;
  bool _naoReconhecido = false;

  void _tecla(String t) {
    if (_enviando) return;
    setState(() {
      _erro = null;
      if (t == 'apagar') {
        if (_pin.isNotEmpty) _pin = _pin.substring(0, _pin.length - 1);
      } else if (_pin.length < 6) {
        _pin += t;
      }
    });
  }

  Future<void> _entrar() async {
    if (_pin.length < 4) {
      setState(() => _erro = 'O PIN tem de 4 a 6 números.');
      return;
    }
    setState(() {
      _enviando = true;
      _erro = null;
    });
    try {
      await Api.entrar(_pin);
      widget.aoEntrar();
    } on ApiErro catch (e) {
      if (e.revogado) {
        Api.aoPerderAcesso?.call(e); // esquece o pareamento e volta ao "Primeira vez neste aparelho"
        return;
      }
      setState(() {
        _erro = e.mensagem;
        _naoReconhecido = e.codigo == 'TERMINAL_NAO_RECONHECIDO';
        _pin = '';
      });
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<void> _parearDeNovo() async {
    await Api.esquecerPareamento();
    widget.aoEsquecer();
  }

  @override
  Widget build(BuildContext context) {
    Widget tecla(String t, {String? rotulo, VoidCallback? acao}) => Expanded(
          child: Padding(
            padding: const EdgeInsets.all(6),
            child: SizedBox(
              height: 62,
              child: OutlinedButton(
                onPressed: _enviando ? null : (acao ?? () => _tecla(t)),
                style: OutlinedButton.styleFrom(backgroundColor: Colors.white),
                child: Text(rotulo ?? t, style: TextStyle(fontSize: rotulo == null ? 24 : 15, fontWeight: FontWeight.w700)),
              ),
            ),
          ),
        );
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 420),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  // O texto encolhe (letra grande de acessibilidade, celular estreito): a linha nunca estoura.
                  const Row(children: [
                    Selo('Pareado', cor: kVerde),
                    SizedBox(width: 8),
                    Flexible(child: Text('Regem Atendimento', maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(color: kTinta2))),
                  ]),
                  if (widget.aviso != null) ...[
                    const SizedBox(height: 12),
                    Text(widget.aviso!, style: const TextStyle(color: kAviso, fontWeight: FontWeight.w600)),
                  ],
                  const SizedBox(height: 24),
                  const Text('Quem vai atender?', textAlign: TextAlign.center, style: TextStyle(fontSize: 22, fontWeight: FontWeight.w800)),
                  const SizedBox(height: 4),
                  const Text('Digite o seu PIN, o mesmo do ponto', textAlign: TextAlign.center, style: TextStyle(color: kTinta2)),
                  const SizedBox(height: 18),
                  Semantics(
                    label: '${_pin.length} números digitados',
                    child: Row(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: List.generate(
                        _pin.length < 4 ? 4 : _pin.length,
                        (i) => Container(
                          width: 16,
                          height: 16,
                          margin: const EdgeInsets.symmetric(horizontal: 7),
                          decoration: BoxDecoration(
                            shape: BoxShape.circle,
                            color: i < _pin.length ? kNavy : Colors.transparent,
                            border: Border.all(color: kNavy, width: 2),
                          ),
                        ),
                      ),
                    ),
                  ),
                  if (_erro != null) ...[
                    const SizedBox(height: 12),
                    Text(_erro!, textAlign: TextAlign.center, style: const TextStyle(color: kPerigo, fontWeight: FontWeight.w600)),
                  ],
                  const SizedBox(height: 16),
                  for (final linha in const [
                    ['1', '2', '3'],
                    ['4', '5', '6'],
                    ['7', '8', '9'],
                  ])
                    Row(children: [for (final t in linha) tecla(t)]),
                  Row(children: [
                    tecla('apagar', rotulo: 'Apagar'),
                    tecla('0'),
                    tecla('entrar', rotulo: _enviando ? 'Entrando…' : 'Entrar', acao: _entrar),
                  ]),
                  const SizedBox(height: 14),
                  const Text(
                    'O aparelho pode ser de uso comum: cada um entra com o seu PIN e sai no fim do turno. Quem respondeu fica registrado no caso.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: kTinta2, height: 1.4),
                  ),
                  if (_naoReconhecido) ...[
                    const SizedBox(height: 10),
                    TextButton(onPressed: _parearDeNovo, child: const Text('Parear este celular de novo')),
                  ],
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
