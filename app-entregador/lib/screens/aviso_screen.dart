import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:url_launcher/url_launcher.dart';
import '../api.dart';
import '../widgets/logo_do_canal.dart';
import 'chat_screen.dart';
import 'pedido_screen.dart';

/// O AVISO DO ATENDIMENTO (mig 391; pedido do dono, 10/11/2026): o cliente perguntando pelo pedido, reclamando da demora,
/// ou o que o atendimento encaminhou (faltou item, faltou troco, recado). O entregador fala com o cliente — ligar, chat da
/// plataforma, o WhatsApp dele — ou avisa com um toque: "estou a caminho", "cheguei", "tive um imprevisto". O aviso de um
/// toque sai pelo canal do pedido (chat do iFood/99; WhatsApp da loja no cardápio); se não sair, o app oferece mandar o
/// MESMO texto pelo WhatsApp do entregador. O atendimento vê o que ele fez.
class AvisoScreen extends StatefulWidget {
  final Map<String, dynamic> aviso;
  const AvisoScreen({super.key, required this.aviso});

  @override
  State<AvisoScreen> createState() => _AvisoScreenState();
}

class _AvisoScreenState extends State<AvisoScreen> {
  bool _enviando = false;

  Map<String, dynamic> get _pedido => Map<String, dynamic>.from((widget.aviso['pedido'] as Map?) ?? const {});
  String get _id => widget.aviso['id'] as String;
  bool get _depois => widget.aviso['depoisDaEntrega'] == true;
  Map<String, dynamic>? get _ligacao {
    final l = _pedido['ligacao'];
    return l is Map ? Map<String, dynamic>.from(l) : null;
  }

  bool get _temChat => _pedido['chatDaPlataforma'] == true;
  bool get _temCelular => _ligacao?['tipo'] == 'direto';
  String get _canal => _pedido['canal'] == 'ifood' ? 'iFood' : _pedido['canal'] == '99food' ? '99' : 'loja';

  @override
  void initState() {
    super.initState();
    Api.avisoVisto(_id); // o atendimento vê "visto"
  }

  void _aviso(String msg, {bool erro = false}) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(msg), backgroundColor: erro ? Colors.red : null));
  }

  Future<void> _abrir(Uri uri, String erro) async {
    final ok = await launchUrl(uri, mode: LaunchMode.externalApplication);
    if (!ok) _aviso(erro, erro: true);
  }

  /// Marca o que o entregador fez (ligou, mandou mensagem, resolveu) — em segundo plano: o contato já abriu.
  void _registrar(String acao) {
    Api.responderAviso(_id, acao).then((_) {}, onError: (_) {});
  }

  String get _abertura {
    final n = (_pedido['cliente']?.toString() ?? '').trim().split(RegExp(r'\s+')).first;
    final nome = n.isEmpty ? '' : '${n[0].toUpperCase()}${n.substring(1).toLowerCase()}';
    final cod = _pedido['displayId']?.toString().trim() ?? '';
    return 'Olá${nome.isNotEmpty ? ', $nome' : ''}! Sou o entregador do seu pedido${cod.isNotEmpty ? ' nº $cod' : ''}.';
  }

  Future<void> _meuWhatsapp(String texto) async {
    final d = (_ligacao?['numero']?.toString() ?? '').replaceAll(RegExp(r'\D'), '');
    if (d.isEmpty) return;
    await _abrir(Uri.parse('https://wa.me/$d?text=${Uri.encodeComponent(texto)}'), 'Não foi possível abrir o WhatsApp.');
  }

  Future<void> _ligar() async {
    final l = _ligacao;
    if (l == null) return;
    if (l['tipo'] == 'central') {
      final loc = l['localizador']?.toString() ?? '';
      await Clipboard.setData(ClipboardData(text: loc));
      _aviso('Localizador $loc copiado. Quando a gravação pedir, toque em Sim no aviso do celular.');
      await _abrir(Uri(scheme: 'tel', path: '${l['numero']};$loc'), 'Não foi possível abrir o discador.');
    } else {
      await _abrir(Uri(scheme: 'tel', path: l['numero'].toString()), 'Não foi possível abrir o discador.');
    }
    _registrar('ligou');
  }

  Future<void> _chat() async {
    _registrar('mensagem');
    await Navigator.push(context, MaterialPageRoute(builder: (_) => ChatScreen(pedido: _pedido)));
  }

  Future<void> _responder(String acao) async {
    setState(() => _enviando = true);
    try {
      final r = await Api.responderAviso(_id, acao);
      if (!mounted) return;
      if (r['saiu'] == true || r['jaRespondido'] == true) {
        _aviso(r['por'] == 'chat'
            ? 'Cliente avisado pelo chat do $_canal.'
            : r['por'] == 'whatsapp_loja'
                ? 'Cliente avisado pelo WhatsApp da loja.'
                : 'Resposta registrada.');
        Navigator.pop(context, true);
        return;
      }
      // Não saiu pelo canal do pedido: o mesmo texto pelo WhatsApp do entregador (se o pedido tem o celular do cliente).
      final texto = r['texto']?.toString() ?? '';
      await showDialog<void>(
        context: context,
        builder: (ctx) => AlertDialog(
          title: const Text('O aviso não saiu'),
          content: Text('${r['motivo'] ?? 'O canal do pedido não aceitou o aviso agora.'}'
              '${_temCelular && texto.isNotEmpty ? '\n\nMande pelo seu WhatsApp — o texto já vai pronto.' : ''}'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Fechar')),
            if (_temCelular && texto.isNotEmpty)
              FilledButton.icon(
                onPressed: () {
                  Navigator.pop(ctx);
                  _meuWhatsapp(texto);
                },
                icon: const Icon(Icons.chat),
                label: const Text('Meu WhatsApp'),
              ),
          ],
        ),
      );
      if (mounted) Navigator.pop(context, true);
    } on ApiErro catch (e) {
      _aviso(e.mensagem, erro: true);
    } catch (_) {
      _aviso('Sem internet — o aviso não saiu. Tente de novo quando o sinal voltar.', erro: true);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Widget _botao(String rotulo, IconData icone, VoidCallback? acao, {bool principal = false}) => Padding(
        padding: const EdgeInsets.only(bottom: 8),
        child: principal
            ? FilledButton.icon(onPressed: acao, icon: Icon(icone), label: Text(rotulo))
            : OutlinedButton.icon(onPressed: acao, icon: Icon(icone), label: Text(rotulo)),
      );

  @override
  Widget build(BuildContext context) {
    final a = widget.aviso;
    final p = _pedido;
    final texto = a['texto']?.toString() ?? '';
    final emRota = p['status'] == 'despachado';
    return Scaffold(
      appBar: AppBar(title: const Text('Aviso do atendimento')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            color: Colors.orange.withValues(alpha: 0.12),
            child: Padding(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('🔔 ${a['rotulo'] ?? 'Aviso do atendimento'}', style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
                  if (texto.isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(a['origem'] == 'robo' ? 'O cliente escreveu: “$texto”' : 'Recado: $texto', style: const TextStyle(fontSize: 15)),
                  ],
                  const SizedBox(height: 4),
                  Text(
                    a['origem'] == 'robo'
                        ? 'O Regem percebeu na conversa com o cliente.'
                        : 'Enviado pelo atendimento${a['enviadoPor'] != null ? ' (${a['enviadoPor']})' : ''}.',
                    style: const TextStyle(fontSize: 12, color: Colors.black54),
                  ),
                ],
              ),
            ),
          ),
          Card(
            child: ListTile(
              leading: LogoDoCanal(canal: p['canal'], logoDaLoja: p['logoDaLoja']?.toString()),
              title: Text(tituloDoPedido(p), style: const TextStyle(fontWeight: FontWeight.w700)),
              subtitle: Text('${p['cliente'] ?? 'Cliente'}${p['endereco'] != null ? '\n${p['endereco']}' : ''}'),
              isThreeLine: p['endereco'] != null,
              trailing: emRota ? const Icon(Icons.chevron_right) : null,
              onTap: emRota
                  ? () => Navigator.push(context, MaterialPageRoute(builder: (_) => PedidoScreen(pedido: p)))
                  : null,
            ),
          ),
          const SizedBox(height: 8),
          const Text('Avisar o cliente com um toque', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          _botao(_depois ? 'Estou voltando com o que faltou' : 'Estou a caminho', Icons.delivery_dining,
              _enviando ? null : () => _responder('a_caminho'),
              principal: true),
          _botao('Cheguei ao local', Icons.place, _enviando ? null : () => _responder('cheguei')),
          _botao('Tive um imprevisto, já vou chegar', Icons.schedule, _enviando ? null : () => _responder('imprevisto')),
          const SizedBox(height: 8),
          const Text('Falar com o cliente', style: TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 8),
          if (_ligacao != null)
            _botao(_ligacao!['tipo'] == 'central' ? 'Ligar pela central do iFood' : 'Ligar para o cliente', Icons.phone, _ligar),
          if (_temChat) _botao('Chat com o cliente ($_canal)', Icons.forum_outlined, _chat),
          if (_temCelular && p['canal'] != 'ifood')
            _botao('Mandar mensagem pelo meu WhatsApp', Icons.chat, () {
              _registrar('mensagem');
              _meuWhatsapp('$_abertura ');
            }),
          const SizedBox(height: 8),
          TextButton(
            onPressed: _enviando
                ? null
                : () async {
                    try {
                      await Api.responderAviso(_id, 'ok');
                    } catch (_) {
                      // sem rede: o aviso some da lista quando passar o tempo dele
                    }
                    if (context.mounted) Navigator.pop(context, true);
                  },
            child: const Text('Já resolvi — fechar o aviso'),
          ),
        ],
      ),
    );
  }
}
