import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { REQUIRE_PERM } from '../../auth/require-perm.decorator';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { CLOUD_ONLY_MODULES } from '../../edge-manifest';
import { ErroMcp, chaveIdempotenciaMcpValida, gerarChave } from '../../dms/integracao-dms';
import { DESCRICAO_MAX } from '../../common/foto-do-cliente';
import { GraphCliqueController } from './graph-clique.controller';
import {
  ENDERECO_PADRAO,
  analiseDoGraph,
  chaveDaFoto,
  codigoValido,
  franquiaDe,
  fraseDaVolta,
  lerConfigGraph,
  mimeDoGraph,
  motivoDaFalha,
  numeroValido,
  segredoValido,
  semDadoPessoal,
  tipoDoDocumento,
  voltaDoGraph,
} from './graph.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O DMS GRAPH NO REGEM (G5a; mig 450) — as peças sem banco: a configuração (nasce DESLIGADA), as formas do Graph (gph_),
// a chave de idempotência da foto (G-5), a tradução do resultado para a análise de hoje, e as rotas do clique com o RBAC
// no servidor (GR-2: só o presidente liga e desliga).

const ENV = {
  GRAPH_LIGADO: 'true',
  GRAPH_MCP_URL: 'https://graph.exemplo.test/mcp',
  DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc',
  HUB_APLICATIVO: 'app-regem-teste',
  HUB_SEGREDO: 'segredo-de-teste-1234567',
};

describe('o DMS Graph — a configuração (GRAPH_LIGADO nasce desligado)', () => {
  it('só o valor exato "true" liga; sem a credencial do DMS ID, nem ligado', () => {
    expect(lerConfigGraph(ENV)).toMatchObject({ ligado: true, credencialOk: true, origem: 'https://graph.exemplo.test', recurso: ENV.GRAPH_MCP_URL });
    for (const v of [undefined, '', 'TRUE', '1', 'sim', ' true']) expect(lerConfigGraph({ ...ENV, GRAPH_LIGADO: v }).ligado).toBe(false);
    const sem = lerConfigGraph({ ...ENV, HUB_SEGREDO: 'curto' });
    expect([sem.ligado, sem.credencialOk]).toEqual([false, false]);
    expect(sem.motivo).toMatch(/HUB_SEGREDO/);
    expect(lerConfigGraph({ ...ENV, DMS_ID_EMISSOR: '' }).motivo).toMatch(/DMS_ID_EMISSOR/);
  });

  it('o endereço: o padrão de produção; https terminando em /mcp; a máquina local só fora de produção (V68)', () => {
    expect(lerConfigGraph({ ...ENV, GRAPH_MCP_URL: undefined }).endereco).toBe(ENDERECO_PADRAO);
    expect(lerConfigGraph({ ...ENV, GRAPH_MCP_URL: 'https://graph.exemplo.test/mcp/' }).endereco).toBe('https://graph.exemplo.test/mcp');
    for (const torto of [
      'http://graph.exemplo.test/mcp',
      'https://graph.exemplo.test/outra',
      'https://usuario:senha@graph.exemplo.test/mcp',
      'https://graph.exemplo.test/mcp?x=1',
      'não é endereço',
    ])
      expect(lerConfigGraph({ ...ENV, GRAPH_MCP_URL: torto }).credencialOk).toBe(false);
    expect(lerConfigGraph({ ...ENV, GRAPH_MCP_URL: 'http://127.0.0.1:4173/mcp' }).credencialOk).toBe(true);
    for (const interno of ['http://127.0.0.1:4173/mcp', 'https://localhost/mcp', 'https://10.0.0.5/mcp', 'https://169.254.169.254/mcp'])
      expect(lerConfigGraph({ ...ENV, NODE_ENV: 'production', GRAPH_MCP_URL: interno }).credencialOk).toBe(false);
    expect(lerConfigGraph({ ...ENV, NODE_ENV: 'production' }).credencialOk).toBe(true);
  });

  it('a volta do Regem é a que o Graph aceita por padrão; APP_URL vazio cai no padrão (V58)', () => {
    expect(voltaDoGraph({})).toBe('https://app.dmsregem.com/integracoes/graph/volta');
    expect(voltaDoGraph({ APP_URL: '' })).toBe('https://app.dmsregem.com/integracoes/graph/volta');
    expect(voltaDoGraph({ APP_URL: 'https://teste.exemplo/' })).toBe('https://teste.exemplo/integracoes/graph/volta');
  });
});

describe('o DMS Graph — as formas (gph_, gph_ac_, dms_lg_graph_)', () => {
  it('o número do pedido e o código do Graph; os do Orzuni não', () => {
    expect(numeroValido(`urn:ietf:params:oauth:request_uri:gph_${'b'.repeat(43)}`)).toBe(true);
    expect(numeroValido(`urn:ietf:params:oauth:request_uri:orz_${'b'.repeat(43)}`)).toBe(false);
    expect(codigoValido(`gph_ac_${'a'.repeat(43)}`)).toBe(true);
    expect(codigoValido(`orz_ac_${'a'.repeat(43)}`)).toBe(false);
  });

  it('o segredo da ligação: só o dms_lg_graph_ com os dígitos de conferência (pacote 0.11.0)', () => {
    expect(segredoValido(gerarChave('lg', 'graph').chave)).toBe(true);
    expect(segredoValido(gerarChave('lg', 'orzuni').chave)).toBe(false);
    expect(segredoValido(gerarChave('ap', 'graph').chave)).toBe(false);
    const g = gerarChave('lg', 'graph').chave;
    expect(segredoValido(`${g.slice(0, -1)}${g.endsWith('A') ? 'B' : 'A'}`)).toBe(false);
  });

  it('as frases da volta não citam botão nem caminho de menu (as telas esperam o protótipo)', () => {
    for (const m of ['access_denied', 'vencido', 'outra_sessao', 'emissor', 'desligado', 'erro'] as const) {
      expect(fraseDaVolta(m)).toMatch(/DMS Graph|pedido/);
      expect(fraseDaVolta(m)).not.toMatch(/›|"Conectar/);
    }
  });
});

describe('o DMS Graph — a foto', () => {
  const bytes = Buffer.from('foto de teste');

  it('a chave de idempotência (G-5): a mesma mensagem dá sempre a mesma chave; outra mensagem ou outra empresa, outra', () => {
    const a = chaveDaFoto('t1', 'wamid.ABC', bytes);
    expect(a).toBe(chaveDaFoto('t1', 'wamid.ABC', Buffer.from('outros bytes')));
    expect(a).not.toBe(chaveDaFoto('t1', 'wamid.XYZ', bytes));
    expect(a).not.toBe(chaveDaFoto('t2', 'wamid.ABC', bytes));
    expect(chaveIdempotenciaMcpValida(a)).toBe(true);
    // Sem o id da mensagem: pelos bytes (a mesma foto, a mesma chave).
    const semId = chaveDaFoto('t1', undefined, bytes);
    expect(semId).toBe(chaveDaFoto('t1', '', bytes));
    expect(semId).not.toBe(chaveDaFoto('t1', undefined, Buffer.from('outra')));
    expect(chaveIdempotenciaMcpValida(semId)).toBe(true);
  });

  it('o tipo que vai ao Graph: JPG, PNG e WebP; o GIF segue pela IA da empresa', () => {
    expect(mimeDoGraph('image/jpeg; charset=x')).toBe('image/jpeg');
    expect(mimeDoGraph('image/jpg')).toBe('image/jpeg');
    expect(mimeDoGraph('image/png')).toBe('image/png');
    expect(mimeDoGraph('image/webp')).toBe('image/webp');
    expect(mimeDoGraph('image/gif')).toBeNull();
    expect(mimeDoGraph('image/heic')).toBeNull();
  });

  it('a franquia: só o bloco certo { mes, usados, total }', () => {
    expect(franquiaDe({ mes: '2026-11', usados: 87, total: 500 })).toEqual({ mes: '2026-11', usados: 87, total: 500 });
    for (const torta of [null, {}, { mes: '11/2026', usados: 1, total: 2 }, { mes: '2026-11', usados: -1, total: 2 }, { mes: '2026-11', usados: '1', total: 2 }])
      expect(franquiaDe(torta)).toBeNull();
  });

  it('a tradução: o comprovante vira o caminho do comprovante, sem nada do conteúdo (nem Pix, nem valor)', () => {
    const r = analiseDoGraph({
      tipoArquivo: 'imagem',
      resultados: [
        {
          tipo: 'Comprovante de transferência Pix',
          titulo: 'Banco X',
          contexto: 'Comprovante de Pix de R$ 45,90 para Mister Burguer, CPF 123.456.789-00.',
          transcricao: 'Pix enviado',
          pix: { codigo: '00020126…' },
          linhaDigitavel: null,
        },
      ],
      franquia: { mes: '2026-11', usados: 1, total: 500 },
    });
    expect(r).toEqual({ tipo: 'comprovante', descricao: 'comprovante de pagamento' });
    // Pelo contexto, quando o nome do tipo não diz (o "Pix enviado" decide).
    expect(tipoDoDocumento({ tipo: 'Captura', titulo: '', contexto: 'Tela do banco com o Pix enviado com sucesso.' })).toBe('comprovante');
  });

  it('a tradução: o print do cardápio leva o resumo e os avisos da tela; a tela que pede o comprovante NÃO é comprovante', () => {
    const r = analiseDoGraph({
      tipoArquivo: 'imagem',
      resultados: [
        {
          tipo: 'Captura de tela',
          titulo: 'Carrinho do cardápio online',
          contexto: 'Tela do carrinho com dois hambúrgueres e o botão de finalizar.',
          secoes: [{ titulo: 'Rodapé', texto: 'Pedido mínimo de R$ 20,00 não atingido' }],
          transcricao: 'Hambúrguer R$ 15,00\nErro: endereço fora da área de entrega\nApós pagar, envie o comprovante',
        },
      ],
    });
    expect(r?.tipo).toBe('tela_do_cardapio');
    expect(r?.descricao).toBe(
      'Tela do carrinho com dois hambúrgueres e o botão de finalizar. Na tela: "Pedido mínimo de R$ 20,00 não atingido" / "Erro: endereço fora da área de entrega"',
    );
  });

  it('a tradução: a foto do pedido recebido; outra coisa; vazio = "imagem ilegível"; fora do formato = null (segue pela IA)', () => {
    expect(analiseDoGraph({ resultados: [{ tipo: 'Fotografia', titulo: 'Hambúrguer na embalagem', contexto: 'Um hambúrguer amassado, sem a batata.' }] })).toEqual({
      tipo: 'pedido_recebido',
      descricao: 'Um hambúrguer amassado, sem a batata.',
    });
    expect(analiseDoGraph({ resultados: [{ tipo: 'Fotografia', titulo: 'Fachada', contexto: 'A fachada de um prédio.' }] })).toEqual({
      tipo: 'outro',
      descricao: 'A fachada de um prédio.',
    });
    expect(analiseDoGraph({ tipoArquivo: 'imagem', resultados: [] })).toEqual({ tipo: 'outro', descricao: 'imagem ilegível' });
    for (const torto of [null, 'texto', [], { resultados: 'x' }, {}]) expect(analiseDoGraph(torto)).toBeNull();
  });

  it('a tradução: sem dado pessoal, sem colchete nem link, e no tamanho de sempre', () => {
    const r = analiseDoGraph({
      resultados: [
        {
          tipo: 'Fotografia',
          titulo: 'Pedido',
          contexto: `Lanche entregue para ana@exemplo.com, telefone (21) 98765-4321, pedido #4471 às 20:45 [ver https://x.test/a] ${'x'.repeat(600)}`,
        },
      ],
    });
    expect(r?.tipo).toBe('pedido_recebido');
    expect(r?.descricao).not.toMatch(/ana@exemplo|98765|https?:|\[|\]/);
    expect(r?.descricao).toContain('(e-mail omitido)');
    expect(r?.descricao).toContain('(número omitido)');
    expect(r?.descricao).toContain('#4471 às 20:45');
    expect(r!.descricao.length).toBeLessThanOrEqual(DESCRICAO_MAX);
    expect(semDadoPessoal('R$ 1.234,56 em 18/11/2026')).toBe('R$ 1.234,56 em 18/11/2026');
    expect(semDadoPessoal('CNPJ 12.345.678/0001-90')).toBe('CNPJ (número omitido)');
  });

  it('o motivo de não ter lido: o código da recusa, a franquia esgotada, a parada; nunca o conteúdo', () => {
    const franquia = new ErroMcp({ tipo: 'ferramenta', ferramenta: 'analisar_arquivo', frase: 'A franquia acabou', dados: { situacao: 'recusado', codigo: 'limite-de-chamadas', limite: 'franquia_mensal' } });
    expect(motivoDaFalha(franquia)).toBe('franquia-esgotada');
    const vaga = new ErroMcp({ tipo: 'ferramenta', ferramenta: 'analisar_arquivo', dados: { codigo: 'limite-de-chamadas', limite: 'analises_simultaneas' } });
    expect(motivoDaFalha(vaga)).toBe('recusada:limite-de-chamadas');
    expect(motivoDaFalha(new ErroMcp({ tipo: 'ferramenta', ferramenta: 'analisar_arquivo', dados: { codigo: 'chave-em-uso' } }))).toBe('recusada:chave-em-uso');
    expect(motivoDaFalha(new ErroMcp({ tipo: 'indisponivel', ferramenta: 'analisar_arquivo', problema: 'integracao-parada' }))).toBe('integracao-parada');
    expect(motivoDaFalha(new ErroMcp({ tipo: 'sem-resposta', ferramenta: 'analisar_arquivo' }))).toBe('sem-resposta');
    expect(motivoDaFalha(new Error('qualquer'))).toBe('erro');
  });
});

describe('o DMS Graph — as rotas do clique (RBAC no servidor, GR-2)', () => {
  const rota = (nome: string) => (GraphCliqueController.prototype as any)[nome];

  it('login, perfil e permissão em toda rota; ligar, concluir e desligar só o presidente e só na nuvem', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, GraphCliqueController)).toEqual([JwtAuthGuard, RolesGuard, PermissoesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, rota('situacao'))).toEqual(['presidente', 'gerente']);
    for (const nome of ['iniciar', 'concluir', 'desligar']) {
      expect(Reflect.getMetadata(ROLES_KEY, rota(nome))).toEqual(['presidente']);
      expect(Reflect.getMetadata(CLOUD_ONLY, rota(nome))).toBe(true);
    }
    for (const nome of ['situacao', 'iniciar', 'concluir', 'desligar']) expect(Reflect.getMetadata(REQUIRE_PERM, rota(nome))).toEqual({ modulo: 'delivery' });
    expect(CLOUD_ONLY_MODULES).toContain('GraphModule');
  });

  it('o guarda de verdade: o gerente (e o suporte) recebem 403 em ligar e desligar; o presidente passa; o gerente vê a situação', () => {
    const guarda = new RolesGuard(new Reflector());
    const contexto = (nome: string, categoria: string) =>
      ({ getHandler: () => rota(nome), getClass: () => GraphCliqueController, switchToHttp: () => ({ getRequest: () => ({ user: { categoria } }) }) }) as any;
    for (const nome of ['iniciar', 'concluir', 'desligar'])
      for (const categoria of ['gerente', 'suporte', 'supervisao', 'execucao']) {
        let erro: any = null;
        try {
          guarda.canActivate(contexto(nome, categoria));
        } catch (e) {
          erro = e;
        }
        expect(erro).toBeInstanceOf(ForbiddenException);
        expect(erro.getStatus()).toBe(403);
      }
    for (const nome of ['iniciar', 'concluir', 'desligar', 'situacao']) expect(guarda.canActivate(contexto(nome, 'presidente'))).toBe(true);
    expect(guarda.canActivate(contexto('situacao', 'gerente'))).toBe(true);
  });
});
