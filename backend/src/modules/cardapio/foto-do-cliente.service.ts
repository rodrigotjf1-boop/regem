import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ehServidorLocal } from '../../common/modo';
import { hojeISO } from '../../common/data';
import {
  AnaliseDaFoto,
  MAX_BYTES_DA_FOTO,
  RECURSO_DA_FOTO,
  instrucoesDaFoto,
  leituraLiberadaNaDistribuicao,
  lerAnaliseDaFoto,
  mimeDaFoto,
  perguntaDaFoto,
} from '../../common/foto-do-cliente';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { RoboRespostaService } from '../whatsapp/robo-resposta.service';
import { GraphFotoService } from '../graph/graph-foto.service';
import { guardarDescricaoDaFoto, lojaLeFotos, reservarLeituraDaFoto } from './foto-lida';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MODELO_PADRAO = 'claude-haiku-5-5';

/**
 * Os prazos da leitura (G5a): os 15 s de sempre valem para a leitura INTEIRA — o DMS Graph e, se ele não ler, a IA da
 * empresa no que sobrar (não 15 s para cada um). O Graph tem até 10 s; a IA só é chamada com 3 s ou mais pela frente.
 */
export const PRAZOS_DA_FOTO = { totalMs: 15_000, graphMs: 10_000, minimoDaIaMs: 3_000 } as const;

/**
 * A LEITURA DA FOTO DO CLIENTE (16/11/2026 — decisão do dono; as regras em `common/foto-do-cliente.ts`). Baixa a foto que
 * chegou pelo WhatsApp (pela mesma porta da mídia do robô, nas duas vias) e pede ao modelo de visão o tipo e a descrição,
 * pela porta ÚNICA da IA da empresa (`IaEmpresaService`: a chave da empresa ou a da distribuição, e o medidor de uso com
 * o recurso `foto_do_cliente`). A imagem vai só nessa chamada e não é guardada; nada do conteúdo vai para o registro.
 *
 * NASCE DESLIGADO, em duas portas (17/11/2026, mig 442): a distribuição libera (`ROBO_FOTOS_IA=1`) e a LOJA liga "Ler as
 * fotos que o cliente manda" (`robo_config.fotos_ler`). E até 5 fotos lidas por cliente por dia (`reservarLeituraDaFoto`,
 * decisão F7); a última descrição fica guardada para o caso ("O que a foto mostra", F5). Só na nuvem. Nunca lança: sem
 * leitura, a foto segue para o atendente como sempre ("[o cliente mandou image sem texto]") e ele pede para escrever.
 *
 * O DMS GRAPH PRIMEIRO (G5a, mig 450 — decisão G-4): com `GRAPH_LIGADO` e a ligação viva da EMPRESA, a foto vai antes ao
 * Graph (`GraphFotoService`), com a chave de idempotência da mensagem; o resultado dele vira a MESMA análise. Sem ligação,
 * ligação desfeita, recusa (franquia, vaga, chave), erro ou demora: segue pela IA da empresa como hoje, no que sobrar dos
 * mesmos 15 s. A vaga do dia continua ANTES de tudo, e as portas de cima (a distribuição e a loja) valem para as duas vias.
 */
@Injectable()
export class FotoDoClienteService {
  private readonly logger = new Logger('FotoDoCliente');
  /** Os prazos (os testes encurtam). */
  prazos: { totalMs: number; graphMs: number; minimoDaIaMs: number } = { ...PRAZOS_DA_FOTO };

  constructor(
    private readonly ia: IaEmpresaService,
    private readonly resposta: RoboRespostaService,
    @Optional() @Inject(DRIZZLE) private readonly db?: DrizzleDB,
    // O DMS Graph (G5a). Opcional: os testes da foto vivem sem ele, e sem ele tudo segue como antes.
    @Optional() private readonly graph?: GraphFotoService,
  ) {}

  /** A distribuição liberou a leitura nesta nuvem? (A loja ainda tem de ligar — `lojaLeFotos`.) */
  disponivel(): boolean {
    return !ehServidorLocal() && leituraLiberadaNaDistribuicao();
  }

  modelo(): string {
    return String(process.env.ROBO_FOTOS_MODELO ?? '').trim() || MODELO_PADRAO;
  }

  /** O tipo e a descrição da foto desta mensagem — ou null (desligado, não é foto, grande demais, a IA não respondeu). */
  async olhar(msg: any): Promise<AnaliseDaFoto | null> {
    if (!this.disponivel() || String(msg?.tipo ?? '') !== 'image') return null;
    const tenantId = String(msg?.tenantId ?? '');
    if (!tenantId || !this.db) return null;
    try {
      if (!(await lojaLeFotos(this.db, tenantId))) return null;
      // As duas vias: o DMS Graph (a ligação viva da empresa) e a IA da empresa. Nenhuma: nem baixa a foto.
      const ligacaoDoGraph = (await this.graph?.ligacaoParaFoto(tenantId)) ?? null;
      const temIa = await this.ia.temAcesso(tenantId);
      if (!ligacaoDoGraph && !temIa) return null;
      const { buffer, mime } = await this.resposta.midiaDoRegem({
        instancia: msg?.instancia ?? undefined,
        phoneNumberId: msg?.phoneNumberId ?? undefined,
        mediaId: msg?.midiaId ?? undefined,
        mensagemId: msg?.mensagemId ?? undefined,
        jid: msg?.jid ?? undefined,
      });
      const tipo = mimeDaFoto(mime);
      if (!tipo || !buffer?.length || buffer.length > MAX_BYTES_DA_FOTO) {
        this.logger.log(`foto não lida (${tipo ? `${buffer?.length ?? 0} bytes` : `tipo ${String(mime).slice(0, 40)}`})`);
        return null;
      }
      // A vaga do dia, reservada antes de chamar o Graph ou a IA (decisão F7): acabou, a foto segue sem descrição.
      const dia = hojeISO();
      if ((await reservarLeituraDaFoto(this.db, tenantId, msg?.de, dia)) == null) {
        this.logger.log('foto não lida: o cliente já mandou o limite de fotos lidas hoje');
        return null;
      }
      // O prazo é da leitura inteira (Graph + IA da empresa), a contar daqui.
      const fim = Date.now() + this.prazos.totalMs;
      let analise: AnaliseDaFoto | null = null;
      if (ligacaoDoGraph && this.graph) {
        analise = await this.graph.ler(tenantId, ligacaoDoGraph, { buffer, mime, mensagemId: msg?.mensagemId }, Math.min(this.prazos.graphMs, fim - Date.now()));
      }
      if (!analise) {
        if (!temIa) return null;
        const resta = fim - Date.now();
        if (resta < this.prazos.minimoDaIaMs) {
          this.logger.warn('foto não lida: o prazo da leitura acabou antes da IA da empresa');
          return null;
        }
        const r = await this.ia.pedir(tenantId, {
          recurso: RECURSO_DA_FOTO,
          modelo: this.modelo(),
          maxTokens: 300,
          system: instrucoesDaFoto(msg?.loja?.nome ?? null),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'image', source: { type: 'base64', media_type: tipo, data: buffer.toString('base64') } },
                { type: 'text', text: perguntaDaFoto(msg?.texto) },
              ],
            },
          ],
          prazoMs: resta,
        });
        if (r.recusou) return null;
        analise = lerAnaliseDaFoto(r.texto);
      }
      if (!analise) this.logger.warn('a leitura da foto voltou fora do formato: a foto segue sem descrição');
      // A descrição para o caso que o atendente abrir em seguida (F5). Não gravou: a foto segue igual, o caso abre sem o bloco.
      else
        await guardarDescricaoDaFoto(this.db, tenantId, msg?.de, analise, dia).catch((e: any) =>
          this.logger.warn(`descrição da foto não guardada para o caso: ${String(e?.code ?? e?.message ?? e).slice(0, 120)}`),
        );
      return analise;
    } catch (e: any) {
      // O motivo no registro; nunca a imagem, a legenda nem a resposta (V11).
      const motivo = e instanceof FalhaDaIa ? `IA: ${e.motivo}` : String(e?.code ?? e?.name ?? e?.message ?? e).slice(0, 120);
      this.logger.warn(`foto do cliente não lida (${motivo}): segue sem descrição`);
      return null;
    }
  }
}
