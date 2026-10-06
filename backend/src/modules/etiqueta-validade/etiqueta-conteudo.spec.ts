import { CAMPOS_PADRAO, dadosModerno, montarConteudoEtiqueta, nomeCurto, type DadosEtiqueta } from './etiqueta-conteudo';

// O TEXTO do job da etiqueta. Duas garantias: (1) o modelo clássico sai IGUAL ao de antes
// da migration 306; (2) os dados do moderno viajam dentro do cabeçalho, onde o servidor
// de loja antigo não os enxerga — ele continua imprimindo o clássico.

const dados: DadosEtiqueta = {
  loja: 'Mister Burguer Steakhouse',
  descricao: 'Kit blend',
  unidadeMedida: 'saco',
  tipoUso: 'FECHADO',
  fabricacao: '2026-08-27',
  compra: null,
  validade: '2026-09-10',
  codigo: '866855088746',
  hora: '18:40',
  responsavel: 'Rodrigo O.',
};
const carga = (conteudo: string) => {
  const m = /;v=2;d=([A-Za-z0-9_-]+)$/.exec(conteudo.split('\n')[0]);
  return m ? JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')) : null;
};
// A leitura do tamanho que o servidor de loja antigo faz no cabeçalho.
const tamanhoComoOAntigoLe = (conteudo: string) => /(\d+)\s*x\s*(\d+)/i.exec(conteudo.split('\n')[0])?.slice(1, 3).join('x');

describe('texto do job da etiqueta de validade', () => {
  it('clássico: sai igual ao de antes (modelo padrão, barras Code128)', () => {
    const t = montarConteudoEtiqueta({ campos: CAMPOS_PADRAO, tamanho: '60x40', codigoTipo: 'code128', modelo: 'classico' }, dados);
    expect(t).toBe(
      [
        '@ETIQUETA:60x40',
        'Mister Burguer Steakhouse',
        '@BKit blend',
        'Unid.: saco',
        'Fabricacao: 27/08/2026',
        'Status: FECHADO',
        '@BVALIDADE: 10/09/2026',
        '@BARCODE:code128:866855088746',
      ].join('\n'),
    );
  });

  it('modelo sem a coluna (servidor antes da 306) ou sem modelo salvo: clássico, sem carga', () => {
    for (const template of [null, undefined, {}, { tamanho: '40x40', codigoTipo: 'qr' }]) {
      const t = montarConteudoEtiqueta(template as any, dados);
      expect(t.split('\n')[0]).toMatch(/^@ETIQUETA:\d+x\d+$/);
    }
    expect(montarConteudoEtiqueta({ tamanho: '40x40', codigoTipo: 'qr' }, dados)).toContain('\n@QR:866855088746');
    expect(montarConteudoEtiqueta({ codigoTipo: 'nenhum' }, dados).split('\n').pop()).toBe('866855088746');
  });

  it('o campo Responsável, quando ligado, agora é impresso (antes saía vazio)', () => {
    const campos = CAMPOS_PADRAO.map((c) => (c.campo === 'responsavel' ? { ...c, visivel: true } : c));
    expect(montarConteudoEtiqueta({ campos }, dados)).toContain('\nResp.: Rodrigo O.');
    expect(montarConteudoEtiqueta({ campos: CAMPOS_PADRAO }, dados)).not.toContain('Resp.:');
    expect(montarConteudoEtiqueta({ campos }, { ...dados, responsavel: null })).not.toContain('Resp.:');
  });

  it('moderno: os dados vão no cabeçalho e o corpo continua clássico', () => {
    const t = montarConteudoEtiqueta({ campos: CAMPOS_PADRAO, tamanho: '60x40', codigoTipo: 'code128', modelo: 'moderno' }, dados);
    const linhas = t.split('\n');
    expect(linhas[0]).toMatch(/^@ETIQUETA:60x40;v=2;d=[A-Za-z0-9_-]+$/);
    // o que o servidor antigo usa: o tamanho, lido do começo da linha, e as linhas de sempre
    expect(tamanhoComoOAntigoLe(t)).toBe('60x40');
    expect(linhas.slice(1)).toEqual(
      montarConteudoEtiqueta({ campos: CAMPOS_PADRAO, tamanho: '60x40', codigoTipo: 'code128', modelo: 'classico' }, dados).split('\n').slice(1),
    );
    expect(carga(t)).toEqual({
      m: 'moderno', produto: 'Kit blend', manip: '27/08/2026', hora: '18:40', validade: '10/09/2026',
      codigo: '866855088746', cod: 'qr', loja: 'Mister Burguer Steakhouse', unidade: 'saco', status: 'FECHADO',
    });
  });

  it('moderno: só vai o que o modelo manda mostrar; lote e fornecedor vão quando existem', () => {
    const campos = CAMPOS_PADRAO.map((c) =>
      c.campo === 'responsavel' ? { ...c, visivel: true } : ['loja', 'unidade', 'status'].includes(c.campo) ? { ...c, visivel: false } : c,
    );
    const c1 = dadosModerno({ campos, codigoTipo: 'qr', modelo: 'moderno' }, { ...dados, lote: 'L2709', fornecedor: 'Heinz' });
    expect(c1).toMatchObject({ resp: 'Rodrigo O.', lote: 'L2709', fornecedor: 'Heinz' });
    expect(c1).not.toHaveProperty('loja');
    expect(c1).not.toHaveProperty('unidade');
    expect(c1).not.toHaveProperty('status');
    // fornecedor sem lote não vai sozinho; "Sem código" tira o QR
    const c2 = dadosModerno({ codigoTipo: 'nenhum', modelo: 'moderno' }, { ...dados, fornecedor: 'Heinz', hora: null });
    expect(c2).not.toHaveProperty('fornecedor');
    expect(c2).not.toHaveProperty('hora');
    expect(c2.cod).toBe('nenhum');
  });

  it('moderno: o tamanho continua legível para o servidor antigo com qualquer conteúdo', () => {
    for (const descricao of ['Pão 10x20 cm', 'Caixa 3 x 4', 'ÁGUA 500ml — "sem gás"', 'a'.repeat(200)]) {
      const t = montarConteudoEtiqueta({ tamanho: '100x50', modelo: 'moderno' }, { ...dados, descricao });
      expect(tamanhoComoOAntigoLe(t)).toBe('100x50');
      expect(t.split('\n')[0]).not.toMatch(/\s/);
      expect(carga(t).produto.length).toBeLessThanOrEqual(60);
    }
  });

  it('nome curto do responsável', () => {
    expect(nomeCurto('Rodrigo de Oliveira')).toBe('Rodrigo O.');
    expect(nomeCurto('  ana   paula souza ')).toBe('ana S.');
    expect(nomeCurto('Rodrigo')).toBe('Rodrigo');
    expect(nomeCurto('')).toBe('');
    expect(nomeCurto(null)).toBe('');
  });
});
