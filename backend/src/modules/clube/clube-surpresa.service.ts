import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { randomBytes } from 'crypto';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { dataNoFuso, hojeISO } from '../../common/data';
import { chaveTelefone, sqlChaveTelefone, telefoneCadastro } from '../../common/telefone-chave';
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
      /** Só no link pessoal (`/p/…`): o nome da loja e o cardápio dela. */
      loja?: string | null;
      cardapio?: string | null;
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

/** O endereço público do app (o mesmo dos links do relacionamento e do rastreio). */
const APP = () => (process.env.CARDAPIO_PUBLIC_URL || process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');

/** O que entra num direito novo (a rotina do pedido entregue, o prêmio de desculpas). */
export type NovoDireito = {
  tenantId: string;
  clienteId: string;
  chave: string;
  gatilho: 'entregue' | 'reclamacao' | 'classificacao' | 'campanha';
  ref: string;
  forma: FormaDoSurpresa;
  premio: { id: string; nome: string; tipo: TipoDePremio; valor: number; teto: number | null; minimo: number; validadeDias: number };
};

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
    }
    try {
      const n = await this.darPelaClassificacao();
      if (n) this.logger.log(`prêmio surpresa: ${n} direito(s) pela classificação do marketing`);
    } catch (err: any) {
      this.logger.warn(`rotina do prêmio pela classificação: ${err?.message ?? err}`);
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
   * Uma passada do gatilho "Pela classificação do marketing" (A1c): os clientes dos segmentos escolhidos (o perfil do
   * cliente, com o módulo ligado), com telefone, fora de quem pediu "não quero ser analisado" e sem prêmio deste gatilho nos
   * últimos N dias da regra, ganham o prêmio — TODA condição no `where` (V84). A referência é o cliente e o DIA da operação:
   * duas réplicas no mesmo dia não dão dois (o índice único), e o "N dias" vale pela última vez que ganhou. Lote por passada.
   */
  async darPelaClassificacao(): Promise<number> {
    const chave = sqlChaveTelefone(sql`c.telefone`);
    const segs = sql`cc.surpresa_gatilhos #> '{classificacao,segmentos}'`;
    const candidatos = this.rows(
      await this.db.execute(sql`
        select cp.cliente_id, cp.tenant_id, ${chave} as chave, cc.surpresa_forma as forma,
               pr.id as premio_id, pr.nome as premio_nome, pr.tipo, pr.valor::float8 as valor, pr.teto::float8 as teto,
               pr.minimo::float8 as minimo, pr.validade_dias
          from clube_config cc
          join clube_premio pr on pr.tenant_id = cc.tenant_id and pr.excluido_em is null and pr.tipo <> 'produto'
                              and pr.id::text = cc.surpresa_gatilhos #>> '{classificacao,premioId}'
          join cliente_perfil cp on cp.tenant_id = cc.tenant_id
          join cliente c on c.id = cp.cliente_id and c.tenant_id = cp.tenant_id
         where cc.surpresa_ativo
           and cc.surpresa_gatilhos #>> '{classificacao,ativo}' = 'true'
           and exists (select 1 from modulo_ativacao m where m.tenant_id = cc.tenant_id and m.modulo = 'perfil_cliente' and m.ativo)
           and (${segs} ? cp.segmento or (${segs} ? 'atrasado' and 'atrasado' = any(cp.etiquetas)))
           and ${chave} is not null
           and not coalesce((select e.valor from cliente_escolha e
                              where e.cliente_id = cp.cliente_id and e.tenant_id = cp.tenant_id and e.escolha = 'nao_analisar'
                              order by e.em desc limit 1), false)
           and not exists (select 1 from clube_direito d
                            where d.tenant_id = cc.tenant_id and d.gatilho = 'classificacao' and d.chave_telefone = ${chave}
                              and d.criado_em > now() - make_interval(days => coalesce((cc.surpresa_gatilhos #>> '{classificacao,periodoDias}')::int, 60)))
         order by cp.tenant_id, cp.cliente_id
         limit ${LOTE_DO_ENTREGUE}`),
    );
    const hoje = hojeISO();
    let novos = 0;
    for (const c of candidatos) {
      try {
        if (await this.darDireito(c, 'classificacao', `${c.cliente_id}:${hoje}`)) novos += 1;
      } catch (err: any) {
        this.logger.warn(`prêmio pela classificação do cliente ${c.cliente_id}: ${err?.message ?? err}`);
      }
    }
    return novos;
  }

  /**
   * O direito e o cupom pessoal, na MESMA transação. O direito entra primeiro com `on conflict do nothing` no índice da
   * referência: a outra réplica que chegou junto espera e não grava nada. O código do cupom é sorteado de novo se já
   * existir na empresa (`on conflict do nothing` no índice único do código — sem abortar a transação).
   */
  private async darDireito(c: any, gatilho: 'entregue' | 'classificacao' = 'entregue', ref: string = String(c.id)): Promise<boolean> {
    const novo = await this.db.transaction((tx: any) =>
      this.criarDireito(tx, {
        tenantId: String(c.tenant_id),
        clienteId: String(c.cliente_id),
        chave: String(c.chave),
        gatilho,
        ref,
        forma: c.forma === 'roleta' ? 'roleta' : 'raspadinha',
        premio: {
          id: String(c.premio_id),
          nome: String(c.premio_nome),
          tipo: c.tipo,
          valor: Number(c.valor),
          teto: c.teto == null ? null : Number(c.teto),
          minimo: Number(c.minimo),
          validadeDias: Number(c.validade_dias),
        },
      }),
    );
    return !!novo;
  }

  /**
   * Cria o direito e o cupom pessoal DENTRO da transação de quem chama (a rotina do pedido entregue; o prêmio de desculpas,
   * que também trava o cliente e confere o limite na mesma transação). `null` = a referência já tinha direito (`on conflict`
   * no índice único — a outra réplica, ou o mesmo caso de novo). O código do cupom é sorteado de novo se já existir na
   * empresa (`on conflict do nothing` no índice único do código — sem abortar a transação).
   */
  async criarDireito(tx: any, n: NovoDireito): Promise<{ id: string; codigo: string; validoAte: string } | null> {
    const p = { ...n.premio, tipo: n.premio.tipo as Exclude<TipoDePremio, 'produto'> };
    const validoAte = validadeDoPresente(p.validadeDias);
    const codigo = codigoDoDireito();
    const [d] = this.rows(
      await tx.execute(sql`
        insert into clube_direito (tenant_id, cliente_id, chave_telefone, ferramenta, gatilho, ref, premio_id, premio_nome,
                                   premio_descricao, forma, codigo, valido_ate)
        values (${n.tenantId}::uuid, ${n.clienteId}::uuid, ${n.chave}, 'surpresa', ${n.gatilho}, ${n.ref},
                ${p.id}::uuid, ${p.nome}, ${descricaoDoPremio(p)}, ${n.forma}, ${codigo}, ${validoAte}::date)
        on conflict (tenant_id, gatilho, ref) do nothing
        returning id`),
    );
    if (!d) return null;
    let cupomId: string | null = null;
    for (let tentativa = 0; tentativa < 8 && !cupomId; tentativa += 1) {
      const [cp] = this.rows(
        await tx.execute(sql`
          insert into cupom (tenant_id, codigo, tipo, valor, teto_desconto, minimo, ativo, validade, valido_de, max_usos,
                             max_por_cliente, nome)
          values (${n.tenantId}::uuid, ${codigoDoCupom(PREFIXO_DO_CUPOM)}, ${p.tipo}, ${String(p.valor)},
                  ${p.tipo === 'percentual' && p.teto ? String(p.teto) : null}, ${p.minimo > 0 ? String(p.minimo) : null}, true,
                  ${validoAte}::date, ${dataNoFuso(new Date())}::date, 1, 1, ${`Clube · ${p.nome.slice(0, 60)}`})
          on conflict do nothing
          returning id`),
      );
      cupomId = cp?.id ?? null;
    }
    if (!cupomId) throw new Error('não consegui sortear um código de cupom livre');
    await tx.execute(sql`
      insert into cupom_regra (cupom_id, tenant_id, cliente_id, chave_telefone)
      values (${cupomId}::uuid, ${n.tenantId}::uuid, ${n.clienteId}::uuid, ${n.chave})`);
    await tx.execute(sql`update clube_direito set cupom_id = ${cupomId}::uuid where id = ${d.id}::uuid`);
    return { id: String(d.id), codigo, validoAte };
  }

  // ───────────────────────── A campanha com prêmio surpresa (A1d, mig 477) ─────────────────────────

  /**
   * O prêmio de UM destinatário da campanha, na hora de mandar a ele: o direito (gatilho "campanha", referência = o envio)
   * com o cupom pessoal, na mesma transação. O cadastro do cliente: o do envio; sem ele, o mais recente com a chave do
   * telefone; sem nenhum, nasce agora (o cupom pessoal pede um). Idempotente pelo envio: mandar de novo não dá outro.
   * Devolve o link pessoal (`/p/…`), também quando o direito já existia.
   */
  async darPelaCampanha(e: { tenantId: string; envioId: string; clienteId: string | null; telefone: string; premioId: string }): Promise<string> {
    const chave = chaveTelefone(e.telefone);
    if (!chave) throw new Error('o destinatário não tem um telefone que dê para ligar ao cadastro');
    const ja = await this.linkDaCampanha(e.envioId, e.tenantId);
    if (ja) return ja;
    const [p] = this.rows(
      await this.db.execute(sql`
        select id, nome, tipo, valor::float8 as valor, teto::float8 as teto, minimo::float8 as minimo, validade_dias
          from clube_premio where id = ${e.premioId}::uuid and tenant_id = ${e.tenantId}::uuid and excluido_em is null`),
    );
    if (!p || p.tipo === 'produto') throw new Error('o prêmio da campanha não existe mais (ou é produto grátis)');
    const config = await this.clube.config(e.tenantId);
    const novo = await this.db.transaction(async (tx: any) => {
      let cliente = e.clienteId;
      if (!cliente) {
        const [c] = this.rows(
          await tx.execute(sql`
            select id from cliente where tenant_id = ${e.tenantId}::uuid and ${sqlChaveTelefone(sql`telefone`)} = ${chave}
             order by ultimo_pedido_em desc nulls last, criado_em limit 1`),
        );
        cliente = c?.id ? String(c.id) : null;
      }
      if (!cliente) {
        const [c] = this.rows(
          await tx.execute(sql`insert into cliente (tenant_id, telefone) values (${e.tenantId}::uuid, ${telefoneCadastro(e.telefone)}) returning id`),
        );
        cliente = String(c.id);
      }
      return this.criarDireito(tx, {
        tenantId: e.tenantId,
        clienteId: cliente,
        chave,
        gatilho: 'campanha',
        ref: e.envioId,
        forma: config.surpresaForma,
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
    });
    if (novo) return ClubeSurpresaService.linkDoDireito(novo.codigo);
    const depois = await this.linkDaCampanha(e.envioId, e.tenantId); // outra réplica criou junto
    if (!depois) throw new Error('o prêmio da campanha não foi criado');
    return depois;
  }

  /** O link pessoal do prêmio de um envio de campanha (o clique da campanha leva a ele), ou `null` sem prêmio. */
  async linkDaCampanha(envioId: string, tenantId?: string): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/i.test(String(envioId ?? ''))) return null;
    const [d] = this.rows(
      await this.db.execute(sql`
        select codigo from clube_direito
         where gatilho = 'campanha' and ref = ${envioId} ${tenantId ? sql`and tenant_id = ${tenantId}::uuid` : sql``}
         limit 1`),
    );
    return d ? ClubeSurpresaService.linkDoDireito(String(d.codigo)) : null;
  }

  // ───────────────────────── O link pessoal (`/p/…`) ─────────────────────────

  /** O link pessoal do prêmio (o gatilho que não tem pedido: a reclamação; depois a classificação e a campanha). */
  static linkDoDireito(codigo: string): string {
    return `${APP()}/p/${codigo}`;
  }

  private async direitoDoLink(codigo: unknown) {
    const c = String(codigo ?? '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(c)) throw new NotFoundException('Prêmio não encontrado.');
    const [d] = this.rows(
      await this.db.execute(sql`
        select d.id, d.tenant_id, d.forma, d.premio_nome, d.premio_descricao, d.valido_ate, d.revelado_em, cp.codigo,
               exists (select 1 from cupom_uso u where u.cupom_id = d.cupom_id) as usado
          from clube_direito d
          left join cupom cp on cp.id = d.cupom_id
         where d.codigo = ${c}`),
    );
    if (!d) throw new NotFoundException('Prêmio não encontrado.');
    return d;
  }

  /** O nome da loja e o endereço do cardápio (a página do link não tem o pedido para mostrar de onde é). */
  private async daLoja(tenantId: string): Promise<{ loja: string | null; cardapio: string | null }> {
    const [l] = this.rows(
      await this.db.execute(sql`
        select coalesce(nullif(trim(cc.nome_publico), ''), e.nome) as nome, cc.token
          from empresa e
          left join cardapio_config cc on cc.tenant_id = e.id and cc.token is not null
         where e.id = ${tenantId}::uuid
         order by (cc.unidade_id is null) desc nulls last
         limit 1`),
    );
    return { loja: l?.nome ?? null, cardapio: l?.token ? `${APP()}/c/${l.token}` : null };
  }

  /** `GET /clube/premio/:codigo` — o prêmio do link pessoal. Antes de revelar, sem dizer qual. */
  async doLink(codigo: unknown): Promise<PremioDoPedido> {
    const d = await this.direitoDoLink(codigo);
    const base = await this.montar({ tenantId: String(d.tenant_id) }, d, d.revelado_em != null);
    return { ...base, ...(await this.daLoja(String(d.tenant_id))) } as PremioDoPedido;
  }

  /** `POST /clube/premio/:codigo/revelar` — como o da página do pedido. */
  async revelarPeloLink(codigo: unknown): Promise<PremioDoPedido> {
    const d = await this.direitoDoLink(codigo);
    if (d.revelado_em == null)
      await this.db.execute(sql`update clube_direito set revelado_em = clock_timestamp() where id = ${d.id}::uuid and revelado_em is null`);
    const base = await this.montar({ tenantId: String(d.tenant_id) }, d, true);
    return { ...base, ...(await this.daLoja(String(d.tenant_id))) } as PremioDoPedido;
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

  private async montar(ped: { tenantId: string }, d: any, revelado: boolean): Promise<PremioDoPedido> {
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
