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
import { guardarDescricaoDaFoto, lojaLeFotos, reservarLeituraDaFoto } from './foto-lida';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MODELO_PADRAO = 'claude-haiku-5-5';
const PRAZO_MS = 15_000;

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
 */
@Injectable()
export class FotoDoClienteService {
  private readonly logger = new Logger('FotoDoCliente');

  constructor(
    private readonly ia: IaEmpresaService,
    private readonly resposta: RoboRespostaService,
    @Optional() @Inject(DRIZZLE) private readonly db?: DrizzleDB,
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
      if (!(await this.ia.temAcesso(tenantId))) return null;
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
      // A vaga do dia, reservada antes de chamar a IA (decisão F7): acabou, a foto segue sem descrição.
      const dia = hojeISO();
      if ((await reservarLeituraDaFoto(this.db, tenantId, msg?.de, dia)) == null) {
        this.logger.log('foto não lida: o cliente já mandou o limite de fotos lidas hoje');
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
        prazoMs: PRAZO_MS,
      });
      if (r.recusou) return null;
      const analise = lerAnaliseDaFoto(r.texto);
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
