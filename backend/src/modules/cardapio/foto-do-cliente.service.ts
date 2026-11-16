import { Injectable, Logger } from '@nestjs/common';
import { ehServidorLocal } from '../../common/modo';
import {
  AnaliseDaFoto,
  MAX_BYTES_DA_FOTO,
  RECURSO_DA_FOTO,
  instrucoesDaFoto,
  lerAnaliseDaFoto,
  mimeDaFoto,
  perguntaDaFoto,
} from '../../common/foto-do-cliente';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { RoboRespostaService } from '../whatsapp/robo-resposta.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MODELO_PADRAO = 'claude-haiku-5-5';
const PRAZO_MS = 15_000;

/**
 * A LEITURA DA FOTO DO CLIENTE (16/11/2026 — decisão do dono; as regras em `common/foto-do-cliente.ts`). Baixa a foto que
 * chegou pelo WhatsApp (pela mesma porta da mídia do robô, nas duas vias) e pede ao modelo de visão o tipo e a descrição,
 * pela porta ÚNICA da IA da empresa (`IaEmpresaService`: a chave da empresa ou a da distribuição, e o medidor de uso com
 * o recurso `foto_do_cliente`). A imagem vai só nessa chamada e não é guardada; nada do conteúdo vai para o registro.
 *
 * NASCE DESLIGADO: só lê com `ROBO_FOTOS_IA=1` na nuvem (o dono liga). Só na nuvem. Nunca lança: sem leitura, a foto
 * segue para o atendente como sempre ("[o cliente mandou image sem texto]").
 */
@Injectable()
export class FotoDoClienteService {
  private readonly logger = new Logger('FotoDoCliente');

  constructor(
    private readonly ia: IaEmpresaService,
    private readonly resposta: RoboRespostaService,
  ) {}

  /** A leitura está ligada nesta nuvem? */
  disponivel(): boolean {
    return !ehServidorLocal() && process.env.ROBO_FOTOS_IA === '1';
  }

  modelo(): string {
    return String(process.env.ROBO_FOTOS_MODELO ?? '').trim() || MODELO_PADRAO;
  }

  /** O tipo e a descrição da foto desta mensagem — ou null (desligado, não é foto, grande demais, a IA não respondeu). */
  async olhar(msg: any): Promise<AnaliseDaFoto | null> {
    if (!this.disponivel() || String(msg?.tipo ?? '') !== 'image') return null;
    const tenantId = String(msg?.tenantId ?? '');
    if (!tenantId) return null;
    try {
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
      return analise;
    } catch (e: any) {
      // O motivo no registro; nunca a imagem, a legenda nem a resposta (V11).
      const motivo = e instanceof FalhaDaIa ? `IA: ${e.motivo}` : String(e?.code ?? e?.name ?? e?.message ?? e).slice(0, 120);
      this.logger.warn(`foto do cliente não lida (${motivo}): segue sem descrição`);
      return null;
    }
  }
}
