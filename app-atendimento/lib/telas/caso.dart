import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../api.dart';
import '../modelo.dart';
import '../tema.dart';

/// UM CASO (protótipo, telas 4 e 5). O resumo do robô vem primeiro; no WhatsApp, a conversa com as respostas prontas
/// (vão para o campo, nunca saem sozinhas). Disputa do iFood e pedido da 99: o relógio, o que o cliente pede e — só para
/// gerente e presidente — a resposta, confirmada com o PIN de quem está no app. As ações são as mesmas do computador.
class TelaCaso extends StatefulWidget {
  final Caso caso;
  const TelaCaso({super.key, required this.caso});

  @override
  State<TelaCaso> createState() => _TelaCasoState();
}

class _TelaCasoState extends State<TelaCaso> {
  final Sessao _eu = Api.sessao!;
  late Caso _c = widget.caso;
  DateTime _agora = DateTime.now();
  Timer? _tCaso;
  Timer? _tRelogio;
  Timer? _tConversa;
  bool _fazendo = false;

  // A conversa do WhatsApp (a mesma caixa de Delivery › WhatsApp).
  String? _jids;
  List<Map<String, dynamic>>? _msgs;
  String? _erroConversa;
  final _texto = TextEditingController();
  bool _enviando = false;

  bool get _temConversa => _c.canal == 'whatsapp' && (_c.telefone ?? '').isNotEmpty && _eu.conversa;

  @override
  void initState() {
    super.initState();
    _tCaso = Timer.periodic(const Duration(seconds: 10), (_) => _reler());
    _tRelogio = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _c.prazoEm != null) setState(() => _agora = DateTime.now());
    });
    if (_temConversa) _abrirConversa();
  }

  @override
  void dispose() {
    _tCaso?.cancel();
    _tRelogio?.cancel();
    _tConversa?.cancel();
    _texto.dispose();
    super.dispose();
  }

  /// O caso como está agora (outra pessoa pode ter pegado ou resolvido).
  Future<void> _reler() async {
    try {
      final r = await Api.fila();
      final achou = ((r['casos'] as List?) ?? const []).whereType<Map>().where((m) => '${m['id']}' == _c.id).toList();
      if (!mounted) return;
      if (achou.isEmpty) {
        // Saiu da fila aberta: foi resolvido (aqui ou no computador).
        if (_c.aberto) setState(() => _c = Caso({..._c.bruto, 'situacao': 'resolvido'}));
        return;
      }
      setState(() {
        _c = Caso(Map<String, dynamic>.from(achou.first));
        _agora = DateTime.now();
      });
    } catch (_) {/* sem rede: fica o que está na tela */}
  }

  Future<void> _fazer(Future<void> Function() acao, String feito, {bool sai = false}) async {
    if (_fazendo) return;
    setState(() => _fazendo = true);
    try {
      await acao();
      if (!mounted) return;
      avisar(context, feito);
      if (sai) {
        Navigator.of(context).pop();
        return;
      }
      await _reler();
    } on ApiErro catch (e) {
      if (mounted) avisar(context, e.mensagem, erro: true);
      await _reler();
    } finally {
      if (mounted) setState(() => _fazendo = false);
    }
  }

  // ===================== A conversa =====================

  Future<void> _abrirConversa() async {
    final numero = numeroDoWhatsapp(_c.telefone);
    try {
      final lista = await Api.conversas();
      final achou = lista.whereType<Map>().where((x) => mesmoNumero('${x['telefone'] ?? ''}', numero)).toList();
      final jids = achou.isNotEmpty && achou.first['jids'] is List && (achou.first['jids'] as List).isNotEmpty
          ? (achou.first['jids'] as List).join(',')
          : '$numero@s.whatsapp.net';
      if (!mounted) return;
      setState(() => _jids = jids);
      await _lerMensagens();
      _tConversa = Timer.periodic(const Duration(seconds: 5), (_) => _lerMensagens());
    } on ApiErro catch (e) {
      if (mounted) setState(() => _erroConversa = e.mensagem);
    }
  }

  Future<void> _lerMensagens() async {
    final j = _jids;
    if (j == null) return;
    try {
      final m = await Api.mensagens(j);
      final todas = m.whereType<Map>().map((x) => Map<String, dynamic>.from(x)).toList();
      if (mounted) setState(() => _msgs = todas.length > 40 ? todas.sublist(todas.length - 40) : todas);
    } on ApiErro catch (e) {
      if (mounted) setState(() => _erroConversa = e.mensagem);
    }
  }

  Future<void> _enviar() async {
    final t = _texto.text.trim();
    if (t.isEmpty || _enviando) return;
    setState(() {
      _enviando = true;
      _texto.clear();
      _msgs = [...?_msgs, {'id': 'tmp', 'fromMe': true, 'texto': t, 'timestamp': DateTime.now().millisecondsSinceEpoch ~/ 1000}];
    });
    try {
      await Api.enviar(numeroDoWhatsapp(_c.telefone), t);
      Future.delayed(const Duration(milliseconds: 800), _lerMensagens);
    } on ApiErro catch (e) {
      if (mounted) {
        avisar(context, e.mensagem, erro: true);
        _texto.text = t; // o texto volta para o campo
      }
      _lerMensagens();
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  // ===================== Passar =====================

  Future<void> _passar() async {
    List<dynamic> equipe;
    try {
      equipe = await Api.equipe();
    } on ApiErro catch (e) {
      if (mounted) avisar(context, e.mensagem, erro: true);
      return;
    }
    if (!mounted) return;
    final opcoes = equipe.whereType<Map>().where((p) => '${p['id']}' != _c.responsavelId).toList();
    final para = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true,
      builder: (ctx) => SafeArea(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.7),
          child: ListView(
            shrinkWrap: true,
            children: [
              const Padding(
                padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
                child: Text('Passar o caso para', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
              ),
              if (_c.responsavelId != null) ListTile(title: const Text('De volta para a fila (ninguém)'), onTap: () => Navigator.pop(ctx, 'fila')),
              for (final p in opcoes)
                ListTile(
                  title: Text('${p['nome']}${p['eu'] == true ? ' (você)' : ''}'),
                  subtitle: p['presenca'] is Map
                      ? Text((p['presenca'] as Map)['estado'] == 'disponivel' ? 'disponível no app' : 'ocupado${(p['presenca'] as Map)['motivo'] != null ? ': ${(p['presenca'] as Map)['motivo']}' : ''}')
                      : null,
                  onTap: () => Navigator.pop(ctx, '${p['id']}'),
                ),
              if (opcoes.isEmpty) const ListTile(title: Text('Ninguém mais ativo nesta loja.')),
            ],
          ),
        ),
      ),
    );
    if (para == null) return;
    await _fazer(() => Api.passar(_c.id, para == 'fila' ? null : para), para == 'fila' ? 'O caso voltou para a fila.' : 'Caso passado.', sai: true);
  }

  Future<void> _resolver() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Resolver o caso?'),
        content: const Text('O caso sai da fila e vai para "Feitos". O robô volta a responder na conversa.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Voltar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Resolver')),
        ],
      ),
    );
    if (ok == true) await _fazer(() => Api.resolver(_c.id), 'Caso resolvido.', sai: true);
  }

  // ===================== Tela =====================

  @override
  Widget build(BuildContext context) {
    final meu = _c.responsavelId == _eu.colaboradorId;
    final robo = _c.robo;
    return Scaffold(
      appBar: AppBar(
        title: Text(_c.rotulo),
        actions: [
          Padding(
            padding: const EdgeInsets.only(right: 14),
            child: Center(
              child: Text(
                meu ? 'com você · ${tempoDesde(_c.pegoEm, _agora)}' : (_c.responsavelNome ?? ''),
                style: const TextStyle(fontSize: 12.5, color: Color(0xFF9FB2C4)),
              ),
            ),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 24),
        children: [
          Wrap(spacing: 6, runSpacing: 4, children: [
            Selo(_c.rotuloCanal, cor: corDoCanal(_c.canal), cheio: true),
            if (_c.urgente) const Selo('🚨 Urgente', cor: kPerigo),
            Selo(_c.rotulo),
            if (_c.situacao == 'aguardando') const Selo('Aguardando o cliente', cor: kTinta2),
            if (_c.escalado != null) const Selo('⏰ Gerente avisado', cor: kAviso),
            if (!_c.aberto) const Selo('Resolvido', cor: kVerde),
          ]),
          const SizedBox(height: 8),
          Text(_c.titulo, style: const TextStyle(fontSize: 19, fontWeight: FontWeight.w800)),
          if ((_c.telefone ?? '').isNotEmpty) Text(_c.telefone!, style: const TextStyle(color: kTinta2)),
          const SizedBox(height: 10),
          if (_c.tipo == 'disputa') _Disputa(caso: _c, agora: _agora, decide: _eu.decide, aoResponder: _reler),
          if (_c.tipo == 'cancelamento_99' || _c.tipo == 'reembolso_99') _Pedido99(caso: _c, agora: _agora, decide: _eu.decide, aoResponder: _reler),
          if (robo != null) _roboResumiu(robo),
          if ((_c.mensagem ?? '').trim().isNotEmpty && !_c.daPlataforma) _bloco('O que o cliente precisa', Text(_c.mensagem!.trim())),
          if (_c.tipo == 'cancelamento')
            _bloco(
              'Pedido de cancelamento',
              const Text('Aceitar ou recusar o cancelamento: no computador, na tela Atendimento, com a senha de quem decide (lá dá para escolher o que volta para o estoque).'),
            ),
          if (_c.canal == 'whatsapp' && !_eu.conversa)
            _bloco('Conversa no WhatsApp', const Text('Quem responde pelo WhatsApp é a gerência ou a supervisão. Pegue o caso e chame quem responde.')),
          if (_temConversa) _conversa(),
        ],
      ),
      bottomNavigationBar: _c.aberto && !_c.daPlataforma ? _acoes(meu) : null,
    );
  }

  Widget _acoes(bool meu) => SafeArea(
        child: Container(
          color: Colors.white,
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 8),
          child: Row(children: [
            if (!meu)
              Expanded(
                child: FilledButton(
                  onPressed: _fazendo ? null : () => _fazer(() => Api.pegar(_c.id), 'O caso é seu.'),
                  child: const Text('Pegar'),
                ),
              ),
            if (!meu) const SizedBox(width: 8),
            Expanded(child: OutlinedButton(onPressed: _fazendo ? null : _passar, child: const Text('Passar'))),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton(
                onPressed: _fazendo
                    ? null
                    : () => _fazer(
                          () => Api.aguardar(_c.id, _c.situacao != 'aguardando'),
                          _c.situacao == 'aguardando' ? 'O caso voltou.' : 'Aguardando o cliente.',
                        ),
                child: Text(_c.situacao == 'aguardando' ? 'Voltar' : 'Aguardar', maxLines: 1),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: FilledButton(
                style: FilledButton.styleFrom(backgroundColor: kVerde, foregroundColor: Colors.white),
                onPressed: _fazendo ? null : _resolver,
                child: const Text('Resolver'),
              ),
            ),
          ]),
        ),
      );

  Widget _roboResumiu(Map<String, dynamic> r) {
    final linhas = <MapEntry<String, String>>[
      if ((r['motivo'] ?? '').toString().trim().isNotEmpty) MapEntry('Motivo', '${r['motivo']}'),
      if ((r['quer'] ?? '').toString().trim().isNotEmpty) MapEntry('Quer', '${r['quer']}'),
      if ((r['jaFez'] ?? '').toString().trim().isNotEmpty) MapEntry('O robô já fez', '${r['jaFez']}'),
    ];
    if (linhas.isEmpty) return const SizedBox.shrink();
    return Container(
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: const Color(0xFFF6F9FC), borderRadius: BorderRadius.circular(14), border: Border.all(color: kNavy.withValues(alpha: 0.08))),
      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text('O ROBÔ RESUMIU${r['humor'] == 'chateado' ? ' · cliente chateado' : ''}', style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: kTinta2)),
        const SizedBox(height: 4),
        for (final l in linhas)
          Padding(
            padding: const EdgeInsets.only(top: 3),
            child: Text.rich(TextSpan(children: [
              TextSpan(text: '${l.key}: ', style: const TextStyle(fontWeight: FontWeight.w700)),
              TextSpan(text: l.value),
            ])),
          ),
      ]),
    );
  }

  Widget _bloco(String titulo, Widget filho) => Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: kNavy.withValues(alpha: 0.08))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(titulo, style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          filho,
        ]),
      );

  Widget _conversa() {
    final prontas = prontasDoTipo[_c.tipo] ?? prontasDoTipo['geral']!;
    final msgs = _msgs;
    return _bloco(
      'Conversa no WhatsApp',
      Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        if (_erroConversa != null) Text(_erroConversa!, style: const TextStyle(color: kPerigo)),
        if (msgs == null && _erroConversa == null) const Padding(padding: EdgeInsets.all(12), child: Center(child: CircularProgressIndicator())),
        if (msgs != null && msgs.isEmpty) const Text('Ainda não há mensagens com este cliente. Você pode escrever a primeira.', style: TextStyle(color: kTinta2)),
        if (msgs != null)
          for (final m in msgs) _balao(m),
        const SizedBox(height: 8),
        Wrap(spacing: 6, runSpacing: 6, children: [
          for (final p in prontas)
            ActionChip(
              label: Text(p, style: const TextStyle(fontSize: 13)),
              onPressed: () {
                _texto.text = p;
                _texto.selection = TextSelection.collapsed(offset: p.length);
              },
            ),
        ]),
        const SizedBox(height: 8),
        Row(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Expanded(
            child: TextField(
              controller: _texto,
              minLines: 1,
              maxLines: 5,
              textCapitalization: TextCapitalization.sentences,
              decoration: const InputDecoration(hintText: 'Escreva ou use o microfone do teclado'),
            ),
          ),
          const SizedBox(width: 8),
          FilledButton(onPressed: _enviando ? null : _enviar, child: const Text('Enviar')),
        ]),
        const SizedBox(height: 6),
        const Text('O robô fica quieto nesta conversa enquanto o caso está aberto.', style: TextStyle(fontSize: 12, color: kTinta2)),
      ]),
    );
  }

  Widget _balao(Map<String, dynamic> m) {
    final minha = m['fromMe'] == true;
    final texto = (m['texto'] ?? '').toString();
    final ts = (m['timestamp'] as num?)?.toInt() ?? 0;
    final quando = ts > 0 ? hora(DateTime.fromMillisecondsSinceEpoch(ts * 1000)) : '';
    return Align(
      alignment: minha ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: 3),
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 7),
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.75),
        decoration: BoxDecoration(color: minha ? const Color(0xFFDCF3E6) : const Color(0xFFF1F3F6), borderRadius: BorderRadius.circular(12)),
        child: Column(crossAxisAlignment: CrossAxisAlignment.end, children: [
          Text(texto.isEmpty ? (m['midia'] != null ? '[mídia — veja no computador]' : '') : texto),
          Text(quando, style: const TextStyle(fontSize: 11, color: kTinta2)),
        ]),
      ),
    );
  }
}

// ===================== Confirmar com o PIN =====================

/// O PIN de quem está no app confirma a resposta à plataforma (o servidor confere: só gerente e presidente).
Future<String?> pedirPin(BuildContext context, String titulo) {
  final c = TextEditingController();
  return showDialog<String>(
    context: context,
    builder: (ctx) => AlertDialog(
      title: Text(titulo),
      content: TextField(
        controller: c,
        autofocus: true,
        obscureText: true,
        keyboardType: TextInputType.number,
        inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
        decoration: const InputDecoration(labelText: 'Confirme com o seu PIN'),
      ),
      actions: [
        TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Voltar')),
        FilledButton(onPressed: () => Navigator.pop(ctx, c.text), child: const Text('Confirmar')),
      ],
    ),
  );
}

/// O relógio da plataforma: quanto falta e o que acontece sem resposta.
class _Relogio extends StatelessWidget {
  final String prazo;
  final String texto;
  const _Relogio({required this.prazo, required this.texto});

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: kPerigo.withValues(alpha: 0.08), borderRadius: BorderRadius.circular(14), border: Border.all(color: kPerigo.withValues(alpha: 0.35))),
        child: Row(children: [
          Text(prazo, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800)),
          const SizedBox(width: 12),
          Expanded(child: Text(texto, style: const TextStyle(fontSize: 13.5))),
        ]),
      );
}

// ===================== Disputa do iFood =====================

class _Disputa extends StatefulWidget {
  final Caso caso;
  final DateTime agora;
  final bool decide;
  final Future<void> Function() aoResponder;
  const _Disputa({required this.caso, required this.agora, required this.decide, required this.aoResponder});

  @override
  State<_Disputa> createState() => _DisputaState();
}

class _DisputaState extends State<_Disputa> {
  bool _enviando = false;
  final Map<int, Uint8List> _fotos = {};

  Map<String, dynamic> get _d => widget.caso.detalhe['disputa'] is Map ? Map<String, dynamic>.from(widget.caso.detalhe['disputa'] as Map) : const {};

  Future<void> _verFoto(int n) async {
    try {
      final b = _fotos[n] ?? await Api.fotoDaDisputa(widget.caso.id, n);
      _fotos[n] = b;
      if (!mounted) return;
      showDialog(context: context, builder: (_) => Dialog(child: InteractiveViewer(child: Image.memory(b))));
    } on ApiErro catch (e) {
      if (mounted) avisar(context, e.mensagem, erro: true);
    }
  }

  Future<void> _responder(String acao, {Map<String, dynamic>? alt}) async {
    final d = _d;
    String? motivo;
    int? centavos;
    int? minutos;
    if (acao == 'aceitar') {
      final aceite = (d['motivosParaAceitar'] as List?)?.map((e) => '$e').toList() ?? const [];
      motivo = aceite.isEmpty ? null : await _escolher('Por que aceitar?', aceite);
      if (aceite.isNotEmpty && motivo == null) return;
    } else if (acao == 'recusar') {
      motivo = await _escolher('Por que recusar?', motivoIfood.keys.toList());
      if (motivo == null) return;
    } else if (alt != null) {
      final tipo = '${alt['tipo']}';
      if (tipo == 'ADDITIONAL_TIME') {
        final ops = (alt['minutos'] as List?)?.map((e) => (e as num).toInt()).toList() ?? const <int>[];
        if (ops.isEmpty) return;
        final m = await _escolher('Quanto tempo a mais?', ops.map((e) => '$e').toList(), rotulo: (s) => '$s min');
        if (m == null) return;
        minutos = int.parse(m);
        final mot = (alt['motivos'] as List?)?.map((e) => '$e').toList() ?? const [];
        if (mot.isNotEmpty) motivo = mot.first;
      } else {
        final max = (alt['maxCentavos'] as num?)?.toInt();
        final v = await _valor(max);
        if (v == null) return;
        centavos = v;
      }
    }
    if (!mounted) return;
    final pin = await pedirPin(context, acao == 'aceitar' ? 'Aceitar o pedido do cliente' : acao == 'recusar' ? 'Recusar o pedido do cliente' : nomeDaProposta['${alt?['tipo']}'] ?? 'Propor');
    if (pin == null || pin.isEmpty) return;
    setState(() => _enviando = true);
    try {
      await Api.responderDisputa(widget.caso.id, {
        'acao': acao,
        'pin': pin,
        'motivo': ?motivo,
        if (alt != null) 'tipo': '${alt['tipo']}',
        'centavos': ?centavos,
        'minutos': ?minutos,
      });
      if (mounted) avisar(context, 'Resposta enviada ao iFood.');
      await widget.aoResponder();
    } on ApiErro catch (e) {
      if (mounted) avisar(context, e.mensagem, erro: true);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Future<String?> _escolher(String titulo, List<String> opcoes, {String Function(String)? rotulo}) => showModalBottomSheet<String>(
        context: context,
        showDragHandle: true,
        builder: (ctx) => SafeArea(
          child: ListView(shrinkWrap: true, children: [
            Padding(padding: const EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text(titulo, style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800))),
            for (final o in opcoes) ListTile(title: Text(rotulo?.call(o) ?? (motivoIfood[o] ?? o)), onTap: () => Navigator.pop(ctx, o)),
          ]),
        ),
      );

  Future<int?> _valor(int? maxCentavos) {
    final c = TextEditingController();
    return showDialog<int>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Quanto devolver?'),
        content: TextField(
          controller: c,
          autofocus: true,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: InputDecoration(labelText: 'Valor em reais', helperText: maxCentavos != null ? 'O iFood aceita no máximo ${brl(maxCentavos)}.' : null),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Voltar')),
          FilledButton(
            onPressed: () {
              final v = (double.tryParse(c.text.replaceAll('.', '').replaceAll(',', '.')) ?? 0) * 100;
              final cent = v.round();
              if (cent <= 0 || (maxCentavos != null && cent > maxCentavos)) return;
              Navigator.pop(ctx, cent);
            },
            child: const Text('Continuar'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d.isEmpty) return const SizedBox.shrink();
    final c = widget.caso;
    final resposta = c.detalhe['resposta'];
    final prazo = tempoAte(c.prazoEm, widget.agora);
    final aberta = c.aberto && resposta == null && prazo != 'venceu';
    final itens = (d['itens'] as List?) ?? const [];
    final fotos = (d['fotos'] as List?)?.length ?? 0;
    final alternativas = ((d['alternativas'] as List?) ?? const []).whereType<Map>().map((m) => Map<String, dynamic>.from(m)).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (aberta && prazo.isNotEmpty)
        _Relogio(prazo: prazo, texto: 'Se ninguém responder até ${hora(c.prazoEm)}, ${sozinhoIfood['${d['acaoAutomatica']}'] ?? 'o iFood decide sozinho.'}'),
      Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: kNavy.withValues(alpha: 0.08))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('O que o cliente pede ao iFood', style: TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text(d['mensagem'] != null ? '"${d['mensagem']}"' : 'O cliente não escreveu nada.'),
          for (final i in itens.whereType<Map>())
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text('${i['quantidade'] ?? 1}× ${i['nome'] ?? i['codigo'] ?? 'item'}${i['centavos'] != null ? ' · ${brl((i['centavos'] as num).toInt())}' : ''}'),
            ),
          if (fotos > 0) ...[
            const SizedBox(height: 8),
            Wrap(spacing: 6, children: [for (var n = 0; n < fotos; n++) ActionChip(label: Text('Foto ${n + 1}'), onPressed: () => _verFoto(n))]),
          ],
        ]),
      ),
      if (resposta is Map)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Text('${resposta['por'] ?? 'A loja'} respondeu: ${resposta['acao']}${resposta['motivo'] != null ? ' (${motivoIfood[resposta['motivo']] ?? resposta['motivo']})' : ''}.',
              style: const TextStyle(fontWeight: FontWeight.w600)),
        ),
      if (aberta && !widget.decide)
        const Padding(
          padding: EdgeInsets.only(bottom: 10),
          child: Text('Só gerente e presidente respondem à disputa. Chame o gerente.', style: TextStyle(fontWeight: FontWeight.w600, color: kAviso)),
        ),
      if (aberta && widget.decide) ...[
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: kPerigo, foregroundColor: Colors.white),
          onPressed: _enviando ? null : () => _responder('aceitar'),
          child: const Text('Aceitar o pedido do cliente'),
        ),
        const SizedBox(height: 8),
        for (final a in alternativas) ...[
          OutlinedButton(onPressed: _enviando ? null : () => _responder('propor', alt: a), child: Text(nomeDaProposta['${a['tipo']}'] ?? 'Propor outra coisa')),
          const SizedBox(height: 8),
        ],
        OutlinedButton(onPressed: _enviando ? null : () => _responder('recusar'), child: const Text('Recusar')),
        const SizedBox(height: 10),
      ],
    ]);
  }
}

// ===================== Pedido da 99 =====================

class _Pedido99 extends StatefulWidget {
  final Caso caso;
  final DateTime agora;
  final bool decide;
  final Future<void> Function() aoResponder;
  const _Pedido99({required this.caso, required this.agora, required this.decide, required this.aoResponder});

  @override
  State<_Pedido99> createState() => _Pedido99State();
}

class _Pedido99State extends State<_Pedido99> {
  bool _enviando = false;

  Map<String, dynamic> get _p => widget.caso.detalhe['pedido99'] is Map ? Map<String, dynamic>.from(widget.caso.detalhe['pedido99'] as Map) : const {};

  Future<void> _responder(bool aceita) async {
    final p = _p;
    final cancelamento = widget.caso.tipo == 'cancelamento_99';
    final corpo = <String, dynamic>{'aceita': aceita};
    if (!aceita) {
      if (cancelamento) {
        final ops = (p['motivosDeRecusa'] as List?)?.map((e) => '$e').toList() ?? motivoCancelamento99.keys.toList();
        final m = await showModalBottomSheet<String>(
          context: context,
          showDragHandle: true,
          builder: (ctx) => SafeArea(
            child: ListView(shrinkWrap: true, children: [
              const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Por que recusar?', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800))),
              for (final o in ops) ListTile(title: Text(traduzir(motivoCancelamento99, o)), onTap: () => Navigator.pop(ctx, o)),
            ]),
          ),
        );
        if (m == null) return;
        corpo['motivo'] = m;
      } else {
        final ops = ((p['motivosDoReembolso'] as List?) ?? const []).whereType<Map>().toList();
        if (ops.isEmpty) return;
        if (!mounted) return;
        final m = await showModalBottomSheet<String>(
          context: context,
          showDragHandle: true,
          builder: (ctx) => SafeArea(
            child: ListView(shrinkWrap: true, children: [
              const Padding(padding: EdgeInsets.fromLTRB(20, 0, 20, 8), child: Text('Por que recusar?', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800))),
              for (final o in ops) ListTile(title: Text('${o['motivo'] ?? o['id']}'), onTap: () => Navigator.pop(ctx, '${o['id']}')),
            ]),
          ),
        );
        if (m == null) return;
        corpo['motivoId'] = m;
      }
    }
    if (!mounted) return;
    final pin = await pedirPin(context, aceita ? 'Aceitar o pedido do cliente' : 'Recusar o pedido do cliente');
    if (pin == null || pin.isEmpty) return;
    corpo['pin'] = pin;
    setState(() => _enviando = true);
    try {
      await Api.responderPedido99(widget.caso.id, corpo);
      if (mounted) avisar(context, 'Resposta enviada à 99.');
      await widget.aoResponder();
    } on ApiErro catch (e) {
      if (mounted) avisar(context, e.mensagem, erro: true);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = _p;
    if (p.isEmpty) return const SizedBox.shrink();
    final c = widget.caso;
    final cancelamento = c.tipo == 'cancelamento_99';
    final resposta = c.detalhe['resposta'];
    final prazo = tempoAte(c.prazoEm, widget.agora);
    final aberta = c.aberto && resposta == null && prazo != 'venceu' && c.detalhe['recusaAutomatica'] == null;
    final podeRecusar = cancelamento || ((p['motivosDoReembolso'] as List?)?.isNotEmpty ?? false);
    final fotos = ((p['fotos'] as List?) ?? const []).map((e) => '$e').where((u) => u.startsWith('https://')).toList();
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (aberta && prazo.isNotEmpty)
        _Relogio(
          prazo: prazo,
          texto: cancelamento
              ? 'Se ninguém responder até ${hora(c.prazoEm)}, a 99 recusa sozinha o cancelamento.'
              : 'Se ninguém responder até ${hora(c.prazoEm)}, o Regem recusa o reembolso com o motivo do ajuste.',
        ),
      Container(
        margin: const EdgeInsets.only(bottom: 10),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14), border: Border.all(color: kNavy.withValues(alpha: 0.08))),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(cancelamento ? 'O cliente quer cancelar' : 'O cliente pede reembolso', style: const TextStyle(fontWeight: FontWeight.w800)),
          const SizedBox(height: 6),
          Text(p['motivoDoCliente'] != null ? '"${p['motivoDoCliente']}"' : 'O cliente não escreveu nada.'),
          if (fotos.isNotEmpty) ...[
            const SizedBox(height: 8),
            SizedBox(
              height: 84,
              child: ListView(scrollDirection: Axis.horizontal, children: [
                for (final u in fotos)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: GestureDetector(
                      onTap: () => showDialog(context: context, builder: (_) => Dialog(child: InteractiveViewer(child: Image.network(u)))),
                      child: ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.network(u, width: 84, height: 84, fit: BoxFit.cover)),
                    ),
                  ),
              ]),
            ),
          ],
          const SizedBox(height: 6),
          const Text('A 99 não tem chat para sistemas: a conversa com o cliente fica no app 99Food Parceiros.', style: TextStyle(fontSize: 12.5, color: kTinta2)),
        ]),
      ),
      if (resposta is Map)
        Padding(
          padding: const EdgeInsets.only(bottom: 10),
          child: Text('${resposta['por'] ?? 'A loja'} respondeu: ${resposta['acao']}.', style: const TextStyle(fontWeight: FontWeight.w600)),
        ),
      if (aberta && !widget.decide)
        const Padding(
          padding: EdgeInsets.only(bottom: 10),
          child: Text('Só gerente e presidente respondem à 99. Chame o gerente.', style: TextStyle(fontWeight: FontWeight.w600, color: kAviso)),
        ),
      if (aberta && widget.decide) ...[
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: kPerigo, foregroundColor: Colors.white),
          onPressed: _enviando ? null : () => _responder(true),
          child: Text(cancelamento ? 'Aceitar o cancelamento' : 'Aceitar o reembolso'),
        ),
        const SizedBox(height: 8),
        if (podeRecusar) OutlinedButton(onPressed: _enviando ? null : () => _responder(false), child: const Text('Recusar')),
        const SizedBox(height: 10),
      ],
    ]);
  }
}
