import { FalhaDaIa } from '../ia/ia-empresa.service';
import { FotoDoClienteService } from './foto-do-cliente.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A LEITURA DA FOTO DO CLIENTE (16/11/2026 — decisão do dono): o serviço com a IA e a mídia simuladas. NASCE DESLIGADO
// (só com ROBO_FOTOS_IA=1); só foto; a imagem vai inteira numa chamada só, pela porta da IA da empresa, com o recurso do
// medidor; qualquer falha = null (a foto segue para o atendente sem descrição) — nunca lança.
describe('a leitura da foto do cliente (serviço)', () => {
  const antes = { flag: process.env.ROBO_FOTOS_IA, edge: process.env.EDGE_MODE, modelo: process.env.ROBO_FOTOS_MODELO };
  afterEach(() => {
    for (const [k, v] of [['ROBO_FOTOS_IA', antes.flag], ['EDGE_MODE', antes.edge], ['ROBO_FOTOS_MODELO', antes.modelo]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  // O texto de uma consulta `sql` do drizzle (só os pedaços fixos), para o banco de mentira saber o que responder.
  const textoDaConsulta = (q: any) => (q?.queryChunks ?? []).flatMap((c: any) => (Array.isArray(c?.value) ? c.value : [])).join(' ');

  function montar(
    o: { resposta?: string; recusou?: boolean; falha?: any; mime?: string; bytes?: number; acesso?: boolean; lojaLe?: boolean; semVaga?: boolean; demoraMs?: number } = {},
  ) {
    const pedidos: any[] = [];
    const midias: any[] = [];
    const gravadas: string[] = [];
    // A chave da loja (mig 442: nasce desligada; aqui ligada salvo `lojaLe: false`) e a vaga do dia (F7).
    const db = {
      execute: async (q: any) => {
        const t = textoDaConsulta(q);
        if (/fotos_ler/.test(t)) return { rows: [{ ler: o.lojaLe !== false }] };
        if (/insert into robo_foto_lida/.test(t)) return { rows: o.semVaga ? [] : [{ lidas: 1 }] };
        if (/update robo_foto_lida/.test(t)) {
          gravadas.push(t);
          return { rows: [] };
        }
        return { rows: [] };
      },
    } as any;
    const ia = {
      temAcesso: async () => o.acesso !== false,
      pedir: async (tenantId: string, p: any) => {
        pedidos.push({ tenantId, p });
        if (o.demoraMs) await new Promise((r) => setTimeout(r, o.demoraMs));
        if (o.falha) throw o.falha;
        return { texto: o.resposta ?? '{"tipo":"tela_do_cardapio","descricao":"Tela do carrinho. Aviso: Pedido mínimo R$ 20,00."}', recusou: !!o.recusou };
      },
    } as any;
    const resposta = {
      midiaDoRegem: async (q: any) => (midias.push(q), { buffer: Buffer.alloc(o.bytes ?? 2048, 7), mime: o.mime ?? 'image/jpeg' }),
    } as any;
    return { svc: new FotoDoClienteService(ia, resposta, db), pedidos, midias, gravadas };
  }
  const foto = (x: any = {}) => ({
    tenantId: 't1',
    tipo: 'image',
    texto: 'não consigo finalizar',
    de: '5521999998888',
    phoneNumberId: 'PID',
    midiaId: 'M1',
    mensagemId: 'wamid.1',
    loja: { nome: 'Mister Burguer' },
    ...x,
  });

  // Fechar a foto (17/11/2026, mig 442): a chave da LOJA, o limite do dia (F7) e a descrição guardada para o caso (F5).
  it('a loja não ligou "Ler as fotos": nem baixa a mídia nem chama a IA (mesmo com a distribuição liberando)', async () => {
    process.env.ROBO_FOTOS_IA = '1';
    delete process.env.EDGE_MODE;
    const l = montar({ lojaLe: false });
    expect(l.svc.disponivel()).toBe(true);
    expect(await l.svc.olhar(foto())).toBeNull();
    expect(l.midias).toEqual([]);
    expect(l.pedidos).toEqual([]);
  });

  it('o limite do dia acabou: a IA não é chamada e a foto segue sem descrição', async () => {
    process.env.ROBO_FOTOS_IA = '1';
    delete process.env.EDGE_MODE;
    const l = montar({ semVaga: true });
    expect(await l.svc.olhar(foto())).toBeNull();
    expect(l.pedidos).toEqual([]);
    expect(l.gravadas).toEqual([]);
  });

  it('leu: a descrição fica guardada para o caso; fora do formato, nada se guarda', async () => {
    process.env.ROBO_FOTOS_IA = '1';
    delete process.env.EDGE_MODE;
    const l = montar();
    expect(await l.svc.olhar(foto())).not.toBeNull();
    expect(l.gravadas).toHaveLength(1);
    const ruim = montar({ resposta: 'não consigo ver' });
    expect(await ruim.svc.olhar(foto())).toBeNull();
    expect(ruim.gravadas).toEqual([]);
  });

  it('nasce desligado: sem ROBO_FOTOS_IA=1 não baixa a mídia nem chama a IA', async () => {
    delete process.env.ROBO_FOTOS_IA;
    delete process.env.EDGE_MODE;
    const l = montar();
    expect(l.svc.disponivel()).toBe(false);
    expect(await l.svc.olhar(foto())).toBeNull();
    expect(l.midias).toEqual([]);
    expect(l.pedidos).toEqual([]);
  });

  it('ligado: baixa a foto, manda UMA chamada com a imagem e a legenda, e devolve o tipo e a descrição', async () => {
    process.env.ROBO_FOTOS_IA = '1';
    delete process.env.EDGE_MODE;
    delete process.env.ROBO_FOTOS_MODELO;
    const l = montar();
    expect(await l.svc.olhar(foto())).toEqual({ tipo: 'tela_do_cardapio', descricao: 'Tela do carrinho. Aviso: Pedido mínimo R$ 20,00.' });
    expect(l.midias).toEqual([{ instancia: undefined, phoneNumberId: 'PID', mediaId: 'M1', mensagemId: 'wamid.1', jid: undefined }]);
    expect(l.pedidos).toHaveLength(1);
    const { tenantId, p } = l.pedidos[0];
    expect(tenantId).toBe('t1');
    expect(p).toMatchObject({ recurso: 'foto_do_cliente', modelo: 'claude-haiku-5-5', maxTokens: 2000 });
    expect(p.system).toContain('atendente da Mister Burguer');
    expect(p.messages[0].content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(p.messages[0].content[0].source.data).toBe(Buffer.alloc(2048, 7).toString('base64'));
    expect(p.messages[0].content[1]).toEqual({ type: 'text', text: 'Legenda que o cliente escreveu junto: "não consigo finalizar"' });
  });

  it('o prazo é TOTAL (G5a, LIC-035): a IA que passa dele não segura a foto — segue sem descrição, no prazo, e nada se guarda', async () => {
    process.env.ROBO_FOTOS_IA = '1';
    delete process.env.EDGE_MODE;
    const l = montar({ demoraMs: 1_500 });
    l.svc.prazos = { totalMs: 400, graphMs: 200, minimoDaIaMs: 50 };
    const inicio = Date.now();
    expect(await l.svc.olhar(foto())).toBeNull();
    expect(Date.now() - inicio).toBeLessThan(1_000);
    expect(l.pedidos).toHaveLength(1);
    expect(l.pedidos[0].p.prazoMs).toBeLessThanOrEqual(400);
    expect(l.gravadas).toEqual([]);
    // Sem o Graph, o prazo inteiro vai à IA (como hoje: 15 s).
    const padrao = montar();
    await padrao.svc.olhar(foto());
    expect(padrao.pedidos[0].p.prazoMs).toBeGreaterThan(14_900);
    expect(padrao.pedidos[0].p.prazoMs).toBeLessThanOrEqual(15_000);
    await new Promise((r) => setTimeout(r, 1_200)); // a resposta atrasada chega e é descartada sem erro
  });

  it('só foto: áudio, vídeo e documento não são lidos; no servidor da loja nunca', async () => {
    process.env.ROBO_FOTOS_IA = '1';
    delete process.env.EDGE_MODE;
    const l = montar();
    for (const tipo of ['audio', 'video', 'document', 'sticker', 'text']) expect(await l.svc.olhar(foto({ tipo }))).toBeNull();
    expect(l.midias).toEqual([]);
    process.env.EDGE_MODE = 'true';
    expect(l.svc.disponivel()).toBe(false);
    expect(await l.svc.olhar(foto())).toBeNull();
  });

  it('qualquer falha = null, sem lançar: sem IA para a empresa, tipo que o modelo não lê, foto grande demais, recusa, fora do formato, erro da IA e da mídia', async () => {
    process.env.ROBO_FOTOS_IA = '1';
    delete process.env.EDGE_MODE;
    const semAcesso = montar({ acesso: false });
    expect(await semAcesso.svc.olhar(foto())).toBeNull();
    expect(semAcesso.midias).toEqual([]); // nem baixa
    for (const o of [{ mime: 'image/heic' }, { bytes: 6 * 1024 * 1024 }, { bytes: 0 }]) {
      const l = montar(o);
      expect(await l.svc.olhar(foto())).toBeNull();
      expect(l.pedidos).toEqual([]); // a IA nem é chamada
    }
    expect(await montar({ recusou: true }).svc.olhar(foto())).toBeNull();
    expect(await montar({ resposta: 'não consigo ver' }).svc.olhar(foto())).toBeNull();
    expect(await montar({ falha: new FalhaDaIa('sem_credito', 'lojista', 400) }).svc.olhar(foto())).toBeNull();
    const semMidia = montar();
    (semMidia.svc as any).resposta.midiaDoRegem = async () => {
      throw new Error('mídia expirada');
    };
    expect(await semMidia.svc.olhar(foto())).toBeNull();
  });
});
