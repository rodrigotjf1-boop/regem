import { createHash } from 'node:crypto';
import { idPausaDoCanal } from './id-deterministico';
import {
  ateDoCardapio,
  fraseDoMotivo,
  instanteNoFuso,
  lerMotivo,
  MOTIVOS_DA_PAUSA,
  pausaDaLinha,
  pausaVigenteDoCanal,
  rotuloDoMotivo,
  textoDaRecusa,
  voltaDaPausa,
} from './pausa-do-canal';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A pausa dos pedidos por canal (mig 392): as regras puras que o painel, o cardápio, o pedido e o atendente leem.
// Horários de teste no fuso da loja (America/Sao_Paulo, UTC−3): 21:10 de 10/11/2026 = 00:10Z de 11/11.
const AS_21_10 = new Date('2026-11-11T00:10:00Z');

describe('pausa por canal — motivos', () => {
  it('os motivos prontos casam com os códigos oficiais da 99 (a tabela do protótipo)', () => {
    expect(Object.fromEntries(Object.entries(MOTIVOS_DA_PAUSA).map(([m, v]) => [m, v.codigo99]))).toEqual({
      pedidos: 1005, entregador: 1002, ingrediente: 1003, cozinha: 1001, energia: 1001, fechando: 1004, outro: 1006,
    });
  });

  it('o motivo pronto passa; "outro" exige o texto de até 80 letras; desconhecido é recusado', () => {
    expect(lerMotivo('pedidos', 'ignorado')).toEqual({ ok: true, motivo: 'pedidos', motivoTexto: null });
    expect(lerMotivo('outro', '  estamos   trocando o gás ')).toEqual({ ok: true, motivo: 'outro', motivoTexto: 'estamos trocando o gás' });
    expect(lerMotivo('outro', '   ')).toEqual({ ok: false, erro: 'Escreva o motivo da pausa.' });
    expect(lerMotivo('outro', 'x'.repeat(81))).toEqual({ ok: false, erro: 'O motivo tem até 80 letras.' });
    expect(lerMotivo('outro', 'x'.repeat(80))).toMatchObject({ ok: true });
    expect(lerMotivo('feriado', null)).toEqual({ ok: false, erro: 'Escolha o motivo da pausa.' });
    expect(lerMotivo(undefined, null)).toMatchObject({ ok: false });
  });

  it('a frase do cliente: a pronta com o destaque, ou o texto escrito (com maiúscula e sem asterisco solto)', () => {
    expect(fraseDoMotivo('pedidos')).toBe('Estamos com *muitos pedidos agora*');
    expect(fraseDoMotivo('ingrediente')).toBe('*Acabou um ingrediente* e estamos repondo');
    expect(fraseDoMotivo('outro', 'estamos trocando o *gás*')).toBe('*Estamos trocando o gás*');
    expect(rotuloDoMotivo('outro', 'estamos trocando o gás')).toBe('Estamos trocando o gás');
    expect(rotuloDoMotivo('energia')).toBe('Sem energia ou internet');
  });
});

describe('pausa por canal — tempo do cardápio digital', () => {
  it('15, 30 e 60 min contam do agora; outro número é recusado', () => {
    expect(ateDoCardapio({ minutos: 30 }, AS_21_10)).toEqual({ ok: true, ate: new Date('2026-11-11T00:40:00Z') });
    expect(ateDoCardapio({ minutos: '15' }, AS_21_10)).toEqual({ ok: true, ate: new Date('2026-11-11T00:25:00Z') });
    expect(ateDoCardapio({ minutos: 45 }, AS_21_10)).toMatchObject({ ok: false });
    expect(ateDoCardapio({ minutos: 720 }, AS_21_10)).toMatchObject({ ok: false });
  });

  it('"até HH:MM" é a hora do relógio da LOJA, não a do servidor', () => {
    expect(instanteNoFuso('2026-11-10', '22:30')).toEqual(new Date('2026-11-11T01:30:00Z'));
    expect(ateDoCardapio({ ate: '22:30' }, AS_21_10)).toEqual({ ok: true, ate: new Date('2026-11-11T01:30:00Z') });
  });

  it('depois da meia-noite é amanhã; mais de 12 horas, ou a hora de agora, é recusado', () => {
    const as23_50 = new Date('2026-11-11T02:50:00Z');
    expect(ateDoCardapio({ ate: '00:30' }, as23_50)).toEqual({ ok: true, ate: new Date('2026-11-11T03:30:00Z') });
    expect(ateDoCardapio({ ate: '21:00' }, AS_21_10)).toEqual({ ok: false, erro: 'Escolha um horário nas próximas 12 horas.' });
    expect(ateDoCardapio({ ate: '21:10' }, AS_21_10)).toMatchObject({ ok: false });
    expect(ateDoCardapio({ ate: '25:00' }, AS_21_10)).toEqual({ ok: false, erro: 'Escolha por quanto tempo pausar.' });
    expect(ateDoCardapio({}, AS_21_10)).toMatchObject({ ok: false });
    expect(ateDoCardapio(null, AS_21_10)).toMatchObject({ ok: false });
  });

  it('a volta diz "amanhã" quando passa da meia-noite da loja', () => {
    expect(voltaDaPausa(new Date('2026-11-11T00:40:00Z'), AS_21_10)).toEqual({ hora: '21:40', amanha: false, texto: 'às 21:40' });
    expect(voltaDaPausa(new Date('2026-11-11T03:30:00Z'), AS_21_10)).toEqual({ hora: '00:30', amanha: true, texto: 'amanhã às 00:30' });
  });
});

describe('pausa por canal — a linha e a leitura', () => {
  const linha = { canal: 'cardapio', unidade_id: null, ate: '2026-11-11T00:40:00Z', motivo: 'pedidos', motivo_texto: null,
    pausado_em: '2026-11-11T00:10:00Z', pausado_por_nome: 'Rodrigo' };

  it('vale só com o fim no futuro', () => {
    expect(pausaDaLinha(linha, AS_21_10)).toMatchObject({
      canal: 'cardapio', rotulo: 'Muitos pedidos agora', frase: 'Estamos com *muitos pedidos agora*',
      volta: { hora: '21:40' }, pausadoPorNome: 'Rodrigo', ate: '2026-11-11T00:40:00.000Z',
    });
    expect(pausaDaLinha(linha, new Date('2026-11-11T00:40:00Z'))).toBeNull();
    expect(pausaDaLinha({ ...linha, ate: null }, AS_21_10)).toBeNull();
    expect(pausaDaLinha(undefined, AS_21_10)).toBeNull();
  });

  it('a recusa do pedido diz o motivo e a volta, sem o destaque do WhatsApp', () => {
    const p = pausaDaLinha(linha, AS_21_10)!;
    expect(textoDaRecusa(p)).toBe('Pedidos pausados agora: estamos com muitos pedidos agora. Voltamos às 21:40.');
  });

  it('banco sem a 392 (servidor da loja ainda sem a atualização): sem pausa; outro erro sobe', async () => {
    const semTabela = { execute: async () => { throw Object.assign(new Error('relation "pausa_canal" does not exist'), { code: '42P01' }); } };
    await expect(pausaVigenteDoCanal(semTabela, 't', null, 'cardapio')).resolves.toBeNull();
    const caiu = { execute: async () => { throw Object.assign(new Error('caiu'), { code: '57P01' }); } };
    await expect(pausaVigenteDoCanal(caiu, 't', null, 'cardapio')).rejects.toThrow('caiu');
  });

  it('o id da pausa é a conta do md5 da chave (a mesma dos dois lados do sync)', () => {
    const t = '11111111-1111-1111-1111-111111111111';
    const hex = createHash('md5').update(`pausa_canal${t}cardapio`).digest('hex');
    expect(idPausaDoCanal(t, null, 'cardapio')).toBe(`${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`);
    expect(idPausaDoCanal(t, null, 'cardapio')).not.toBe(idPausaDoCanal(t, null, 'ifood'));
    expect(idPausaDoCanal(t, '22222222-2222-2222-2222-222222222222', 'cardapio')).not.toBe(idPausaDoCanal(t, null, 'cardapio'));
  });
});
