import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { dataNoFuso, hojeISO } from '../../common/data';
import { sqlChaveTelefone } from '../../common/telefone-chave';
import { sqlPedidoDoRegem } from '../avaliacao-pedido/nota-do-pedido';
import { validadeDoPresente } from '../aniversario/aniversario.service';
import { codigoDoCupom } from '../relacionamento/relacionamento';
import { descricaoDoPremio, type FormaDoSurpresa, regrasDoClube, type TipoDePremio } from './clube.regras';
import { ClubeService } from './clube.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Só os pedidos entregues nos últimos N dias dão prêmio (a rotina parada por um dia ainda alcança; um pedido velho, não). */
export const JANELA_DO_ENTREGUE_DIAS = 3;
/** Quantos pedidos a rotina trata por passada (o resto fica para a passada seguinte: a condição de pular está no `where`). */
export const LOTE_DO_ENTREGUE = 200;
/** As fatias da roleta: os prêmios da lista da loja, até 8, sempre com o do cliente. */
export const FATIAS_MAX = 8;
/** O prefixo do código do cupom do clube ("CLUBE7K2QX"). */
export const PREFIXO_DO_CUPOM = 'CLUBE';

export type PremioRevelado = { nome: string; descricao: string; codigo: string | null; validoAte: string; usado: boolean; vencido: boolean };
export type PremioDoPedido =
  | { tem: false }
  | {
      tem: true;
      forma: FormaDoSurpresa;
      revelado: boolean;
      /** A roleta: os nomes das fatias (a raspadinha: vazio). Não dizem qual é o do cliente. */
      fatias: string[];
      /** Só depois de revelar: o prêmio e a fatia onde a roleta para. */
      premio: PremioRevelado | null;
      fatia: number | null;
      regras: string[];
    };

/** As fatias da roleta: os nomes da lista (sem repetir, até 8), com o do cliente garantido no lugar do último. */
export function fatiasDaRoleta(nomesDaLista: string[], doCliente: string, max = FATIAS_MAX): string[] {
  const unicos = [...new Set(nomesDaLista.map((n) => n.trim()).filter(Boolean))].slice(0, max);
  if (!unicos.includes(doCliente)) {
    if (unicos.length >= max) unicos[max - 1] = doCliente;
    else unicos.push(doCliente);
  }
  // A roleta com uma fatia só não gira de verdade: com um prêmio único, mostra duas vezes o mesmo (as duas metades).
  return unicos.length === 1 ? [unicos[0], unicos[0]] : unicos;
}

/** O código do link pessoal do direito: 128 bits aleatórios em base64url (22 letras). */
export function codigoDoDireito(): string {
  return randomBytes(16).toString('base64url');
}

// CLUBE — O PRÊMIO SURPRESA (fase A1, mig 474). Só NUVEM (CLOUD_ONLY em app.module; a rotina ainda confere o modo).
//  • A rotina do gatilho "Pedido entregue" (G1): a cada minuto, os pedidos do Cardápio Regem e do robô entregues depois de
//    ligar o gatilho, a partir do mínimo do clube, de um cliente com telefone, ganham UM direito cada um — o índice único
//    (empresa, gatilho, pedido) garante um por pedido mesmo com duas réplicas da API. O direito nasce com o cupom pessoal
//    (D3: `cupom` + `cupom_regra`, como o presente do aniversário), na MESMA transação: nunca um sem o outro.
//  • A revelação pela página do pedido (`/r/…`, sem login): o prêmio já está definido; a raspadinha e a roleta só mostram.
//    Antes de revelar, o cupom não aparece em "Sua conta › Benefícios" (lá aparece "prêmio para revelar", com o link).
@Injectable()
export class ClubeSurpresaService {
  private readonly logger = new Logger('ClubeSurpresa');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly clube: ClubeService,
  ) {}

  private rows(r: any): any[] {
    return (r?.rows ?? r) as any[];
  }

  @Interval(60_000)
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return; // só a NUVEM dá prêmio (o cardápio e o robô moram lá)
    this.rodando = true;
    try {
      const n = await this.darPeloEntregue();
      if (n) this.logger.log(`prêmio surpresa: ${n} direito(s) pelo pedido entregue`);
    } catch (err: any) {
      this.logger.warn(`rotina do prêmio surpresa: ${err?.message ?? err}`);
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Uma passada do gatilho "Pedido entregue": separa os pedidos que já podem ganhar (TODA condição no `where` — V84: o que
   * não pode ganhar nunca fica na frente do que pode) e dá o direito a cada um. Devolve quantos direitos NOVOS deu.
   */
  async darPeloEntregue(): Promise<number> {
    const chave = sqlChaveTelefone(sql`c.telefone`);
    const candidatos = this.rows(
      await this.db.execute(sql`
        select p.id, p.tenant_id, p.cliente_id, ${chave} as chave, cc.surpresa_forma as forma,
               pr.id as premio_id, pr.nome as premio_nome, pr.tipo, pr.valor::float8 as valor, pr.teto::float8 as teto,
               pr.minimo::float8 as minimo, pr.validade_dias
          from clube_config cc
          join clube_premio pr on pr.tenant_id = cc.tenant_id and pr.excluido_em is null and pr.tipo <> 'produto'
                              and pr.id::text = cc.surpresa_gatilhos #>> '{entregue,premioId}'
          join pedido_externo p on p.tenant_id = cc.tenant_id
          join cliente c on c.id = p.cliente_id and c.tenant_id = p.tenant_id
         where cc.surpresa_ativo
           and cc.surpresa_gatilhos #>> '{entregue,ativo}' = 'true'
           and p.status in ('entregue', 'concluido')
           and coalesce(p.entregue_em, p.concluido_em) >= greatest(
                 (cc.surpresa_gatilhos #>> '{entregue,desde}')::timestamptz,
                 now() - make_interval(days => ${JANELA_DO_ENTREGUE_DIAS}))
           and p.total >= cc.minimo
           and ${sqlPedidoDoRegem('p.canal')}
           and ${chave} is not null
           and not exists (select 1 from clube_direito d
                            where d.tenant_id = p.tenant_id and d.gatilho = 'entregue' and d.ref = p.id::text)
         order by coalesce(p.entregue_em, p.concluido_em), p.id
         limit ${LOTE_DO_ENTREGUE}`),
    );
    let novos = 0;
    for (const c of candidatos) {
      try {
        if (await this.darDireito(c)) novos += 1;
      } catch (err: any) {
        // Um pedido que falha não para os outros; a passada seguinte tenta de novo (nada ficou gravado pela metade).
        this.logger.warn(`prêmio surpresa do pedido ${c.id}: ${err?.message ?? err}`);
      }
    }
    return novos;
  }

  /**
   * O direito e o cupom pessoal, na MESMA transação. O direito entra primeiro com `on conflict do nothing` no índice da
   * referência: a outra réplica que chegou junto espera e não grava nada. O código do cupom é sorteado de novo se já
   * existir na empresa (`on conflict do nothing` no índice único do código — sem abortar a transação).
   */
  private async darDireito(c: any): Promise<boolean> {
    const tipo = c.tipo as Exclude<TipoDePremio, 'produto'>;
    const p = {
      tipo,
      valor: Number(c.valor),
      teto: c.teto == null ? null : Number(c.teto),
      minimo: Number(c.minimo),
      validadeDias: Number(c.validade_dias),
    };
    const validoAte = validadeDoPresente(p.validadeDias);
    const descricao = descricaoDoPremio(p);
    return this.db.transaction(async (tx: any) => {
      const [d] = this.rows(
        await tx.execute(sql`
          insert into clube_direito (tenant_id, cliente_id, chave_telefone, ferramenta, gatilho, ref, premio_id, premio_nome,
                                     premio_descricao, forma, codigo, valido_ate)
          values (${c.tenant_id}::uuid, ${c.cliente_id}::uuid, ${c.chave}, 'surpresa', 'entregue', ${String(c.id)},
                  ${c.premio_id}::uuid, ${c.premio_nome}, ${descricao}, ${c.forma === 'roleta' ? 'roleta' : 'raspadinha'},
                  ${codigoDoDireito()}, ${validoAte}::date)
          on conflict (tenant_id, gatilho, ref) do nothing
          returning id`),
      );
      if (!d) return false;
      let cupomId: string | null = null;
      for (let tentativa = 0; tentativa < 8 && !cupomId; tentativa += 1) {
        const [cp] = this.rows(
          await tx.execute(sql`
            insert into cupom (tenant_id, codigo, tipo, valor, teto_desconto, minimo, ativo, validade, valido_de, max_usos,
                               max_por_cliente, nome)
            values (${c.tenant_id}::uuid, ${codigoDoCupom(PREFIXO_DO_CUPOM)}, ${p.tipo}, ${String(p.valor)},
                    ${p.tipo === 'percentual' && p.teto ? String(p.teto) : null}, ${p.minimo > 0 ? String(p.minimo) : null}, true,
                    ${validoAte}::date, ${dataNoFuso(new Date())}::date, 1, 1, ${`Clube · ${String(c.premio_nome).slice(0, 60)}`})
            on conflict do nothing
            returning id`),
        );
        cupomId = cp?.id ?? null;
      }
      if (!cupomId) throw new Error('não consegui sortear um código de cupom livre');
      await tx.execute(sql`
        insert into cupom_regra (cupom_id, tenant_id, cliente_id, chave_telefone)
        values (${cupomId}::uuid, ${c.tenant_id}::uuid, ${c.cliente_id}::uuid, ${c.chave})`);
      await tx.execute(sql`update clube_direito set cupom_id = ${cupomId}::uuid where id = ${d.id}::uuid`);
      return true;
    });
  }

  // ───────────────────────── A página do pedido (`/r/…`) ─────────────────────────

  private async pedidoDoToken(token: unknown): Promise<{ id: string; tenantId: string }> {
    const tk = String(token ?? '').replace(/[^a-z0-9]/gi, '');
    if (!tk) throw new NotFoundException('Pedido não encontrado.');
    const [p] = this.rows(
      await this.db.execute(sql`
        select id, tenant_id from pedido_externo where rastreio_token = ${tk} order by criado_em desc limit 1`),
    );
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    return { id: String(p.id), tenantId: String(p.tenant_id) };
  }

  private async direitoDoPedido(ped: { id: string; tenantId: string }) {
    const [d] = this.rows(
      await this.db.execute(sql`
        select d.id, d.forma, d.premio_nome, d.premio_descricao, d.valido_ate, d.revelado_em, cp.codigo,
               exists (select 1 from cupom_uso u where u.cupom_id = d.cupom_id) as usado
          from clube_direito d
          left join cupom cp on cp.id = d.cupom_id
         where d.tenant_id = ${ped.tenantId}::uuid and d.gatilho = 'entregue' and d.ref = ${ped.id}`),
    );
    return d ?? null;
  }

  private async montar(ped: { id: string; tenantId: string }, d: any, revelado: boolean): Promise<PremioDoPedido> {
    const forma: FormaDoSurpresa = d.forma === 'roleta' ? 'roleta' : 'raspadinha';
    const config = await this.clube.config(ped.tenantId);
    const gatilhos = await this.clube.gatilhos(ped.tenantId);
    const lista = await this.clube.premios(ped.tenantId, config, gatilhos);
    const nomes = new Map(lista.map((p) => [p.id, p.nome]));
    const fatias = forma === 'roleta' ? fatiasDaRoleta(lista.map((p) => p.nome), String(d.premio_nome)) : [];
    const validoAte = d.valido_ate instanceof Date ? dataNoFuso(d.valido_ate) : String(d.valido_ate).slice(0, 10);
    return {
      tem: true,
      forma,
      revelado,
      fatias,
      premio: revelado
        ? {
            nome: String(d.premio_nome),
            descricao: String(d.premio_descricao),
            codigo: d.codigo ?? null,
            validoAte,
            usado: d.usado === true,
            vencido: validoAte < hojeISO(),
          }
        : null,
      fatia: revelado && forma === 'roleta' ? fatias.lastIndexOf(String(d.premio_nome)) : null,
      // As regras do clube (o link "Regras do clube" de cada tela do jogo): só o que está ligado, com as travas.
      regras: regrasDoClube(config, (id) => nomes.get(id) ?? null, gatilhos),
    };
  }

  /** `GET /rastreio/:token/premio` — o pedido ganhou um prêmio? Antes de revelar, sem dizer qual. */
  async doPedido(token: unknown): Promise<PremioDoPedido> {
    const ped = await this.pedidoDoToken(token);
    const d = await this.direitoDoPedido(ped);
    if (!d) return { tem: false };
    return this.montar(ped, d, d.revelado_em != null);
  }

  /**
   * `POST /rastreio/:token/premio/revelar` — marca o direito como revelado (a primeira vez vale; tocar de novo só devolve o
   * mesmo prêmio) e devolve o prêmio com o código do cupom e, na roleta, a fatia onde para.
   */
  async revelar(token: unknown): Promise<PremioDoPedido> {
    const ped = await this.pedidoDoToken(token);
    const d = await this.direitoDoPedido(ped);
    if (!d) throw new NotFoundException('Este pedido não tem prêmio para revelar.');
    if (d.revelado_em == null)
      await this.db.execute(sql`
        update clube_direito set revelado_em = clock_timestamp() where id = ${d.id}::uuid and revelado_em is null`);
    return this.montar(ped, d, true);
  }
}
