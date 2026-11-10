import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../conversa.dart';
import '../modelo.dart';
import '../tema.dart';
import 'botao_copiloto.dart';

/// A CONVERSA DO CASO NO APP (1.1): o chat do iFood e da 99 (pela ponte do PC da loja), o Direct do Instagram e o Messenger
/// — os mesmos blocos da tela Atendimento do computador, pelas mesmas rotas. Relê a cada 5 s (só a leitura mais nova vale —
/// V64); "não li" aparece diferente de "vazio" (V37). Responde quem responde no computador (presidente, gerente e supervisão
/// — o servidor confere); as respostas prontas e a sugestão do copiloto vão para o campo, nunca saem sozinhas.
class ConversaDoCanal extends StatefulWidget {
  final Caso caso;
  final CanalDaConversa canal;
  final bool podeResponder;

  const ConversaDoCanal({super.key, required this.caso, required this.canal, required this.podeResponder});

  @override
  State<ConversaDoCanal> createState() => _ConversaDoCanalState();
}

class _ConversaDoCanalState extends State<ConversaDoCanal> {
  ConversaLida? _conv;
  String? _erro;
  int _leitura = 0;
  Timer? _t;
  final _texto = TextEditingController();
  bool _enviando = false;
  String? _aviso;

  String get _parte => caminhoDaConversa(widget.canal);

  @override
  void initState() {
    super.initState();
    _ler();
    _t = Timer.periodic(const Duration(seconds: 5), (_) => _ler());
    _texto.addListener(() {
      if (mounted) setState(() {}); // o contador e o botão acompanham o que se escreve
    });
  }

  @override
  void dispose() {
    _t?.cancel();
    _texto.dispose();
    super.dispose();
  }

  Future<void> _ler() async {
    final n = ++_leitura;
    try {
      final j = await Api.conversaDoCaso(widget.caso.id, _parte);
      if (!mounted || n != _leitura) return;
      setState(() {
        _conv = lerConversa(widget.canal, widget.caso, j);
        _erro = null;
      });
    } on ApiErro catch (e) {
      if (mounted && n == _leitura) setState(() => _erro = e.mensagem);
    }
  }

  String get _rotuloDoEnvio => switch (widget.canal) {
        CanalDaConversa.chat => widget.caso.canal == 'ifood' ? 'Enviar pelo iFood' : 'Enviar pela 99',
        CanalDaConversa.direct => 'Enviar no Direct',
        CanalDaConversa.messenger => 'Enviar no Messenger',
      };

  Future<void> _enviar() async {
    final t = _texto.text.trim();
    final problema = conferirTexto(widget.canal, t);
    if (problema != null) {
      setState(() => _aviso = problema);
      return;
    }
    if (_enviando) return;
    setState(() {
      _enviando = true;
      _aviso = null;
    });
    try {
      await Api.responderNoCaso(widget.caso.id, _parte, t);
      if (!mounted) return;
      _texto.clear();
      avisar(context, widget.canal == CanalDaConversa.chat ? 'Na fila da ponte: sai pelo PC da loja.' : 'Mensagem enviada.');
      await _ler();
    } on ApiErro catch (e) {
      if (mounted) setState(() => _aviso = e.mensagem); // o texto fica no campo
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  void _noCampo(String t) {
    _texto.text = t;
    _texto.selection = TextSelection.collapsed(offset: t.length);
    setState(() => _aviso = null);
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.caso;
    final conv = _conv;
    final nome = (c.cliente?.isNotEmpty ?? false) ? c.cliente! : 'o cliente';
    final podeEscrever = c.aberto && widget.podeResponder && (conv?.podeEnviar ?? false);
    final prontas = prontasDaConversa(widget.canal);
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: kNavy.withValues(alpha: 0.08))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('${tituloDaConversa(widget.canal, c)} com $nome', style: const TextStyle(fontWeight: FontWeight.w800)),
        if (widget.canal == CanalDaConversa.chat) const Text('pela ponte do PC da loja', style: TextStyle(fontSize: 12, color: kTinta2)),
        const SizedBox(height: 6),
        if (_erro != null)
          _faixa('Não consegui ler a conversa agora ($_erro). ${conv != null ? 'Mostrando a última leitura; ' : ''}tentando de novo em instantes.', kPerigo),
        if (conv?.aviso != null) _faixa(conv!.aviso!, kAviso),
        if (conv == null && _erro == null) const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator())),
        if (conv != null && conv.mensagens.isEmpty) const Text('Ainda não há mensagens desta conversa.', style: TextStyle(color: kTinta2)),
        if (conv != null)
          for (final m in conv.mensagens) _balao(m),
        if (podeEscrever) ...[
          const SizedBox(height: 8),
          Wrap(spacing: 6, runSpacing: 6, children: [
            for (final p in prontas) ActionChip(label: Text(p, style: const TextStyle(fontSize: 13)), onPressed: () => _noCampo(p)),
          ]),
          BotaoCopiloto(
            casoId: c.id,
            temDoCliente: temMensagemDoCliente(conv!.mensagens),
            mensagens: () => paraOCopiloto(_conv?.mensagens ?? const []),
            prontas: prontas,
            aoSugerir: _noCampo,
          ),
          const SizedBox(height: 8),
          // O campo na largura toda e o botão embaixo: "Enviar pelo iFood" ao lado do campo estourava num celular de 360.
          TextField(
            controller: _texto,
            minLines: 1,
            maxLines: 5,
            textCapitalization: TextCapitalization.sentences,
            decoration: InputDecoration(
              hintText: 'Escreva ou use o microfone do teclado',
              counterText: widget.canal == CanalDaConversa.chat ? '${_texto.text.length}/$textoMaxDoChat' : null,
            ),
          ),
          const SizedBox(height: 6),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton(
              onPressed: _enviando || _texto.text.trim().isEmpty ? null : _enviar,
              child: Text(_enviando ? 'Enviando…' : _rotuloDoEnvio),
            ),
          ),
          if (_aviso != null) Padding(padding: const EdgeInsets.only(top: 4), child: Text(_aviso!, style: const TextStyle(color: kPerigo, fontWeight: FontWeight.w600))),
        ] else if (conv != null && c.aberto && conv.podeEnviar && !widget.podeResponder)
          const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text('Quem responde é a gerência ou a supervisão. Pegue o caso e chame quem responde.', style: TextStyle(color: kTinta2)),
          )
        else if (conv != null && c.aberto && widget.podeResponder && conv.motivoSemEnvio != null)
          Padding(padding: const EdgeInsets.only(top: 8), child: Text(conv.motivoSemEnvio!, style: const TextStyle(color: kTinta2))),
        if (conv?.rodape != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(conv!.rodape!, style: const TextStyle(fontSize: 12, color: kTinta2))),
      ]),
    );
  }

  Widget _faixa(String texto, Color cor) => Container(
        margin: const EdgeInsets.only(bottom: 8),
        padding: const EdgeInsets.all(10),
        decoration: BoxDecoration(color: cor.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(10), border: Border.all(color: cor.withValues(alpha: 0.3))),
        child: Text(texto),
      );

  Widget _balao(MensagemDaConversa m) {
    final pe = [if (m.daLoja && m.quem.isNotEmpty) m.quem, if (m.quando != null) hora(m.quando)].join(' · ');
    return Align(
      alignment: m.daLoja ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.8),
        decoration: BoxDecoration(
          color: m.daLoja ? kOuro.withValues(alpha: 0.14) : const Color(0xFFF1F3F6),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Align(alignment: Alignment.centerLeft, child: Text(m.texto)),
          if (pe.isNotEmpty) Text(pe, style: const TextStyle(fontSize: 11, color: kTinta2)),
          if (m.situacao != null)
            Text(m.situacao!, style: TextStyle(fontSize: 11.5, fontWeight: FontWeight.w700, color: m.falhou ? kPerigo : kNavy)),
        ]),
      ),
    );
  }
}
