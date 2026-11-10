import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:crypto/crypto.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api.dart';
import '../location.dart';
import '../outbox.dart';
import '../chat_visto.dart';
import '../widgets/logo_do_canal.dart';
import 'chat_screen.dart';
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

  // Bloco 3 — não consigo falar com o cliente: a loja avisa o cliente pelo WhatsApp, com o link de onde estou.
  bool _semContatoEnviando = false;

  // Quem decide se o WhatsApp da loja vale para o cliente é o servidor (`whatsappCliente`, 09/11/2026: o cardápio sempre;
  // a 99 quando a loja liga; o iFood nunca). Servidor antigo: iFood, 99 e Keeta falam com o cliente pelo app deles.
  bool get _podeSemContato => widget.pedido.containsKey('whatsappCliente')
      ? widget.pedido['whatsappCliente'] == true
      : !['ifood', '99food', 'keeta'].contains(widget.pedido['canal']?.toString());

  // ===== 10/11/2026: o cliente da 99 pelo WhatsApp DO ENTREGADOR =====
  // O dono: a loja não inicia conversa com o cliente da 99 pelo WhatsApp dela (trata pelo chat da 99 e pelo Atendimento);
  // quem fala com ele pelo WhatsApp é o entregador, do próprio celular. Então, no pedido da 99 (sem o ajuste da loja), o
  // acompanhamento, o "não consigo falar" e a posição abrem o WhatsApp do entregador com o texto pronto — ele só toca em
  // enviar. Precisa do celular direto do cliente (a 99 manda; o iFood não — lá é o chat).
  bool get _whatsappDoEntregador =>
      widget.pedido['canal'] == '99food' && widget.pedido['whatsappCliente'] != true && _ligacao?['tipo'] == 'direto';

  String get _primeiroNome {
    final n = (widget.pedido['cliente']?.toString() ?? '').trim().split(RegExp(r'\s+')).first;
    if (n.isEmpty || !RegExp(r'[A-Za-zÀ-ÿ]').hasMatch(n)) return '';
    return '${n[0].toUpperCase()}${n.substring(1).toLowerCase()}';
  }

  /// "Olá, Maria! Sou o entregador do seu pedido da 99 (nº 436004)."
  String get _abertura99 {
    final nome = _primeiroNome;
    final cod = widget.pedido['displayId']?.toString().trim() ?? '';
    return 'Olá${nome.isNotEmpty ? ', $nome' : ''}! Sou o entregador do seu pedido da 99${cod.isNotEmpty ? ' (nº $cod)' : ''}.';
  }

  static const _lembrete99 = '🔑 Na entrega, me informe o código que aparece no app da 99.';

  /// Abre o WhatsApp do entregador na conversa com o cliente, com o texto pronto.
  Future<void> _meuWhatsapp(String texto) async {
    final d = (_ligacao?['numero']?.toString() ?? '').replaceAll(RegExp(r'\D'), '');
    if (d.isEmpty) return;
    await _abrirUri(Uri.parse('https://wa.me/$d?text=${Uri.encodeComponent(texto)}'), 'Não foi possível abrir o WhatsApp.');
  }

  Future<void> _acompanhamentoPeloMeuWhatsapp() {
    final url = widget.pedido['rastreioUrl']?.toString() ?? '';
    return _meuWhatsapp('$_abertura99 Já estou a caminho 🛵'
        '${url.isNotEmpty ? '\nAcompanhe a entrega por aqui: $url' : ''}\n$_lembrete99');
  }

  Future<void> _semContatoPeloMeuWhatsapp() =>
      _meuWhatsapp('$_abertura99 Estou tentando falar com você sobre a entrega. Pode me responder por aqui?\n$_lembrete99');

  bool _pegandoPosicao = false;

  Future<void> _posicaoPeloMeuWhatsapp() async {
    setState(() => _pegandoPosicao = true);
    try {
      final p = await LocationSender.posicaoAtual();
      if (p == null) {
        if (mounted) _aviso('Não consegui pegar a sua posição. Ligue a localização do celular e tente de novo.', erro: true);
        return;
      }
      final mapa = 'https://www.google.com/maps/search/?api=1&query='
          '${p.latitude.toStringAsFixed(6)},${p.longitude.toStringAsFixed(6)}';
      await _meuWhatsapp('$_abertura99 Estou perto do seu endereço e não estou encontrando o local. Estou aqui: $mapa\n'
          'Pode me orientar?');
    } finally {
      if (mounted) setState(() => _pegandoPosicao = false);
    }
  }

  // ===== 09/11/2026: compartilhar minha posição, o chat do iFood/99 e a ligação pela central do iFood =====

  bool _posicaoEnviando = false;
  DateTime? _posicaoEnviadaEm;

  /// "Compartilhar minha posição": o cliente recebe pelo WhatsApp da loja onde estou, no mapa (cheguei e não acho o
  /// endereço, ou o endereço veio errado). Vai a posição do toque; sem GPS, o servidor usa a última que mandei.
  Future<void> _compartilharPosicao() async {
    final antes = _posicaoEnviadaEm;
    if (antes != null && DateTime.now().difference(antes).inSeconds < 60) {
      _aviso('Sua posição já foi enviada há pouco. Aguarde o cliente responder.');
      return;
    }
    setState(() => _posicaoEnviando = true);
    try {
      final p = await LocationSender.posicaoAtual();
      await Api.compartilharPosicao(
        widget.pedido['id'] as String,
        p == null ? null : {'lat': p.latitude, 'lng': p.longitude, 'precisao': p.accuracy},
      );
      _posicaoEnviadaEm = DateTime.now();
      if (mounted) _aviso('📍 Sua posição foi enviada ao cliente pelo WhatsApp da loja.');
      _esperarResposta(); // a resposta do cliente chega como a do "não consigo falar"
    } on ApiErro catch (e) {
      if (mounted) _aviso(e.mensagem, erro: true);
    } catch (e) {
      if (mounted) {
        _aviso(Outbox.ehErroDeRede(e.toString())
            ? 'Sem internet — a posição não foi enviada. Tente de novo quando o sinal voltar.'
            : e.toString().replaceFirst('Exception: ', ''), erro: true);
      }
    } finally {
      if (mounted) setState(() => _posicaoEnviando = false);
    }
  }

  bool get _temChat => widget.pedido['chatDaPlataforma'] == true;
  bool _chatNovo = false;
  Timer? _vigiaChat;

  /// Com o chat da plataforma, a tela olha a conversa a cada 20 s e marca quando o cliente escreve (não há aviso no celular).
  void _vigiarChat() {
    if (!_temChat) return;
    final id = widget.pedido['id'] as String;
    ChatVisto.temNova(id, widget.pedido['ultimaNoChat']).then((v) {
      if (mounted && v) setState(() => _chatNovo = true);
    });
    _vigiaChat = Timer.periodic(const Duration(seconds: 20), (_) async {
      try {
        final r = await Api.chat(id);
        final doCliente = ((r['mensagens'] as List?) ?? []).where((m) => (m as Map)['de'] == 'cliente').toList();
        if (doCliente.isEmpty || !mounted) return;
        final nova = await ChatVisto.temNova(id, doCliente.last);
        if (nova && !_chatNovo && mounted) {
          HapticFeedback.heavyImpact();
          setState(() => _chatNovo = true);
          _aviso('💬 O cliente escreveu no chat do ${_canalDoChat()}.');
        }
      } catch (_) {
        // sem rede: tenta na próxima volta
      }
    });
  }

  String _canalDoChat() => widget.pedido['canal'] == 'ifood' ? 'iFood' : '99';

  Future<void> _abrirChat() async {
    setState(() => _chatNovo = false);
    await Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(pedido: widget.pedido)));
  }

  Map<String, dynamic>? get _ligacao {
    final l = widget.pedido['ligacao'];
    return l is Map ? Map<String, dynamic>.from(l) : null;
  }

  /// A central do iFood: disca o número com o localizador "em espera" (o `;` do discador) — quando a gravação pede o
  /// localizador, o celular pergunta se manda os números e, no "Sim", disca sozinho. O localizador também vai para a área
  /// de transferência (há discador que não faz a espera).
  Future<void> _ligarPelaCentral(Map<String, dynamic> l) async {
    final localizador = l['localizador']?.toString() ?? '';
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        icon: const Icon(Icons.support_agent, size: 36),
        title: Text('Ligar pela central do ${_canalDoChat()}'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('O iFood não passa o número do cliente. Você liga para a central e a gravação pede o localizador.'),
            const SizedBox(height: 12),
            const Text('Quando o celular perguntar "Enviar os números?", toque em Sim — o localizador é discado sozinho.'),
            const SizedBox(height: 12),
            Text('Localizador: $localizador',
                style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, letterSpacing: 2)),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancelar')),
          FilledButton.icon(
            onPressed: () => Navigator.pop(ctx, true),
            icon: const Icon(Icons.phone),
            label: const Text('Ligar'),
          ),
        ],
      ),
    );
    if (ok != true) return;
    await Clipboard.setData(ClipboardData(text: localizador));
    await _abrirUri(
      Uri(scheme: 'tel', path: '${l['numero']};$localizador'),
      'Não foi possível abrir o discador.',
    );
  }

  Future<void> _ligarDireto(String numero) =>
      _abrirUri(Uri(scheme: 'tel', path: numero), 'Não foi possível abrir o discador.');

  /// Como falar com o cliente. Servidor antigo (sem `ligacao`): o telefone cru, como antes.
  Widget _contato() {
    final p = widget.pedido;
    if (!p.containsKey('ligacao')) {
      if (_telDigits().isEmpty) return const SizedBox.shrink();
      return Row(
        children: [
          Expanded(child: Text(p['telefone'].toString())),
          IconButton(icon: const Icon(Icons.phone), color: Colors.green, tooltip: 'Ligar', onPressed: _ligar),
          IconButton(icon: const Icon(Icons.chat), color: const Color(0xFF25D366), tooltip: 'WhatsApp', onPressed: _whatsapp),
        ],
      );
    }
    final l = _ligacao;
    if (l == null) return const SizedBox.shrink();
    if (l['tipo'] == 'central') {
      final loc = l['localizador']?.toString() ?? '';
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Localizador do pedido', style: TextStyle(fontSize: 12)),
                        Text(loc, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.w800, letterSpacing: 2)),
                      ],
                    ),
                  ),
                  IconButton(icon: const Icon(Icons.copy), tooltip: 'Copiar localizador', onPressed: () => _copiarLocalizador(loc)),
                ],
              ),
              const SizedBox(height: 8),
              FilledButton.icon(
                onPressed: () => _ligarPelaCentral(l),
                icon: const Icon(Icons.phone),
                label: Text('Ligar para o cliente (central do ${_canalDoChat()})'),
              ),
            ],
          ),
        ),
      );
    }
    final numero = l['numero']?.toString() ?? '';
    return Row(
      children: [
        Expanded(child: Text(p['telefone']?.toString() ?? numero)),
        IconButton(icon: const Icon(Icons.phone), color: Colors.green, tooltip: 'Ligar', onPressed: () => _ligarDireto(numero)),
        IconButton(icon: const Icon(Icons.chat), color: const Color(0xFF25D366), tooltip: 'WhatsApp', onPressed: _whatsapp),
      ],
    );
  }

  Future<void> _semContato() async {
    setState(() => _semContatoEnviando = true);
    try {
      await Api.semContato(widget.pedido['id'] as String);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Cliente avisado pelo WhatsApp que você está tentando falar com ele')),
        );
        _esperarResposta();
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
      if (mounted) setState(() => _semContatoEnviando = false);
    }
  }

  // A RESPOSTA DO CLIENTE ao "não consigo falar" (Onda 0, 01/11/2026): o cliente responde pelo WhatsApp e a loja manda
  // para cá. Vem no pedido (lista) e, depois do aviso, a tela consulta a cada 15 s por até 30 min — o mesmo prazo em que
  // a resposta conta como resposta ao aviso no servidor.
  late Map<String, dynamic>? _resposta = _respostaDe(widget.pedido['respostaDoCliente']);
  Timer? _esperaResposta;

  static Map<String, dynamic>? _respostaDe(dynamic v) => v is Map ? Map<String, dynamic>.from(v) : null;

  void _esperarResposta() {
    _esperaResposta?.cancel();
    final ate = DateTime.now().add(const Duration(minutes: 30));
    _esperaResposta = Timer.periodic(const Duration(seconds: 15), (t) async {
      if (!mounted || DateTime.now().isAfter(ate)) return t.cancel();
      try {
        final r = await Api.respostaDoCliente(widget.pedido['id'] as String);
        final nova = _respostaDe(r['respostaDoCliente']);
        if (!mounted || nova == null) return;
        final mudou = nova['texto'] != _resposta?['texto'];
        setState(() => _resposta = nova);
        if (mudou) {
          HapticFeedback.heavyImpact();
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('💬 O cliente respondeu — veja na tela do pedido')),
          );
        }
      } catch (_) {
        // sem rede ou servidor fora: tenta de novo na próxima volta
      }
    });
  }

  Widget _cartaoResposta() {
    final r = _resposta;
    if (r == null) return const SizedBox.shrink();
    return Card(
      color: Colors.green.withValues(alpha: 0.10),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('💬 O cliente respondeu', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 4),
            Text(r['texto']?.toString() ?? ''),
          ],
        ),
      ),
    );
  }

  @override
  void initState() {
    super.initState();
    _vigiarChat();
  }

  @override
  void dispose() {
    _esperaResposta?.cancel();
    _vigiaChat?.cancel();
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

  /// Onde o código é conferido: 'hash' (no aparelho — código do Regem), 'online' (iFood e 99: na API do canal, com
  /// internet). A 99 deixou de ser 'depois' (guardar qualquer código sem sinal) em 10/11/2026: o entregador saía do local
  /// com o código errado (ERR-427). Sem sinal, a 99 só guarda o código que bate com `_hashOffline`.
  String? get _conferencia {
    final c = widget.pedido['conferencia']?.toString();
    if (c != null && c.isNotEmpty) return c;
    if (_codigoDoCanal != null) return 'online';
    return _precisaCodigo ? 'hash' : null;
  }

  /// Só na 99: o resumo (sha256) dos 4 últimos números do telefone do cliente — o código da 99 hoje. Sem sinal, o app
  /// guarda a entrega só se o código digitado bater com ele (e confirma com a 99 quando o sinal volta).
  String? get _hashOffline {
    final o = widget.pedido['codigoOffline'];
    final h = o is Map ? o['hash']?.toString() : null;
    return h != null && h.isNotEmpty ? h : null;
  }

  String get _rotuloCodigo => _codigoDoCanal == 'ifood'
      ? 'Código de entrega do iFood'
      : _codigoDoCanal == '99food'
          ? 'Código de entrega da 99'
          : 'Código de entrega do cliente';

  String get _ajudaCodigo => _codigoDoCanal == 'ifood'
      ? 'O cliente vê o código no app do iFood. A conferência é na hora e precisa de internet.'
      : _codigoDoCanal == '99food'
          ? (_hashOffline != null
              ? 'O cliente vê o código no app da 99. Sem internet, o app só aceita o código que confere com o telefone do cliente.'
              : 'O cliente vê o código no app da 99. A conferência é na hora e precisa de internet.')
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

  // Pedido da loja SEM código (a loja desligou o código — mig 348): o servidor confere se o "Entregue" foi tocado perto
  // do endereço. Vai a posição DO TOQUE (também para a fila sem internet). Sem GPS, vai sem — o servidor aceita e anota.
  bool get _confereLocal => !_precisaCodigo && widget.pedido['modoEntrega'] == 'propria_loja';

  Future<Map<String, dynamic>?> _localDoToque() async {
    if (!_confereLocal) return null;
    final p = await LocationSender.posicaoAtual();
    if (p == null) return null;
    return {'lat': p.latitude, 'lng': p.longitude, 'precisao': p.accuracy};
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
    final local = await _localDoToque();
    try {
      final r = await Api.finalizar(id, codigo: _precisaCodigo ? code : null, local: local);
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
      if (!e.recusa) return _semConexao(id, code, local);
      _aviso(e.mensagem, erro: true);
      setState(() => _finalizando = false);
    } catch (e) {
      if (!mounted) return;
      final msg = e.toString();
      if (Outbox.ehErroDeRede(msg)) return _semConexao(id, code, local);
      _aviso(msg.replaceFirst('Exception: ', ''), erro: true);
      setState(() => _finalizando = false);
    }
  }

  /// Sem internet: o código da loja (conferido pelo hash) e o da 99 que bate com o telefone do cliente vão para a fila e
  /// concluem aqui; o do iFood e o da 99 que NÃO bate, não — o entregador confere com o cliente antes de sair do local.
  Future<void> _semConexao(String id, String code, Map<String, dynamic>? local) async {
    if (_conferencia == 'online') {
      final hash = _hashOffline;
      final bate = hash != null && sha256.convert(utf8.encode(code)).toString() == hash;
      if (!bate) {
        _aviso(
          hash != null
              ? 'Sem internet e o código não confere com o telefone do cliente (na 99, o código são os 4 últimos números '
                  'do telefone). Confira com o cliente antes de sair — ou tente de novo quando o sinal voltar.'
              : 'Sem internet — o código ${_codigoDoCanal == 'ifood' ? 'do iFood' : 'da 99'} só é conferido online. '
                  'Tente de novo quando o sinal voltar.',
          erro: true,
        );
        setState(() => _finalizando = false);
        return;
      }
      await Outbox.enfileirar(id, code, numero: widget.pedido['numero'], canal: _codigoDoCanal, local: local);
      if (!mounted) return;
      _aviso('Sem internet — o código confere com o telefone do cliente. Entrega guardada: confirmo com a 99 quando o '
          'sinal voltar e aviso se ela recusar.');
      Navigator.pop(context, true);
      return;
    }
    await Outbox.enfileirar(
      id,
      _precisaCodigo ? code : null,
      numero: widget.pedido['numero'],
      canal: _codigoDoCanal,
      local: local,
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
        // De onde veio o pedido, como no painel: a logo do canal e o código do pedido NO canal (09/11/2026).
        title: Row(
          children: [
            LogoDoCanal(canal: p['canal'], logoDaLoja: p['logoDaLoja']?.toString(), tamanho: 28),
            const SizedBox(width: 8),
            Expanded(child: Text(tituloDoPedido(p), overflow: TextOverflow.ellipsis)),
          ],
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(p['cliente']?.toString() ?? 'Cliente',
              style: Theme.of(context).textTheme.titleLarge),
          _contato(),
          if (_temChat) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _abrirChat,
              icon: Badge(isLabelVisible: _chatNovo, child: const Icon(Icons.forum_outlined)),
              label: Text(_chatNovo
                  ? 'O cliente escreveu · abrir o chat do ${_canalDoChat()}'
                  : 'Chat com o cliente (${_canalDoChat()})'),
            ),
          ],
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
          // A observação GERAL do pedido (mig 346): o recado do cliente ("interfone ruim, ligar ao chegar").
          // Servidor antigo não manda o campo: nada aparece.
          if ((p['observacao'] ?? '').toString().trim().isNotEmpty) ...[
            const SizedBox(height: 8),
            Card(
              color: const Color(0xFFFFF4DE),
              child: ListTile(
                leading: const Icon(Icons.sticky_note_2_outlined),
                title: const Text('Observação do pedido', style: TextStyle(fontWeight: FontWeight.bold)),
                subtitle: Text(p['observacao'].toString()),
              ),
            ),
          ],
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
          if (_podeSemContato) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _semContatoEnviando ? null : _semContato,
              icon: const Icon(Icons.phone_disabled),
              label: Text(_semContatoEnviando ? 'Avisando…' : 'Não consigo falar com o cliente'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _posicaoEnviando ? null : _compartilharPosicao,
              icon: const Icon(Icons.share_location),
              label: Text(_posicaoEnviando ? 'Enviando…' : 'Não acho o endereço: mandar minha posição'),
            ),
          ],
          // 99 (10/11/2026): pelo WhatsApp do próprio entregador, com o texto pronto.
          if (_whatsappDoEntregador) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _acompanhamentoPeloMeuWhatsapp,
              icon: const Icon(Icons.route_outlined),
              label: const Text('Mandar o acompanhamento (meu WhatsApp)'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _semContatoPeloMeuWhatsapp,
              icon: const Icon(Icons.phone_disabled),
              label: const Text('Não consigo falar com o cliente (meu WhatsApp)'),
            ),
            const SizedBox(height: 8),
            OutlinedButton.icon(
              onPressed: _pegandoPosicao ? null : _posicaoPeloMeuWhatsapp,
              icon: const Icon(Icons.share_location),
              label: Text(_pegandoPosicao ? 'Pegando a posição…' : 'Não acho o endereço: mandar minha posição (meu WhatsApp)'),
            ),
          ],
          if (_resposta != null) ...[const SizedBox(height: 8), _cartaoResposta()],
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
