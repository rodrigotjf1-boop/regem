import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../api.dart';
import '../chat_visto.dart';

/// O CHAT COM O CLIENTE DO iFOOD E DA 99 (pedido do dono, 09/11/2026): o entregador escreve aqui e a ponte do PC da loja
/// digita no chat da plataforma; a resposta do cliente volta para cá. Precisa de internet (a conversa mora na nuvem).
/// A plataforma proíbe telefone, WhatsApp, Instagram e link no chat — o servidor recusa e a tela mostra o motivo.
class ChatScreen extends StatefulWidget {
  final Map<String, dynamic> pedido;
  const ChatScreen({super.key, required this.pedido});

  @override
  State<ChatScreen> createState() => _ChatScreenState();
}

class _ChatScreenState extends State<ChatScreen> {
  // O "Entregador: " que vai na frente ocupa 12 das 300 letras do chat da plataforma.
  static const _maxLetras = 288;
  static const _rapidas = [
    'Estou a caminho do seu endereço.',
    'Cheguei! Pode descer, por favor?',
    'Estou na portaria.',
    'Não estou achando o endereço. Pode me orientar?',
  ];

  final _texto = TextEditingController();
  final _rolagem = ScrollController();
  List<Map<String, dynamic>> _mensagens = [];
  Map<String, dynamic>? _ponte;
  String? _erro;
  bool _carregando = true;
  bool _enviando = false;
  // O id da mensagem que está sendo enviada: se a rede cair, o reenvio usa o MESMO id e não duplica.
  String? _idEmEnvio;
  String? _textoEmEnvio;
  Timer? _timer;

  String get _id => widget.pedido['id'] as String;
  String get _plataforma => widget.pedido['canal'] == 'ifood' ? 'iFood' : '99';

  @override
  void initState() {
    super.initState();
    _carregar();
    _timer = Timer.periodic(const Duration(seconds: 8), (_) => _carregar(quieto: true));
  }

  @override
  void dispose() {
    _timer?.cancel();
    _texto.dispose();
    _rolagem.dispose();
    super.dispose();
  }

  Future<void> _carregar({bool quieto = false}) async {
    try {
      final r = await Api.chat(_id);
      final msgs = ((r['mensagens'] as List?) ?? []).map((e) => Map<String, dynamic>.from(e as Map)).toList();
      final antes = _mensagens.length;
      if (!mounted) return;
      setState(() {
        _mensagens = msgs;
        _ponte = r['ponte'] is Map ? Map<String, dynamic>.from(r['ponte'] as Map) : null;
        _erro = null;
        _carregando = false;
      });
      // Viu a conversa: marca a última fala do cliente como vista (a lista para de mostrar "o cliente escreveu").
      final doCliente = msgs.where((m) => m['de'] == 'cliente').toList();
      if (doCliente.isNotEmpty) {
        final em = DateTime.tryParse('${doCliente.last['em']}');
        if (em != null) await ChatVisto.marcar(_id, em);
        if (quieto && msgs.length > antes && msgs.last['de'] == 'cliente') HapticFeedback.heavyImpact();
      }
      if (msgs.length != antes) _irParaOFim();
    } on ApiErro catch (e) {
      if (!mounted) return;
      setState(() {
        _carregando = false;
        if (!quieto || _mensagens.isEmpty) _erro = e.mensagem;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _carregando = false;
        if (!quieto || _mensagens.isEmpty) _erro = 'Sem internet — o chat precisa de conexão. Tento de novo sozinho.';
      });
    }
  }

  void _irParaOFim() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_rolagem.hasClients) _rolagem.jumpTo(_rolagem.position.maxScrollExtent);
    });
  }

  Future<void> _enviar([String? pronto]) async {
    final texto = (pronto ?? _texto.text).trim();
    if (texto.isEmpty || _enviando) return;
    // O mesmo texto de novo depois de falhar = a mesma mensagem (mesmo id); texto novo = mensagem nova.
    if (_textoEmEnvio != texto) {
      _idEmEnvio = novoIdDeMensagem();
      _textoEmEnvio = texto;
    }
    setState(() => _enviando = true);
    try {
      final r = await Api.enviarNoChat(_id, texto, _idEmEnvio!);
      if (!mounted) return;
      _idEmEnvio = null;
      _textoEmEnvio = null;
      if (pronto == null) _texto.clear();
      if (r['saiAgora'] == false) {
        _aviso('Mensagem na fila: sai quando o computador da loja com a ponte voltar a enviar.');
      }
      await _carregar(quieto: true);
    } on ApiErro catch (e) {
      // Recusa (texto proibido, pedido fora de rota…): a mensagem não vai — outra tentativa é outra mensagem.
      if (e.recusa) {
        _idEmEnvio = null;
        _textoEmEnvio = null;
      }
      _aviso(e.mensagem, erro: true);
    } catch (_) {
      _aviso('Sem internet — a mensagem não saiu. Toque em enviar de novo quando o sinal voltar.', erro: true);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  void _aviso(String msg, {bool erro = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: erro ? Colors.red : null),
    );
  }

  String _hora(dynamic iso) {
    final d = DateTime.tryParse('$iso')?.toLocal();
    if (d == null) return '';
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  String _situacao(String estado) {
    switch (estado) {
      case 'enviada':
        return '✓ enviada';
      case 'falhou':
      case 'cancelada':
        return '⚠ não saiu';
      default:
        return 'enviando…';
    }
  }

  Widget _balao(Map<String, dynamic> m) {
    final de = m['de']?.toString();
    final texto = m['texto']?.toString() ?? '';
    if (de == 'loja') {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 4, horizontal: 24),
        child: Text(
          'Loja · ${_hora(m['em'])}\n$texto',
          textAlign: TextAlign.center,
          style: TextStyle(fontSize: 12, color: Colors.grey.shade700, fontStyle: FontStyle.italic),
        ),
      );
    }
    final meu = de == 'voce';
    final cor = meu ? const Color(0xFFF8ECD6) : Colors.grey.shade200;
    return Align(
      alignment: meu ? Alignment.centerRight : Alignment.centerLeft,
      child: Container(
        constraints: BoxConstraints(maxWidth: MediaQuery.of(context).size.width * 0.78),
        margin: const EdgeInsets.symmetric(vertical: 4),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(color: cor, borderRadius: BorderRadius.circular(12)),
        child: Column(
          crossAxisAlignment: meu ? CrossAxisAlignment.end : CrossAxisAlignment.start,
          children: [
            Text(texto, style: const TextStyle(fontSize: 15)),
            const SizedBox(height: 2),
            Text(
              meu ? '${_hora(m['em'])} · ${_situacao('${m['estado']}')}' : 'Cliente · ${_hora(m['em'])}',
              style: TextStyle(fontSize: 11, color: Colors.grey.shade700),
            ),
          ],
        ),
      ),
    );
  }

  Widget? _faixaDaPonte() {
    final p = _ponte;
    if (p == null) return null;
    String? msg;
    if (p['ligada'] != true) {
      msg = 'O chat pela plataforma não está ligado nesta loja. Ligue para o cliente.';
    } else if (p['responde'] != true) {
      msg = 'O computador da loja que envia pelo $_plataforma está desligado agora: a mensagem fica na fila até ele voltar.';
    }
    if (msg == null) return null;
    return Container(
      width: double.infinity,
      color: Colors.orange.withValues(alpha: 0.12),
      padding: const EdgeInsets.all(10),
      child: Text(msg, style: TextStyle(color: Colors.orange.shade900, fontSize: 13)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final faixa = _faixaDaPonte();
    return Scaffold(
      appBar: AppBar(title: Text('Chat com o cliente · $_plataforma')),
      body: Column(
        children: [
          if (faixa != null) faixa,
          Expanded(
            child: _carregando
                ? const Center(child: CircularProgressIndicator())
                : _erro != null && _mensagens.isEmpty
                    ? Center(
                        child: Padding(
                          padding: const EdgeInsets.all(24),
                          child: Text(_erro!, textAlign: TextAlign.center),
                        ),
                      )
                    : _mensagens.isEmpty
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Text(
                                'Nenhuma mensagem ainda. Escreva ao cliente: a mensagem vai pelo chat do $_plataforma.',
                                textAlign: TextAlign.center,
                              ),
                            ),
                          )
                        : ListView.builder(
                            controller: _rolagem,
                            padding: const EdgeInsets.all(12),
                            itemCount: _mensagens.length,
                            itemBuilder: (_, i) => _balao(_mensagens[i]),
                          ),
          ),
          SizedBox(
            height: 44,
            child: ListView(
              scrollDirection: Axis.horizontal,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              children: _rapidas
                  .map((t) => Padding(
                        padding: const EdgeInsets.only(right: 6),
                        child: ActionChip(label: Text(t), onPressed: _enviando ? null : () => _enviar(t)),
                      ))
                  .toList(),
            ),
          ),
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _texto,
                      minLines: 1,
                      maxLines: 4,
                      maxLength: _maxLetras,
                      textCapitalization: TextCapitalization.sentences,
                      decoration: const InputDecoration(
                        hintText: 'Escreva ao cliente (sem telefone nem link)',
                        border: OutlineInputBorder(),
                        counterText: '',
                        isDense: true,
                      ),
                      onSubmitted: (_) => _enviar(),
                    ),
                  ),
                  const SizedBox(width: 6),
                  IconButton.filled(
                    onPressed: _enviando ? null : _enviar,
                    icon: _enviando
                        ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.send),
                    tooltip: 'Enviar',
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
