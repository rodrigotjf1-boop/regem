import {
  PedidoDoComprovante,
  decidirComprovante,
  falaDePagamento,
  fraseDaEquipe,
  soFalaDePagamento,
  telefoneParecido,
  textoDoAguardando,
  textoDoCancelado,
  textoDoNaEntrega,
  textoDoPago,
  textoDoSemPedido,
} from './comprovante-do-cliente';

// O COMPROVANTE DO CLIENTE (16/11/2026 — pedido do dono): "só é preciso saber que é um comprovante"; a resposta sai do
// PEDIDO no sistema. As regras puras: quando a foto/o documento conta como comprovante, qual a situação, e os textos.
describe('o comprovante que o cliente manda — as regras', () => {
  const AGORA = new Date('2026-11-16T22:00:00Z');
  const ha = (min: number) => new Date(AGORA.getTime() - min * 60_000);
  const pedido = (o: Partial<PedidoDoComprovante> = {}): PedidoDoComprovante => ({
    id: 'p1', numero: '1180', status: 'confirmado', statusPagamento: 'aprovado', pago: true, sinalPago: false, online: true, tipo: 'entrega', clienteNome: 'maria souza', criadoEm: ha(10), ...o,
  });
  const decidir = (o: any) => decidirComprovante({ tipo: 'image', pedidos: [], agora: AGORA, ...o });

  it('só foto e documento: áudio, vídeo, figurinha e texto nunca são comprovante', () => {
    for (const tipo of ['audio', 'video', 'sticker', 'text', 'location', undefined])
      expect(decidir({ tipo, legenda: 'comprovante do pix', pedidos: [pedido()] }).caso).toBe('nao_e');
    expect(decidir({ tipo: 'document', pedidos: [pedido()] }).caso).toBe('pago');
  });

  it('o caso mais comum: pagou, o sistema já confirmou e o cliente manda o print SEM legenda → a positiva', () => {
    expect(decidir({ pedidos: [pedido({ status: 'novo' })] })).toMatchObject({ caso: 'pago', pedido: { numero: '1180' } });
    expect(decidir({ pedidos: [pedido({ status: 'pronto' })] }).caso).toBe('pago');
  });

  it('foto sem legenda DEPOIS que o pedido saiu (pode ser o lanche errado) ou de pedido pago há horas: não é — segue ao atendente', () => {
    expect(decidir({ pedidos: [pedido({ status: 'despachado' })] }).caso).toBe('nao_e');
    expect(decidir({ pedidos: [pedido({ status: 'concluido' })] }).caso).toBe('nao_e');
    expect(decidir({ pedidos: [pedido({ criadoEm: ha(200) })] }).caso).toBe('nao_e');
    expect(decidir({ pedidos: [pedido({ online: false, pago: false, statusPagamento: 'na_entrega' })] }).caso).toBe('nao_e'); // paga na entrega
    expect(decidir({ pedidos: [] }).caso).toBe('nao_e');
  });

  it('com o Pix esperando, a foto é o comprovante — com ou sem legenda (e ganha de um pedido pago mais antigo)', () => {
    const esperando = pedido({ id: 'p2', numero: '1181', status: 'novo', statusPagamento: 'aguardando', pago: false, criadoEm: ha(3) });
    expect(decidir({ pedidos: [pedido(), esperando] })).toMatchObject({ caso: 'aguardando', pedido: { id: 'p2' } });
    expect(decidir({ pedidos: [esperando], legenda: 'paguei' }).caso).toBe('aguardando');
  });

  it('falando de pagamento (legenda, nome do arquivo ou a mensagem de antes): pago que já saiu, cancelado, na entrega, sem pedido', () => {
    expect(decidir({ legenda: 'segue o comprovante', pedidos: [pedido({ status: 'concluido' })] }).caso).toBe('pago');
    expect(decidir({ tipo: 'document', arquivoNome: 'Comprovante_2026-11-16.pdf', pedidos: [pedido({ status: 'despachado' })] }).caso).toBe('pago');
    expect(decidir({ antes: ['oi', 'já paguei'], pedidos: [pedido({ status: 'cancelado', pago: false, statusPagamento: 'aguardando' })] }).caso).toBe('cancelado');
    expect(decidir({ legenda: 'pix feito', pedidos: [pedido({ online: false, pago: false, statusPagamento: 'na_entrega' })] }).caso).toBe('na_entrega');
    expect(decidir({ legenda: 'comprovante', pedidos: [] }).caso).toBe('sem_pedido');
    // o sinal da encomenda pago conta como quitado
    expect(decidir({ pedidos: [pedido({ pago: false, sinalPago: true, statusPagamento: 'aguardando' })] }).caso).toBe('pago');
    // só um orçamento (a encomenda que a loja ainda vai confirmar): não é caso de comprovante
    expect(decidir({ legenda: 'comprovante', pedidos: [pedido({ online: false, pago: false, statusPagamento: 'orcamento' })] }).caso).toBe('nao_e');
    // refez o pedido para pagar na entrega depois do Pix vencido: fala do mais novo
    const vencido = pedido({ id: 'velho', status: 'cancelado', pago: false, statusPagamento: 'aguardando', criadoEm: ha(50) });
    const novo = pedido({ id: 'novo', online: false, pago: false, statusPagamento: 'na_entrega', criadoEm: ha(5) });
    expect(decidir({ legenda: 'paguei', pedidos: [vencido, novo] })).toMatchObject({ caso: 'na_entrega', pedido: { id: 'novo' } });
  });

  it('falaDePagamento e soFalaDePagamento: o texto só do pagamento × o texto com outro assunto', () => {
    for (const t of ['Comprovante', 'paguei!', 'segue o PIX', 'fiz a transferência', 'tá pago', 'recibo_123.pdf', 'já pago']) expect([t, falaDePagamento(t)]).toEqual([t, true]);
    for (const t of ['oi', 'olha a foto', 'minha casa é essa', 'pagode', 'IMG_2031.jpg', '']) expect([t, falaDePagamento(t)]).toEqual([t, false]);
    for (const t of ['paguei, segue o comprovante', 'pix feito', '']) expect([t, soFalaDePagamento(t)]).toEqual([t, true]);
    for (const t of ['paguei e quero mais uma coca', 'segue o comprovante, cadê meu pedido?', 'oi tudo bem'])
      expect([t, soFalaDePagamento(t)]).toEqual([t, false]);
  });

  it('telefoneParecido: um dígito trocado, dois vizinhos invertidos, um a mais ou a menos — nunca o igual nem o de outro DDD inteiro', () => {
    expect(telefoneParecido('5521987654321', '21987654322')).toBe(true); // um dígito
    expect(telefoneParecido('21987654321', '21987654231')).toBe(true); // invertidos
    expect(telefoneParecido('21987654321', '2198765432')).toBe(true); // faltou um
    expect(telefoneParecido('21987654321', '+55 (21) 98765-4321')).toBe(false); // o mesmo
    expect(telefoneParecido('21987654321', '11912345678')).toBe(false);
    expect(telefoneParecido('21987654321', '21987650000')).toBe(false);
    expect(telefoneParecido('21987654321', '')).toBe(false);
  });

  it('os textos: a positiva com o primeiro nome e a situação; o aguardando sem prometer; nada do pedido de outro número', () => {
    expect(textoDoPago(pedido())).toBe('✅ *Pagamento confirmado*, Maria!\nSeu pedido nº 1180 já está em produção 👨‍🍳.\nObrigado pela preferência 🙌');
    expect(textoDoPago(pedido({ clienteNome: null, status: 'pronto', tipo: 'retirada' }))).toContain('✅ *Pagamento confirmado*!\nSeu pedido nº 1180 está pronto para retirada');
    expect(textoDoPago(pedido({ pago: false, sinalPago: true, statusPagamento: 'aguardando' }))).toContain('*Sinal confirmado*');
    const aguardando = textoDoAguardando(pedido({ numero: '77' }));
    expect(aguardando).toContain('O pagamento do pedido nº 77 ainda não apareceu por aqui');
    expect(aguardando).not.toMatch(/em instantes|já chamei/i);
    expect(textoDoNaEntrega(pedido(), { posicao: 2 })).toContain('está marcado para *pagar na entrega*');
    expect(textoDoNaEntrega(pedido(), { posicao: 2 })).toContain('Já chamei a equipe para conferir e te respondem por aqui. Você é o 2º da fila.');
    expect(textoDoCancelado(pedido({ status: 'cancelado' }), null)).toContain('será devolvido automaticamente');
    expect(textoDoCancelado(pedido({ status: 'cancelado', pago: false }), { comAlguem: true })).toContain('A pessoa que já está com o seu caso');
    const sem = textoDoSemPedido({ posicao: null });
    expect(sem).toContain('não achei pedido feito com este número de WhatsApp');
    expect(sem).toContain('telefone (com DDD) que você colocou no pedido');
    expect(sem).not.toMatch(/nº \d/);
  });

  it('a frase da equipe: fora do horário vale o texto da loja; sem caso aberto, não diz que chamou', () => {
    expect(fraseDaEquipe({ foraDoHorario: true, paraOCliente: 'Nossa equipe volta amanhã às 18h. Seu recado ficou guardado.' })).toBe('Nossa equipe volta amanhã às 18h. Seu recado ficou guardado.');
    expect(fraseDaEquipe(null)).not.toMatch(/chamei/);
    expect(fraseDaEquipe({ posicao: 0 })).toBe('Já chamei a equipe para conferir e te respondem por aqui.');
  });
});
