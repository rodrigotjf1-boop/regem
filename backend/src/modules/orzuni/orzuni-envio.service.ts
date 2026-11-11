import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { DRIZZLE, DrizzleDB, resolverSsl } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ClienteDmsId, ClienteMcp, ErroMcp } from '../../dms/integracao-dms';
import { decifrar } from '../../common/cifra-segredo';
import { ehServidorLocal } from '../../common/modo';
import { versaoNoAr } from '../integracao-api/hub.regras';
import {
  ConfigOrzuni,
  DESISTIR_DEPOIS_HORAS,
  Desfecho,
  PERMISSOES_ORZUNI,
  RESERVA_MINUTOS,
  chaveDoEnvio,
  desfechoDaRecusa,
  desfechoDoResultado,
  lerConfigOrzuni,
  recuoMinutos,
} from './orzuni.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Uma linha da fila `orzuni_envio` já reservada para este processo. */
type Envio = {
  id: string;
  tenant_id: string;
  unidade_id: string;
  tipo: 'preco_item' | 'status_item' | 'preco_opcao' | 'status_opcao';
  ref_id: string;
  versao: number;
  tentativas: number;
};

/** O que mandar à porta (ou por que não mandar). */
type Chamada = { ferramenta: string; argumentos: Record<string, unknown> } | { dispensar: string };

export type ResumoDoDespacho = { enviados: number; dispensados: number; adiados: number; desistidos: number };

const LOTE = 50;

/**
 * O ENVIO ao iFood pela porta MCP do Orzuni (R2a; mig 370). A fila é gravada pelos gatilhos do banco na MESMA transação
 * da mudança (a tela da nuvem e o sincronismo da loja entram iguais); aqui ela sai:
 *  • na hora, acordada pelo `pg_notify('orzuni_envio')` (um LISTEN por processo, como `impressao-sinal.service.ts`);
 *  • e pela rotina de 15 s, que pega o que o aviso não acordou (sem LISTEN: pooler, queda) e as novas tentativas.
 * Não é consulta ao iFood: só a fila local, por índice, e só o que pode sair (V84).
 *
 * Cada envio lê o valor NA HORA (edições seguidas viram um envio, com o mais novo) e passa pela régua de "acesso vale"
 * (V75): empresa e loja vivas, ligação viva da loja e o direito `ifood_pelo_orzuni` ligado — senão é DISPENSADO com o
 * motivo, sem chamar a porta. A chave de idempotência é a linha + a versão (`chaveDoEnvio`).
 *
 * Só NUVEM (o servidor da loja não tem as tabelas; a `@Cron` também sobe lá e volta na primeira linha). Desligado sem
 * `ORZUNI_LIGADO=true`: a fila espera, nada se perde. Uma empresa com problema não segura as outras (V25): só a porta
 * fora para DUAS empresas encerra a volta.
 */
@Injectable()
export class OrzuniEnvioService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('OrzuniEnvio');
  /** O fetch das duas pontas (DMS ID e porta) — os testes trocam por um falso. */
  buscar: typeof fetch = fetch;
  private dmsId: { chave: string; cliente: ClienteDmsId } | null = null;
  private ouvinte: Client | null = null;
  private parado = false;
  private falhas = 0;
  private rodando = false;
  private deNovo = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'test' || ehServidorLocal()) return;
    const c = lerConfigOrzuni();
    if (!c.envioLigado) {
      if (process.env.ORZUNI_LIGADO === 'true' && c.motivo) this.log.error(`envio ao Orzuni desligado: ${c.motivo}`);
      return;
    }
    void this.ouvir();
  }

  async onModuleDestroy() {
    this.parado = true;
    await this.ouvinte?.end().catch(() => {});
  }

  // A rotina: pega o que o aviso não acordou e as tentativas adiadas. Também sobe no servidor da loja: volta já.
  @Cron('*/15 * * * * *')
  rotina() {
    if (ehServidorLocal()) return;
    void this.acordar();
  }

  /** Despacha a fila agora. Nunca rejeita (V3). Se já está rodando, roda de novo ao terminar. */
  async acordar(): Promise<void> {
    if (this.rodando) {
      this.deNovo = true;
      return;
    }
    this.rodando = true;
    try {
      // Lote cheio = pode haver mais na fila: segue até esvaziar (com teto, para não prender o processo).
      for (let voltas = 0; voltas < 40 && !this.parado; voltas++) {
        this.deNovo = false;
        const r = await this.processar();
        const vistos = r.enviados + r.dispensados + r.adiados + r.desistidos;
        if (vistos < LOTE && !this.deNovo) break;
      }
    } catch (e: any) {
      this.log.error(`despacho do Orzuni falhou: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Uma volta do despacho. `tenantIds` restringe às empresas dadas (testes: o CI divide o banco — V32).
   * Devolve quantos foram enviados, dispensados, adiados e desistidos.
   */
  async processar(o: { tenantIds?: string[]; limite?: number } = {}): Promise<ResumoDoDespacho> {
    const resumo: ResumoDoDespacho = { enviados: 0, dispensados: 0, adiados: 0, desistidos: 0 };
    if (ehServidorLocal()) return resumo;
    const cfg = lerConfigOrzuni();
    if (!cfg.envioLigado) return resumo;
    const lote = await this.reservar(o.tenantIds, o.limite ?? LOTE);
    if (!lote.length) return resumo;

    const foraPor = new Set<string>(); // empresas cuja chamada não teve resposta da porta (ou do DMS ID)
    const noLimite = new Map<string, number>(); // ligação → minutos até poder de novo
    for (let i = 0; i < lote.length; i++) {
      const envio = lote[i];
      if (foraPor.size >= 2) {
        // A porta (ou o DMS ID) está fora para duas empresas: devolve o resto à fila, sem gastar tentativa.
        await this.devolver(lote.slice(i));
        resumo.adiados += lote.length - i;
        break;
      }
      try {
        const r = await this.enviarUm(envio, cfg, noLimite);
        resumo[r]++;
        if (r === 'adiados' && this.ultimoFora) foraPor.add(envio.tenant_id);
      } catch (e: any) {
        // Erro do próprio Regem nesta linha (banco, segredo): registra e segue com as outras empresas.
        this.log.error(`envio ${envio.id} (${envio.tipo}): ${e?.message ?? e}`);
        await this.adiar(envio, recuoMinutos(envio.tentativas), `erro no Regem: ${String(e?.message ?? e).slice(0, 200)}`);
        resumo.adiados++;
      }
    }
    return resumo;
  }

  // ── reserva e desfecho na fila ────────────────────────────────────────────────────────────────────────────────

  private async reservar(tenantIds: string[] | undefined, limite: number): Promise<Envio[]> {
    // Lista em SQL: `sql.join` (V31) — o `${lista}` cru vira um parâmetro por item.
    const escopo = tenantIds?.length
      ? sql`and tenant_id in (${sql.join(tenantIds.map((t) => sql`${t}::uuid`), sql`, `)})`
      : sql``;
    const r: any = await this.db.execute(sql`
      update orzuni_envio e
         set situacao = 'enviando',
             reservado_ate = now() + make_interval(mins => ${RESERVA_MINUTOS}),
             tentativas = e.tentativas + 1
       where e.id in (
         select id from orzuni_envio
          where situacao in ('pendente', 'enviando')
            and (situacao = 'pendente' or reservado_ate < now())
            and proxima_em <= now() ${escopo}
          order by proxima_em, id
          limit ${limite}
          for update skip locked)
      returning e.id, e.tenant_id, e.unidade_id, e.tipo, e.ref_id, e.versao, e.tentativas`);
    return ((r.rows ?? r) as any[]).map((x) => ({ ...x, versao: Number(x.versao), tentativas: Number(x.tentativas) }));
  }

  /** Termina o envio. Se a mudança andou enquanto ele saía (versão nova), volta à fila para mandar o valor novo. */
  private async finalizar(envio: Envio, d: Desfecho) {
    await this.db.execute(sql`
      update orzuni_envio
         set situacao = case when versao = ${envio.versao} then 'feito' else 'pendente' end,
             proxima_em = case when versao = ${envio.versao} then proxima_em else now() end,
             reservado_ate = null,
             enviado_em = now(),
             resultado = ${d.resultado},
             resposta = ${JSON.stringify(d.resposta)}::jsonb,
             ultimo_erro = ${d.erro}
       where id = ${envio.id}`);
  }

  /** Tenta de novo mais tarde (a MESMA chave). Passou do prazo desde a mudança: desiste, com o motivo. */
  private async adiar(envio: Envio, minutos: number, erro: string): Promise<'adiados' | 'desistidos'> {
    const r: any = await this.db.execute(sql`
      update orzuni_envio
         set situacao = case
               when versao <> ${envio.versao} then 'pendente'
               when marcado_em < now() - make_interval(hours => ${DESISTIR_DEPOIS_HORAS}) then 'desistiu'
               else 'pendente' end,
             proxima_em = case when versao <> ${envio.versao} then now()
                               else now() + make_interval(mins => ${Math.max(1, Math.ceil(minutos))}) end,
             resultado = case when versao = ${envio.versao}
                                and marcado_em < now() - make_interval(hours => ${DESISTIR_DEPOIS_HORAS})
                              then 'erro' else resultado end,
             reservado_ate = null,
             ultimo_erro = ${erro.slice(0, 300)}
       where id = ${envio.id}
      returning situacao`);
    return (r.rows ?? r)[0]?.situacao === 'desistiu' ? 'desistidos' : 'adiados';
  }

  /** Devolve à fila sem gastar a tentativa (a volta parou antes de chegar neles). */
  private async devolver(lote: Envio[]) {
    if (!lote.length) return;
    await this.db.execute(sql`
      update orzuni_envio
         set situacao = 'pendente', reservado_ate = null, tentativas = greatest(0, tentativas - 1),
             proxima_em = now() + make_interval(mins => 1)
       where id in (${sql.join(lote.map((e) => sql`${e.id}::uuid`), sql`, `)}) and situacao = 'enviando'`);
  }

  // ── um envio ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** A última falha foi "porta/DMS ID sem resposta" (conta para encerrar a volta). */
  private ultimoFora = false;

  private async enviarUm(
    envio: Envio,
    cfg: ConfigOrzuni,
    noLimite: Map<string, number>,
  ): Promise<keyof ResumoDoDespacho> {
    this.ultimoFora = false;
    // Régua de "acesso vale" (V75), lida NA HORA de mandar.
    const ctx = await this.contexto(envio);
    if (!ctx.empresaViva) return this.dispensar(envio, 'empresa excluída');
    if (!ctx.lojaViva) return this.dispensar(envio, 'loja excluída ou de outra empresa');
    if (!ctx.liberado) return this.dispensar(envio, 'o iFood pelo Orzuni está desligado nesta empresa');
    if (!ctx.ligacao) return this.dispensar(envio, 'a loja não tem ligação viva com o Orzuni');
    const espera = noLimite.get(ctx.ligacao.id);
    if (espera !== undefined) return this.adiar(envio, espera, 'limite de chamadas da ligação');

    const chamada = await this.montarChamada(envio);
    if ('dispensar' in chamada) return this.dispensar(envio, chamada.dispensar);

    let segredo: string;
    try {
      segredo = decifrar(ctx.ligacao.segredo);
    } catch {
      this.log.error(`ligação ${ctx.ligacao.id}: o segredo não abre com a SEGREDOS_CHAVE desta máquina`);
      return this.dispensar(envio, 'o segredo da ligação não abre (registre a chave de novo no console)');
    }

    const mcp = new ClienteMcp({
      endereco: cfg.endereco,
      recurso: cfg.recurso,
      permissoes: PERMISSOES_ORZUNI,
      dmsId: this.clienteDmsId(cfg),
      ligacao: segredo,
      cliente: { nome: 'regem', versao: versaoNoAr() },
      buscar: this.buscar,
      tentativas: 2,
    });
    const argumentos = { ...chamada.argumentos, chaveIdempotencia: chaveDoEnvio(envio) };
    try {
      const dados = await mcp.chamar(chamada.ferramenta, argumentos);
      const d = desfechoDoResultado(dados);
      await this.finalizar(envio, d);
      await this.anotarUso(ctx.ligacao.id);
      await this.auditar(envio, chamada, d);
      return 'enviados';
    } catch (e: any) {
      return this.tratarFalha(envio, chamada, e, ctx.ligacao.id, noLimite);
    }
  }

  private async tratarFalha(
    envio: Envio,
    chamada: { ferramenta: string; argumentos: Record<string, unknown> },
    e: any,
    ligacaoId: string,
    noLimite: Map<string, number>,
  ): Promise<keyof ResumoDoDespacho> {
    if (e instanceof ErroMcp) {
      switch (e.tipo) {
        case 'ferramenta': {
          const d = desfechoDaRecusa(e);
          if (d.repetir) return this.adiar(envio, recuoMinutos(envio.tentativas), d.erro ?? 'recusa temporária');
          await this.finalizar(envio, d);
          await this.auditar(envio, chamada, d);
          return 'enviados';
        }
        case 'ligacao':
          // A loja desfez a ligação no Orzuni: outro token não ajuda. Revoga aqui; só uma chave nova religa.
          await this.db.execute(sql`
            update orzuni_ligacao set revogada_em = now(), revogada_por = 'orzuni', revogada_motivo = 'ligacao-invalida'
             where id = ${ligacaoId} and revogada_em is null`);
          this.log.warn(`ligação ${ligacaoId} recusada pelo Orzuni (ligacao-invalida): revogada aqui`);
          return this.dispensar(envio, 'o Orzuni não reconhece mais a ligação da loja (registre a chave de novo)');
        case 'limite': {
          const seg = Number(e.retryAfter);
          const min = Number.isFinite(seg) && seg > 0 ? seg / 60 : 1;
          noLimite.set(ligacaoId, min);
          return this.adiar(envio, min, 'limite de chamadas do Orzuni');
        }
        case 'indisponivel':
        case 'sem-resposta':
        case 'token':
          this.ultimoFora = true;
          return this.adiar(envio, recuoMinutos(envio.tentativas), `${e.tipo}${e.problema ? ` (${e.problema})` : ''}`);
        case 'recusada':
          // conta-bloqueada, ligacao-suspensa: pode voltar quando a loja religar no Orzuni.
          return this.adiar(envio, Math.max(30, recuoMinutos(envio.tentativas)), `recusada (${e.problema || e.status})`);
        default: {
          // permissão, protocolo, resposta inválida: repetir não resolve — fica registrado.
          this.log.error(`envio ${envio.id}: ${e.message}`);
          const d: Desfecho = { resultado: 'recusado', repetir: false, resposta: { tipo: e.tipo, problema: e.problema || null }, erro: e.message.slice(0, 300) };
          await this.finalizar(envio, d);
          return 'enviados';
        }
      }
    }
    // Falha do DMS ID (ErroDmsId) ou de rede antes da porta.
    this.ultimoFora = true;
    this.log.warn(`envio ${envio.id}: ${e?.message ?? e}`);
    return this.adiar(envio, recuoMinutos(envio.tentativas), String(e?.message ?? e).slice(0, 200));
  }

  private async dispensar(envio: Envio, motivo: string): Promise<'dispensados'> {
    await this.finalizar(envio, { resultado: 'dispensado', repetir: false, resposta: { motivo }, erro: null });
    return 'dispensados';
  }

  /** A régua: empresa viva, loja viva e da empresa, direito ligado e a ligação viva da loja. */
  private async contexto(envio: Envio) {
    const r: any = await this.db.execute(sql`
      select (select emp.deleted_at is null from empresa emp where emp.id = ${envio.tenant_id}) as empresa_viva,
             exists (select 1 from unidade u where u.id = ${envio.unidade_id} and u.tenant_id = ${envio.tenant_id}
                       and u.deleted_at is null) as loja_viva,
             exists (select 1 from entitlement e where e.tenant_id = ${envio.tenant_id}
                       and e.modulo = 'ifood_pelo_orzuni' and e.ativo) as liberado,
             (select json_build_object('id', l.id, 'segredo', l.segredo_cifrado)
                from orzuni_ligacao l
               where l.unidade_id = ${envio.unidade_id} and l.tenant_id = ${envio.tenant_id} and l.revogada_em is null
               limit 1) as ligacao`);
    const x = (r.rows ?? r)[0] ?? {};
    const lig = typeof x.ligacao === 'string' ? JSON.parse(x.ligacao) : x.ligacao;
    return {
      empresaViva: x.empresa_viva === true,
      lojaViva: x.loja_viva === true,
      liberado: x.liberado === true,
      ligacao: lig?.id ? { id: String(lig.id), segredo: String(lig.segredo) } : null,
    };
  }

  /** O que mandar, lido NA HORA (o valor mais novo). Fora das condições: dispensa, com o motivo. */
  private async montarChamada(envio: Envio): Promise<Chamada> {
    if (envio.tipo === 'preco_item' || envio.tipo === 'status_item') {
      const r: any = await this.db.execute(sql`
        select p.codigo, p.preco_ifood::text as preco, p.no_ifood, p.deleted_at, p.unidade_id,
               coalesce(jsonb_exists(p.canais_pausados, 'ifood'), false) as pausado_no_ifood,
               p.pausado_estoque,
               exists (select 1 from produto_pausa_estoque pe
                        where pe.produto_id = p.id and pe.unidade_id = ${envio.unidade_id}
                          and pe.pausado and pe.deleted_at is null) as esgotado_na_loja
          from produto p where p.id = ${envio.ref_id} and p.tenant_id = ${envio.tenant_id}`);
      const p = (r.rows ?? r)[0];
      if (!p || p.deleted_at) return { dispensar: 'produto excluído' };
      if (p.unidade_id && String(p.unidade_id) !== envio.unidade_id) return { dispensar: 'produto de outra loja' };
      const codigo = String(p.codigo ?? '').trim();
      if (!codigo) return { dispensar: 'produto sem código PDV' };
      if (!p.no_ifood) {
        if (envio.tipo === 'preco_item') return { dispensar: 'produto marcado fora do cardápio do iFood' };
        // Fora do cardápio do iFood ("Onde vende", mig 399): o item de lá fica PAUSADO — o Regem não apaga item do iFood.
        return { ferramenta: 'item_pausar', argumentos: { codigo_pdv: codigo } };
      }
      if (envio.tipo === 'preco_item') {
        if (p.preco == null) return { dispensar: 'sem preço no iFood (em branco: o Regem não mexe no preço de lá)' };
        const valor = Number(p.preco);
        if (!(valor > 0)) return { dispensar: 'o iFood não aceita item com preço zero' };
        return { ferramenta: 'preco_definir', argumentos: { codigo_pdv: codigo, valor } };
      }
      // Pausado no iFood se QUALQUER pausa DO iFood vale: o "Pausado no iFood" (canais_pausados) ou o esgotado do estoque
      // (todas as lojas ou esta). Desde a 399 (R3, "Onde vende"), tirar do balcão e do cardápio digital NÃO pausa no
      // iFood: cada canal se pausa no seu botão (a regra "Ocultar = pausa no iFood" da 371 foi aposentada pelo dono).
      const pausar = p.pausado_no_ifood === true || p.pausado_estoque === true || p.esgotado_na_loja === true;
      return { ferramenta: pausar ? 'item_pausar' : 'item_reativar', argumentos: { codigo_pdv: codigo } };
    }
    const r: any = await this.db.execute(sql`
      select o.codigo_pdv, o.preco_ifood::text as preco, o.esgotado, o.deleted_at
        from opcao o where o.id = ${envio.ref_id} and o.tenant_id = ${envio.tenant_id}`);
    const op = (r.rows ?? r)[0];
    if (!op || op.deleted_at) return { dispensar: 'opção excluída' };
    const codigo = String(op.codigo_pdv ?? '').trim();
    if (!codigo) return { dispensar: 'opção sem código PDV' };
    if (envio.tipo === 'preco_opcao') {
      if (op.preco == null) return { dispensar: 'sem preço no iFood (em branco: o Regem não mexe no preço de lá)' };
      return { ferramenta: 'complemento_preco_definir', argumentos: { codigo_pdv: codigo, valor: Number(op.preco) } };
    }
    return { ferramenta: op.esgotado ? 'complemento_pausar' : 'complemento_reativar', argumentos: { codigo_pdv: codigo } };
  }

  private async anotarUso(ligacaoId: string) {
    await this.db.execute(sql`update orzuni_ligacao set ultimo_uso_em = now() where id = ${ligacaoId}`);
  }

  /** O que foi ao iFood fica no registro da empresa (quem: o sistema; o que a porta respondeu). */
  private async auditar(envio: Envio, chamada: { ferramenta: string; argumentos: Record<string, unknown> }, d: Desfecho) {
    await this.auditoria.registrar({
      tenantId: envio.tenant_id,
      unidadeId: envio.unidade_id,
      atorId: null,
      atorPerfil: 'sistema',
      tipo: 'integracao',
      acao: 'enviou_ao_ifood_pelo_orzuni',
      entidadeTipo: envio.tipo.endsWith('_opcao') ? 'opcao' : 'produto',
      entidadeId: envio.ref_id,
      origem: 'orzuni',
      detalhe: {
        ferramenta: chamada.ferramenta,
        codigoPdv: chamada.argumentos.codigo_pdv,
        valor: chamada.argumentos.valor ?? null,
        resultado: d.resultado,
        antes: d.resposta.antes ?? null,
        depois: d.resposta.depois ?? null,
        codigo: d.resposta.codigo ?? null,
      },
    });
  }

  private clienteDmsId(cfg: ConfigOrzuni): ClienteDmsId {
    const chave = `${cfg.emissor}|${cfg.aplicativo}`;
    if (!this.dmsId || this.dmsId.chave !== chave) {
      this.dmsId = {
        chave,
        cliente: new ClienteDmsId({ emissor: cfg.emissor, aplicativo: cfg.aplicativo, segredo: cfg.segredo, buscar: this.buscar }),
      };
    }
    return this.dmsId.cliente;
  }

  // ── o aviso do banco (LISTEN) ─────────────────────────────────────────────────────────────────────────────────

  private async ouvir() {
    if (this.parado) return;
    const connectionString = process.env.DATABASE_URL;
    const ssl = resolverSsl(connectionString);
    const c = new Client({ connectionString, ...(ssl ? { ssl } : {}) });
    const cair = (motivo: string) => {
      if (this.ouvinte !== c) return;
      this.ouvinte = null;
      c.end().catch(() => {});
      this.reouvir(motivo);
    };
    c.on('error', (e: any) => cair(e?.code ?? e?.message ?? String(e)));
    c.on('end', () => cair('conexão encerrada'));
    c.on('notification', () => void this.acordar());
    try {
      await c.connect();
      await c.query('LISTEN orzuni_envio');
      this.ouvinte = c;
      if (this.falhas) this.log.log('LISTEN orzuni_envio restabelecido');
      this.falhas = 0;
      void this.acordar(); // o que entrou enquanto não ouvíamos
    } catch (e: any) {
      c.end().catch(() => {});
      this.reouvir(e?.message ?? String(e));
    }
  }

  private reouvir(motivo: string) {
    if (this.parado) return;
    this.falhas++;
    const espera = Math.min(60_000, 2_000 * 2 ** Math.min(this.falhas - 1, 5));
    if (this.falhas === 1 || this.falhas % 10 === 0)
      this.log.warn(`LISTEN orzuni_envio indisponível (${motivo}) — a rotina de 15 s segue; nova tentativa em ${espera / 1000}s`);
    setTimeout(() => void this.ouvir(), espera);
  }
}
