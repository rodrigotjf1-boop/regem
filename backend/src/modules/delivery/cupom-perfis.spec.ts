import { CUPOM_PERFIS_PADRAO, perfilEfetivo } from './cupom-perfis';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A mescla do perfil PADRÃO do Regem com o que a loja gravou (pedido do dono, 22–23/10/2026: os padrões do Regem com
// destaque, a loja muda como quiser, e "Redefinir padrão" volta).
describe('perfis de cupom — padrão do Regem × o que a loja gravou', () => {
  const campo = (p: any, key: string) => p.campos.find((c: any) => c.key === key);
  const ordem = (p: any) => p.campos.map((c: any) => c.key);

  it('perfil nunca editado (ou redefinido, só com as impressoras) = o padrão do Regem inteiro', () => {
    const p = perfilEfetivo('entregador', { impressoras: ['imp-1'] });
    expect(ordem(p)).toEqual(ordem(CUPOM_PERFIS_PADRAO.entregador));
    expect(p.impressoras).toEqual(['imp-1']);
    expect(campo(p, 'senha')).toMatchObject({ negrito: true, escala: 2 });
    expect(campo(p, 'endereco')).toMatchObject({ negrito: true, mini: true, escala: 2 }); // destaque intermediário
    expect(campo(p, 'totalGeral')).toMatchObject({ negrito: true, escala: 2 }); // do tamanho da senha
    expect(campo(p, 'troco')).toMatchObject({ negrito: true, visivel: true });
    expect(perfilEfetivo('caixa', null).campos).toEqual(CUPOM_PERFIS_PADRAO.caixa.campos);
  });

  it('campo GRAVADO vale como gravado: tamanho ausente = normal (não volta ao grande do padrão)', () => {
    // O editor manda o campo inteiro e omite o tamanho "Normal" e as sublinhas sem estilo.
    const p = perfilEfetivo('producao_delivery', {
      campos: [
        { key: 'senha', visivel: true, negrito: false, alinhamento: 'esquerda' },
        { key: 'itens', visivel: true, negrito: false, alinhamento: 'esquerda' },
      ],
    });
    const senha = campo(p, 'senha');
    expect(senha.escala).toBeUndefined();
    expect(senha.negrito).toBe(false);
    expect(senha.alinhamento).toBe('esquerda');
    const itens = campo(p, 'itens');
    expect(itens.escala).toBeUndefined();
    expect(itens.comp).toBeUndefined(); // sem estilo próprio: o adicional sai no estilo do item
    expect(itens.obs).toBeUndefined();
    // "Grande" gravado (escala 2, sem mini) não vira "Média" (mini do padrão do endereço).
    const e = campo(perfilEfetivo('entregador', { campos: [{ key: 'endereco', visivel: true, negrito: true, alinhamento: 'esquerda', escala: 2 }] }), 'endereco');
    expect(e).toMatchObject({ escala: 2 });
    expect(e.mini).toBeUndefined();
  });

  it('campo novo do padrão entra LOGO DEPOIS do campo que o precede no padrão, com o estilo do padrão', () => {
    // Perfil gravado antes do campo "Troco" e do "Tipo do pedido" existirem, numa ordem própria da loja.
    const gravado = ['nomeLoja', 'senha', 'plataforma', 'cliente', 'endereco', 'itens', 'totalGeral', 'pagamento', 'qrcode'].map((key) => ({
      key,
      visivel: true,
      negrito: false,
      alinhamento: 'esquerda' as const,
    }));
    const p = perfilEfetivo('entregador', { campos: gravado });
    const keys = ordem(p);
    expect(keys.indexOf('troco')).toBe(keys.indexOf('pagamento') + 1); // não no fim, depois do QR
    expect(keys.indexOf('tipoPedido')).toBe(keys.indexOf('senha') + 1);
    expect(keys[keys.length - 1]).toBe('qrcode');
    expect(campo(p, 'troco')).toMatchObject({ negrito: true });
    // Os campos gravados ficam na ordem da loja.
    expect(keys.filter((k: string) => gravado.some((g) => g.key === k))).toEqual(gravado.map((g) => g.key));
  });

  it('campo do padrão sem nenhum anterior presente entra no começo; campo repetido ou desconhecido é ignorado', () => {
    const p = perfilEfetivo('producao_balcao', {
      campos: [
        { key: 'itens', visivel: true, negrito: true, alinhamento: 'esquerda' },
        { key: 'itens', visivel: true, negrito: false, alinhamento: 'centro' },
        { key: 'naoExiste', visivel: true },
      ],
    });
    const keys = ordem(p);
    expect(keys[0]).toBe('senha');
    expect(keys.filter((k: string) => k === 'itens')).toHaveLength(1);
    expect(campo(p, 'itens').negrito).toBe(true); // o primeiro gravado vale
    expect(keys).not.toContain('naoExiste');
  });

  it('itens nunca somem, e a linha divisória gravada logo depois deles continua ali (o campo novo entra depois dela)', () => {
    const p = perfilEfetivo('caixa', {
      campos: [
        { key: 'itens', visivel: false, negrito: false, alinhamento: 'esquerda' },
        { key: '_tracejado', visivel: true, negrito: false, alinhamento: 'centro' },
      ],
    });
    expect(campo(p, 'itens').visivel).toBe(true);
    const keys = ordem(p);
    expect(keys.indexOf('_tracejado')).toBe(keys.indexOf('itens') + 1);
    expect(keys.indexOf('subtotal')).toBe(keys.indexOf('_tracejado') + 1);
  });

  it('comprovante de cancelamento: o que o dono pediu à mostra no padrão (pedido, horário, motivo, quem, insumos)', () => {
    const visiveis = ordem({ campos: CUPOM_PERFIS_PADRAO.cancelamento.campos.filter((c) => c.visivel) });
    expect(visiveis).toEqual(
      expect.arrayContaining(['tipoMovimento', 'senha', 'plataforma', 'dataHora', 'motivo', 'atendente', 'autorizadoPor', 'destinoInsumos']),
    );
    expect(CUPOM_PERFIS_PADRAO.cancelamento.grupo).toBe('caixa');
  });

  it('padrão da via de produção: só o que importa, sem valores, endereço nem pagamento', () => {
    for (const id of ['producao_balcao', 'producao_delivery']) {
      const visiveis = ordem({ campos: CUPOM_PERFIS_PADRAO[id].campos.filter((c) => c.visivel) });
      expect(visiveis[0]).toBe('senha');
      expect(visiveis).toContain('cliente');
      for (const k of ['endereco', 'telefone', 'totalGeral', 'subtotal', 'pagamento', 'troco', 'nomeLoja']) expect(visiveis).not.toContain(k);
      expect(campo(CUPOM_PERFIS_PADRAO[id], 'itens')).toMatchObject({ negrito: true, escala: 2, comp: { negrito: true } });
    }
    // O cabeçalho de identificação do delivery: tipo e nº do pedido no canal.
    expect(ordem(CUPOM_PERFIS_PADRAO.producao_delivery)).toEqual(expect.arrayContaining(['tipoPedido', 'plataforma']));
  });
});
