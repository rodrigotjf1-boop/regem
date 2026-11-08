import { BadRequestException } from '@nestjs/common';
import { chaveDoTeste, ehChaveDeTeste, ehChaveDoDirect, idDaChaveDeTeste, lerConversa } from '../../common/conversa-do-robo';
import {
  AUDIO_NO_TESTE,
  ESPERA_DA_RESPOSTA_MS,
  NOME_NO_TESTE,
  esperandoResposta,
  lerNovoTeste,
  lerTextoDoCliente,
  linhaDaSimulacao,
  mensagemParaORobo,
  roboDisponivelParaTeste,
} from './teste-do-atendente';
import { proximaVoltaPura, situacaoPura } from './horario-da-equipe';
import type { Simulacao } from './abrir-chamado';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O TESTE DO ATENDENTE (F4, mig 382) — as partes puras: a chave `teste:<id>` (a única forma que vale; qualquer `teste:` é
// recusada pelas rotas de telefone), as escolhas da tela, a espera da resposta, a mensagem que vai ao robô (o formato das
// outras vias, sem a ficha) e a linha 'sistema' do "chamar atendente" simulado.

const ID = '3f0c9a52-7d1e-4b8a-9c61-2a4e5f6b7c8d';

describe('a chave da conversa de teste (common/conversa-do-robo)', () => {
  it('só `teste:` + uuid é uma conversa de teste; qualquer `teste:` é chave de teste (para recusar), nunca telefone', () => {
    expect(chaveDoTeste(ID)).toBe(`teste:${ID}`);
    expect(idDaChaveDeTeste(`teste:${ID}`)).toBe(ID);
    expect(idDaChaveDeTeste(`  TESTE:${ID.toUpperCase()}  `)).toBe(ID); // maiúsculas e espaço: o mesmo id (minúsculo)
    for (const torto of ['teste:', 'teste:abc', `teste:${ID}x`, `teste: ${ID}`, `teste:${ID.slice(0, 35)}`, 'teste:21999998888'])
      expect([torto, idDaChaveDeTeste(torto)]).toEqual([torto, null]);
    for (const qualquer of ['teste:', 'teste:abc', 'TESTE:21999998888', ` teste:${ID}`]) expect(ehChaveDeTeste(qualquer)).toBe(true);
    for (const nao of ['21999998888', `ig:${ID}`, `x-teste:${ID}`, 'testes', null, undefined, 42, {}]) {
      expect(ehChaveDeTeste(nao)).toBe(false);
      expect(idDaChaveDeTeste(nao)).toBeNull();
    }
    // as duas chaves "falsas" não se confundem
    expect(ehChaveDoDirect(`teste:${ID}`)).toBe(false);
    expect(ehChaveDeTeste(`ig:${ID}`)).toBe(false);
  });
});

describe('as escolhas do teste', () => {
  it('o teste novo: canal da lista; "simular fora do horário" só verdadeiro ou falso', () => {
    expect(lerNovoTeste({ canal: 'whatsapp' })).toEqual({ canal: 'whatsapp', foraDoHorario: false });
    expect(lerNovoTeste({ canal: 'direct', foraDoHorario: true })).toEqual({ canal: 'direct', foraDoHorario: true });
    expect(lerNovoTeste({ canal: 'direct', foraDoHorario: null })).toEqual({ canal: 'direct', foraDoHorario: false });
    for (const ruim of [{}, null, { canal: 'messenger' }, { canal: 'WHATSAPP' }, { canal: 'whatsapp', foraDoHorario: 'true' }, { canal: 'whatsapp', foraDoHorario: 1 }])
      expect(() => lerNovoTeste(ruim)).toThrow(BadRequestException);
  });

  it('o texto do "cliente": aparado, de 1 a 1000 letras', () => {
    expect(lerTextoDoCliente({ texto: '  qual a taxa pro centro?  ' })).toBe('qual a taxa pro centro?');
    expect(lerTextoDoCliente({ texto: 'a'.repeat(1000) })).toHaveLength(1000);
    for (const ruim of [{}, { texto: '' }, { texto: '   ' }, { texto: 12 }, { texto: 'a'.repeat(1001) }])
      expect(() => lerTextoDoCliente(ruim)).toThrow(BadRequestException);
  });

  it('esperando a resposta: a última fala é do "cliente" e tem menos de 90 s', () => {
    const agora = new Date('2026-11-08T15:00:00Z');
    const em = (ms: number) => new Date(agora.getTime() - ms).toISOString();
    expect(esperandoResposta([], agora)).toBe(false);
    expect(esperandoResposta([{ autor: 'cliente', criadoEm: em(1_000) }], agora)).toBe(true);
    expect(esperandoResposta([{ autor: 'cliente', criadoEm: em(ESPERA_DA_RESPOSTA_MS - 1) }], agora)).toBe(true);
    expect(esperandoResposta([{ autor: 'cliente', criadoEm: em(ESPERA_DA_RESPOSTA_MS) }], agora)).toBe(false);
    expect(esperandoResposta([{ autor: 'cliente', criadoEm: em(5_000) }, { autor: 'robo', criadoEm: em(1_000) }], agora)).toBe(false);
    expect(esperandoResposta([{ autor: 'cliente', criadoEm: em(5_000) }, { autor: 'sistema', criadoEm: em(1_000) }], agora)).toBe(false);
  });

  it('o robô só está disponível na nuvem, com o endereço do fluxo único e a senha do robô', () => {
    const antes = { u: process.env.N8N_ROBO_WEBHOOK_URL, s: process.env.BOT_RESOLVER_SECRET, e: process.env.EDGE_MODE };
    try {
      delete process.env.EDGE_MODE;
      process.env.N8N_ROBO_WEBHOOK_URL = 'https://n8n.exemplo/webhook/robo';
      process.env.BOT_RESOLVER_SECRET = 'senha';
      expect(roboDisponivelParaTeste()).toBe(true);
      process.env.N8N_ROBO_WEBHOOK_URL = '  ';
      expect(roboDisponivelParaTeste()).toBe(false);
      process.env.N8N_ROBO_WEBHOOK_URL = 'https://n8n.exemplo/webhook/robo';
      process.env.BOT_RESOLVER_SECRET = '';
      expect(roboDisponivelParaTeste()).toBe(false);
      process.env.BOT_RESOLVER_SECRET = 'senha';
      process.env.EDGE_MODE = 'true';
      expect(roboDisponivelParaTeste()).toBe(false);
    } finally {
      for (const [k, v] of [['N8N_ROBO_WEBHOOK_URL', antes.u], ['BOT_RESOLVER_SECRET', antes.s], ['EDGE_MODE', antes.e]] as const)
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
  });
});

describe('a mensagem que vai ao robô', () => {
  const cardapio = {
    id: 'c1',
    token: 'tok-1',
    ativo: true,
    aberto: true,
    nomePublico: 'Burger da Praça',
    unidadeId: null,
    site: null,
    instagram: null,
    roboSaudacao: 'Oi!',
    roboAusencia: 'Fechados',
    roboPrompt: 'Base da loja',
    roboMensagens: [{ gatilho: 'pix', resposta: 'Aceitamos Pix' }],
  };
  const teste = (canal: 'whatsapp' | 'direct') =>
    ({ id: ID, tenantId: 'empresa-1', usuarioId: null, canal, foraDoHorario: false, cardapioId: 'c1', criadoEm: '', cardapio }) as any;

  it('o formato das outras vias, com a chave `teste:` na instância e no `de`, sem phoneNumberId e SEM a ficha da conversa', () => {
    const agora = new Date('2026-11-08T15:00:00Z');
    const m = mensagemParaORobo(teste('whatsapp'), 'tem x-bacon?', 'msg-1', agora);
    expect(m).toEqual({
      provedor: 'evolution',
      tenantId: 'empresa-1',
      cardapioToken: 'tok-1',
      phoneNumberId: null,
      instancia: `teste:${ID}`,
      jid: null,
      loja: { nome: 'Burger da Praça', aberto: true },
      de: `teste:${ID}`,
      nome: NOME_NO_TESTE,
      tipo: 'text',
      texto: 'tem x-bacon?',
      mensagemId: 'msg-1',
      timestamp: Math.floor(agora.getTime() / 1000),
      midiaId: null,
      opcaoId: null,
      roboSaudacao: 'Oi!',
      roboAusencia: 'Fechados',
      roboPrompt: 'Base da loja',
      roboMensagens: [{ gatilho: 'pix', resposta: 'Aceitamos Pix' }],
      conversa: null,
    });
    // a ficha do telefone nunca nasce dos dígitos do id
    expect(lerConversa(m.conversa)).toBeNull();
    expect(mensagemParaORobo(teste('direct'), 'oi', 'msg-2', agora)).toMatchObject({ provedor: 'instagram', instancia: `teste:${ID}`, de: `teste:${ID}` });
  });

  it('loja: no WhatsApp `aberto` como a Evolution (!!), no Direct como o Direct (só false fecha)', () => {
    const t = (canal: 'whatsapp' | 'direct', aberto: boolean | null) => ({ ...teste(canal), cardapio: { ...cardapio, aberto } });
    expect(mensagemParaORobo(t('whatsapp', null), 'x', 'm').loja.aberto).toBe(false);
    expect(mensagemParaORobo(t('direct', null), 'x', 'm').loja.aberto).toBe(true);
    expect(mensagemParaORobo(t('direct', false), 'x', 'm').loja.aberto).toBe(false);
    expect(mensagemParaORobo({ ...teste('whatsapp'), cardapio: { ...cardapio, roboMensagens: null } }, 'x', 'm').roboMensagens).toEqual([]);
  });

  it('o texto do áudio que o teste não toca', () => expect(AUDIO_NO_TESTE).toBe('[o robô mandaria um áudio]'));
});

describe('a linha "sistema" do chamar atendente simulado', () => {
  const base = (x: Partial<Simulacao> & { resposta?: any }): Simulacao =>
    ({
      resultado: 'equipe',
      somou: false,
      tipoDoChamado: 'humano',
      situacao: null,
      caso: { id: 'caso-1', fila: 'equipe', assunto: null, prioridade: 'normal', recado: null, criadoEm: '2026-11-08T15:00:00.000Z' },
      resposta: { ok: true, id: 'caso-1', prioridade: 'normal', posicao: 2, comAlguem: false },
      ...x,
    }) as Simulacao;

  it('equipe: o tipo do chamado, a posição e "ninguém foi avisado"; o caso fica guardado para somar', () => {
    const l = linhaDaSimulacao(base({ tipoDoChamado: 'erro' }), null);
    expect(l.simulado).toMatchObject({ tipo: 'equipe', detalhe: 'erro', casoId: 'caso-1', fila: 'equipe', prioridade: 'normal' });
    expect(l.texto).toBe('Na conversa de verdade, o atendente chamaria a equipe — o cliente seria o 2º da fila. Ninguém foi avisado: é um teste.');
    const urgente = linhaDaSimulacao(
      base({ somou: true, caso: { id: 'c', fila: 'equipe', prioridade: 'urgente', criadoEm: 'x' }, resposta: { posicao: null } as any }),
      null,
    );
    expect(urgente.texto).toBe('Na conversa de verdade, o atendente somaria ao caso que já abriu com urgência. Ninguém foi avisado: é um teste.');
  });

  it('"simular fora do horário" sem horário cadastrado: a linha diz por que a equipe seria chamada (achado da tela real, 08/11)', () => {
    const semHorario = linhaDaSimulacao(base({ situacao: { modo: 'sempre', atendendo: false, voltaEm: null } as any }), null);
    expect(semHorario.simulado).toMatchObject({ tipo: 'equipe' });
    expect(semHorario.texto).toContain('o atendente chamaria a equipe — o cliente seria o 2º da fila.');
    expect(semHorario.texto).toContain('A loja não tem horário de funcionamento cadastrado (Delivery › Configurações › Horários)');
    // no horário (a equipe está) ou sem a situação: a frase não aparece
    expect(linhaDaSimulacao(base({ situacao: { modo: 'loja', atendendo: true, voltaEm: null } as any }), null).texto).not.toContain('não tem horário');
    expect(linhaDaSimulacao(base({}), null).texto).not.toContain('não tem horário');
  });

  it('recado da abertura (F1): quando a equipe volta; em "Sempre", o aviso de que só vale com "No horário da loja"', () => {
    const l = linhaDaSimulacao(base({ resultado: 'recado', resposta: { equipeVolta: 'amanhã às 17:30' } as any, situacao: { modo: 'loja' } as any }), null);
    expect(l.simulado).toMatchObject({ tipo: 'recado', detalhe: 'abertura' });
    expect(l.texto).toBe(
      'Na conversa de verdade, fora do horário da equipe, ficaria um recado para quando a equipe voltar (amanhã às 17:30) — ninguém seria chamado agora. Ninguém foi avisado: é um teste.',
    );
    const sempre = linhaDaSimulacao(base({ resultado: 'recado', resposta: { equipeVolta: 'hoje às 18:00' } as any, situacao: { modo: 'sempre' } as any }), null);
    expect(sempre.texto).toContain('Hoje a equipe atende "Sempre": isto só acontece com "No horário da loja".');
  });

  it('recado para o responsável (F3) e "não é por aqui" (F3)', () => {
    const r = linhaDaSimulacao(
      base({ resultado: 'responsavel', tipoDoChamado: 'vaga', caso: { id: 'c', fila: 'responsavel', assunto: 'vaga', prioridade: 'normal', criadoEm: 'x' } }),
      null,
    );
    expect(r.simulado).toMatchObject({ tipo: 'responsavel', detalhe: 'vaga', fila: 'responsavel', assunto: 'vaga' });
    expect(r.texto).toContain('deixaria um recado para o responsável (Vaga de emprego)');
    const n = linhaDaSimulacao(base({ tipoDoChamado: 'humano' }), 'fornecedor');
    expect(n.simulado).toMatchObject({ tipo: 'nao', detalhe: 'fornecedor', fila: 'equipe' });
    expect(n.texto).toBe(
      'A loja escolheu "Responde que não é por aqui" para Fornecedor: o atendente não devia ter chamado ninguém. Na conversa de verdade, o atendente chamaria a equipe — o cliente seria o 2º da fila. Ninguém foi avisado: é um teste.',
    );
  });
});

describe('"simular fora do horário": a próxima volta da equipe (horario-da-equipe)', () => {
  const ajuste = { antesMin: 30, depoisMin: 60 };
  // Sexta 06/11/2026 às 15:00 em São Paulo (18:00 UTC). As janelas valem todo dia: o dia da semana não importa aqui.
  const quinta15h = new Date('2026-11-06T18:00:00Z');
  const todoDia = (abre: string, fecha: string) => [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, ativo: true, abre, fecha }));

  it('dentro da janela de agora: a volta é a próxima janela (amanhã), não a de agora', () => {
    const j = todoDia('11:00', '23:00'); // equipe 10:30–00:00
    expect(situacaoPura(j, { atende: 'loja', ...ajuste }, quinta15h).atendendo).toBe(true);
    expect(proximaVoltaPura(j, ajuste, quinta15h)?.toISOString()).toBe('2026-11-07T13:30:00.000Z'); // no dia seguinte, 10:30 SP
  });

  it('fora da janela: a mesma volta da conta de verdade; sem janela: null', () => {
    const j = todoDia('18:00', '23:00'); // equipe 17:30–00:00
    const real = situacaoPura(j, { atende: 'loja', ...ajuste }, quinta15h);
    expect(real.atendendo).toBe(false);
    expect(proximaVoltaPura(j, ajuste, quinta15h)?.toISOString()).toBe(real.voltaEm?.toISOString());
    expect(proximaVoltaPura([], ajuste, quinta15h)).toBeNull();
    expect(proximaVoltaPura([{ dia: 1, ativo: false, abre: '10:00', fecha: '11:00' }], ajuste, quinta15h)).toBeNull();
  });
});
