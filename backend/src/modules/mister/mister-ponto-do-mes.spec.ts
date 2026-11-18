import {
  PREFIXO_DO_PONTO_DO_MES,
  TEXTOS_DO_PONTO_DO_MES,
  botoesDoPontoDoMes,
  competenciaDoAviso,
  finalDoWhatsapp,
  lerBotaoDoPontoDoMes,
  linhaDasPendencias,
  naJanelaDoPontoDoMes,
  nomeDoMes,
  nomeDoPdfDoPonto,
  periodoDoMes,
  textoDoPontoDoMes,
} from './mister-ponto-do-mes';

// M3e parte 2 — o arquivo do ponto do mês pelo Mister. As regras puras: a janela, o texto, os botões e o nome do PDF.

const AVISO = '0f8fad5b-d9cb-469f-a165-70867728950e';
// O relógio da loja é o de Brasília (UTC−3): 06:00 da loja = 09:00 UTC.
const loja = (dataHora: string) => new Date(`${dataHora}-03:00`);

describe('o arquivo do ponto do mês do Mister (M3e parte 2) — as regras', () => {
  it('o mês e o período: o nome do mês, o último dia de cada mês (e o fevereiro bissexto)', () => {
    expect(nomeDoMes('2026-10-01')).toBe('outubro');
    expect(nomeDoMes('2026-03-01')).toBe('março');
    expect(periodoDoMes('2026-10-01')).toBe('1 a 31/10');
    expect(periodoDoMes('2026-11-01')).toBe('1 a 30/11');
    expect(periodoDoMes('2026-02-01')).toBe('1 a 28/02');
    expect(periodoDoMes('2028-02-01')).toBe('1 a 29/02');
  });

  it('a competência é o mês anterior no relógio da loja (janeiro olha dezembro do ano anterior)', () => {
    expect(competenciaDoAviso(loja('2026-11-01T06:00:00'))).toBe('2026-10-01');
    expect(competenciaDoAviso(loja('2027-01-01T06:00:00'))).toBe('2026-12-01');
    // 01:30 UTC do dia 1 ainda é o último dia do mês na loja: a competência é a do mês anterior a ESSE.
    expect(competenciaDoAviso(new Date('2026-11-01T01:30:00Z'))).toBe('2026-09-01');
  });

  it('a janela: do dia 1 às 06:00 da loja até o fim do dia 5', () => {
    expect(naJanelaDoPontoDoMes(loja('2026-11-01T05:59:00'))).toBe(false);
    expect(naJanelaDoPontoDoMes(loja('2026-11-01T06:00:00'))).toBe(true);
    expect(naJanelaDoPontoDoMes(loja('2026-11-03T02:00:00'))).toBe(true);
    expect(naJanelaDoPontoDoMes(loja('2026-11-05T23:59:00'))).toBe(true);
    expect(naJanelaDoPontoDoMes(loja('2026-11-06T00:00:00'))).toBe(false);
    expect(naJanelaDoPontoDoMes(loja('2026-10-31T23:00:00'))).toBe(false);
    // 08:00 UTC do dia 1 = 05:00 da loja: ainda não.
    expect(naJanelaDoPontoDoMes(new Date('2026-11-01T08:00:00Z'))).toBe(false);
  });

  it('as pendências: ninguém, uma pessoa, mais dias e mais pessoas', () => {
    expect(linhaDasPendencias([])).toBe('nenhuma pendência');
    expect(linhaDasPendencias([{ nome: 'Bruno Dias', dias: [] }])).toBe('nenhuma pendência');
    expect(linhaDasPendencias([{ nome: 'Bruno Dias', dias: [{ data: '2026-10-28' }] }])).toBe('1 pendente (Bruno Dias, 28/10)');
    expect(linhaDasPendencias([{ nome: 'Bruno Dias', dias: [{ data: '2026-10-28' }, { data: '2026-10-29' }, { data: '2026-10-30' }] }])).toBe(
      '1 pendente (Bruno Dias, 28/10 e mais 2 dias)',
    );
    const quatro = ['Ana', 'Bia', 'Caio', 'Davi'].map((nome, i) => ({ nome, dias: [{ data: `2026-10-0${i + 1}` }] }));
    expect(linhaDasPendencias(quatro)).toBe('4 pendentes (Ana, 01/10; Bia, 02/10; Caio, 03/10 e mais 1 pessoa)');
  });

  it('o texto do aviso: o mês, a empresa, o período, as pendências e o responsável pelo final do WhatsApp (nunca o número)', () => {
    const base = { tenantId: 't', empresa: 'Mister Burger', competencia: '2026-10-01', totalColaboradores: 14, pendencias: [{ nome: 'Bruno Dias', dias: [{ data: '2026-10-28' }] }] };
    const com = textoDoPontoDoMes({ ...base, contador: { id: 'c', nome: 'Juliana Prado', whatsapp: '+55 (21) 99876-7788' } });
    expect(com.titulo).toBe('Ponto de outubro · Mister Burger (1 a 31/10)');
    expect(com.detalhe).toBe(
      '14 colaboradores · 1 pendente (Bruno Dias, 28/10).\n\nEnvio à contabilidade? Juliana Prado (WhatsApp final 7788).',
    );
    expect(com.detalhe).not.toContain('99876');
    const sem = textoDoPontoDoMes({ ...base, totalColaboradores: 1, contador: null });
    expect(sem.detalhe).toMatch(/^1 colaborador · 1 pendente/);
    expect(sem.detalhe).toContain('cadastre o responsável em Pessoas › Gerenciamento de ponto');
    expect(finalDoWhatsapp('5521998767788')).toBe('7788');
  });

  it('os botões: "Enviar ao contador" só com o responsável; "Ver antes" sempre; o que não é do ponto não se lê', () => {
    expect(botoesDoPontoDoMes(AVISO, true)).toEqual([
      { id: `pmes:enviar:${AVISO}`, titulo: 'Enviar ao contador' },
      { id: `pmes:ver:${AVISO}`, titulo: 'Ver antes' },
    ]);
    expect(botoesDoPontoDoMes(AVISO, false)).toEqual([{ id: `pmes:ver:${AVISO}`, titulo: 'Ver antes' }]);
    // O título cabe no botão da Meta (até 20 letras).
    for (const b of botoesDoPontoDoMes(AVISO, true)) expect(b.titulo.length).toBeLessThanOrEqual(20);
    expect(botoesDoPontoDoMes(AVISO, true)[0].id.startsWith(PREFIXO_DO_PONTO_DO_MES)).toBe(true);
    expect(lerBotaoDoPontoDoMes(`pmes:enviar:${AVISO}`)).toEqual({ acao: 'enviar', avisoId: AVISO });
    expect(lerBotaoDoPontoDoMes(`pmes:ver:${AVISO.toUpperCase()}`)).toEqual({ acao: 'ver', avisoId: AVISO });
    for (const torto of [`pmes:apagar:${AVISO}`, `pmes:enviar:${AVISO}x`, 'pmes:enviar:1', `rec:pub:${AVISO}`, '', null]) expect(lerBotaoDoPontoDoMes(torto)).toBeNull();
  });

  it('o nome do PDF e as frases', () => {
    expect(nomeDoPdfDoPonto('2026-10-01', 'Mister Burger')).toBe('Espelho de ponto · outubro 2026 · Mister Burger.pdf');
    expect(nomeDoPdfDoPonto('2026-10-01', 'A/B "C" Ltda')).toBe('Espelho de ponto · outubro 2026 · A B C Ltda.pdf');
    expect(TEXTOS_DO_PONTO_DO_MES.enviado('Juliana Prado', '06:04', '2026-10-01')).toBe(
      'Enviado às 06:04 para Juliana Prado. Fica no fechamento de outubro, em Pessoas › Gerenciamento de ponto.',
    );
    // O caminho do menu que as frases mandam seguir (V65): "Pessoas › Gerenciamento de ponto".
    for (const t of [TEXTOS_DO_PONTO_DO_MES.semContador, TEXTOS_DO_PONTO_DO_MES.naoVale, TEXTOS_DO_PONTO_DO_MES.verAntes('2026-10-01')])
      expect(t).toContain('Pessoas › Gerenciamento de ponto');
  });
});
