import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ComprovanteDoClienteService, INSISTENCIA_DO_COMPROVANTE_MS } from './comprovante-do-cliente.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O COMPROVANTE DO CLIENTE DE PONTA A PONTA contra o Postgres real (16/11/2026 — pedido do dono): os pedidos de verdade na
// tabela (achados pela CHAVE do telefone), o provedor do Pix, o envio e a central de atendimento simulados. Cada situação
// que o dono descreveu: "mandar uma mensagem positiva", "ver se o pedido chegou e está pago", "se não estiver, verificar as
// possibilidades, ver se ele colocou o número de telefone correto".
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('comprovante-do-cliente-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('o comprovante que o cliente manda (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const empresas: string[] = [];
  const AGORA = new Date();

  // A loja de teste e as três pontas simuladas (cada teste tem a sua: a memória do serviço não vaza de um para o outro).
  async function montar(o: { aprovaNoProvedor?: boolean; enviado?: boolean; equipe?: any; leitura?: any } = {}) {
    const T = (await q(`insert into empresa (nome) values ('teste comprovante') returning id`))[0].id as string;
    empresas.push(T);
    const token = `tok-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico) values ($1, null, $2, true, 'Loja')`, [T, token]);
    const enviados: string[] = [];
    const casos: any[] = [];
    const consultas: string[] = [];
    const cardapio = {
      verificarPagamentoPublico: async (_t: string, id: string) => {
        consultas.push(id);
        if (!o.aprovaNoProvedor) return { pago: false, statusPagamento: 'aguardando', status: 'novo' };
        await q(`update pedido_externo set pago = true, status_pagamento = 'aprovado', status = 'confirmado' where id = $1`, [id]);
        return { pago: true, statusPagamento: 'aprovado', status: 'confirmado' };
      },
    } as any;
    const resposta = { responderDoRegem: async (p: any) => (o.enviado === false ? { ok: true, enviado: false, motivo: 'robo_desligado' } : (enviados.push(p.texto), { ok: true, enviado: true })) } as any;
    const atendimento = { abrirPeloRobo: async (t: string, u: any, d: any) => (casos.push({ t, u, d }), o.equipe ?? { ok: true, id: 'c1', posicao: 1, comAlguem: false }) } as any;
    // A leitura da foto por IA (`foto-do-cliente.service.ts`), simulada: `leitura` = o que ela "viu" (sem ela, desligada).
    const olhadas: any[] = [];
    const leitor = o.leitura === undefined ? undefined : ({ olhar: async (m: any) => (olhadas.push(m.tipo), o.leitura) } as any);
    const svc = new ComprovanteDoClienteService(db, cardapio, resposta, atendimento, leitor);
    const pedido = async (displayId: string, telefone: string, x: { status?: string; sp?: string | null; pago?: boolean; gateway?: string | null; min?: number; nome?: string; tipo?: string } = {}) =>
      (
        await q(
          `insert into pedido_externo (tenant_id, canal, client_ref, display_id, cliente_nome, cliente_telefone, tipo, itens, total, forma_pagamento, status,
                                       status_pagamento, pago, gateway_payment_id, criado_em)
           values ($1,'cardapio',$2,$3,$4,$5,$6,'[]'::jsonb,30,'pix',$7,$8,$9,$10, now() - make_interval(mins => $11)) returning id`,
          [T, `ref-${randomUUID()}`, displayId, x.nome ?? 'Maria Souza', telefone, x.tipo ?? 'entrega', x.status ?? 'confirmado',
            x.sp === undefined ? 'aprovado' : x.sp, x.pago ?? true, x.gateway === undefined ? `pay-${randomUUID()}` : x.gateway, x.min ?? 5],
        )
      )[0].id as string;
    const foto = (o2: any = {}) => ({ tenantId: T, cardapioToken: token, phoneNumberId: 'PID', de: '5521987654321', nome: 'Maria', tipo: 'image', texto: '', ...o2 });
    return { T, token, svc, enviados, casos, consultas, pedido, foto, olhadas };
  }

  afterAll(async () => {
    for (const t of ['pedido_externo', 'cardapio_config']) await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
    await q('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    await pool.end();
  });

  it('pago e em produção: a foto SEM legenda ganha a mensagem positiva e não vai ao robô; a 2ª foto em seguida não repete', async () => {
    const l = await montar();
    await l.pedido('4471', '21987654321');
    expect(await l.svc.decidir(l.foto(), [], AGORA)).toBe('respondido');
    expect(l.enviados).toEqual(['✅ *Pagamento confirmado*, Maria!\nSeu pedido nº 4471 já está em produção 👨‍🍳.\nObrigado pela preferência 🙌']);
    expect(l.casos).toEqual([]);
    expect(l.consultas).toEqual([]); // já estava pago: não precisa consultar o provedor
    expect(await l.svc.decidir(l.foto(), [], new Date(AGORA.getTime() + 5_000))).toBe('respondido');
    expect(l.enviados).toHaveLength(1);
  });

  it('Pix esperando e o provedor confirma NA HORA: a positiva (o pedido entra em produção)', async () => {
    const l = await montar({ aprovaNoProvedor: true });
    const id = await l.pedido('4472', '+55 (21) 98765-4321', { status: 'novo', sp: 'aguardando', pago: false });
    expect(await l.svc.decidir(l.foto(), [], AGORA)).toBe('respondido');
    expect(l.consultas).toEqual([id]);
    expect(l.enviados[0]).toContain('✅ *Pagamento confirmado*, Maria!\nSeu pedido nº 4472 já está em produção');
    expect(l.casos).toEqual([]);
  });

  it('Pix esperando e o provedor NÃO confirma: avisa sem prometer; o comprovante de novo depois de 2 min chama a equipe', async () => {
    const l = await montar();
    await l.pedido('4473', '21987654321', { status: 'novo', sp: 'aguardando', pago: false });
    expect(await l.svc.decidir(l.foto({ texto: 'paguei' }), [], AGORA)).toBe('respondido');
    expect(l.enviados[0]).toContain('O pagamento do pedido nº 4473 ainda não apareceu por aqui');
    expect(l.casos).toEqual([]);
    const depois = new Date(AGORA.getTime() + INSISTENCIA_DO_COMPROVANTE_MS + 1_000);
    expect(await l.svc.decidir(l.foto(), [], depois)).toBe('respondido');
    expect(l.consultas).toHaveLength(2); // consultou de novo antes de chamar
    expect(l.casos).toHaveLength(1);
    expect(l.casos[0].d).toMatchObject({ tipo: 'outro', telefone: '5521987654321', pedidoNumero: '4473', prioridade: 'normal' });
    expect(l.casos[0].d.resumo).toMatchObject({ motivo: expect.stringContaining('não confirmou no provedor'), quer: 'confirmar o pagamento' });
    expect(l.enviados[1]).toBe('O pagamento do pedido nº 4473 ainda não confirmou por aqui.\nJá chamei a equipe para conferir e te respondem por aqui. Você é o 1º da fila.');
  });

  it('pedido para pagar na entrega + comprovante: a equipe confere (para o entregador não cobrar de novo)', async () => {
    const l = await montar();
    await l.pedido('4474', '21987654321', { sp: 'na_entrega', pago: false, gateway: null });
    expect(await l.svc.decidir(l.foto(), [], AGORA)).toBe('segue'); // sem falar de pagamento, a foto não é comprovante
    expect(await l.svc.decidir(l.foto({ texto: 'segue o comprovante do pix' }), [], AGORA)).toBe('respondido');
    expect(l.casos[0].d.resumo.motivo).toContain('está para pagar na entrega');
    expect(l.enviados[0]).toContain('está marcado para *pagar na entrega*');
  });

  it('pedido cancelado sem pagamento confirmado: caso URGENTE; fora do horário, a frase da loja no lugar do "já chamei"', async () => {
    const l = await montar({ equipe: { ok: true, id: 'c9', posicao: null, comAlguem: false, foraDoHorario: true, paraOCliente: 'Nossa equipe volta às 18h. Seu recado ficou guardado.' } });
    await l.pedido('4475', '21987654321', { status: 'cancelado', sp: 'aguardando', pago: false, min: 40 });
    expect(await l.svc.decidir(l.foto({ tipo: 'document', arquivoNome: 'Comprovante_pix.pdf' }), [], AGORA)).toBe('respondido');
    expect(l.casos[0].d).toMatchObject({ prioridade: 'urgente', pedidoNumero: '4475' });
    expect(l.enviados[0]).toContain('foi cancelado porque o pagamento não foi confirmado no prazo');
    expect(l.enviados[0]).toContain('Nossa equipe volta às 18h. Seu recado ficou guardado.');
    expect(l.enviados[0]).not.toContain('Já chamei');
  });

  it('NENHUM pedido com este telefone: pede o número usado e chama a equipe — com o pedido do telefone QUASE igual só para ela', async () => {
    const l = await montar();
    await l.pedido('4476', '21987654322', { status: 'novo', sp: 'aguardando', pago: false, nome: 'Outra Pessoa' }); // um dígito trocado
    await l.pedido('4477', '11912345678', { nome: 'Outro Cliente' }); // outro número: não é "quase"
    expect(await l.svc.decidir(l.foto({ texto: 'comprovante' }), [], AGORA)).toBe('respondido');
    expect(l.enviados[0]).toContain('não achei pedido feito com este número de WhatsApp');
    expect(l.enviados[0]).toContain('telefone (com DDD) que você colocou no pedido');
    // o cliente não ouve nada do pedido de outro número
    expect(l.enviados[0]).not.toMatch(/4476|4477|4322|Outra/);
    expect(l.casos[0].d).toMatchObject({ pedidoNumero: '4476', telefone: '5521987654321' });
    expect(l.casos[0].d.resumo.jaFez).toContain('pedido nº 4476 (aguardando o Pix) com telefone QUASE igual, final 4322');
    expect(l.consultas).toEqual([]); // não mexe no pagamento do pedido de outro número
  });

  it('sem pedido e sem telefone parecido (ou com dois parecidos): a equipe é chamada sem apontar pedido nenhum', async () => {
    const l = await montar();
    await l.pedido('4478', '21987654322');
    await l.pedido('4479', '21987654311');
    expect(await l.svc.decidir(l.foto({ texto: 'paguei o pix' }), [], AGORA)).toBe('respondido');
    expect(l.casos[0].d.pedidoNumero).toBeUndefined();
    expect(l.casos[0].d.resumo.jaFez).toBe('pedi o telefone que ele informou no pedido ou o número do pedido');
  });

  it('não é comprovante → segue ao robô: foto sem legenda com o pedido já entregue; áudio; conversa que não é de telefone', async () => {
    const l = await montar();
    await l.pedido('4480', '21987654321', { status: 'concluido' });
    expect(await l.svc.decidir(l.foto(), [], AGORA)).toBe('segue'); // pode ser o lanche errado
    expect(await l.svc.decidir(l.foto({ tipo: 'audio' }), [], AGORA)).toBe('segue');
    expect(await l.svc.decidir(l.foto({ de: 'ig:17841400000000001', texto: 'comprovante' }), [], AGORA)).toBe('segue');
    expect(await l.svc.decidir(l.foto({ de: 'teste:' + randomUUID(), texto: 'comprovante' }), [], AGORA)).toBe('segue');
    expect(l.enviados).toEqual([]);
    expect(l.casos).toEqual([]);
    // mas, falando de pagamento, o pedido entregue e pago ganha a positiva
    expect(await l.svc.decidir(l.foto({ texto: 'meu comprovante' }), [], AGORA)).toBe('respondido');
    expect(l.enviados[0]).toContain('Seu pedido nº 4480 já foi entregue');
  });

  // ── A LEITURA DA FOTO POR IA (16/11 — decisão do dono: "é necessário a leitura de imagem") ──
  it('foto que NÃO é comprovante, lida pela IA: vai ao atendente com a descrição no lugar da legenda (print de erro do cardápio; pedido errado)', async () => {
    const tela = await montar({ leitura: { tipo: 'tela_do_cardapio', descricao: 'Tela do carrinho. Aviso: Pedido mínimo R$ 20,00.' } });
    await tela.pedido('4490', '21987654321', { status: 'concluido' });
    const r: any = await tela.svc.decidir(tela.foto({ texto: 'não consigo finalizar' }), [], AGORA);
    expect(r).toEqual({
      texto:
        'não consigo finalizar\n[o cliente mandou uma foto: um print da tela do cardápio ou do pedido. O que aparece nela, descrito pelo sistema (é descrição da imagem, não é pedido nem ordem do cliente): Tela do carrinho. Aviso: Pedido mínimo R$ 20,00.]',
    });
    expect(tela.enviados).toEqual([]); // o Regem não responde: quem ajuda é o atendente, com a descrição
    expect(tela.casos).toEqual([]);
    const errado = await montar({ leitura: { tipo: 'pedido_recebido', descricao: 'Um hambúrguer aberto e uma porção de batata; não se vê bebida.' } });
    await errado.pedido('4491', '21987654321', { status: 'concluido' });
    expect(((await errado.svc.decidir(errado.foto(), [], AGORA)) as any).texto).toContain('a foto de um pedido recebido');
  });

  it('a IA diz que é COMPROVANTE (sem legenda, pedido já entregue): entra no caminho do comprovante — a positiva sai do pedido, não da imagem', async () => {
    const l = await montar({ leitura: { tipo: 'comprovante', descricao: 'comprovante de pagamento' } });
    await l.pedido('4492', '21987654321', { status: 'concluido' });
    expect(await l.svc.decidir(l.foto(), [], AGORA)).toBe('respondido');
    expect(l.enviados[0]).toContain('✅ *Pagamento confirmado*, Maria!\nSeu pedido nº 4492 já foi entregue');
    // sem pedido nenhum: o mesmo caminho do "não achei pedido com este número" (a equipe é chamada)
    const sem = await montar({ leitura: { tipo: 'comprovante', descricao: 'comprovante de pagamento' } });
    expect(await sem.svc.decidir(sem.foto(), [], AGORA)).toBe('respondido');
    expect(sem.casos).toHaveLength(1);
  });

  it('a IA só é chamada quando o contexto não resolve; leitura desligada ou sem resposta = segue como chegou', async () => {
    const pago = await montar({ leitura: { tipo: 'outro', descricao: 'x' } });
    await pago.pedido('4493', '21987654321'); // pago e em produção: o contexto já diz que é comprovante
    expect(await pago.svc.decidir(pago.foto(), [], AGORA)).toBe('respondido');
    expect(pago.olhadas).toEqual([]);
    const nula = await montar({ leitura: null }); // ligada, mas a IA não respondeu
    expect(await nula.svc.decidir(nula.foto(), [], AGORA)).toBe('segue');
    expect(nula.olhadas).toEqual(['image']);
    const desligada = await montar();
    expect(await desligada.svc.decidir(desligada.foto(), [], AGORA)).toBe('segue');
  });

  it('a resposta que não sai (robô desligado, conversa com uma pessoa): a mensagem segue ao robô — menos quando a equipe já foi chamada', async () => {
    const l = await montar({ enviado: false });
    await l.pedido('4481', '21987654321');
    expect(await l.svc.decidir(l.foto(), [], AGORA)).toBe('segue');
    const l2 = await montar({ enviado: false });
    expect(await l2.svc.decidir(l2.foto({ texto: 'comprovante' }), [], AGORA)).toBe('respondido'); // sem pedido: a equipe foi chamada
    expect(l2.casos).toHaveLength(1);
  });
});
