import { achadosDasVersoes, achadosDosModelos, dataEmIngles, lerModelosDaAnthropic, lerVersoesDaGraph, linhasQueMudaram, trechoDaFonte, FONTES_VIGIADAS } from './dependencias-fontes';
import { HTML_DA_META, MD_COM_O_HAIKU_DEPRECADO, MD_DA_ANTHROPIC } from './dependencias-amostras.teste-spec';

describe('as fontes vigiadas', () => {
  it('a data em inglês, até a torta da Meta; o resto vira null', () => {
    expect(dataEmIngles('July 29,2028')).toBe('2028-07-29');
    expect(dataEmIngles('February 18, 2026')).toBe('2026-02-18');
    expect(dataEmIngles('Not sooner than October 7, 2027')).toBe('2027-10-07');
    expect(dataEmIngles('TBD')).toBeNull();
    expect(dataEmIngles('Talvez 3, 2027')).toBeNull();
  });

  it('a tabela de versões da Graph API', () => {
    expect(lerVersoesDaGraph(HTML_DA_META)).toEqual([
      { versao: 'v26.0', lancada: '2026-07-29', validaAte: null, textoDaValidade: 'TBD' },
      { versao: 'v25.0', lancada: '2026-02-18', validaAte: '2028-07-29', textoDaValidade: 'July 29,2028' },
      { versao: 'v24.0', lancada: '2025-10-08', validaAte: '2028-02-18', textoDaValidade: 'February 18, 2028' },
    ]);
    expect(lerVersoesDaGraph('<html>sem tabela</html>')).toEqual([]);
  });

  it('a versão em uso: em dia, vencendo (180 dias) e fora da tabela (a Meta atrasa) — nunca "retirada"', () => {
    const a = achadosDasVersoes(lerVersoesDaGraph(HTML_DA_META), '2026-11-15');
    const de = (id: string) => a.find((x) => x.integracao === id)!;
    expect(de('meta-whatsapp')).toMatchObject({ usamos: 'v25.0', situacao: 'em_dia', data: '2028-07-29' });
    expect(de('meta-instagram')).toMatchObject({ usamos: 'v27.0', situacao: 'a_conferir', texto: expect.stringContaining('confirme pela API') });
    expect(achadosDasVersoes(lerVersoesDaGraph(HTML_DA_META), '2028-03-01').find((x) => x.integracao === 'meta-whatsapp')).toMatchObject({ situacao: 'vencendo' });
    expect(achadosDasVersoes(lerVersoesDaGraph(HTML_DA_META), '2028-08-01').find((x) => x.integracao === 'meta-whatsapp')!.texto).toContain('venceu');
  });

  it('a tabela dos modelos da Anthropic e os modelos em uso', () => {
    const l = lerModelosDaAnthropic(MD_DA_ANTHROPIC);
    expect(l.map((x) => x.modelo)).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-sonnet-4-5-20250929', 'claude-haiku-5-5']);
    expect(l[2]).toMatchObject({ situacao: 'Deprecated', deprecadoEm: '2026-09-30', aposentadoriaEm: '2026-11-30', naoAntesDe: false });
    const a = achadosDosModelos(l);
    expect(a.every((x) => x.situacao === 'em_dia')).toBe(true);
    expect(a.find((x) => x.usamos === 'claude-haiku-5-5')!.texto).toContain('não antes de 07/10/2027');
    const deprecado = achadosDosModelos(lerModelosDaAnthropic(MD_COM_O_HAIKU_DEPRECADO));
    expect(deprecado.find((x) => x.usamos === 'claude-haiku-5-5')).toMatchObject({ situacao: 'vencendo', data: '2027-05-01' });
    expect(achadosDosModelos([]).every((x) => x.situacao === 'a_conferir')).toBe(true);
  });

  it('o trecho é só a tabela (o visual da página não conta) e as linhas que mudaram', () => {
    const meta = FONTES_VIGIADAS.find((f) => f.id === 'meta-graph-versoes')!;
    const t1 = trechoDaFonte(meta, `<div class="topo">menu</div>${HTML_DA_META}`);
    const t2 = trechoDaFonte(meta, `<div class="topo novo">outro menu, outro rodapé</div>${HTML_DA_META}`);
    expect(t1).toBe(t2);
    expect(t1).toContain('v25.0 | 2026-02-18 | 2028-07-29');
    expect(trechoDaFonte(meta, '<p>nada</p>')).toBeNull();
    expect(linhasQueMudaram('a\nb\nc', 'a\nc\nd')).toEqual({ saiu: ['b'], entrou: ['d'] });
  });
});
