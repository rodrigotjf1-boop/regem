import { FERRAMENTAS, FERRAMENTA_DO_QUE_FALTA, TEMAS_DO_QUE_FALTA, ehConsulta, ehFerramenta } from './mister-agente.regras';
import {
  AGORA_DA_AVALIACAO,
  CASOS_DA_AVALIACAO,
  CasoDaAvaliacao,
  RESPOSTA_ERRADA_MAX,
  conferirCaso,
  conversaDaAvaliacao,
  executarNaAvaliacao,
  temONumero,
  versaoDasInstrucoes,
} from './mister-avaliacao-casos';
import type { FimDaPergunta } from './mister-laco';

/* eslint-disable @typescript-eslint/no-explicit-any */

// F5.3: a avaliação de regressão do Mister — as perguntas fixas, a loja de teste com dados inventados e a conferência
// por regra (nunca a IA julgando a si mesma).

const PRES = { nivel: 'presidente' as const, verValores: true };
const SEM_VALORES = { nivel: 'gerente' as const, verValores: false };
const fim = (texto: string | null, ferramentas: Array<{ nome: string; ok?: boolean; entrada?: Record<string, string> }> = [], resultados: unknown[] = [], motivo: any = null): FimDaPergunta =>
  (texto === null
    ? { texto: null, motivo: motivo ?? 'nao_fechou', trilha: { ferramentas: ferramentas.map((f) => ({ nome: f.nome, ok: f.ok ?? true, ms: 1, entrada: f.entrada ?? {} })) } }
    : { texto, motivo: null, resultados, trilha: { ferramentas: ferramentas.map((f) => ({ nome: f.nome, ok: f.ok ?? true, ms: 1, entrada: f.entrada ?? {} })) } }) as FimDaPergunta;

describe('a avaliação do Mister — as perguntas', () => {
  it('são 119 (c119: a nova previsão do pedido pela conversa, P3 de "Pedidos e recebimento"; c118: a validade pendente pela conversa, P1; c113 a c117: auditoria, manutenção, produção, candidatos e cashback, etapa 9 de 24/11; a c110, a c111 e a c112 das campanhas, etapa 8 de 24/11; a c108 e a c109 do cardápio, etapa 7 de 24/11; a c107 do pedido de compra enviado, etapa 6 de 24/11; a c106 do ajuste de ponto, etapa 5 de 24/11; a c105 das avaliações dos clientes, etapa 4 de 24/11; a c104 da agenda das encomendas, etapa 3 de 24/11; a c102 e a c103 do acerto dos entregadores, etapa 2 de 24/11; a c99 das mesas, a c100 e a c101 do caixa à distância, etapa 1 de 24/11; a c97 e a c98 do produto e do fornecedor, versão 9 O5 segunda parte; a c95 e a c96 do cupom e da conta a pagar, versão 9 O5; a c94 de repetir o pedido, versão 9 O4; a c92 e a c93 do cadastro pela conversa, versão 9 O3; a c90 e a c91 do link para abrir a notícia e a tela, 24/11; a c88 e a c89 do cupom em aberto e de quem criou o pedido, ERR-594; a c86 e a c87 do caixa pelo extrato, R2; a c85 da regra pela agenda, E3; a c83 e a c84 das notícias do ramo, N3; a c81 e a c82 da venda em dias assim, E2; a c79 e a c80 de clima e eventos, E1; a c71 a c78 dos indicadores, V7f; a c64 a c70 das análises, V7e; a c61 do plano com um botão, a c62 da reclamação conferida e a c63 do ajuste na conversa, V7c; a c59 e a c60 da regra que junta os avisos, ERR-561; a c58 da conta paga com PIN, M6j lote 10; a c57 do horário com PIN, M6j lote 9; a c56 do preço com PIN, M6j lote 8; a c43 do gasto do WhatsApp, G3; a c44 da memória, M4b; a c45 a c47 do fica de olho e do lembrete, M4d; a c48 do gráfico, M5d.2; a c49 da pausa pelo WhatsApp, M6j; a c50 das contas de quem não vê valores, M6j lote 4; a c51 e a c52 das faltas e das horas, M6j lote 5; a c53 dos clientes em números, M6j lote 6; a c54 da imagem, M6l; a c55 do movimento de estoque, M6j lote 7), com id e pergunta únicos, e cada uma confere alguma coisa', () => {
    expect(CASOS_DA_AVALIACAO).toHaveLength(123);
    expect(new Set(CASOS_DA_AVALIACAO.map((c) => c.id)).size).toBe(123);
    expect(new Set(CASOS_DA_AVALIACAO.map((c) => `${c.pergunta}|${c.perfil?.nivel ?? 'presidente'}|${c.perfil?.verValores ?? true}`)).size).toBe(123);
    for (const c of CASOS_DA_AVALIACAO) {
      const confere = (c.consultas?.length ?? 0) + (c.umaDasConsultas?.length ?? 0) + (c.numeros?.length ?? 0) + (c.contem?.length ?? 0) + (c.anotar?.length ?? 0) + (c.semValores ? 1 : 0) + (c.semConsulta ? 1 : 0);
      expect({ id: c.id, confere: confere > 0 }).toEqual({ id: c.id, confere: true });
      for (const n of [...(c.consultas ?? []), ...(c.umaDasConsultas ?? [])]) expect(ehFerramenta(n) && n !== FERRAMENTA_DO_QUE_FALTA).toBe(true);
      for (const t of c.anotar ?? []) expect(TEMAS_DO_QUE_FALTA).toContain(t);
    }
  });

  it('toda consulta do Mister tem pergunta na avaliação (consulta nova sem pergunta = este teste pega)', () => {
    const usadas = new Set(CASOS_DA_AVALIACAO.flatMap((c) => [...(c.consultas ?? []), ...(c.umaDasConsultas ?? [])]));
    // Só as CONSULTAS (a anotação do que falta e a proposta da F4.3 não leem dado).
    const semPergunta = FERRAMENTAS.map((f) => f.name).filter((n) => ehConsulta(n) && !usadas.has(n));
    expect(semPergunta).toEqual([]);
    // E o que falta tem pergunta também.
    expect(CASOS_DA_AVALIACAO.some((c) => c.anotar?.length)).toBe(true);
  });

  it('cada número esperado existe na loja de teste (pergunta impossível = este teste pega)', () => {
    // Tudo o que as ferramentas devolvem, com os períodos e os dias que a loja de teste tem.
    const entradas = [{}, { foco: 'semana' }, { foco: 'pico' }, { foco: 'fases_do_mes' }, { foco: 'perdas' }, { foco: 'margem', de: '2026-09-01', ate: '2026-09-30' }, { foco: 'inadimplencia' }, { foco: 'prazo_pagamento' }, { foco: 'caixa' }, { foco: 'roi_campanha' }, { acao: 'informar_saldo', valorInformado: 42300 }, { acao: 'conferir' }, { dia: 'ontem' }, ...['hoje', 'ontem', 'esta_semana', 'semana_passada', 'este_mes', 'mes_passado'].map((periodo) => ({ periodo, comparar: true })), { numero: '284' }, { pessoa: 'Bruna' }, { assunto: 'pausar o iFood' }, { ordem: 'lucro', periodo: 'este_mes' }];
    const perfis = [PRES, ...CASOS_DA_AVALIACAO.flatMap((c) => (c.perfil?.extrato ? [c.perfil] : []))];
    const tudo = perfis.flatMap((p) => FERRAMENTAS.flatMap((f) => entradas.map((en) => JSON.stringify(executarNaAvaliacao(f.name, en, p).dados)))).join(' ');
    const comoNoJson = (n: string) => n.replace(/\.(?=\d{3}(?!\d))/g, '').replace(',', '.');
    for (const c of CASOS_DA_AVALIACAO)
      for (const n of c.numeros ?? []) {
        const alguma = n.split('|').some((alt) => /^\d/.test(alt) && (tudo.includes(comoNoJson(alt)) || tudo.includes(alt)));
        expect({ caso: c.id, numero: n, existe: alguma || /^[a-zç]/i.test(n) }).toEqual({ caso: c.id, numero: n, existe: true });
      }
  });
});

describe('a avaliação do Mister — a loja de teste', () => {
  it('toda ferramenta responde (ou recusa como a de verdade), para os dois perfis', () => {
    for (const f of FERRAMENTAS)
      for (const p of [PRES, SEM_VALORES]) {
        const r = executarNaAvaliacao(f.name, f.name === 'historia_do_pedido' ? { numero: '284' } : f.name === 'como_usar_o_regem' ? { assunto: 'pausar o iFood' } : {}, p);
        expect(typeof r.ok).toBe('boolean');
        expect(r.dados).toEqual(expect.any(Object));
      }
    expect(executarNaAvaliacao('inventada', {}, PRES)).toEqual({ ok: false, dados: { erro: 'Essa consulta não existe.' } });
  });

  it('os números batem entre si: ontem é o mesmo no resumo e no relatório, e as horas somam o dia', () => {
    const resumoOntem: any = executarNaAvaliacao('resumo_do_dia', { dia: 'ontem' }, PRES).dados;
    const vendasOntem: any = executarNaAvaliacao('vendas_do_periodo', { periodo: 'ontem' }, PRES).dados;
    expect(resumoOntem.faturamento).toBe(5110.85);
    expect(vendasOntem.faturamento).toBe(5110.85);
    expect(resumoOntem.numeroDeVendas).toBe(vendasOntem.numeroDeVendas);
    const cent = (x: number) => Math.round(x * 100);
    for (const periodo of ['hoje', 'ontem']) {
      const v: any = executarNaAvaliacao('vendas_do_periodo', { periodo }, PRES).dados;
      expect(v.porHora.reduce((s: number, h: any) => s + h.vendas, 0)).toBe(v.numeroDeVendas);
      expect(v.porHora.reduce((s: number, h: any) => s + cent(h.total), 0)).toBe(cent(v.faturamento));
    }
    expect(cent(resumoOntem.faturamentoDoBalcao) + cent(resumoOntem.faturamentoDoDelivery)).toBe(cent(resumoOntem.faturamento));
    const hoje: any = executarNaAvaliacao('resumo_do_dia', {}, PRES).dados;
    expect(cent(hoje.faturamentoDoBalcao) + cent(hoje.faturamentoDoDelivery)).toBe(cent(hoje.faturamento));
    const dl = vendasOntem.delivery;
    expect(dl.porPlataforma.reduce((s: number, x: any) => s + cent(x.faturamento), 0)).toBe(cent(dl.faturamento));
  });

  it('quem não vê valores recebe os valores vazios e o aviso; o gerente não abre o servidor', () => {
    const r: any = executarNaAvaliacao('resumo_do_dia', {}, SEM_VALORES).dados;
    expect(r.faturamento).toBeNull();
    expect(r.aviso).toContain('não mostra valores em reais');
    expect((executarNaAvaliacao('vendas_do_periodo', { periodo: 'ontem' }, SEM_VALORES).dados as any).faturamento).toBeNull();
    expect((executarNaAvaliacao('caixas_e_sangrias', {}, SEM_VALORES).dados as any).abertosAgora[0].sangrias).toBeNull();
    expect(executarNaAvaliacao('produtos_mais_vendidos', { ordem: 'lucro' }, SEM_VALORES).ok).toBe(false);
    expect(executarNaAvaliacao('servidor_e_incidentes', {}, { nivel: 'gerente', verValores: true }).ok).toBe(false);
    expect(executarNaAvaliacao('servidor_e_incidentes', {}, PRES).ok).toBe(true);
    expect(executarNaAvaliacao('historia_do_pedido', { numero: '999' }, PRES).ok).toBe(false);
  });

  it('o guia de uso é o de verdade, e a anotação do que falta responde como a de verdade', () => {
    const g: any = executarNaAvaliacao('como_usar_o_regem', { assunto: 'pausar o iFood' }, PRES).dados;
    expect(g.encontrado).toBe(true);
    expect(g.secoes[0].ondeFica).toContain('Delivery');
    expect(executarNaAvaliacao(FERRAMENTA_DO_QUE_FALTA, { tema: 'clientes' }, PRES)).toEqual({ ok: true, dados: { anotado: true, siga: expect.stringContaining('ainda não tem acesso') } });
  });

  it('a conversa da loja de teste e a versão das instruções', () => {
    expect(conversaDaAvaliacao(PRES)).toContain(AGORA_DA_AVALIACAO);
    expect(conversaDaAvaliacao(PRES)).toContain('Empresa de Teste da Avaliação');
    const v = versaoDasInstrucoes();
    expect(v.versao).toMatch(/^[0-9a-f]{8}$/);
    expect(v.consultas).toBe(FERRAMENTAS.filter((f) => ehConsulta(f.name)).length);
    expect(versaoDasInstrucoes()).toEqual(v);
  });
});

describe('a avaliação do Mister — a conferência por regra', () => {
  const caso = (c: Partial<CasoDaAvaliacao>): CasoDaAvaliacao => ({ id: 'x', pergunta: 'p', ...c });

  it('o número aparece sozinho, com ou sem o ponto de milhar', () => {
    expect(temONumero('Hoje foram 87 vendas.', '87')).toBe(true);
    expect(temONumero('Hoje foram 187 vendas.', '87')).toBe(false);
    expect(temONumero('Média de 87,5.', '87')).toBe(false);
    expect(temONumero('Você vendeu R$ 4.321,45 hoje.', '4.321,45')).toBe(true);
    expect(temONumero('Você vendeu R$ 4321,45 hoje.', '4.321,45')).toBe(true);
    expect(temONumero('Você vendeu R$ 4.321,40 hoje.', '4.321,45')).toBe(false);
    expect(temONumero('A versão nova é a 1.30.13.', '1.30.13')).toBe(true);
    expect(temONumero('Saiu às 20:18.', '20:18')).toBe(true);
  });

  it('a resposta certa passa', () => {
    const r = conferirCaso(caso({ consultas: ['resumo_do_dia'], numeros: ['4.321,45'], contem: ['delivery'] }), fim('Hoje: R$ 4.321,45, a maior parte no Delivery.', [{ nome: 'resumo_do_dia' }], [{ faturamento: 4321.45 }]));
    expect(r).toEqual({ id: 'x', pergunta: 'p', ok: true, falhas: [], consultas: ['resumo_do_dia'], ms: 0 });
  });

  it('a que erra guarda o texto que saiu, cortado (para saber a causa); a certa não guarda nada', () => {
    const errada = conferirCaso(caso({ consultas: ['produtos_mais_vendidos'] }), fim('Os três somam R$ 10.857,35, a R$ 23,45 cada.', [{ nome: 'produtos_mais_vendidos' }], [{ faturamento: 3845.8 }]));
    expect(errada).toMatchObject({ ok: false, falhas: ['disse um valor em reais que nenhuma consulta trouxe'], resposta: 'Os três somam R$ 10.857,35, a R$ 23,45 cada.' });
    expect(conferirCaso(caso({}), fim('x'.repeat(RESPOSTA_ERRADA_MAX + 50), [], [], null)).resposta).toBeUndefined();
    expect(conferirCaso(caso({ consultas: ['resumo_do_dia'] }), fim('y'.repeat(RESPOSTA_ERRADA_MAX + 50))).resposta).toHaveLength(RESPOSTA_ERRADA_MAX);
    // A que não respondeu não tem texto: nada a guardar.
    expect(conferirCaso(caso({}), fim(null, [], [], 'nao_fechou')).resposta).toBeUndefined();
  });

  it('cada regra reprova o que deve', () => {
    const falhas = (c: Partial<CasoDaAvaliacao>, f: FimDaPergunta) => conferirCaso(caso(c), f).falhas;
    expect(falhas({ consultas: ['resumo_do_dia'] }, fim('Foi bom.'))).toEqual(['não usou a consulta "resumo do dia"']);
    expect(falhas({ consultas: ['resumo_do_dia'] }, fim('Foi bom.', [{ nome: 'resumo_do_dia', ok: false }]))).toEqual(['não usou a consulta "resumo do dia"']);
    expect(falhas({ umaDasConsultas: ['resumo_do_dia', 'vendas_do_periodo'] }, fim('Foi bom.', [{ nome: 'vendas_do_periodo' }]))).toEqual([]);
    expect(falhas({ numeros: ['87|oitenta e sete'] }, fim('Foram 86.'))).toEqual(['a resposta não traz 87']);
    expect(falhas({ contem: ['Bruna'] }, fim('O caixa está aberto.'))).toEqual(['a resposta não fala de "Bruna"']);
    expect(falhas({ contem: ['pão de hambúrguer'] }, fim('Falta Pao de Hamburguer.'))).toEqual([]);
    expect(falhas({ semValores: true }, fim('Você faturou R$ 4.321,45.', [], [{ v: 4321.45 }]))).toEqual(['mostrou valor em reais a quem não vê valores']);
    expect(falhas({ anotar: ['clientes'] }, fim('Ainda não tenho.'))).toEqual(['não anotou o que falta']);
    expect(falhas({ anotar: ['clientes'] }, fim('Ainda não tenho.', [{ nome: FERRAMENTA_DO_QUE_FALTA, entrada: { tema: 'vendas' } }]))).toEqual(['anotou o tema "vendas" (esperado: clientes)']);
    expect(falhas({ anotar: ['clientes'] }, fim('Ainda não tenho.', [{ nome: FERRAMENTA_DO_QUE_FALTA, entrada: { tema: 'clientes' } }]))).toEqual([]);
    expect(falhas({ semConsulta: true }, fim('Bom dia!', [{ nome: 'resumo_do_dia' }]))).toEqual(['consultou dado sem precisar']);
    expect(falhas({ semConsulta: true }, fim('Bom dia!', [{ nome: FERRAMENTA_DO_QUE_FALTA }]))).toEqual([]);
    // Para todas: valor em reais que nenhuma consulta trouxe.
    expect(falhas({}, fim('Você faturou R$ 9.999,99.', [{ nome: 'resumo_do_dia' }], [{ faturamento: 4321.45 }]))).toEqual(['disse um valor em reais que nenhuma consulta trouxe']);
    // Sem resposta: só o motivo.
    expect(falhas({ numeros: ['87'] }, fim(null, [], [], 'indisponivel'))).toEqual(['não respondeu (indisponivel)']);
  });
});
