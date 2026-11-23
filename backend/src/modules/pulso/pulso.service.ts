import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { hojeISO } from '../../common/data';
import { somarDias } from '../perfil-cliente/calendario-regra';
import { ClienteDmsId, ClienteIntegracao, ErroPorta } from '../../dms/integracao-dms';
import {
  ConfigPulso,
  DIAS_DE_BOLETIM,
  DIAS_DE_CLIMA,
  LIMITE_POR_PAGINA,
  PAGINAS_POR_VOLTA,
  PERMISSOES_DO_PULSO,
  RAMO_DO_REGEM,
  corpoDosInteresses,
  lerBoletimDaPorta,
  lerClima,
  lerConfigPulso,
  lerMudancas,
  resumoDosInteresses,
} from './pulso.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O REGEM LÊ O PULSO (F7 parte 4 do docs/plano-perfil-cliente.md; mig 470; regras em `pulso.regras.ts`). Três rotinas, só
// na NUVEM e só com a ligação configurada (nasce desligado — `PULSO_LIGACAO`):
//  • eventos — a leitura incremental das mudanças (de 6 em 6 horas), a cópia em `pulso_evento` e o cursor no mesmo passo;
//  • interesses — uma vez por dia, a lista SOMADA dos municípios (código IBGE da configuração fiscal) das empresas com o
//    módulo "Perfil do cliente" ligado; o PUT substitui o conjunto, então vai só quando a lista muda (ou a cada 7 dias);
//  • clima — uma vez por dia, depois da foto do Pulso (06:30): 16 dias de cada município, e a chuva prevista na véspera.
// Cada rotina reserva a vez no banco (`pulso_estado`) antes de chamar: duas réplicas não repetem a leitura (V98), e o
// relógio de cadência longa não recomeça a cada deploy (V104). Falha vira `erro` no estado e linha no log, nunca exceção.

type Buscar = typeof fetch;

@Injectable()
export class PulsoService {
  private readonly log = new Logger(PulsoService.name);
  private cliente: { chave: string; porta: ClienteIntegracao } | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private rows(r: any): any[] {
    return r?.rows ?? r ?? [];
  }

  /** O cliente da porta (guardado enquanto a configuração não muda). */
  porta(cfg: ConfigPulso, buscar?: Buscar): ClienteIntegracao {
    const chave = `${cfg.base}|${cfg.emissor}|${cfg.aplicativo}|${cfg.ligacao.slice(-6)}`;
    if (!buscar && this.cliente?.chave === chave) return this.cliente.porta;
    const dmsId = new ClienteDmsId({ emissor: cfg.emissor, aplicativo: cfg.aplicativo, segredo: cfg.segredo, ...(buscar ? { buscar } : {}) });
    const porta = new ClienteIntegracao({
      base: cfg.base,
      recurso: cfg.recurso,
      permissoes: PERMISSOES_DO_PULSO,
      dmsId,
      ligacao: cfg.ligacao,
      tentativas: 2,
      ...(buscar ? { buscar, esperar: async () => undefined } : {}),
    });
    if (!buscar) this.cliente = { chave, porta };
    return porta;
  }

  private async anotarErro(onde: string, e: any): Promise<void> {
    const msg = e instanceof ErroPorta ? `${onde}: ${e.message}` : `${onde}: ${e?.code ? `[${e.code}] ` : ''}${String(e?.message ?? e).slice(0, 200)}`;
    this.log.warn(`Pulso — ${msg}`);
    await this.db.execute(sql`update pulso_estado set erro = ${msg.slice(0, 300)}, erro_em = clock_timestamp() where id = 1`).catch(() => undefined);
  }

  /**
   * A configuração da rotina: só com a ligação (nasce desligado). Quem chama já conferiu o lado (só nuvem). Sem a
   * `PULSO_LIGACAO`, desligado e calado (de propósito). COM ela e algo errado (o segredo colado pela metade, a credencial do
   * DMS ID faltando), o motivo fica anotado no estado e no log — nunca o valor —, para o dono saber que precisa corrigir.
   */
  async configDaRotina(onde: string, env: Record<string, string | undefined> = process.env): Promise<ConfigPulso | null> {
    const cfg = lerConfigPulso(env);
    if (cfg.ligado) return cfg;
    if ((env.PULSO_LIGACAO ?? '').trim()) await this.anotarErro(`configuração (${onde})`, new Error(cfg.motivo ?? 'desligado'));
    return null;
  }

  @Cron('0 15 */6 * * *', { timeZone: 'America/Sao_Paulo' })
  async rotinaEventos(): Promise<void> {
    if (ehServidorLocal()) return; // só a nuvem lê o Pulso
    const cfg = await this.configDaRotina('eventos');
    if (cfg) await this.lerEventos(cfg);
  }

  @Cron('0 20 5 * * *', { timeZone: 'America/Sao_Paulo' })
  async rotinaInteresses(): Promise<void> {
    if (ehServidorLocal()) return; // só a nuvem lê o Pulso
    const cfg = await this.configDaRotina('interesses');
    if (cfg) await this.mandarInteresses(cfg);
  }

  @Cron('0 10 7 * * *', { timeZone: 'America/Sao_Paulo' })
  async rotinaClima(): Promise<void> {
    if (ehServidorLocal()) return; // só a nuvem lê o Pulso
    const cfg = await this.configDaRotina('clima');
    if (cfg) await this.lerClimaDosMunicipios(cfg);
  }

  // O boletim do Pulso fica pronto às 07:50. Depois das 8h, confere de hora em hora: pega o do dia e também a notícia que a
  // DMS tirou do boletim no console do Pulso. Só grava quando mudou.
  @Cron('0 5 8-23 * * *', { timeZone: 'America/Sao_Paulo' })
  async rotinaBoletim(): Promise<void> {
    if (ehServidorLocal()) return; // só a nuvem lê o Pulso
    const cfg = await this.configDaRotina('boletim');
    if (cfg) await this.lerBoletimDoRamo(cfg);
  }

  /** Guarda a cópia do boletim de hoje, uma para todas as lojas. Devolve se a cópia mudou. */
  async lerBoletimDoRamo(cfg: ConfigPulso, buscar?: Buscar): Promise<boolean> {
    try {
      const [vez] = this.rows(await this.db.execute(sql`
        update pulso_estado set boletim_lido_em = clock_timestamp()
         where id = 1 and (boletim_lido_em is null or boletim_lido_em < now() - interval '50 minutes')
        returning id`));
      if (!vez) return false;
      const hoje = hojeISO();
      const r = await this.porta(cfg, buscar).pedir('GET', '/ramo/boletim', { consulta: { ramo: RAMO_DO_REGEM, data: hoje } });
      if (r.status === 404) return false; // o boletim de hoje ainda não saiu: a próxima volta pega
      if (r.status !== 200) throw new ErroPorta(r.status, r.problema || 'resposta-inesperada');
      const boletim = lerBoletimDaPorta(r.corpo);
      if (!boletim || boletim.dia !== hoje) throw new ErroPorta(r.status, 'boletim-invalido');
      const gravou = this.rows(await this.db.execute(sql`
        insert into pulso_boletim (ramo, dia, corpo)
        values (${RAMO_DO_REGEM}, ${hoje}::date, ${JSON.stringify(boletim)}::jsonb)
        on conflict (ramo, dia) do update set corpo = excluded.corpo, lido_em = clock_timestamp()
        where pulso_boletim.corpo is distinct from excluded.corpo
        returning dia`));
      await this.db.execute(sql`delete from pulso_boletim where dia < ${somarDias(hoje, -DIAS_DE_BOLETIM)}::date`);
      if (gravou.length) this.log.log(`Pulso — boletim do ramo de ${hoje} guardado`);
      return gravou.length > 0;
    } catch (e: any) {
      await this.anotarErro('boletim', e);
      return false;
    }
  }

  /** A leitura incremental. Devolve quantos eventos gravou (0 = nada novo, outra réplica leu ou falhou). */
  async lerEventos(cfg: ConfigPulso, buscar?: Buscar): Promise<number> {
    try {
      const [vez] = this.rows(await this.db.execute(sql`
        update pulso_estado set eventos_lidos_em = clock_timestamp()
         where id = 1 and (eventos_lidos_em is null or eventos_lidos_em < now() - interval '5 hours')
        returning versao`));
      if (!vez) return 0;
      const porta = this.porta(cfg, buscar);
      let versao = Number(vez.versao);
      let gravados = 0;
      for (let pagina = 0; pagina < PAGINAS_POR_VOLTA; pagina += 1) {
        const r = await porta.pedir('GET', '/eventos/mudancas', { consulta: { desde_versao: versao, limite: LIMITE_POR_PAGINA } });
        if (r.status !== 200) throw new ErroPorta(r.status, r.problema || 'resposta-inesperada');
        const lido = lerMudancas(r.corpo);
        if (lido.proximaVersao === null) throw new ErroPorta(r.status, 'sem-proxima-versao');
        await this.db.transaction(async (tx: any) => {
          if (lido.eventos.length) {
            await tx.execute(sql`
              insert into pulso_evento (id, chave, tipo, nome, dia_inteiro, inicio, fim, fuso, janela, abrangencia, situacao,
                                        detalhes, versao, fonte, credito, recebido_em)
              select x.id, x.chave, x.tipo, x.nome, x.dia_inteiro, x.inicio, x.fim, x.fuso, x.janela, x.abrangencia, x.situacao,
                     x.detalhes, x.versao, x.fonte, x.credito, clock_timestamp()
                from jsonb_to_recordset(${JSON.stringify(lido.eventos)}::jsonb)
                     as x(id uuid, chave text, tipo text, nome text, dia_inteiro boolean, inicio text, fim text, fuso text,
                          janela jsonb, abrangencia jsonb, situacao text, detalhes jsonb, versao bigint, fonte jsonb, credito text)
              on conflict (id) do update set
                chave = excluded.chave, tipo = excluded.tipo, nome = excluded.nome, dia_inteiro = excluded.dia_inteiro,
                inicio = excluded.inicio, fim = excluded.fim, fuso = excluded.fuso, janela = excluded.janela,
                abrangencia = excluded.abrangencia, situacao = excluded.situacao, detalhes = excluded.detalhes,
                versao = excluded.versao, fonte = excluded.fonte, credito = excluded.credito, recebido_em = excluded.recebido_em
              where excluded.versao >= pulso_evento.versao`);
          }
          // O cursor anda no MESMO passo da gravação (nunca à frente do que foi gravado).
          await tx.execute(sql`update pulso_estado set versao = greatest(versao, ${lido.proximaVersao}::bigint), erro = null where id = 1`);
        });
        gravados += lido.eventos.length;
        if (!lido.temMais || lido.proximaVersao <= versao) break;
        versao = lido.proximaVersao;
      }
      if (gravados) this.log.log(`Pulso — ${gravados} evento(s) lido(s)`);
      return gravados;
    } catch (e: any) {
      await this.anotarErro('eventos', e);
      return 0;
    }
  }

  /** Os municípios (código IBGE) das empresas com o módulo "Perfil do cliente" ligado — sem nada que diga de quem são. */
  async municipiosDasLojas(): Promise<string[]> {
    const r = this.rows(await this.db.execute(sql`
      select distinct f.codigo_municipio::text as municipio
        from fiscal_config f
        join modulo_ativacao m on m.tenant_id = f.tenant_id and m.modulo = 'perfil_cliente' and m.ativo
       where f.codigo_municipio is not null`));
    return corpoDosInteresses(r.map((x: any) => x.municipio)).municipios;
  }

  /** Manda os interesses quando a lista muda (ou a cada 7 dias). Devolve se mandou. */
  async mandarInteresses(cfg: ConfigPulso, buscar?: Buscar): Promise<boolean> {
    try {
      const corpo = corpoDosInteresses(await this.municipiosDasLojas());
      const resumo = resumoDosInteresses(corpo);
      const [vez] = this.rows(await this.db.execute(sql`
        update pulso_estado set interesses_hash = ${resumo}, interesses_em = clock_timestamp()
         where id = 1 and (interesses_hash is distinct from ${resumo} or interesses_em is null or interesses_em < now() - interval '7 days')
        returning id`));
      if (!vez) return false;
      const r = await this.porta(cfg, buscar).pedir('PUT', '/interesses', { corpo });
      if (r.status !== 200) {
        // Falhou: o próximo dia tenta de novo (o resumo volta a vazio).
        await this.db.execute(sql`update pulso_estado set interesses_hash = null where id = 1`);
        throw new ErroPorta(r.status, r.problema || 'resposta-inesperada');
      }
      const pendentes = Array.isArray((r.corpo as any)?.municipios_pendentes) ? (r.corpo as any).municipios_pendentes.length : 0;
      this.log.log(`Pulso — interesses mandados: ${corpo.municipios.length} município(s)${pendentes ? `, ${pendentes} pendente(s) no IBGE` : ''}`);
      return true;
    } catch (e: any) {
      await this.anotarErro('interesses', e);
      return false;
    }
  }

  /** O clima de cada município, de hoje a 15 dias. Devolve quantos dias gravou. */
  async lerClimaDosMunicipios(cfg: ConfigPulso, buscar?: Buscar): Promise<number> {
    try {
      const [vez] = this.rows(await this.db.execute(sql`
        update pulso_estado set clima_lido_em = clock_timestamp()
         where id = 1 and (clima_lido_em is null or clima_lido_em < now() - interval '20 hours')
        returning id`));
      if (!vez) return 0;
      const hoje = hojeISO();
      const amanha = somarDias(hoje, 1);
      const ate = somarDias(hoje, DIAS_DE_CLIMA - 1);
      const porta = this.porta(cfg, buscar);
      let gravados = 0;
      for (const municipio of await this.municipiosDasLojas()) {
        const r = await porta.pedir('GET', '/clima', { consulta: { municipio, de: hoje, ate } });
        if (r.status !== 200) {
          await this.anotarErro(`clima ${municipio}`, new ErroPorta(r.status, r.problema || 'resposta-inesperada'));
          continue;
        }
        const dias = lerClima(r.corpo).filter((d) => d.dia >= hoje && d.dia <= ate);
        if (!dias.length) continue;
        const res: any = await this.db.execute(sql`
          insert into clima_municipio_dia (municipio, dia, chuva_prevista, chuva_na_vespera, inmet, cptec, lido_em)
          select ${Number(municipio)}::int, x.dia::date, x."chuvaPrevista",
                 case when x.dia::date = ${amanha}::date then x."chuvaPrevista" end, x.inmet, x.cptec, clock_timestamp()
            from jsonb_to_recordset(${JSON.stringify(dias)}::jsonb) as x(dia text, "chuvaPrevista" boolean, inmet jsonb, cptec jsonb)
          on conflict (municipio, dia) do update set
            chuva_prevista = excluded.chuva_prevista, inmet = excluded.inmet, cptec = excluded.cptec, lido_em = excluded.lido_em,
            chuva_na_vespera = case when clima_municipio_dia.dia = ${amanha}::date then excluded.chuva_na_vespera
                                    else clima_municipio_dia.chuva_na_vespera end`);
        gravados += Number(res?.rowCount ?? dias.length);
      }
      return gravados;
    } catch (e: any) {
      await this.anotarErro('clima', e);
      return 0;
    }
  }
}
