import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ehServidorLocal } from '../../common/modo';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { GraphFotoService } from '../graph/graph-foto.service';
import { MidiaDoMister, MisterEntradaService, QuemMandou, ResultadoDaMidia } from './mister-entrada.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { hojeISO } from '../../common/data';
import { FERRAMENTA_OUVIR } from '../graph/graph.regras';
import {
  AUDIO_MAX_SEGUNDOS,
  PRAZO_DA_VOZ_MS,
  chaveDaFala,
  principalParaFalar,
  MIMES_DO_AUDIO,
  PREFIXO_DA_CHAVE_DO_AUDIO,
  PRAZO_DO_AUDIO_MS,
  duracaoDoOggOpus,
  oQueOGraphOuviu,
  perguntaComAudio,
  primeiroDoMesQueVem,
  tipoDoAudio,
  MAX_BYTES_DA_MIDIA,
  MIMES_DO_MISTER_NA_IA,
  MIMES_DO_MISTER_NO_GRAPH,
  MODELO_DA_FOTO_DO_MISTER,
  OQueViu,
  PRAZOS_DA_FOTO_DO_MISTER,
  PREFIXO_DA_CHAVE_DO_MISTER,
  RECURSO_DA_FOTO_DO_MISTER,
  TEXTOS_DA_MIDIA,
  instrucoesDaFotoDoMister,
  lerOQueAIaViu,
  midiaNaInstalacao,
  oQueOGraphViu,
  perguntaComFoto,
  tipoAceito,
} from './mister-midia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

const mascarar = (t: string) => (t.length > 4 ? `***${t.slice(-4)}` : '***');

/** A promessa dentro do prazo, ou null quando ele passa. A que chegar depois é descartada sem rejeição solta (V3). */
async function dentroDoPrazo<T>(promessa: Promise<T>, ms: number): Promise<T | null> {
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<null>((resolver) => {
    relogio = setTimeout(() => resolver(null), ms);
  });
  try {
    return await Promise.race([promessa, prazo]);
  } finally {
    if (relogio) clearTimeout(relogio);
    promessa.catch(() => undefined);
  }
}

/**
 * A FOTO QUE A EQUIPE MANDA AO MISTER (versão 5, M5a; as regras em `mister-midia.regras.ts`). A entrada do WhatsApp passa
 * a foto (ou o PDF) por aqui ANTES dos documentos:
 *  • desligado (`MISTER_MIDIA`), ou figurinha/planilha: segue como antes (os documentos, ou "só leio texto");
 *  • a empresa sem a ligação com o DMS Graph: "só leio texto" com o caminho para ligar (a entrada responde, 1× a cada
 *    meia hora) — sem o Graph não há leitura (decisão 5: a IA da empresa é só a reserva dele);
 *  • com o Graph: baixa a mídia, o Graph lê (até 15 s) e, se ele não ler (demora, franquia, fora do ar), a IA da empresa
 *    lê no que sobrar dos 30 s (V106: prazo total). Nenhum dos dois: "não consegui ver a foto";
 *  • boleto ou nota: vai aos documentos (que leem e lançam como sempre); se eles não estiverem ligados, vira pergunta;
 *  • o resto: vira a pergunta (o que a foto mostra + a legenda), que a entrada põe na fila do agente.
 * A foto não fica guardada em lugar nenhum. Nunca lança: a falha fica no registro, com o motivo e sem o conteúdo (V11).
 */
@Injectable()
export class MisterMidiaService implements OnModuleInit {
  private readonly logger = new Logger('MisterMidia');
  /** Os prazos (os testes encurtam). */
  prazos: { totalMs: number; graphMs: number; minimoDaIaMs: number } = { ...PRAZOS_DA_FOTO_DO_MISTER };

  constructor(
    private readonly numero: MisterNumeroService,
    private readonly ia: IaEmpresaService,
    @Optional() private readonly entrada?: MisterEntradaService,
    // O DMS Graph (G5a). Opcional: sem ele, nada muda (a entrada segue como antes).
    @Optional() private readonly graph?: GraphFotoService,
  ) {}

  /** A foto chega pela entrada do WhatsApp, que mora no módulo de baixo. */
  onModuleInit(): void {
    this.entrada?.registrarMidia((quem, midia, wamid) => this.olhar(quem, midia, wamid));
  }

  /** A leitura de mídia do Mister está ligada nesta nuvem? */
  ligado(): boolean {
    return !ehServidorLocal() && midiaNaInstalacao();
  }

  modelo(): string {
    return String(process.env.MISTER_FOTO_MODELO ?? '').trim() || MODELO_DA_FOTO_DO_MISTER;
  }

  /**
   * Versão 5, M5c: a resposta em áudio. Quem chama (o agente) já mandou o texto e conferiu que a pergunta veio por áudio
   * e que a empresa ligou "Responder em áudio". O principal da resposta (~40 s) vira a nota de voz pela ferramenta `falar`
   * do DMS Graph e vai DEPOIS do texto. Devolve o desfecho curto (`enviado`, `desligado`, `sem-graph`, `sem-texto` ou o
   * motivo do Graph). Nunca lança: o que não deu fica no log, sem o texto (a pessoa já leu a resposta).
   */
  async responderEmAudio(tenantId: string, telefone: string, resposta: string): Promise<string> {
    if (!this.ligado() || !this.graph) return 'desligado';
    const texto = principalParaFalar(resposta);
    if (!texto) return 'sem-texto';
    let motivo = 'nao-falou';
    try {
      const lig = await this.graph.ligacaoParaFoto(tenantId);
      if (!lig) return 'sem-graph';
      const ogg = await this.graph.falar(tenantId, lig, texto, chaveDaFala(tenantId, texto), PRAZO_DA_VOZ_MS, (m) => (motivo = m));
      if (!ogg) {
        this.logger.warn(`mister: a resposta em áudio não saiu para ${mascarar(telefone)} (empresa ${tenantId}) — ${motivo}`);
        return motivo;
      }
      await this.numero.enviarAudio(telefone, ogg);
      return 'enviado';
    } catch (e: any) {
      const m = e instanceof FalhaDoEnvioDoMister ? `envio: ${e.motivo}` : String(e?.message ?? e).slice(0, 120);
      this.logger.warn(`mister: a nota de voz não saiu para ${mascarar(telefone)} (empresa ${tenantId}) — ${m}`);
      return 'erro';
    }
  }

  async olhar(quem: QuemMandou, midia: MidiaDoMister, wamid: string | null): Promise<ResultadoDaMidia> {
    if (!this.ligado() || !this.graph) return null;
    // M5b: o áudio vai à `ouvir_audio` do Graph.
    if (midia.tipo === 'audio') return this.ouvir(quem, midia, wamid);
    // Figurinha, planilha: não é com a mídia.
    if (!tipoAceito(midia.mime, MIMES_DO_MISTER_NA_IA) && midia.tipo !== 'imagem') return null;
    try {
      const lig = await this.graph.ligacaoParaFoto(quem.tenantId);
      if (!lig) return 'sem_graph';
      const arquivo = await this.numero.baixarMidia(midia.id);
      const mime = tipoAceito(arquivo?.mime ?? midia.mime, MIMES_DO_MISTER_NA_IA);
      if (!arquivo?.buffer?.length || arquivo.buffer.length > MAX_BYTES_DA_MIDIA || !mime) {
        this.logger.log(`foto do Mister não lida (${arquivo?.buffer?.length ? `${arquivo.buffer.length} bytes, ${String(arquivo?.mime ?? midia.mime).slice(0, 40)}` : 'não baixou'})`);
        await this.falar(quem.telefone, TEXTOS_DA_MIDIA.naoViu);
        return 'tratada';
      }

      // O prazo é da leitura inteira (Graph + reserva), a contar daqui.
      const fim = Date.now() + this.prazos.totalMs;
      let visto: OQueViu | null = await this.graph.analisar(
        quem.tenantId,
        lig,
        { buffer: arquivo.buffer, mime, mensagemId: wamid ?? undefined },
        Math.min(this.prazos.graphMs, fim - Date.now()),
        oQueOGraphViu,
        { mimes: MIMES_DO_MISTER_NO_GRAPH, prefixoDaChave: PREFIXO_DA_CHAVE_DO_MISTER },
      );
      let via: 'graph' | 'ia' = 'graph';
      if (!visto) {
        visto = await this.lerPelaIa(quem.tenantId, arquivo.buffer, mime, fim - Date.now());
        via = 'ia';
      }
      if (!visto) {
        await this.falar(quem.telefone, TEXTOS_DA_MIDIA.naoViu);
        return 'tratada';
      }
      return { pergunta: perguntaComFoto(visto, midia.legenda, via), documento: visto.financeiro };
    } catch (e: any) {
      const motivo = e instanceof FalhaDaIa ? `IA: ${e.motivo}` : String(e?.code ?? e?.name ?? e?.message ?? e).slice(0, 120);
      this.logger.warn(`foto do Mister não lida (${motivo})`);
      await this.falar(quem.telefone, TEXTOS_DA_MIDIA.naoViu);
      return 'tratada';
    }
  }

  /**
   * O ÁUDIO (M5b): a nota de voz vai à `ouvir_audio` do Graph, que transcreve pelo Gemini (o mesmo do atendente). Sem
   * reserva — a IA da empresa não ouve —, então cada falha diz o que fazer: o tipo que não dá, acima de 3 minutos (a
   * duração do OGG/Opus conferida ANTES de gastar a franquia), a franquia que acabou (volta no dia 1º) e o resto
   * ("não consegui entender"). Inaudível também. A transcrição vira a pergunta; o áudio não fica guardado.
   */
  private async ouvir(quem: QuemMandou, midia: MidiaDoMister, wamid: string | null): Promise<ResultadoDaMidia> {
    try {
      const lig = await this.graph!.ligacaoParaFoto(quem.tenantId);
      if (!lig) return 'sem_graph';
      const arquivo = await this.numero.baixarMidia(midia.id);
      if (!arquivo?.buffer?.length || arquivo.buffer.length > MAX_BYTES_DA_MIDIA) {
        await this.falar(quem.telefone, arquivo?.buffer?.length ? TEXTOS_DA_MIDIA.audioLongo : TEXTOS_DA_MIDIA.naoOuviu);
        return 'tratada';
      }
      const mime = tipoDoAudio(arquivo.mime ?? midia.mime);
      if (!mime) {
        this.logger.log(`áudio do Mister não ouvido (tipo ${String(arquivo.mime ?? midia.mime).slice(0, 40)})`);
        await this.falar(quem.telefone, TEXTOS_DA_MIDIA.audioTipo);
        return 'tratada';
      }
      const duracao = mime === 'audio/ogg' ? duracaoDoOggOpus(arquivo.buffer) : null;
      if (duracao != null && duracao > AUDIO_MAX_SEGUNDOS) {
        await this.falar(quem.telefone, TEXTOS_DA_MIDIA.audioLongo);
        return 'tratada';
      }
      let motivo = '';
      const ouvido = await this.graph!.analisar(
        quem.tenantId,
        lig,
        { buffer: arquivo.buffer, mime, mensagemId: wamid ?? undefined },
        this.prazoDoAudioMs,
        oQueOGraphOuviu,
        { ferramenta: FERRAMENTA_OUVIR, mimes: MIMES_DO_AUDIO, prefixoDaChave: PREFIXO_DA_CHAVE_DO_AUDIO, aoFalhar: (m) => (motivo = m) },
      );
      if (!ouvido) {
        this.logger.warn(`áudio do Mister não ouvido pelo DMS Graph (${motivo || 'sem motivo'})`);
        await this.falar(quem.telefone, motivo === 'franquia-esgotada' ? TEXTOS_DA_MIDIA.audioFranquia(primeiroDoMesQueVem(hojeISO())) : TEXTOS_DA_MIDIA.naoOuviu);
        return 'tratada';
      }
      if (ouvido.inaudivel) {
        await this.falar(quem.telefone, TEXTOS_DA_MIDIA.naoOuviu);
        return 'tratada';
      }
      return { pergunta: perguntaComAudio(ouvido.transcricao), documento: false };
    } catch (e: any) {
      this.logger.warn(`áudio do Mister não ouvido (${String(e?.code ?? e?.name ?? e?.message ?? e).slice(0, 120)})`);
      await this.falar(quem.telefone, TEXTOS_DA_MIDIA.naoOuviu);
      return 'tratada';
    }
  }

  /** O prazo do Graph para transcrever (os testes encurtam). */
  prazoDoAudioMs = PRAZO_DO_AUDIO_MS;

  /** A reserva: a IA da empresa lê a foto no que sobrou do prazo. Null = não leu (sem acesso, prazo, recusa, formato). */
  private async lerPelaIa(tenantId: string, buffer: Buffer, mime: string, resta: number): Promise<OQueViu | null> {
    if (resta < this.prazos.minimoDaIaMs) {
      this.logger.warn('foto do Mister não lida: o prazo acabou antes da IA da empresa');
      return null;
    }
    if (!(await this.ia.temAcesso(tenantId))) return null;
    const bloco =
      mime === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } }
        : { type: 'image', source: { type: 'base64', media_type: mime, data: buffer.toString('base64') } };
    // O `prazoMs` vale por tentativa do provedor: o relógio daqui garante o prazo TOTAL (V106).
    const r = await dentroDoPrazo(
      this.ia.pedir(tenantId, {
        recurso: RECURSO_DA_FOTO_DO_MISTER,
        modelo: this.modelo(),
        maxTokens: 500,
        system: instrucoesDaFotoDoMister(),
        messages: [{ role: 'user', content: [bloco, { type: 'text', text: 'Descreva esta imagem no formato pedido.' }] }],
        prazoMs: resta,
      }),
      resta,
    );
    if (!r) {
      this.logger.warn('foto do Mister não lida: a IA da empresa não respondeu no prazo');
      return null;
    }
    if (r.recusou) return null;
    const visto = lerOQueAIaViu(r.texto);
    if (!visto) this.logger.warn('a leitura da foto do Mister voltou fora do formato');
    return visto;
  }

  private async falar(telefone: string, texto: string): Promise<void> {
    try {
      await this.numero.enviar(telefone, { texto });
    } catch (e: any) {
      this.logger.warn(`a resposta da foto não saiu para ***${telefone.slice(-4)} — ${e?.message ?? e}`);
    }
  }
}
