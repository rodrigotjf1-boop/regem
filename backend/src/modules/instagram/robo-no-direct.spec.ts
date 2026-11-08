import {
  CALADO_SEM_PRAZO_MS,
  chaveDaConta,
  chaveDoCliente,
  comOrigemDoDirect,
  idDaChave,
  MAX_BYTES_DO_TEXTO,
  partirTexto,
  quemRespondeNoDirect,
  textoParaORobo,
} from './instagram';
import {
  assinarConversa,
  assinarConversaDoDirect,
  ehChaveDoDirect,
  lerConversa,
  lerConversaDoDirect,
  VALIDADE_DA_CONVERSA_MS,
} from '../../common/conversa-do-robo';
import { instrucoesDoDirect, instrucoesDoRobo, VERSAO_DO_DIRECT } from '../cardapio/robo-instrucoes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ROBÔ NO DIRECT (mig 378; protótipo v8) — a regra pura: a chave `ig:`, a ficha do Direct (que não vale como a do
// telefone), quem responde a mensagem nova, as partes de 1.000 bytes, o link com a origem do Direct e as instruções.

const T = '11111111-2222-3333-4444-555555555555';
const IGSID = '99887766554433';

describe('a chave `ig:` do Direct', () => {
  it('monta e lê só dígitos', () => {
    expect(chaveDaConta('17841400000000001')).toBe('ig:17841400000000001');
    expect(chaveDoCliente(IGSID)).toBe(`ig:${IGSID}`);
    expect(idDaChave(`ig:${IGSID}`)).toBe(IGSID);
    expect(idDaChave(` IG:${IGSID} `)).toBe(IGSID);
    for (const ruim of ['ig:', 'ig:12', 'ig:abc123456', `tel:${IGSID}`, IGSID, null, 42]) expect(idDaChave(ruim)).toBeNull();
    expect(ehChaveDoDirect('ig:qualquer')).toBe(true);
    expect(ehChaveDoDirect('5521987654321')).toBe(false);
  });
});

describe('a ficha do Direct', () => {
  const antes = process.env.BOT_RESOLVER_SECRET;
  beforeEach(() => {
    process.env.BOT_RESOLVER_SECRET = 'senha-do-robo';
  });
  afterAll(() => {
    if (antes === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes;
  });

  it('assina e lê a empresa e o cliente; vence em 12 h', () => {
    const agora = Date.now();
    const f = assinarConversaDoDirect(T, IGSID, agora)!;
    expect(lerConversaDoDirect(f, agora)).toEqual({ tenantId: T, igsid: IGSID });
    expect(lerConversaDoDirect(f, agora + VALIDADE_DA_CONVERSA_MS + 1)).toBeNull();
  });

  it('a do Direct não vale como a do telefone, nem a do telefone como a do Direct', () => {
    expect(lerConversa(assinarConversaDoDirect(T, IGSID))).toBeNull();
    expect(lerConversaDoDirect(assinarConversa(T, '5521987654321'))).toBeNull();
  });

  it('mexida (outro cliente no corpo, outra senha) ou sem a senha do robô: não vale', () => {
    const f = assinarConversaDoDirect(T, IGSID)!;
    const [, assinatura] = f.split('.');
    const outro = Buffer.from(JSON.stringify({ t: T, g: '11112222333344', e: Date.now() + 60_000 })).toString('base64url');
    expect(lerConversaDoDirect(`${outro}.${assinatura}`)).toBeNull();
    process.env.BOT_RESOLVER_SECRET = 'outra-senha';
    expect(lerConversaDoDirect(f)).toBeNull();
    delete process.env.BOT_RESOLVER_SECRET;
    expect(assinarConversaDoDirect(T, IGSID)).toBeNull();
    expect(lerConversaDoDirect(f)).toBeNull();
  });

  it('não assina cliente que não é só dígitos', () => {
    expect(assinarConversaDoDirect(T, 'ig:123')).toBeNull();
    expect(assinarConversaDoDirect(T, '')).toBeNull();
  });
});

describe('quem responde a mensagem nova no Direct', () => {
  const agora = Date.parse('2026-11-07T20:00:00Z');
  const min = (n: number) => new Date(agora - n * 60_000);
  const base = { roboLigado: true, filaLigada: true, caso: null, ultimaDaLojaEm: null, minutos: 60, agora };

  it('robô desligado: como o #861 — caso aberto anexa; sem caso, abre se a fila estiver ligada', () => {
    expect(quemRespondeNoDirect({ ...base, roboLigado: false })).toEqual({ anexar: false, abrir: true, robo: false });
    expect(quemRespondeNoDirect({ ...base, roboLigado: false, filaLigada: false })).toEqual({ anexar: false, abrir: false, robo: false });
    expect(quemRespondeNoDirect({ ...base, roboLigado: false, caso: { criadoEm: min(1), responsavelId: null } })).toEqual({ anexar: true, abrir: false, robo: false });
  });

  it('robô ligado, sem caso: o robô responde (a fila ligada não abre caso)', () => {
    expect(quemRespondeNoDirect(base)).toEqual({ anexar: false, abrir: false, robo: true });
  });

  it('a loja respondeu pelo app do Instagram dentro da pausa: ninguém (nem robô, nem caso)', () => {
    expect(quemRespondeNoDirect({ ...base, ultimaDaLojaEm: min(10) })).toEqual({ anexar: false, abrir: false, robo: false });
    expect(quemRespondeNoDirect({ ...base, ultimaDaLojaEm: min(61) }).robo).toBe(true);
    // Pausa "sem prazo" (0): a resposta da loja cala por 12 h.
    expect(quemRespondeNoDirect({ ...base, minutos: 0, ultimaDaLojaEm: new Date(agora - CALADO_SEM_PRAZO_MS + 60_000) }).robo).toBe(false);
    expect(quemRespondeNoDirect({ ...base, minutos: 0, ultimaDaLojaEm: new Date(agora - CALADO_SEM_PRAZO_MS - 60_000) }).robo).toBe(true);
  });

  it('caso aberto: anexa; o robô só volta com o caso sem ninguém e mais velho que a pausa (0 = até resolver)', () => {
    expect(quemRespondeNoDirect({ ...base, caso: { criadoEm: min(5), responsavelId: null } })).toEqual({ anexar: true, abrir: false, robo: false });
    expect(quemRespondeNoDirect({ ...base, caso: { criadoEm: min(90), responsavelId: 'ana' } }).robo).toBe(false);
    expect(quemRespondeNoDirect({ ...base, caso: { criadoEm: min(90), responsavelId: null } })).toEqual({ anexar: true, abrir: false, robo: true });
    expect(quemRespondeNoDirect({ ...base, minutos: 0, caso: { criadoEm: min(900), responsavelId: null } }).robo).toBe(false);
  });

  // Mig 379: o RECADO que espera a abertura (fora do horário da equipe) não cala o robô.
  it('caso que é recado esperando a equipe: anexa e o robô responde — salvo a loja respondendo pelo app ou alguém com ele', () => {
    const recado = { criadoEm: min(-600), responsavelId: null, recado: true }; // `criadoEm` = a volta da equipe (no futuro)
    expect(quemRespondeNoDirect({ ...base, caso: recado })).toEqual({ anexar: true, abrir: false, robo: true });
    expect(quemRespondeNoDirect({ ...base, minutos: 0, caso: recado }).robo).toBe(true);
    expect(quemRespondeNoDirect({ ...base, caso: recado, ultimaDaLojaEm: min(5) }).robo).toBe(false);
    expect(quemRespondeNoDirect({ ...base, caso: { ...recado, responsavelId: 'ana' } }).robo).toBe(false);
    // robô desligado: o recado recebe a mensagem, como qualquer caso
    expect(quemRespondeNoDirect({ ...base, roboLigado: false, caso: recado })).toEqual({ anexar: true, abrir: false, robo: false });
    // depois da volta da equipe, um caso comum: a pausa conta da volta (criadoEm), não da criação
    expect(quemRespondeNoDirect({ ...base, caso: { criadoEm: min(10), responsavelId: null, recado: false } }).robo).toBe(false);
    expect(quemRespondeNoDirect({ ...base, caso: { criadoEm: min(61), responsavelId: null, recado: false } }).robo).toBe(true);
  });
});

describe('o texto do Direct', () => {
  it('o que o robô recebe quando não é texto (no Direct ele não ouve áudio)', () => {
    expect(textoParaORobo({ texto: 'oi', tipo: 'texto' })).toBe('oi');
    expect(textoParaORobo({ texto: null, tipo: 'audio' })).toContain('não ouve áudio');
    expect(textoParaORobo({ texto: null, tipo: 'imagem' })).toBe('(o cliente mandou [foto])');
  });

  it('até 3 partes de até 1.000 bytes, pelos parágrafos, sem cortar emoji; a sobra sai com reticências', () => {
    expect(partirTexto('  oi  ')).toEqual(['oi']);
    expect(partirTexto('')).toEqual([]);
    const par = 'Á'.repeat(400); // 800 bytes
    const p = partirTexto([par, par, par].join('\n\n'));
    expect(p).toEqual([par, par, par]);
    const emoji = '😀'.repeat(600); // 2.400 bytes numa palavra só
    const e = partirTexto(emoji);
    expect(e.length).toBe(3);
    for (const x of e) {
      expect(Buffer.byteLength(x, 'utf8')).toBeLessThanOrEqual(MAX_BYTES_DO_TEXTO);
      expect(x).not.toMatch(/�/);
    }
    expect(e.join('').replace(/…$/, '')).toBe(emoji.slice(0, e.join('').replace(/…$/, '').length));
    const muito = partirTexto(Array.from({ length: 10 }, () => par).join('\n\n'));
    expect(muito).toHaveLength(3);
    expect(muito[2].endsWith('…')).toBe(true);
    for (const x of muito) expect(Buffer.byteLength(x, 'utf8')).toBeLessThanOrEqual(MAX_BYTES_DO_TEXTO);
    // Junta de volta com o separador que estava (a linha fica linha).
    expect(partirTexto(`${'a'.repeat(600)}\n${'b'.repeat(300)}\n${'c'.repeat(300)}`)).toEqual([`${'a'.repeat(600)}\n${'b'.repeat(300)}`, 'c'.repeat(300)]);
  });

  it('o link da loja sai com a origem do Direct; o dos outros e o que já tem origem ficam', () => {
    const l = 'https://app.teste/c/tok1';
    expect(comOrigemDoDirect(`Veja: ${l}`, l)).toBe(`Veja: ${l}?utm_source=instagram&utm_medium=direct`);
    expect(comOrigemDoDirect(`Este: ${l}?produto=p9.`, l)).toBe(`Este: ${l}?produto=p9&utm_source=instagram&utm_medium=direct.`);
    expect(comOrigemDoDirect(`${l}?utm_source=meta`, l)).toBe(`${l}?utm_source=meta`);
    expect(comOrigemDoDirect(`${l}2 e ${l}`, l)).toBe(`${l}2 e ${l}?utm_source=instagram&utm_medium=direct`);
    expect(comOrigemDoDirect('https://outro.com/x', l)).toBe('https://outro.com/x');
  });
});

describe('as instruções do Direct', () => {
  const { texto, versao, canal, fluxo } = instrucoesDoDirect({ loja: 'Mister Burguer' }, '2');
  it('a versão, o canal e o fluxo', () => {
    expect(versao).toBe(VERSAO_DO_DIRECT);
    expect(canal).toBe('instagram');
    expect(fluxo).toBe(2);
    expect(texto).toContain('clientes da Mister Burguer no Direct do Instagram');
  });
  it('não sabe quem é o cliente: nunca pede telefone nem consulta pedido; manda o link do cardápio', () => {
    expect(texto).toContain('nunca o telefone');
    expect(texto).toMatch(/Nunca peça telefone/);
    expect(texto).toContain('linkCardapio');
    expect(texto).toMatch(/N[ÃA]O ouve áudio/);
  });
  it('as ferramentas de telefone só aparecem para dizer que NÃO funcionam no Direct', () => {
    for (const f of ['pedidos_do_cliente', 'link_personalizado', 'ver_pedido', 'mexer_no_pedido', 'registrar_pedido', 'definir_pagamento']) {
      const linhas = texto.split('\n').filter((l) => l.includes(f));
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toContain('NÃO funcionam no Direct');
    }
  });
  it('pedido que já foi feito, encomenda e alergia vão para a equipe com o resumo de três linhas', () => {
    expect(texto).toContain('cadê meu pedido');
    expect(texto).toContain('encomenda');
    expect(texto).toMatch(/Motivo: .*\n\s+Quer: .*\n\s+Já fiz:/);
  });
  it('.d2 (mig 379): fora do horário da equipe, manda paraOCliente como veio e segue respondendo', () => {
    expect(VERSAO_DO_DIRECT >= '2026-11-07.d2').toBe(true);
    expect(texto).toContain('Se a resposta de chamar_atendente trouxer foraDoHorario = true');
    expect(texto).toContain('mande ao cliente o texto de paraOCliente exatamente como veio');
    expect(texto).toContain('NÃO diga "em instantes"');
  });
  it('o WhatsApp continua com as suas instruções', () => {
    expect(instrucoesDoRobo({ loja: 'X' }, '2').texto).toContain('no WhatsApp');
    expect(instrucoesDoRobo({ loja: 'X' }, '2').texto).not.toContain('Direct');
  });
});
