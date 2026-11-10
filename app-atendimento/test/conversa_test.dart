import 'package:flutter_test/flutter_test.dart';
import 'package:regem_atendimento/conversa.dart';
import 'package:regem_atendimento/modelo.dart';

// AS CONVERSAS DO CASO NO APP (1.1): as mesmas regras da tela do computador — qual conversa cada caso tem, o que cada
// mensagem diz, quando dá para escrever, a conferência do texto antes do envio e o que vai para o copiloto.
void main() {
  final chatIfood = Caso({'id': 'c1', 'tipo': 'chat', 'canal': 'ifood', 'cliente': 'Isabel C.'});
  final chat99 = Caso({'id': 'c2', 'tipo': 'chat', 'canal': '99food'});
  final direct = Caso({'id': 'c3', 'tipo': 'instagram', 'canal': 'instagram'});
  final messenger = Caso({'id': 'c4', 'tipo': 'messenger', 'canal': 'messenger'});

  test('qual conversa: chat do iFood/99 no "Mensagem no chat", Direct, Messenger; o resto, nenhuma aqui', () {
    expect(conversaDoCaso(chatIfood), CanalDaConversa.chat);
    expect(conversaDoCaso(chat99), CanalDaConversa.chat);
    expect(conversaDoCaso(direct), CanalDaConversa.direct);
    expect(conversaDoCaso(messenger), CanalDaConversa.messenger);
    expect(conversaDoCaso(Caso({'tipo': 'chat', 'canal': 'whatsapp'})), isNull);
    expect(conversaDoCaso(Caso({'tipo': 'disputa', 'canal': 'ifood'})), isNull);
    expect(conversaDoCaso(Caso({'tipo': 'erro', 'canal': 'whatsapp'})), isNull);
    expect([for (final k in CanalDaConversa.values) caminhoDaConversa(k)], ['chat', 'instagram', 'messenger']);
    expect(tituloDaConversa(CanalDaConversa.chat, chat99), 'Chat da 99');
    // os nomes que o app não conhecia (o print do dono mostrava "Atendimento" no caso do chat)
    expect(chatIfood.rotulo, 'Mensagem no chat');
    expect(direct.rotuloCanal, 'Instagram');
  });

  test('o chat: quem falou e como está cada envio — como o computador', () {
    MensagemDaConversa ler(Map<String, dynamic> m, {bool responde = true}) => lerMensagem(CanalDaConversa.chat, m, ponteResponde: responde);
    final cliente = ler({'id': '1', 'direcao': 'entrada', 'autor': 'cliente', 'texto': 'estou indo', 'estado': 'recebida', 'em': '2026-11-10T03:10:00Z'});
    expect([cliente.daLoja, cliente.quem, cliente.situacao, cliente.de], [false, '', null, 'cliente']);
    expect(cliente.quando, DateTime.parse('2026-11-10T03:10:00Z').toLocal());
    expect(ler({'direcao': 'entrada', 'autor': 'loja', 'texto': 'oi'}).quem, 'loja · pelo app da plataforma');
    final aviso = ler({'direcao': 'saida', 'autor': 'aviso', 'motivo': 'saiu', 'texto': 'Seu pedido saiu', 'estado': 'enviada'});
    expect([aviso.quem, aviso.situacao, aviso.de], ['aviso automático "saiu para entrega"', '✓ enviada', 'sistema']);
    expect(ler({'direcao': 'saida', 'autor': 'robo', 'roboIa': true, 'estado': 'enviada'}).quem, 'atendente virtual');
    expect(ler({'direcao': 'saida', 'autor': 'robo', 'estado': 'enviada'}).quem, 'robô');
    expect(ler({'direcao': 'saida', 'autor': 'equipe', 'quem': 'Ana', 'estado': 'enviando'}).situacao, '⏳ saindo pela ponte…');
    expect(ler({'direcao': 'saida', 'autor': 'equipe', 'estado': 'pendente'}).situacao, '⏳ na fila da ponte');
    expect(ler({'direcao': 'saida', 'autor': 'equipe', 'estado': 'pendente'}, responde: false).situacao, '⏳ esperando a ponte');
    final venceu = ler({'direcao': 'saida', 'autor': 'equipe', 'estado': 'cancelada'});
    expect([venceu.situacao, venceu.falhou], ['✕ não saiu: passou da hora (30 min)', true]);
    expect(ler({'direcao': 'saida', 'autor': 'equipe', 'estado': 'falhou', 'erro': 'há algo na frente do botão'}).situacao, '✕ não saiu: há algo na frente do botão');
    expect(ler({'direcao': 'saida', 'autor': 'equipe', 'estado': 'falhou'}).situacao, '✕ não saiu');
    expect(ler({'direcao': 'saida', 'autor': 'equipe', 'estado': 'enviada'}).quem, 'equipe');
  });

  test('o Direct e o Messenger: mídia descrita, quem da loja, o envio que falhou', () {
    final foto = lerMensagem(CanalDaConversa.direct, {'id': 'a', 'direcao': 'entrada', 'autor': 'cliente', 'tipo': 'imagem', 'texto': null, 'criadoEm': '2026-11-10T03:00:00Z'});
    expect([foto.texto, foto.daLoja, foto.de], ['[foto]', false, 'cliente']);
    expect(lerMensagem(CanalDaConversa.direct, {'direcao': 'saida', 'autor': 'loja', 'texto': 'oi'}).quem, 'loja · pelo app do Instagram');
    expect(lerMensagem(CanalDaConversa.messenger, {'direcao': 'saida', 'autor': 'loja', 'texto': 'oi'}).quem, 'loja · pela página no Facebook');
    expect(lerMensagem(CanalDaConversa.messenger, {'direcao': 'saida', 'autor': 'robo', 'texto': 'oi'}).quem, 'atendente virtual');
    final falhou = lerMensagem(CanalDaConversa.direct, {'direcao': 'saida', 'autor': 'equipe', 'autorNome': 'Bia', 'texto': 'x', 'estado': 'falhou', 'erro': 'fora da janela'});
    expect([falhou.quem, falhou.situacao, falhou.falhou], ['Bia', '✕ não saiu: fora da janela', true]);
    expect(lerMensagem(CanalDaConversa.messenger, {'direcao': 'entrada', 'autor': 'cliente', 'tipo': 'xyz'}).texto, '[mensagem que o app não mostra aqui]');
  });

  test('o chat: ponte desligada e PC fora avisam; escrever só com a ponte ligada e o chat disponível', () {
    final desligada = lerConversa(CanalDaConversa.chat, chatIfood, {'disponivel': true, 'ponte': {'ligada': false, 'responde': false}, 'mensagens': []});
    expect(desligada.aviso, contains('A ponte do chat está desligada'));
    expect(desligada.aviso, contains('Gestor de Pedidos do iFood'));
    expect(desligada.podeEnviar, isFalse);
    final semPc = lerConversa(CanalDaConversa.chat, chat99, {'disponivel': true, 'ponte': {'ligada': true, 'responde': false}, 'mensagens': []});
    expect(semPc.aviso, contains('Nenhum PC da loja está com a ponte da 99 agora'));
    expect(semPc.podeEnviar, isTrue); // sai quando a ponte voltar (até 30 min)
    final ok = lerConversa(CanalDaConversa.chat, chatIfood, {
      'disponivel': true,
      'ponte': {'ligada': true, 'responde': true},
      'mensagens': [
        {'id': '1', 'direcao': 'entrada', 'autor': 'cliente', 'texto': 'oi'},
      ],
    });
    expect([ok.aviso, ok.podeEnviar, ok.mensagens.length], [null, true, 1]);
    expect(ok.rodape, contains('Telefone, WhatsApp, Instagram e link o Regem barra'));
    expect(lerConversa(CanalDaConversa.chat, chatIfood, {'disponivel': false, 'ponte': {'ligada': true}}).podeEnviar, isFalse);
  });

  test('o Direct e o Messenger: desconectado avisa; a janela de 24 h abre e fecha o envio', () {
    final semConta = lerConversa(CanalDaConversa.direct, direct, {'conectada': false, 'janela': {'aberta': true}, 'mensagens': []});
    expect(semConta.aviso, contains('O Instagram da loja não está conectado'));
    expect(semConta.podeEnviar, isFalse);
    final fechada = lerConversa(CanalDaConversa.messenger, messenger, {'conectada': true, 'janela': {'aberta': false, 'ate': null}, 'mensagens': []});
    expect(fechada.rodape, startsWith('Passaram 24 h da última mensagem do cliente: o Messenger não deixa'));
    expect([fechada.podeEnviar, fechada.motivoSemEnvio], [false, 'A janela de 24 h fechou.']);
    final aberta = lerConversa(CanalDaConversa.direct, direct, {'conectada': true, 'janela': {'aberta': true, 'ate': '2026-11-11T02:00:00Z'}, 'mensagens': []});
    expect(aberta.podeEnviar, isTrue);
    expect(aberta.rodape, startsWith('⏱️ Pode responder até '));
    expect(aberta.rodape, contains('regra do Instagram'));
  });

  test('o texto antes de enviar: no chat, 300 letras e nada de contato; Direct em bytes; Messenger 2.000', () {
    expect(conferirTexto(CanalDaConversa.chat, '  '), 'Escreva a mensagem.');
    expect(conferirTexto(CanalDaConversa.chat, 'Já anotamos, chega em instantes. Pedido 5073.'), isNull);
    expect(conferirTexto(CanalDaConversa.chat, 'x' * 301), 'No chat da plataforma cabem até 300 letras.');
    for (final proibido in ['me liga 21 99999-0000', 'chama no whats', 'veja www.loja.com', '@misterburguer', 'manda no zap']) {
      expect(conferirTexto(CanalDaConversa.chat, proibido), contains('a plataforma proíbe'), reason: proibido);
    }
    expect(conferirTexto(CanalDaConversa.direct, 'link: www.loja.com.br e 21 99999-0000'), isNull); // no Instagram o canal é da loja
    expect(conferirTexto(CanalDaConversa.direct, '🍔' * 251), contains('passou do tamanho')); // 4 bytes cada: 1.004
    expect(conferirTexto(CanalDaConversa.direct, '🍔' * 250), isNull); // 1.000 bytes: cabe
    expect(conferirTexto(CanalDaConversa.messenger, 'x' * 2001), contains('2.000 letras'));
    expect(conferirTexto(CanalDaConversa.messenger, 'x' * 2000), isNull);
  });

  test('o copiloto: só as mensagens com texto, na régua do servidor, as 30 últimas; e só com fala do cliente', () {
    final msgs = [
      for (var i = 0; i < 33; i++) lerMensagem(CanalDaConversa.chat, {'id': '$i', 'direcao': 'entrada', 'autor': 'cliente', 'texto': 'msg $i'}),
      lerMensagem(CanalDaConversa.direct, {'direcao': 'entrada', 'autor': 'cliente', 'tipo': 'imagem'}),
      lerMensagem(CanalDaConversa.chat, {'direcao': 'saida', 'autor': 'aviso', 'texto': 'saiu', 'estado': 'enviada'}),
    ];
    final p = paraOCopiloto(msgs);
    expect(p.length, 30);
    expect(p.last, {'de': 'sistema', 'texto': 'saiu'});
    expect(p.any((m) => m['texto'] == '[foto]'), isFalse);
    expect(temMensagemDoCliente(msgs), isTrue);
    expect(temMensagemDoCliente([lerMensagem(CanalDaConversa.chat, {'direcao': 'saida', 'autor': 'aviso', 'texto': 'saiu'})]), isFalse);
  });
}
