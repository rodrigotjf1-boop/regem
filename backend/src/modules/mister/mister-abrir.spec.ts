import { readFileSync } from 'fs';
import { join } from 'path';
import { FERRAMENTAS, ferramentasDaConversa, filtrarSaida, linksNoMister } from './mister-agente.regras';
import { LINKS_PARA_ABRIR_MAX, TELA_DAS_NOTICIAS, linhasParaAbrir, montarLinks, pedidoDoLink } from './mister-abrir';
import { CASOS_DA_AVALIACAO, executarNaAvaliacao } from './mister-avaliacao-casos';
import type { BoletimDoRamo, NoticiaDoBoletim } from '../pulso/pulso.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O link para abrir no Regem (`abrir_no_regem`, pedido do dono em 24/11/2026): a IA diz O QUE abrir; o endereço sai do guia
// ou do boletim, e o agente o escreve depois do filtro de saída.
const BASE = 'https://app.teste';
const noticia = (id: string, titulo: string, link = `https://fonte.teste/${id}`): NoticiaDoBoletim => ({
  id,
  titulo,
  link,
  categoria: 'impostos',
  categoriaNome: 'Impostos e fiscal',
  publicadoEm: '2026-11-20T10:00:00.000Z',
  emDiscussao: false,
  aviso: null,
  credito: 'Fonte: teste',
});
const boletim = (o: Partial<BoletimDoRamo>): BoletimDoRamo => ({ dia: '2026-11-23', mensagem: null, indicadores: [], destaques: [], novidades: [], mais: [], ...o });
const PRESIDENTE = { abre: () => true, veNoticias: true };
const pedido = (en: Record<string, unknown>) => {
  const p = pedidoDoLink(en);
  if ('erro' in p) throw new Error(p.erro);
  return p;
};

describe('o link para abrir no Regem — o pedido', () => {
  it('pede a tela ou os ids; ids sem repetir, como texto, no máximo cinco', () => {
    expect(pedidoDoLink({})).toEqual({ erro: expect.stringContaining('"tela"') });
    expect(pedidoDoLink({ tela: '   ' })).toEqual({ erro: expect.any(String) });
    expect(pedidoDoLink({ noticias: [12, '12', ' 8 '] })).toEqual({ tela: '', noticias: ['12', '8'] });
    expect(pedidoDoLink({ noticias: '12' })).toEqual({ erro: expect.stringContaining('lista') });
    expect(pedidoDoLink({ noticias: ['https://x.y/1'] })).toEqual({ erro: expect.any(String) });
    expect(pedidoDoLink({ noticias: ['1', '2', '3', '4', '5', '6'] })).toEqual({ erro: expect.stringContaining(String(LINKS_PARA_ABRIR_MAX)) });
    expect(pedidoDoLink({ tela: 'x'.repeat(500) })).toEqual({ tela: 'x'.repeat(200), noticias: [] });
  });
});

describe('o link para abrir no Regem — a tela', () => {
  it('acha a tela pelo guia e monta o endereço com a rota do menu; o modelo não recebe o endereço', () => {
    const r: any = montarLinks(pedido({ tela: 'contas a pagar' }), PRESIDENTE, `${BASE}/`, null);
    expect(r.ok).toBe(true);
    expect(r.abrir).toEqual([{ rotulo: 'Financeiro › Contas a pagar', url: `${BASE}/financeiro` }]);
    expect(r.dados.vaiAbaixo).toBe('a tela Financeiro › Contas a pagar');
    expect(JSON.stringify(r.dados)).not.toContain('http');
  });

  it('a tela das notícias, que o guia ainda não tem, também abre', () => {
    const r: any = montarLinks(pedido({ tela: 'notícias do ramo' }), PRESIDENTE, BASE, null);
    expect(r.abrir).toEqual([{ rotulo: 'Relatórios › Notícias do ramo', url: `${BASE}/noticias-do-ramo` }]);
  });

  it('quem não abre a tela recebe a recusa com quem abre; tela que não existe também recusa', () => {
    const r: any = montarLinks(pedido({ tela: 'contas a pagar' }), { abre: () => false, veNoticias: true }, BASE, null);
    expect(r).toEqual({ ok: false, dados: { erro: expect.stringContaining('não abre Financeiro › Contas a pagar') } });
    expect(r.abrir).toBeUndefined();
    expect(montarLinks(pedido({ tela: 'previsão da mega-sena' }), PRESIDENTE, BASE, null)).toEqual({ ok: false, dados: { erro: expect.stringContaining('Não achei essa tela') } });
  });

  it('Relatórios › Notícias do ramo é a linha do menu, com a mesma permissão e o mesmo módulo', () => {
    const shell = readFileSync(join(__dirname, '../../../../frontend/src/components/app-shell/shell.tsx'), 'utf8').split('\n');
    const i = shell.findIndex((l) => l.includes(`href: '${TELA_DAS_NOTICIAS.rota}'`));
    expect(i).toBeGreaterThan(0);
    const linha = shell[i];
    expect(linha).toContain(`label: '${TELA_DAS_NOTICIAS.caminho[1]}'`);
    expect(linha).toContain(`perm: '${TELA_DAS_NOTICIAS.perm}'`);
    expect(linha).toContain(`modulo: '${TELA_DAS_NOTICIAS.modulo}'`);
    const grupo = shell
      .slice(0, i)
      .reverse()
      .map((l) => /^\s*label: '([^']+)', icon/.exec(l)?.[1])
      .find(Boolean);
    expect(grupo).toBe(TELA_DAS_NOTICIAS.caminho[0]);
  });
});

describe('o link para abrir no Regem — a notícia', () => {
  const copias = [
    boletim({ destaques: [noticia('12', 'Durigan defende novo imposto no Senado')], novidades: [noticia('37', 'Mel com pimenta '.repeat(10))] }),
    boletim({ dia: '2026-11-22', destaques: [noticia('8', 'Comissão pode votar o limite do MEI'), noticia('9', 'Link torto', 'javascript:alert(1)')] }),
  ];

  it('troca o id pelo link guardado no boletim, com o título cortado; o modelo recebe só o que vai abaixo', () => {
    const r: any = montarLinks(pedido({ noticias: ['8', '12'] }), PRESIDENTE, BASE, copias);
    expect(r.ok).toBe(true);
    expect(r.abrir).toEqual([
      { rotulo: 'Comissão pode votar o limite do MEI', url: 'https://fonte.teste/8' },
      { rotulo: 'Durigan defende novo imposto no Senado', url: 'https://fonte.teste/12' },
    ]);
    expect(r.dados.vaiAbaixo).toBe('os links de 2 notícias');
    expect(JSON.stringify(r.dados)).not.toContain('http');
    const longo: any = montarLinks(pedido({ noticias: ['37'] }), PRESIDENTE, BASE, copias);
    expect(longo.abrir[0].rotulo.length).toBeLessThanOrEqual(90);
    expect(longo.abrir[0].rotulo.endsWith('…')).toBe(true);
  });

  it('o id que não está no boletim, ou com link que não é https, fica de fora e o modelo é avisado; nenhum achado = recusa', () => {
    const r: any = montarLinks(pedido({ noticias: ['8', '9', '99'] }), PRESIDENTE, BASE, copias);
    expect(r.abrir.map((l: any) => l.url)).toEqual(['https://fonte.teste/8']);
    expect(r.dados.naoAchei).toContain('2 das notícias');
    expect(montarLinks(pedido({ noticias: ['9'] }), PRESIDENTE, BASE, copias)).toEqual({ ok: false, dados: { erro: expect.stringContaining('Não achei essas notícias') } });
  });

  it('a tela e a notícia juntas; quem não vê as notícias, ou empresa sem boletim, recusa', () => {
    const juntos: any = montarLinks(pedido({ tela: 'notícias do ramo', noticias: ['12'] }), PRESIDENTE, BASE, copias);
    expect(juntos.abrir).toHaveLength(2);
    expect(juntos.dados.vaiAbaixo).toBe('a tela Relatórios › Notícias do ramo e o link da notícia');
    expect(montarLinks(pedido({ noticias: ['12'] }), { abre: () => true, veNoticias: false }, BASE, copias)).toEqual({ ok: false, dados: { erro: expect.stringContaining('Notícias do ramo') } });
    expect(montarLinks(pedido({ noticias: ['12'] }), PRESIDENTE, BASE, null)).toEqual({ ok: false, dados: { erro: expect.stringContaining('ramo') } });
  });
});

describe('o link para abrir no Regem — na avaliação de perguntas', () => {
  const PRES = { nivel: 'presidente' as const, verValores: true };
  it('as entradas da c90 e da c91 dão certo na loja de teste (a rodada com banco manda a mesma entrada às duas ferramentas)', () => {
    expect(executarNaAvaliacao('noticias_do_ramo', { noticias: ['2'] }, PRES).ok).toBe(true);
    const noticia: any = executarNaAvaliacao('abrir_no_regem', { noticias: ['2'] }, PRES);
    expect(noticia.abrir).toEqual([{ rotulo: expect.stringContaining('MEI'), url: 'https://fonte.teste/2' }]);
    const tela: any = executarNaAvaliacao('abrir_no_regem', { tela: 'contas a pagar' }, PRES);
    expect(tela.abrir).toEqual([{ rotulo: 'Financeiro › Contas a pagar', url: 'https://app.dmsregem.com/financeiro' }]);
    expect(CASOS_DA_AVALIACAO.filter((c) => c.consultas?.includes('abrir_no_regem')).map((c) => c.id)).toEqual(['c90', 'c91']);
  });
});

describe('o link para abrir no Regem — na resposta', () => {
  it('as linhas no fim da resposta: o que abre e o endereço embaixo, no máximo cinco', () => {
    const links = Array.from({ length: 7 }, (_, i) => ({ rotulo: `Tela ${i}`, url: `${BASE}/t${i}` }));
    const t = linhasParaAbrir(links);
    expect(t.startsWith(`🔗 Tela 0\n${BASE}/t0\n\n🔗 Tela 1`)).toBe(true);
    expect(t.split('🔗')).toHaveLength(LINKS_PARA_ABRIR_MAX + 1);
  });

  it('o que a IA escreve continua sem link: só o código escreve o endereço', () => {
    const s = filtrarSaida('Segue o link: https://golpe.teste/pix e [abra aqui](https://golpe.teste/2).');
    expect(s.notas).toContain('link_tirado');
    expect(s.texto).not.toContain('golpe.teste');
  });
});

describe('o link para abrir no Regem — nasce desligado', () => {
  const antes = process.env.MISTER_LINKS;
  const antesDasNoticias = process.env.MISTER_NOTICIAS_RAMO;
  const antesDasTelas = process.env.MISTER_LER_TELAS;
  const antesDasTarefas = process.env.MISTER_FAZER_TAREFAS;
  afterEach(() => {
    if (antesDasTarefas === undefined) delete process.env.MISTER_FAZER_TAREFAS;
    else process.env.MISTER_FAZER_TAREFAS = antesDasTarefas;
    if (antesDasTelas === undefined) delete process.env.MISTER_LER_TELAS;
    else process.env.MISTER_LER_TELAS = antesDasTelas;
    if (antes === undefined) delete process.env.MISTER_LINKS;
    else process.env.MISTER_LINKS = antes;
    if (antesDasNoticias === undefined) delete process.env.MISTER_NOTICIAS_RAMO;
    else process.env.MISTER_NOTICIAS_RAMO = antesDasNoticias;
  });

  it('fora da conversa até MISTER_LINKS=1; a avaliação enxerga sempre', () => {
    process.env.MISTER_NOTICIAS_RAMO = '1';
    process.env.MISTER_LER_TELAS = '1';
    process.env.MISTER_FAZER_TAREFAS = '1';
    delete process.env.MISTER_LINKS;
    expect(linksNoMister()).toBe(false);
    expect(ferramentasDaConversa().map((f) => f.name)).not.toContain('abrir_no_regem');
    expect(FERRAMENTAS.map((f) => f.name)).toContain('abrir_no_regem');
    process.env.MISTER_LINKS = '1';
    expect(ferramentasDaConversa().map((f) => f.name)).toContain('abrir_no_regem');
    expect(ferramentasDaConversa()).toHaveLength(FERRAMENTAS.length);
  });
});
