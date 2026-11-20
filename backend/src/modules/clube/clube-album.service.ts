import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { chaveTelefone } from '../../common/telefone-chave';
import { noFuso } from '../../common/fuso-sql';
import { sqlPedidoDoRegem } from '../avaliacao-pedido/nota-do-pedido';
import { type EstadoDoAlbum, estadoDoAlbum, mesPorExtenso, seloDoMes } from './clube.regras';
import { ClubeService } from './clube.service';
import { ClubeSurpresaService } from './clube-surpresa.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type AlbumDoCliente =
  | { ativo: false }
  | (EstadoDoAlbum & {
      ativo: true;
      validadeMeses: number;
      /** Completo: os prêmios que o cliente pode escolher (sem o produto grátis). */
      premios: Array<{ id: string; nome: string; descricao: string }>;
    });

// CLUBE — O ÁLBUM DE SELOS (fase A2, mig 479). Só NUVEM. Os selos não são gravados: saem dos pedidos — um por mês (no
// relógio da operação) com pedido do cardápio online ou do robô a partir do mínimo do clube, concluído DEPOIS de ligar o
// álbum, dentro da validade (6 ou 12 meses) e depois da última troca. Juntou o total, o cliente ESCOLHE um prêmio da lista
// em Sua conta: vira direito (ferramenta "album", forma "escolha", revelado na hora) com o cupom pessoal, e o álbum
// recomeça. Nada de sorteio: todo mundo que junta os selos escolhe.
@Injectable()
export class ClubeAlbumService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly clube: ClubeService,
    private readonly surpresa: ClubeSurpresaService,
  ) {}

  private rows(r: any): any[] {
    return (r?.rows ?? r) as any[];
  }

  /** Desde quando o álbum está ligado (nulo = desligado). */
  private async desde(executor: any, tenantId: string): Promise<string | null> {
    const [l] = this.rows(await executor.execute(sql`select album_desde from clube_config where tenant_id = ${tenantId}::uuid`));
    return l?.album_desde ? new Date(l.album_desde).toISOString() : null;
  }

  /** Os meses (YYYY-MM, relógio da operação) que dão selo a este cliente agora. */
  private async meses(executor: any, tenantId: string, clienteId: string, desde: string, validadeMeses: number, minimo: number): Promise<string[]> {
    const quando = 'coalesce(p.entregue_em, p.concluido_em)';
    const r = this.rows(
      await executor.execute(sql`
        select distinct to_char(${noFuso(quando)}, 'YYYY-MM') as mes
          from pedido_externo p
         where p.tenant_id = ${tenantId}::uuid and p.cliente_id = ${clienteId}::uuid
           and p.status in ('entregue', 'concluido') and ${sqlPedidoDoRegem('p.canal')} and p.total >= ${minimo}
           and ${sql.raw(quando)} >= greatest(
                 ${desde}::timestamptz,
                 now() - make_interval(months => ${validadeMeses}),
                 coalesce((select max(d.criado_em) from clube_direito d
                            where d.tenant_id = p.tenant_id and d.cliente_id = ${clienteId}::uuid and d.gatilho = 'album'),
                          '-infinity'::timestamptz))
         order by mes`),
    );
    return r.map((x) => String(x.mes));
  }

  /** O álbum do cliente (Sua conta): os selos, quantos faltam e, completo, os prêmios para escolher. */
  async doCliente(tenantId: string, clienteId: string): Promise<AlbumDoCliente> {
    const config = await this.clube.config(tenantId);
    const desde = await this.desde(this.db, tenantId);
    if (!config.albumAtivo || !desde) return { ativo: false };
    const meses = await this.meses(this.db, tenantId, clienteId, desde, config.albumValidadeMeses, config.minimo);
    const estado = estadoDoAlbum(meses, config.albumSelos);
    const premios = estado.completo
      ? (await this.clube.premios(tenantId, config))
          .filter((p) => config.albumPremios.includes(p.id) && p.tipo !== 'produto')
          .map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao }))
      : [];
    return { ativo: true, ...estado, validadeMeses: config.albumValidadeMeses, premios };
  }

  /**
   * O cliente escolhe o prêmio do álbum completo. Sob a trava da transação por empresa e cliente (dois toques ao mesmo
   * tempo não trocam o mesmo álbum duas vezes): confere de novo que está completo e que o prêmio é da lista; a referência
   * é o cliente e o número da troca (o índice único segura a repetição). O cupom já sai revelado (o cliente escolheu).
   */
  async escolher(tenantId: string, clienteId: string, premioId: unknown): Promise<{ premio: string; codigo: string | null; validoAte: string }> {
    const id = typeof premioId === 'string' ? premioId.trim().toLowerCase() : '';
    const config = await this.clube.config(tenantId);
    if (!config.albumAtivo) throw new BadRequestException('O álbum de selos está desligado nesta loja.');
    if (!config.albumPremios.includes(id)) throw new BadRequestException('Escolha um dos prêmios do álbum.');
    const [p] = this.rows(
      await this.db.execute(sql`
        select id, nome, tipo, valor::float8 as valor, teto::float8 as teto, minimo::float8 as minimo, validade_dias
          from clube_premio where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and excluido_em is null`),
    );
    if (!p || p.tipo === 'produto') throw new BadRequestException('Escolha um dos prêmios do álbum.');
    const [cli] = this.rows(await this.db.execute(sql`select telefone from cliente where id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`));
    const chave = chaveTelefone(cli?.telefone);
    if (!cli || !chave) throw new NotFoundException('Cadastro não encontrado.');
    const novo = await this.db.transaction(async (tx: any) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`clube-album:${tenantId}`}), hashtext(${clienteId}))`);
      const desde = await this.desde(tx, tenantId);
      if (!desde) throw new BadRequestException('O álbum de selos está desligado nesta loja.');
      const meses = await this.meses(tx, tenantId, clienteId, desde, config.albumValidadeMeses, config.minimo);
      if (!estadoDoAlbum(meses, config.albumSelos).completo) throw new BadRequestException('O álbum ainda não está completo.');
      const [{ n }] = this.rows(
        await tx.execute(sql`
          select count(*)::int as n from clube_direito where tenant_id = ${tenantId}::uuid and cliente_id = ${clienteId}::uuid and gatilho = 'album'`),
      );
      const r = await this.surpresa.criarDireito(tx, {
        tenantId,
        clienteId,
        chave,
        ferramenta: 'album',
        gatilho: 'album',
        ref: `${clienteId}:${Number(n) + 1}`,
        forma: 'escolha',
        premio: {
          id: String(p.id),
          nome: String(p.nome),
          tipo: p.tipo,
          valor: Number(p.valor),
          teto: p.teto == null ? null : Number(p.teto),
          minimo: Number(p.minimo),
          validadeDias: Number(p.validade_dias),
        },
      });
      if (!r) throw new ConflictException('Este álbum já foi trocado por um prêmio.');
      await tx.execute(sql`update clube_direito set revelado_em = clock_timestamp() where id = ${r.id}::uuid`);
      return r;
    });
    const [cp] = this.rows(
      await this.db.execute(sql`select c.codigo from clube_direito d join cupom c on c.id = d.cupom_id where d.id = ${novo.id}::uuid`),
    );
    return { premio: String(p.nome), codigo: cp?.codigo ?? null, validoAte: novo.validoAte };
  }

  /**
   * O selo na página do pedido (`/r/…`): o pedido deu selo? "Você ganhou o selo de novembro — 3 de 4". Só com o álbum
   * ligado e o pedido entre os que contam.
   */
  async doPedido(token: unknown): Promise<{ tem: false } | { tem: true; mes: string; arte: string; selos: number; total: number; completo: boolean }> {
    const tk = String(token ?? '').replace(/[^a-z0-9]/gi, '');
    if (!tk) throw new NotFoundException('Pedido não encontrado.');
    const [ped] = this.rows(
      await this.db.execute(sql`
        select p.tenant_id, p.cliente_id, to_char(${noFuso('coalesce(p.entregue_em, p.concluido_em)')}, 'YYYY-MM') as mes
          from pedido_externo p where p.rastreio_token = ${tk} order by p.criado_em desc limit 1`),
    );
    if (!ped) throw new NotFoundException('Pedido não encontrado.');
    if (!ped.cliente_id || !ped.mes) return { tem: false };
    const album = await this.doCliente(String(ped.tenant_id), String(ped.cliente_id));
    if (!album.ativo || !album.selos.some((s) => s.mes === ped.mes)) return { tem: false };
    return { tem: true, mes: mesPorExtenso(ped.mes), arte: seloDoMes(ped.mes).arte, selos: album.tem, total: album.total, completo: album.completo };
  }
}
