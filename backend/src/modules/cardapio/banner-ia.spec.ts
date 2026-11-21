import { ErroMcp, chaveIdempotenciaMcpValida } from '../../dms/integracao-dms';
import { GraphImagemService } from '../graph/graph-imagem.service';
import { BannerIaService } from './banner-ia.service';
import { conferirPedidoDoBanner, pedidoMelhorado, situacaoDoBanner, textoParaAImagem } from './banner-ia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O "CRIAR COM IA" DOS BANNERS (B2; mig 485) — as regras e o serviço, com o Graph, a IA e a mídia simulados. A resposta de
// `capacidades` tem a forma do `ferramenta-capacidades.mjs` do DMS Graph (contrato 1.4.0): a franquia de imagem mora em
// `franquias.imagem`.

const CHAVE = 'chave-do-clique-1';
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
const GIF = Buffer.from('GIF89a-resto');
const user: any = { tenantId: '11111111-1111-4111-8111-111111111111', colaboradorId: 'c1', categoria: 'presidente' };
const pronta = { ok: true, bytes: JPEG, mimeType: 'image/jpeg', franquia: { mes: '2026-11', usados: 3, total: 20 } };

function montar(o: { criar?: any; editar?: any; upload?: any; acesso?: boolean; pedir?: any } = {}) {
  const graph = {
    criarImagem: jest.fn(async () => o.criar ?? pronta),
    editarImagem: jest.fn(async () => o.editar ?? pronta),
    situacaoDaImagem: jest.fn(),
  };
  const ia = {
    temAcesso: jest.fn(async () => o.acesso ?? true),
    pedir: jest.fn(o.pedir ?? (async () => ({ texto: '"Hambúrguer duplo, luz quente"', recusou: false }))),
  };
  const midia = { uploadBuffer: jest.fn(o.upload ?? (async () => ({ url: 'https://midia.exemplo.test/b.jpg' }))) };
  const auditoria = { registrar: jest.fn(async () => undefined) };
  return { s: new BannerIaService(ia as any, midia as any, auditoria as any, graph as any), graph, ia, midia, auditoria };
}

describe('as regras do banner com IA', () => {
  it('confere o pedido: texto, chave do clique e os limites; no multipart o "true" chega como texto', () => {
    expect(() => conferirPedidoDoBanner({ chave: CHAVE })).toThrow('Escreva o que você quer no banner.');
    expect(() => conferirPedidoDoBanner({ pedido: 'x', chave: 'curta' })).toThrow('Pedido sem identificação');
    expect(() => conferirPedidoDoBanner({ pedido: 'x', chave: CHAVE, titulo: 'y'.repeat(61) })).toThrow('O título passa de 60 letras.');
    expect(() => conferirPedidoDoBanner({ pedido: 'x', chave: CHAVE, chamada: 'y'.repeat(91) })).toThrow('A chamada passa de 90 letras.');
    expect(conferirPedidoDoBanner({ pedido: '  a   b ', chave: CHAVE, textoPelaIa: 'true', titulo: ' T ' })).toEqual({
      pedido: 'a b',
      chave: CHAVE,
      textoPelaIa: true,
      titulo: 'T',
      chamada: null,
    });
    expect(conferirPedidoDoBanner({ pedido: 'a', chave: CHAVE, textoPelaIa: 'false' }).textoPelaIa).toBe(false);
  });

  it('por padrão a IA não escreve; com "A IA escreve", leva exatamente o título e a chamada; com foto, mantém o produto', () => {
    const base = { pedido: 'hambúrguer', chave: CHAVE, textoPelaIa: false, titulo: 'Sextou', chamada: 'Só hoje' };
    const semTexto = textoParaAImagem(base, false);
    expect(semTexto).toContain('Não escreva letras');
    expect(semTexto).not.toContain('Sextou');
    const comTexto = textoParaAImagem({ ...base, textoPelaIa: true }, false);
    expect(comTexto).toContain('exatamente: "Sextou" e "Só hoje"');
    expect(comTexto).not.toContain('Não escreva letras');
    expect(textoParaAImagem(base, true)).toContain('mantendo o produto real da foto');
    // "A IA escreve" sem nenhum texto: nada a escrever.
    expect(textoParaAImagem({ ...base, textoPelaIa: true, titulo: null, chamada: null }, false)).toContain('Não escreva letras');
  });

  it('o pedido melhorado sai sem aspas, no limite, e vazio vira nulo', () => {
    expect(pedidoMelhorado('  "Foto de hambúrguer"  ')).toBe('Foto de hambúrguer');
    expect(pedidoMelhorado('   ')).toBeNull();
    expect(pedidoMelhorado(null)).toBeNull();
    expect(String(pedidoMelhorado('palavra '.repeat(300))).length).toBeLessThanOrEqual(1000);
  });

  it('a situação decide: sem permissão, sem franquia, franquia acabou e pode', () => {
    const f = (usados: number, total: number, podeCriar = true, podeEditar = true) =>
      situacaoDoBanner({ ok: true, podeCriar, podeEditar, franquia: { usados, total } }, true);
    expect(f(0, 20, false, false)).toMatchObject({ pode: false, motivo: 'sem-permissao' });
    expect(f(0, 0)).toMatchObject({ pode: false, motivo: 'sem-franquia' });
    expect(f(20, 20)).toMatchObject({ pode: false, motivo: 'franquia-esgotada', franquia: { usados: 20, total: 20 } });
    expect(f(19, 20)).toMatchObject({ pode: true, motivo: null, mensagem: null });
    // Só editar liberado: pode criar a partir de uma foto.
    expect(f(1, 20, false, true)).toMatchObject({ pode: true, podeCriar: false, podeEditar: true });
    expect(situacaoDoBanner({ ok: false, motivo: 'sem-ligacao', mensagem: 'm' }, false)).toMatchObject({ pode: false, motivo: 'sem-ligacao', mensagem: 'm', franquia: null });
  });
});

describe('a leitura de capacidades pelo Graph', () => {
  const ENV: Record<string, string> = {
    GRAPH_LIGADO: 'true',
    GRAPH_MCP_URL: 'https://graph.exemplo.test/mcp',
    DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc',
    HUB_APLICATIVO: 'app-regem-teste',
    HUB_SEGREDO: 'segredo-de-teste-1234567',
  };
  const antes: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const k of [...Object.keys(ENV), 'GRAPH_EMPRESAS', 'EDGE_MODE']) antes[k] = process.env[k];
    Object.assign(process.env, ENV);
    delete process.env.GRAPH_EMPRESAS;
    delete process.env.EDGE_MODE;
  });
  afterAll(() => {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const comGraph = (chamar: any, ligacao: any = { id: 'l1', segredo: 'seg' }) => {
    const foto = { ligacaoParaFoto: jest.fn(async () => ligacao), cliente: jest.fn(() => ({ chamar })), marcarDesligadaPeloGraph: jest.fn(async () => undefined) };
    return { g: new GraphImagemService(foto as any), foto };
  };
  const RESPOSTA = {
    contrato: '1.4.0',
    permissoes: [
      { id: 'arquivos.analisar', concedida: true },
      { id: 'imagens.editar', concedida: true },
      { id: 'imagens.criar', concedida: false },
    ],
    franquias: { leitura: { mes: '2026-11', usados: 8, total: 500 }, imagem: { usados: 2, total: 20, unidade: 'imagens' }, video_ia: { usados: 0, total: 0 } },
  };

  it('lê a permissão e a franquia de imagem, como leitura e sem argumentos', async () => {
    const chamar = jest.fn(async () => RESPOSTA);
    const { g } = comGraph(chamar);
    expect(await g.situacaoDaImagem(user.tenantId)).toEqual({ ok: true, podeCriar: false, podeEditar: true, franquia: { usados: 2, total: 20 } });
    expect(chamar).toHaveBeenCalledWith('capacidades', {}, { leitura: true });
  });

  it('sem ligação não chama o Graph; resposta sem a franquia é "fora do formato"; ligação desfeita é marcada', async () => {
    const chamar = jest.fn(async () => RESPOSTA);
    expect(await comGraph(chamar, null).g.situacaoDaImagem(user.tenantId)).toMatchObject({ ok: false, motivo: 'sem-ligacao' });
    expect(chamar).not.toHaveBeenCalled();
    expect(await comGraph(jest.fn(async () => ({ permissoes: [] }))).g.situacaoDaImagem(user.tenantId)).toMatchObject({ ok: false, motivo: 'fora-do-formato' });
    const desfeita = comGraph(jest.fn(async () => { throw new ErroMcp({ tipo: 'ligacao', ferramenta: 'capacidades' } as any); }));
    expect(await desfeita.g.situacaoDaImagem(user.tenantId)).toMatchObject({ ok: false, motivo: 'ligacao-desfeita' });
    expect(desfeita.foto.marcarDesligadaPeloGraph).toHaveBeenCalledWith(user.tenantId, 'l1');
  });

  it('a chave do banner vira uma chave de idempotência válida na porta, e a mesma chave repete', async () => {
    const chamar = jest.fn(async (_f: string, _a: any) => ({ mimeType: 'image/jpeg', imagemBase64: JPEG.toString('base64') }));
    const { g } = comGraph(chamar);
    await g.criarImagem(user.tenantId, { descricao: 'd', proporcao: '16:9', chave: `banner:${CHAVE}` });
    await g.criarImagem(user.tenantId, { descricao: 'd', proporcao: '16:9', chave: `banner:${CHAVE}` });
    await g.criarImagem(user.tenantId, { descricao: 'd', proporcao: '16:9', chave: 'banner:outra-chave-2' });
    const chaves = chamar.mock.calls.map((c) => c[1].chaveIdempotencia);
    expect(chaves.every((c) => chaveIdempotenciaMcpValida(c))).toBe(true);
    expect(chaves[0]).toBe(chaves[1]);
    expect(chaves[2]).not.toBe(chaves[0]);
  });
});

describe('o serviço do banner com IA', () => {
  const corpo = { pedido: 'hambúrguer duplo', chave: CHAVE, titulo: 'Sextou' };

  it('sem foto cria em 16:9 e guarda na mídia da empresa; a auditoria não leva o pedido', async () => {
    const { s, graph, midia, auditoria } = montar();
    expect(await s.criar(user, corpo)).toEqual({ ok: true, imagemRef: 'https://midia.exemplo.test/b.jpg', franquia: { usados: 3, total: 20 } });
    expect(graph.criarImagem).toHaveBeenCalledWith(user.tenantId, expect.objectContaining({ proporcao: '16:9', chave: `banner:${CHAVE}` }));
    expect(graph.editarImagem).not.toHaveBeenCalled();
    expect(midia.uploadBuffer).toHaveBeenCalledWith(user.tenantId, JPEG);
    expect(JSON.stringify((auditoria.registrar.mock.calls as any[])[0])).not.toContain('hambúrguer');
  });

  it('com foto usa editar, pelo tipo lido do arquivo; GIF é recusado antes de gastar', async () => {
    const { s, graph } = montar();
    await s.criar(user, corpo, { buffer: JPEG });
    expect(graph.editarImagem).toHaveBeenCalledWith(user.tenantId, expect.objectContaining({ fotos: [{ buffer: JPEG, mime: 'image/jpeg' }], proporcao: '16:9' }));
    expect(graph.criarImagem).not.toHaveBeenCalled();
    const outro = montar();
    await expect(outro.s.criar(user, corpo, { buffer: GIF })).rejects.toThrow('A foto precisa ser JPG, PNG ou WebP.');
    expect(outro.graph.editarImagem).not.toHaveBeenCalled();
    expect(outro.graph.criarImagem).not.toHaveBeenCalled();
  });

  it('o motivo do Graph volta para a tela, sem guardar nada', async () => {
    const recusa = { ok: false, motivo: 'franquia-esgotada', mensagem: 'A franquia de imagem deste mês acabou. Ela volta no dia 1º.' };
    const { s, midia, auditoria } = montar({ criar: recusa });
    expect(await s.criar(user, corpo)).toEqual(recusa);
    expect(midia.uploadBuffer).not.toHaveBeenCalled();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('a imagem pronta que não foi guardada: avisa que repetir não gasta, e a repetição usa a mesma chave', async () => {
    const { s, graph } = montar({ upload: async () => { throw new Error('storage caiu'); } });
    await expect(s.criar(user, corpo)).rejects.toThrow('não gasta outra imagem');
    await expect(s.criar(user, corpo)).rejects.toThrow('não gasta outra imagem');
    const chaves = (graph.criarImagem.mock.calls as any[]).map((c) => c[1].chave);
    expect(chaves).toEqual([`banner:${CHAVE}`, `banner:${CHAVE}`]);
  });

  it('"Melhorar o pedido": pelo modelo de texto, com o pedido isolado; sem chave de IA ou com recusa, avisa', async () => {
    const { s, ia, graph } = montar();
    expect(await s.melhorar(user.tenantId, { pedido: 'hamburguer' })).toEqual({ pedido: 'Hambúrguer duplo, luz quente' });
    expect((ia.pedir.mock.calls as any[])[0][1].messages[0].content).toBe('<pedido>hamburguer</pedido>');
    expect(graph.criarImagem).not.toHaveBeenCalled();
    await expect(montar({ acesso: false }).s.melhorar(user.tenantId, { pedido: 'x' })).rejects.toThrow('Mister › IA e uso');
    await expect(montar({ pedir: async () => ({ texto: '', recusou: true }) }).s.melhorar(user.tenantId, { pedido: 'x' })).rejects.toThrow('Não deu para melhorar');
    await expect(montar({ pedir: async () => { throw new Error('caiu'); } }).s.melhorar(user.tenantId, { pedido: 'x' })).rejects.toThrow('Não deu para melhorar');
  });

  it('no servidor da loja fica desligado, sem chamar o Graph', async () => {
    const antes = process.env.EDGE_MODE;
    process.env.EDGE_MODE = 'true';
    try {
      const { s, graph } = montar();
      expect(await s.criar(user, corpo)).toMatchObject({ ok: false, motivo: 'desligado' });
      expect(await s.situacao(user.tenantId)).toMatchObject({ pode: false, motivo: 'desligado' });
      expect(graph.criarImagem).not.toHaveBeenCalled();
      expect(graph.situacaoDaImagem).not.toHaveBeenCalled();
    } finally {
      if (antes === undefined) delete process.env.EDGE_MODE;
      else process.env.EDGE_MODE = antes;
    }
  });
});
