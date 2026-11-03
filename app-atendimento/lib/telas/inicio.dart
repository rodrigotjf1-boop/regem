import 'dart:async';

import 'package:flutter/material.dart';

import '../api.dart';
import '../avisos.dart';
import '../modelo.dart';
import '../tema.dart';
import 'caso.dart';

/// Os motivos do "Ocupado" (protótipo: "Ocupado: embalando"; no "Passar o caso": "ocupada: caixa").
const motivosDeOcupado = ['embalando', 'no caixa', 'na cozinha', 'entregando', 'em outro atendimento'];

/// A FILA (protótipo, tela 3): a mesma ordem do computador. "Ocupado" tira a pessoa da vez sem sair do app — o app só
/// toca para o que tem prazo. Relê a fila a cada 10 s e avisa a cada minuto que a pessoa está no app (sem aviso por
/// 3 min, ela sai da vez).
class TelaInicio extends StatefulWidget {
  final VoidCallback aoSair;
  const TelaInicio({super.key, required this.aoSair});

  @override
  State<TelaInicio> createState() => _TelaInicioState();
}

class _TelaInicioState extends State<TelaInicio> with WidgetsBindingObserver {
  final Sessao _eu = Api.sessao!;
  List<Caso> _casos = const [];
  List<Caso>? _feitos;
  bool _lida = false;
  String? _erro;
  DateTime? _lidaEm;
  DateTime _agora = DateTime.now();
  String _estado = 'disponivel';
  String? _motivo;
  int _aba = 0;
  Timer? _tFila;
  Timer? _tPresenca;
  Timer? _tRelogio;
  bool _lendo = false;

  // O que já foi visto (para avisar só do que é NOVO desde a leitura anterior; a primeira leitura não avisa).
  Set<String>? _vistos;
  final Set<String> _urgentesVistos = {};
  final Set<String> _escaladosVistos = {};

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _comecarPresenca();
    _ler();
    _tFila = Timer.periodic(const Duration(seconds: 10), (_) => _ler());
    _tPresenca = Timer.periodic(const Duration(seconds: 60), (_) => _avisarPresenca());
    _tRelogio = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted && _casos.any((c) => c.prazoEm != null)) setState(() => _agora = DateTime.now());
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _tFila?.cancel();
    _tPresenca?.cancel();
    _tRelogio?.cancel();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState s) {
    // Voltou para a frente: lê na hora (o Android pode ter segurado o app parado no fundo).
    if (s == AppLifecycleState.resumed) {
      _ler();
      _avisarPresenca();
    }
  }

  // ===================== Disponível / Ocupado =====================

  Future<void> _comecarPresenca() async {
    try {
      final p = await Api.presenca();
      final eu = p['eu'];
      if (eu is Map) {
        _estado = '${eu['estado']}';
        _motivo = eu['motivo'] as String?;
      }
    } catch (_) {/* sem rede: começa disponível e tenta no próximo aviso */}
    await _avisarPresenca();
  }

  Future<void> _avisarPresenca() async {
    try {
      await Api.marcar(_estado, motivo: _estado == 'ocupado' ? _motivo : null);
    } catch (_) {/* o próximo aviso (1 min) tenta de novo; a sessão vencida já foi tratada pela Api */}
    if (mounted) setState(() {});
  }

  Future<void> _ficarDisponivel() async {
    setState(() {
      _estado = 'disponivel';
      _motivo = null;
    });
    await _avisarPresenca();
  }

  Future<void> _ficarOcupado() async {
    // A lista rola: em tela baixa (celular deitado, aparelho pequeno) os 5 motivos não cabem na metade da tela.
    final m = await showModalBottomSheet<String>(
      context: context,
      showDragHandle: true,
      builder: (ctx) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.fromLTRB(20, 0, 20, 8),
              child: Text('Ocupado com o quê?', style: TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
            ),
            for (final m in motivosDeOcupado) ListTile(title: Text('Ocupado: $m'), onTap: () => Navigator.pop(ctx, m)),
          ],
        ),
      ),
    );
    if (m == null) return;
    setState(() {
      _estado = 'ocupado';
      _motivo = m;
    });
    await _avisarPresenca();
  }

  // ===================== A fila =====================

  Future<void> _ler() async {
    if (_lendo) return;
    _lendo = true;
    try {
      final r = await Api.fila();
      final casos = ((r['casos'] as List?) ?? const []).whereType<Map>().map((m) => Caso(Map<String, dynamic>.from(m))).toList();
      _avisarNovidades(casos);
      if (!mounted) return;
      setState(() {
        _casos = casos;
        _lida = true;
        _erro = null;
        _lidaEm = DateTime.now();
        _agora = DateTime.now();
      });
      if (_aba == 2) _lerFeitos();
    } on ApiErro catch (e) {
      if (mounted) setState(() => _erro = e.mensagem);
    } finally {
      _lendo = false;
    }
  }

  Future<void> _lerFeitos() async {
    try {
      final r = await Api.resolvidos();
      if (mounted) setState(() => _feitos = r.whereType<Map>().map((m) => Caso(Map<String, dynamic>.from(m))).toList());
    } on ApiErro catch (e) {
      if (mounted) setState(() => _erro = e.mensagem);
    }
  }

  /// O que mudou desde a leitura anterior vira aviso: caso novo (ocupado: só o que tem prazo), caso que virou urgente
  /// e, para gerente e presidente, o caso que ninguém pegou no tempo do ajuste.
  void _avisarNovidades(List<Caso> casos) {
    final primeira = _vistos == null;
    final vistos = _vistos ?? <String>{};
    for (final c in casos) {
      final novo = !vistos.contains(c.id);
      final ficouUrgente = c.urgente && !_urgentesVistos.contains(c.id);
      final escalou = c.escalado != null && !_escaladosVistos.contains(c.id);
      if (!primeira) {
        if (escalou && _eu.decide) {
          Avisos.mostrar('⏰ Ninguém pegou em ${c.escalado!.minutos} min', c.titulo, urgente: true);
        } else if (novo && c.aberto && c.responsavelId == null) {
          if (_estado == 'disponivel' || c.prazoEm != null) {
            Avisos.mostrar(c.urgente ? '🚨 Atendimento urgente' : '🔔 ${c.rotulo}', '${c.titulo}${c.linhaCurta != null ? ' — ${c.linhaCurta}' : ''}', urgente: c.urgente);
          }
        } else if (ficouUrgente && c.responsavelId == null) {
          Avisos.mostrar('🚨 Cliente chateado', c.titulo, urgente: true);
        }
      }
      vistos.add(c.id);
      if (c.urgente) _urgentesVistos.add(c.id);
      if (c.escalado != null) _escaladosVistos.add(c.id);
    }
    _vistos = vistos;
  }

  Future<void> _abrir(Caso c) async {
    await Navigator.of(context).push(MaterialPageRoute(builder: (_) => TelaCaso(caso: c)));
    _ler();
  }

  Future<void> _pegar(Caso c) async {
    try {
      await Api.pegar(c.id);
      if (!mounted) return;
      avisar(context, 'O caso é seu.');
      await _ler();
      final atualizado = _casos.where((x) => x.id == c.id).toList();
      if (atualizado.isNotEmpty && mounted) _abrir(atualizado.first);
    } on ApiErro catch (e) {
      if (mounted) avisar(context, e.mensagem, erro: true);
      _ler();
    }
  }

  Future<void> _sair() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Sair do app?'),
        content: const Text('Você sai da vez na hora. O celular continua pareado: a próxima pessoa entra com o PIN dela.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Voltar')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('Sair')),
        ],
      ),
    );
    if (ok != true) return;
    await Api.sair();
    widget.aoSair();
  }

  // ===================== Tela =====================

  List<Caso> get _comPrazo => _casos.where((c) => c.aberto && c.prazoEm != null).toList();
  List<Caso> get _naFila => _casos.where((c) => c.situacao == 'fila' && c.prazoEm == null).toList();
  List<Caso> get _comigo => _casos.where((c) => c.responsavelId == _eu.colaboradorId).toList();

  @override
  Widget build(BuildContext context) {
    final ocupado = _estado == 'ocupado';
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            _topo(ocupado),
            Expanded(
              child: RefreshIndicator(
                onRefresh: () async {
                  await _ler();
                  if (_aba == 2) await _lerFeitos();
                },
                child: switch (_aba) {
                  0 => _abaFila(ocupado),
                  1 => _lista(_comigo, vazio: 'Nenhum caso com você agora.'),
                  2 => _abaFeitos(),
                  _ => _abaEu(),
                },
              ),
            ),
          ],
        ),
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _aba,
        onDestinationSelected: (i) {
          setState(() => _aba = i);
          if (i == 2) _lerFeitos();
        },
        destinations: [
          NavigationDestination(icon: const Icon(Icons.inbox_outlined), label: 'Fila ${_comPrazo.length + _naFila.length}'),
          NavigationDestination(icon: const Icon(Icons.person_pin_outlined), label: 'Comigo ${_comigo.length}'),
          const NavigationDestination(icon: Icon(Icons.task_alt), label: 'Feitos'),
          const NavigationDestination(icon: Icon(Icons.account_circle_outlined), label: 'Eu'),
        ],
      ),
    );
  }

  Widget _topo(bool ocupado) => Container(
        color: kNavy,
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(children: [
              Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  const Text('Atendimento', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
                  Text(_eu.loja ?? 'Todas as lojas', style: const TextStyle(color: Color(0xFF9FB2C4), fontSize: 13)),
                ]),
              ),
              CircleAvatar(
                backgroundColor: kOuro,
                child: Text(_iniciais(_eu.nome), style: const TextStyle(color: kNavy, fontWeight: FontWeight.w800)),
              ),
            ]),
            const SizedBox(height: 6),
            Row(children: [
              Icon(Icons.circle, size: 9, color: _erro == null ? const Color(0xFF3DDC97) : const Color(0xFFFFB020)),
              const SizedBox(width: 6),
              Expanded(
                child: Text(
                  _erro == null ? 'Pela internet · lido às ${hora(_lidaEm)}' : _erro!,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(color: Color(0xFF9FB2C4), fontSize: 12.5),
                ),
              ),
            ]),
            const SizedBox(height: 10),
            Row(children: [
              Expanded(
                child: _botaoEstado('Disponível', !ocupado, kVerde, _ficarDisponivel),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _botaoEstado(ocupado ? 'Ocupado: ${_motivo ?? ''}'.trim() : 'Ocupado', ocupado, kOuro, _ficarOcupado),
              ),
            ]),
          ],
        ),
      );

  Widget _botaoEstado(String texto, bool ativo, Color cor, VoidCallback aoTocar) => Semantics(
        button: true,
        selected: ativo,
        child: OutlinedButton(
          onPressed: aoTocar,
          style: OutlinedButton.styleFrom(
            backgroundColor: ativo ? cor : Colors.transparent,
            foregroundColor: ativo ? (cor == kOuro ? kNavy : Colors.white) : Colors.white,
            side: BorderSide(color: ativo ? cor : Colors.white24),
            minimumSize: const Size(0, 44),
          ),
          child: Text(texto, maxLines: 1, overflow: TextOverflow.ellipsis),
        ),
      );

  Widget _abaFila(bool ocupado) {
    if (!_lida) return _carregando();
    final comPrazo = _comPrazo;
    final naFila = _naFila;
    return ListView(
      padding: const EdgeInsets.fromLTRB(12, 10, 12, 24),
      children: [
        if (ocupado)
          Container(
            margin: const EdgeInsets.only(bottom: 8),
            padding: const EdgeInsets.all(10),
            decoration: BoxDecoration(color: kOuro.withValues(alpha: 0.18), borderRadius: BorderRadius.circular(12)),
            child: const Text(
              'Você está ocupado: o app só toca para o que tem prazo. Os outros casos vão para quem está disponível.',
              style: TextStyle(fontSize: 13.5),
            ),
          ),
        if (comPrazo.isEmpty && naFila.isEmpty) _vazio('Ninguém esperando agora. Quando chegar um caso, ele aparece aqui.'),
        if (comPrazo.isNotEmpty) _secao('Com prazo · ${comPrazo.length}'),
        for (final c in comPrazo) _cartao(c),
        if (naFila.isNotEmpty) _secao('Na fila · ${naFila.length}'),
        for (final c in naFila) _cartao(c),
      ],
    );
  }

  Widget _abaFeitos() {
    final f = _feitos;
    if (f == null) return _carregando();
    return _lista(f, vazio: 'Nenhum caso resolvido hoje ainda.');
  }

  Widget _lista(List<Caso> casos, {required String vazio}) => ListView(
        padding: const EdgeInsets.fromLTRB(12, 10, 12, 24),
        children: [
          if (!_lida) _carregando() else if (casos.isEmpty) _vazio(vazio),
          for (final c in casos) _cartao(c),
        ],
      );

  Widget _abaEu() => ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(_eu.nome, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
                const SizedBox(height: 4),
                Text('${_eu.funcao} · ${_eu.loja ?? 'Todas as lojas'}', style: const TextStyle(color: kTinta2)),
                const SizedBox(height: 4),
                Text('Celular: ${_eu.aparelho}', style: const TextStyle(color: kTinta2)),
                const SizedBox(height: 4),
                Text(_estado == 'ocupado' ? 'Ocupado: ${_motivo ?? ''}' : 'Disponível', style: const TextStyle(fontWeight: FontWeight.w600)),
              ]),
            ),
          ),
          const SizedBox(height: 8),
          const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text(
                'Os avisos chegam com o app aberto ou recém-fechado. Deixe o app aberto no turno; com o celular parado há muito '
                'tempo, a fila aparece quando você volta ao app.',
                style: TextStyle(color: kTinta2, height: 1.4),
              ),
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton.icon(onPressed: _sair, icon: const Icon(Icons.logout), label: const Text('Sair (fim do turno)')),
        ],
      );

  Widget _cartao(Caso c) {
    final prazo = c.prazoEm != null ? tempoAte(c.prazoEm, _agora) : '';
    final apertado = c.prazoEm != null && c.prazoEm!.difference(_agora).inSeconds < 120;
    final meu = c.responsavelId == _eu.colaboradorId;
    final daFila = c.situacao == 'fila';
    return Card(
      color: c.urgente ? const Color(0xFFFFF5F5) : Colors.white,
      child: InkWell(
        onTap: () => _abrir(c),
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Expanded(
                  child: Wrap(spacing: 6, runSpacing: 4, children: [
                    Selo(c.rotuloCanal, cor: corDoCanal(c.canal), cheio: true),
                    if (c.urgente) const Selo('🚨 Urgente', cor: kPerigo),
                    Selo(c.rotulo),
                    if (c.situacao == 'aguardando') const Selo('Aguardando o cliente', cor: kTinta2),
                    if (c.escalado != null) const Selo('⏰ Gerente avisado', cor: kAviso),
                  ]),
                ),
                if (prazo.isNotEmpty)
                  Text(prazo, style: TextStyle(fontWeight: FontWeight.w800, fontFeatures: const [FontFeature.tabularFigures()], color: apertado ? kPerigo : kNavy))
                else if (c.posicao != null)
                  Text('${c.posicao}º · ${tempoDesde(c.criadoEm, _agora)}', style: const TextStyle(fontWeight: FontWeight.w800)),
              ]),
              const SizedBox(height: 6),
              Text(c.titulo, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w700)),
              if (c.linhaCurta != null) ...[
                const SizedBox(height: 2),
                Text(c.linhaCurta!, maxLines: 2, overflow: TextOverflow.ellipsis, style: const TextStyle(color: kTinta2)),
              ],
              const SizedBox(height: 4),
              Text(
                c.situacao == 'resolvido'
                    ? 'resolvido às ${hora(c.resolvidoEm)}${c.resolvidoPorNome != null ? ' por ${c.resolvidoPorNome}' : ''}'
                    : meu
                        ? 'com você${c.pegoEm != null ? ' · ${tempoDesde(c.pegoEm, _agora)}' : ''}'
                        : c.responsavelId != null
                            ? 'com ${c.responsavelNome ?? 'alguém'}'
                            : 'ninguém pegou · esperando há ${tempoDesde(c.criadoEm, _agora)}',
                style: const TextStyle(fontSize: 12.5, color: kTinta2),
              ),
              if (c.aberto) ...[
                const SizedBox(height: 8),
                if (c.daPlataforma)
                  OutlinedButton(onPressed: () => _abrir(c), child: Text(_eu.decide ? 'Ver e responder' : 'Ver · só o gerente responde'))
                else if (daFila && c.responsavelId == null)
                  FilledButton(onPressed: () => _pegar(c), child: const Text('Pegar'))
                else
                  OutlinedButton(onPressed: () => _abrir(c), child: const Text('Abrir')),
              ],
            ],
          ),
        ),
      ),
    );
  }

  Widget _secao(String t) => Padding(
        padding: const EdgeInsets.fromLTRB(4, 12, 4, 4),
        child: Text(t.toUpperCase(), style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w800, color: kTinta2, letterSpacing: 0.6)),
      );

  Widget _vazio(String t) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 40, horizontal: 16),
        child: Text(t, textAlign: TextAlign.center, style: const TextStyle(color: kTinta2)),
      );

  Widget _carregando() => const Padding(
        padding: EdgeInsets.symmetric(vertical: 48),
        child: Center(child: CircularProgressIndicator()),
      );

  static String _iniciais(String nome) {
    final p = nome.trim().split(RegExp(r'\s+')).where((s) => s.isNotEmpty).toList();
    if (p.isEmpty) return '?';
    return (p.first.substring(0, 1) + (p.length > 1 ? p.last.substring(0, 1) : '')).toUpperCase();
  }
}
