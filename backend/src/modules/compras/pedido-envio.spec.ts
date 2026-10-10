import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EstoqueService } from '../estoque/estoque.service';
import { ComprasService } from './compras.service';
import { assuntoDoPedido, emailParaEnvio, linkDoEmail, linkDoWhatsapp, telefoneParaWhatsapp, textoDoPedido } from './pedido-texto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ENVIAR O PEDIDO AO FORNECEDOR — pedido do dono em 10/10/2026: "opção de enviar ao fornecedor caso o
// pedido seja todo de um só fornecedor (não é obrigatório direcionar); ao selecionar um fornecedor,
// caso tenha um contato de WhatsApp ou e-mail, enviar o pedido ao responsável". Decisão dele: o
// sistema ABRE o WhatsApp ou o e-mail de quem está usando, com o pedido pronto — não envia sozinho.

describe('pedido em texto e links de envio (regras puras)', () => {
  it('telefone → número do WhatsApp: Brasil ganha o 55; incompleto não vira link', () => {
    expect(telefoneParaWhatsapp('(21) 99999-0000')).toBe('5521999990000');
    expect(telefoneParaWhatsapp('21 3333-4444')).toBe('552133334444');
    expect(telefoneParaWhatsapp('021 99999 0000')).toBe('5521999990000'); // zero da operadora na frente
    expect(telefoneParaWhatsapp('5521999990000')).toBe('5521999990000');
    expect(telefoneParaWhatsapp('+351 912 345 678')).toBe('351912345678'); // com "+" vale como está
    expect(telefoneParaWhatsapp('99999-0000')).toBeNull(); // sem DDD
    expect(telefoneParaWhatsapp('ramal 12')).toBeNull();
    expect(telefoneParaWhatsapp('')).toBeNull();
    expect(telefoneParaWhatsapp(null)).toBeNull();
  });

  it('e-mail do cadastro: só um endereço limpo vira link', () => {
    expect(emailParaEnvio(' compras@fornecedor.teste ')).toBe('compras@fornecedor.teste');
    expect(emailParaEnvio('a@b.teste; c@d.teste')).toBeNull();
    expect(emailParaEnvio('a@b.teste?bcc=x@y.teste')).toBeNull(); // nada de parâmetro escondido no mailto
    expect(emailParaEnvio('sem-arroba')).toBeNull();
    expect(emailParaEnvio(undefined)).toBeNull();
  });

  const PEDIDO = {
    loja: 'Loja de teste', pedido: 'Compra da semana', fornecedor: 'Atacado de teste', contato: 'Marcos', entrega: '2026-10-14',
    itens: [
      { nome: 'Fatia de queijo de teste', nomeComercial: 'Barra de queijo de teste', quantidade: '10', unidadeMedida: 'unidade', marca: 'Marca Alfa', marcaAlternativa: 'Marca Beta' },
      { nome: 'Carne de teste', nomeComercial: null, quantidade: 2.5, unidadeMedida: 'kg', marca: 'Marca Delta', marcaAlternativa: null },
      { nome: 'Sal de teste', quantidade: 1000, unidadeMedida: 'grama' },
    ],
  };
  it('o texto: loja, pedido, fornecedor, entrega e cada item pelo nome comercial, com marca e 2ª opção — sem valores', () => {
    expect(textoDoPedido(PEDIDO)).toBe(
      [
        '*Pedido de compra — Loja de teste*',
        'Pedido: Compra da semana',
        'Fornecedor: Atacado de teste (a/c Marcos)',
        'Entrega desejada: 14/10/2026',
        '',
        '• 10 unidade — Barra de queijo de teste · marca Marca Alfa (2ª opção: Marca Beta)',
        '• 2,5 kg — Carne de teste · marca Marca Delta',
        '• 1.000 grama — Sal de teste',
        '',
        'Por favor, confirme o recebimento deste pedido.',
      ].join('\n'),
    );
    // sem fornecedor e sem data: as duas linhas somem; no e-mail o título vai sem os asteriscos
    const solto = textoDoPedido({ ...PEDIDO, fornecedor: null, contato: null, entrega: null }, false);
    expect(solto.split('\n').slice(0, 3)).toEqual(['Pedido de compra — Loja de teste', 'Pedido: Compra da semana', '']);
    expect(assuntoDoPedido(PEDIDO)).toBe('Pedido de compra — Loja de teste — Compra da semana');
  });

  it('os links levam o texto inteiro, codificado', () => {
    const texto = textoDoPedido(PEDIDO);
    const wa = linkDoWhatsapp('5521999990000', texto);
    expect(wa.startsWith('https://wa.me/5521999990000?text=')).toBe(true);
    expect(decodeURIComponent(wa.split('?text=')[1])).toBe(texto);
    expect(wa).not.toMatch(/[\n ]/); // nada cru que quebre o link
    const mail = linkDoEmail('compras@fornecedor.teste', assuntoDoPedido(PEDIDO), textoDoPedido(PEDIDO, false));
    expect(mail.startsWith('mailto:compras@fornecedor.teste?subject=Pedido%20de%20compra')).toBe(true);
    expect(decodeURIComponent(mail.split('&body=')[1])).toBe(textoDoPedido(PEDIDO, false).replace(/\n/g, '\r\n'));
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedido-envio.spec: sem TEST_PG_URL — parte com banco PULADA');
jest.setTimeout(120_000);

descrever('enviar o pedido ao fornecedor (Postgres real)', () => {
  let pool: Pool;
  let db: any;
  const empresas: string[] = [];
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const estoque = () => new (EstoqueService as any)(db, auditoria) as EstoqueService;
  const compras = () => new (ComprasService as any)(db, { emit: () => true }, auditoria) as ComprasService;
  const ator = { colaboradorId: undefined, categoria: 'gerente' };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['titulo_financeiro', 'lote', 'movimento_estoque', 'compra_item', 'compra_lista', 'item_estoque_unidade', 'item_estoque', 'fornecedor', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  async function cenario() {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, 'Empresa de teste')`, [t]);
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [t]))[0].id as string;
    const fornecedor = async (nome: string, telefone: string | null, email: string | null, contato: string | null = null) =>
      (await q(`insert into fornecedor (tenant_id, nome, telefone, email, contato) values ($1, $2, $3, $4, $5) returning id`, [t, nome, telefone, email, contato]))[0].id as string;
    const s = estoque();
    const queijo: any = await s.createItem(t, { nome: 'Fatia de queijo de teste', nomeComercial: 'Barra de queijo de teste', marcas: ['Marca Alfa', 'Marca Beta'], unidadeMedida: 'unidade' } as any, null, ator);
    const sal: any = await s.createItem(t, { nome: 'Sal de teste', unidadeMedida: 'kg' } as any, null, ator);
    const c = compras();
    const pedido = (nome: string, fornecedorId?: string, extra: any = {}) =>
      c.createLista(t, {
        nome, fornecedorId, ...extra,
        itens: [{ itemId: queijo.id, quantidade: 10, custoUnitario: 4.5, marca: 'Marca Alfa', marcaAlternativa: 'Marca Beta' }, { itemId: sal.id, quantidade: 2 }],
      } as any, u) as Promise<any>;
    return { t, u, c, fornecedor, pedido, queijo, sal };
  }

  it('com fornecedor e contato: o texto do pedido e os dois links, com o número e o e-mail do cadastro', async () => {
    const x = await cenario();
    const f = await x.fornecedor('Atacado de teste', '(21) 99999-0000', 'compras@fornecedor.teste', 'Marcos');
    const p = await x.pedido('Compra da semana de teste', f, { dataRecebimento: '2026-10-14' });
    const e: any = await x.c.pedidoParaEnviar(x.t, p.id, x.u);
    expect(e.texto.split('\n')).toEqual([
      '*Pedido de compra — Loja de teste*',
      'Pedido: Compra da semana de teste',
      'Fornecedor: Atacado de teste (a/c Marcos)',
      'Entrega desejada: 14/10/2026',
      '',
      expect.stringMatching(/^• (10 unidade — Barra de queijo de teste · marca Marca Alfa \(2ª opção: Marca Beta\)|2 kg — Sal de teste)$/),
      expect.stringMatching(/^• (10 unidade — Barra de queijo de teste · marca Marca Alfa \(2ª opção: Marca Beta\)|2 kg — Sal de teste)$/),
      '',
      'Por favor, confirme o recebimento deste pedido.',
    ]);
    expect(e.texto).not.toMatch(/4[,.]5|R\$/); // o valor do pedido NÃO vai para o fornecedor
    expect(e.fornecedor).toEqual({ nome: 'Atacado de teste', contato: 'Marcos', telefone: '(21) 99999-0000', email: 'compras@fornecedor.teste' });
    expect(decodeURIComponent(e.whatsapp.replace('https://wa.me/5521999990000?text=', ''))).toBe(e.texto);
    expect(e.email.startsWith('mailto:compras@fornecedor.teste?subject=')).toBe(true);
    expect(decodeURIComponent(e.email.split('?subject=')[1].split('&body=')[0])).toBe('Pedido de compra — Loja de teste — Compra da semana de teste');
    expect(e).toMatchObject({ enviadoEm: null, enviadoCanal: null, status: 'aberta' });
  });

  it('sem fornecedor, ou com cadastro sem contato que sirva: vem só o texto, para copiar', async () => {
    const x = await cenario();
    const solto = await x.pedido('Pedido solto de teste');
    const a: any = await x.c.pedidoParaEnviar(x.t, solto.id, x.u);
    expect(a).toMatchObject({ fornecedor: null, whatsapp: null, email: null });
    expect(a.texto).not.toMatch(/Fornecedor:|Entrega desejada/);
    expect(a.texto).toMatch(/Barra de queijo de teste/);

    const semContato = await x.fornecedor('Sem contato de teste', '3333-4444', 'a@b.teste; c@d.teste'); // telefone sem DDD, dois e-mails
    const p = await x.pedido('Pedido sem contato de teste', semContato);
    const b: any = await x.c.pedidoParaEnviar(x.t, p.id, x.u);
    expect(b).toMatchObject({ whatsapp: null, email: null });
    expect(b.fornecedor).toMatchObject({ nome: 'Sem contato de teste', telefone: '3333-4444' });

    const soEmail = await x.fornecedor('Só e-mail de teste', null, 'vendas@fornecedor.teste');
    const p2 = await x.pedido('Pedido por e-mail de teste', soEmail);
    const c: any = await x.c.pedidoParaEnviar(x.t, p2.id, x.u);
    expect(c.whatsapp).toBeNull();
    expect(c.email).toMatch(/^mailto:vendas@fornecedor\.teste\?subject=/);
  });

  it('marcar como enviado: fica no pedido quando e por onde; pedido recebido ou de outra loja não marca', async () => {
    const x = await cenario();
    const f = await x.fornecedor('Atacado de teste', '(21) 99999-0000', null);
    const p = await x.pedido('Compra de teste', f);
    await expect(x.c.marcarEnviado(x.t, p.id, 'sms', x.u)).rejects.toThrow(/Canal de envio desconhecido/);
    const antes = Date.now();
    const r: any = await x.c.marcarEnviado(x.t, p.id, 'whatsapp', x.u, null);
    expect(r).toMatchObject({ ok: true, enviadoCanal: 'whatsapp' });
    const [linha] = await q(`select enviado_em, enviado_canal from compra_lista where id = $1`, [p.id]);
    expect(linha.enviado_canal).toBe('whatsapp');
    expect(new Date(linha.enviado_em).getTime()).toBeGreaterThanOrEqual(antes - 1000);
    // a lista de pedidos e o próprio pedido mostram o envio
    const listas: any[] = await x.c.listListas(x.t, x.u);
    expect(listas.find((l) => l.id === p.id)).toMatchObject({ enviadoCanal: 'whatsapp' });
    expect(listas.find((l) => l.id === p.id).enviadoEm).toBeTruthy();
    expect(await x.c.pedidoParaEnviar(x.t, p.id, x.u)).toMatchObject({ enviadoCanal: 'whatsapp' });
    // marcar de novo por outro canal troca (a pessoa reenviou por e-mail)
    await x.c.marcarEnviado(x.t, p.id, 'email', x.u);
    expect((await q(`select enviado_canal from compra_lista where id = $1`, [p.id]))[0].enviado_canal).toBe('email');

    // outra loja não vê nem marca
    const outraLoja = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Outra loja de teste') returning id`, [x.t]))[0].id as string;
    await expect(x.c.marcarEnviado(x.t, p.id, 'whatsapp', outraLoja)).rejects.toThrow(/Pedido não encontrado/);
    await expect(x.c.pedidoParaEnviar(x.t, p.id, outraLoja)).rejects.toThrow(/Pedido não encontrado/);
    // depois de recebido não há o que enviar
    const itens = await q(`select id from compra_item where lista_id = $1`, [p.id]);
    await x.c.receber(x.t, p.id, null, { itens: itens.map((i: any) => ({ compraItemId: i.id, qtdRecebida: 1, validadeIndefinida: true })) } as any, x.u);
    await expect(x.c.marcarEnviado(x.t, p.id, 'whatsapp', x.u)).rejects.toThrow(/já foi recebido/);
  });
});
