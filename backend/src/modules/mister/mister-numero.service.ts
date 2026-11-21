import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { exigirBooleano } from '../../common/exigir';
import { escolherNumeroDaWaba, pedirCopiaDoApp } from '../whatsapp/coexistencia-meta';
import { tierParaNumero } from '../whatsapp/limite-meta';
import {
  IDIOMA_DOS_MODELOS,
  MODELOS_DO_MISTER,
  ModeloDoMister,
  SituacaoDoModelo,
  ToqueNoModelo,
  ehRecusaDoModelo,
  mensagemDoModelo,
  pedidoDeAprovacao,
  situacaoDoModelo,
} from './mister-modelos';
import { Resposta, corpoDaReacaoDoMister, soDigitos, textoParaOEvolution } from './mister.regras';
import { corposDaConferencia } from './mister-aparelho';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O NÚMERO DO MISTER (mig 417): um número de WhatsApp só, da DISTRIBUIÇÃO, para todas as empresas.
//  • Não é número de loja: mora numa linha única (`mister_numero`), fora de `cardapio_config` e de `whatsapp_numero`.
//    Conectar recusa um número que já é de uma loja, e a loja não consegue conectar o número do Mister.
//  • O acesso à Meta é o da distribuição (`WA_CLOUD_TOKEN`), o mesmo dos números das lojas: aqui não se guarda segredo.
//  • A CHAVE GERAL (`ligado`) nasce desligada e é conferida no ENVIO: desligada, nenhuma mensagem sai por este número,
//    venha de onde vier. Quem liga é a distribuição, no console.
//  • Só na nuvem: o servidor da loja não tem a tabela.

const GRAPH = 'https://graph.facebook.com/v25.0'; // a mesma versão do `whatsapp-cloud.service.ts`
const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703'; // banco sem a 417
const ID_DA_META = /^\d{5,32}$/;
const cortar = (t: string, n: number) => (t.length <= n ? t : `${t.slice(0, n - 1)}…`);
const iso = (coluna: string) => sql.raw(`to_char(${coluna} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`);

export type SituacaoDoNumero = 'sem' | 'conectado' | 'caiu';
export type FormaDoNumero = 'coexistencia' | 'api';
/** Q1 (mig 436): por onde o número fala — a API oficial da Meta (como sempre) ou o Evolution da distribuição. */
export type ProvedorDoNumero = 'oficial' | 'evolution';
/** Q2 (mig 437): a conexão por QR Code no Evolution. */
export type SituacaoDoQr = 'sem' | 'conectando' | 'conectado' | 'caiu' | 'bloqueado';
const SITUACOES_DO_QR: readonly SituacaoDoQr[] = ['sem', 'conectando', 'conectado', 'caiu', 'bloqueado'];
/** O ritmo de envio pelo Evolution: até 20 mensagens por minuto, em fila (decisão 4 do protótipo `regem-mister-qr.html`). */
export const RITMO_DO_EVOLUTION_POR_MINUTO = 20;

export interface NumeroDoMister {
  /** Q1: oficial (padrão) ou evolution; com evolution, a `instancia` é a do Mister no Evolution da distribuição. */
  provedor: ProvedorDoNumero;
  instancia: string | null;
  /** O número do celular conectado por QR na instância (o que as pessoas salvam, com o Evolution). */
  instanciaNumero: string | null;
  /** Q2 (mig 437): a conexão por QR — sem, conectando (o QR na tela), conectado, caiu ou bloqueado; a frase e as horas. */
  instanciaSituacao: SituacaoDoQr;
  instanciaMotivo: string | null;
  instanciaSituacaoEm: string | null;
  instanciaConectadaEm: string | null;
  /** O aceite do risco antes do primeiro QR (o nome, a data e a versão do texto). */
  aceite: { por: string | null; em: string; versao: string } | null;
  /** Q3: o último número anunciado às pessoas ligadas. */
  numeroAnunciado: string | null;
  phoneId: string | null;
  wabaId: string | null;
  numero: string | null;
  nome: string | null;
  forma: FormaDoNumero | null;
  situacao: SituacaoDoNumero;
  motivo: string | null;
  ligado: boolean;
  conectadoEm: string | null;
  situacaoEm: string | null;
  ultimaEntradaEm: string | null;
}

const VAZIO: NumeroDoMister = {
  provedor: 'oficial',
  instancia: null,
  instanciaNumero: null,
  instanciaSituacao: 'sem',
  instanciaMotivo: null,
  instanciaSituacaoEm: null,
  instanciaConectadaEm: null,
  aceite: null,
  numeroAnunciado: null,
  phoneId: null,
  wabaId: null,
  numero: null,
  nome: null,
  forma: null,
  situacao: 'sem',
  motivo: null,
  ligado: false,
  conectadoEm: null,
  situacaoEm: null,
  ultimaEntradaEm: null,
};

/** `modelo_nao_aprovado`: a Meta recusou o MODELO (não existe, não está aprovado, pausado ou desativado). `evolution`: o
 *  Evolution recusou ou não respondeu (Q1). */
export type MotivoDoEnvio = 'sem_numero' | 'desligado' | 'sem_acesso' | 'meta' | 'modelo_nao_aprovado' | 'evolution';

/** Um modelo do Mister como a Meta o vê agora, para o console. */
export interface ModeloNaMeta {
  nome: string;
  finalidade: string;
  corpo: string;
  botao: string;
  situacao: SituacaoDoModelo;
  /** A categoria que a Meta deu (ela pode mudar de utilidade para marketing). */
  categoria: string | null;
  /** O motivo da recusa, como a Meta escreveu. */
  motivo: string | null;
}

/** A mensagem não saiu: o motivo e, quando foi a Meta, o status e o que ela disse (nunca o texto da mensagem). */
export class FalhaDoEnvioDoMister extends Error {
  constructor(
    readonly motivo: MotivoDoEnvio,
    readonly status: number | null = null,
    readonly detalhe: string | null = null,
  ) {
    super(`Mister: envio ${motivo}${status ? ` (${status})` : ''}${detalhe ? `: ${detalhe}` : ''}`);
    this.name = 'FalhaDoEnvioDoMister';
  }
}

type RespostaHttp = { ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> };

/** M3a: a mídia que chega pelo número do Mister só vem dos domínios da Meta (como a do WhatsApp das lojas). */
const HOSTS_DA_MIDIA = ['fbsbx.com', 'fbcdn.net', 'facebook.com', 'whatsapp.net'];
const MAX_MIDIA_DO_MISTER = 20 * 1024 * 1024;
export type Autor = { nome: string };

/** Q1: o número que as pessoas veem e salvam — o da forma em uso (o celular do QR, com o Evolution). */
export const numeroEmUso = (n: NumeroDoMister): string | null => (n.provedor === 'evolution' ? n.instanciaNumero : n.numero);

/** Q1: dá para ligar e ser atendido — a chave geral ligada e a forma em uso conectada (a regra é uma, aqui). */
export const numeroDisponivel = (n: NumeroDoMister): boolean =>
  n.ligado && (n.provedor === 'evolution' ? n.instanciaSituacao === 'conectado' && !!n.instancia && !!n.instanciaNumero : n.situacao === 'conectado' && !!n.numero);

/**
 * A Meta diz que o objeto não existe mais para este acesso (código 100, subcódigo 33): o número saiu da conta, a conta
 * tirou o acesso do aplicativo ou a coexistência foi desfeita. É o único sinal que este serviço lê como "o número caiu";
 * qualquer outra recusa é falha daquele envio e fica no log.
 */
export function aMetaNaoReconheceONumero(erro: any): boolean {
  return Number(erro?.code) === 100 && Number(erro?.error_subcode) === 33;
}

@Injectable()
export class MisterNumeroService {
  private readonly logger = new Logger(MisterNumeroService.name);

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** A chamada à Meta. Separada para o teste trocar por uma resposta montada (nenhum teste fala com a Meta). */
  protected buscar(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | FormData }): Promise<RespostaHttp> {
    return fetch(url, init) as unknown as Promise<RespostaHttp>;
  }

  private token(): string {
    return process.env.WA_CLOUD_TOKEN ?? '';
  }

  /**
   * M3a (versão 3 do protótipo): baixa a foto ou o PDF que chegou pelo número do Mister na API oficial. A credencial é a
   * da distribuição (o número é dela). Primeiro os metadados (a Meta devolve um endereço temporário), depois o arquivo,
   * que também pede o token. Endereço fora dos domínios da Meta, arquivo grande demais ou qualquer falha → null.
   */
  async baixarMidia(mediaId: string): Promise<{ buffer: Buffer; mime: string } | null> {
    const id = String(mediaId ?? '').trim();
    const token = this.token();
    // Estrito: o id vai concatenado no endereço da Graph API.
    if (!/^[0-9]{5,32}$/.test(id) || !token) return null;
    const auth = { Authorization: `Bearer ${token}` };
    const meta = await this.buscar(`${GRAPH}/${id}`, { headers: auth }).catch(() => null);
    if (!meta?.ok) {
      this.logger.warn(`mídia ${id}: a Meta não deu os metadados (${meta?.status ?? 'sem resposta'})`);
      return null;
    }
    const j: any = await meta.json().catch(() => ({}));
    const url = String(j?.url ?? '');
    const mime = String(j?.mime_type ?? 'application/octet-stream');
    if (Number(j?.file_size ?? 0) > MAX_MIDIA_DO_MISTER) return null;
    let host = '';
    try {
      const u = new URL(url);
      if (u.protocol !== 'https:') return null;
      host = u.hostname;
    } catch {
      return null;
    }
    if (!HOSTS_DA_MIDIA.some((h) => host === h || host.endsWith(`.${h}`))) {
      this.logger.warn(`mídia ${id}: endereço fora dos domínios da Meta (${host})`);
      return null;
    }
    const bin = await this.buscar(url, { headers: auth }).catch(() => null);
    if (!bin?.ok || !bin.arrayBuffer) {
      this.logger.warn(`mídia ${id}: o arquivo não veio (${bin?.status ?? 'sem resposta'})`);
      return null;
    }
    const buffer = Buffer.from(await bin.arrayBuffer());
    return buffer.length > MAX_MIDIA_DO_MISTER ? null : { buffer, mime };
  }

  /** O que a janela da Meta precisa para abrir (o mesmo aplicativo das lojas). */
  cadastroNaMeta() {
    const appId = process.env.WA_CLOUD_APP_ID ?? '';
    const configId = process.env.WA_CLOUD_CONFIG_ID ?? '';
    return { appId, configId, graphVersion: 'v25.0', pronto: !!appId && !!configId && !!this.token() };
  }

  /** A linha única do número. Banco sem a 417 (ou sem a linha) = não conectado e desligado. */
  async ler(): Promise<NumeroDoMister> {
    try {
      const [l] = linhas(
        // O provedor e a instância (Q1, mig 436) lidos pelo `to_jsonb`: com o banco ainda sem as colunas, o número segue
        // na API oficial em vez de parecer desconectado.
        await this.db.execute(sql`
          select phone_id as "phoneId", waba_id as "wabaId", numero, nome_exibido as nome, forma, situacao, motivo, ligado,
                 ${iso('conectado_em')} as "conectadoEm", ${iso('situacao_em')} as "situacaoEm", ${iso('ultima_entrada_em')} as "ultimaEntradaEm",
                 to_jsonb(mister_numero) ->> 'provedor' as provedor, to_jsonb(mister_numero) ->> 'instancia' as instancia,
                 to_jsonb(mister_numero) ->> 'instancia_numero' as "instanciaNumero",
                 -- Q2 (mig 437), pelo mesmo to_jsonb: sem as colunas, a conexão por QR lê como "sem".
                 to_jsonb(mister_numero) ->> 'instancia_situacao' as "instanciaSituacao",
                 to_jsonb(mister_numero) ->> 'instancia_motivo' as "instanciaMotivo",
                 to_jsonb(mister_numero) ->> 'instancia_situacao_em' as "instanciaSituacaoEm",
                 to_jsonb(mister_numero) ->> 'instancia_conectada_em' as "instanciaConectadaEm",
                 to_jsonb(mister_numero) ->> 'aceite_por' as "aceitePor",
                 to_jsonb(mister_numero) ->> 'aceite_em' as "aceiteEm",
                 to_jsonb(mister_numero) ->> 'aceite_versao' as "aceiteVersao",
                 to_jsonb(mister_numero) ->> 'numero_anunciado' as "numeroAnunciado"
            from mister_numero where id = 1`),
      );
      if (!l) return VAZIO;
      const situacao: SituacaoDoNumero = l.situacao === 'conectado' || l.situacao === 'caiu' ? l.situacao : 'sem';
      const { aceitePor, aceiteEm, aceiteVersao, ...resto } = l;
      return {
        ...resto,
        situacao,
        forma: l.forma === 'coexistencia' || l.forma === 'api' ? l.forma : null,
        ligado: l.ligado === true,
        provedor: l.provedor === 'evolution' ? 'evolution' : 'oficial',
        instancia: l.instancia ? String(l.instancia) : null,
        instanciaNumero: l.instanciaNumero ? soDigitos(l.instanciaNumero) : null,
        instanciaSituacao: (SITUACOES_DO_QR as readonly string[]).includes(l.instanciaSituacao) ? l.instanciaSituacao : 'sem',
        instanciaMotivo: l.instanciaMotivo ?? null,
        instanciaSituacaoEm: l.instanciaSituacaoEm ?? null,
        instanciaConectadaEm: l.instanciaConectadaEm ?? null,
        aceite: aceiteEm && aceiteVersao ? { por: aceitePor ?? null, em: String(aceiteEm), versao: String(aceiteVersao) } : null,
        numeroAnunciado: l.numeroAnunciado ? soDigitos(l.numeroAnunciado) : null,
      };
    } catch (e) {
      if (semTabela(e)) return VAZIO;
      throw e;
    }
  }

  /** O número conectado, se este identificador da Meta é o dele. É a pergunta da entrada do webhook. */
  async doPhoneId(phoneId: string): Promise<NumeroDoMister | null> {
    const id = String(phoneId ?? '').trim();
    if (!ID_DA_META.test(id)) return null;
    const n = await this.ler();
    return n.situacao !== 'sem' && n.phoneId === id ? n : null;
  }

  /** Chegou mensagem pelo número: anota a hora e, se ele estava como "caiu", volta a conectado (a Meta está entregando). */
  async anotarEntrada(phoneId: string): Promise<void> {
    await this.db.execute(sql`
      update mister_numero
         set ultima_entrada_em = now(),
             situacao_em = case when situacao = 'conectado' then situacao_em else now() end,
             situacao = 'conectado', motivo = null, atualizado_em = now()
       where id = 1 and phone_id = ${phoneId}`);
  }

  // ───────────────────────────── o envio ─────────────────────────────

  /**
   * Manda uma resposta pelo número do Mister: texto, ou texto com até três botões. A chave geral é conferida AQUI — é o
   * único caminho de saída, então desligada nada sai. Devolve o id da mensagem na Meta.
   */
  async enviar(para: string, resposta: Resposta): Promise<{ wamid: string | null }> {
    const destino = soDigitos(para);
    const n = await this.ler();
    // Q1: uma forma por vez — com o Evolution escolhido, nada sai pela API oficial.
    if (n.provedor === 'evolution') return this.enviarPeloEvolution(destino, n, resposta);
    if (!destino || !n.phoneId || n.situacao === 'sem') throw new FalhaDoEnvioDoMister('sem_numero');
    if (!n.ligado) throw new FalhaDoEnvioDoMister('desligado');
    const token = this.token();
    if (!token) throw new FalhaDoEnvioDoMister('sem_acesso');
    const comLink = !resposta.botoes?.length && !!resposta.link?.url;
    const texto = cortar(String(resposta.texto ?? '').trim(), resposta.botoes?.length || comLink ? 1024 : 4096);
    const corpo = resposta.botoes?.length
      ? {
          to: destino,
          type: 'interactive',
          interactive: {
            type: 'button',
            body: { text: texto },
            action: { buttons: resposta.botoes.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: cortar(b.titulo, 20) } })) },
          },
        }
      : comLink
        ? {
            // O botão de link (F4.2a), no formato da documentação da Meta ("Interactive CTA URL button messages").
            to: destino,
            type: 'interactive',
            interactive: {
              type: 'cta_url',
              body: { text: texto },
              action: { name: 'cta_url', parameters: { display_text: cortar(resposta.link!.titulo, 20), url: resposta.link!.url } },
            },
          }
        : { to: destino, type: 'text', text: { body: texto } };
    const res = await this.buscar(`${GRAPH}/${n.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...corpo }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const j: any = res ? await res.json().catch(() => ({})) : {};
      const dito = String(j?.error?.error_user_msg || j?.error?.message || '').slice(0, 200) || null;
      if (aMetaNaoReconheceONumero(j?.error)) await this.marcarQueCaiu(n.phoneId, dito ?? 'A Meta não reconhece mais este número.');
      throw new FalhaDoEnvioDoMister('meta', res?.status ?? null, dito);
    }
    const j: any = await res.json().catch(() => ({}));
    return { wamid: j?.messages?.[0]?.id ?? null };
  }

  /**
   * M3a parte 4b: manda um PDF (o boleto lançado) pelo número do Mister, com o nome do arquivo e a legenda. Mesma chave
   * geral e mesmas conferências do `enviar`. Pela API oficial, sobe o arquivo à Meta (`/media`) e manda pelo id — só
   * dentro da janela de 24 horas (fora dela a Meta recusa; quem chama é o toque da pessoa, que abre a janela); pelo
   * Evolution, `sendMedia` com o arquivo em base64. O mesmo caminho do documento do WhatsApp das lojas.
   */
  async enviarDocumento(para: string, pdf: Buffer, arquivo: string, legenda = ''): Promise<{ wamid: string | null }> {
    if (!pdf?.length) throw new FalhaDoEnvioDoMister('meta', null, 'documento vazio');
    return this.enviarMidia(para, pdf, { tipo: 'document', mime: 'application/pdf', arquivo, legenda });
  }

  /**
   * M3c.3: manda uma IMAGEM (o gráfico do relatório, um PNG feito pelo código) pelo número do Mister, com a legenda. O
   * mesmo caminho do documento: pela API oficial sobe à Meta (`/media`) e manda pelo id; pelo Evolution, `sendMedia`.
   */
  async enviarImagem(para: string, png: Buffer, legenda = '', mime: 'image/png' | 'image/jpeg' = 'image/png'): Promise<{ wamid: string | null }> {
    if (!png?.length) throw new FalhaDoEnvioDoMister('meta', null, 'imagem vazia');
    return this.enviarMidia(para, png, { tipo: 'image', mime, arquivo: mime === 'image/jpeg' ? 'imagem.jpg' : 'grafico.png', legenda });
  }

  /**
   * M3d: uma imagem PÚBLICA pelo endereço (a tela do "como faço", um PNG estático do Regem, sem dado de loja): a Meta e o
   * Evolution buscam o arquivo; nada sobe daqui. As mesmas conferências do `enviar`. Só endereço do próprio Regem.
   */
  async enviarImagemPorLink(para: string, url: string, legenda = ''): Promise<{ wamid: string | null }> {
    if (!/^https:\/\/[^/\s]+\/como-faco\/[a-z0-9-]+\.png$/.test(url)) throw new FalhaDoEnvioDoMister('meta', null, 'endereço de imagem fora do padrão');
    const destino = soDigitos(para);
    const n = await this.ler();
    if (n.provedor === 'evolution') {
      if (!destino || !n.instancia || n.instanciaSituacao !== 'conectado') throw new FalhaDoEnvioDoMister('sem_numero');
      if (!n.ligado) throw new FalhaDoEnvioDoMister('desligado');
      const ev = this.evolution();
      if (!ev) throw new FalhaDoEnvioDoMister('sem_acesso');
      await this.vezNoEvolution();
      const res = await this.buscar(`${ev.url}/message/sendMedia/${encodeURIComponent(n.instancia)}`, {
        method: 'POST',
        headers: { apikey: ev.chave, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: destino, mediatype: 'image', mimetype: 'image/png', media: url, fileName: 'tela.png', caption: cortar(legenda, 1024) }),
      }).catch(() => null);
      if (!res || !res.ok) throw new FalhaDoEnvioDoMister('evolution', res?.status ?? null, res ? (await res.text().catch(() => '')).slice(0, 200) || null : null);
      const j: any = await res.json().catch(() => ({}));
      return { wamid: j?.key?.id ? String(j.key.id) : null };
    }
    if (!destino || !n.phoneId || n.situacao === 'sem') throw new FalhaDoEnvioDoMister('sem_numero');
    if (!n.ligado) throw new FalhaDoEnvioDoMister('desligado');
    const token = this.token();
    if (!token) throw new FalhaDoEnvioDoMister('sem_acesso');
    const res = await this.buscar(`${GRAPH}/${n.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: destino, type: 'image', image: { link: url, ...(legenda ? { caption: cortar(legenda, 1024) } : {}) } }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const j: any = res ? await res.json().catch(() => ({})) : {};
      throw new FalhaDoEnvioDoMister('meta', res?.status ?? null, String(j?.error?.error_user_msg || j?.error?.message || '').slice(0, 200) || null);
    }
    const j: any = await res.json().catch(() => ({}));
    return { wamid: j?.messages?.[0]?.id ?? null };
  }

  /**
   * Versão 5, M5c: a NOTA DE VOZ da resposta (OGG/Opus, da voz do Google pelo DMS Graph). Pela API oficial sobe à Meta e
   * vai com `voice: true` (a bolinha com a onda, não um arquivo; a Meta só mostra o tocar até 512 KB — acima, recusa
   * aqui); pelo Evolution, `sendWhatsAppAudio` (a nota de voz). O mesmo jeito da nota de voz do WhatsApp das lojas.
   */
  async enviarAudio(para: string, ogg: Buffer): Promise<{ wamid: string | null }> {
    if (!ogg?.length) throw new FalhaDoEnvioDoMister('meta', null, 'áudio vazio');
    if (ogg.length > 512 * 1024) throw new FalhaDoEnvioDoMister('meta', null, 'áudio acima de 512 KB');
    return this.enviarMidia(para, ogg, { tipo: 'audio', mime: 'audio/ogg', arquivo: 'resposta.ogg', legenda: '' });
  }

  /** O documento, a imagem e a nota de voz: as mesmas conferências do `enviar`, a mídia subida e a mensagem pelo id. */
  private async enviarMidia(
    para: string,
    bytes: Buffer,
    m: { tipo: 'document' | 'image' | 'audio'; mime: string; arquivo: string; legenda: string },
  ): Promise<{ wamid: string | null }> {
    const destino = soDigitos(para);
    const n = await this.ler();
    if (n.provedor === 'evolution') {
      if (!destino || !n.instancia || n.instanciaSituacao !== 'conectado') throw new FalhaDoEnvioDoMister('sem_numero');
      if (!n.ligado) throw new FalhaDoEnvioDoMister('desligado');
      const ev = this.evolution();
      if (!ev) throw new FalhaDoEnvioDoMister('sem_acesso');
      await this.vezNoEvolution();
      const res =
        m.tipo === 'audio'
          ? await this.buscar(`${ev.url}/message/sendWhatsAppAudio/${encodeURIComponent(n.instancia)}`, {
              method: 'POST',
              headers: { apikey: ev.chave, 'Content-Type': 'application/json' },
              body: JSON.stringify({ number: destino, audio: bytes.toString('base64'), encoding: true }),
            }).catch(() => null)
          : await this.buscar(`${ev.url}/message/sendMedia/${encodeURIComponent(n.instancia)}`, {
              method: 'POST',
              headers: { apikey: ev.chave, 'Content-Type': 'application/json' },
              body: JSON.stringify({ number: destino, mediatype: m.tipo, mimetype: m.mime, media: bytes.toString('base64'), fileName: m.arquivo, caption: cortar(m.legenda, 1024) }),
            }).catch(() => null);
      if (!res || !res.ok) throw new FalhaDoEnvioDoMister('evolution', res?.status ?? null, res ? (await res.text().catch(() => '')).slice(0, 200) || null : null);
      const j: any = await res.json().catch(() => ({}));
      return { wamid: j?.key?.id ? String(j.key.id) : null };
    }
    if (!destino || !n.phoneId || n.situacao === 'sem') throw new FalhaDoEnvioDoMister('sem_numero');
    if (!n.ligado) throw new FalhaDoEnvioDoMister('desligado');
    const token = this.token();
    if (!token) throw new FalhaDoEnvioDoMister('sem_acesso');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', m.mime);
    form.append('file', new Blob([new Uint8Array(bytes)], { type: m.mime }), m.arquivo);
    const up = await this.buscar(`${GRAPH}/${n.phoneId}/media`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }).catch(() => null);
    const midia: any = up?.ok ? await up.json().catch(() => ({})) : null;
    if (!midia?.id) {
      const j: any = up ? await up.json().catch(() => ({})) : {};
      throw new FalhaDoEnvioDoMister('meta', up?.status ?? null, String(j?.error?.message ?? `a Meta não devolveu o id ${m.tipo === 'image' ? 'da imagem' : m.tipo === 'audio' ? 'do áudio' : 'do documento'}`).slice(0, 200));
    }
    const legenda = m.legenda ? { caption: cortar(m.legenda, 1024) } : {};
    const conteudo =
      m.tipo === 'document'
        ? { document: { id: String(midia.id), filename: m.arquivo, ...legenda } }
        : m.tipo === 'audio'
          ? { audio: { id: String(midia.id), voice: true } }
          : { image: { id: String(midia.id), ...legenda } };
    const res = await this.buscar(`${GRAPH}/${n.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: destino, type: m.tipo, ...conteudo }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const j: any = res ? await res.json().catch(() => ({})) : {};
      throw new FalhaDoEnvioDoMister('meta', res?.status ?? null, String(j?.error?.error_user_msg || j?.error?.message || '').slice(0, 200) || null);
    }
    const j: any = await res.json().catch(() => ({}));
    return { wamid: j?.messages?.[0]?.id ?? null };
  }

  /**
   * Manda um MODELO aprovado pela Meta (fora da janela de 24 horas). Mesma chave geral e mesmas conferências do `enviar`.
   * O botão leva o código do toque. A recusa do modelo pela Meta vira `modelo_nao_aprovado`.
   */
  async enviarModelo(para: string, modelo: ModeloDoMister, parametros: [string, string], toque: ToqueNoModelo): Promise<{ wamid: string | null }> {
    const destino = soDigitos(para);
    const n = await this.ler();
    // Q1: o Evolution não tem janela nem modelo — quem chama confere `semJanela()` e manda o texto inteiro pelo `enviar`.
    if (n.provedor === 'evolution') throw new FalhaDoEnvioDoMister('evolution', null, 'o Evolution não usa modelo: mande o texto pelo envio de sempre');
    if (!destino || !n.phoneId || n.situacao === 'sem') throw new FalhaDoEnvioDoMister('sem_numero');
    if (!n.ligado) throw new FalhaDoEnvioDoMister('desligado');
    const token = this.token();
    if (!token) throw new FalhaDoEnvioDoMister('sem_acesso');
    const res = await this.buscar(`${GRAPH}/${n.phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(mensagemDoModelo(modelo, destino, parametros, toque)),
    }).catch(() => null);
    if (!res || !res.ok) {
      const j: any = res ? await res.json().catch(() => ({})) : {};
      const dito = String(j?.error?.error_user_msg || j?.error?.message || '').slice(0, 200) || null;
      if (aMetaNaoReconheceONumero(j?.error)) await this.marcarQueCaiu(n.phoneId, dito ?? 'A Meta não reconhece mais este número.');
      throw new FalhaDoEnvioDoMister(ehRecusaDoModelo(j?.error?.code) ? 'modelo_nao_aprovado' : 'meta', res?.status ?? null, dito);
    }
    const j: any = await res.json().catch(() => ({}));
    return { wamid: j?.messages?.[0]?.id ?? null };
  }

  /**
   * "Digitando…" no celular de quem perguntou enquanto o agente consulta, e a mensagem dela fica como LIDA — o mesmo
   * pedido faz as duas coisas (doc da Meta, "Typing indicators"; some quando a resposta sai ou em 25 s). Dispara e
   * segue: nunca lança e não segura a resposta — sem ele, o Mister responde igual.
   */
  mostrarDigitando(wamid: string): void {
    void this.ler()
      .then((n) => {
        const token = this.token();
        // No Evolution o "digitando" pede o telefone (não o id da mensagem): fica de fora — o Mister responde igual.
        if (!wamid || !n.ligado || n.provedor === 'evolution' || !n.phoneId || n.situacao === 'sem' || !token) return undefined;
        return this.buscar(`${GRAPH}/${n.phoneId}/messages`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: wamid, typing_indicator: { type: 'text' } }),
        });
      })
      .catch(() => undefined);
  }

  /**
   * Versão 4: REAGE à mensagem da pessoa (a linha `REACAO:` da resposta, como no atendente virtual), com o corpo da doc da
   * Meta (`corpoDaReacaoDoMister`). Só pela API oficial, com o número ligado e o id da mensagem; no Evolution devolve
   * false e quem chama manda o emoji como texto. Nunca lança: devolve se a Meta aceitou.
   */
  async reagir(para: string, wamid: string, emoji: string): Promise<boolean> {
    try {
      const destino = soDigitos(para);
      const n = await this.ler();
      const token = this.token();
      if (!destino || !wamid || !emoji || !n.ligado || n.provedor === 'evolution' || !n.phoneId || n.situacao === 'sem' || !token) return false;
      const res = await this.buscar(`${GRAPH}/${n.phoneId}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpoDaReacaoDoMister(destino, wamid, emoji)),
      });
      return !!res?.ok;
    } catch {
      return false;
    }
  }

  // ───────────────────────────── o Evolution (Q1, mig 436) ─────────────────────────────

  /** O Evolution da DISTRIBUIÇÃO (o mesmo das lojas — a instância do Mister é separada delas). Sem as duas, sem acesso. */
  private evolution(): { url: string; chave: string } | null {
    const url = String(process.env.EVOLUTION_API_URL ?? '').replace(/\/+$/, '');
    const chave = String(process.env.EVOLUTION_API_KEY ?? '');
    return url && chave ? { url, chave } : null;
  }

  /** A espera do ritmo. Separada para o teste anotar em vez de dormir. */
  protected esperar(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  // O ritmo do Evolution (até 20 por minuto, em fila): os envios entram um atrás do outro e, com 20 no último minuto, o
  // próximo espera o mais antigo sair da conta. É do NÚMERO (um só para todas as empresas), por réplica da API.
  private enviosRecentes: number[] = [];
  private filaDoEvolution: Promise<void> = Promise.resolve();
  private vezNoEvolution(): Promise<void> {
    const vez = this.filaDoEvolution.then(async () => {
      const agora = Date.now();
      this.enviosRecentes = this.enviosRecentes.filter((t) => agora - t < 60_000);
      if (this.enviosRecentes.length >= RITMO_DO_EVOLUTION_POR_MINUTO) await this.esperar(60_000 - (agora - this.enviosRecentes[0]) + 50);
      this.enviosRecentes.push(Date.now());
    });
    this.filaDoEvolution = vez.catch(() => undefined);
    return vez;
  }

  /** O envio pelo Evolution: texto só (os botões viram a lista numerada; o link, escrito). A chave geral vale igual. */
  private async enviarPeloEvolution(destino: string, n: NumeroDoMister, resposta: Resposta): Promise<{ wamid: string | null }> {
    // Q2: só com o celular conectado (caiu, bloqueado ou o QR ainda na tela: nada sai pelo WhatsApp; os avisos seguem no Regem).
    if (!destino || !n.instancia || n.instanciaSituacao !== 'conectado') throw new FalhaDoEnvioDoMister('sem_numero');
    if (!n.ligado) throw new FalhaDoEnvioDoMister('desligado');
    const ev = this.evolution();
    if (!ev) throw new FalhaDoEnvioDoMister('sem_acesso');
    const texto = cortar(textoParaOEvolution(resposta), 4096);
    await this.vezNoEvolution();
    const res = await this.buscar(`${ev.url}/message/sendText/${encodeURIComponent(n.instancia)}`, {
      method: 'POST',
      headers: { apikey: ev.chave, 'Content-Type': 'application/json' },
      body: JSON.stringify({ number: destino, text: texto }),
    }).catch(() => null);
    if (!res || !res.ok) {
      const dito = res ? (await res.text().catch(() => '')).slice(0, 200) || null : null;
      throw new FalhaDoEnvioDoMister('evolution', res?.status ?? null, dito);
    }
    const j: any = await res.json().catch(() => ({}));
    return { wamid: j?.key?.id ? String(j.key.id) : null };
  }

  /** O número fala pelo Evolution? Lá não há janela de 24 horas nem modelo: quem manda aviso e resumo manda o texto. */
  async semJanela(): Promise<boolean> {
    return (await this.ler()).provedor === 'evolution';
  }

  /** A instância é a do Mister (e ele está no Evolution)? É a pergunta da entrada do Evolution. */
  async daInstancia(instancia: string): Promise<NumeroDoMister | null> {
    const i = String(instancia ?? '').trim();
    if (!i) return null;
    const n = await this.ler();
    return n.provedor === 'evolution' && n.instancia === i ? n : null;
  }

  /** Chegou mensagem pelo Evolution: anota a hora. */
  async anotarEntradaPeloEvolution(): Promise<void> {
    await this.db.execute(sql`update mister_numero set ultima_entrada_em = now(), atualizado_em = now() where id = 1`);
  }

  // ── a gestão da instância (Q2, mig 437) — as chamadas ao Evolution passam pelo `buscar`, como o envio ──

  /** O Evolution e a assinatura da porta do Regem estão configurados neste servidor (sem os dois, nada de QR). */
  evolutionPronto(assinatura: string): boolean {
    return !!this.evolution() && !!assinatura;
  }

  private async noEvolution(caminho: string, init: { method: string; body?: unknown }): Promise<{ ok: boolean; status: number; j: any }> {
    const ev = this.evolution();
    if (!ev) throw new FalhaDoEnvioDoMister('sem_acesso');
    const res = await this.buscar(`${ev.url}${caminho}`, {
      method: init.method,
      headers: { apikey: ev.chave, 'Content-Type': 'application/json' },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    }).catch(() => null);
    if (!res) throw new FalhaDoEnvioDoMister('evolution', null, 'o Evolution não respondeu');
    const j: any = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, j };
  }

  /**
   * Cria a instância do Mister (se já existe, segue) e aponta o webhook para a porta assinada do Regem — sempre o Regem,
   * nunca o n8n: a mensagem que chega ao Mister é tratada aqui. Os eventos: mensagens e a conexão.
   */
  async evolutionPreparar(instancia: string, webhook: { url: string; headers: Record<string, string> }): Promise<void> {
    const gancho = { enabled: true, url: webhook.url, headers: webhook.headers, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] };
    await this.noEvolution('/instance/create', { method: 'POST', body: { instanceName: instancia, qrcode: true, integration: 'WHATSAPP-BAILEYS', webhook: gancho } }).catch(() => null);
    const r = await this.noEvolution(`/webhook/set/${encodeURIComponent(instancia)}`, { method: 'POST', body: { webhook: gancho } });
    if (!r.ok) throw new FalhaDoEnvioDoMister('evolution', r.status, 'o Evolution não aceitou o endereço de entrada da instância');
  }

  /** O QR Code da instância (a imagem e o código de pareamento), ou "já conectado". */
  async evolutionQr(instancia: string): Promise<{ imagem: string | null; codigo: string | null; jaConectado: boolean }> {
    const r = await this.noEvolution(`/instance/connect/${encodeURIComponent(instancia)}`, { method: 'GET' });
    if (!r.ok) throw new FalhaDoEnvioDoMister('evolution', r.status, 'o Evolution não devolveu o QR Code');
    const estado = r.j?.instance?.state ?? r.j?.state;
    if (estado === 'open') return { imagem: null, codigo: null, jaConectado: true };
    const b64 = String(r.j?.base64 ?? r.j?.qrcode?.base64 ?? '');
    const imagem = b64 ? (b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`) : null;
    return { imagem, codigo: r.j?.pairingCode ?? null, jaConectado: false };
  }

  /** O estado da conexão da instância: open, connecting ou close (null quando o Evolution não respondeu). */
  async evolutionEstado(instancia: string): Promise<string | null> {
    const r = await this.noEvolution(`/instance/connectionState/${encodeURIComponent(instancia)}`, { method: 'GET' }).catch(() => null);
    if (!r?.ok) return null;
    return String(r.j?.instance?.state ?? r.j?.state ?? '') || null;
  }

  /** O dono da instância (o número do celular conectado), como o Evolution o devolve. */
  async evolutionDono(instancia: string): Promise<string | null> {
    const r = await this.noEvolution(`/instance/fetchInstances?instanceName=${encodeURIComponent(instancia)}`, { method: 'GET' }).catch(() => null);
    if (!r?.ok) return null;
    const lista = Array.isArray(r.j) ? r.j : [r.j];
    const i = lista.find((x: any) => (x?.name ?? x?.instance?.instanceName ?? x?.instanceName) === instancia) ?? lista[0];
    return i?.ownerJid ?? i?.instance?.owner ?? i?.owner ?? null;
  }

  /** Sai da conta no Evolution (o celular deixa de estar conectado). Falha não segura quem chama. */
  async evolutionSair(instancia: string): Promise<void> {
    await this.noEvolution(`/instance/logout/${encodeURIComponent(instancia)}`, { method: 'DELETE' }).catch(() => null);
  }

  private async marcarQueCaiu(phoneId: string, motivo: string): Promise<void> {
    await this.db.execute(sql`
      update mister_numero set situacao = 'caiu', motivo = ${motivo.slice(0, 300)}, situacao_em = now(), atualizado_em = now()
       where id = 1 and phone_id = ${phoneId} and situacao = 'conectado'`);
    this.logger.warn(`o número do Mister caiu: ${motivo.slice(0, 200)}`);
  }

  // ───────────────────────────── o console da distribuição ─────────────────────────────

  /**
   * O que a Meta diz do número agora: nome, qualidade e quantas pessoas ele pode avisar por dia. Lido ao vivo ao abrir
   * o console. Se a Meta não reconhece mais o número, a situação vira "caiu" e o painel mostra o motivo.
   */
  async naMeta(n: NumeroDoMister): Promise<{ qualidade: string | null; avisosPorDia: number | 'ilimitado' | null; lido: boolean }> {
    const nada = { qualidade: null, avisosPorDia: null, lido: false };
    const token = this.token();
    if (!n.phoneId || n.situacao === 'sem' || !token) return nada;
    const res = await this.buscar(`${GRAPH}/${n.phoneId}?fields=display_phone_number,verified_name,quality_rating,whatsapp_business_manager_messaging_limit`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => null);
    if (!res) return nada;
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const dito = String(j?.error?.error_user_msg || j?.error?.message || `HTTP ${res.status}`).slice(0, 200);
      if (aMetaNaoReconheceONumero(j?.error)) await this.marcarQueCaiu(n.phoneId, dito);
      else this.logger.warn(`número do Mister: a Meta não respondeu à leitura (${res.status}) ${dito}`);
      return nada;
    }
    return {
      qualidade: j?.quality_rating ? String(j.quality_rating).toLowerCase() : null,
      avisosPorDia: tierParaNumero(j?.whatsapp_business_manager_messaging_limit ?? null),
      lido: true,
    };
  }

  // ───────────────────────────── os modelos de mensagem ─────────────────────────────

  /**
   * Os modelos do Mister como a Meta os vê agora, lidos na conta do NÚMERO DO MISTER — a conta de quem envia (ERR-458:
   * nunca "a primeira conta" ou a de uma loja). Uma leitura por modelo, pelo nome e pelo idioma. `lido` = false quando
   * o número não está conectado ou a Meta não respondeu: aí a situação de cada um fica sem leitura.
   */
  async modelosNaMeta(): Promise<{ lido: boolean; modelos: ModeloNaMeta[] }> {
    const base = (m: ModeloDoMister): ModeloNaMeta => ({ nome: m.nome, finalidade: m.finalidade, corpo: m.corpo, botao: m.botao, situacao: 'nao_pedido', categoria: null, motivo: null });
    const n = await this.ler();
    const token = this.token();
    if (!n.wabaId || n.situacao === 'sem' || !token) return { lido: false, modelos: MODELOS_DO_MISTER.map(base) };
    const modelos: ModeloNaMeta[] = [];
    for (const m of MODELOS_DO_MISTER) {
      const res = await this.buscar(
        `${GRAPH}/${n.wabaId}/message_templates?name=${encodeURIComponent(m.nome)}&fields=name,status,category,language,rejected_reason&limit=20`,
        { headers: { Authorization: `Bearer ${token}` } },
      ).catch(() => null);
      const j: any = res ? await res.json().catch(() => ({})) : {};
      if (!res || !res.ok) {
        this.logger.warn(`modelos do Mister: a Meta não respondeu à leitura (${res?.status ?? 'sem resposta'}) ${String(j?.error?.message ?? '').slice(0, 200)}`);
        return { lido: false, modelos: MODELOS_DO_MISTER.map(base) };
      }
      // O filtro `name` da Meta acha por trecho: só vale o nome exato, no idioma do Mister.
      const t = (Array.isArray(j?.data) ? j.data : []).find((x: any) => x?.name === m.nome && x?.language === IDIOMA_DOS_MODELOS);
      const motivo = t?.rejected_reason && String(t.rejected_reason).toUpperCase() !== 'NONE' ? String(t.rejected_reason).slice(0, 200) : null;
      modelos.push({ ...base(m), situacao: situacaoDoModelo(t?.status), categoria: t?.category ? String(t.category).toLowerCase() : null, motivo });
    }
    return { lido: true, modelos };
  }

  /**
   * Pede à Meta a aprovação dos modelos que ainda não existem na conta do número do Mister. O que já foi pedido (em
   * análise, aprovado, recusado) não é pedido de novo. Devolve a situação lida depois e o que foi pedido agora.
   */
  async pedirModelos(): Promise<{ modelos: ModeloNaMeta[]; pedidos: string[]; recusas: { nome: string; motivo: string }[] }> {
    const n = await this.ler();
    if (!n.wabaId || n.situacao !== 'conectado') throw new BadRequestException('Conecte o número do Mister antes de pedir os modelos.');
    const token = this.token();
    if (!token) throw new BadRequestException('WA_CLOUD_TOKEN não configurado no servidor.');
    const antes = await this.modelosNaMeta();
    if (!antes.lido) throw new BadRequestException('Não consegui ler os modelos na Meta agora. Tente de novo em instantes.');
    const pedidos: string[] = [];
    const recusas: { nome: string; motivo: string }[] = [];
    for (const m of MODELOS_DO_MISTER) {
      if (antes.modelos.find((x) => x.nome === m.nome)?.situacao !== 'nao_pedido') continue;
      const res = await this.buscar(`${GRAPH}/${n.wabaId}/message_templates`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(pedidoDeAprovacao(m)),
      }).catch(() => null);
      if (res && res.ok) {
        pedidos.push(m.nome);
        continue;
      }
      const j: any = res ? await res.json().catch(() => ({})) : {};
      const dito = String(j?.error?.error_user_msg || j?.error?.message || (res ? `HTTP ${res.status}` : 'sem resposta')).slice(0, 220);
      this.logger.warn(`modelos do Mister: a Meta recusou o pedido de ${m.nome} — ${dito}`);
      recusas.push({ nome: m.nome, motivo: dito });
    }
    const depois = await this.modelosNaMeta();
    return { modelos: depois.lido ? depois.modelos : antes.modelos, pedidos, recusas };
  }

  /**
   * Conclui a conexão que a janela da Meta começou (o mesmo cadastro integrado das lojas, com o aplicativo da
   * distribuição). `forma` = coexistencia (o número segue no WhatsApp Business do celular) ou api (só a API oficial —
   * aí a Meta exige registrar o número com um PIN de seis dígitos).
   */
  async conectar(dto: unknown, autor: Autor): Promise<{ numero: NumeroDoMister; avisos: string[] }> {
    const d = (dto ?? {}) as Record<string, unknown>;
    const forma: FormaDoNumero | null = d.forma === 'coexistencia' || d.forma === 'api' ? d.forma : null;
    if (!forma) throw new BadRequestException('Escolha como o número vai funcionar: no celular (coexistência) ou só na API oficial.');
    const wabaId = String(d.wabaId ?? '').trim();
    if (!ID_DA_META.test(wabaId)) throw new BadRequestException('O cadastro na Meta não concluiu (faltou a conta do WhatsApp Business). Tente conectar de novo.');
    const token = this.token();
    if (!token) throw new BadRequestException('WA_CLOUD_TOKEN não configurado no servidor.');
    const pin = soDigitos(d.pin);
    if (forma === 'api' && pin.length !== 6) throw new BadRequestException('Na forma "só na API oficial", informe o PIN de seis dígitos do número.');

    let phoneId = String(d.phoneNumberId ?? '').trim();
    if (!ID_DA_META.test(phoneId)) {
      // Na coexistência o evento da Meta pode vir sem o número: ele se acha na conta (o que está no aplicativo).
      const res = await this.buscar(`${GRAPH}/${wabaId}/phone_numbers?fields=id,display_phone_number,is_on_biz_app,platform_type`, {
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => null);
      const j: any = res && res.ok ? await res.json().catch(() => ({})) : {};
      phoneId = escolherNumeroDaWaba(Array.isArray(j?.data) ? j.data : [], forma === 'coexistencia');
      if (!phoneId)
        throw new BadRequestException(
          forma === 'coexistencia'
            ? 'Não achei, na conta da Meta, o número que está no WhatsApp Business do celular. Tente conectar de novo.'
            : 'Não encontrei o número na conta da Meta. Tente conectar de novo.',
        );
    }

    // O número do Mister é só dele: um número que já atende uma loja não vira o do Mister.
    const daLoja = await this.lojaDoNumero(phoneId);
    if (daLoja) throw new BadRequestException(`Este número já é o WhatsApp de uma loja (${daLoja}). O número do Mister precisa ser só dele.`);

    const avisos: string[] = [];
    // 1) Troca o código da janela pela confirmação do vínculo (a Meta exige; o acesso usado depois é o da distribuição).
    const appId = process.env.WA_CLOUD_APP_ID ?? '';
    const appSecret = process.env.WA_CLOUD_APP_SECRET ?? '';
    const code = String(d.code ?? '').trim();
    if (code && appId && appSecret) {
      await this.buscar(`${GRAPH}/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&code=${encodeURIComponent(code)}`).catch(() => null);
    }
    // 2) Assina o aplicativo na conta: sem isso as mensagens do número não chegam ao Regem.
    const assinou = await this.buscar(`${GRAPH}/${wabaId}/subscribed_apps`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (!assinou || !assinou.ok) {
      const j: any = assinou ? await assinou.json().catch(() => ({})) : {};
      const dito = String(j?.error?.error_user_msg || j?.error?.message || (assinou ? `HTTP ${assinou.status}` : 'sem resposta')).slice(0, 200);
      this.logger.warn(`número do Mister: a assinatura do aplicativo na conta falhou — ${dito}`);
      avisos.push(`A Meta não confirmou a assinatura do aplicativo na conta (${dito}). Sem ela as mensagens não chegam: conecte de novo.`);
    }
    // 3) Só na API: registra o número (na coexistência o aplicativo do celular já registrou).
    if (forma === 'api') {
      const reg = await this.buscar(`${GRAPH}/${phoneId}/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
      }).catch(() => null);
      if (!reg || !reg.ok) {
        const j: any = reg ? await reg.json().catch(() => ({})) : {};
        const dito = String(j?.error?.error_user_msg || j?.error?.message || 'sem resposta').slice(0, 220);
        throw new BadRequestException(`Não consegui registrar o número na Meta: ${dito}`);
      }
    }
    // 4) O número e o nome que a Meta mostra.
    let numero: string | null = null;
    let nome: string | null = null;
    const lido = await this.buscar(`${GRAPH}/${phoneId}?fields=display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
    if (lido && lido.ok) {
      const j: any = await lido.json().catch(() => ({}));
      numero = soDigitos(j?.display_phone_number) || null;
      nome = j?.verified_name ? String(j.verified_name).slice(0, 120) : null;
    }
    // 5) Guarda. A chave geral NÃO muda: conectar o número não liga o Mister.
    await this.db.execute(sql`
      insert into mister_numero (id, phone_id, waba_id, numero, nome_exibido, forma, situacao, motivo, conectado_em, situacao_em, alterado_por, atualizado_em)
      values (1, ${phoneId}, ${wabaId}, ${numero}, ${nome}, ${forma}, 'conectado', null, now(), now(), ${autor.nome}, now())
      on conflict (id) do update set
        phone_id = excluded.phone_id, waba_id = excluded.waba_id, numero = excluded.numero, nome_exibido = excluded.nome_exibido,
        forma = excluded.forma, situacao = 'conectado', motivo = null, conectado_em = now(), situacao_em = now(),
        alterado_por = excluded.alterado_por, atualizado_em = now()`);
    // 6) Coexistência: a Meta desfaz a conexão em 24 h se a cópia dos dados do aplicativo não for pedida. O Mister não
    //    usa essa cópia — o que chega dela (contatos e conversas do celular) não é de loja nenhuma e é descartado.
    if (forma === 'coexistencia') {
      const copia = await pedirCopiaDoApp({ graph: GRAPH, phoneNumberId: phoneId, token, buscar: (url, init) => this.buscar(url, init) });
      if (!copia.pedida) {
        this.logger.warn(`número do Mister: a Meta recusou o pedido de cópia do aplicativo — ${copia.motivo}`);
        avisos.push(`A Meta recusou um passo da coexistência (${copia.motivo}). Se não for refeito em 24 horas, ela desfaz a conexão: conecte de novo.`);
      }
    }
    return { numero: await this.ler(), avisos };
  }

  /**
   * A empresa que já usa este número como WhatsApp da loja — o principal (`cardapio_config`) ou o de marketing
   * (`whatsapp_numero`) —, ou null. Cada tabela é lida à parte: banco sem uma delas (o de uma loja) só não acha nada lá.
   */
  private async lojaDoNumero(phoneId: string): Promise<string | null> {
    const consultas = [
      sql`select e.nome from cardapio_config c join empresa e on e.id = c.tenant_id where c.wa_cloud_phone_id = ${phoneId} limit 1`,
      sql`select e.nome from whatsapp_numero w join empresa e on e.id = w.tenant_id where w.phone_id = ${phoneId} limit 1`,
    ];
    for (const consulta of consultas) {
      try {
        const [l] = linhas(await this.db.execute(consulta));
        if (l) return String(l.nome);
      } catch (e) {
        if (!semTabela(e)) throw e;
      }
    }
    return null;
  }

  /** Desconecta o número do Regem (as pessoas ligadas continuam ligadas e voltam a ser atendidas ao reconectar). */
  async desconectar(autor: Autor): Promise<NumeroDoMister> {
    await this.db.execute(sql`
      update mister_numero
         set phone_id = null, waba_id = null, numero = null, nome_exibido = null, forma = null, situacao = 'sem', motivo = null,
             conectado_em = null, situacao_em = now(), alterado_por = ${autor.nome}, atualizado_em = now(),
             conferir_aparelho = false
       where id = 1`);
    return this.ler();
  }

  // ───────────────────────────── a conferência do aparelho (M6b, A1.0; mig 484) ─────────────────────────────
  // Só OBSERVA: anota o hash que a Meta manda e quando ele mudou. Nenhuma resposta depende disto até a A1.0 medir o que
  // muda o hash. O hash nunca sai pela API: o console vê o final do número e as horas.

  /** Anota o hash do aparelho nos vínculos deste telefone, numa instrução só (o `set` lê os valores de antes). */
  async anotarAparelho(tel: string, hash: string): Promise<void> {
    await this.db.execute(sql`
      update mister_vinculo
         set aparelho_anterior_hash = case when aparelho_hash is not null and aparelho_hash <> ${hash} then aparelho_hash else aparelho_anterior_hash end,
             aparelho_mudou_em = case when aparelho_hash is not null and aparelho_hash <> ${hash} then now() else aparelho_mudou_em end,
             aparelho_hash = ${hash},
             aparelho_visto_em = now()
       where telefone = ${tel} and ligado_em is not null`);
  }

  /** O que o console mostra: se está ligado, quem ligou e os telefones vistos (só o final do número). */
  async conferenciaDoAparelho() {
    const n = await this.ler();
    const [c] = linhas(
      await this.db.execute(sql`
        select conferir_aparelho as ligado, ${iso('conferir_aparelho_em')} as em, conferir_aparelho_por as por
          from mister_numero where id = 1`),
    );
    const vistos = linhas(
      await this.db.execute(sql`
        with t as (
          select telefone, max(aparelho_visto_em) as visto, max(aparelho_mudou_em) as mudou
            from mister_vinculo
           where telefone is not null and ligado_em is not null and aparelho_visto_em is not null
           group by telefone
        )
        select right(telefone, 4) as final, ${iso('visto')} as "vistoEm", ${iso('mudou')} as "mudouEm",
               (select count(*) from t)::int as total, (select count(*) from t where mudou is not null)::int as mudaram
          from t order by visto desc limit 20`),
    );
    return {
      disponivel: n.provedor === 'oficial' && n.situacao !== 'sem' && !!n.phoneId,
      ligado: c?.ligado === true,
      em: c?.em ?? null,
      por: c?.por ?? null,
      vistos: Number(vistos[0]?.total) || 0,
      mudaram: Number(vistos[0]?.mudaram) || 0,
      telefones: vistos.map((v) => ({ final: String(v.final), vistoEm: String(v.vistoEm), mudouEm: v.mudouEm ? String(v.mudouEm) : null })),
    };
  }

  /** Liga ou desliga o recurso na Meta; só grava depois de a Meta aceitar. */
  async mudarConferenciaDoAparelho(dto: unknown, autor: Autor) {
    const ligado = exigirBooleano((dto as any)?.ligado, 'ligado');
    const n = await this.ler();
    if (n.provedor === 'evolution') throw new BadRequestException('A conferência do aparelho só existe na API oficial: pela conexão por QR Code a Meta não manda o hash.');
    const token = this.token();
    if (!n.phoneId || n.situacao === 'sem' || !token) throw new BadRequestException('Conecte o número do Mister antes de mudar a conferência do aparelho.');
    let dito = '';
    for (const corpo of corposDaConferencia(ligado)) {
      const res = await this.buscar(`${GRAPH}/${n.phoneId}/settings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(corpo),
      }).catch(() => null);
      if (!res) throw new BadRequestException('A Meta não respondeu. Nada mudou: tente de novo.');
      const j: any = await res.json().catch(() => ({}));
      if (res.ok && j?.success !== false) {
        this.logger.log(`conferência do aparelho ${ligado ? 'ligada' : 'desligada'}: a Meta aceitou "${Object.keys(corpo.user_identity_change)[0]}"`);
        await this.db.execute(sql`
          update mister_numero
             set conferir_aparelho = ${ligado}, conferir_aparelho_em = now(), conferir_aparelho_por = ${autor.nome}, atualizado_em = now()
           where id = 1`);
        return this.conferenciaDoAparelho();
      }
      dito = String(j?.error?.error_user_msg || j?.error?.message || `HTTP ${res.status}`).slice(0, 200);
      this.logger.warn(`conferência do aparelho: a Meta recusou "${Object.keys(corpo.user_identity_change)[0]}" (${res.status}) ${dito}`);
      if (res.status !== 400) break;
    }
    throw new BadRequestException(`A Meta não aceitou a mudança: ${dito}. Nada mudou.`);
  }

  /** A chave geral "Mister nesta nuvem". */
  async liberacao(dto: unknown, autor: Autor): Promise<{ ligado: boolean }> {
    const ligado = exigirBooleano((dto as any)?.ligado, 'ligado');
    await this.db.execute(sql`
      insert into mister_numero (id, ligado, alterado_por, atualizado_em) values (1, ${ligado}, ${autor.nome}, now())
      on conflict (id) do update set ligado = excluded.ligado, alterado_por = excluded.alterado_por, atualizado_em = now()`);
    return { ligado };
  }
}
