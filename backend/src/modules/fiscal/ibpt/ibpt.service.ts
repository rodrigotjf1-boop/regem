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
import { chaveSegredosDisponivel } from '../../../common/cifra-segredo';
import { AuditoriaService } from '../../auditoria/auditoria.service';
import { ArquivoIbptInvalido, LinhaIbpt, UFS, lerArquivosIbpt } from './ibpt-arquivo';
import {
  ConsultaIbptRecusada,
  IbptIndisponivel,
  NCM_SONDA,
  RespostaIbpt,
  consultarNcmIbpt,
  tokenIbptPlausivel,
} from './ibpt-api';
import {
  StatusIbptUf,
  VersaoIbpt,
  apagarTabelasProprias,
  gravarTabelaIbpt,
  hojeNaUf,
  ncmsFaltando,
  pacoteIbptDaUf,
  podarVersoesIbpt,
  statusIbpt,
  tabelaDoPacote,
  versaoVigente,
} from './ibpt-tabela';
import {
  LojaComTokenIbpt,
  apagarTokenIbpt,
  credencialComTokenIbpt,
  emitenteDaLoja,
  gravarTokenIbpt,
  lojasComTokenIbpt,
  marcarVerificacaoIbpt,
  ncmsDaEmpresa,
  resumoTokenIbpt,
  tokenIbptDecifrado,
} from './ibpt-token';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Um servidor de loja nunca recebe tabela menor que isto (uma UF tem ~11 mil NCMs). Pacote
// cortado pela rede não substitui a tabela boa que já está lá.
const MINIMO_LINHAS_PACOTE = 1000;

const versaoTexto = (v: { versao: string; chave: string; vigenciaFim: string }) =>
  `${v.versao}|${v.chave}|${v.vigenciaFim}`;

// Tabela própria (token do lojista): quantos NCMs se consultam por rodada e quantos de uma vez.
// Um restaurante tem dezenas de NCMs; o teto só protege de um cadastro anômalo.
const MAX_NCMS_POR_RODADA = 400;
const CONSULTAS_SIMULTANEAS = 4;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const resumoVersao = (v: VersaoIbpt | null) =>
  v
    ? {
        versao: v.versao,
        chave: v.chave,
        fonte: v.fonte,
        vigenciaInicio: v.vigenciaInicio,
        vigenciaFim: v.vigenciaFim,
        linhas: v.linhas,
      }
    : null;

const linhaDaResposta = (r: RespostaIbpt): LinhaIbpt => ({
  ncm: r.ncm,
  ex: r.ex,
  nacionalFederal: r.nacionalFederal,
  importadosFederal: r.importadosFederal,
  estadual: r.estadual,
  municipal: r.municipal,
});

/**
 * Tabela do IBPT (Lei 12.741) — onde ela entra e como chega à loja.
 *
 *  • NUVEM: a distribuição envia o arquivo baixado no site do IBPT pelo console (`importar`);
 *    o servidor da loja pede a da UF dele (`pacoteParaLoja`); e o VERIFICADOR diário avisa, na
 *    telemetria da distribuição, a UF com lojas que ficou sem tabela ou vence em até 7 dias sem a
 *    próxima importada (`verificarVigencias`).
 *  • SERVIDOR DA LOJA: a cada 6 h (e logo depois de subir) confere com a nuvem se há versão
 *    nova para a UF dele e baixa só quando muda (`sincronizarDaNuvem`) — a da distribuição e,
 *    se a empresa tiver, a PRÓPRIA.
 *  • TOKEN DO LOJISTA (opcional, mig 292): a loja pode informar o token dela do IBPT na
 *    Configuração fiscal. A nuvem testa na hora (`salvarToken`) e, todo dia, consulta a API do
 *    IBPT pelos NCMs dos produtos dela e mantém a tabela PRÓPRIA (`atualizarTabelasProprias`).
 *    Sem token, nada muda: vale a tabela da distribuição.
 * Os crons dizem onde rodam (ERR-075): cada um sai no começo do lado errado.
 */
@Injectable()
export class IbptService implements OnApplicationBootstrap {
  private readonly log = new Logger('IBPT');
  private sincronizando = false;
  // Empresas com a tabela própria sendo atualizada AGORA neste processo: o job diário e o disparo
  // de quem acabou de salvar o token não consultam o IBPT duas vezes pela mesma empresa.
  private readonly atualizandoPropria = new Set<string>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

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

  /**
   * A tabela PRÓPRIA da empresa do servidor (o tenant vem do token de sync, nunca do pedido).
   * `null` = a empresa não tem tabela própria vigente — o servidor apaga a cópia dele. A
   * comparação inclui o número de linhas: a tabela própria cresce dentro da mesma versão.
   */
  async pacotePropriaParaLoja(tenantId: string, uf: string, tenho?: string | null) {
    const u = String(uf ?? '').toUpperCase();
    if (!UFS.has(u)) throw new BadRequestException(`UF inválida: ${uf}`);
    const p = await pacoteIbptDaUf(this.db, u, hojeNaUf(u), tenantId);
    if (!p) return null;
    if (tenho && tenho === `${versaoTexto(p)}|${p.linhas.length}`) return 'igual' as const;
    return { ...p, tenantId };
  }

  // ------------------------------------------------------------------ servidor da loja

  /**
   * Busca na nuvem a tabela da UF da loja quando mudou. SÓ no servidor da loja — na nuvem a
   * tabela chega pelo console. Nunca rejeita (roda em segundo plano): cada falha vira log com o
   * motivo e a loja segue com o que tem. `ufs` limita a varredura (teste — LIC-084: o 404 da
   * tabela própria APAGA a cópia local, e o banco de teste é compartilhado).
   */
  @Cron('23 */6 * * *') // a cada 6 h — SÓ no servidor da loja
  async sincronizarDaNuvem(ufs?: string[]): Promise<{ atualizadas: string[] }> {
    const atualizadas: string[] = [];
    if (!ehServidorLocal() || this.sincronizando) return { atualizadas };
    this.sincronizando = true;
    try {
      const cloud = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
      const token = process.env.SYNC_TOKEN ?? '';
      if (!cloud || !token) return { atualizadas };
      const r: any = await this.db.execute(sql`
        select distinct upper(uf) as uf from fiscal_config where uf is not null and uf <> ''`);
      const doBanco = (r.rows ?? r) as { uf: string }[];
      for (const { uf } of ufs?.length ? doBanco.filter((x) => ufs.includes(x.uf)) : doBanco) {
        // As duas tabelas são independentes: uma falhar não impede a outra.
        try {
          const feito = await this.sincronizarDistribuicaoDaNuvem(cloud, token, uf);
          if (feito) atualizadas.push(feito);
        } catch (e: any) {
          this.log.warn(`Não consegui atualizar a tabela do IBPT de ${uf}: ${e?.message ?? e}`);
        }
        try {
          const feito = await this.sincronizarPropriaDaNuvem(cloud, token, uf);
          if (feito) atualizadas.push(feito);
        } catch (e: any) {
          this.log.warn(`Não consegui atualizar a tabela própria do IBPT de ${uf}: ${e?.message ?? e}`);
        }
      }
    } catch (e: any) {
      this.log.warn(`Sincronização da tabela do IBPT falhou: ${e?.message ?? e}`);
    } finally {
      this.sincronizando = false;
    }
    return { atualizadas };
  }

  /** Um pedido da tabela da DISTRIBUIÇÃO à nuvem (servidor da loja). Devolve o que mudou, ou null. */
  private async sincronizarDistribuicaoDaNuvem(cloud: string, token: string, uf: string): Promise<string | null> {
    const atual = await versaoVigente(this.db, uf, hojeNaUf(uf));
    const tenho = atual ? versaoTexto(atual) : '';
    const res = await fetch(`${cloud}/fiscal/ibpt/${uf}?tenho=${encodeURIComponent(tenho)}`, {
      headers: { 'x-sync-token': token },
      signal: AbortSignal.timeout(120_000),
    });
    if (res.status === 204) return null;
    if (res.status === 404) {
      this.log.warn(`A nuvem ainda não tem tabela do IBPT vigente para ${uf}.`);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const t = tabelaDoPacote(await res.json());
    if (t.uf !== uf) throw new Error(`a nuvem devolveu a tabela de ${t.uf}`);
    if (t.linhas.length < MINIMO_LINHAS_PACOTE) throw new Error(`pacote com ${t.linhas.length} linhas — parece cortado`);
    await gravarTabelaIbpt(this.db, t, 'nuvem');
    await podarVersoesIbpt(this.db, uf, hojeNaUf(uf));
    this.log.log(`Tabela do IBPT ${uf} ${t.versao} baixada da nuvem (${t.linhas.length} NCMs).`);
    return `${uf} ${t.versao}`;
  }

  /** Um pedido da tabela própria à nuvem (servidor da loja). Devolve o que mudou, ou null. */
  private async sincronizarPropriaDaNuvem(cloud: string, token: string, uf: string): Promise<string | null> {
    const hoje = hojeNaUf(uf);
    const rv: any = await this.db.execute(sql`
      select v.versao, v.chave, v.vigencia_fim::text as vigencia_fim,
             (select count(*) from ibpt_aliquota a where a.versao_id = v.id)::int as n
        from ibpt_versao v
       where v.uf = ${uf} and v.tenant_id is not null
         and v.vigencia_inicio <= ${hoje}::date and v.vigencia_fim >= ${hoje}::date
       order by v.vigencia_inicio desc, v.versao desc, v.importada_em desc limit 1`);
    const atual = (rv.rows ?? rv)[0];
    const tenho = atual
      ? `${atual.versao}|${atual.chave}|${String(atual.vigencia_fim).slice(0, 10)}|${atual.n}`
      : '';
    const res = await fetch(`${cloud}/fiscal/ibpt/${uf}/propria?tenho=${encodeURIComponent(tenho)}`, {
      headers: { 'x-sync-token': token },
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 204) return null;
    if (res.status === 404) {
      // A empresa não tem (mais) tabela própria vigente — token removido na nuvem. Fica a da Regem.
      const r: any = await this.db.execute(sql`
        delete from ibpt_versao where uf = ${uf} and tenant_id is not null returning id`);
      if ((r.rows ?? r).length) this.log.log(`Tabela própria do IBPT de ${uf} removida (a empresa não tem mais token).`);
      return null;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const corpo: any = await res.json();
    const t = tabelaDoPacote(corpo);
    if (t.uf !== uf) throw new Error(`a nuvem devolveu a tabela de ${t.uf}`);
    if (!UUID.test(String(corpo?.tenantId ?? ''))) throw new Error('pacote sem a empresa');
    if (!t.linhas.length) throw new Error('pacote sem linhas');
    await gravarTabelaIbpt(this.db, t, 'nuvem', { tenantId: corpo.tenantId });
    await podarVersoesIbpt(this.db, uf, hoje);
    this.log.log(`Tabela própria do IBPT ${uf} ${t.versao} baixada da nuvem (${t.linhas.length} NCMs).`);
    return `${uf} ${t.versao} (própria)`;
  }

  // ------------------------------------------------------------------ token do lojista (nuvem)

  /**
   * O que a Configuração fiscal mostra: o token (só o final e a situação), a tabela própria, a
   * da Regem e qual delas vale hoje para os produtos da loja.
   */
  async situacaoDaLoja(tenantId: string, unidadeId: string | null) {
    const { uf, cnpj } = await emitenteDaLoja(this.db, tenantId, unidadeId);
    const token = resumoTokenIbpt(await credencialComTokenIbpt(this.db, tenantId, unidadeId));
    // No servidor da loja o token não existe (fica só na nuvem): a tela avisa onde informar.
    const base = { uf, cnpj, protecaoConfigurada: chaveSegredosDisponivel(), token, servidorLocal: ehServidorLocal() };
    if (!uf) return { ...base, tabelaPropria: null, tabelaRegem: null, emUso: null, ncms: 0, ncmsSemPropria: 0 };
    const hoje = hojeNaUf(uf);
    const [propria, regem, ncms] = await Promise.all([
      versaoVigente(this.db, uf, hoje, tenantId),
      versaoVigente(this.db, uf, hoje),
      ncmsDaEmpresa(this.db, tenantId),
    ]);
    const faltando = propria ? await ncmsFaltando(this.db, propria.id, ncms) : ncms;
    const emUso = propria && faltando.length === 0 ? 'propria' : regem ? 'regem' : null;
    return {
      ...base,
      tabelaPropria: resumoVersao(propria),
      tabelaRegem: resumoVersao(regem),
      emUso,
      ncms: ncms.length,
      ncmsSemPropria: faltando.length,
    };
  }

  /**
   * Guarda o token do IBPT da loja (ou da rede). Testa ANTES, com o CNPJ do emitente: token
   * recusado não é guardado. IBPT fora do ar não impede — guarda e o job diário confere.
   * O token nunca vai para log, auditoria ou resposta.
   */
  async salvarToken(tenantId: string, atorId: string | null, unidadeId: string | null, tokenBruto: unknown) {
    if (ehServidorLocal()) throw new ForbiddenException('O token do IBPT é informado na nuvem.');
    const token = String(tokenBruto ?? '').trim();
    if (!tokenIbptPlausivel(token))
      throw new BadRequestException('Token inválido: copie o token inteiro da página da sua empresa no site do IBPT.');
    if (!chaveSegredosDisponivel())
      throw new BadRequestException('Proteção de segredos não configurada neste servidor — nada foi guardado.');
    const { uf, cnpj } = await emitenteDaLoja(this.db, tenantId, unidadeId);
    if (!uf || !cnpj || cnpj.length !== 14)
      throw new BadRequestException('Preencha e salve o CNPJ e a UF do emitente antes de informar o token do IBPT.');

    let verificacao: { status: 'ok' | 'erro'; mensagem: string | null };
    try {
      const r = await consultarNcmIbpt({ token, cnpj, uf, ncm: NCM_SONDA });
      verificacao = r
        ? { status: 'ok', mensagem: `Token aceito pelo IBPT (tabela ${r.versao}).` }
        : { status: 'erro', mensagem: 'O IBPT aceitou o token, mas não devolveu a alíquota de teste. Confiro de novo amanhã.' };
    } catch (e) {
      if (e instanceof ConsultaIbptRecusada)
        throw new BadRequestException(
          `O IBPT recusou este token para o CNPJ ${cnpj}. Confira se a empresa cadastrada no site do IBPT tem este CNPJ e copie o token de novo.`,
        );
      if (!(e instanceof IbptIndisponivel)) throw e;
      verificacao = { status: 'erro', mensagem: `Guardado sem testar: ${e.message} Confiro de novo amanhã.` };
    }

    await gravarTokenIbpt(this.db, tenantId, unidadeId, token, verificacao);
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil: '',
      tipo: 'fiscal',
      acao: 'cadastrou_token_ibpt',
      entidadeTipo: 'fiscal_credencial',
      entidadeId: null,
      // Só o final e o resultado do teste. O token, nunca.
      detalhe: { unidadeId, final: token.slice(-4), status: verificacao.status },
    });
    // A tabela própria começa já — em segundo plano, sem prender a tela (nunca rejeita, V3).
    if (verificacao.status === 'ok') void this.atualizarTabelasProprias([tenantId]);
    return this.situacaoDaLoja(tenantId, unidadeId);
  }

  /** Tira o token (exatamente desse escopo) e, se a empresa ficou sem nenhum, a tabela própria. */
  async removerToken(tenantId: string, atorId: string | null, unidadeId: string | null) {
    if (ehServidorLocal()) throw new ForbiddenException('O token do IBPT é removido na nuvem.');
    const final = await apagarTokenIbpt(this.db, tenantId, unidadeId);
    if (final === null) throw new BadRequestException('Não há token do IBPT guardado aqui.');
    await this.limparPropriasSemToken([tenantId]);
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil: '',
      tipo: 'fiscal',
      acao: 'removeu_token_ibpt',
      entidadeTipo: 'fiscal_credencial',
      entidadeId: null,
      detalhe: { unidadeId, final },
    });
    return this.situacaoDaLoja(tenantId, unidadeId);
  }

  /** Apaga a tabela própria de (empresa, UF) que não tem mais token nenhum valendo. */
  private async limparPropriasSemToken(tenantIds?: string[]) {
    const comToken = new Set((await lojasComTokenIbpt(this.db, tenantIds)).map((l) => `${l.tenantId}|${l.uf}`));
    const filtro = tenantIds?.length ? `{${tenantIds.join(',')}}` : null;
    const r: any = await this.db.execute(sql`
      select distinct tenant_id, uf from ibpt_versao
       where tenant_id is not null and (${filtro}::uuid[] is null or tenant_id = any(${filtro}::uuid[]))`);
    for (const x of (r.rows ?? r) as { tenant_id: string; uf: string }[])
      if (!comToken.has(`${x.tenant_id}|${x.uf}`)) await apagarTabelasProprias(this.db, x.tenant_id, x.uf);
  }

  /**
   * Todo dia, SÓ na nuvem: para cada empresa com token e cada UF dela, testa o token (um NCM) e
   * consulta no IBPT os NCMs dos produtos que a tabela própria ainda não tem. Consulta recusada
   * marca o token como inválido (a tela mostra) e a loja segue na tabela da Regem. IBPT fora do
   * ar: para por hoje, sem insistir. Nunca rejeita (roda em segundo plano, V3).
   * `tenantIds` limita a rodada (quem acabou de salvar o token; teste — LIC-084).
   */
  @Cron('17 6 * * *') // 06:17 todo dia — SÓ na nuvem
  async atualizarTabelasProprias(tenantIds?: string[]): Promise<{ atualizadas: string[] }> {
    const atualizadas: string[] = [];
    if (ehServidorLocal()) return { atualizadas };
    try {
      const grupos = new Map<string, LojaComTokenIbpt[]>();
      for (const l of await lojasComTokenIbpt(this.db, tenantIds)) {
        const k = `${l.tenantId}|${l.uf}`;
        grupos.set(k, [...(grupos.get(k) ?? []), l]);
      }
      for (const candidatas of grupos.values()) {
        const tenantId = candidatas[0].tenantId;
        if (this.atualizandoPropria.has(tenantId)) continue;
        this.atualizandoPropria.add(tenantId);
        try {
          const feito = await this.atualizarPropriaDaUf(candidatas);
          if (feito) atualizadas.push(feito);
        } catch (e: any) {
          this.log.warn(`Tabela própria do IBPT (${tenantId} ${candidatas[0].uf}) falhou: ${e?.message ?? e}`);
        } finally {
          this.atualizandoPropria.delete(tenantId);
        }
      }
      await this.limparPropriasSemToken(tenantIds);
    } catch (e: any) {
      this.log.warn(`Atualização das tabelas próprias do IBPT falhou: ${e?.message ?? e}`);
    }
    return { atualizadas };
  }

  /** Uma empresa numa UF: acha um token que funcione e completa a tabela própria. */
  private async atualizarPropriaDaUf(candidatas: LojaComTokenIbpt[]): Promise<string | null> {
    const { tenantId, uf } = candidatas[0];
    const vistas = new Set<string>();
    for (const loja of candidatas) {
      // A mesma credencial (da rede) serve várias lojas: testa uma vez por credencial + CNPJ.
      const chave = `${loja.credencialId}|${loja.cnpj}`;
      if (vistas.has(chave)) continue;
      vistas.add(chave);
      let token: string;
      try {
        token = tokenIbptDecifrado({ ibpt_token_cifrado: loja.tokenCifrado });
      } catch {
        await marcarVerificacaoIbpt(this.db, loja.credencialId, 'erro', 'Não consegui abrir o token guardado. Informe o token de novo.');
        continue;
      }
      let sonda: RespostaIbpt | null;
      try {
        sonda = await consultarNcmIbpt({ token, cnpj: loja.cnpj, uf, ncm: NCM_SONDA });
      } catch (e: any) {
        if (e instanceof ConsultaIbptRecusada) {
          const mensagem = `O IBPT recusou o token para o CNPJ ${loja.cnpj} (HTTP ${e.status}). Confira o cadastro da empresa no site do IBPT e informe o token de novo.`;
          await marcarVerificacaoIbpt(this.db, loja.credencialId, 'invalido', mensagem);
          TelemetriaBridge.reportar(tenantId, {
            origem: 'fiscal',
            nivel: 'warn',
            tipo: 'ibpt_token_invalido',
            mensagem,
            contexto: { uf, unidadeId: loja.unidadeId },
          });
          continue;
        }
        const motivo = e instanceof IbptIndisponivel ? e.message : 'Falha ao consultar o IBPT.';
        await marcarVerificacaoIbpt(this.db, loja.credencialId, 'erro', `${motivo} Tento de novo amanhã.`);
        return null; // IBPT com problema: não insiste com as outras credenciais hoje
      }
      if (!sonda) {
        await marcarVerificacaoIbpt(this.db, loja.credencialId, 'erro', 'O IBPT não devolveu a alíquota de teste. Tento de novo amanhã.');
        return null;
      }

      // Token bom: completa a tabela própria da versão que o IBPT está servindo.
      const { versao } = await gravarTabelaIbpt(
        this.db,
        { ...sonda, linhas: [linhaDaResposta(sonda)] },
        'ibpt-api',
        { tenantId, mesclar: true },
      );
      const faltando = (await ncmsFaltando(this.db, versao.id, await ncmsDaEmpresa(this.db, tenantId))).slice(
        0,
        MAX_NCMS_POR_RODADA,
      );
      const respostas: RespostaIbpt[] = [];
      let parou: string | null = null;
      for (let i = 0; i < faltando.length && !parou; i += CONSULTAS_SIMULTANEAS) {
        const lote = await Promise.all(
          faltando.slice(i, i + CONSULTAS_SIMULTANEAS).map((ncm) =>
            consultarNcmIbpt({ token, cnpj: loja.cnpj, uf, ncm }).then(
              (r) => ({ r, erro: null as unknown }),
              (erro: unknown) => ({ r: null, erro }),
            ),
          ),
        );
        for (const x of lote) {
          if (x.r) respostas.push(x.r);
          // Recusa de UM NCM (código que o IBPT não aceita) não derruba o resto; queda do IBPT sim.
          else if (x.erro instanceof IbptIndisponivel) parou = x.erro.message;
        }
      }
      // Agrupa por versão: na virada do mês o IBPT pode servir NCMs de versões diferentes.
      const porVersao = new Map<string, RespostaIbpt[]>();
      for (const r of respostas) {
        const k = `${r.versao}|${r.chave}`;
        porVersao.set(k, [...(porVersao.get(k) ?? []), r]);
      }
      for (const grupo of porVersao.values())
        await gravarTabelaIbpt(this.db, { ...grupo[0], linhas: grupo.map(linhaDaResposta) }, 'ibpt-api', {
          tenantId,
          mesclar: true,
        });
      await podarVersoesIbpt(this.db, uf, hojeNaUf(uf));
      await marcarVerificacaoIbpt(
        this.db,
        loja.credencialId,
        'ok',
        parou
          ? `Token aceito; ${respostas.length} de ${faltando.length} NCMs atualizados (${parou}). Continuo amanhã.`
          : `Token aceito pelo IBPT (tabela ${sonda.versao}).`,
      );
      if (respostas.length)
        this.log.log(`Tabela própria do IBPT ${uf} ${sonda.versao}: +${respostas.length} NCMs (empresa ${tenantId}).`);
      return `${tenantId} ${uf} ${sonda.versao}`;
    }
    return null;
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
