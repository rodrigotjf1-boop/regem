import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { exigirBooleano } from '../../common/exigir';
import { escolherNumeroDaWaba, pedirCopiaDoApp } from '../whatsapp/coexistencia-meta';
import { tierParaNumero } from '../whatsapp/limite-meta';
import { Resposta, soDigitos } from './mister.regras';

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

export interface NumeroDoMister {
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

export type MotivoDoEnvio = 'sem_numero' | 'desligado' | 'sem_acesso' | 'meta';

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

type RespostaHttp = { ok: boolean; status: number; json: () => Promise<any>; text: () => Promise<string> };
export type Autor = { nome: string };

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
  protected buscar(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<RespostaHttp> {
    return fetch(url, init) as unknown as Promise<RespostaHttp>;
  }

  private token(): string {
    return process.env.WA_CLOUD_TOKEN ?? '';
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
        await this.db.execute(sql`
          select phone_id as "phoneId", waba_id as "wabaId", numero, nome_exibido as nome, forma, situacao, motivo, ligado,
                 ${iso('conectado_em')} as "conectadoEm", ${iso('situacao_em')} as "situacaoEm", ${iso('ultima_entrada_em')} as "ultimaEntradaEm"
            from mister_numero where id = 1`),
      );
      if (!l) return VAZIO;
      const situacao: SituacaoDoNumero = l.situacao === 'conectado' || l.situacao === 'caiu' ? l.situacao : 'sem';
      return { ...l, situacao, forma: l.forma === 'coexistencia' || l.forma === 'api' ? l.forma : null, ligado: l.ligado === true };
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
    if (!destino || !n.phoneId || n.situacao === 'sem') throw new FalhaDoEnvioDoMister('sem_numero');
    if (!n.ligado) throw new FalhaDoEnvioDoMister('desligado');
    const token = this.token();
    if (!token) throw new FalhaDoEnvioDoMister('sem_acesso');
    const texto = cortar(String(resposta.texto ?? '').trim(), resposta.botoes?.length ? 1024 : 4096);
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
             conectado_em = null, situacao_em = now(), alterado_por = ${autor.nome}, atualizado_em = now()
       where id = 1`);
    return this.ler();
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
