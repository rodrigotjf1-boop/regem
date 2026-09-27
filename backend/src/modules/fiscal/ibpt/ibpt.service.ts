import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../../db/drizzle.module';
import { ehServidorLocal } from '../../../common/modo';
import { TelemetriaBridge } from '../../../common/telemetria-bridge';
import { ArquivoIbptInvalido, UFS, lerArquivosIbpt } from './ibpt-arquivo';
import {
  StatusIbptUf,
  gravarTabelaIbpt,
  hojeNaUf,
  pacoteIbptDaUf,
  podarVersoesIbpt,
  statusIbpt,
  tabelaDoPacote,
  versaoVigente,
} from './ibpt-tabela';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Um servidor de loja nunca recebe tabela menor que isto (uma UF tem ~11 mil NCMs). Pacote
// cortado pela rede não substitui a tabela boa que já está lá.
const MINIMO_LINHAS_PACOTE = 1000;

const versaoTexto = (v: { versao: string; chave: string; vigenciaFim: string }) =>
  `${v.versao}|${v.chave}|${v.vigenciaFim}`;

/**
 * Tabela do IBPT (Lei 12.741) — onde ela entra e como chega à loja.
 *
 *  • NUVEM: a distribuição envia o arquivo baixado no site do IBPT pelo console (`importar`);
 *    o servidor da loja pede a da UF dele (`pacoteParaLoja`); e o VERIFICADOR diário avisa, na
 *    telemetria da distribuição, a UF com lojas que ficou sem tabela ou vence em até 7 dias sem a
 *    próxima importada (`verificarVigencias`).
 *  • SERVIDOR DA LOJA: a cada 6 h (e logo depois de subir) confere com a nuvem se há versão
 *    nova para a UF dele e baixa só quando muda (`sincronizarDaNuvem`).
 * Os crons dizem onde rodam (ERR-075): cada um sai no começo do lado errado.
 */
@Injectable()
export class IbptService implements OnApplicationBootstrap {
  private readonly log = new Logger('IBPT');
  private sincronizando = false;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  onApplicationBootstrap() {
    // Instalação nova ou servidor que ficou desligado: não espera 6 h pela primeira tabela.
    if (ehServidorLocal()) setTimeout(() => void this.sincronizarDaNuvem(), 90_000).unref();
  }

  // ------------------------------------------------------------------ console (nuvem)

  /** Grava as tabelas de um envio (ZIP do site ou CSVs). Idempotente por UF + versão + chave. */
  async importar(arquivos: { nome: string; dados: Buffer }[], por: string | null) {
    if (ehServidorLocal())
      throw new ForbiddenException('A tabela do IBPT é enviada no console da distribuição, na nuvem.');
    if (!arquivos.length) throw new BadRequestException('Envie o arquivo baixado no site do IBPT.');
    let tabelas;
    try {
      tabelas = lerArquivosIbpt(arquivos);
    } catch (e) {
      if (e instanceof ArquivoIbptInvalido) throw new BadRequestException(e.message);
      throw e;
    }
    const importadas: any[] = [];
    for (const t of tabelas) {
      const { versao, nova } = await gravarTabelaIbpt(this.db, t, por);
      await podarVersoesIbpt(this.db, t.uf, hojeNaUf(t.uf));
      importadas.push({
        uf: t.uf,
        versao: t.versao,
        chave: t.chave,
        vigenciaInicio: versao.vigenciaInicio,
        vigenciaFim: versao.vigenciaFim,
        linhas: t.linhas.length,
        nova,
      });
    }
    this.log.log(
      `Tabela do IBPT importada por ${por ?? '?'}: ${importadas.map((i) => `${i.uf} ${i.versao}`).join(', ')}`,
    );
    return { importadas };
  }

  /** Situação por UF para o console (a mesma conta do verificador). */
  status(ufs?: string[]): Promise<StatusIbptUf[]> {
    return statusIbpt(this.db, hojeNaUf(null), ufs);
  }

  // ------------------------------------------------------------------ nuvem → loja

  /**
   * A tabela vigente da UF para o servidor da loja. `tenho` é o que ele já tem
   * (versão|chave|fim da vigência): igual = nada a baixar. A vigência entra na comparação porque
   * o IBPT estende a vigência de uma versão sem trocar a chave.
   */
  async pacoteParaLoja(uf: string, tenho?: string | null) {
    const u = String(uf ?? '').toUpperCase();
    if (!UFS.has(u)) throw new BadRequestException(`UF inválida: ${uf}`);
    const p = await pacoteIbptDaUf(this.db, u, hojeNaUf(u));
    if (!p) return null;
    if (tenho && tenho === versaoTexto(p)) return 'igual' as const;
    return p;
  }

  // ------------------------------------------------------------------ servidor da loja

  /**
   * Busca na nuvem a tabela da UF da loja quando mudou. SÓ no servidor da loja — na nuvem a
   * tabela chega pelo console. Nunca rejeita (roda em segundo plano): cada falha vira log com o
   * motivo e a loja segue com o que tem.
   */
  @Cron('23 */6 * * *') // a cada 6 h — SÓ no servidor da loja
  async sincronizarDaNuvem(): Promise<{ atualizadas: string[] }> {
    const atualizadas: string[] = [];
    if (!ehServidorLocal() || this.sincronizando) return { atualizadas };
    this.sincronizando = true;
    try {
      const cloud = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
      const token = process.env.SYNC_TOKEN ?? '';
      if (!cloud || !token) return { atualizadas };
      const r: any = await this.db.execute(sql`
        select distinct upper(uf) as uf from fiscal_config where uf is not null and uf <> ''`);
      for (const { uf } of (r.rows ?? r) as { uf: string }[]) {
        try {
          const atual = await versaoVigente(this.db, uf, hojeNaUf(uf));
          const tenho = atual ? versaoTexto(atual) : '';
          const res = await fetch(`${cloud}/fiscal/ibpt/${uf}?tenho=${encodeURIComponent(tenho)}`, {
            headers: { 'x-sync-token': token },
            signal: AbortSignal.timeout(120_000),
          });
          if (res.status === 204) continue;
          if (res.status === 404) {
            this.log.warn(`A nuvem ainda não tem tabela do IBPT vigente para ${uf}.`);
            continue;
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const t = tabelaDoPacote(await res.json());
          if (t.uf !== uf) throw new Error(`a nuvem devolveu a tabela de ${t.uf}`);
          if (t.linhas.length < MINIMO_LINHAS_PACOTE)
            throw new Error(`pacote com ${t.linhas.length} linhas — parece cortado`);
          await gravarTabelaIbpt(this.db, t, 'nuvem');
          await podarVersoesIbpt(this.db, uf, hojeNaUf(uf));
          atualizadas.push(`${uf} ${t.versao}`);
          this.log.log(`Tabela do IBPT ${uf} ${t.versao} baixada da nuvem (${t.linhas.length} NCMs).`);
        } catch (e: any) {
          this.log.warn(`Não consegui atualizar a tabela do IBPT de ${uf}: ${e?.message ?? e}`);
        }
      }
    } catch (e: any) {
      this.log.warn(`Sincronização da tabela do IBPT falhou: ${e?.message ?? e}`);
    } finally {
      this.sincronizando = false;
    }
    return { atualizadas };
  }

  // ------------------------------------------------------------------ verificador (nuvem)

  /**
   * Todo dia de manhã, SÓ na nuvem: UF com loja fiscal e sem tabela vigente — ou vencendo em até
   * 7 dias sem a próxima importada — vira aviso na telemetria da distribuição (o mesmo aviso se
   * agrupa dia a dia). Tabela vencida quer dizer cupom sem o valor aproximado dos tributos.
   * `ufs` limita a varredura (teste — LIC-084).
   */
  @Cron('0 8 * * *') // 08:00 todo dia — SÓ na nuvem
  async verificarVigencias(ufs?: string[]): Promise<StatusIbptUf[]> {
    if (ehServidorLocal()) return [];
    try {
      const st = await this.status(ufs);
      for (const s of st) {
        if (s.lojas === 0 || s.situacao === 'ok') continue;
        const mensagem =
          s.situacao === 'vence_logo'
            ? `Tabela do IBPT de ${s.uf} (${s.vigente?.versao}) vence em ${s.vigente?.vigenciaFim} e a próxima não foi enviada — baixe no site do IBPT e envie no console (Atualizações).`
            : s.situacao === 'vencida'
              ? `Tabela do IBPT de ${s.uf} VENCIDA: as NFC-e saem sem o valor aproximado dos tributos. Envie a nova no console (Atualizações).`
              : `Sem tabela do IBPT para ${s.uf}: as NFC-e saem sem o valor aproximado dos tributos. Envie a tabela no console (Atualizações).`;
        this.log.warn(mensagem);
        TelemetriaBridge.reportar(null, {
          origem: 'fiscal',
          nivel: s.situacao === 'vence_logo' ? 'warn' : 'error',
          tipo: `ibpt_${s.situacao}`,
          mensagem,
          contexto: { uf: s.uf, lojas: s.lojas, versao: s.vigente?.versao ?? null },
        });
      }
      return st;
    } catch (e: any) {
      this.log.warn(`Verificador da tabela do IBPT falhou: ${e?.message ?? e}`);
      return [];
    }
  }
}
