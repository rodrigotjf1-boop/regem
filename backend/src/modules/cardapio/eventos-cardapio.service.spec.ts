import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CardapioService } from './cardapio.service';
import { EventosCardapioService } from './eventos-cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// EVENTOS DO CARDÁPIO contra o Postgres real: a gravação troca SÓ a chave `eventos` do tema (com a
// junção de jsonb no banco), a rota geral de configuração não mexe nela, e o cardápio público
// devolve o código do cupom do mini-jogo. Sem banco (`TEST_PG_URL`), pula.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('eventos-cardapio.service.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

descrever('eventos do cardápio (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  let eventos: EventosCardapioService;
  let cardapio: CardapioService;
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const presidente = (tenantId: string) => ({ tenantId, colaboradorId: randomUUID(), categoria: 'presidente' }) as any;

  async function empresa(tema: Record<string, unknown> | null = { corPrimaria: '#D62828', bannerIntervalo: 4 }) {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `teste eventos ${id.slice(0, 6)}`]);
    empresas.push(id);
    if (tema) await q(`insert into cardapio_config (tenant_id, token, ativo, tema_config) values ($1, $2, true, $3::jsonb)`, [id, `ev${id.replace(/-/g, '').slice(0, 10)}`, JSON.stringify(tema)]);
    return id;
  }
  const produto = async (tenant: string) => (await q(`insert into produto (tenant_id, nome) values ($1, 'Combo teste') returning id`, [tenant]))[0].id as string;
  const cupomDe = async (tenant: string, codigo: string, ativo = true) =>
    (await q(`insert into cupom (tenant_id, codigo, tipo, valor, ativo) values ($1, $2, 'percentual', 10, $3) returning id`, [tenant, codigo, ativo]))[0].id as string;
  const tema = async (tenant: string) => (await q(`select tema_config as t, updated_at as u from cardapio_config where tenant_id = $1`, [tenant]))[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    eventos = new EventosCardapioService(db, auditoria as any);
    // Só os caminhos que usam o banco: salvar a configuração geral e resolver o evento do cardápio.
    cardapio = new (CardapioService as any)(db);
  });

  afterAll(async () => {
    for (const id of empresas) {
      await q(`delete from cupom where tenant_id = $1`, [id]);
      await q(`delete from produto where tenant_id = $1`, [id]);
      await q(`delete from cardapio_config where tenant_id = $1`, [id]);
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  it('sem cardápio digital configurado: mostra a agenda vazia e recusa gravar', async () => {
    const t = await empresa(null);
    const r = await eventos.obter(t, 'presidente');
    expect(r.temCardapio).toBe(false);
    expect(r.agenda).toHaveLength(12);
    expect(r.agenda.some((l) => l.ativo)).toBe(false);
    await expect(eventos.salvar(presidente(t), { porEvento: { natal: { ativo: true } } })).rejects.toThrow(/Ative o cardápio digital/);
  });

  it('gravar troca só a chave "eventos": cor e banner do tema ficam como estavam', async () => {
    const t = await empresa();
    const antes = await tema(t);
    const r = await eventos.salvar(presidente(t), { porEvento: { natal: { ativo: true, titulo: 'Natal da casa' }, halloween: { ativo: true } }, animacoes: false });
    const depois = await tema(t);
    expect(depois.t.corPrimaria).toBe('#D62828');
    expect(depois.t.bannerIntervalo).toBe(4);
    expect(depois.t.eventos.porEvento.natal).toEqual({ ativo: true, titulo: 'Natal da casa' });
    expect(depois.t.eventos.animacoes).toBe(false);
    expect(new Date(depois.u).getTime()).toBeGreaterThanOrEqual(new Date(antes.u).getTime()); // o sincronismo enxerga a mudança
    expect(r.config.porEvento.halloween).toEqual({ ativo: true });
    expect(r.agenda.find((l) => l.chave === 'natal')?.ativo).toBe(true);
    expect(r.podeEditar).toBe(true);
    expect(auditoria.registrar).toHaveBeenLastCalledWith(
      expect.objectContaining({ tenantId: t, acao: 'cardapio_eventos_alterados', detalhe: expect.objectContaining({ ligou: ['halloween', 'natal'], desligou: [] }) }),
    );
  });

  it('segunda gravação parcial mantém o que não veio; gerente vê mas não é quem edita', async () => {
    const t = await empresa();
    await eventos.salvar(presidente(t), { porEvento: { natal: { ativo: true, titulo: 'Natal da casa' } }, jogos: [{ inicio: '2099-10-05T21:30', chamada: 'Decisão' }] });
    await eventos.salvar(presidente(t), { porEvento: { natal: { ativo: false } } });
    const g = await eventos.obter(t, 'gerente');
    expect(g.podeEditar).toBe(false);
    expect(g.config.porEvento.natal).toEqual({ ativo: false, titulo: 'Natal da casa' });
    expect(g.config.jogos).toEqual([{ inicio: '2099-10-05T21:30:00-03:00', chamada: 'Decisão' }]);
    expect(auditoria.registrar).toHaveBeenLastCalledWith(expect.objectContaining({ detalhe: expect.objectContaining({ desligou: ['natal'], ligados: [] }) }));
  });

  it('corpo inválido vira 400 com o motivo e não grava nada', async () => {
    const t = await empresa();
    await expect(eventos.salvar(presidente(t), { jogos: [{ inicio: '2099-10-05T21:30', chamada: 'Final da Libertadores' }] })).rejects.toThrow(BadRequestException);
    await expect(eventos.salvar(presidente(t), { porEvento: { natal: { ativo: 'sim' } } })).rejects.toThrow(/true ou false/);
    expect((await tema(t)).t.eventos).toBeUndefined();
  });

  it('produto da coleção e cupom do jogo têm de ser da própria empresa (o cupom, ativo)', async () => {
    const t = await empresa();
    const outra = await empresa();
    const meu = await produto(t);
    const alheio = await produto(outra);
    const cupomMeu = await cupomDe(t, 'DOCES10');
    const cupomAlheio = await cupomDe(outra, 'ALHEIO10');
    const cupomOff = await cupomDe(t, 'VELHO10', false);
    await expect(eventos.salvar(presidente(t), { porEvento: { natal: { colecao: [meu, alheio] } } })).rejects.toThrow(/não é desta empresa/);
    await expect(eventos.salvar(presidente(t), { porEvento: { halloween: { cupomJogo: cupomAlheio } } })).rejects.toThrow(/cupom do jogo não existe mais/);
    await expect(eventos.salvar(presidente(t), { porEvento: { halloween: { cupomJogo: cupomOff } } })).rejects.toThrow(/cupom do jogo não existe mais/);
    const r = await eventos.salvar(presidente(t), { porEvento: { natal: { colecao: [meu] }, halloween: { cupomJogo: cupomMeu } } });
    expect(r.config.porEvento.natal?.colecao).toEqual([meu]);
    expect(r.config.porEvento.halloween?.cupomJogo).toBe(cupomMeu);
  });

  it('a rota geral de configuração não grava nem apaga os eventos (tela de tema aberta antes)', async () => {
    const t = await empresa();
    await eventos.salvar(presidente(t), { porEvento: { natal: { ativo: true } } });
    // "Editar tema" manda o tema inteiro que tinha carregado — com eventos antigos (ou inventados).
    await cardapio.setConfig(t, null, { temaConfig: { corPrimaria: '#0E7C66', eventos: { porEvento: { carnaval: { ativo: true } } } } }, 'gerente');
    const d = (await tema(t)).t;
    expect(d.corPrimaria).toBe('#0E7C66');
    expect(d.bannerIntervalo).toBe(4);
    expect(d.eventos.porEvento).toEqual({ natal: { ativo: true } });
    // …e numa loja sem eventos, a rota geral não cria a chave.
    const s = await empresa();
    await cardapio.setConfig(s, null, { temaConfig: { eventos: { porEvento: { natal: { ativo: true } } } } }, 'presidente');
    expect((await tema(s)).t.eventos).toBeUndefined();
  });

  it('cardápio público: sem evento ligado é null; a prévia mostra o evento; o jogo entrega o código do cupom ativo', async () => {
    const t = await empresa();
    const cfg = async () => (await q(`select tenant_id as "tenantId", tema_config as "temaConfig" from cardapio_config where tenant_id = $1`, [t]))[0];
    const resolver = (previa?: string) => cfg().then((c) => (cardapio as any).eventoDoCardapio(c, previa));
    expect(await resolver()).toBeNull();
    expect(await resolver('natal')).toMatchObject({ chave: 'natal', previa: true, cupomJogo: null, cores: true, animacoes: true });
    expect(await resolver('inexistente')).toBeNull(); // valor desconhecido = sem prévia
    const id = await cupomDe(t, 'DOCES10');
    await eventos.salvar(presidente(t), { porEvento: { halloween: { ativo: true, cupomJogo: id, texto: 'Toque na abóbora.' } } });
    const h = await resolver('halloween');
    expect(h).toMatchObject({ chave: 'halloween', cupomJogo: 'DOCES10', texto: 'Toque na abóbora.' });
    expect(h).not.toHaveProperty('cupomJogoId'); // o id interno não sai para a tela
    await q(`update cupom set ativo = false where id = $1`, [id]);
    expect((await resolver('halloween')).cupomJogo).toBeNull(); // cupom desativado: o jogo some
  });
});
