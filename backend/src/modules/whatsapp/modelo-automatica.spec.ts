import { WhatsappCloudService, CATALOGO_RELACIONAMENTO } from './whatsapp-cloud.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O MODELO DAS AUTOMÁTICAS NA API OFICIAL (Onda 3 · PR 2): o `cashback_vencendo` (utilidade) com o botão "Ver meu
// saldo" — na criação, a URL do redirect da automática; no envio, o id do envio no botão; o "Enviar à Meta" que não
// reenvia o que já foi pedido; e a categoria que a Meta DEU guardada (ela pode reclassificar a utilidade como marketing).
// Banco falso em memória — não depende de Postgres.

type Passo = any[];
/** Banco falso: cada `select` devolve o próximo passo da fila; guarda inserts e updates. */
function bancoFalso(selects: Passo[]) {
  const fila = [...selects];
  const inseridos: any[] = [];
  const atualizados: any[] = [];
  const consulta = () => {
    const p: any = Promise.resolve(fila.length ? fila.shift() : []);
    p.from = () => p;
    p.where = () => p;
    p.orderBy = () => p;
    p.limit = () => p;
    return p;
  };
  return {
    inseridos,
    atualizados,
    select: () => ({ from: () => consulta() }),
    insert: () => ({
      values: (v: any) => {
        inseridos.push(v);
        const p: any = Promise.resolve();
        p.returning = () => Promise.resolve([{ id: `tpl-${inseridos.length}` }]);
        p.onConflictDoNothing = () => p;
        return p;
      },
    }),
    update: () => ({
      set: (v: any) => {
        atualizados.push(v);
        return { where: () => Promise.resolve() };
      },
    }),
  } as any;
}

function servico(db: any) {
  const svc = new WhatsappCloudService(db);
  (svc as any).logger = { log() {}, warn() {}, error() {}, debug() {} };
  return svc;
}

describe('modelo das automáticas na API oficial', () => {
  const fetchOriginal = global.fetch;
  const envOriginal = { base: process.env.PUBLIC_API_BASE, token: process.env.WA_CLOUD_TOKEN };
  beforeEach(() => {
    process.env.PUBLIC_API_BASE = 'https://api.exemplo/api/v1';
    process.env.WA_CLOUD_TOKEN = 'token-falso';
  });
  afterEach(() => {
    global.fetch = fetchOriginal;
    for (const [k, v] of [['PUBLIC_API_BASE', envOriginal.base], ['WA_CLOUD_TOKEN', envOriginal.token]] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });

  it('o catálogo: cashback vencendo é UTILIDADE, com rodapé de saída, exemplos das 3 variáveis e sem convite para comprar', () => {
    const m = CATALOGO_RELACIONAMENTO.find((x) => x.nome === 'cashback_vencendo')!;
    expect(m.categoria).toBe('UTILITY');
    expect((m.corpo.match(/\{\{\d\}\}/g) ?? []).length).toBe(3);
    expect(m.exemplo).toHaveLength(3);
    expect(m.rodape).toBe('Para não receber estes avisos, responda SAIR.');
    expect(m.corpo).not.toMatch(/aproveite|use agora|corra|peça/i);
    expect(m.botoes).toEqual([{ tipo: 'beneficios', texto: 'Ver meu saldo' }]);
  });

  it('na criação, o botão "Ver meu saldo" aponta para o redirect da automática', () => {
    const svc = servico(bancoFalso([]));
    expect((svc as any).montarBotoesTemplate([{ tipo: 'beneficios', texto: 'Ver meu saldo' }])).toEqual([
      {
        type: 'URL',
        text: 'Ver meu saldo',
        url: 'https://api.exemplo/api/v1/publico/relacionamento/r/{{1}}',
        example: ['https://api.exemplo/api/v1/publico/relacionamento/r/exemplo'],
      },
    ]);
  });

  it('no envio, o botão leva o id do envio e o corpo as 3 variáveis', async () => {
    const linha = {
      tenantId: 't-1',
      waCloudPhoneId: 'PH-PRINCIPAL',
      corpo: 'Oi, {{1}}! Seu cashback de {{2}} na Loja vence em {{3}}. Ele é descontado no seu próximo pedido.',
      botoes: [{ tipo: 'beneficios', texto: 'Ver meu saldo' }],
      formato: 'padrao',
    };
    const db = bancoFalso([[linha], [linha]]);
    const svc = servico(db);
    let corpo: any = null;
    global.fetch = (async (_url: string, init: any) => {
      corpo = JSON.parse(init.body);
      return { ok: true, json: async () => ({ messages: [{ id: 'wamid.1' }] }) };
    }) as any;
    await svc.enviarTemplate('t-1', '5521987650001', 'cashback_vencendo', 'pt_BR', ['Marina', 'R$ 12,40', '06/11'], { envioId: 'envio-123', phoneId: 'PH-1' });
    expect(corpo.template.name).toBe('cashback_vencendo');
    expect(corpo.template.components).toEqual([
      { type: 'body', parameters: [{ type: 'text', text: 'Marina' }, { type: 'text', text: 'R$ 12,40' }, { type: 'text', text: '06/11' }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: 'envio-123' }] },
    ]);
  });

  it('"Enviar à Meta": cria do catálogo e submete; o que já foi pedido não reenvia; rascunho reenvia', async () => {
    // 1) não existe: cria (com rodapé, exemplos e o botão) e submete
    const novo = bancoFalso([[], [{ nomePublico: 'Burger da Praça', cidade: 'Niterói' }], [{ nome: 'Empresa X' }]]);
    const svc1 = servico(novo);
    const submetidos: string[] = [];
    (svc1 as any).submeterTemplate = async (_t: string, id: string) => void submetidos.push(id);
    expect(await svc1.garantirModeloRelacionamento('t-1', 'cashback_vencendo')).toBe('pendente');
    expect(novo.inseridos[0]).toMatchObject({
      nome: 'cashback_vencendo',
      categoria: 'UTILITY',
      cabecalho: 'Seu cashback',
      rodape: 'Para não receber estes avisos, responda SAIR.',
      exemplo: ['Marina', 'R$ 12,40', '06/11'],
      botoes: [{ tipo: 'beneficios', texto: 'Ver meu saldo' }],
      status: 'rascunho',
    });
    expect(novo.inseridos[0].corpo).toContain('na Burger da Praça vence em {{3}}');
    expect(submetidos).toEqual(['tpl-1']);

    // 2) já pedido (em análise): não reenvia
    const pedido = bancoFalso([[{ id: 'tpl-9', status: 'pendente' }]]);
    const svc2 = servico(pedido);
    (svc2 as any).submeterTemplate = async () => {
      throw new Error('não devia submeter');
    };
    expect(await svc2.garantirModeloRelacionamento('t-1', 'cashback_vencendo')).toBe('pendente');
    expect(pedido.inseridos).toHaveLength(0);

    // 3) rascunho (a submissão anterior falhou): submete o mesmo
    const rascunho = bancoFalso([[{ id: 'tpl-7', status: 'rascunho' }]]);
    const svc3 = servico(rascunho);
    const sub3: string[] = [];
    (svc3 as any).submeterTemplate = async (_t: string, id: string) => void sub3.push(id);
    await svc3.garantirModeloRelacionamento('t-1', 'cashback_vencendo');
    expect(sub3).toEqual(['tpl-7']);

    await expect(servico(bancoFalso([])).garantirModeloRelacionamento('t-1', 'outro')).rejects.toThrow('desconhecido');
  });

  it('a sincronização guarda a categoria que a Meta DEU (utilidade reclassificada como marketing)', async () => {
    const db = bancoFalso([]);
    const svc = servico(db);
    (svc as any).listarTemplates = async () => [
      { nome: 'cashback_vencendo', idioma: 'pt_BR', status: 'APPROVED', categoria: 'MARKETING' },
      { nome: 'pedido_pronto', idioma: 'pt_BR', status: 'APPROVED', categoria: 'UTILITY' },
    ];
    (svc as any).templatesLocais = async () => [
      { id: 'a', nome: 'cashback_vencendo', idioma: 'pt_BR', status: 'pendente', categoria: 'UTILITY' },
      { id: 'b', nome: 'pedido_pronto', idioma: 'pt_BR', status: 'aprovado', categoria: 'UTILITY' },
    ];
    await svc.sincronizarTemplates('t-1');
    expect(db.atualizados).toHaveLength(1); // o que não mudou não grava
    expect(db.atualizados[0]).toMatchObject({ status: 'aprovado', categoria: 'MARKETING' });
  });

  it('atualizar UM modelo: procura na WABA do principal e na do marketing e grava status, categoria e motivo', async () => {
    const db = bancoFalso([[{ id: 'a', nome: 'cashback_vencendo', idioma: 'pt_BR', status: 'pendente', categoria: 'UTILITY', motivoRejeicao: null }]]);
    const svc = servico(db);
    (svc as any).wabaDe = async (_t: string, papel: string) => (papel === 'principal' ? 'WABA-P' : 'WABA-M');
    const pedidos: string[] = [];
    global.fetch = (async (url: string) => {
      pedidos.push(url);
      const naP = url.includes('/WABA-P/');
      return {
        ok: true,
        json: async () => ({ data: naP ? [{ name: 'cashback_vencendo', language: 'pt_BR', status: 'REJECTED', category: 'UTILITY', rejected_reason: 'TAG_CONTENT_MISMATCH' }] : [] }),
      };
    }) as any;
    await svc.atualizarModelo('t-1', 'cashback_vencendo');
    expect(pedidos[0]).toContain('/WABA-P/message_templates?name=cashback_vencendo');
    expect(db.atualizados[0]).toMatchObject({ status: 'rejeitado', categoria: 'UTILITY', motivoRejeicao: 'TAG_CONTENT_MISMATCH' });
  });
});
