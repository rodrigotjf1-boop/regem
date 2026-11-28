import { INSTRUCOES_DO_MISTER } from './mister-agente.regras';
import { versaoDasInstrucoes } from './mister-avaliacao-casos';
import { aplicarTrocas, compararAvaliacoes, lerCandidata, mensagensDoMentor, regraDePublicar, versaoDoTexto } from './mister-instrucoes';

// As instruções candidatas (M2b, mig 435): puro. O banco, o Mentor de mentira e a publicação estão em `mister-pg.teste-spec.ts`.

const TEXTO = ['Você é o Mister.', '- Responda curto.', '- Use as consultas.', ''].join('\n');
const caso = (id: string, ok: boolean) => ({ id, pergunta: `pergunta ${id}`, ok });
const rodada = (versao: string, casos: ReturnType<typeof caso>[], o: Partial<{ situacao: string; feitas: number; total: number }> = {}) => ({
  situacao: 'terminou',
  versao,
  total: casos.length,
  feitas: casos.length,
  casos,
  ...o,
});

describe('as instruções candidatas do Mister (M2b)', () => {
  it('sem troca, o texto e a versão são os do código (a mesma conta da avaliação)', () => {
    const r = aplicarTrocas(INSTRUCOES_DO_MISTER, []);
    expect(r.texto).toBe(INSTRUCOES_DO_MISTER);
    expect(versaoDoTexto(r.texto)).toBe(versaoDasInstrucoes().versao);
  });

  it('aplica as trocas em ordem pela linha EXATA; a que não acha a linha fica de fora e é avisada', () => {
    const r = aplicarTrocas(TEXTO, [
      { id: 'a', sai: '- Responda curto.', entra: '- Responda curto, com os números.' },
      { id: 'b', sai: '- Linha que não existe.', entra: '- Qualquer.' },
      { id: 'c', sai: '- Responda curto, com os números.', entra: '- Responda curto, com os números e a fonte.' },
      { id: 'd', sai: '', entra: '- vazia não vale' },
    ]);
    expect(r.texto).toBe(['Você é o Mister.', '- Responda curto, com os números e a fonte.', '- Use as consultas.', ''].join('\n'));
    expect(r.aplicadas).toEqual(['a', 'c']);
    expect(r.quebradas).toEqual(['b', 'd']);
    expect(versaoDoTexto(r.texto)).not.toBe(versaoDoTexto(TEXTO));
  });

  it('o pedido ao Mentor leva as instruções numeradas e as erradas (a pergunta e a falha)', () => {
    const [m] = mensagensDoMentor(TEXTO, [{ pergunta: 'Quanto vendi?', falhas: ['não consultou vendas'] }]);
    expect(m.content).toContain('1| Você é o Mister.');
    expect(m.content).toContain('2| - Responda curto.');
    expect(m.content).toContain('1. "Quanto vendi?" — não consultou vendas');
  });

  it('a candidata do Mentor: a linha que sai precisa existir (sem o número da linha, sem os espaços das pontas); o resto cai', () => {
    expect(lerCandidata('{"sai":"2| - Responda curto.","entra":"- Responda curto, com os números.","porque":"faltava o número"}', TEXTO)).toEqual({
      sai: '- Responda curto.',
      entra: '- Responda curto, com os números.',
      porque: 'faltava o número',
    });
    expect(lerCandidata('Segue: {"sai":"  - Use as consultas.  ","entra":"- Use as consultas e diga qual.","porque":""}', TEXTO)).toMatchObject({ sai: '- Use as consultas.', porque: 'sem explicação' });
    expect(lerCandidata('{"sai":"- Não existe.","entra":"- Nova linha longa o bastante.","porque":"x"}', TEXTO)).toBeNull();
    expect(lerCandidata('{"sai":"- Responda curto.","entra":"- Responda curto.","porque":"igual"}', TEXTO)).toBeNull();
    expect(lerCandidata('{"sai":"- Responda curto.","entra":"curta","porque":"x"}', TEXTO)).toBeNull();
    expect(lerCandidata('{"sai":"","entra":"- Nova linha longa o bastante.","porque":"x"}', TEXTO)).toBeNull();
    expect(lerCandidata('sem json', TEXTO)).toBeNull();
    // A linha que entra vira uma linha só.
    expect(lerCandidata('{"sai":"- Responda curto.","entra":"- Responda curto,\\ncom os números.","porque":"x"}', TEXTO)?.entra).toBe('- Responda curto, com os números.');
  });

  it('compara as avaliações: errada nova = acertou na base e errou na candidata; melhorou = o contrário', () => {
    const r = compararAvaliacoes([caso('1', true), caso('2', false), caso('3', true)], [caso('1', false), caso('2', true), caso('3', true), caso('4', false)]);
    expect(r.novas.map((c) => c.id)).toEqual(['1']);
    expect(r.melhoraram.map((c) => c.id)).toEqual(['2']);
  });

  it('a regra de publicar: a base de agora, a avaliação inteira da candidata, a da versão no ar, e nenhuma errada nova', () => {
    const candidata = { versaoBase: 'noar', versao: 'cand' };
    const base = rodada('noar', [caso('1', true), caso('2', false)]);
    const boa = rodada('cand', [caso('1', true), caso('2', true)]);
    expect(regraDePublicar({ versaoNoAr: 'noar', candidata, base, daCandidata: boa })).toMatchObject({ pode: true, motivo: null, novas: [], melhoraram: [{ id: '2' }] });
    expect(regraDePublicar({ versaoNoAr: 'outra', candidata, base, daCandidata: boa }).motivo).toContain('A versão no ar mudou');
    expect(regraDePublicar({ versaoNoAr: 'noar', candidata, base, daCandidata: null }).motivo).toBe('Rode a avaliação com a candidata antes de publicar.');
    expect(regraDePublicar({ versaoNoAr: 'noar', candidata, base, daCandidata: rodada('outra', boa.casos) }).motivo).toBe('Rode a avaliação com a candidata antes de publicar.');
    expect(regraDePublicar({ versaoNoAr: 'noar', candidata, base, daCandidata: rodada('cand', boa.casos, { situacao: 'rodando' }) }).motivo).toBe('A avaliação da candidata ainda está rodando.');
    expect(regraDePublicar({ versaoNoAr: 'noar', candidata, base, daCandidata: rodada('cand', boa.casos, { feitas: 1, total: 2 }) }).motivo).toContain('não terminou');
    expect(regraDePublicar({ versaoNoAr: 'noar', candidata, base: null, daCandidata: boa }).motivo).toContain('ainda não tem uma avaliação inteira');
    const pior = regraDePublicar({ versaoNoAr: 'noar', candidata, base, daCandidata: rodada('cand', [caso('1', false), caso('2', true)]) });
    expect(pior).toMatchObject({ pode: false, motivo: '1 pergunta passou a errar com a candidata.', novas: [{ id: '1' }] });
  });

  it('ERR-659 (rodada 7, MIS-G-03): só compara com a mesma régua — o mesmo modelo e as mesmas perguntas', () => {
    const candidata = { versaoBase: 'noar', versao: 'cand' };
    const base = rodada('noar', [caso('1', true), caso('2', true)]);
    // A pergunta nova ('3') que a candidata erra ficava fora da comparação: agora pede a avaliação da versão no ar de novo.
    const comNova = rodada('cand', [caso('1', true), caso('2', true), caso('3', false)]);
    expect(regraDePublicar({ versaoNoAr: 'noar', candidata, base, daCandidata: comNova })).toMatchObject({ pode: false, motivo: expect.stringContaining('perguntas da avaliação mudaram') });
    // A mesma id com outra pergunta também.
    const trocada = rodada('cand', [caso('1', true), { id: '2', pergunta: 'outra pergunta', ok: true }]);
    expect(regraDePublicar({ versaoNoAr: 'noar', candidata, base, daCandidata: trocada }).pode).toBe(false);
    // Outro modelo.
    const outroModelo = { ...rodada('cand', [caso('1', true), caso('2', true)]), modelo: 'claude-sonnet-5-5' };
    expect(regraDePublicar({ versaoNoAr: 'noar', candidata, base: { ...base, modelo: 'claude-haiku-5-5' }, daCandidata: outroModelo }).motivo).toContain('modelos diferentes');
    // A mesma régua: publica.
    expect(regraDePublicar({ versaoNoAr: 'noar', candidata, base: { ...base, modelo: 'm' }, daCandidata: { ...rodada('cand', base.casos), modelo: 'm' } }).pode).toBe(true);
  });

  it('ERR-659 (MIS-G-05): a linha que aparece mais de uma vez não diz qual trocar — fica de fora', () => {
    const repetida = ['Você é o Mister.', '- Responda curto.', '- Responda curto.', ''].join('\n');
    const r = aplicarTrocas(repetida, [{ id: 'x', sai: '- Responda curto.', entra: '- Responda curto, com os números.' }]);
    expect(r).toMatchObject({ texto: repetida, aplicadas: [], quebradas: ['x'] });
  });
});
