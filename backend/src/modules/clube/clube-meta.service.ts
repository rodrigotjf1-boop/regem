import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { chaveTelefone } from '../../common/telefone-chave';
import { noFuso } from '../../common/fuso-sql';
import { hojeISO } from '../../common/data';
import { sqlPedidoDoRegem } from '../avaliacao-pedido/nota-do-pedido';
import { type ConfigDoClube, type EstadoDaMeta, estadoDaMeta, mesesQueEscolhem } from './clube.regras';
import { ClubeService } from './clube.service';
import { ClubeSurpresaService } from './clube-surpresa.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

type PremioDaLista = { id: string; nome: string; descricao: string };
export type MetaDoMes = Omit<EstadoDaMeta, 'niveis'> & {
  niveis: Array<EstadoDaMeta['niveis'][number] & { premios: PremioDaLista[] }>;
};
export type MetaDoCliente = { ativo: false } | { ativo: true; validadeDias: number; atual: MetaDoMes; anterior: MetaDoMes | null };

const QUANDO = 'coalesce(p.entregue_em, p.concluido_em)';

// CLUBE — A META DO MÊS (fase A3; a 479 trouxe `clube_config.meta_desde`). Só NUVEM. Nada é gravado até o cliente
// escolher: os pedidos do mês (relógio da operação) do cardápio online ou do robô, entregues ou concluídos, a partir do
// mínimo do clube e DEPOIS de ligar a meta, contam; cada nível batido dá UM prêmio no mês, que o cliente ESCOLHE da lista do
// nível em Sua conta (vira direito "meta", forma "escolha", já revelado, validade da meta). O nível batido no mês anterior
// ainda se escolhe até o dia 7. Nada de sorteio: todo mundo que bate a meta escolhe.
@Injectable()
export class ClubeMetaService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly clube: ClubeService,
    private readonly surpresa: ClubeSurpresaService,
  ) {}

  private rows(r: any): any[] {
    return (r?.rows ?? r) as any[];
  }

  /** Desde quando a meta está ligada (nulo = desligada). */
  private async desde(executor: any, tenantId: string): Promise<string | null> {
    const [l] = this.rows(await executor.execute(sql`select meta_desde from clube_config where tenant_id = ${tenantId}::uuid`));
    return l?.meta_desde ? new Date(l.meta_desde).toISOString() : null;
  }

  /** Quantos pedidos contam em cada um dos meses pedidos (AAAA-MM, relógio da operação). */
  private async pedidosPorMes(executor: any, tenantId: string, clienteId: string, meses: string[], desde: string, minimo: number) {
    const r = this.rows(
      await executor.execute(sql`
        select to_char(${noFuso(QUANDO)}, 'YYYY-MM') as mes, count(*)::int as n
          from pedido_externo p
         where p.tenant_id = ${tenantId}::uuid and p.cliente_id = ${clienteId}::uuid
           and p.status in ('entregue', 'concluido') and ${sqlPedidoDoRegem('p.canal')} and p.total >= ${minimo}
           and ${sql.raw(QUANDO)} >= ${desde}::timestamptz
           and ${sql.raw(QUANDO)} >= now() - interval '75 days'
           and to_char(${noFuso(QUANDO)}, 'YYYY-MM') in (${sql.join(meses.map((m) => sql`${m}`), sql`, `)})
         group by 1`),
    );
    return new Map(r.map((x) => [String(x.mes), Number(x.n)]));
  }

  /** Os níveis cujo prêmio o cliente já escolheu, por mês (a referência do direito é cliente:mês:nível). */
  private async escolhidos(executor: any, tenantId: string, clienteId: string, meses: string[]) {
    const r = this.rows(
      await executor.execute(sql`
        select d.ref from clube_direito d
         where d.tenant_id = ${tenantId}::uuid and d.gatilho = 'meta'
           and d.ref in (${sql.join(meses.flatMap((m) => [1, 2, 3].map((n) => sql`${`${clienteId}:${m}:${n}`}`)), sql`, `)})`),
    );
    const porMes = new Map<string, number[]>();
    for (const x of r) {
      const [, mes, nivel] = String(x.ref).split(':');
      porMes.set(mes, [...(porMes.get(mes) ?? []), Number(nivel)]);
    }
    return porMes;
  }

  /** A meta do cliente (Sua conta): o mês atual e, até o dia 7, o anterior se ainda tem prêmio para escolher. */
  async doCliente(tenantId: string, clienteId: string, hoje: string = hojeISO()): Promise<MetaDoCliente> {
    const config = await this.clube.config(tenantId);
    const desde = await this.desde(this.db, tenantId);
    if (!config.metaAtivo || !desde) return { ativo: false };
    const meses = mesesQueEscolhem(hoje);
    const pedidos = await this.pedidosPorMes(this.db, tenantId, clienteId, meses, desde, config.minimo);
    const escolhidos = await this.escolhidos(this.db, tenantId, clienteId, meses);
    const lista = await this.listas(tenantId, config);
    const doMes = (mes: string): MetaDoMes => {
      const e = estadoDaMeta(mes, pedidos.get(mes) ?? 0, config.metaNiveis, escolhidos.get(mes) ?? []);
      return { ...e, niveis: e.niveis.map((n, i) => ({ ...n, premios: lista[i] ?? [] })) };
    };
    const anterior = meses[1] ? doMes(meses[1]) : null;
    return { ativo: true, validadeDias: config.metaValidadeDias, atual: doMes(meses[0]), anterior: anterior?.pendente ? anterior : null };
  }

  /** Os prêmios de cada nível (os que existem, sem o produto grátis — que chega numa próxima entrega). */
  private async listas(tenantId: string, config: ConfigDoClube): Promise<PremioDaLista[][]> {
    const premios = await this.clube.premios(tenantId, config);
    return config.metaNiveis.map((n) =>
      premios.filter((p) => n.premios.includes(p.id) && p.tipo !== 'produto').map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao })),
    );
  }

  /**
   * O cliente escolhe o prêmio de um nível que bateu. Sob a trava da transação por empresa e cliente: confere de novo o mês
   * (o atual, ou o anterior até o dia 7), o nível, o prêmio da lista e os pedidos; a referência cliente:mês:nível (o
   * índice único) segura a repetição. O cupom já sai revelado, com a validade da meta.
   */
  async escolher(tenantId: string, clienteId: string, entrada: { mes?: unknown; nivel?: unknown; premioId?: unknown }, hoje: string = hojeISO()) {
    const mes = typeof entrada.mes === 'string' ? entrada.mes.trim() : '';
    const nivel = Number(entrada.nivel);
    const id = typeof entrada.premioId === 'string' ? entrada.premioId.trim().toLowerCase() : '';
    const config = await this.clube.config(tenantId);
    if (!config.metaAtivo) throw new BadRequestException('A meta do mês está desligada nesta loja.');
    if (!mesesQueEscolhem(hoje).includes(mes)) throw new BadRequestException('O prazo para escolher o prêmio desta meta acabou.');
    if (!Number.isInteger(nivel) || nivel < 1 || nivel > config.metaNiveis.length) throw new BadRequestException('Escolha um nível da meta.');
    const alvo = config.metaNiveis[nivel - 1];
    if (!alvo.premios.includes(id)) throw new BadRequestException('Escolha um dos prêmios deste nível.');
    const [p] = this.rows(
      await this.db.execute(sql`
        select id, nome, tipo, valor::float8 as valor, teto::float8 as teto, minimo::float8 as minimo
          from clube_premio where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and excluido_em is null`),
    );
    if (!p || p.tipo === 'produto') throw new BadRequestException('Escolha um dos prêmios deste nível.');
    const [cli] = this.rows(await this.db.execute(sql`select telefone from cliente where id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`));
    const chave = chaveTelefone(cli?.telefone);
    if (!cli || !chave) throw new NotFoundException('Cadastro não encontrado.');
    const novo = await this.db.transaction(async (tx: any) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`clube-meta:${tenantId}`}), hashtext(${clienteId}))`);
      const desde = await this.desde(tx, tenantId);
      if (!desde) throw new BadRequestException('A meta do mês está desligada nesta loja.');
      const n = (await this.pedidosPorMes(tx, tenantId, clienteId, [mes], desde, config.minimo)).get(mes) ?? 0;
      if (n < alvo.pedidos) throw new BadRequestException(`Faltam ${alvo.pedidos - n} pedido(s) para este nível.`);
      const r = await this.surpresa.criarDireito(tx, {
        tenantId,
        clienteId,
        chave,
        ferramenta: 'meta',
        gatilho: 'meta',
        ref: `${clienteId}:${mes}:${nivel}`,
        forma: 'escolha',
        premio: {
          id: String(p.id),
          nome: String(p.nome),
          tipo: p.tipo,
          valor: Number(p.valor),
          teto: p.teto == null ? null : Number(p.teto),
          minimo: Number(p.minimo),
          // A validade é a da meta ("conta a partir do dia em que o cliente escolhe"), não a do prêmio.
          validadeDias: config.metaValidadeDias,
        },
      });
      if (!r) throw new ConflictException('O prêmio deste nível já foi escolhido.');
      await tx.execute(sql`update clube_direito set revelado_em = clock_timestamp() where id = ${r.id}::uuid`);
      return r;
    });
    const [cp] = this.rows(
      await this.db.execute(sql`select c.codigo from clube_direito d join cupom c on c.id = d.cupom_id where d.id = ${novo.id}::uuid`),
    );
    return { premio: String(p.nome), codigo: cp?.codigo ?? null, validoAte: novo.validoAte };
  }

  /**
   * A meta na página do pedido (`/r/…`): o mês do pedido é o atual e a meta está ligada? Quantos pedidos, o próximo nível e
   * se bateu um nível com o prêmio ainda por escolher (o cliente escolhe em Sua conta).
   */
  async doPedido(token: unknown): Promise<{ tem: false } | ({ tem: true } & Pick<EstadoDaMeta, 'mesNome' | 'pedidos' | 'proximo' | 'pendente'> & { niveis: number[] })> {
    const tk = String(token ?? '').replace(/[^a-z0-9]/gi, '');
    if (!tk) throw new NotFoundException('Pedido não encontrado.');
    const [ped] = this.rows(
      await this.db.execute(sql`
        select p.tenant_id, p.cliente_id, to_char(${noFuso(QUANDO)}, 'YYYY-MM') as mes
          from pedido_externo p where p.rastreio_token = ${tk} order by p.criado_em desc limit 1`),
    );
    if (!ped) throw new NotFoundException('Pedido não encontrado.');
    if (!ped.cliente_id || !ped.mes) return { tem: false };
    const meta = await this.doCliente(String(ped.tenant_id), String(ped.cliente_id));
    if (!meta.ativo || meta.atual.mes !== ped.mes) return { tem: false };
    const a = meta.atual;
    return { tem: true, mesNome: a.mesNome, pedidos: a.pedidos, proximo: a.proximo, pendente: a.pendente, niveis: a.niveis.map((n) => n.pedidos) };
  }
}
