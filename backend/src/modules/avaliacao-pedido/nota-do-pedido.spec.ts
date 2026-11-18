import { BadRequestException } from '@nestjs/common';
import { DeliveryService } from '../delivery/delivery.service';
import { grupoDoPlacar } from '../atendimento/numeros';
import {
  CANAIS_FORA_DO_REGEM,
  OPCOES_DO_PESO,
  abreCaso,
  ajustesDaNotaDaLinha,
  ajustesDaNotaNovos,
  conferirNota,
  ehPedidoDoRegem,
  googleDaNota,
  itensEmUmaLinha,
  mensagemDoCaso,
} from './nota-do-pedido';
import { NotaDoPedidoService } from './nota-do-pedido.service';
import { CANAIS_DE_FORA } from '../whatsapp/conferir-entrega';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A NOTA DO PEDIDO (mig 453, fase A1) — as regras sem banco. O que vai ao banco está em
// `whatsapp/pedir-avaliacao-pg.spec.ts` (a spec que já aplica a cadeia do robô — ERR-451).

const LINK = 'https://g.page/r/CabcDEF123/review';

describe('a nota do pedido — regras', () => {
  it('o que a página manda: a nota de 1 a 5; "o que pesou" só das opções, sem repetir e na ordem da tela; o comentário limpo', () => {
    expect(conferirNota({ nota: 5 })).toEqual({ nota: 5, pesou: [], comentario: null });
    expect(conferirNota({ nota: 2, pesou: ['Tempo de entrega', 'Sabor', 'Sabor'], comentario: '  Chegou frio.\u0007  ' })).toEqual({
      nota: 2,
      pesou: ['Sabor', 'Tempo de entrega'],
      comentario: 'Chegou frio.',
    });
    expect(conferirNota({ nota: 4, comentario: '   ' }).comentario).toBeNull();
    expect(conferirNota({ nota: 3, comentario: 'linha 1\nlinha 2' }).comentario).toBe('linha 1\nlinha 2');
    expect(conferirNota({ nota: 3, comentario: 'é'.repeat(300) }).comentario).toHaveLength(300);
    for (const ruim of [null, {}, { nota: 0 }, { nota: 6 }, { nota: 4.5 }, { nota: '5' }, { nota: true }])
      expect(() => conferirNota(ruim)).toThrow(/nota de 1 a 5/);
    expect(() => conferirNota({ nota: 5, pesou: ['Atendimento'] })).toThrow(/escolha entre/);
    expect(() => conferirNota({ nota: 5, pesou: 'Sabor' })).toThrow(BadRequestException);
    expect(() => conferirNota({ nota: 5, comentario: 'x'.repeat(301) })).toThrow(/300 letras/);
    expect(() => conferirNota({ nota: 5, comentario: 42 })).toThrow(BadRequestException);
    expect(OPCOES_DO_PESO).toHaveLength(6); // o banco aceita até 6 (ck_pedido_avaliacao_pesou)
  });

  it('o link do Google: SÓ na nota 5 (decisão do dono) e só o link do Google', () => {
    expect(googleDaNota(5, LINK)).toBe(LINK);
    for (const n of [1, 2, 3, 4, null, undefined]) expect(googleDaNota(n as any, LINK)).toBeNull();
    expect(googleDaNota(5, 'https://site-da-loja.com.br/avalie')).toBeNull();
    expect(googleDaNota(5, null)).toBeNull();
  });

  it('a nota que abre caso: até a escolhida pela loja', () => {
    expect([1, 2, 3, 4, 5].filter((n) => abreCaso(n, 2))).toEqual([1, 2]);
    expect([1, 2, 3, 4, 5].filter((n) => abreCaso(n, 1))).toEqual([1]);
    expect([1, 2, 3, 4, 5].filter((n) => abreCaso(n, 3))).toEqual([1, 2, 3]);
  });

  it('quais pedidos: a MESMA regra de `DeliveryService.podeAvisarPeloWhatsapp` (V74), e o "Chegou tudo certo?" com a mesma lista', () => {
    const canais = ['cardapio', 'manual', 'balcao', 'n8n', '', ...CANAIS_FORA_DO_REGEM, 'IFOOD', 'AnotaAi', ' anotaai '];
    for (const c of canais) expect([c, ehPedidoDoRegem(c)]).toEqual([c, DeliveryService.podeAvisarPeloWhatsapp(c.trim())]);
    expect(ehPedidoDoRegem(null)).toBe(true);
    // decisão 9: o "Chegou tudo certo?" também barra o Anota Aí
    expect(CANAIS_DE_FORA).toEqual(expect.arrayContaining(['ifood', '99food', 'anotaai']));
  });

  it('os ajustes: nascem desligados (nota até 2, 7 dias); o ausente mantém (V16); liga/desliga só verdadeiro/falso (V15); só as opções', () => {
    const padrao = ajustesDaNotaDaLinha(null);
    expect(padrao).toEqual({ ativa: false, casoAte: 2, prazoDias: 7 });
    expect(ajustesDaNotaDaLinha({ nota_ativa: true, nota_caso_ate: 9, nota_prazo_dias: 30 })).toEqual({ ativa: true, casoAte: 2, prazoDias: 30 });
    expect(ajustesDaNotaNovos({ ativa: true }, padrao)).toEqual({ ativa: true, casoAte: 2, prazoDias: 7 });
    expect(ajustesDaNotaNovos({ casoAte: 3 }, { ativa: true, casoAte: 2, prazoDias: 30 })).toEqual({ ativa: true, casoAte: 3, prazoDias: 30 });
    for (const ruim of [1, 'sim', null]) expect(() => ajustesDaNotaNovos({ ativa: ruim }, padrao)).toThrow(BadRequestException);
    expect(() => ajustesDaNotaNovos({ casoAte: 4 }, padrao)).toThrow(/Nota que abre caso/);
    expect(() => ajustesDaNotaNovos({ prazoDias: '7' }, padrao)).toThrow(/Prazo para avaliar/);
    expect(() => ajustesDaNotaNovos({}, padrao)).toThrow(/Nada para salvar/);
  });

  it('o texto do caso e os itens em uma linha', () => {
    expect(mensagemDoCaso({ nota: 2, pesou: ['Temperatura', 'Tempo de entrega'], comentario: 'Chegou frio.' }, { origem: 'pagina', pedidoNumero: '2838' })).toBe(
      'Nota 2 de 5 (Ruim) pela página do pedido · pedido #2838.\nO que mais pesou: Temperatura, Tempo de entrega.\nComentário: "Chegou frio."',
    );
    expect(mensagemDoCaso({ nota: 1, pesou: [], comentario: null }, { origem: 'whatsapp', pedidoNumero: null })).toBe(
      'Nota 1 de 5 (Péssimo) pelo WhatsApp.\nSem comentário.',
    );
    expect(itensEmUmaLinha([{ nome: 'Smash duplo', quantidade: 1 }, { nome: 'Batata média', quantidade: 2 }, { nome: '' }, { name: 'Refri', qtd: 1.5 }])).toBe(
      '1× Smash duplo · 2× Batata média · 1,5× Refri',
    );
    expect(itensEmUmaLinha(null)).toBe('');
  });

  it('a situação do pedido para a nota: desligado › de fora › já avaliado › não entregue › encerrou (o prazo) › aberta', () => {
    const agora = new Date('2026-11-18T23:00:00Z');
    const entregue = new Date('2026-11-18T22:00:00Z');
    const base = { nota_ativa: true, nota_prazo_dias: 7, canal: 'cardapio', status: 'concluido', entregue_em: entregue, feita_nota: null };
    const s = (o: any, quando = agora) => NotaDoPedidoService.situacao({ ...base, ...o }, quando);
    expect(s({})).toBe('aberta');
    expect(s({ nota_ativa: false })).toBe('desligado');
    expect(s({ nota_ativa: null })).toBe('desligado');
    expect(s({ canal: 'anotaai' })).toBe('fora');
    expect(s({ canal: 'ifood', feita_nota: 5 })).toBe('fora');
    expect(s({ feita_nota: 4 })).toBe('avaliado');
    expect(s({ status: 'despachado' })).toBe('nao_entregue');
    expect(s({ entregue_em: null })).toBe('nao_entregue');
    expect(s({ status: 'entregue' })).toBe('aberta');
    expect(s({}, new Date(entregue.getTime() + 7 * 86_400_000))).toBe('aberta'); // o último instante do prazo
    expect(s({}, new Date(entregue.getTime() + 7 * 86_400_000 + 1000))).toBe('encerrada');
    expect(s({ nota_prazo_dias: 2 }, new Date(entregue.getTime() + 3 * 86_400_000))).toBe('encerrada');
    expect(NotaDoPedidoService.periodo('30')).toBe('30');
    expect(NotaDoPedidoService.periodo('hoje')).toBe('hoje');
    expect(NotaDoPedidoService.periodo('90')).toBe('7');
    expect(NotaDoPedidoService.periodo(undefined)).toBe('7');
  });

  it('o placar do Atendimento: a nota baixa do pedido do Regem conta como os casos do robô; a do iFood segue "Avaliações do iFood"', () => {
    const caso = (canal: string) => ({ tipo: 'avaliacao', canal, status: 'aberto' }) as any;
    expect(grupoDoPlacar(caso('cardapio'))).toBe('casos');
    expect(grupoDoPlacar(caso('ifood'))).toBe('avaliacao');
  });
});
