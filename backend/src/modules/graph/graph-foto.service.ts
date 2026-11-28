import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ClienteDmsId, ClienteMcp, ErroMcp } from '../../dms/integracao-dms';
import { decifrar } from '../../common/cifra-segredo';
import { ehServidorLocal } from '../../common/modo';
import { AnaliseDaFoto } from '../../common/foto-do-cliente';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { versaoNoAr } from '../integracao-api/hub.regras';
import {
  FERRAMENTA,
  FERRAMENTA_FALAR,
  type ConfigGraph,
  type Franquia,
  MOTIVO_ARGUMENTO_RECUSADO,
  PERMISSOES_DO_GRAPH,
  analiseDoGraph,
  chaveDaFoto,
  franquiaDe,
  graphLigadoParaEmpresa,
  lerConfigGraph,
  mimeDoGraph,
  motivoDaFalha,
  recusouArgumento,
} from './graph.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A ligação viva da empresa, com o segredo aberto (só em memória, só para a chamada). */
export type LigacaoDoGraph = { id: string; segredo: string };

/** A foto que vai ao Graph: os bytes e o tipo que chegaram pelo WhatsApp, e o id da mensagem (a chave de idempotência). */
export type FotoParaOGraph = { buffer: Buffer; mime: string; mensagemId?: unknown };

/** Menos que isso de prazo não vale chamar (o token e a ida e volta não cabem). */
const PRAZO_MINIMO_MS = 1_000;

/**
 * A LEITURA DA FOTO DO CLIENTE PELO DMS GRAPH (G5a; mig 450). Chamado pela `FotoDoClienteService` ANTES da IA da empresa
 * (G-4): com `GRAPH_LIGADO` e a ligação viva da empresa, a foto vai à porta MCP do Graph (`analisar_arquivo`) com a chave
 * de idempotência da mensagem (G-5), dentro do prazo que a leitura ainda tem. A resposta vira a MESMA análise de hoje
 * (`analiseDoGraph`); a franquia que veio fica guardada (GR-5). Qualquer recusa, erro ou demora devolve null — a foto segue
 * pela IA da empresa, no que sobrar do prazo. A ligação que o Graph não reconhece mais (401 `ligacao-invalida`: desfeita
 * lá) é marcada "desligada pelo Graph" UMA vez, com a auditoria, e a empresa volta sozinha à IA dela (GR-6).
 *
 * Só NUVEM (V1, V37): a leitura da foto e a ligação moram lá; no servidor da loja nada sai. Nunca lança. Nada do
 * conteúdo da foto nem da resposta vai para o registro (V11): só o motivo curto.
 */
@Injectable()
export class GraphFotoService {
  private readonly log = new Logger('GraphFoto');
  /** O fetch das duas pontas (DMS ID e porta) — os testes trocam por um falso. */
  buscar: typeof fetch = fetch;
  private dmsId: { chave: string; cliente: ClienteDmsId } | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return (r.rows ?? r) as any[];
  }

  /**
   * A ligação viva da empresa para ler a foto — ou null (desligado, sem ligação, empresa excluída, segredo que não abre).
   * A régua de "acesso vale" (V75): `GRAPH_LIGADO` com a empresa no piloto (`GRAPH_EMPRESAS`), a empresa viva e a
   * ligação não revogada, lidas NA HORA. Nunca lança.
   */
  async ligacaoParaFoto(tenantId: string): Promise<LigacaoDoGraph | null> {
    if (ehServidorLocal() || !lerConfigGraph().ligado || !graphLigadoParaEmpresa(tenantId)) return null;
    try {
      const [l] = await this.rows(sql`
        select l.id, l.segredo_cifrado
          from graph_ligacao l
          join empresa e on e.id = l.tenant_id and e.deleted_at is null
         where l.tenant_id = ${tenantId}::uuid and l.revogada_em is null
         limit 1`);
      if (!l) return null;
      try {
        return { id: String(l.id), segredo: decifrar(String(l.segredo_cifrado)) };
      } catch {
        this.log.error('a ligação da empresa com o DMS Graph não abre com a SEGREDOS_CHAVE desta nuvem: a foto segue pela IA da empresa');
        return null;
      }
    } catch (e: any) {
      this.log.warn(`ligação com o DMS Graph não lida (${String(e?.code ?? e?.message ?? e).slice(0, 80)}): a foto segue pela IA da empresa`);
      return null;
    }
  }

  /** O cliente da porta MCP com a ligação da empresa (também o da imagem, `GraphImagemService`). */
  cliente(cfg: ConfigGraph, segredo: string, prazoMs: number): ClienteMcp {
    const chave = `${cfg.emissor}|${cfg.aplicativo}`;
    if (!this.dmsId || this.dmsId.chave !== chave)
      this.dmsId = { chave, cliente: new ClienteDmsId({ emissor: cfg.emissor, aplicativo: cfg.aplicativo, segredo: cfg.segredo, buscar: this.buscar }) };
    return new ClienteMcp({
      endereco: cfg.endereco,
      recurso: cfg.recurso,
      permissoes: PERMISSOES_DO_GRAPH,
      dmsId: this.dmsId.cliente,
      ligacao: segredo,
      cliente: { nome: 'regem', versao: versaoNoAr() },
      buscar: this.buscar,
      // Uma tentativa só, no prazo que sobrou: a repetição é a IA da empresa (G-4), não o Graph de novo.
      tentativas: 1,
      tempoLimiteMs: prazoMs,
    });
  }

  /**
   * Lê a foto pelo Graph em até `prazoMs`. A análise, ou null (segue pela IA da empresa). Nunca lança. A resposta que
   * chega DEPOIS do prazo ainda guarda a franquia (o Graph já contou) e ainda marca a ligação desfeita.
   */
  async ler(tenantId: string, lig: LigacaoDoGraph, foto: FotoParaOGraph, prazoMs: number): Promise<AnaliseDaFoto | null> {
    return this.analisar(tenantId, lig, foto, prazoMs, analiseDoGraph);
  }

  /**
   * A leitura de um arquivo pelo Graph, com a tradução do resultado de quem chama: o atendente usa `analiseDoGraph` (a
   * foto do cliente, por `ler`); o Mister usa a dele (M5a, a foto e o PDF que a equipe manda — `mimes` com o PDF e o
   * `prefixoDaChave` próprio, para os dois usos nunca dividirem o resultado guardado no Graph). As mesmas regras de `ler`:
   * prazo, franquia, ligação desfeita e nunca lança. A tradução que devolve null = "fora do formato" (segue pela reserva).
   * M5b: `ferramenta` escolhe a da porta (a `ouvir_audio` para o áudio) e `aoFalhar` recebe o motivo curto de não ter lido
   * (`franquia-esgotada`, `demora`, `tipo-nao-aceito`, `ligacao-desfeita`…) — o áudio não tem reserva e diz por quê.
   * V7d: `extras` são argumentos opcionais novos (`lerTom`). O Graph antigo os recusa: o motivo é `argumento-recusado`,
   * sem registrar falha na ligação, e quem chamou repete sem eles.
   */
  async analisar<T>(
    tenantId: string,
    lig: LigacaoDoGraph,
    foto: FotoParaOGraph,
    prazoMs: number,
    traduzir: (dados: unknown) => T | null,
    opcoes: { mimes?: readonly string[]; prefixoDaChave?: string; ferramenta?: string; aoFalhar?: (motivo: string) => void; extras?: Readonly<Record<string, unknown>> } = {},
  ): Promise<T | null> {
    const falhou = (motivo: string): null => {
      opcoes.aoFalhar?.(motivo);
      return null;
    };
    const cfg = lerConfigGraph();
    if (ehServidorLocal() || !cfg.ligado || !graphLigadoParaEmpresa(tenantId)) return falhou('desligado');
    const mime = mimeDoGraph(foto.mime, opcoes.mimes);
    if (!mime) {
      await this.registrarLeitura(lig.id, 'tipo-nao-aceito', null);
      return falhou('tipo-nao-aceito');
    }
    if (prazoMs < PRAZO_MINIMO_MS) return falhou('sem-prazo');

    let chamada: Promise<unknown>;
    try {
      chamada = this.cliente(cfg, lig.segredo, prazoMs).chamar(opcoes.ferramenta ?? FERRAMENTA, {
        mimeType: mime,
        arquivoBase64: foto.buffer.toString('base64'),
        chaveIdempotencia: chaveDaFoto(tenantId, foto.mensagemId, foto.buffer, opcoes.prefixoDaChave),
        ...(opcoes.extras ?? {}),
      });
    } catch (e: any) {
      return falhou(await this.depoisDaFalha(tenantId, lig, e));
    }
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const prazo = new Promise<'prazo'>((resolver) => {
      relogio = setTimeout(() => resolver('prazo'), prazoMs);
    });
    try {
      const r = await Promise.race([chamada, prazo]);
      if (r === 'prazo') {
        this.log.warn(`o DMS Graph não respondeu em ${prazoMs} ms: a foto segue pela IA da empresa`);
        await this.registrarLeitura(lig.id, 'demora', null);
        // A que chegar depois: a franquia (já contada lá) e a ligação desfeita ainda valem. Nunca rejeita (V3).
        chamada.then(
          (dados) => this.registrarLeitura(lig.id, null, franquiaDe((dados as any)?.franquia)),
          (e) => this.depoisDaFalha(tenantId, lig, e, true),
        ).catch(() => undefined);
        return falhou('demora');
      }
      const analise = traduzir(r);
      const tipo = (analise as { tipo?: unknown } | null)?.tipo;
      if (!analise) this.log.warn('o DMS Graph respondeu fora do formato: a foto segue pela IA da empresa');
      else this.log.log(`foto lida pelo DMS Graph${typeof tipo === 'string' ? ` (${tipo})` : ''}`);
      await this.registrarLeitura(lig.id, analise ? 'lida' : 'fora-do-formato', franquiaDe((r as any)?.franquia), !!analise);
      return analise ?? falhou('fora-do-formato');
    } catch (e: any) {
      if (opcoes.extras && recusouArgumento(e)) return falhou(MOTIVO_ARGUMENTO_RECUSADO);
      return falhou(await this.depoisDaFalha(tenantId, lig, e));
    } finally {
      if (relogio) clearTimeout(relogio);
    }
  }

  /**
   * Versão 5, M5c: o texto vira a nota de voz (OGG/Opus) pela ferramenta `falar` do Graph (contrato 1.2.0), em até
   * `prazoMs`. Os bytes, ou null (a resposta segue só em texto). As mesmas regras do `analisar`: a chave da instalação e
   * da empresa, o prazo, a franquia do mês (a mesma) e a ligação desfeita; nunca lança. `aoFalhar` recebe o motivo curto
   * (`franquia-esgotada`, `demora`, `voz-desligada`, `fora-do-formato`…). A chave de idempotência é a de quem chama (a mesma
   * resposta repetida não gasta de novo). V7d: `estilo` (contrato 1.7.0) só vai quando vier; sem ele, a chamada é a de antes.
   * O Graph antigo recusa o `estilo` com `argumento-recusado`, e quem chamou repete sem ele.
   * Contrato 1.8.0 (o atendente virtual, 27/11): `estilo.pausas` e `opcoes.voz` (`feminina`) também só vão quando vierem; o
   * Graph de antes da 1.8.0 os recusa da mesma forma (`argumento-recusado`).
   */
  async falar(
    tenantId: string,
    lig: LigacaoDoGraph,
    texto: string,
    chave: string,
    prazoMs: number,
    aoFalhar?: (motivo: string) => void,
    estilo?: { tom: string; risada: boolean; pausas?: boolean } | null,
    opcoes?: { voz?: 'masculina' | 'feminina' } | null,
  ): Promise<Buffer | null> {
    const falhou = (motivo: string): null => {
      aoFalhar?.(motivo);
      return null;
    };
    const cfg = lerConfigGraph();
    if (ehServidorLocal() || !cfg.ligado || !graphLigadoParaEmpresa(tenantId)) return falhou('desligado');
    if (prazoMs < PRAZO_MINIMO_MS) return falhou('sem-prazo');
    let chamada: Promise<unknown>;
    try {
      const voz = opcoes?.voz;
      chamada = this.cliente(cfg, lig.segredo, prazoMs).chamar(FERRAMENTA_FALAR, {
        texto,
        chaveIdempotencia: chave,
        ...(estilo ? { estilo } : {}),
        ...(voz ? { voz } : {}),
      });
    } catch (e: any) {
      return falhou(await this.depoisDaFalha(tenantId, lig, e));
    }
    let relogio: ReturnType<typeof setTimeout> | undefined;
    const prazo = new Promise<'prazo'>((resolver) => {
      relogio = setTimeout(() => resolver('prazo'), prazoMs);
    });
    try {
      const r: any = await Promise.race([chamada, prazo]);
      if (r === 'prazo') {
        this.log.warn(`o DMS Graph não falou em ${prazoMs} ms: a resposta segue só em texto`);
        chamada.then(
          (dados) => this.registrarLeitura(lig.id, null, franquiaDe((dados as any)?.franquia)),
          (e) => this.depoisDaFalha(tenantId, lig, e, true),
        ).catch(() => undefined);
        return falhou('demora');
      }
      const bytes = r?.mimeType === 'audio/ogg' && typeof r?.audioBase64 === 'string' ? Buffer.from(r.audioBase64, 'base64') : null;
      if (!bytes || bytes.length < 5 || bytes.toString('ascii', 0, 4) !== 'OggS') {
        this.log.warn('o DMS Graph falou fora do formato: a resposta segue só em texto');
        return falhou('fora-do-formato');
      }
      await this.registrarLeitura(lig.id, null, franquiaDe(r?.franquia));
      return bytes;
    } catch (e: any) {
      // A voz ainda não ligada no Graph (o Google recusou): `integracao-parada` — diz qual, e a ligação segue valendo.
      if (e instanceof ErroMcp && e.tipo === 'ferramenta' && (e.dados as any)?.codigo === 'integracao-parada') return falhou('voz-desligada');
      if ((estilo || opcoes?.voz) && recusouArgumento(e)) return falhou(MOTIVO_ARGUMENTO_RECUSADO);
      return falhou(await this.depoisDaFalha(tenantId, lig, e));
    } finally {
      if (relogio) clearTimeout(relogio);
    }
  }

  /**
   * A recusa ou a falha: o motivo no registro e na ligação; a ligação desfeita no Graph sai daqui (GR-6). Nunca lança.
   * Devolve o motivo curto (M5b: quem chama diz à pessoa por que não leu).
   */
  private async depoisDaFalha(tenantId: string, lig: LigacaoDoGraph, e: any, tarde = false): Promise<string> {
    if (e instanceof ErroMcp && e.tipo === 'ligacao') {
      try {
        await this.marcarDesligadaPeloGraph(tenantId, lig.id);
      } catch (falha: any) {
        this.log.warn(`registro da falha do DMS Graph não gravado: ${String(falha?.code ?? falha?.message ?? falha).slice(0, 80)}`);
      }
      return 'ligacao-desfeita';
    }
    const motivo = motivoDaFalha(e);
    try {
      this.log.warn(`foto não lida pelo DMS Graph${tarde ? ' (depois do prazo)' : ''} (${motivo}): ${tarde ? 'já tinha seguido' : 'segue'} pela IA da empresa`);
      const franquia = e instanceof ErroMcp ? franquiaDe((e.dados as any)?.franquia) : null;
      await this.registrarLeitura(lig.id, tarde ? null : motivo, franquia);
    } catch (falha: any) {
      this.log.warn(`registro da falha do DMS Graph não gravado: ${String(falha?.code ?? falha?.message ?? falha).slice(0, 80)}`);
    }
    return motivo;
  }

  /**
   * A ligação que o Graph não reconhece mais (desfeita em "Aplicativos conectados" ou pela DMS): desligada AQUI, uma vez
   * só (a gravação condicional diz se foi esta chamada que desligou), com a auditoria. A próxima foto já vai à IA da empresa.
   */
  async marcarDesligadaPeloGraph(tenantId: string, ligacaoId: string): Promise<boolean> {
    const [l] = await this.rows(sql`
      update graph_ligacao
         set revogada_em = clock_timestamp(), revogada_origem = 'graph', revogada_por = 'DMS Graph',
             revogada_motivo = 'o DMS Graph não reconhece mais a ligação (desfeita lá)',
             ultima_leitura_em = clock_timestamp(), ultima_leitura_resultado = 'ligacao-desfeita'
       where id = ${ligacaoId}::uuid and tenant_id = ${tenantId}::uuid and revogada_em is null
      returning prefixo`);
    if (!l) return false;
    this.log.warn('o DMS Graph não reconhece mais a ligação desta empresa: desligada aqui; as fotos seguem pela IA da empresa');
    await this.auditoria?.registrar({
      tenantId,
      atorTipo: 'integracao',
      atorPerfil: null,
      tipo: 'integracao',
      acao: 'graph_desligou_a_empresa',
      entidadeTipo: 'graph_ligacao',
      entidadeId: ligacaoId,
      origem: 'graph',
      detalhe: { prefixo: l.prefixo ?? null, motivo: 'ligacao-invalida' },
    });
    return true;
  }

  /**
   * Guarda a última leitura e a franquia que veio (GR-5). A franquia só anda para a frente: outro mês mais novo, ou o
   * mesmo mês com o número igual ou maior — a resposta atrasada de uma foto não volta o "87 de 500" para "86".
   * `resultado` nulo = só a franquia. Nunca lança.
   */
  private async registrarLeitura(ligacaoId: string, resultado: string | null, franquia: Franquia | null, lida = false): Promise<void> {
    const anda = franquia
      ? sql`(franquia_mes is null or franquia_mes < ${franquia.mes} or (franquia_mes = ${franquia.mes} and coalesce(franquia_usados, 0) <= ${franquia.usados}))`
      : sql`false`;
    try {
      await this.db.execute(sql`
        update graph_ligacao set
          ultima_leitura_em        = case when ${resultado}::text is null then ultima_leitura_em else clock_timestamp() end,
          ultima_leitura_resultado = coalesce(${resultado}::text, ultima_leitura_resultado),
          ultimo_uso_em            = case when ${lida} then clock_timestamp() else ultimo_uso_em end,
          franquia_mes             = case when ${anda} then ${franquia?.mes ?? null}::text else franquia_mes end,
          franquia_usados          = case when ${anda} then ${franquia?.usados ?? null}::int else franquia_usados end,
          franquia_total           = case when ${anda} then ${franquia?.total ?? null}::int else franquia_total end,
          franquia_em              = case when ${anda} then clock_timestamp() else franquia_em end
         where id = ${ligacaoId}::uuid`);
    } catch (e: any) {
      this.log.warn(`a última leitura do DMS Graph não foi guardada: ${String(e?.code ?? e?.message ?? e).slice(0, 80)}`);
    }
  }
}
