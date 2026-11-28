import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ModuloService } from '../modulo/modulo.service';
import { NivelDoMister, TEXTOS_DO_AGENTE } from './mister-agente.regras';
import { MisterFilaService } from './mister-fila.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { pessoaVale } from './mister-vinculo.service';
import { MODELO_DO_AVISO, ToqueNoModelo, toqueNoModelo } from './mister-modelos';
import { dentroDaJanelaDoWhatsapp } from './mister-avisos.regras';
import { TEXTOS_DO_PIN_FALADO } from './mister-pin-falado';
import { TEXTOS_DA_PROPOSTA } from './mister-procedimentos';
import { TEXTOS_DA_MIDIA } from './mister-midia.regras';
import { hashDoRemetente } from './mister-aparelho';
import { ehAcaoDoMister } from './mister-acoes';
import { PROCEDIMENTO_DO_PLANO } from './mister-plano';
import { PROCEDIMENTO_DO_PEDIDO } from './mister-pedido';
import { PROCEDIMENTO_DA_TAREFA } from './mister-tarefas';
import type { ListaLida } from './mister-lista';
import {
  CODIGOS_ERRADOS_JANELA_MIN,
  CODIGOS_ERRADOS_MAX,
  CODIGO_VALE_MIN,
  PENDENTE_VALE_MIN,
  RESPOSTA_FIXA_A_CADA_H,
  Resposta,
  SO_TEXTO_A_CADA_MIN,
  TEXTOS,
  codigoNaMensagem,
  ehPararAvisos,
  ehTrocarDeEmpresa,
  ehVoltarAvisos,
  empresaEscolhida,
  pareceCodigo,
  perguntaDaEmpresa,
  primeiroNome,
  soDigitos,
  textoDoTelefoneDesligado,
} from './mister.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ENTRADA DO MISTER (mig 417): o que acontece com a mensagem que chega ao número da distribuição.
//
// As regras de separação entre empresas (`docs/plano-mister.md`), na ordem em que o código as aplica:
//  1. O telefone só representa alguém depois de ligado por dentro do Regem, com o código. Quem só escreve recebe uma
//     resposta FIXA — sem IA e sem dado de ninguém —, no máximo uma vez a cada 12 horas.
//  2. A pessoa precisa valer AGORA: ativa, gerente ou presidente, empresa viva e com o módulo Mister ligado. Quem saiu
//     ou foi rebaixado deixa de ser reconhecido na mensagem seguinte (a conferência é a cada mensagem).
//  3. O mesmo telefone pode estar em duas empresas: o Mister pergunta de qual é o assunto e guarda a escolha. Na dúvida
//     pergunta de novo — nunca chuta.
//  4. A chave geral (o console da distribuição) desligada: a mensagem é anotada e o Mister fica calado.
//  5. O que não é comando (código, parar ou voltar os avisos, trocar de empresa) é uma PERGUNTA: entra na fila
//     (`MisterFilaService`, mig 418), já com a empresa, a pessoa, a loja e o nível dela, e o agente de IA responde. A
//     entrada não espera a IA: a Meta recebe a confirmação na hora.
//
// Nada daqui lança para quem chamou (o webhook): cada falha vira log e a conversa segue. O registro das mensagens
// (`mister_mensagem`) não guarda texto; a pergunta fica na fila dela, com prazo, e a que espera a escolha da empresa
// fica na conversa por até 10 minutos.

const MODULO = 'mister';
const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const mascarar = (t: string) => (t.length > 4 ? `***${t.slice(-4)}` : '***');
const cortar = (t: string, n: number) => (t.length <= n ? t : t.slice(0, n));

export interface MensagemDoMister {
  telefone: string;
  texto: string;
  botaoId?: string | null;
  wamid?: string | null;
  /** O código do botão de um MODELO da Meta (o toque em "Ver o que fazer" ou "Ver resumo"). */
  codigoDoModelo?: string | null;
  /** M3a: a foto ou o PDF que veio na mensagem (pela API oficial). */
  midia?: MidiaDoMister | null;
  /** M6b: o hash do aparelho (pela API oficial) — anotado só quando a mensagem é nova (ERR-648). */
  aparelho?: string | null;
}

/** ERR-648 (rodada 7, MIS-A-12): a Meta reenvia por até 7 dias; mais velha que isso não é tratada. */
const MENSAGEM_VELHA_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * ERR-648 (rodada 7, MIS-A-09): a autorização que só QUEM PEDIU decide (a mesma regra do `responder` das propostas): a ação, o
 * plano, o pedido ao presidente e a tarefa pelo mapa. As outras (os avisos), só o presidente.
 */
export function decididaPorQuemPediu(procedimento: unknown): boolean {
  return ehAcaoDoMister(procedimento) || [PROCEDIMENTO_DO_PLANO, PROCEDIMENTO_DO_PEDIDO, PROCEDIMENTO_DA_TAREFA].includes(String(procedimento) as never);
}

/** M3a (versão 3 do protótipo): a foto ou o documento que chegou na conversa. O arquivo se baixa pelo `id` da Meta. */
export interface MidiaDoMister {
  /** M5b: o áudio (a nota de voz, `type: audio`) também — os documentos não tratam; o serviço da mídia ouve. */
  tipo: 'imagem' | 'documento' | 'audio';
  id: string;
  mime: string | null;
  /** Versão 10, C5: a Meta marcou a mensagem como encaminhada (`context.forwarded`) — o áudio encaminhado não vale como PIN. */
  encaminhada?: boolean;
  /**
   * Rodada 7, MIS-D-12 (ERR-655): no áudio da Meta, se é a NOTA DE VOZ gravada na hora (`audio.voice`); o arquivo de áudio
   * anexado (um áudio antigo, de outro lugar) vem `false` e não vale como PIN. Sem a informação (outra entrada): ausente.
   */
  voz?: boolean;
  /** M5a: o que a pessoa escreveu junto da foto (a legenda da Meta, `caption`). */
  legenda?: string | null;
}

/**
 * A mídia de uma mensagem da Meta: a foto (`type: image`), o arquivo (`type: document`) ou o áudio (`type: audio`, M5b),
 * pelo id. Outra coisa → null.
 */
export function midiaDaMeta(m: any): MidiaDoMister | null {
  const tipo = String(m?.type ?? '');
  const corpo = tipo === 'image' ? m?.image : tipo === 'document' ? m?.document : tipo === 'audio' ? m?.audio : null;
  const id = String(corpo?.id ?? '').trim();
  if (!corpo || !id) return null;
  const legenda = typeof corpo?.caption === 'string' && corpo.caption.trim() ? corpo.caption.trim() : null;
  const encaminhada = m?.context?.forwarded === true || m?.context?.frequently_forwarded === true;
  return {
    tipo: tipo === 'image' ? 'imagem' : tipo === 'audio' ? 'audio' : 'documento',
    id,
    mime: corpo?.mime_type ? String(corpo.mime_type) : null,
    legenda,
    ...(encaminhada ? { encaminhada: true } : {}),
    ...(tipo === 'audio' ? { voz: corpo?.voice === true } : {}),
  };
}

/** Quem mandou a mídia: o vínculo que vale para esta conversa (a empresa já escolhida). */
export interface QuemMandou {
  telefone: string;
  tenantId: string;
  colaboradorId: string;
  unidadeId: string | null;
  nivel: NivelDoMister;
  nome: string;
}
/** Quem trata a foto (o serviço dos documentos, M3a). Devolve se tratou; `false` segue o caminho de antes ("só leio texto"). */
export type TratarDocumento = (quem: QuemMandou, midia: MidiaDoMister, wamid: string | null) => Promise<boolean>;
/**
 * O que a leitura da foto (versão 5, M5a) fez: `null` = não é com ela (desligada, outro tipo: segue como antes);
 * `'sem_graph'` = a empresa não tem o DMS Graph (segue como antes, e o "só leio texto" diz como ligar); `'tratada'` = já
 * respondeu (não conseguiu ver); a pergunta = o que a foto mostra, para a fila — `documento` = é boleto ou nota (os
 * documentos tentam primeiro; não tratando, vira a pergunta).
 */
export type ResultadoDaMidia = null | 'sem_graph' | 'tratada' | { pergunta: string; documento: boolean };
export type TratarMidia = (quem: QuemMandou, midia: MidiaDoMister, wamid: string | null) => Promise<ResultadoDaMidia>;

/** Versão 6, M6g: o arquivo é uma planilha (Excel ou CSV)? Pelo tipo que a Meta informou. */
export const ehPlanilha = (mime: string | null | undefined): boolean =>
  /spreadsheetml|ms-excel|text\/csv|application\/csv/i.test(String(mime ?? ''));

/** Quem tocou no botão do modelo: o telefone e os vínculos dele que valem agora (empresa, pessoa, loja e nível). */
export interface QuemTocou {
  telefone: string;
  vinculos: Array<{ tenantId: string; colaboradorId: string; unidadeId: string | null; nivel: NivelDoMister; empresa: string }>;
  wamid: string | null;
}
/** Quem trata o toque (o serviço dos avisos ou o dos relatórios). Devolve se achou o que o modelo anunciou. */
export type TratarToque = (id: string, quem: QuemTocou) => Promise<boolean>;
/** Quem trata o toque num BOTÃO da conversa (a proposta do Mister, F4.1). Devolve se achou de quem é o botão. */
export type TratarBotao = (botaoId: string, quem: QuemTocou) => Promise<boolean>;

/** O que o Mister fez com a mensagem. Vai para `mister_mensagem.desfecho` e é o que os testes conferem. */
export type Desfecho =
  | 'repetida'
  | 'desligado'
  | 'ligou'
  | 'codigo_nao_vale'
  | 'codigos_demais'
  | 'codigo_calado'
  // ERR-648: o código mandado de novo por quem acabou de ligar (toque duplo) — conta como tentativa, sem resposta.
  | 'codigo_repetido'
  | 'numero_de_outra_pessoa'
  | 'sem_acesso'
  | 'fixa'
  | 'fixa_calada'
  | 'perguntou_empresa'
  | 'escolheu_empresa'
  | 'uma_empresa_so'
  | 'parou'
  | 'voltou'
  | 'pergunta'
  | 'so_texto'
  | 'tocou_modelo'
  | 'modelo_nao_achado'
  | 'respondeu_proposta'
  | 'proposta_nao_achada'
  | 'documento'
  | 'midia_nao_lida'
  /** Rodada 7, MIS-H-06: a foto/documento/áudio chegou com o teto do dia atingido — nada foi lido (nenhuma IA paga). */
  | 'limite_de_midia'
  /** Versão 10, C5: o áudio era o PIN falado (conferido pelo código; nada seguiu para a fila nem para a IA). */
  | 'pin_falado'
  | 'calado'
  /** Gravado pela rotina: a mensagem parou no meio e a lista de compras seguiu dali (ERR-584). */
  | 'retomada_lista';

interface Vinculo {
  id: string;
  tenantId: string;
  colaboradorId: string;
  unidadeId: string | null;
  nivel: NivelDoMister;
  nome: string;
  empresa: string;
}

@Injectable()
export class MisterEntradaService {
  private readonly logger = new Logger(MisterEntradaService.name);
  /** Quem trata o toque em cada tipo de modelo. Os serviços dos avisos e dos relatórios se apresentam ao subir. */
  private readonly toques = new Map<ToqueNoModelo['tipo'], TratarToque>();

  /** O serviço dos avisos ou o dos relatórios se apresenta (eles moram em outro módulo, que importa este). */
  registrarToque(tipo: ToqueNoModelo['tipo'], tratar: TratarToque): void {
    this.toques.set(tipo, tratar);
  }

  /** Quem trata cada BOTÃO da conversa, pelo prefixo do id (`prop:` = a proposta do Mister, que mora em outro módulo). */
  private readonly botoes = new Map<string, TratarBotao>();
  registrarBotao(prefixo: string, tratar: TratarBotao): void {
    this.botoes.set(prefixo, tratar);
  }

  /** M3a: quem trata a foto de um documento (o serviço dos documentos, no módulo do agente). */
  private documento: TratarDocumento | null = null;
  registrarDocumento(tratar: TratarDocumento): void {
    this.documento = tratar;
  }
  /** Versão 6, M6g: quem lê a planilha (a lista de compras). */
  private planilha: TratarDocumento | null = null;
  registrarPlanilha(tratar: TratarDocumento): void {
    this.planilha = tratar;
  }
  /** ERR-584: quem guarda as linhas de uma lista lida de foto ou PDF. A mídia entrega aqui; a lista mora em outro serviço. */
  private listaLida: ((quem: QuemMandou, lida: ListaLida) => Promise<boolean>) | null = null;
  registrarListaLida(guardar: (quem: QuemMandou, lida: ListaLida) => Promise<boolean>): void {
    this.listaLida = guardar;
  }
  async guardarListaLida(quem: QuemMandou, lida: ListaLida): Promise<boolean> {
    return (await this.listaLida?.(quem, lida)) ?? false;
  }
  /** Versão 5, M5a: quem lê a foto pelo DMS Graph (o serviço da mídia, no módulo do agente). */
  private midia: TratarMidia | null = null;
  registrarMidia(tratar: TratarMidia): void {
    this.midia = tratar;
  }

  /**
   * Versão 10, C5: o PIN falado. Quem trata decide se o áudio é o PIN (o PIN falado ligado e uma proposta de PIN esperando
   * esta pessoa): se for, confere pelo código e responde — 'tratado', e nada segue para a fila, a IA ou a memória. Senão, null.
   */
  private pinFalado: ((quem: QuemMandou, midia: MidiaDoMister, wamid: string | null) => Promise<'tratado' | null>) | null = null;
  registrarPinFalado(tratar: (quem: QuemMandou, midia: MidiaDoMister, wamid: string | null) => Promise<'tratado' | null>): void {
    this.pinFalado = tratar;
  }

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
    private readonly modulos: ModuloService,
    private readonly fila: MisterFilaService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** Este identificador da Meta é o número do Mister? (A loja não pode conectar o número do Mister como dela.) */
  async ehONumeroDoMister(phoneNumberId: string): Promise<boolean> {
    return !!(await this.numero.doPhoneId(phoneNumberId));
  }

  /**
   * O ponto de entrada do webhook. Devolve `true` quando o número é o do Mister — aí as mensagens são tratadas aqui e
   * NUNCA seguem para o caminho das lojas —, e `false` quando não é (o webhook segue como sempre).
   */
  async receberDaMeta(phoneNumberId: string, valor: any): Promise<boolean> {
    if (!(await this.numero.doPhoneId(phoneNumberId))) return false;
    await this.numero.anotarEntrada(phoneNumberId).catch((e) => this.logger.warn(`anotar a entrada falhou: ${e?.message ?? e}`));
    for (const m of valor?.messages ?? []) {
      // ERR-648 (rodada 7, MIS-A-12): sem o id não há trava de repetida — a mensagem não é tratada; e a que chega com mais de
      // 7 dias (o prazo de reenvio da Meta) é velha: o registro de "já tratei" (30 dias) pode não estar mais lá.
      if (!m?.id) {
        this.logger.warn(`mister: mensagem da Meta sem id (tipo=${m?.type}) — ignorada`);
        continue;
      }
      const enviadaEm = Number(m?.timestamp) * 1000;
      if (Number.isFinite(enviadaEm) && enviadaEm > 0 && Date.now() - enviadaEm > MENSAGEM_VELHA_MS) {
        this.logger.warn(`mister: mensagem ${m.id} de mais de 7 dias — ignorada`);
        continue;
      }
      const resposta = m?.interactive?.button_reply ?? m?.interactive?.list_reply;
      const entrada: MensagemDoMister = {
        telefone: soDigitos(m?.from),
        texto: String(m?.text?.body ?? m?.button?.text ?? resposta?.title ?? ''),
        botaoId: resposta?.id ? String(resposta.id) : null,
        wamid: m?.id ? String(m.id) : null,
        // O toque no botão de resposta rápida de um MODELO chega como `type: button`, com o código em `button.payload`.
        codigoDoModelo: m?.type === 'button' && m?.button?.payload ? String(m.button.payload) : null,
        // M3a: a foto (`type: image`) ou o arquivo (`type: document`) — o conteúdo se baixa pelo id.
        midia: midiaDaMeta(m),
      };
      // Versão 6, M6b (A1.0, mig 484): só ANOTA o hash do aparelho, antes de tratar (a mensagem que liga o telefone não
      // conta, porque o vínculo ainda não existe). Falhar aqui nunca impede a resposta. ERR-648: anotado em `receber`, DEPOIS
      // da trava de repetida (o reenvio não anota de novo).
      entrada.aparelho = hashDoRemetente(valor?.contacts, m?.from);
      try {
        const desfecho = await this.receber(entrada);
        this.logger.log(`mister de=${mascarar(entrada.telefone)} tipo=${m?.type} id=${m?.id} → ${desfecho}`);
      } catch (e: any) {
        this.logger.error(`mister: a mensagem ${m?.id} de ${mascarar(entrada.telefone)} não foi tratada — ${e?.message ?? e}`, e?.stack);
      }
    }
    return true;
  }

  /**
   * Q1 (mig 436): a entrada pelo Evolution, já com a assinatura da instância conferida pela porta do Evolution. Devolve
   * `true` quando a instância é a do Mister (com o Evolution em uso) — aí a mensagem é tratada aqui e NUNCA segue para o
   * caminho das lojas. O eco do que sai pelo próprio número (`fromMe`) nunca vira pergunta. "1" e "2" são a resposta à
   * última autorização aberta da pessoa (o Evolution não tem botão), a não ser que a pergunta "de qual empresa?" esteja
   * de pé — aí o número é a empresa, como sempre.
   */
  async receberDoEvolution(instancia: string, m: { telefone: string; texto: string; wamid: string | null; deMim: boolean }): Promise<boolean> {
    if (!(await this.numero.daInstancia(instancia))) return false;
    if (m.deMim) return true;
    await this.numero.anotarEntradaPeloEvolution().catch((e) => this.logger.warn(`anotar a entrada falhou: ${e?.message ?? e}`));
    const tel = soDigitos(m.telefone);
    const entrada: MensagemDoMister = {
      telefone: tel,
      texto: String(m.texto ?? ''),
      botaoId: await this.botaoPelaResposta(tel, m.texto),
      // O id do Evolution num espaço próprio: nunca colide com o da Meta na trava de mensagem repetida.
      wamid: m.wamid ? `evo:${m.wamid}` : null,
      codigoDoModelo: null,
    };
    try {
      const desfecho = await this.receber(entrada);
      this.logger.log(`mister (evolution) de=${mascarar(tel)} id=${m.wamid} → ${desfecho}`);
    } catch (e: any) {
      this.logger.error(`mister: a mensagem ${m.wamid} (evolution) de ${mascarar(tel)} não foi tratada — ${e?.message ?? e}`, e?.stack);
    }
    return true;
  }

  /** "1" ou "2" com uma autorização de botão aberta para este telefone (e sem a pergunta da empresa de pé): o botão dela. */
  private async botaoPelaResposta(tel: string, texto: unknown): Promise<string | null> {
    const dito = String(texto ?? '').trim();
    if (!tel || (dito !== '1' && dito !== '2')) return null;
    try {
      // ERR-648 (rodada 7, MIS-A-09): só as autorizações que ESTA pessoa decide — a de quem pediu (ação, plano, pedido, tarefa)
      // só por quem pediu; as outras, só pelo presidente — e a da empresa desta conversa antes da outra. Antes pegava a mais nova
      // entre todas as empresas do telefone, até a de outra pessoa.
      const abertas = linhas(
        await this.db.execute(sql`
          select p.id::text as id, p.procedimento, p.parametros ->> 'colaboradorId' as "pediu", v.colaborador_id::text as "colaboradorId",
                 coalesce(pa.nivel, f.categoria::text) as nivel, coalesce(p.tenant_id = cv.tenant_id, false) as "naConversa"
            from mister_proposta p
            join mister_vinculo v on v.tenant_id = p.tenant_id and v.telefone = ${tel} and v.ligado_em is not null
            join colaborador co on co.id = v.colaborador_id and co.tenant_id = v.tenant_id
            left join funcao f on f.id = co.funcao_id
            left join perfil_acesso pa on pa.id = co.perfil_acesso_id
            left join mister_conversa cv on cv.telefone = ${tel}
           where p.situacao = 'proposta' and p.nivel = 'botao' and p.vence_em > now()
             and not exists (select 1 from mister_conversa c
                              where c.telefone = ${tel} and c.perguntada_em > now() - make_interval(mins => ${PENDENTE_VALE_MIN}))
           order by p.criada_em desc
           limit 20`),
      );
      const minhas = abertas.filter((p) => (decididaPorQuemPediu(p.procedimento) ? p.pediu === p.colaboradorId : p.nivel === 'presidente'));
      const p = minhas.find((x) => x.naConversa === true) ?? minhas[0];
      return p ? `prop:${p.id}:${dito === '1' ? 'sim' : 'nao'}` : null;
    } catch (e: any) {
      if (e?.code === '42P01' || e?.cause?.code === '42P01') return null;
      throw e;
    }
  }

  /** Uma mensagem. Devolve o que foi feito. */
  async receber(e: MensagemDoMister): Promise<Desfecho> {
    const tel = soDigitos(e.telefone);
    if (!tel) return 'calado';
    // A Meta reenvia: a mesma mensagem só é tratada uma vez (a gravação diz se é nova).
    if (e.wamid) {
      const nova = linhas(await this.db.execute(sql`insert into mister_mensagem (wamid, telefone) values (${e.wamid}, ${tel}) on conflict (wamid) do nothing returning wamid`));
      if (!nova.length) return 'repetida';
    }
    if (e.aparelho) await this.numero.anotarAparelho(tel, e.aparelho).catch((err) => this.logger.warn(`anotar o aparelho falhou: ${err?.message ?? err}`));
    const desfecho = await this.tratar(tel, e);
    if (e.wamid) await this.db.execute(sql`update mister_mensagem set desfecho = ${desfecho.desfecho}, tenant_id = ${desfecho.tenantId ?? null}::uuid where wamid = ${e.wamid}`);
    return desfecho.desfecho;
  }

  private async tratar(tel: string, e: MensagemDoMister): Promise<{ desfecho: Desfecho; tenantId?: string | null }> {
    // A chave geral: desligada, o Mister não responde a ninguém (nem a código).
    const n = await this.numero.ler();
    if (!n.ligado) return { desfecho: 'desligado' };

    const texto = String(e.texto ?? '');
    if (codigoNaMensagem(texto) || pareceCodigo(texto)) return this.ligar(tel, codigoNaMensagem(texto));

    const vinculos = await this.vinculosDoTelefone(tel);
    if (!vinculos.length) {
      // Telefone que não está ligado: a resposta fixa, e só se a última foi há mais de 12 horas (gravação condicional).
      const vez = linhas(
        await this.db.execute(sql`
          insert into mister_conversa (telefone, fixa_em, ultima_entrada_em) values (${tel}, now(), now())
          on conflict (telefone) do update set fixa_em = now(), ultima_entrada_em = now(), atualizado_em = now()
            where mister_conversa.fixa_em is null or mister_conversa.fixa_em < now() - make_interval(hours => ${RESPOSTA_FIXA_A_CADA_H})
          returning telefone, desligado_motivo as motivo`),
      );
      if (!vez.length) return { desfecho: 'fixa_calada' };
      // Versão 6, M6a (mig 468): o telefone que JÁ foi ligado e saiu recebe a frase do motivo (60 dias sem conversa ou
      // desligado), e não a de quem nunca ligou.
      await this.responder(tel, { texto: textoDoTelefoneDesligado(vez[0]?.motivo) });
      return { desfecho: 'fixa' };
    }

    // O toque no botão de um modelo (o aviso ou o resumo que saiu fora das 24 horas): quem trata é o serviço dele, que
    // confere se aquilo foi mesmo para este telefone. Não vira pergunta para a IA.
    const toque = toqueNoModelo(e.codigoDoModelo);
    if (toque) return this.tocou(tel, toque, vinculos, e.wamid ?? null);

    // O toque num botão de PROPOSTA (F4.1): quem trata confere se a proposta é de uma empresa deste telefone, se a pessoa
    // pode autorizar e se ainda vale. Não vira pergunta para a IA nem escolha de empresa.
    const botao = e.botaoId ? [...this.botoes.entries()].find(([prefixo]) => String(e.botaoId).startsWith(prefixo)) : undefined;
    if (botao) return this.tocouBotao(tel, String(e.botaoId), botao[1], vinculos, e.wamid ?? null);

    const alvo = await this.empresaDaConversa(tel, e, vinculos);
    if ('desfecho' in alvo) return alvo;
    return this.atender(tel, alvo.vinculo, alvo.texto, e.wamid ?? null, e.wamid ?? null, e.midia ?? null);
  }

  /**
   * O toque no botão de um modelo. A mensagem da pessoa abriu a janela de 24 horas da Meta, que é do TELEFONE com o
   * número do Mister (não de uma empresa): a hora vale para todos os vínculos dele. Depois, quem trata aquele tipo de
   * modelo manda o texto inteiro, se o aviso ou o resumo foi mesmo para esta pessoa.
   */
  private async tocou(tel: string, toque: ToqueNoModelo, vinculos: Vinculo[], wamid: string | null): Promise<{ desfecho: Desfecho; tenantId?: string | null }> {
    await this.db.execute(sql`update mister_vinculo set ultima_entrada_em = now() where telefone = ${tel} and ligado_em is not null`);
    const tratar = this.toques.get(toque.tipo);
    const quem: QuemTocou = {
      telefone: tel,
      vinculos: vinculos.map((v) => ({ tenantId: v.tenantId, colaboradorId: v.colaboradorId, unidadeId: v.unidadeId ?? null, nivel: v.nivel, empresa: v.empresa })),
      wamid,
    };
    const achou = tratar ? await tratar(toque.id, quem).catch((err: any) => {
      this.logger.error(`mister: o toque no modelo (${toque.tipo}) de ${mascarar(tel)} não foi tratado — ${err?.message ?? err}`, err?.stack);
      return false;
    }) : false;
    if (achou) return { desfecho: 'tocou_modelo', tenantId: vinculos.length === 1 ? vinculos[0].tenantId : null };
    await this.responder(tel, { texto: TEXTOS.modeloNaoAchado });
    return { desfecho: 'modelo_nao_achado' };
  }

  /** O toque num botão da conversa: a mensagem renova a janela de 24 horas do telefone; quem trata o botão responde. */
  private async tocouBotao(tel: string, botaoId: string, tratar: TratarBotao, vinculos: Vinculo[], wamid: string | null): Promise<{ desfecho: Desfecho; tenantId?: string | null }> {
    await this.db.execute(sql`update mister_vinculo set ultima_entrada_em = now() where telefone = ${tel} and ligado_em is not null`);
    const quem: QuemTocou = {
      telefone: tel,
      vinculos: vinculos.map((v) => ({ tenantId: v.tenantId, colaboradorId: v.colaboradorId, unidadeId: v.unidadeId ?? null, nivel: v.nivel, empresa: v.empresa })),
      wamid,
    };
    const achou = await tratar(botaoId, quem).catch((err: any) => {
      this.logger.error(`mister: o botão de ${mascarar(tel)} não foi tratado — ${err?.message ?? err}`, err?.stack);
      return false;
    });
    if (achou) return { desfecho: 'respondeu_proposta', tenantId: vinculos.length === 1 ? vinculos[0].tenantId : null };
    await this.responder(tel, { texto: TEXTOS_DA_PROPOSTA.naoAchada });
    return { desfecho: 'proposta_nao_achada' };
  }

  // ───────────────────────────── ligar pelo código ─────────────────────────────

  private async ligar(tel: string, codigo: string | null): Promise<{ desfecho: Desfecho; tenantId?: string | null }> {
    // Muitos códigos errados: o telefone deixa de ser atendido em códigos até a janela passar (ninguém adivinha código).
    // ERR-648 (rodada 7, MIS-A-07): a tentativa é RESERVADA antes de conferir o código, na MESMA instrução que lê o teto (V98)
    // — mensagens em paralelo não passam das 5 por janela. O acerto zera a contagem (a conversa, depois de ligar).
    const [reserva] = linhas(
      await this.db.execute(sql`
        insert into mister_conversa (telefone, codigos_errados, codigos_desde, ultima_entrada_em) values (${tel}, 1, now(), now())
        on conflict (telefone) do update set
          codigos_errados = case when mister_conversa.codigos_desde is null or mister_conversa.codigos_desde < now() - make_interval(mins => ${CODIGOS_ERRADOS_JANELA_MIN})
                                 then 1 else mister_conversa.codigos_errados + 1 end,
          codigos_desde = case when mister_conversa.codigos_desde is null or mister_conversa.codigos_desde < now() - make_interval(mins => ${CODIGOS_ERRADOS_JANELA_MIN})
                               then now() else mister_conversa.codigos_desde end,
          ultima_entrada_em = now(), atualizado_em = now()
        returning codigos_errados as tentativas`),
    );
    const tentativas = Number(reserva?.tentativas) || 0;
    if (tentativas > CODIGOS_ERRADOS_MAX) return { desfecho: 'codigo_calado' };

    const [dono] = codigo
      ? linhas(
          await this.db.execute(sql`
            select g.tenant_id as "tenantId", c.unidade_id as "unidadeId", emp.nome as empresa
              from mister_vinculo g
              join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
              join empresa emp on emp.id = g.tenant_id
             where g.codigo = ${codigo} and g.codigo_expira_em > now()`),
        )
      : [];
    if (!dono) return this.codigoErrado(tel, tentativas);
    if (!(await this.modulos.ativo(dono.tenantId, dono.unidadeId ?? null, MODULO))) {
      await this.responder(tel, { texto: TEXTOS.semAcesso });
      return { desfecho: 'sem_acesso', tenantId: dono.tenantId };
    }

    // O número pode estar preso, nesta empresa, a quem não pode mais falar com o Mister: solta antes de ligar.
    await this.db.execute(sql`
      update mister_vinculo g
         set telefone = null, ligado_em = null, pausado_em = null, pin_ate = null, atualizado_em = now()
       where g.tenant_id = ${dono.tenantId}::uuid and g.telefone = ${tel}
         and not exists (
           select 1
             from colaborador c
             left join funcao f on f.id = c.funcao_id
             left join perfil_acesso p on p.id = c.perfil_acesso_id
             join empresa emp on emp.id = c.tenant_id
            where c.id = g.colaborador_id and c.tenant_id = g.tenant_id and ${pessoaVale()})`);

    let ligado: any[];
    try {
      // A gravação que liga confere TUDO de novo no mesmo comando: o código ainda vale e a pessoa ainda pode.
      // Versão 6, M6a (mig 468): ligar limpa o motivo do último desligamento e devolve o telefone ANTERIOR da pessoa (o
      // celular trocado) — ele sai do Mister nesta mesma gravação e a resposta diz o final dele.
      ligado = linhas(
        await this.db.execute(sql`
          with antes as (
            select id, telefone as anterior from mister_vinculo where codigo = ${codigo} and codigo_expira_em > now() for update)
          update mister_vinculo g
             set telefone = ${tel}, ligado_em = now(), pausado_em = null, codigo = null, codigo_expira_em = null,
                 ultima_entrada_em = now(), desligado_em = null, desligado_motivo = null, atualizado_em = now(),
                 -- ERR-642 (rodada 7, MIS-A-10): ligar (o celular novo, ou o mesmo de novo) começa sem a sessão com PIN do anterior.
                 pin_ate = null
            from antes, colaborador c
            left join funcao f on f.id = c.funcao_id
            left join perfil_acesso p on p.id = c.perfil_acesso_id
            join empresa emp on emp.id = c.tenant_id
           where g.id = antes.id and g.codigo = ${codigo} and g.codigo_expira_em > now()
             and c.id = g.colaborador_id and c.tenant_id = g.tenant_id and ${pessoaVale()}
          returning g.id, g.tenant_id as "tenantId", g.colaborador_id as "colaboradorId", c.nome, emp.nome as empresa, antes.anterior`),
      );
    } catch (err: any) {
      if (err?.code !== '23505') throw err;
      await this.responder(tel, { texto: TEXTOS.numeroDeOutraPessoa(dono.empresa) });
      return { desfecho: 'numero_de_outra_pessoa', tenantId: dono.tenantId };
    }
    if (!ligado.length) {
      // O código existia há um instante e a gravação não ligou: a pessoa deixou de poder, ou outra mensagem usou o código.
      const [jaLigou] = linhas(
        await this.db.execute(sql`
          select 1 from mister_vinculo
           where tenant_id = ${dono.tenantId}::uuid and telefone = ${tel} and ligado_em > now() - make_interval(mins => ${CODIGO_VALE_MIN})`),
      );
      if (jaLigou) return { desfecho: 'calado', tenantId: dono.tenantId };
      await this.responder(tel, { texto: TEXTOS.semAcesso });
      return { desfecho: 'sem_acesso', tenantId: dono.tenantId };
    }

    const g = ligado[0];
    // A conversa passa a ser desta empresa, e a contagem de códigos errados zera.
    await this.db.execute(sql`
      insert into mister_conversa (telefone, tenant_id, escolhida_em, ultima_entrada_em) values (${tel}, ${g.tenantId}::uuid, now(), now())
      on conflict (telefone) do update
        set tenant_id = excluded.tenant_id, escolhida_em = now(), perguntada_em = null, pendente = null, pendente_em = null,
            codigos_errados = 0, codigos_desde = null, ultima_entrada_em = now(), desligado_em = null, desligado_motivo = null,
            atualizado_em = now()`);
    // O celular trocado: o telefone antigo fica marcado como desligado pela própria pessoa (quem escrever dele recebe a frase
    // de desligado). Só se ele não estiver ligado a outra pessoa ou empresa.
    const anterior = g.anterior && String(g.anterior) !== tel ? String(g.anterior) : null;
    if (anterior) {
      await this.db.execute(sql`
        update mister_conversa set desligado_em = clock_timestamp(), desligado_motivo = 'pessoa', atualizado_em = now()
         where telefone = ${anterior} and not exists (select 1 from mister_vinculo v where v.telefone = ${anterior} and v.ligado_em is not null)`);
      // ERR-642: os links públicos que ela pediu chegaram ao celular antigo — deixam de valer (como no desligar).
      await this.db
        .execute(sql`
          update mister_link_publico set revogado_em = clock_timestamp()
           where tenant_id = ${g.tenantId}::uuid and criado_por = ${g.colaboradorId}::uuid and revogado_em is null and vence_em > now()`)
        .catch((e: any) => {
          if (!['42P01'].includes(e?.code ?? e?.cause?.code)) throw e;
        });
    }
    await this.auditoria?.registrar({
      tenantId: g.tenantId,
      atorId: g.colaboradorId,
      tipo: 'config',
      acao: 'mister_whatsapp_ligado',
      entidadeTipo: 'mister_vinculo',
      entidadeId: g.id,
      origem: 'whatsapp',
      detalhe: { final: tel.slice(-4), ...(anterior ? { trocou: anterior.slice(-4) } : {}) },
    });
    await this.responder(tel, { texto: TEXTOS.ligado(primeiroNome(g.nome), g.empresa, anterior ? anterior.slice(-4) : null) });
    // Rodada 7, MIS-A-06 (ERR-651): depois da resposta ao celular novo, o ANTIGO é avisado (os presidentes já são, pelo
    // "Telefone ligado" com o "Não reconheço").
    if (anterior) await this.avisarCelularAntigo(anterior, String(g.empresa ?? ''), tel.slice(-4), String(g.id));
    return { desfecho: 'ligou', tenantId: g.tenantId };
  }

  /**
   * Rodada 7, MIS-A-06 (ERR-651): o aviso ao celular ANTIGO de quem ligou outro. Dentro das 24 horas da Meta (ou pela conexão
   * por QR Code, que não tem janela), o texto inteiro; fora, o modelo `mister_aviso` — o toque nele cai na frase de telefone
   * desligado. Nunca segura nem desfaz a ligação: a falha do envio fica no log.
   */
  private async avisarCelularAntigo(anterior: string, empresa: string, finalNovo: string, vinculoId: string): Promise<void> {
    try {
      const [c] = linhas(await this.db.execute(sql`select ultima_entrada_em as "ultimaEntrada" from mister_conversa where telefone = ${anterior}`));
      const ultima = c?.ultimaEntrada ? new Date(c.ultimaEntrada) : null;
      if ((await this.numero.semJanela()) || dentroDaJanelaDoWhatsapp(ultima, Date.now())) {
        await this.numero.enviar(anterior, { texto: TEXTOS.celularTrocado(empresa, finalNovo) });
      } else {
        await this.numero.enviarModelo(anterior, MODELO_DO_AVISO, [empresa, TEXTOS.celularTrocadoNoModelo(finalNovo)], { tipo: 'aviso', id: vinculoId });
      }
    } catch (e: any) {
      const motivo = e instanceof FalhaDoEnvioDoMister ? `${e.motivo}${e.status ? ` ${e.status}` : ''}${e.detalhe ? ` — ${e.detalhe}` : ''}` : String(e?.message ?? e);
      this.logger.warn(`mister: o aviso ao celular antigo ${mascarar(anterior)} não saiu (${motivo})`);
    }
  }

  /** O código não vale. `tentativas` = a contagem já reservada nesta janela, com esta (ERR-648: conta ANTES de conferir). */
  private async codigoErrado(tel: string, tentativas: number): Promise<{ desfecho: Desfecho }> {
    // Quem acabou de ligar e mandou o código de novo (toque duplo) não leva "não vale mais" — mas a tentativa CONTA (ERR-648:
    // antes este caminho calava sem contar, e um telefone ligado há pouco testava códigos à vontade).
    const [jaLigou] = linhas(
      await this.db.execute(sql`select 1 from mister_vinculo where telefone = ${tel} and ligado_em > now() - make_interval(mins => ${CODIGO_VALE_MIN}) limit 1`),
    );
    if (jaLigou) return { desfecho: 'codigo_repetido' };
    if (tentativas >= CODIGOS_ERRADOS_MAX) {
      await this.responder(tel, { texto: TEXTOS.codigosDemais });
      return { desfecho: 'codigos_demais' };
    }
    await this.responder(tel, { texto: TEXTOS.codigoNaoVale });
    return { desfecho: 'codigo_nao_vale' };
  }

  // ───────────────────────────── de qual empresa é a conversa ─────────────────────────────

  /** Os vínculos deste telefone que valem AGORA, em ordem estável (nome da empresa, depois o id). */
  private async vinculosDoTelefone(tel: string): Promise<Vinculo[]> {
    const todos = linhas(
      await this.db.execute(sql`
        select g.id, g.tenant_id as "tenantId", g.colaborador_id as "colaboradorId", c.unidade_id as "unidadeId",
               coalesce(p.nivel, f.categoria::text) as nivel, c.nome, emp.nome as empresa
          from mister_vinculo g
          join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = g.tenant_id
         where g.telefone = ${tel} and g.ligado_em is not null and ${pessoaVale()}
         order by emp.nome, emp.id`),
    ) as Vinculo[];
    const vivos: Vinculo[] = [];
    for (const v of todos) if (await this.modulos.ativo(v.tenantId, v.unidadeId ?? null, MODULO)) vivos.push(v);
    return vivos;
  }

  private async empresaDaConversa(
    tel: string,
    e: MensagemDoMister,
    vinculos: Vinculo[],
  ): Promise<{ vinculo: Vinculo; texto: string } | { desfecho: Desfecho; tenantId?: string | null }> {
    const texto = String(e.texto ?? '');
    if (vinculos.length === 1) {
      if (ehTrocarDeEmpresa(texto)) {
        await this.responder(tel, { texto: TEXTOS.umaEmpresaSo(vinculos[0].empresa) });
        return { desfecho: 'uma_empresa_so', tenantId: vinculos[0].tenantId };
      }
      return { vinculo: vinculos[0], texto };
    }

    const empresas = vinculos.map((v) => ({ tenantId: v.tenantId, nome: v.empresa }));
    const [conv] = linhas(
      await this.db.execute(sql`
        select tenant_id as "tenantId", perguntada_em is not null as perguntada,
               case when pendente_em > now() - make_interval(mins => ${PENDENTE_VALE_MIN}) then pendente end as pendente
          from mister_conversa where telefone = ${tel}`),
    );

    if (ehTrocarDeEmpresa(texto)) {
      await this.perguntar(tel, empresas, { limpar: true });
      return { desfecho: 'perguntou_empresa' };
    }

    // A resposta à pergunta: o botão vale sempre; o texto (número ou nome) só quando a pergunta está aberta.
    const escolhida = empresaEscolhida({ botaoId: e.botaoId, texto: conv?.perguntada === true ? texto : null }, empresas);
    if (escolhida) {
      const vinculo = vinculos.find((v) => v.tenantId === escolhida)!;
      // ERR-648 (rodada 7, MIS-A-08): a mensagem que esperava é lida e consumida na MESMA gravação, com a linha travada — duas
      // escolhas ao mesmo tempo (toque duplo, botão e número) atendem a pendência uma vez só.
      const [consumida] = linhas(
        await this.db.execute(sql`
          with antes as (select telefone, pendente, pendente_em from mister_conversa where telefone = ${tel} for update)
          update mister_conversa c
             set tenant_id = ${escolhida}::uuid, escolhida_em = now(), perguntada_em = null, pendente = null, pendente_em = null,
                 ultima_entrada_em = now(), atualizado_em = now()
            from antes
           where c.telefone = antes.telefone
          returning case when antes.pendente_em > now() - make_interval(mins => ${PENDENTE_VALE_MIN}) then antes.pendente end as pendente`),
      );
      if (!consumida)
        await this.db.execute(sql`
          insert into mister_conversa (telefone, tenant_id, escolhida_em, ultima_entrada_em) values (${tel}, ${escolhida}::uuid, now(), now())
          on conflict (telefone) do update
            set tenant_id = excluded.tenant_id, escolhida_em = now(), perguntada_em = null, pendente = null, pendente_em = null,
                ultima_entrada_em = now(), atualizado_em = now()`);
      await this.responder(tel, { texto: TEXTOS.seguindo(vinculo.empresa) });
      // A mensagem que esperava a escolha é atendida agora, já na empresa certa.
      const pendente = String(consumida?.pendente ?? '').trim();
      if (pendente) await this.atender(tel, vinculo, pendente, e.wamid ? `${e.wamid}:pendente` : null, e.wamid ?? null);
      return { desfecho: 'escolheu_empresa', tenantId: escolhida };
    }

    const emUso = conv?.tenantId ? vinculos.find((v) => v.tenantId === conv.tenantId) : undefined;
    if (emUso && conv?.perguntada !== true) return { vinculo: emUso, texto };

    // Não se sabe de qual empresa. Pergunta aberta e a resposta não serviu: pergunta de novo e mantém a mensagem que já
    // esperava. Senão: guarda esta mensagem e pergunta.
    if (conv?.perguntada === true) await this.perguntar(tel, empresas, { naoEntendi: true });
    else await this.perguntar(tel, empresas, { guardar: texto });
    return { desfecho: 'perguntou_empresa' };
  }

  /**
   * Pergunta de qual empresa é a conversa e deixa a escolha em aberto. `guardar` = a mensagem que fica esperando a
   * escolha (até 10 minutos); `limpar` = a pessoa pediu para trocar de empresa, nada fica esperando; sem os dois, a
   * mensagem que já esperava continua.
   */
  private async perguntar(tel: string, empresas: { tenantId: string; nome: string }[], o: { guardar?: string; limpar?: boolean; naoEntendi?: boolean }): Promise<void> {
    const guardar = o.guardar ? cortar(o.guardar.trim(), 500) || null : null;
    const manter = !guardar && !o.limpar;
    await this.db.execute(sql`
      insert into mister_conversa (telefone, perguntada_em, pendente, pendente_em, ultima_entrada_em)
      values (${tel}, now(), ${guardar}, ${guardar ? sql`now()` : sql`null`}, now())
      on conflict (telefone) do update
        set tenant_id = null, escolhida_em = null, perguntada_em = now(),
            pendente = ${manter ? sql`mister_conversa.pendente` : sql`excluded.pendente`},
            pendente_em = ${manter ? sql`mister_conversa.pendente_em` : sql`excluded.pendente_em`},
            ultima_entrada_em = now(), atualizado_em = now()`);
    const pergunta = perguntaDaEmpresa(empresas);
    await this.responder(tel, o.naoEntendi ? { ...pergunta, texto: `${TEXTOS.naoEntendiAEmpresa} ${pergunta.texto}` } : pergunta);
  }

  // ───────────────────────────── a conversa, já com a empresa certa ─────────────────────────────

  /**
   * `chave` = a identidade da mensagem na fila das perguntas (a mesma nunca entra duas vezes); `wamid` = o id dela na
   * Meta, para o agente marcar como lida e mostrar "digitando".
   */
  private async atender(
    tel: string,
    v: Vinculo,
    texto: string,
    chave: string | null,
    wamid: string | null,
    midia: MidiaDoMister | null = null,
  ): Promise<{ desfecho: Desfecho; tenantId: string }> {
    await this.db.execute(sql`update mister_vinculo set ultima_entrada_em = now() where id = ${v.id}::uuid`);
    const nome = primeiroNome(v.nome);
    const quem: QuemMandou = { telefone: tel, tenantId: v.tenantId, colaboradorId: v.colaboradorId, unidadeId: v.unidadeId ?? null, nivel: v.nivel, nome: v.nome };
    // Versão 5, M5a: com a leitura de mídia ligada, a foto passa primeiro pelo DMS Graph (a IA da empresa de reserva). O
    // que ela mostra vira a pergunta; boleto ou nota tenta os documentos antes. Desligada ou outro tipo: como antes.
    let daFoto: { pergunta: string; documento: boolean } | null = null;
    let semGraph = false;
    // Versão 10, C5: o áudio pode ser o PIN falado — conferido pelo código ANTES da leitura da mídia, da fila e da IA.
    if (midia?.tipo === 'audio' && this.pinFalado) {
      // Rodada 7, MIS-D-13 (ERR-655): a falha na conferência do PIN FECHA — o áudio não segue para a leitura comum, a fila e a
      // IA (ele pode ser o PIN).
      const r = await this.pinFalado(quem, midia, wamid).catch(async (err: any) => {
        this.logger.error(`mister: o PIN falado de ${mascarar(tel)} não foi conferido — ${err?.message ?? err}`);
        await this.responder(tel, { texto: TEXTOS_DO_PIN_FALADO.naoOuviAgora });
        return 'tratado' as const;
      });
      if (r === 'tratado') return { desfecho: 'pin_falado', tenantId: v.tenantId };
    }
    // Rodada 7, MIS-H-06 (ERR-660): a foto, o documento e o áudio gastam IA (o Sonnet, até três leituras) ANTES da fila — fora do
    // teto de perguntas. Agora o teto do dia vale antes de qualquer leitura: o da pessoa e o da empresa (perguntas) e o de
    // leituras de mídia da empresa. A planilha (lida sem IA) não conta.
    if (midia && !(midia.tipo === 'documento' && ehPlanilha(midia.mime))) {
      const limite = await this.fila.limiteDeMidia(v.tenantId, v.colaboradorId);
      if (limite) {
        await this.responder(tel, { texto: limite });
        return { desfecho: 'limite_de_midia', tenantId: v.tenantId };
      }
    }
    if (midia && this.midia) {
      const r = await this.midia(quem, midia, wamid).catch((err: any) => {
        this.logger.error(`mister: a foto de ${mascarar(tel)} não foi lida — ${err?.message ?? err}`, err?.stack);
        return null;
      });
      if (r === 'tratada') return { desfecho: 'midia_nao_lida', tenantId: v.tenantId };
      if (r === 'sem_graph') semGraph = true;
      else if (r) daFoto = r;
    }
    // Versão 6, M6g: a PLANILHA (xlsx ou csv) vai à lista de compras, que a lê sem IA. Não tratou: segue como antes.
    if (midia && midia.tipo === 'documento' && this.planilha && ehPlanilha(midia.mime)) {
      const tratou = await this.planilha(quem, midia, wamid).catch((err: any) => {
        this.logger.error(`mister: a planilha de ${mascarar(tel)} não foi lida — ${err?.message ?? err}`, err?.stack);
        return false;
      });
      if (tratou) return { desfecho: 'documento', tenantId: v.tenantId };
    }
    // M3a: a foto de um documento vai a quem lê documentos (quando ele está ligado); senão, segue como antes. A foto que
    // o Graph já leu e não é boleto nem nota não passa por aqui (não lê duas vezes).
    if (midia && this.documento && (!daFoto || daFoto.documento)) {
      const tratou = await this.documento(quem, midia, wamid).catch((err: any) => {
        this.logger.error(`mister: o documento de ${mascarar(tel)} não foi lido — ${err?.message ?? err}`, err?.stack);
        return false;
      });
      if (tratou) return { desfecho: 'documento', tenantId: v.tenantId };
    }
    // A foto lida vira a pergunta: não é comando (PARAR/VOLTAR) nem o texto que completa um documento.
    if (daFoto) {
      const nova = await this.fila.enfileirar({ tenantId: v.tenantId, colaboradorId: v.colaboradorId, unidadeId: v.unidadeId ?? null, nivel: v.nivel, telefone: tel }, daFoto.pergunta, chave, wamid);
      return { desfecho: nova ? 'pergunta' : 'repetida', tenantId: v.tenantId };
    }
    if (ehPararAvisos(texto)) {
      await this.db.execute(sql`update mister_vinculo set pausado_em = coalesce(pausado_em, now()), atualizado_em = now() where id = ${v.id}::uuid`);
      await this.auditar(v, 'mister_whatsapp_parou', tel);
      await this.responder(tel, { texto: TEXTOS.parou(nome) });
      return { desfecho: 'parou', tenantId: v.tenantId };
    }
    if (ehVoltarAvisos(texto)) {
      await this.db.execute(sql`update mister_vinculo set pausado_em = null, atualizado_em = now() where id = ${v.id}::uuid`);
      await this.auditar(v, 'mister_whatsapp_voltou', tel);
      await this.responder(tel, { texto: TEXTOS.voltou(nome) });
      return { desfecho: 'voltou', tenantId: v.tenantId };
    }
    if (!texto.trim()) {
      // Mensagem sem texto (áudio, foto, figurinha, reação): o Mister diz que só lê texto, no máximo uma vez a cada
      // meia hora (gravação condicional; o relógio é a coluna `provisoria_em` da conversa).
      const vez = linhas(
        await this.db.execute(sql`
          insert into mister_conversa (telefone, provisoria_em, ultima_entrada_em) values (${tel}, now(), now())
          on conflict (telefone) do update set provisoria_em = now(), ultima_entrada_em = now(), atualizado_em = now()
            where mister_conversa.provisoria_em is null or mister_conversa.provisoria_em < now() - make_interval(mins => ${SO_TEXTO_A_CADA_MIN})
          returning telefone`),
      );
      if (!vez.length) return { desfecho: 'calado', tenantId: v.tenantId };
      // M5a: com a leitura de mídia ligada e a empresa sem o DMS Graph, a frase diz onde ligar.
      await this.responder(tel, { texto: semGraph ? TEXTOS_DA_MIDIA.semGraph : TEXTOS_DO_AGENTE.soTexto });
      return { desfecho: 'so_texto', tenantId: v.tenantId };
    }
    // Versão 10, C1a: a resposta ao documento ou à lista em aberto ("o total é 1.240", "vence dia 30, 480 reais", "1 caixa tem
    // 20 kg") não passa mais por leitores de código: vai à IA, que vê o trabalho em andamento e grava pela ferramenta
    // (`documento_em_andamento`, `lista_de_compras`). Os botões continuam como atalho.
    // Uma pergunta: entra na fila com a empresa, a pessoa, a loja e o nível DESTE vínculo, e o agente é acordado.
    const nova = await this.fila.enfileirar({ tenantId: v.tenantId, colaboradorId: v.colaboradorId, unidadeId: v.unidadeId ?? null, nivel: v.nivel, telefone: tel }, texto, chave, wamid);
    return { desfecho: nova ? 'pergunta' : 'repetida', tenantId: v.tenantId };
  }

  private async auditar(v: Vinculo, acao: string, tel: string): Promise<void> {
    await this.auditoria?.registrar({
      tenantId: v.tenantId,
      atorId: v.colaboradorId,
      tipo: 'config',
      acao,
      entidadeTipo: 'mister_vinculo',
      entidadeId: v.id,
      origem: 'whatsapp',
      detalhe: { final: tel.slice(-4) },
    });
  }

  /** A resposta sai pelo número do Mister. A falha do envio fica no log (com o motivo) e não derruba a conversa. */
  private async responder(tel: string, resposta: Resposta): Promise<void> {
    try {
      await this.numero.enviar(tel, resposta);
    } catch (e: any) {
      const motivo = e instanceof FalhaDoEnvioDoMister ? `${e.motivo}${e.status ? ` ${e.status}` : ''}${e.detalhe ? ` — ${e.detalhe}` : ''}` : String(e?.message ?? e);
      this.logger.warn(`mister: a resposta a ${mascarar(tel)} não saiu (${motivo})`);
    }
  }

  // ───────────────────────────── a limpeza ─────────────────────────────

  /**
   * Todo dia, fora do movimento: sai o registro de mensagens com mais de 30 dias (não guarda texto; é só o "já tratei")
   * e o estado das conversas paradas há mais de 90 dias (quem volta a escrever começa uma conversa nova — o vínculo do
   * telefone com a pessoa não mora ali e continua). Devolve quantas linhas saíram.
   */
  @Cron('35 4 * * *')
  async limparMensagens(): Promise<number> {
    if (ehServidorLocal()) return 0;
    try {
      const r = linhas(await this.db.execute(sql`delete from mister_mensagem where recebida_em < now() - interval '30 days' returning wamid`));
      const c = linhas(
        await this.db.execute(sql`delete from mister_conversa where coalesce(ultima_entrada_em, atualizado_em) < now() - interval '90 days' returning telefone`),
      );
      // As perguntas (mig 418): o texto sai em 30 dias e a linha em 90. À parte: a falha de uma limpeza não esconde a outra.
      const p = await this.fila.limpar().catch((e: any) => {
        this.logger.warn(`mister: a limpeza das perguntas falhou — ${e?.message ?? e}`);
        return 0;
      });
      return r.length + c.length + p;
    } catch (e: any) {
      this.logger.warn(`mister: a limpeza do registro de mensagens falhou — ${e?.message ?? e}`);
      return 0;
    }
  }
}
