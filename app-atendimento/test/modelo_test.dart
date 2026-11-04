import 'package:flutter_test/flutter_test.dart';
import 'package:regem_atendimento/modelo.dart';

// O app fala igual à tela do computador (`frontend/src/lib/atendimento.ts`): título do caso, tempos, o número do
// WhatsApp e o aviso ao gerente.
void main() {
  test('o título: cliente + plataforma + número (o da plataforma quando há)', () {
    expect(Caso({'cliente': 'Ana P.', 'canal': 'ifood', 'pedidoNaPlataforma': '4521', 'pedidoNumero': '12'}).titulo, 'Ana P. · pedido iFood 4521');
    expect(Caso({'cliente': 'Carlos', 'canal': 'whatsapp', 'pedidoNumero': '1180'}).titulo, 'Carlos · pedido #1180');
    expect(Caso({'pedidoCliente': 'Juliana'}).titulo, 'Juliana');
    expect(Caso({}).titulo, 'Cliente');
  });

  test('os tempos: desde e até o prazo', () {
    final agora = DateTime(2026, 11, 2, 19, 54);
    expect(tempoDesde(agora.subtract(const Duration(seconds: 30)), agora), 'agora');
    expect(tempoDesde(agora.subtract(const Duration(minutes: 4)), agora), '4 min');
    expect(tempoDesde(agora.subtract(const Duration(minutes: 80)), agora), '1 h 20 min');
    expect(tempoAte(agora.add(const Duration(minutes: 6, seconds: 12)), agora), '06:12');
    expect(tempoAte(agora.add(const Duration(hours: 1, minutes: 2, seconds: 3)), agora), '1:02:03');
    expect(tempoAte(agora.subtract(const Duration(seconds: 1)), agora), 'venceu');
  });

  test('o número do WhatsApp: 55 + DDD + número; o mesmo número com ou sem 55 e 9', () {
    expect(numeroDoWhatsapp('(21) 98765-4321'), '5521987654321');
    expect(numeroDoWhatsapp('2187654321'), '552187654321');
    expect(mesmoNumero('5521987654321', '21987654321'), isTrue);
    expect(mesmoNumero('552187654321', '5521987654321'), isTrue); // sem o 9
    expect(mesmoNumero('5521987654321', '5511912345678'), isFalse);
    expect(mesmoNumero('', '5521987654321'), isFalse);
  });

  test('o aviso ao gerente só vale com o caso na fila', () {
    final marca = {'escalado': {'em': '2026-11-02T22:50:00.000Z', 'minutos': 3}};
    expect(Caso({'situacao': 'fila', 'detalhe': marca}).escalado?.minutos, 3);
    expect(Caso({'situacao': 'com_alguem', 'detalhe': marca}).escalado, isNull);
    expect(Caso({'situacao': 'fila', 'detalhe': <String, dynamic>{}}).escalado, isNull);
  });

  test('a linha curta: o resumo do robô, senão a mensagem', () {
    expect(Caso({'detalhe': {'robo': {'motivo': 'atraso', 'quer': 'saber quando chega'}}, 'mensagem': 'x'}).linhaCurta, 'atraso · saber quando chega');
    expect(Caso({'mensagem': '  Veio sem\n o refrigerante '}).linhaCurta, 'Veio sem o refrigerante');
    expect(Caso({}).linhaCurta, isNull);
  });

  test('caso da plataforma: disputa e pedidos da 99 (sem "aguardar" e "resolver" à mão)', () {
    expect(Caso({'tipo': 'disputa'}).daPlataforma, isTrue);
    expect(Caso({'tipo': 'reembolso_99'}).daPlataforma, isTrue);
    expect(Caso({'tipo': 'humano'}).daPlataforma, isFalse);
  });

  test('os textos da 99 e o dinheiro', () {
    expect(traduzir(motivoCancelamento99, 'Preparing'), 'O pedido já está em preparo');
    expect(traduzir(motivoCancelamento99, 'algo novo'), 'algo novo');
    expect(brl(1290), r'R$ 12,90');
    expect(brlR(8), r'R$ 8,00');
  });

  // O ENDEREÇO DEPOIS QUE O PEDIDO SAIU (PR 3b-2): o app lê o que o robô anotou no caso e fala igual à tela do computador
  // (`frontend/src/lib/endereco-do-caso.ts`).
  Map<String, dynamic> endereco([Map<String, dynamic> o = const {}]) => {
        'endereco': {
          'pedidoId': 'p1',
          'numero': '951',
          'de': {'rua': 'Rua das Flores', 'numero': '120', 'bairro': 'Centro', 'referencia': null},
          'para': {'rua': 'Rua Ipê', 'numero': '45', 'bairro': 'Jardim América', 'bairroId': null, 'referencia': 'casa azul'},
          'taxaAntes': 6,
          'taxaNova': 8,
          'total': 36,
          'aReceber': 36,
          'comANova': {'total': 38, 'aReceber': 38},
          'pagoAntes': false,
          'formaPagamento': 'Dinheiro',
          'trocoPara': 50,
          'entregador': {'nome': 'João Silva', 'telefone': '21988887777', 'saiuEm': '2026-11-04T23:05:00.000Z'},
          'em': '2026-11-04T23:06:00.000Z',
          ...o,
        },
      };

  test('o endereço do caso: só no caso "Mudança no pedido" e com a forma certa', () {
    final e = Caso({'tipo': 'mudanca', 'detalhe': endereco()}).endereco!;
    expect(e.numero, '951');
    expect(e.de.emUmaLinha, 'Rua das Flores, 120 · Centro');
    expect(e.para.emUmaLinha, 'Rua Ipê, 45 · Jardim América');
    expect(e.para.ruaENumero, 'Rua Ipê, 45');
    expect(e.textoDoPagamento, r'Dinheiro · troco para R$ 50,00');
    expect(Caso({'tipo': 'erro', 'detalhe': endereco()}).endereco, isNull);
    expect(Caso({'tipo': 'mudanca', 'detalhe': {'endereco': {'pedidoId': 'p1'}}}).endereco, isNull);
    expect(Caso({'tipo': 'mudanca', 'detalhe': <String, dynamic>{}}).endereco, isNull);
  });

  test('a distância: medindo, não deu, pelo caminho (com os minutos) ou em linha reta', () {
    expect(Caso({'tipo': 'mudanca', 'detalhe': endereco()}).endereco!.textoDaDistancia, 'medindo…');
    expect(Caso({'tipo': 'mudanca', 'detalhe': endereco({'distancia': null})}).endereco!.textoDaDistancia, 'não deu para medir (confira no mapa)');
    expect(Caso({'tipo': 'mudanca', 'detalhe': endereco({'distancia': {'km': 2.4, 'min': 7, 'pelo': 'caminho'}})}).endereco!.textoDaDistancia,
        '2,4 km pelo caminho (≈ 7 min de moto)');
    expect(Caso({'tipo': 'mudanca', 'detalhe': endereco({'distancia': {'km': 3, 'min': null, 'pelo': 'linha_reta'}})}).endereco!.textoDaDistancia,
        '3,0 km em linha reta');
  });

  test('"cobrar a nova": só quando dá (a conta do servidor); senão vale a do pedido', () {
    final e = Caso({'tipo': 'mudanca', 'detalhe': endereco()}).endereco!;
    expect(e.porQueNaoCobraANova, isNull);
    expect(e.escolhaQueVale('nova'), 'nova');
    expect(e.valoresDaEscolha('nova'), (total: 38.0, aReceber: 38.0));
    expect(e.valoresDaEscolha('manter'), (total: 36.0, aReceber: 36.0));
    String? motivo(Map<String, dynamic> o) => Caso({'tipo': 'mudanca', 'detalhe': endereco(o)}).endereco!.porQueNaoCobraANova;
    expect(motivo({'taxaNova': null, 'comANova': null}), 'o endereço novo fica fora da área de entrega');
    expect(motivo({'pagoAntes': true}), 'o pedido foi pago pelo link');
    expect(motivo({'taxaNova': 6}), 'a taxa da área nova é a mesma');
    expect(motivo({'comANova': {'recusa': r'O troco para R$ 50,00 não cobre o novo valor (R$ 52,00): pergunte ao cliente.'}}),
        r'O troco para R$ 50,00 não cobre o novo valor (R$ 52,00): pergunte ao cliente');
    final pago = Caso({'tipo': 'mudanca', 'detalhe': endereco({'pagoAntes': true})}).endereco!;
    expect(pago.escolhaQueVale('nova'), 'manter');
  });

  test('a mensagem pronta ao entregador e o link do WhatsApp dele; o rascunho do "Não dá"; o aviso ao cliente', () {
    final e = Caso({'tipo': 'mudanca', 'detalhe': endereco()}).endereco!;
    expect(e.mensagemAoEntregador('nova'),
        r'Oi, João! O endereço do pedido nº 951 mudou: agora é Rua Ipê, 45 · Jardim América (casa azul). Receber R$ 38,00 (troco para R$ 50,00).');
    expect(e.mensagemAoEntregador('manter'), contains(r'Receber R$ 36,00'));
    final link = e.linkDoEntregador('nova')!;
    expect(link.host, 'wa.me');
    expect(link.path, '/5521988887777');
    expect(link.queryParameters['text'], e.mensagemAoEntregador('nova'));
    expect(Caso({'tipo': 'mudanca', 'detalhe': endereco({'entregador': null})}).endereco!.linkDoEntregador('manter'), isNull);
    expect(Caso({'tipo': 'mudanca', 'detalhe': endereco({'pagoAntes': true})}).endereco!.mensagemAoEntregador('manter'), endsWith('O pedido já está pago.'));
    expect(e.rascunhoNaoDa,
        'Não conseguimos mudar o endereço do pedido nº 951: o entregador já está a caminho da Rua das Flores, 120. Você consegue receber lá?');
    expect(e.textoAoCliente, 'Endereço atualizado! O entregador já está indo para a Rua Ipê, 45 👍');
  });

  test('em que pé está a mudança: pela alteração do pedido (aplicada, pedida, recusada) e o aviso ao cliente', () {
    expect(Caso({'mudancaDoEndereco': {'situacao': 'aplicada', 'motivo': null, 'aviso': {'em': 'x'}}}).mudancaDoEndereco!.avisoSaiu, isTrue);
    final falhou = Caso({'mudancaDoEndereco': {'situacao': 'aplicada', 'aviso': {'em': 'x', 'falhou': 'Falha ao enviar (sem resposta): '}}}).mudancaDoEndereco!;
    expect(falhou.avisoSaiu, isFalse);
    expect(falhou.avisoFalhou, 'Falha ao enviar (sem resposta): ');
    expect(Caso({'mudancaDoEndereco': {'situacao': 'aplicada', 'aviso': null}}).mudancaDoEndereco!.temAviso, isFalse);
    expect(Caso({'mudancaDoEndereco': {'situacao': 'recusada', 'motivo': 'O pedido mudou.'}}).mudancaDoEndereco!.motivo, 'O pedido mudou.');
    expect(Caso({}).mudancaDoEndereco, isNull);
  });
}
