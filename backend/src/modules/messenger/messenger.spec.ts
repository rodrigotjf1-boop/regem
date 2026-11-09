import { createHmac } from 'node:crypto';
import {
  ESCOPOS,
  MAX_LETRAS_DO_TEXTO,
  assinarEstado,
  assinaturaDoAvisoOk,
  comOrigemDoMessenger,
  frase,
  janela,
  lerAvisoDoMessenger,
  lerEstado,
  nomeDoCliente,
  nomeDoPerfil,
  paginasQueRespondem,
  partirTexto,
  permissoesConcedidas,
  textoDaResposta,
  textoParaORobo,
  urlDeAutorizacao,
} from './messenger';
import { assinarEstado as assinarEstadoDoInstagram } from '../instagram/instagram';
import {
  assinarConversa,
  assinarConversaDoDirect,
  assinarConversaDoMessenger,
  chaveDoMessenger,
  ehChaveDoDirect,
  ehChaveDoMessenger,
  idDaChaveDoMessenger,
  lerConversa,
  lerConversaDoDirect,
  lerConversaDoMessenger,
  VALIDADE_DA_CONVERSA_MS,
} from '../../common/conversa-do-robo';
import { instrucoesDoDirect, instrucoesDoMessenger, instrucoesDoRobo, VERSAO_DO_MESSENGER } from '../cardapio/robo-instrucoes';
import { blocoDasInstrucoes } from '../cardapio/assuntos-do-atendente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O MESSENGER DO FACEBOOK (mig 386) — a regra pura: o login (o endereço, o state), as páginas que respondem, o aviso da Meta
// (`object: 'page'`, ids no formato da Meta — ERR-409), a chave `fb:` e a ficha do Messenger (que não vale como a do telefone
// nem como a do Direct), a janela de 24 h, as partes de 2.000 caracteres, o link com a origem do Messenger e as instruções.

const T = '11111111-2222-3333-4444-555555555555';
const PAGINA = '104857600123456';
const PSID = '7712345678901234';
const SEGREDO = 'segredo-do-app-facebook';

describe('o login do Facebook', () => {
  it('o endereço: o diálogo do Facebook na versão, o app, o retorno, o state, `code` e só as três permissões', () => {
    const u = new URL(urlDeAutorizacao({ appId: '880011223344', redirect: 'https://api.exemplo/retorno', estado: 'abc.def', versao: 'v27.0' }));
    expect(`${u.origin}${u.pathname}`).toBe('https://www.facebook.com/v27.0/dialog/oauth');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: '880011223344',
      redirect_uri: 'https://api.exemplo/retorno',
      state: 'abc.def',
      response_type: 'code',
      scope: 'pages_show_list,pages_messaging,pages_manage_metadata',
    });
    expect(ESCOPOS).toEqual(['pages_show_list', 'pages_messaging', 'pages_manage_metadata']);
    // A base da distribuição (os testes apontam para um Facebook de mentira) sem barra sobrando.
    expect(urlDeAutorizacao({ appId: '1', redirect: 'r', estado: 'e', base: 'http://127.0.0.1:9/' }).startsWith('http://127.0.0.1:9/v27.0/dialog/oauth?')).toBe(true);
  });

  it('o app do tipo empresa (ERR-415): com a configuração do login vai `config_id` e NÃO vai `scope`; vazia = o clássico', () => {
    const u = new URL(urlDeAutorizacao({ appId: '880011223344', redirect: 'https://api.exemplo/retorno', estado: 'abc.def', configId: ' 1234567890123456 ' }));
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: '880011223344',
      redirect_uri: 'https://api.exemplo/retorno',
      state: 'abc.def',
      response_type: 'code',
      config_id: '1234567890123456',
      override_default_response_type: 'true',
    });
    for (const vazio of ['', '   ', undefined]) {
      const c = new URL(urlDeAutorizacao({ appId: '1', redirect: 'r', estado: 'e', configId: vazio }));
      expect(c.searchParams.get('scope')).toBe('pages_show_list,pages_messaging,pages_manage_metadata');
      expect(c.searchParams.has('config_id')).toBe(false);
      expect(c.searchParams.has('override_default_response_type')).toBe(false);
    }
  });

  it('o state: volta quem pediu; adulterado, de outro segredo, vencido ou o state do Instagram não vale', () => {
    const agora = Date.now();
    const s = assinarEstado(T, 'col-1', SEGREDO, agora);
    expect(lerEstado(s, SEGREDO, agora)).toMatchObject({ t: T, c: 'col-1' });
    expect(lerEstado(s, 'outro-segredo', agora)).toBeNull();
    expect(lerEstado(s, SEGREDO, agora + 16 * 60_000)).toBeNull(); // 15 min
    const [corpo, assinatura] = s.split('.');
    const outro = Buffer.from(JSON.stringify({ t: 'outra-empresa', c: 'col-1', e: agora + 60_000, n: 'x' })).toString('base64url');
    expect(lerEstado(`${outro}.${assinatura}`, SEGREDO, agora)).toBeNull();
    expect(lerEstado(`${corpo}.${assinatura}.x`, SEGREDO, agora)).toBeNull();
    expect(lerEstado(s, '', agora)).toBeNull();
    // O state do login do Instagram, MESMO com o mesmo segredo, não vale aqui (o rótulo do Messenger).
    expect(lerEstado(assinarEstadoDoInstagram(T, 'col-1', SEGREDO, agora), SEGREDO, agora)).toBeNull();
  });

  it('a assinatura do aviso: sha256 do corpo cru com o segredo do app', () => {
    const corpo = Buffer.from(JSON.stringify({ object: 'page', entry: [] }));
    const ok = `sha256=${createHmac('sha256', SEGREDO).update(corpo).digest('hex')}`;
    expect(assinaturaDoAvisoOk(corpo, ok, SEGREDO)).toBe(true);
    expect(assinaturaDoAvisoOk(corpo, ok, 'outro')).toBe(false);
    expect(assinaturaDoAvisoOk(Buffer.from('{}'), ok, SEGREDO)).toBe(false);
    expect(assinaturaDoAvisoOk(corpo, ok.replace('sha256=', 'sha1='), SEGREDO)).toBe(false);
    expect(assinaturaDoAvisoOk(corpo, undefined, SEGREDO)).toBe(false);
    expect(assinaturaDoAvisoOk(undefined, ok, SEGREDO)).toBe(false);
    expect(assinaturaDoAvisoOk(corpo, ok, '')).toBe(false);
  });

  it('as páginas: só as com o acesso e uma tarefa que responde (MESSAGING, MODERATE ou MANAGE); id da Meta; sem repetir', () => {
    expect(
      paginasQueRespondem([
        { id: PAGINA, name: ' Burger da Praça ', access_token: 'tok-p1', tasks: ['ANALYZE', 'ADVERTISE', 'MESSAGING'] },
        { id: '200000000000002', name: 'Só anúncios', access_token: 'tok-p2', tasks: ['ADVERTISE', 'ANALYZE'] },
        { id: '300000000000003', name: 'Sem acesso', tasks: ['MANAGE'] },
        { id: 'pagina-de-texto', name: 'Id torto', access_token: 'tok', tasks: ['MANAGE'] },
        { id: '400000000000004', access_token: 'tok-p4', tasks: ['moderate'] },
        { id: PAGINA, name: 'De novo', access_token: 'tok-p1b', tasks: ['MANAGE'] },
      ]),
    ).toEqual([
      { id: PAGINA, nome: 'Burger da Praça', token: 'tok-p1' },
      { id: '400000000000004', nome: 'Página', token: 'tok-p4' },
    ]);
    expect(paginasQueRespondem(null)).toEqual([]);
    expect(paginasQueRespondem({ data: [] })).toEqual([]);
  });

  it('as permissões concedidas (o me/permissions), numa linha; as recusadas ficam de fora', () => {
    expect(
      permissoesConcedidas([
        { permission: 'pages_show_list', status: 'granted' },
        { permission: 'pages_messaging', status: 'declined' },
        { permission: 'pages_manage_metadata', status: 'granted' },
      ]),
    ).toBe('pages_show_list,pages_manage_metadata');
    expect(permissoesConcedidas([])).toBeNull();
    expect(permissoesConcedidas(undefined)).toBeNull();
  });
});

describe('o aviso do Messenger (object: page)', () => {
  const aviso = (messaging: any[], extra: any = {}) => ({ object: 'page', entry: [{ id: PAGINA, time: 1_700_000_000_000, messaging, ...extra }] });
  const doCliente = (message: any, psid = PSID) => ({ sender: { id: psid }, recipient: { id: PAGINA }, timestamp: 1_700_000_001_000, message });

  it('a mensagem do cliente: texto, o mid, a hora; o PSID é quem mandou', () => {
    expect(lerAvisoDoMessenger(aviso([doCliente({ mid: 'm_1', text: 'Vocês entregam no Centro?' })]))).toEqual([
      {
        pagina: PAGINA,
        psid: PSID,
        mid: 'm_1',
        eco: false,
        appId: null,
        postback: false,
        tipo: 'texto',
        texto: 'Vocês entregam no Centro?',
        midiaUrl: null,
        em: new Date(1_700_000_001_000),
      },
    ]);
  });

  it('os anexos: o primeiro vira o tipo; a figurinha; a URL só https', () => {
    const [foto, audio, figurinha, outro, compartilhado] = lerAvisoDoMessenger(
      aviso([
        doCliente({ mid: 'm_f', attachments: [{ type: 'image', payload: { url: 'https://scontent.xx.fbcdn.net/x.jpg' } }] }),
        doCliente({ mid: 'm_a', attachments: [{ type: 'audio', payload: { url: 'http://inseguro/x.mp4' } }] }),
        doCliente({ mid: 'm_s', sticker_id: 369239263222822, attachments: [{ type: 'image', payload: { url: 'https://x/s.png' } }] }),
        doCliente({ mid: 'm_o', attachments: [{ type: 'algo_novo' }] }),
        doCliente({ mid: 'm_c', attachments: [{ type: 'fallback', payload: { url: 'https://l.facebook.com/x' } }] }),
      ]),
    );
    expect(foto).toMatchObject({ tipo: 'imagem', texto: null, midiaUrl: 'https://scontent.xx.fbcdn.net/x.jpg' });
    expect(audio).toMatchObject({ tipo: 'audio', midiaUrl: null });
    expect(figurinha).toMatchObject({ tipo: 'figurinha' });
    expect(outro).toMatchObject({ tipo: 'outro' });
    expect(compartilhado).toMatchObject({ tipo: 'compartilhamento' });
    expect(frase(foto)).toBe('[foto]');
    expect(frase({ texto: 'oi', tipo: 'texto' })).toBe('oi');
  });

  it('o eco: a página mandou — o PSID é o destinatário; traz o app que mandou (o nosso ou o do Facebook)', () => {
    const [nosso, daLoja] = lerAvisoDoMessenger(
      aviso([
        { sender: { id: PAGINA }, recipient: { id: PSID }, timestamp: 1, message: { mid: 'm_e1', is_echo: true, app_id: 880011223344, text: 'Oi!' } },
        { sender: { id: PAGINA }, recipient: { id: PSID }, timestamp: 2, message: { mid: 'm_e2', is_echo: true, text: 'Aqui é o Bruno' } },
      ]),
    );
    expect(nosso).toMatchObject({ eco: true, psid: PSID, appId: '880011223344', texto: 'Oi!' });
    expect(daLoja).toMatchObject({ eco: true, psid: PSID, appId: null });
  });

  it('o botão (postback): vira o texto do título; sem mid, a hora do toque faz as vezes (a reentrega não duplica)', () => {
    const [comMid, semMid] = lerAvisoDoMessenger(
      aviso([
        { sender: { id: PSID }, recipient: { id: PAGINA }, timestamp: 1_700_000_005_000, postback: { title: 'Começar', payload: 'GET_STARTED', mid: 'm_pb' } },
        { sender: { id: PSID }, recipient: { id: PAGINA }, timestamp: 1_700_000_006_000, postback: { payload: 'VER_CARDAPIO' } },
      ]),
    );
    expect(comMid).toMatchObject({ postback: true, tipo: 'texto', texto: 'Começar', mid: 'm_pb', eco: false });
    expect(semMid).toMatchObject({ postback: true, texto: 'VER_CARDAPIO', mid: `pb:${PSID}:1700000006000` });
  });

  it('fica de fora: lida, entregue, reação, outro objeto, id que não é da Meta (ERR-409), o cliente igual à página e o aviso torto', () => {
    expect(
      lerAvisoDoMessenger(
        aviso([
          { sender: { id: PSID }, recipient: { id: PAGINA }, timestamp: 1, read: { watermark: 1 } },
          { sender: { id: PSID }, recipient: { id: PAGINA }, timestamp: 1, delivery: { mids: ['m_1'] } },
          { sender: { id: PSID }, recipient: { id: PAGINA }, timestamp: 1, reaction: { mid: 'm_1', reaction: 'love' } },
          doCliente({ mid: 'm_x', text: 'oi' }, 'cliente-de-texto'),
          doCliente({ mid: 'm_y', text: 'oi' }, PAGINA),
          // a mensagem "do cliente" endereçada a OUTRA página e o eco que não vem da página
          { sender: { id: PSID }, recipient: { id: '999999999999999' }, timestamp: 1, message: { mid: 'm_z', text: 'oi' } },
          { sender: { id: '888888888888888' }, recipient: { id: PSID }, timestamp: 1, message: { mid: 'm_w', is_echo: true, text: 'oi' } },
          { sender: { id: PSID }, recipient: { id: PAGINA }, timestamp: 1, postback: { title: '  ', payload: '' } },
        ]),
      ),
    ).toEqual([]);
    expect(lerAvisoDoMessenger({ object: 'instagram', entry: [{ id: PAGINA, messaging: [doCliente({ mid: 'm', text: 'oi' })] }] })).toEqual([]);
    expect(lerAvisoDoMessenger({ object: 'page', entry: [{ id: 'pagina', messaging: [doCliente({ mid: 'm', text: 'oi' })] }] })).toEqual([]);
    expect(lerAvisoDoMessenger(null)).toEqual([]);
  });

  it('várias páginas e várias mensagens num aviso: cada uma sai sozinha', () => {
    const r = lerAvisoDoMessenger({
      object: 'page',
      entry: [
        { id: PAGINA, messaging: [doCliente({ mid: 'a', text: '1' }), doCliente({ mid: 'b', text: '2' })] },
        { id: '500000000000005', messaging: [{ sender: { id: PSID }, recipient: { id: '500000000000005' }, timestamp: 1, message: { mid: 'c', text: '3' } }] },
      ],
    });
    expect(r.map((e) => [e.pagina, e.mid])).toEqual([
      [PAGINA, 'a'],
      [PAGINA, 'b'],
      ['500000000000005', 'c'],
    ]);
  });
});

describe('a chave `fb:` e a ficha do Messenger', () => {
  const antes = process.env.BOT_RESOLVER_SECRET;
  beforeEach(() => {
    process.env.BOT_RESOLVER_SECRET = 'senha-do-robo';
  });
  afterAll(() => {
    if (antes === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes;
  });

  it('monta e lê só dígitos; qualquer `fb:` conta para as recusas', () => {
    expect(chaveDoMessenger(PAGINA)).toBe(`fb:${PAGINA}`);
    expect(idDaChaveDoMessenger(`fb:${PSID}`)).toBe(PSID);
    expect(idDaChaveDoMessenger(` FB:${PSID} `)).toBe(PSID);
    for (const ruim of ['fb:', 'fb:12', 'fb:abc12345678', `ig:${PSID}`, PSID, null, 42]) expect(idDaChaveDoMessenger(ruim)).toBeNull();
    expect(ehChaveDoMessenger('fb:qualquer')).toBe(true);
    expect(ehChaveDoMessenger('5521987654321')).toBe(false);
    expect(ehChaveDoDirect(`fb:${PSID}`)).toBe(false);
    expect(ehChaveDoMessenger(`ig:${PSID}`)).toBe(false);
  });

  it('a ficha: assina e lê a empresa e o cliente; vence em 12 h', () => {
    const agora = Date.now();
    const f = assinarConversaDoMessenger(T, PSID, agora)!;
    expect(lerConversaDoMessenger(f, agora)).toEqual({ tenantId: T, psid: PSID });
    expect(lerConversaDoMessenger(f, agora + VALIDADE_DA_CONVERSA_MS + 1)).toBeNull();
  });

  it('a do Messenger não vale como a do telefone nem como a do Direct — e nenhuma das duas vale como a do Messenger', () => {
    const f = assinarConversaDoMessenger(T, PSID)!;
    expect(lerConversa(f)).toBeNull();
    expect(lerConversaDoDirect(f)).toBeNull();
    expect(lerConversaDoMessenger(assinarConversa(T, '5521987654321'))).toBeNull();
    expect(lerConversaDoMessenger(assinarConversaDoDirect(T, PSID))).toBeNull();
  });

  it('mexida (outro cliente no corpo, outra senha) ou sem a senha do robô: não vale; não assina cliente torto', () => {
    const f = assinarConversaDoMessenger(T, PSID)!;
    const [, assinatura] = f.split('.');
    const outro = Buffer.from(JSON.stringify({ t: T, p: '11112222333344', e: Date.now() + 60_000 })).toString('base64url');
    expect(lerConversaDoMessenger(`${outro}.${assinatura}`)).toBeNull();
    process.env.BOT_RESOLVER_SECRET = 'outra-senha';
    expect(lerConversaDoMessenger(f)).toBeNull();
    delete process.env.BOT_RESOLVER_SECRET;
    expect(assinarConversaDoMessenger(T, PSID)).toBeNull();
    process.env.BOT_RESOLVER_SECRET = 'senha-do-robo';
    expect(assinarConversaDoMessenger(T, 'fb:123')).toBeNull();
    expect(assinarConversaDoMessenger(T, '')).toBeNull();
  });
});

describe('responder no Messenger', () => {
  it('a janela: aberta até 24 h depois da última mensagem do cliente; sem mensagem, fechada', () => {
    const agora = Date.parse('2026-11-09T20:00:00Z');
    expect(janela(new Date(agora - 23 * 3_600_000), agora).aberta).toBe(true);
    expect(janela(new Date(agora - 25 * 3_600_000), agora).aberta).toBe(false);
    expect(janela(null, agora)).toEqual({ aberta: false, ate: null });
    expect(janela('2026-11-09T10:00:00Z', agora).ate).toBe('2026-11-10T10:00:00.000Z');
  });

  it('o texto da equipe: aparado, não vazio, até 2.000 caracteres (o emoji conta como um)', () => {
    expect(textoDaResposta('  Entregamos sim!  ')).toEqual({ ok: true, texto: 'Entregamos sim!' });
    expect(textoDaResposta('   ')).toEqual({ ok: false, erro: 'Escreva a mensagem.' });
    expect(textoDaResposta(42)).toEqual({ ok: false, erro: 'Escreva a mensagem.' });
    expect(textoDaResposta('😀'.repeat(MAX_LETRAS_DO_TEXTO)).ok).toBe(true);
    expect(textoDaResposta('a'.repeat(MAX_LETRAS_DO_TEXTO + 1))).toEqual({ ok: false, erro: 'Mensagem longa demais para o Messenger (até 2.000 caracteres).' });
  });

  it('o nome: o do perfil (nome e sobrenome), senão "Cliente do Messenger"', () => {
    expect(nomeDoPerfil({ first_name: ' Joana ', last_name: 'Souza' })).toBe('Joana Souza');
    expect(nomeDoPerfil({ first_name: 'Joana' })).toBe('Joana');
    expect(nomeDoPerfil({})).toBeNull();
    expect(nomeDoCliente({ nome: 'Joana Souza' })).toBe('Joana Souza');
    expect(nomeDoCliente(null)).toBe('Cliente do Messenger');
  });

  it('o que o robô recebe quando não é texto (no Messenger ele não ouve áudio)', () => {
    expect(textoParaORobo({ texto: 'oi', tipo: 'texto' })).toBe('oi');
    expect(textoParaORobo({ texto: null, tipo: 'audio' })).toBe('(o cliente mandou um áudio pelo Messenger; aqui você não ouve áudio)');
    expect(textoParaORobo({ texto: null, tipo: 'imagem' })).toBe('(o cliente mandou [foto])');
  });

  it('até 3 mensagens de até 2.000 caracteres, pelos parágrafos, sem cortar emoji; a sobra sai com reticências', () => {
    expect(partirTexto('  oi  ')).toEqual(['oi']);
    expect(partirTexto('')).toEqual([]);
    const par = 'Á'.repeat(1500);
    expect(partirTexto([par, par].join('\n\n'))).toEqual([par, par]);
    const emoji = '😀'.repeat(6500); // 6.500 letras numa palavra só: 3 partes, a última com "…"
    const e = partirTexto(emoji);
    expect(e).toHaveLength(3);
    for (const x of e) {
      expect(Array.from(x).length).toBeLessThanOrEqual(MAX_LETRAS_DO_TEXTO);
      expect(x).not.toMatch(/�/);
    }
    expect(e[2].endsWith('…')).toBe(true);
    const muito = partirTexto(Array.from({ length: 6 }, () => par).join('\n\n'));
    expect(muito).toHaveLength(3);
    expect(muito[2].endsWith('…')).toBe(true);
    // Junta de volta com o separador que estava.
    expect(partirTexto(`${'a'.repeat(1200)}\n${'b'.repeat(700)}\n${'c'.repeat(700)}`)).toEqual([`${'a'.repeat(1200)}\n${'b'.repeat(700)}`, 'c'.repeat(700)]);
  });

  it('o link da loja sai com a origem do Messenger; o dos outros e o que já tem origem ficam', () => {
    const l = 'https://app.teste/c/tok1';
    expect(comOrigemDoMessenger(`Veja: ${l}`, l)).toBe(`Veja: ${l}?utm_source=facebook&utm_medium=messenger`);
    expect(comOrigemDoMessenger(`Este: ${l}?produto=p9.`, l)).toBe(`Este: ${l}?produto=p9&utm_source=facebook&utm_medium=messenger.`);
    expect(comOrigemDoMessenger(`${l}?utm_source=meta`, l)).toBe(`${l}?utm_source=meta`);
    expect(comOrigemDoMessenger(`${l}2 e ${l}`, l)).toBe(`${l}2 e ${l}?utm_source=facebook&utm_medium=messenger`);
    expect(comOrigemDoMessenger('https://outro.com/x', l)).toBe('https://outro.com/x');
  });
});

describe('as instruções do Messenger', () => {
  const { texto, versao, canal, fluxo } = instrucoesDoMessenger({ loja: 'Mister Burguer' }, '2');
  it('a versão, o canal e o fluxo', () => {
    expect(versao).toBe(VERSAO_DO_MESSENGER);
    expect(VERSAO_DO_MESSENGER).toBe('2026-11-09.fb1');
    expect(canal).toBe('messenger');
    expect(fluxo).toBe(2);
    expect(instrucoesDoMessenger({}, '1').fluxo).toBe(1);
    expect(texto.startsWith('Você atende os clientes da Mister Burguer no Messenger do Facebook.')).toBe(true);
  });
  it('não fala de Instagram nem de Direct; não sabe quem é o cliente; manda o link do cardápio', () => {
    expect(texto).not.toMatch(/Direct|Instagram/);
    expect(texto).toContain('NO MESSENGER VOCÊ NÃO SABE QUEM É O CLIENTE');
    expect(texto).toContain('nunca o telefone');
    expect(texto).toMatch(/Nunca peça telefone/);
    expect(texto).toContain('linkCardapio');
    expect(texto).toMatch(/N[ÃA]O ouve áudio/);
    expect(texto).toContain('responde aqui no Messenger em instantes');
  });
  it('as ferramentas de telefone só aparecem para dizer que NÃO funcionam no Messenger', () => {
    for (const f of ['pedidos_do_cliente', 'link_personalizado', 'ver_pedido', 'mexer_no_pedido', 'registrar_pedido', 'definir_pagamento']) {
      const linhas = texto.split('\n').filter((l) => l.includes(f));
      expect(linhas).toHaveLength(1);
      expect(linhas[0]).toContain('NÃO funcionam no Messenger');
    }
  });
  it('fora do horário da equipe, o perfil, os assuntos (perguntando o contato) e o que a loja ensinou entram como no Direct', () => {
    expect(texto).toContain('Se a resposta de chamar_atendente trouxer foraDoHorario = true');
    expect(texto).toMatch(/Motivo: .*\n\s+Quer: .*\n\s+Já fiz:/);
    const assuntos = blocoDasInstrucoes({ fornecedor: { modo: 'recado' } }, 'messenger');
    expect(assuntos).toContain('se ela preferir, pode ser por aqui no Messenger');
    expect(assuntos).toContain('Contato: o contato que a pessoa deu (ou "por aqui no Messenger")');
    const com = instrucoesDoMessenger({ loja: 'X', jeito: 'PERFIL DE ATENDIMENTO (escolhido pela loja): OBJETIVO.', assuntos, conhecimento: 'O QUE A LOJA ENSINOU\n- x' }, '1').texto;
    expect(com.startsWith('Você atende os clientes da X no Messenger do Facebook. Converse como uma pessoa da equipe.\n\nPERFIL DE ATENDIMENTO')).toBe(true);
    expect(com).toContain('ASSUNTOS QUE NÃO SÃO PEDIDO');
    expect(com).toContain('O QUE A LOJA ENSINOU');
  });
  it('o WhatsApp e o Direct continuam com as suas instruções', () => {
    expect(instrucoesDoRobo({ loja: 'X' }, '2').texto).not.toContain('Messenger');
    expect(instrucoesDoDirect({ loja: 'X' }, '2').texto).not.toContain('Messenger');
    expect(instrucoesDoDirect({ loja: 'X' }, '2').texto).toContain('no Direct do Instagram');
  });
});
