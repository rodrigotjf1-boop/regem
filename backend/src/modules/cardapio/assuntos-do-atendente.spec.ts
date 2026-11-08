import { BadRequestException } from '@nestjs/common';
import {
  ASSUNTOS_DO_ATENDENTE,
  MODOS_DO_ASSUNTO,
  TEXTO_DO_ASSUNTO_MAX,
  TEXTO_PADRAO_DO_RECADO,
  TEXTO_PADRAO_NAO,
  TITULO_DOS_ASSUNTOS,
  assuntoEmRecado,
  assuntosDaEmpresa,
  assuntosDaLinha,
  assuntosPadrao,
  blocoDasInstrucoes,
  lerAssuntosDoAtendente,
  lerResponsavel,
  responsavelNaEspera,
  respostaParaOResponsavel,
  resumoComORecado,
  resumoDoRecado,
  textoDoAssunto,
} from './assuntos-do-atendente';
import { situacaoDo, posicoes } from '../atendimento/fila';
import { decidirPausa } from '../whatsapp/robo-pausa';
import { quemRespondeNoDirect } from '../instagram/instagram';
import { contaComoReclamacao, grupoDoPlacar, oQueAconteceuNoCaso } from '../atendimento/numeros';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS ASSUNTOS QUE NÃO SÃO PEDIDO (F3, mig 381 — protótipo `mockups/regem-central-atendimento.html` v12): as escolhas, a
// conferência do que a tela manda, a leitura tolerante do banco, os textos, a seção das instruções do robô e as regras
// puras do RECADO PARA O RESPONSÁVEL (situação da fila, a pausa do robô no WhatsApp e no Direct, os Números).
describe('assuntos do atendente — as escolhas e os textos', () => {
  it('os três assuntos e os três modos, na ordem da tela; nasce tudo em "Como hoje"', () => {
    expect(ASSUNTOS_DO_ATENDENTE).toEqual(['fornecedor', 'vaga', 'parceria']);
    expect(MODOS_DO_ASSUNTO).toEqual(['hoje', 'recado', 'nao']);
    expect(TEXTO_DO_ASSUNTO_MAX).toBe(300);
    expect(assuntosPadrao()).toEqual({
      fornecedor: { modo: 'hoje', texto: null },
      vaga: { modo: 'hoje', texto: null },
      parceria: { modo: 'hoje', texto: null },
    });
  });

  it('os textos padrão EXATOS combinados (o robô manda ao cliente)', () => {
    expect(TEXTO_PADRAO_DO_RECADO).toEqual({
      fornecedor: 'Obrigado pelo contato! Já passei a sua proposta ao responsável. Se houver interesse, ele fala com você por aqui.',
      vaga: 'Que bom que você quer trabalhar com a gente! Deixei o seu contato com o responsável. Quando abrir uma vaga, ele fala com você.',
      parceria: 'Obrigado pelo interesse! Já passei ao responsável, que responde por aqui.',
    });
    expect(TEXTO_PADRAO_NAO).toBe('Obrigado pelo contato! Esse assunto não é tratado por aqui.');
  });

  it('textoDoAssunto: recado → o da loja ou o padrão do assunto; "não é por aqui" → o da loja ou o padrão; "Como hoje" → null', () => {
    const a = { fornecedor: { modo: 'recado' }, vaga: { modo: 'nao' }, parceria: { modo: 'recado', texto: 'Mande o mídia kit para imprensa@loja.com' } };
    expect(textoDoAssunto(a, 'fornecedor')).toBe(TEXTO_PADRAO_DO_RECADO.fornecedor);
    expect(textoDoAssunto(a, 'vaga')).toBe(TEXTO_PADRAO_NAO);
    expect(textoDoAssunto(a, 'parceria')).toBe('Mande o mídia kit para imprensa@loja.com');
    expect(textoDoAssunto({ vaga: { modo: 'nao', texto: 'Currículos: rh@loja.com' } }, 'vaga')).toBe('Currículos: rh@loja.com');
    expect(textoDoAssunto(assuntosPadrao(), 'vaga')).toBeNull();
    expect(textoDoAssunto(null, 'fornecedor')).toBeNull();
  });

  it('assuntoEmRecado: só o tipo que é um assunto E está em "recado"', () => {
    const a = { fornecedor: { modo: 'recado' }, vaga: { modo: 'nao' }, parceria: { modo: 'hoje' } };
    expect(assuntoEmRecado(a, 'fornecedor')).toBe('fornecedor');
    expect(assuntoEmRecado(a, 'vaga')).toBeNull(); // "não é por aqui": o robô nem chama
    expect(assuntoEmRecado(a, 'parceria')).toBeNull(); // "Como hoje": o caso comum
    expect(assuntoEmRecado(a, 'humano')).toBeNull();
    expect(assuntoEmRecado(a, undefined)).toBeNull();
    expect(assuntoEmRecado(a, 'FORNECEDOR')).toBeNull();
  });
});

describe('assuntos do atendente — a conferência do que a tela manda (PUT parcial, V16)', () => {
  it('parcial: só o que veio; texto vazio = o padrão (null); quebra de linha = uma linha', () => {
    expect(lerAssuntosDoAtendente(undefined)).toEqual({});
    expect(lerAssuntosDoAtendente(null)).toEqual({});
    expect(lerAssuntosDoAtendente({ vaga: { modo: 'recado' } })).toEqual({ vaga: { modo: 'recado' } });
    expect(lerAssuntosDoAtendente({ fornecedor: { texto: '  Mande o\ncatálogo   por aqui ' } })).toEqual({ fornecedor: { texto: 'Mande o catálogo por aqui' } });
    expect(lerAssuntosDoAtendente({ parceria: { texto: '   ' } })).toEqual({ parceria: { texto: null } });
    expect(lerAssuntosDoAtendente({ parceria: { texto: null, modo: 'nao' } })).toEqual({ parceria: { texto: null, modo: 'nao' } });
    expect(lerAssuntosDoAtendente({ vaga: undefined })).toEqual({});
    expect(lerAssuntosDoAtendente({ vaga: { texto: 'a'.repeat(300) } })).toEqual({ vaga: { texto: 'a'.repeat(300) } });
  });

  it('recusas (400) em pt-BR, com o nome do assunto', () => {
    const erro = (dto: unknown) => {
      try {
        lerAssuntosDoAtendente(dto);
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        return (e as Error).message;
      }
      return null;
    };
    expect(erro({ fornecedor: { modo: 'talvez' } })).toBe(
      'Fornecedor: escolha "Como hoje", "Deixa recado para o responsável" ou "Responde que não é por aqui".',
    );
    expect(erro({ vaga: { modo: 1 } })).toBe('Vaga de emprego: escolha "Como hoje", "Deixa recado para o responsável" ou "Responde que não é por aqui".');
    expect(erro({ vaga: { texto: 'a'.repeat(301) } })).toBe('Vaga de emprego: no máximo 300 letras.');
    expect(erro({ parceria: { texto: 12 } })).toBe('Parceria: escreva o que o robô diz (ou deixe vazio para usar o padrão).');
    expect(erro({ parceria: 'recado' })).toBe('Parceria: mande o que o robô faz e o que ele diz.');
    expect(erro({ imprensa: { modo: 'recado' } })).toBe(
      'Assuntos que não são pedido: o assunto "imprensa" não existe (só fornecedor, vaga de emprego e parceria).',
    );
    expect(erro(['fornecedor'])).toBe('Assuntos que não são pedido: mande o que o robô faz em cada assunto.');
    expect(erro('recado')).toBe('Assuntos que não são pedido: mande o que o robô faz em cada assunto.');
  });
});

describe('assuntos do atendente — a leitura do banco (tolerante)', () => {
  it('sempre os três, com os padrões no que faltar; lixo → o padrão daquele campo', () => {
    expect(assuntosDaLinha(null)).toEqual(assuntosPadrao());
    expect(assuntosDaLinha(undefined)).toEqual(assuntosPadrao());
    expect(assuntosDaLinha('não é json')).toEqual(assuntosPadrao());
    expect(assuntosDaLinha([])).toEqual(assuntosPadrao());
    expect(
      assuntosDaLinha({ fornecedor: { modo: 'recado', texto: '  oi\n  tudo ' }, vaga: 'nao', parceria: { modo: 'bravo', texto: 3 }, outro: { modo: 'recado' } }),
    ).toEqual({ fornecedor: { modo: 'recado', texto: 'oi tudo' }, vaga: { modo: 'hoje', texto: null }, parceria: { modo: 'hoje', texto: null } });
    // o texto JSON da coluna também vale
    expect(assuntosDaLinha(JSON.stringify({ vaga: { modo: 'nao' } })).vaga).toEqual({ modo: 'nao', texto: null });
    // texto longo do banco: cortado em 300, sem quebrar um emoji ao meio
    const longo = `${'a'.repeat(299)}😀fim`;
    const lido = assuntosDaLinha({ vaga: { texto: longo } }).vaga.texto as string;
    expect(lido).toBe('a'.repeat(299));
  });

  it('no servidor da loja: os padrões, sem ler o banco (V1)', async () => {
    const antes = process.env.EDGE_MODE;
    process.env.EDGE_MODE = 'true';
    try {
      expect(await assuntosDaEmpresa({ execute: () => Promise.reject(new Error('não deveria ler')) }, 'x')).toEqual(assuntosPadrao());
    } finally {
      if (antes === undefined) delete process.env.EDGE_MODE;
      else process.env.EDGE_MODE = antes;
    }
  });
});

describe('assuntos do atendente — a seção das instruções do robô', () => {
  it('tudo em "Como hoje" → vazio (as instruções ficam as de hoje)', () => {
    expect(blocoDasInstrucoes(assuntosPadrao(), 'whatsapp')).toBe('');
    expect(blocoDasInstrucoes(null, 'direct')).toBe('');
    expect(blocoDasInstrucoes({ fornecedor: { modo: 'hoje', texto: 'qualquer coisa' } }, 'whatsapp')).toBe('');
  });

  it('com recado: reconhecer, perguntar o mínimo uma por vez, nunca prometer, o tipo e o resumo em 4 linhas, e o paraOCliente', () => {
    const t = blocoDasInstrucoes({ fornecedor: { modo: 'recado' }, vaga: { modo: 'recado' } }, 'whatsapp');
    expect(t.startsWith(`${TITULO_DOS_ASSUNTOS}\n`)).toBe(true);
    expect(t).toContain('FORNECEDOR OU PROPOSTA COMERCIAL');
    expect(t).toContain('VAGA DE EMPREGO');
    expect(t).not.toContain('PARCERIA'); // "Como hoje" não é citado
    expect(t).toContain('deixe um RECADO PARA O RESPONSÁVEL (tipo = fornecedor;');
    expect(t).toContain('deixe um RECADO PARA O RESPONSÁVEL (tipo = vaga;');
    expect(t).toContain('UMA pergunta por vez');
    expect(t).toContain('a empresa (fornecedor ou parceria) ou a função que ela quer (vaga)');
    expect(t).toContain('Nunca prometa vaga, entrevista, compra, parceria, prazo nem resposta.');
    expect(t).toContain('use chamar_atendente com tipo = o do assunto (fornecedor, vaga)');
    for (const r of ['Assunto:', 'Quem:', 'Contato:', 'Já fiz:']) expect(t).toContain(`     ${r}`);
    expect(t).toContain('paraOResponsavel = true e paraOCliente');
    expect(t).toContain('exatamente como veio. NÃO diga "em instantes", não diga posição na fila');
    expect(t).toContain('continue a conversa normalmente (você segue respondendo)');
    expect(t).toContain('Não use urgente');
    expect(t).toContain('no lugar da regra 7 de REGRAS QUE NUNCA MUDAM');
    // no WhatsApp o contato é o número da conversa: não pede telefone
    expect(t).toContain('não peça telefone: o contato é este número do WhatsApp');
    expect(t).toContain('Contato: este WhatsApp');
    expect(t).not.toContain('Direct');
  });

  it('no Direct: o robô PERGUNTA o melhor contato', () => {
    const t = blocoDasInstrucoes({ parceria: { modo: 'recado' } }, 'direct');
    expect(t).toContain('e o melhor contato para o responsável falar com ela (telefone ou e-mail');
    expect(t).toContain('Contato: o contato que a pessoa deu (ou "por aqui no Direct")');
    expect(t).not.toContain('não peça telefone');
    expect(t).toContain('(tipo = parceria;');
  });

  it('"não é por aqui": responde com o texto (o da loja ou o padrão) e não chama ninguém — sem o passo a passo do recado', () => {
    const t = blocoDasInstrucoes({ vaga: { modo: 'nao', texto: 'Currículos só pelo e-mail rh@loja.com.' }, parceria: { modo: 'nao' } }, 'whatsapp');
    expect(t).toContain('VAGA DE EMPREGO (quer trabalhar na loja, pergunta se estão contratando ou quer mandar currículo): não é tratado por aqui.');
    expect(t).toContain('exatamente: "Currículos só pelo e-mail rh@loja.com."');
    expect(t).toContain(`exatamente: "${TEXTO_PADRAO_NAO}"`);
    expect(t).toContain('Não chame ninguém (não use chamar_atendente)');
    expect(t).not.toContain('RECADO PARA O RESPONSÁVEL');
    expect(t).not.toContain('FORNECEDOR');
  });
});

describe('assuntos do atendente — o recado para o responsável (regras puras)', () => {
  const marca = { responsavel: { assunto: 'vaga', em: '2026-11-07T18:00:00.000Z' } };

  it('lerResponsavel: só com assunto conhecido e data válida', () => {
    expect(lerResponsavel(marca)).toEqual({ assunto: 'vaga', em: '2026-11-07T18:00:00.000Z' });
    expect(lerResponsavel({ responsavel: { assunto: 'outro', em: '2026-11-07T18:00:00.000Z' } })).toBeNull();
    expect(lerResponsavel({ responsavel: { assunto: 'vaga', em: 'ontem' } })).toBeNull();
    expect(lerResponsavel(null)).toBeNull();
    expect(lerResponsavel({})).toBeNull();
  });

  it('a situação da fila: "responsavel" sem ninguém; pegou → com alguém; nunca tem posição', () => {
    expect(situacaoDo({ status: 'aberto', detalhe: marca })).toBe('responsavel');
    expect(situacaoDo({ status: 'aberto', detalhe: marca, responsavelId: 'u1' })).toBe('com_alguem');
    expect(situacaoDo({ status: 'aberto', detalhe: marca, aguardandoDesde: new Date() })).toBe('aguardando');
    expect(situacaoDo({ status: 'resolvido', detalhe: marca })).toBe('resolvido');
    expect(situacaoDo({ status: 'aberto', detalhe: null })).toBe('fila');
    const [r, comum] = posicoes([{ status: 'aberto', detalhe: marca }, { status: 'aberto', detalhe: null }]);
    expect(r.posicao).toBeNull();
    expect(comum.posicao).toBe(1);
    expect(responsavelNaEspera({ status: 'aberto', detalhe: marca })).toBe(true);
    expect(responsavelNaEspera({ status: 'aberto', detalhe: marca, responsavelId: 'u1' })).toBe(false);
  });

  it('a pausa do robô no WhatsApp: o recado que espera alguém NÃO cala; o caso comum, sim', () => {
    const agora = new Date('2026-11-07T18:10:00Z');
    const chamado = { id: 'c', tipo: 'vaga', pedidoNumero: null, criadoEm: new Date('2026-11-07T18:00:00Z') };
    expect(decidirPausa({ pausa: null, chamado: { ...chamado, paraOResponsavel: true }, minutos: 60, resolvidoEm: null, agora })).toMatchObject({
      pausado: false,
      chamado: { id: 'c' },
    });
    expect(decidirPausa({ pausa: null, chamado, minutos: 60, resolvidoEm: null, agora })).toMatchObject({ pausado: true, motivo: 'chamado' });
    // "sem prazo" (0) também não cala por causa do recado
    expect(decidirPausa({ pausa: null, chamado: { ...chamado, paraOResponsavel: true }, minutos: 0, resolvidoEm: null, agora }).pausado).toBe(false);
    // a pausa do atendente (respondeu pela caixa) continua valendo
    const pausa = { ate: new Date('2026-11-07T19:00:00Z'), motivo: 'atendente', atualizadoEm: new Date('2026-11-07T18:05:00Z') };
    expect(decidirPausa({ pausa, chamado: { ...chamado, paraOResponsavel: true }, minutos: 60, resolvidoEm: null, agora }).pausado).toBe(true);
  });

  it('o Direct: o recado sem ninguém não cala (a mensagem entra nele); com alguém, cala; com o robô desligado, vai para a fila', () => {
    const base = { roboLigado: true, filaLigada: true, ultimaDaLojaEm: null, minutos: 60, agora: Date.parse('2026-11-07T18:10:00Z') };
    const caso = { criadoEm: '2026-11-07T18:05:00Z', responsavelId: null, paraOResponsavel: true };
    expect(quemRespondeNoDirect({ ...base, caso })).toEqual({ anexar: true, abrir: false, robo: true });
    expect(quemRespondeNoDirect({ ...base, caso: { ...caso, responsavelId: 'u1' } })).toEqual({ anexar: true, abrir: false, robo: false });
    // caso comum de 5 min: o robô fica quieto (como sempre)
    expect(quemRespondeNoDirect({ ...base, caso: { ...caso, paraOResponsavel: false } })).toEqual({ anexar: true, abrir: false, robo: false });
    // robô desligado: o recado não segura a conversa — abre um caso comum (fila ligada) ou nada
    expect(quemRespondeNoDirect({ ...base, roboLigado: false, caso })).toEqual({ anexar: false, abrir: true, robo: false });
    expect(quemRespondeNoDirect({ ...base, roboLigado: false, filaLigada: false, caso })).toEqual({ anexar: false, abrir: false, robo: false });
    // a loja respondendo pelo app do Instagram cala, como no recado da abertura
    expect(quemRespondeNoDirect({ ...base, caso, ultimaDaLojaEm: '2026-11-07T18:09:00Z' }).robo).toBe(false);
  });

  it('os Números: fora do tempo de espera e das reclamações', () => {
    const l: any = { tipo: 'vaga', status: 'aberto', criadoEm: '2026-11-07T18:00:00Z', paraOResponsavel: true, classificacao: null };
    expect(grupoDoPlacar(l)).toBeNull();
    expect(oQueAconteceuNoCaso(l).motivo).toBe('nao');
    expect(contaComoReclamacao(l)).toBe(false);
    // o do Direct (tipo instagram) também
    expect(contaComoReclamacao({ ...l, tipo: 'instagram' })).toBe(false);
    expect(contaComoReclamacao({ ...l, tipo: 'instagram', paraOResponsavel: false })).toBe(true);
  });

  it('o resumo do recado: as linhas "Assunto / Quem / Contato / Já fiz" (numa linha só ou uma por linha)', () => {
    const msg = 'Assunto: Vaga: atendente de balcão\nQuem: Larissa, 2 anos em lanchonete\nContato: este WhatsApp\nJá fiz: agradeci e disse que o responsável fala com ela';
    expect(resumoDoRecado(msg)).toEqual({
      assunto: 'Vaga: atendente de balcão',
      quem: 'Larissa, 2 anos em lanchonete',
      contato: 'este WhatsApp',
      jaFez: 'agradeci e disse que o responsável fala com ela',
    });
    expect(resumoDoRecado('Assunto: caixas personalizadas. Quem: Paulo, Embalagens Rio. Contato: (21) 3333-0000')).toEqual({
      assunto: 'caixas personalizadas',
      quem: 'Paulo, Embalagens Rio',
      contato: '(21) 3333-0000',
    });
    expect(resumoDoRecado('sem linhas')).toEqual({});
    // junto do resumo comum: as linhas do recado por cima; sem nada, null
    expect(resumoComORecado({ motivo: 'x', quer: null, jaFez: 'antes', humor: null }, msg)).toMatchObject({
      motivo: 'x',
      assunto: 'Vaga: atendente de balcão',
      contato: 'este WhatsApp',
      jaFez: 'agradeci e disse que o responsável fala com ela',
    });
    expect(resumoComORecado(null, 'nada')).toBeNull();
  });

  it('a resposta ao robô: paraOResponsavel, o assunto e o paraOCliente, sem posição nem "com alguém"', () => {
    const aceito = { assunto: 'vaga' as const, paraOCliente: TEXTO_PADRAO_DO_RECADO.vaga };
    expect(respostaParaOResponsavel('id1', aceito)).toEqual({
      ok: true,
      id: 'id1',
      prioridade: 'normal',
      paraOResponsavel: true,
      assunto: 'vaga',
      paraOCliente: TEXTO_PADRAO_DO_RECADO.vaga,
      posicao: null,
      comAlguem: false,
    });
    expect(respostaParaOResponsavel('id1', aceito, true)).toMatchObject({ jaAberto: true });
  });
});
