import 'dart:convert';

import 'modelo.dart';

// AS CONVERSAS DO CASO NO APP (1.1, pedido do dono 10/11/2026: "no apk não tem como responder ou interagir, só os botões").
// As mesmas da tela Atendimento do computador, pelas mesmas rotas: o chat do iFood e da 99 (pela ponte do PC da loja), o
// Direct do Instagram e o Messenger. Regras puras (sem tela nem rede), cobertas por `test/conversa_test.dart`; os textos são
// os da tela do computador (`frontend/src/components/atendimento/chat-da-plataforma.tsx`, `conversa-do-instagram.tsx`,
// `conversa-do-messenger.tsx`).

enum CanalDaConversa { chat, direct, messenger }

/// Que conversa o caso tem no app — a MESMA regra da tela do computador: o chat no caso "Mensagem no chat" do iFood e da
/// 99, o Direct no "Mensagem no Direct", o Messenger no "Mensagem no Messenger". (O WhatsApp segue o caminho dele.)
CanalDaConversa? conversaDoCaso(Caso c) {
  if (c.tipo == 'chat' && (c.canal == 'ifood' || c.canal == '99food')) return CanalDaConversa.chat;
  if (c.tipo == 'instagram') return CanalDaConversa.direct;
  if (c.tipo == 'messenger') return CanalDaConversa.messenger;
  return null;
}

/// O pedaço da rota: `GET/POST /atendimento/:id/<isto>`.
String caminhoDaConversa(CanalDaConversa k) => switch (k) {
      CanalDaConversa.chat => 'chat',
      CanalDaConversa.direct => 'instagram',
      CanalDaConversa.messenger => 'messenger',
    };

/// Pontos de partida (vão para o campo; a pessoa ajusta e envia) — os mesmos do computador.
List<String> prontasDaConversa(CanalDaConversa k) => switch (k) {
      CanalDaConversa.chat => const [
          'Oi! Aqui é da equipe da loja. Já estamos vendo o seu pedido.',
          'Vou confirmar e já te respondo por aqui.',
          'Sentimos muito pelo transtorno.',
          'O entregador já está a caminho.',
        ],
      CanalDaConversa.direct => const [
          'Oi! Aqui é da equipe da loja. Como posso ajudar?',
          'Nosso cardápio está no link da bio. Pode pedir por lá!',
          'Vou confirmar e já te respondo por aqui.',
        ],
      CanalDaConversa.messenger => const [
          'Oi! Aqui é da equipe da loja. Como posso ajudar?',
          'Nosso cardápio está no link da página. Pode pedir por lá!',
          'Vou confirmar e já te respondo por aqui.',
        ],
    };

/// O título do bloco: "Chat do iFood", "Direct do Instagram", "Messenger".
String tituloDaConversa(CanalDaConversa k, Caso c) => switch (k) {
      CanalDaConversa.chat => 'Chat ${c.canal == 'ifood' ? 'do iFood' : 'da 99'}',
      CanalDaConversa.direct => 'Direct do Instagram',
      CanalDaConversa.messenger => 'Messenger',
    };

/// O que a mensagem sem texto é (foto, áudio…) — como o computador mostra.
const _descricao = <String, String>{
  'imagem': '[foto]',
  'audio': '[áudio]',
  'video': '[vídeo]',
  'arquivo': '[arquivo]',
  'compartilhamento': '[publicação compartilhada]',
  'story': '[menção no story]',
  'reel': '[reel]',
  'outro': '[mensagem que o app não mostra aqui]',
};

const _motivoDoAviso = <String, String>{'saiu': '"saiu para entrega"', 'chegando': '"chegando"', 'obrigado': '"obrigado"'};

/// Uma mensagem da conversa, como o app mostra.
class MensagemDaConversa {
  final String id;
  final bool daLoja;

  /// Quem falou, do lado da loja ("atendente virtual", "Ana", "loja · pelo app do Instagram"); vazio para o cliente.
  final String quem;
  final String texto;
  final DateTime? quando;

  /// Como está o envio (só do lado da loja): "✓ enviada", "⏳ na fila da ponte", "✕ não saiu: …". null = nada a dizer.
  final String? situacao;
  final bool falhou;

  /// Para o copiloto: cliente | loja | robo | sistema (a régua do servidor).
  final String de;

  const MensagemDaConversa({
    required this.id,
    required this.daLoja,
    required this.quem,
    required this.texto,
    required this.quando,
    required this.situacao,
    required this.falhou,
    required this.de,
  });
}

DateTime? _data(Object? v) => v is String && v.isNotEmpty ? DateTime.tryParse(v)?.toLocal() : null;

/// Lê uma mensagem do servidor. No chat, `ponteResponde` muda o "esperando" ("na fila da ponte" × "esperando a ponte").
MensagemDaConversa lerMensagem(CanalDaConversa k, Map<String, dynamic> m, {bool ponteResponde = true}) {
  final autor = '${m['autor'] ?? ''}';
  final direcao = '${m['direcao'] ?? ''}';
  final estado = '${m['estado'] ?? ''}';
  final erro = (m['erro'] as String?)?.trim();
  if (k == CanalDaConversa.chat) {
    final daLoja = !(direcao == 'entrada' && autor == 'cliente');
    String quem = '';
    if (daLoja) {
      if (direcao == 'entrada') {
        quem = 'loja · pelo app da plataforma';
      } else if (autor == 'aviso') {
        final motivo = _motivoDoAviso[m['motivo']];
        quem = 'aviso automático${motivo != null ? ' $motivo' : ''}';
      } else if (autor == 'robo') {
        quem = m['roboIa'] == true ? 'atendente virtual' : 'robô';
      } else {
        quem = (m['quem'] as String?)?.trim().isNotEmpty == true ? '${m['quem']}' : 'equipe';
      }
    }
    String? situacao;
    var falhou = false;
    if (direcao == 'saida') {
      if (estado == 'enviada') {
        situacao = '✓ enviada';
      } else if (estado == 'enviando') {
        situacao = '⏳ saindo pela ponte…';
      } else if (estado == 'pendente') {
        situacao = ponteResponde ? '⏳ na fila da ponte' : '⏳ esperando a ponte';
      } else {
        falhou = true;
        final porque = estado == 'cancelada' ? 'passou da hora (30 min)' : erro;
        situacao = '✕ não saiu${porque != null && porque.isNotEmpty ? ': $porque' : ''}';
      }
    }
    return MensagemDaConversa(
      id: '${m['id'] ?? ''}',
      daLoja: daLoja,
      quem: quem,
      texto: '${m['texto'] ?? ''}',
      quando: _data(m['em']),
      situacao: situacao,
      falhou: falhou,
      de: !daLoja ? 'cliente' : (autor == 'robo' ? 'robo' : autor == 'aviso' ? 'sistema' : 'loja'),
    );
  }
  // Direct e Messenger: a mesma forma.
  final daLoja = direcao == 'saida' || autor != 'cliente';
  String quem = '';
  if (daLoja) {
    if (autor == 'loja') {
      quem = k == CanalDaConversa.direct ? 'loja · pelo app do Instagram' : 'loja · pela página no Facebook';
    } else if (autor == 'robo') {
      quem = k == CanalDaConversa.direct ? 'robô' : 'atendente virtual';
    } else {
      quem = (m['autorNome'] as String?)?.trim().isNotEmpty == true ? '${m['autorNome']}' : 'equipe';
    }
  }
  final texto = (m['texto'] as String?)?.trim();
  final falhou = daLoja && estado == 'falhou';
  return MensagemDaConversa(
    id: '${m['id'] ?? ''}',
    daLoja: daLoja,
    quem: quem,
    texto: texto != null && texto.isNotEmpty ? texto : (_descricao['${m['tipo'] ?? ''}'] ?? _descricao['outro']!),
    quando: _data(m['criadoEm']),
    situacao: falhou ? '✕ não saiu${erro != null && erro.isNotEmpty ? ': $erro' : ''}' : null,
    falhou: falhou,
    de: !daLoja ? 'cliente' : (autor == 'robo' ? 'robo' : 'loja'),
  );
}

/// A conversa lida: as mensagens, o aviso do topo (ponte, conexão), a linha de baixo (a janela de 24 h, a regra do chat)
/// e se dá para escrever agora — `motivoSemEnvio` diz por que não.
class ConversaLida {
  final List<MensagemDaConversa> mensagens;
  final String? aviso;
  final String? rodape;
  final bool podeEnviar;
  final String? motivoSemEnvio;
  const ConversaLida({required this.mensagens, required this.aviso, required this.rodape, required this.podeEnviar, required this.motivoSemEnvio});
}

String _dataHora(DateTime? t) {
  if (t == null) return '';
  String d(int n) => n.toString().padLeft(2, '0');
  return '${d(t.day)}/${d(t.month)} ${d(t.hour)}:${d(t.minute)}';
}

/// Lê a resposta do servidor (`GET /atendimento/:id/<conversa>`) com as mesmas regras de "pode escrever" do computador.
ConversaLida lerConversa(CanalDaConversa k, Caso c, Map<String, dynamic> j) {
  final lista = ((j['mensagens'] as List?) ?? const []).whereType<Map>().map((x) => Map<String, dynamic>.from(x)).toList();
  if (k == CanalDaConversa.chat) {
    final ponte = j['ponte'] is Map ? Map<String, dynamic>.from(j['ponte'] as Map) : const <String, dynamic>{};
    final ligada = ponte['ligada'] == true;
    final responde = ponte['responde'] != false;
    final disponivel = j['disponivel'] == true;
    final doCanal = c.canal == 'ifood' ? 'do iFood' : 'da 99';
    final onde = c.canal == 'ifood' ? 'Gestor de Pedidos do iFood' : 'portal da 99';
    String? aviso;
    if (!ligada) {
      aviso = 'A ponte do chat está desligada: as mensagens novas não chegam aqui. Para responder, use o $onde.';
    } else if (!responde) {
      aviso = 'Nenhum PC da loja está com a ponte $doCanal agora: o que você escrever sai quando ela voltar (se passar de 30 min, '
          'não sai mais). Para responder já, use o $onde.';
    }
    return ConversaLida(
      mensagens: [for (final m in lista) lerMensagem(k, m, ponteResponde: responde)],
      aviso: aviso,
      rodape: 'Sai pela ponte do PC da loja, como se alguém digitasse no chat $doCanal. Telefone, WhatsApp, Instagram e link o '
          'Regem barra: a plataforma proíbe.',
      podeEnviar: disponivel && ligada,
      motivoSemEnvio: !disponivel || !ligada ? 'Para responder, use o $onde.' : null,
    );
  }
  final conectada = j['conectada'] == true;
  final janela = j['janela'] is Map ? Map<String, dynamic>.from(j['janela'] as Map) : const <String, dynamic>{};
  final aberta = janela['aberta'] == true;
  final direct = k == CanalDaConversa.direct;
  final ate = _dataHora(_data(janela['ate']));
  return ConversaLida(
    mensagens: [for (final m in lista) lerMensagem(k, m)],
    aviso: conectada
        ? null
        : direct
            ? 'O Instagram da loja não está conectado: para responder, conecte em Delivery › Configurações › Operação › Atendimento, '
                'grupo "Instagram Direct", ou responda pelo app do Instagram.'
            : 'A página do Facebook não está conectada: para responder, conecte em Delivery › Configurações › Operação › '
                'Atendimento, grupo "Messenger do Facebook", ou responda pela caixa de entrada da página.',
    rodape: aberta
        ? '⏱️ Pode responder até $ate (24 h depois da última mensagem do cliente — regra ${direct ? 'do Instagram' : 'da Meta'}).'
        : 'Passaram 24 h da última mensagem do cliente: o ${direct ? 'Instagram' : 'Messenger'} não deixa a loja responder agora. '
            'Quando ele escrever de novo, a conversa abre.',
    podeEnviar: conectada && aberta,
    motivoSemEnvio: !conectada ? (direct ? 'O Instagram da loja não está conectado.' : 'A página do Facebook não está conectada.') : (!aberta ? 'A janela de 24 h fechou.' : null),
  );
}

/// No chat cabem até 300 letras (a regra do servidor — `texto-do-chat.ts`).
const textoMaxDoChat = 300;

/// Telefone, WhatsApp, Instagram ou link: a plataforma proíbe no chat (a MESMA régua do servidor e do computador).
final _contatoProibido = RegExp(
  r'(https?://|www\.|\.com\b|\.com\.br\b|wa\.me|whats|\bzap\b|\binsta(gram)?\b|@[a-z0-9_.]{3,}|\(?\d{2}\)?\s?9?\d{4}[-.\s]?\d{4})',
  caseSensitive: false,
);
bool temContatoProibido(String t) => _contatoProibido.hasMatch(t);

/// Confere o texto ANTES de enviar (quem decide é o servidor): null = pode ir; senão, o aviso.
String? conferirTexto(CanalDaConversa k, String t) {
  final s = t.trim();
  if (s.isEmpty) return 'Escreva a mensagem.';
  switch (k) {
    case CanalDaConversa.chat:
      if (s.length > textoMaxDoChat) return 'No chat da plataforma cabem até $textoMaxDoChat letras.';
      if (temContatoProibido(s)) return 'Telefone, WhatsApp, Instagram e link não podem ir pelo chat da plataforma: a plataforma proíbe.';
    case CanalDaConversa.direct:
      if (utf8.encode(s).length > 1000) return 'A mensagem passou do tamanho que o Instagram aceita. Divida em duas.';
    case CanalDaConversa.messenger:
      if (s.length > 2000) return 'No Messenger cabem até 2.000 letras por mensagem. Divida em duas.';
  }
  return null;
}

/// O que vai para o copiloto: as mensagens com texto, na régua do servidor (cliente | loja | robo | sistema), as 30 últimas.
List<Map<String, String>> paraOCopiloto(Iterable<MensagemDaConversa> msgs) {
  final todas = [for (final m in msgs) if (m.texto.trim().isNotEmpty && !m.texto.startsWith('[')) {'de': m.de, 'texto': m.texto}];
  return todas.length > 30 ? todas.sublist(todas.length - 30) : todas;
}

/// O copiloto só sugere com mensagem do cliente (o servidor recusa sem ela).
bool temMensagemDoCliente(Iterable<MensagemDaConversa> msgs) => msgs.any((m) => m.de == 'cliente' && m.texto.trim().isNotEmpty);
