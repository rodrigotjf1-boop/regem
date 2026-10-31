import { PREFIXO_TITULO, WhatsappCloudService, cabeEmBotoes, cortarNaPalavra, opcoesValidas } from './whatsapp-cloud.service';
import { menuNumerado } from './robo-resposta.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS OPÇÕES QUE O ROBÔ MANDA (F5 — teste do dono, 31/10/2026): "Pagar na entrega (dinheiro ou maquininha)" chegava como
// "Pagar na entrega (d…" no botão, e o robô cortava os 7 refrigerantes em 3. Agora: "Título — detalhe" vira a descrição
// da linha da lista; botões só quando cabem inteiros; o título cortado na lista volta inteiro na resposta.
describe('opções do robô', () => {
  it('"Título — detalhe" separa o detalhe na descrição; sem detalhe, fica como veio', () => {
    expect(opcoesValidas([{ titulo: 'Bacon — +R$ 3,50' }, { titulo: 'Não, obrigado' }])).toEqual([
      { id: '1', titulo: 'Bacon', descricao: '+R$ 3,50' },
      { id: '2', titulo: 'Não, obrigado', descricao: undefined },
    ]);
    // Hífen comum faz parte do nome ("Batata Frita - Media"): só o travessão do Regem separa.
    expect(opcoesValidas([{ titulo: 'Batata Frita - Media' }])[0]).toEqual({ id: '1', titulo: 'Batata Frita - Media', descricao: undefined });
  });

  it('título maior que a linha da lista: o id guarda o nome inteiro (a resposta volta com ele)', () => {
    const [o] = opcoesValidas([{ titulo: 'Batata com cheddar e farofa de bacon - Grande — R$ 32,00' }]);
    expect(o.titulo).toBe('Batata com cheddar e farofa de bacon - Grande');
    expect(o.id).toBe(`${PREFIXO_TITULO}Batata com cheddar e farofa de bacon - Grande`);
    expect(cortarNaPalavra(o.titulo, 24)).toBe('Batata com cheddar e…');
    const textoDe = (m: any) => (WhatsappCloudService.prototype as any).textoDe.call({}, m);
    expect(textoDe({ type: 'interactive', interactive: { list_reply: { id: o.id, title: 'Batata com cheddar e…' } } })).toBe(o.titulo);
    expect(textoDe({ type: 'interactive', interactive: { button_reply: { id: '2', title: 'Pode registrar' } } })).toBe('Pode registrar');
  });

  it('botões só quando cabem INTEIROS (até 3, até 20 letras, sem preço que ficaria de fora); senão lista', () => {
    expect(cabeEmBotoes(opcoesValidas([{ titulo: 'Sim, nesse' }, { titulo: 'Outro endereço' }, { titulo: 'Retirar na loja' }]))).toBe(true);
    expect(cabeEmBotoes(opcoesValidas([{ titulo: 'Dinheiro — pago na entrega' }, { titulo: 'Cartão na entrega — débito ou crédito na maquininha' }]))).toBe(true);
    expect(cabeEmBotoes(opcoesValidas([{ titulo: 'Pagar na entrega (dinheiro ou maquininha)' }]))).toBe(false);
    expect(cabeEmBotoes(opcoesValidas([{ titulo: 'Bacon — +R$ 3,50' }, { titulo: 'Não, obrigado' }]))).toBe(false); // o preço apareceria só na lista
    const refris = ['Coca Cola - Lata', 'Fanta Laranja', 'Guaraná', 'Coca Zero', 'Fanta Uva', 'Sprite', 'Guaraviton'].map((titulo) => ({ titulo }));
    expect(cabeEmBotoes(opcoesValidas(refris))).toBe(false);
    expect(opcoesValidas(refris)).toHaveLength(7); // nenhuma fica de fora
  });

  it('no número sem botão (QR), o menu numerado mostra o detalhe', () => {
    expect(menuNumerado('Qual adicional?', [{ titulo: 'Bacon — +R$ 3,50' }, { titulo: 'Não, obrigado' }])).toBe(
      'Qual adicional?\n\n1) Bacon — +R$ 3,50\n2) Não, obrigado\n\nResponda com o número da opção.',
    );
  });
});
