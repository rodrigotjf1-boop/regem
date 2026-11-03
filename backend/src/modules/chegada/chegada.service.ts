import { BadRequestException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ehServidorLocal } from '../../common/modo';
import { hojeISO, horaNoFuso } from '../../common/data';
import { FUSO_SQL } from '../../common/fuso-sql';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';
import { verificarCliente } from '../cliente/cliente-token';
import {
  AjusteCheguei,
  ajusteDaLinha,
  AJUSTE_CHEGUEI_PADRAO,
  lerCheguei,
  lerOnde,
  limparObs,
  Onde,
  Origem,
  primeiroNome,
  Situacao,
  STATUS_ESPERANDO,
  textoDaResposta,
} from './chegada';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Chegada = {
  pedidoId: string;
  unidadeId: string | null;
  chegouEm: string;
  deNovoEm: string | null;
  onde: Onde | null;
  obs: string | null;
  origem: Origem;
};

/** O que as telas da loja recebem (a Retirada, o aviso em qualquer tela). */
export type ChegadaNaTela = Chegada & { numero: string; nome: string; pronto: boolean };

const rows = (r: any): any[] => r?.rows ?? r ?? [];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const iso = (d: unknown): string | null => (d == null ? null : new Date(d as any).toISOString());
/** O último aviso do cliente (o primeiro "cheguei" ou o "avisar de novo"). */
const ultimoAviso = (c: Chegada) => Date.parse(c.deNovoEm ?? c.chegouEm);
/** O cache da nuvem no servidor da loja: o mesmo ritmo do mapa dos entregadores (`entregadores-ao-vivo.service.ts`). */
const CACHE_MS = 10_000;
const CACHE_FALHA_MS = 5_000;
/** Erro repetido de leitura (tabela que ainda não chegou, banco caindo) vai ao log no máximo a cada 10 min. */
const LOG_A_CADA_MS = 10 * 60_000;

// "CHEGUEI" NA RETIRADA (Onda 3, mig 354). Quem ESCREVE é só a nuvem — o cardápio online (botão da página do pedido) e
// o WhatsApp (botão do aviso de pronto, ou o cliente escrevendo "cheguei") rodam lá. A tabela desce para o servidor da
// loja pelo sync; como o pull leva até 1 min, o servidor da loja também PEDE À NUVEM as chegadas das últimas horas (a cada
// 10 s, sem esperar: a tela nunca fica parada pela internet — V37) e junta com a cópia local.
@Injectable()
export class ChegadaService {
  private readonly logger = new Logger('Chegada');
  private readonly nuvem = new Map<string, { ate: number; linhas: Chegada[]; buscando: boolean }>();
  private logadoEm = 0;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // Quem mudou o ajuste fica na auditoria. Opcional: os testes montam o serviço sem ela.
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  // ===================== Ajustes (cardapio_config da loja; sem linha dela, a da empresa) =====================

  private async linhaDoAjuste(tenantId: string, unidadeId: string | null) {
    const r = rows(
      await this.db.execute(sql`
        select id, unidade_id, cheguei_ativo, cheguei_perguntar_onde, cheguei_todas_telas, cheguei_de_novo_min
          from cardapio_config
         where tenant_id = ${tenantId}::uuid
           and (${unidadeId && UUID.test(unidadeId) ? sql`unidade_id = ${unidadeId}::uuid or ` : sql``}unidade_id is null)
         order by (unidade_id is null), id
         limit 1`),
    );
    return r[0] ?? null;
  }

  /** O ajuste da loja (a mesma herança do código de entrega, mig 348: a linha da loja, senão a da empresa). */
  async ajusteDaLoja(tenantId: string, unidadeId: string | null): Promise<AjusteCheguei> {
    return ajusteDaLinha(await this.linhaDoAjuste(tenantId, unidadeId));
  }

  /** O ajuste para a tela de ajustes, e se a loja tem cardápio online (sem ele não há onde gravar nem botão). */
  async ajustes(tenantId: string, unidadeId: string | null): Promise<AjusteCheguei & { temCardapio: boolean }> {
    const row = await this.linhaDoAjuste(tenantId, unidadeId);
    return { ...ajusteDaLinha(row), temCardapio: !!row };
  }

  /**
   * Grava só os campos que vieram (V16) e só as colunas deles — dois salvamentos ao mesmo tempo não desfazem um ao
   * outro. Quem mudou e de quê para quê fica na auditoria. Sem cardápio online: recusa, com o caminho para criar.
   */
  async salvarAjustes(user: AuthUser, unidadeId: string | null, parcial: Partial<AjusteCheguei>): Promise<void> {
    const row = await this.linhaDoAjuste(user.tenantId, unidadeId);
    if (!row)
      throw new BadRequestException(
        'A loja ainda não tem cardápio online: o "Cheguei" mora nele (Delivery › Configurações › Cardápio).',
      );
    const antes = ajusteDaLinha(row);
    const mudou = (Object.keys(parcial) as (keyof AjusteCheguei)[]).filter((k) => parcial[k] !== antes[k]);
    if (!mudou.length) return;
    const colunas: Record<keyof AjusteCheguei, string> = {
      ativo: 'cheguei_ativo',
      perguntarOnde: 'cheguei_perguntar_onde',
      todasTelas: 'cheguei_todas_telas',
      deNovoMin: 'cheguei_de_novo_min',
    };
    const sets = mudou.map((k) => sql`${sql.raw(colunas[k])} = ${parcial[k] as any}`);
    await this.db.execute(sql`
      update cardapio_config set ${sql.join(sets, sql`, `)}, updated_at = now()
       where id = ${row.id}::uuid and tenant_id = ${user.tenantId}::uuid`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      unidadeId: row.unidade_id ?? null,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'ajustou_cheguei',
      origem: 'atendimento',
      entidadeTipo: 'cardapio_config',
      entidadeId: row.id,
      detalhe: {
        de: Object.fromEntries(mudou.map((k) => [k, antes[k]])),
        para: Object.fromEntries(mudou.map((k) => [k, parcial[k]])),
      },
    });
  }

  // ===================== Registrar (só a NUVEM escreve) =====================

  private chegadaDaLinha(l: any): Chegada {
    return {
      pedidoId: String(l.id),
      unidadeId: l.unidade_id ? String(l.unidade_id) : null,
      chegouEm: iso(l.chegou_em) as string,
      deNovoEm: iso(l.de_novo_em),
      onde: l.onde === 'balcao' || l.onde === 'porta' ? l.onde : null,
      obs: l.obs ? String(l.obs) : null,
      origem: l.origem === 'whatsapp' ? 'whatsapp' : 'cardapio',
    };
  }

  /**
   * Um "cheguei". Uma linha por pedido, numa gravação só (duas réplicas da API ou dois toques ao mesmo tempo dão a mesma
   * linha): o PRIMEIRO cria (`novo`); depois do tempo do ajuste, o seguinte é um "avisar de novo" (`de_novo`); antes
   * disso não avisa ninguém (`ja_avisado`) — só atualiza onde o cliente está, se ele disse outra coisa.
   */
  async registrar(p: {
    tenantId: string;
    unidadeId: string | null;
    pedidoId: string;
    origem: Origem;
    onde: Onde | null;
    obs: string | null;
    deNovoMin: number;
  }): Promise<{ situacao: Situacao; chegada: Chegada }> {
    const min = String(Math.max(1, Math.round(Number(p.deNovoMin) || AJUSTE_CHEGUEI_PADRAO.deNovoMin)));
    const venceu = sql`coalesce(pedido_chegada.de_novo_em, pedido_chegada.chegou_em) <= now() - (${min}::int * interval '1 minute')`;
    const r = rows(
      await this.db.execute(sql`
        insert into pedido_chegada (id, tenant_id, unidade_id, chegou_em, onde, obs, origem)
        values (${p.pedidoId}::uuid, ${p.tenantId}::uuid, ${p.unidadeId}::uuid, now(), ${p.onde}, ${p.obs}, ${p.origem})
        on conflict (id) do update set
          de_novo_em = case when ${venceu} then now() else pedido_chegada.de_novo_em end,
          onde = coalesce(excluded.onde, pedido_chegada.onde),
          obs = coalesce(excluded.obs, pedido_chegada.obs)
        where pedido_chegada.tenant_id = excluded.tenant_id
          and (${venceu}
               or (excluded.onde is not null and excluded.onde is distinct from pedido_chegada.onde)
               or (excluded.obs is not null and excluded.obs is distinct from pedido_chegada.obs))
        returning id, unidade_id, chegou_em, de_novo_em, onde, obs, origem,
                  (xmax = 0) as inserida, coalesce(de_novo_em = now(), false) as de_novo`),
    );
    if (r[0]) {
      const situacao: Situacao = r[0].inserida ? 'novo' : r[0].de_novo ? 'de_novo' : 'ja_avisado';
      return { situacao, chegada: this.chegadaDaLinha(r[0]) };
    }
    // A condição da gravação não passou: o cliente já tinha avisado há pouco e não mudou nada.
    const atual = rows(
      await this.db.execute(sql`
        select id, unidade_id, chegou_em, de_novo_em, onde, obs, origem from pedido_chegada
         where id = ${p.pedidoId}::uuid and tenant_id = ${p.tenantId}::uuid`),
    )[0];
    if (!atual) throw new NotFoundException('Pedido não encontrado.');
    return { situacao: 'ja_avisado', chegada: this.chegadaDaLinha(atual) };
  }

  /** O que a página do pedido mostra da chegada (sem o "como te achar": a página abre só com o link do pedido). */
  paraOCliente(c: Chegada | null, ajuste: AjusteCheguei) {
    if (!c) return null;
    return {
      chegouEm: c.chegouEm,
      deNovoEm: c.deNovoEm,
      onde: c.onde,
      podeDeNovoEm: new Date(ultimoAviso(c) + ajuste.deNovoMin * 60_000).toISOString(),
    };
  }

  // ===================== Pelo cardápio online (a página do pedido e Sua conta) =====================

  /**
   * O botão "Cheguei". Prova de dono como o cancelamento da encomenda: o `ref` do link do pedido OU o token do cliente
   * de Sua conta — o id do pedido e o token do cardápio sozinhos não provam nada (V79).
   */
  async porCardapio(token: string, pedidoId: string, dto: any) {
    const cfg = rows(
      await this.db.execute(sql`select tenant_id, ativo from cardapio_config where token = ${String(token ?? '')} limit 1`),
    )[0];
    if (!cfg || cfg.ativo !== true) throw new NotFoundException('Cardápio indisponível.');
    if (!UUID.test(String(pedidoId ?? ''))) throw new NotFoundException('Pedido não encontrado.');
    const p = rows(
      await this.db.execute(sql`
        select id, unidade_id, tipo, status, client_ref, cliente_id, deleted_at,
               ((coalesce(agendamento, criado_em) at time zone ${FUSO_SQL})::date = ${hojeISO()}::date) as hoje
          from pedido_externo
         where id = ${pedidoId}::uuid and tenant_id = ${cfg.tenant_id}::uuid`),
    )[0];
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    const cli = verificarCliente(typeof dto?.clienteToken === 'string' ? dto.clienteToken : undefined);
    const donoPorToken = !!(cli && cli.tenant === String(cfg.tenant_id) && p.cliente_id && cli.cli === String(p.cliente_id));
    const ref = typeof dto?.ref === 'string' ? dto.ref : '';
    const donoPorRef = !!(ref && p.client_ref && ref === String(p.client_ref));
    if (!donoPorToken && !donoPorRef) throw new NotFoundException('Pedido não encontrado.');
    if (p.tipo !== 'retirada') throw new BadRequestException('O "Cheguei" é para pedido de retirada.');
    if (p.deleted_at || !(STATUS_ESPERANDO as readonly string[]).includes(String(p.status)))
      throw new BadRequestException('Este pedido já foi retirado ou cancelado.');
    if (p.hoje !== true) throw new BadRequestException('O "Cheguei" vale no dia da retirada.');
    const tenantId = String(cfg.tenant_id);
    const unidadeId = p.unidade_id ? String(p.unidade_id) : null;
    const ajuste = await this.ajusteDaLoja(tenantId, unidadeId);
    if (!ajuste.ativo) throw new BadRequestException('Esta loja não usa o "Cheguei".');
    const onde = ajuste.perguntarOnde ? lerOnde(dto?.onde) : null;
    const obs = ajuste.perguntarOnde ? limparObs(dto?.obs) : null;
    const { situacao, chegada } = await this.registrar({
      tenantId,
      unidadeId,
      pedidoId: String(p.id),
      origem: 'cardapio',
      onde,
      obs,
      deNovoMin: ajuste.deNovoMin,
    });
    return { situacao, pronto: p.status === 'pronto', chegada: this.paraOCliente(chegada, ajuste) };
  }

  /** O bloco "cheguei" da página do pedido (status do cardápio): só para pedido de retirada. Nunca rejeita. */
  async daPaginaDoPedido(tenantId: string, pedido: { id: string; unidadeId?: string | null; tipo?: string | null }) {
    if (pedido?.tipo !== 'retirada') return null;
    try {
      const ajuste = await this.ajusteDaLoja(tenantId, pedido.unidadeId ?? null);
      if (!ajuste.ativo) return { ativo: false };
      const l = rows(
        await this.db.execute(sql`
          select id, unidade_id, chegou_em, de_novo_em, onde, obs, origem from pedido_chegada
           where id = ${pedido.id}::uuid and tenant_id = ${tenantId}::uuid`),
      )[0];
      return {
        ativo: true,
        perguntarOnde: ajuste.perguntarOnde,
        deNovoMin: ajuste.deNovoMin,
        chegada: this.paraOCliente(l ? this.chegadaDaLinha(l) : null, ajuste),
      };
    } catch (e: any) {
      this.logar(`página do pedido sem o "Cheguei" (${e?.code ?? e?.message ?? e})`);
      return null;
    }
  }

  // ===================== Pelo WhatsApp (o botão do aviso de pronto, ou o cliente escrevendo) =====================

  /**
   * O portão do "cheguei" no WhatsApp — antes do robô e da pausa, como a resposta ao "sem contato": vale com o robô
   * ligado ou não. Só trata a mensagem que ABRE com uma frase de chegada (curta) E de quem tem pedido de RETIRADA
   * esperando hoje, numa loja que usa o "Cheguei"; o resto segue o caminho de sempre.
   */
  async porWhatsapp(
    tenantId: string,
    telefone: string,
    texto: unknown,
  ): Promise<{ tratou: boolean; responder?: string; pedidoIds?: string[] }> {
    const lido = lerCheguei(texto);
    if (!lido.ok) return { tratou: false };
    const chave = chaveTelefone(telefone);
    if (!chave) return { tratou: false };
    const pedidos = rows(
      await this.db.execute(sql`
        select p.id, p.unidade_id, p.status, p.cliente_nome, p.display_id, p.numero
          from pedido_externo p
         where p.tenant_id = ${tenantId}::uuid and p.tipo = 'retirada' and p.deleted_at is null
           and p.status in ('novo', 'confirmado', 'pronto')
           and ${sqlChaveTelefone(sql`p.cliente_telefone`)} = ${chave}
           and (coalesce(p.agendamento, p.criado_em) at time zone ${FUSO_SQL})::date = ${hojeISO()}::date
         order by p.criado_em desc
         limit 5`),
    );
    if (!pedidos.length) return { tratou: false };
    const ajustes = new Map<string, AjusteCheguei>();
    const feitos: { p: any; situacao: Situacao; chegada: Chegada }[] = [];
    for (const p of pedidos) {
      const loja = p.unidade_id ? String(p.unidade_id) : null;
      const k = loja ?? '';
      if (!ajustes.has(k)) ajustes.set(k, await this.ajusteDaLoja(tenantId, loja));
      const aj = ajustes.get(k) as AjusteCheguei;
      if (!aj.ativo) continue;
      const r = await this.registrar({
        tenantId,
        unidadeId: loja,
        pedidoId: String(p.id),
        origem: 'whatsapp',
        onde: null,
        obs: lido.resto || null,
        deNovoMin: aj.deNovoMin,
      });
      feitos.push({ p, ...r });
    }
    if (!feitos.length) return { tratou: false };
    const { p, situacao, chegada } = feitos[0];
    return {
      tratou: true,
      pedidoIds: feitos.map((f) => String(f.p.id)),
      responder: textoDaResposta({
        situacao,
        nome: p.cliente_nome,
        numero: p.display_id != null ? String(p.display_id) : p.numero != null ? String(p.numero) : null,
        pronto: p.status === 'pronto',
        hora: horaNoFuso(new Date(chegada.chegouEm)),
      }),
    };
  }

  // ===================== Para as telas da loja =====================

  private logar(msg: string) {
    const agora = Date.now();
    if (agora - this.logadoEm < LOG_A_CADA_MS) return;
    this.logadoEm = agora;
    this.logger.warn(msg);
  }

  /**
   * As chegadas das últimas 18 h da loja, por id do pedido. No servidor da loja, junta a cópia local com o que a nuvem
   * já sabe (a mais nova de cada pedido vence). Nunca rejeita: a Retirada e o KDS não podem cair por isso.
   */
  async mapaDaLoja(tenantId: string, unidadeId: string | null): Promise<Map<string, Chegada>> {
    const mapa = new Map<string, Chegada>();
    const daLoja = (c: Chegada) => !unidadeId || !c.unidadeId || c.unidadeId === unidadeId;
    try {
      for (const l of rows(
        await this.db.execute(sql`
          select id, unidade_id, chegou_em, de_novo_em, onde, obs, origem from pedido_chegada
           where tenant_id = ${tenantId}::uuid and chegou_em > now() - interval '18 hours'`),
      )) {
        const c = this.chegadaDaLinha(l);
        if (daLoja(c)) mapa.set(c.pedidoId, c);
      }
    } catch (e: any) {
      this.logar(`chegadas sem a tabela local (${e?.code ?? e?.message ?? e}) — as telas seguem sem a marca`);
    }
    if (ehServidorLocal())
      for (const c of this.daNuvem(tenantId)) {
        if (!daLoja(c)) continue;
        const a = mapa.get(c.pedidoId);
        if (!a || ultimoAviso(c) > ultimoAviso(a) || (c.onde && !a.onde) || (c.obs && c.obs !== a.obs)) mapa.set(c.pedidoId, c);
      }
    return mapa;
  }

  /** A última leitura da nuvem (servidor da loja). Pede de novo quando venceu, SEM esperar — quem lê não fica parado. */
  private daNuvem(tenantId: string): Chegada[] {
    const agora = Date.now();
    let item = this.nuvem.get(tenantId);
    if (!item) {
      item = { ate: 0, linhas: [], buscando: false };
      this.nuvem.set(tenantId, item);
    }
    if (item.ate <= agora && !item.buscando) {
      item.buscando = true;
      const alvo = item;
      void this.buscarNaNuvem(tenantId).then((r) => {
        alvo.buscando = false;
        if ('linhas' in r) {
          alvo.linhas = r.linhas;
          alvo.ate = Date.now() + CACHE_MS;
        } else {
          alvo.ate = Date.now() + CACHE_FALHA_MS;
          this.logar(`chegadas sem a nuvem (${r.motivo}) — a Retirada e o KDS mostram o que já desceu pelo sync`);
        }
      });
    }
    return item.linhas;
  }

  /** GET na nuvem com o token de sync deste servidor (como o mapa dos entregadores). Nunca rejeita (V3). */
  private async buscarNaNuvem(tenantId: string): Promise<{ linhas: Chegada[] } | { motivo: string }> {
    try {
      const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
      const token = process.env.SYNC_TOKEN ?? '';
      if (!nuvem || !token) return { motivo: 'sem CLOUD_API/SYNC_TOKEN no servidor da loja' };
      const res = await fetch(`${nuvem}/delivery/chegadas/loja`, {
        headers: { 'x-sync-token': token },
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) return { motivo: `HTTP ${res.status}` };
      const j: any = await res.json();
      if (!Array.isArray(j?.chegadas)) return { motivo: 'a nuvem respondeu sem a lista' };
      if (j?.tenantId !== tenantId) return { motivo: 'a nuvem respondeu por outra empresa' };
      return {
        linhas: j.chegadas
          .filter((c: any) => UUID.test(String(c?.pedidoId ?? '')) && c?.chegouEm)
          .map((c: any) =>
            this.chegadaDaLinha({
              id: c.pedidoId,
              unidade_id: c.unidadeId,
              chegou_em: c.chegouEm,
              de_novo_em: c.deNovoEm,
              onde: c.onde,
              obs: c.obs,
              origem: c.origem,
            }),
          ),
      };
    } catch (e: any) {
      return { motivo: e?.cause?.code ?? e?.name ?? e?.message ?? String(e) };
    }
  }

  /** A rota da NUVEM que o servidor da loja chama (token de sync): as chegadas das últimas 18 h da loja dele. */
  async paraOServidorDaLoja(tenantId: string, unidadeId: string | null) {
    const linhas = rows(
      await this.db.execute(sql`
        select id, unidade_id, chegou_em, de_novo_em, onde, obs, origem from pedido_chegada
         where tenant_id = ${tenantId}::uuid and chegou_em > now() - interval '18 hours'
           ${unidadeId && UUID.test(unidadeId) ? sql`and (unidade_id = ${unidadeId}::uuid or unidade_id is null)` : sql``}
         order by chegou_em desc
         limit 300`),
    );
    return { tenantId, chegadas: linhas.map((l) => this.chegadaDaLinha(l)) };
  }

  /**
   * Para o aviso em qualquer tela e o quadro "Clientes esperando": as chegadas dos pedidos que ainda esperam o cliente,
   * de quem esperou mais para quem chegou agora. Com o "Cheguei" desligado, só o ajuste (a tela para de perguntar).
   */
  async paraAsTelas(tenantId: string, unidadeId: string | null) {
    const ajuste = await this.ajusteDaLoja(tenantId, unidadeId);
    const base = { ativo: ajuste.ativo, todasTelas: ajuste.todasTelas, deNovoMin: ajuste.deNovoMin };
    if (!ajuste.ativo) return { ...base, chegadas: [] as ChegadaNaTela[] };
    const mapa = await this.mapaDaLoja(tenantId, unidadeId);
    const ids = [...mapa.keys()].filter((x) => UUID.test(x));
    if (!ids.length) return { ...base, chegadas: [] as ChegadaNaTela[] };
    const pedidos = rows(
      await this.db.execute(sql`
        select id, status, cliente_nome, display_id, numero from pedido_externo
         where tenant_id = ${tenantId}::uuid and id = any(${`{${ids.join(',')}}`}::uuid[])
           and status in ('novo', 'confirmado', 'pronto') and deleted_at is null`),
    );
    const chegadas: ChegadaNaTela[] = pedidos
      .map((p) => ({
        ...(mapa.get(String(p.id)) as Chegada),
        numero: p.display_id != null ? String(p.display_id) : p.numero != null ? String(p.numero) : '',
        nome: primeiroNome(p.cliente_nome),
        pronto: p.status === 'pronto',
      }))
      .sort((a, b) => Date.parse(a.chegouEm) - Date.parse(b.chegouEm));
    return { ...base, chegadas };
  }

  /** As chegadas dos cartões do KDS (o KDS enxerga a comanda, não o pedido — como a logística da 99). Nunca rejeita. */
  async porComanda(tenantId: string, unidadeId: string | null, comandaIds: string[]): Promise<Map<string, Chegada>> {
    const res = new Map<string, Chegada>();
    const ids = [...new Set((comandaIds ?? []).map(String).filter((x) => UUID.test(x)))];
    if (!ids.length) return res;
    try {
      const mapa = await this.mapaDaLoja(tenantId, unidadeId);
      if (!mapa.size) return res;
      const r = rows(
        await this.db.execute(sql`
          select id, comanda_id from pedido_externo
           where tenant_id = ${tenantId}::uuid and tipo = 'retirada'
             and comanda_id = any(${`{${ids.join(',')}}`}::uuid[])`),
      );
      for (const p of r) {
        const c = mapa.get(String(p.id));
        if (c) res.set(String(p.comanda_id), c);
      }
    } catch (e: any) {
      this.logar(`KDS sem a marca do "Cheguei" (${e?.code ?? e?.message ?? e})`);
    }
    return res;
  }
}
