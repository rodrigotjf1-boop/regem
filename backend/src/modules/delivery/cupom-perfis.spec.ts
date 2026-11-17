import { AUMENTO_MAXIMO, CUPOM_PERFIS_PADRAO, perfilCustom, perfilEfetivo, subirNivelDaFonte } from './cupom-perfis';

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
    // Dono, 16/11/2026: a SENHA no alto (com o canal embaixo, no desenho); depois o "PEDIDO #10" em destaque.
    expect(ordem(p).slice(0, 5)).toEqual(['senha', 'nomeLoja', 'pedidoRegem', 'plataforma', 'tipoPedido']);
    expect(campo(p, 'pedidoRegem')).toMatchObject({ visivel: true, negrito: true, escala: 2 });
    expect(campo(p, 'plataforma').escala).toBeUndefined();
    expect(campo(p, 'senha')).toMatchObject({ visivel: true, negrito: true, escala: 2 });
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
    expect(keys.indexOf('tipoPedido')).toBe(keys.indexOf('plataforma') + 1);
    expect(keys.indexOf('pedidoRegem')).toBe(keys.indexOf('nomeLoja') + 1);
    expect(keys[keys.length - 1]).toBe('qrcode');
    expect(campo(p, 'troco')).toMatchObject({ negrito: true });
    // A observação do pedido (mig 346): o perfil já editado pela loja a recebe logo depois do endereço, em negrito.
    expect(keys.indexOf('observacao')).toBe(keys.indexOf('endereco') + 1);
    expect(campo(p, 'observacao')).toMatchObject({ visivel: true, negrito: true });
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
      // Balcão: a senha (a cozinha chama por ela). Delivery: o número do painel (dono, 28/10/2026).
      expect(visiveis[0]).toBe(id === 'producao_balcao' ? 'senha' : 'pedidoRegem');
      expect(visiveis).toContain('cliente');
      for (const k of ['endereco', 'telefone', 'totalGeral', 'subtotal', 'pagamento', 'troco', 'nomeLoja']) expect(visiveis).not.toContain(k);
      expect(campo(CUPOM_PERFIS_PADRAO[id], 'itens')).toMatchObject({ negrito: true, escala: 2, comp: { negrito: true } });
    }
    // O cabeçalho de identificação do delivery: o número do painel em destaque, o canal logo abaixo, o tipo; a senha
    // pequena (a do cartão do KDS).
    const pd = CUPOM_PERFIS_PADRAO.producao_delivery;
    expect(ordem(pd).slice(0, 3)).toEqual(['pedidoRegem', 'plataforma', 'tipoPedido']);
    expect(campo(pd, 'pedidoRegem')).toMatchObject({ visivel: true, negrito: true, escala: 2 });
    expect(campo(pd, 'senha')).toMatchObject({ visivel: true, mini: true });
    expect(campo(pd, 'senha').escala).toBeUndefined();
  });
});

// O CUPOM INTEIRO MAIOR (pedido do dono, 16/11/2026: "aumentar o cupom do caixa em 30%; os de produção estão muito
// pequenos, aumentar 150%"): a térmica só amplia em passos inteiros — cada linha sobe degraus da régua, até o Grande.
describe('perfis de cupom — o aumento do cupom inteiro', () => {
  const N = (mini: boolean, escala: number) => ({ mini, escala });
  const campo = (p: any, key: string) => p.campos.find((c: any) => c.key === key);
  const ordem = (p: any) => p.campos.map((c: any) => c.key);

  it('a régua: Normal sobe para Média (1 passo) e Grande (2); o que já é Grande ou maior fica; nunca diminui', () => {
    expect(subirNivelDaFonte(false, 1, 1)).toEqual(N(true, 2)); // Normal → Média (~+40%)
    expect(subirNivelDaFonte(false, 1, 2)).toEqual(N(false, 2)); // Normal → Grande (o dobro)
    expect(subirNivelDaFonte(true, 1, 2)).toEqual(N(true, 2)); // Pequena → Média
    expect(subirNivelDaFonte(true, 2, 2)).toEqual(N(false, 2)); // Média → Grande (o adicional não passa do item)
    expect(subirNivelDaFonte(false, 2, 2)).toEqual(N(false, 2)); // Grande fica
    expect(subirNivelDaFonte(false, 3, 2)).toEqual(N(false, 3)); // Enorme fica
    expect(subirNivelDaFonte(false, 4, 2)).toEqual(N(false, 4)); // 4× fica
    expect(subirNivelDaFonte(false, 1, 0)).toEqual(N(false, 1));
    expect(subirNivelDaFonte(false, 1, -3)).toEqual(N(false, 1));
    expect(subirNivelDaFonte(false, 1, NaN)).toEqual(N(false, 1));
    expect(subirNivelDaFonte(false, 1, 9)).toEqual(N(false, 2)); // no máximo 2 passos, até o Grande
    expect(AUMENTO_MAXIMO).toBe(2);
  });

  it('o padrão: o caixa 1 passo, a produção 2; o que a loja gravou vale (até o 0); sem nada gravado, o padrão', () => {
    expect(perfilEfetivo('caixa', null).aumento).toBe(1);
    for (const id of ['producao_balcao', 'producao_delivery', 'producao']) expect(perfilEfetivo(id, null).aumento).toBe(2);
    expect(perfilEfetivo('entregador', null).aumento).toBeUndefined();
    // a loja que gravou os campos e não o aumento (a loja de 16/11) recebe o padrão
    const gravados = { campos: [{ key: 'senha', visivel: true, negrito: true, alinhamento: 'centro' }, { key: 'itens', visivel: true }] } as any;
    expect(perfilEfetivo('producao_balcao', gravados).aumento).toBe(2);
    expect(perfilEfetivo('producao_balcao', { ...gravados, aumento: 0 }).aumento).toBe(0);
    expect(perfilEfetivo('producao_balcao', { ...gravados, aumento: 1 }).aumento).toBe(1);
    // só o aumento e as impressoras gravados (sem campos): o padrão inteiro com o aumento gravado
    const so = perfilEfetivo('caixa', { impressoras: ['imp-1'], aumento: 0 });
    expect(so).toMatchObject({ aumento: 0, impressoras: ['imp-1'] });
    expect(so.campos).toEqual(CUPOM_PERFIS_PADRAO.caixa.campos);
    // lixo gravado não vale: fica o padrão
    expect(perfilEfetivo('caixa', { aumento: 'muito' } as any).aumento).toBe(1);
    expect(perfilEfetivo('caixa', { aumento: 7 }).aumento).toBe(2);
    // o perfil personalizado guarda o seu
    expect(perfilCustom({ id: 'custom_1', campos: [{ key: 'itens', visivel: true }], aumento: 2 })?.aumento).toBe(2);
    expect(perfilCustom({ id: 'custom_1', campos: [{ key: 'itens', visivel: true }] })?.aumento).toBeUndefined();
  });

  it('o cupom do delivery: a senha no alto, visível, e a loja que gravou o perfil antes dela a recebe no alto também', () => {
    expect(campo(CUPOM_PERFIS_PADRAO.entregador, 'senha')).toMatchObject({ visivel: true, negrito: true, escala: 2 });
    // o perfil gravado da loja de 16/11: sem o campo da senha
    const daLoja = perfilEfetivo('entregador', {
      campos: ['nomeLoja', 'dataHora', 'ticket', 'plataforma', 'pedidoRegem', 'cliente', 'itens'].map((key) => ({ key, visivel: true })),
    } as any);
    expect(ordem(daLoja)[0]).toBe('senha');
    expect(campo(daLoja, 'senha').visivel).toBe(true);
    // quem escondeu a senha de propósito continua sem ela
    const escondida = perfilEfetivo('entregador', { campos: [{ key: 'senha', visivel: false }, { key: 'itens', visivel: true }] } as any);
    expect(campo(escondida, 'senha').visivel).toBe(false);
  });
});
