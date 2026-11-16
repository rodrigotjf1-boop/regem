import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, gte, inArray, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig, pedidoExterno } from '../../db/schema';
import { ehServidorLocal } from '../../common/modo';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';
import {
  DecisaoDoComprovante,
  EquipeChamada,
  JANELA_DOS_PEDIDOS_MS,
  PedidoDoComprovante,
  TIPOS_DE_COMPROVANTE,
  decidirComprovante,
  telefoneParecido,
  textoDoAguardando,
  textoDoAguardandoComEquipe,
  textoDoCancelado,
  textoDoNaEntrega,
  textoDoPago,
  textoDoSemPedido,
} from '../../common/comprovante-do-cliente';
import { AtendimentoService } from '../atendimento/atendimento.service';
import { resumoDoRobo } from '../atendimento/resumo-do-robo';
import { definirPorteiroDoComprovante } from '../whatsapp/juntar-mensagens';
import { RoboRespostaService } from '../whatsapp/robo-resposta.service';
import { CardapioService } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O cliente mandou duas fotos seguidas (o comprovante e o print): a segunda não ganha outra resposta. */
export const SILENCIO_DO_COMPROVANTE_MS = 60 * 1000;
/** O Pix que seguia sem confirmar e o comprovante que volta depois deste tempo: a equipe confere. */
export const INSISTENCIA_DO_COMPROVANTE_MS = 2 * 60 * 1000;
const MEMORIA_MAX = 5000;

type Lembranca = { em: number; caso: DecisaoDoComprovante['caso']; pedidoId: string | null };

/**
 * O COMPROVANTE QUE O CLIENTE MANDA NO WHATSAPP (16/11/2026 — pedido do dono; as regras e os textos em
 * `common/comprovante-do-cliente.ts`). O Regem não lê a imagem: reconhece o comprovante pelo contexto e responde pelo
 * PEDIDO no sistema —
 *  • pago: a mensagem positiva ("✅ Pagamento confirmado… seu pedido nº X já está em produção");
 *  • Pix esperando: consulta o provedor NA HORA (o mesmo "Verificar pagamento" da página do pedido); confirmou = a
 *    positiva; não confirmou = avisa e, se o cliente mandar de novo depois de 2 minutos, chama a equipe;
 *  • pedido para pagar na entrega, pedido cancelado sem pagamento confirmado, ou NENHUM pedido com este telefone (o pedido
 *    fica ligado ao número informado na hora de pedir): chama a equipe, com o que achou — inclusive o pedido recente de um
 *    telefone QUASE igual (um dígito trocado), que só a equipe vê. Ao cliente, nunca nada do pedido de outro número.
 * Sai pela MESMA porta das respostas do robô (`responderDoRegem`: o canal certo e as travas de robô ligado e conversa não
 * assumida). Só na nuvem. Na dúvida ou no erro, a mensagem segue para o robô como sempre.
 */
@Injectable()
export class ComprovanteDoClienteService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('ComprovanteDoCliente');
  /** Em memória deste processo (como a junção das mensagens): só evita a resposta em dobro e conta a insistência. */
  private readonly memoria = new Map<string, Lembranca>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cardapio: CardapioService,
    private readonly resposta: RoboRespostaService,
    private readonly atendimento: AtendimentoService,
  ) {}

  onModuleInit(): void {
    if (!ehServidorLocal()) definirPorteiroDoComprovante((m, antes) => this.decidir(m, antes));
  }

  onModuleDestroy(): void {
    definirPorteiroDoComprovante(null);
  }

  /** A foto ou o documento do cliente: 'respondido' quando era um comprovante e o Regem respondeu; senão 'segue'. */
  async decidir(msg: any, antes: string[] = [], agora: Date = new Date()): Promise<'segue' | 'respondido'> {
    try {
      if (!TIPOS_DE_COMPROVANTE.includes(String(msg?.tipo ?? ''))) return 'segue';
      const tenantId = String(msg?.tenantId ?? '');
      const token = String(msg?.cardapioToken ?? '');
      const de = String(msg?.de ?? '').trim();
      // Só a conversa de telefone: o teste do atendente, o chat do iFood/99, o Direct e o comentário não têm pedido por aqui.
      if (!/^[0-9a-f-]{36}$/i.test(tenantId) || !token || !de || /^[a-z]+:/i.test(de) || /^[a-z]+:/i.test(String(msg?.instancia ?? ''))) return 'segue';
      const chave = chaveTelefone(de);
      if (!chave || chave.length < 10) return 'segue';

      const pedidos = await this.pedidosDoTelefone(tenantId, chave, agora);
      const d = decidirComprovante({ tipo: msg.tipo, legenda: msg?.texto, antes, arquivoNome: msg?.arquivoNome, pedidos, agora });
      if (d.caso === 'nao_e') return 'segue';

      // Duas fotos seguidas: a segunda não ganha outra resposta (nem vai ao robô — é o mesmo assunto).
      const k = `${tenantId}:${chave}`;
      const antesDisso = this.memoria.get(k);
      if (antesDisso && agora.getTime() - antesDisso.em < SILENCIO_DO_COMPROVANTE_MS) return 'respondido';

      const enviar = (texto: string) =>
        this.resposta.responderDoRegem({ instancia: msg?.instancia ?? undefined, phoneNumberId: msg?.phoneNumberId ?? undefined, para: de, texto });
      const lembrar = (caso: DecisaoDoComprovante['caso'], pedidoId: string | null) => {
        if (this.memoria.size >= MEMORIA_MAX) this.memoria.clear();
        this.memoria.set(k, { em: agora.getTime(), caso, pedidoId });
      };
      const cliente = { nome: msg?.nome ?? null, telefone: de };

      if (d.caso === 'pago') return this.fechar(await enviar(textoDoPago(d.pedido)), () => lembrar('pago', d.pedido.id));

      if (d.caso === 'aguardando') {
        // "Ver se o pedido está pago": a consulta ao provedor do Pix, agora (não espera o aviso dele).
        const v: any = await this.cardapio.verificarPagamentoPublico(token, d.pedido.id).catch(() => null);
        if (v?.pago || v?.sinalPago) {
          const atual = { ...d.pedido, pago: !!v.pago, sinalPago: !!v.sinalPago, statusPagamento: v.pago ? 'aprovado' : d.pedido.statusPagamento, status: v.status ?? d.pedido.status };
          return this.fechar(await enviar(textoDoPago(atual, { sinal: !!v.sinalPago })), () => lembrar('pago', d.pedido.id));
        }
        // Já tinha avisado deste pedido e o cliente manda o comprovante de novo: a equipe confere.
        const insistiu =
          antesDisso?.caso === 'aguardando' && antesDisso.pedidoId === d.pedido.id && agora.getTime() - antesDisso.em >= INSISTENCIA_DO_COMPROVANTE_MS;
        if (!insistiu) return this.fechar(await enviar(textoDoAguardando(d.pedido)), () => lembrar('aguardando', d.pedido.id));
        const c = await this.chamarEquipe(tenantId, token, cliente, d.pedido, {
          motivo: `mandou o comprovante 2 vezes e o Pix do pedido nº ${d.pedido.numero} não confirmou no provedor`,
          quer: 'confirmar o pagamento',
          jaFez: 'consultei o provedor do Pix duas vezes: segue aguardando. Conferir se pagou por outra chave',
        });
        return this.fechar(await enviar(textoDoAguardandoComEquipe(d.pedido, c)), () => lembrar('aguardando', d.pedido.id), !!c);
      }

      if (d.caso === 'cancelado') {
        if (d.pedido.pago) return this.fechar(await enviar(textoDoCancelado(d.pedido, null)), () => lembrar('cancelado', d.pedido.id));
        const c = await this.chamarEquipe(
          tenantId,
          token,
          cliente,
          d.pedido,
          { motivo: `mandou comprovante do pedido nº ${d.pedido.numero}, cancelado sem pagamento confirmado`, quer: 'confirmar o pagamento', jaFez: 'avisei que a equipe confere se o valor saiu da conta' },
          true,
        );
        return this.fechar(await enviar(textoDoCancelado(d.pedido, c)), () => lembrar('cancelado', d.pedido.id), !!c);
      }

      if (d.caso === 'na_entrega') {
        const c = await this.chamarEquipe(tenantId, token, cliente, d.pedido, {
          motivo: `mandou comprovante, mas o pedido nº ${d.pedido.numero} está para pagar na ${d.pedido.tipo === 'entrega' ? 'entrega' : 'retirada'}`,
          quer: 'confirmar o pagamento (para não ser cobrado de novo)',
          jaFez: 'avisei que o pagamento não confirma sozinho e que a equipe confere',
        });
        return this.fechar(await enviar(textoDoNaEntrega(d.pedido, c)), () => lembrar('na_entrega', d.pedido.id), !!c);
      }

      // Nenhum pedido com este telefone: "ver se ele colocou o número certo" — o pedido recente, com pagamento online, de
      // um telefone QUASE igual vai para a EQUIPE (o cliente não ouve nada do pedido de outro número).
      const parecido = await this.pedidoDeTelefoneParecido(tenantId, chave, agora);
      const c = await this.chamarEquipe(tenantId, token, cliente, parecido?.pedido ?? null, {
        motivo: 'mandou comprovante, mas não há pedido com este número de WhatsApp',
        quer: 'confirmar o pagamento',
        jaFez: parecido
          ? `achei o pedido nº ${parecido.pedido.numero} (${parecido.pedido.pago ? 'pago' : 'aguardando o Pix'}) com telefone QUASE igual, final ${parecido.final}: conferir se é dele`
          : 'pedi o telefone que ele informou no pedido ou o número do pedido',
      });
      return this.fechar(await enviar(textoDoSemPedido(c)), () => lembrar('sem_pedido', null), !!c);
    } catch (e: any) {
      this.logger.warn(`comprovante não decidido (${e?.code ?? e?.message ?? e}): a mensagem vai ao robô`);
      return 'segue';
    }
  }

  /**
   * O fim de cada caminho: a resposta saiu = 'respondido'. Não saiu (robô desligado, conversa assumida por uma pessoa): a
   * mensagem segue para o robô — a não ser que a equipe JÁ tenha sido chamada (o caso está com ela; o robô se cala).
   */
  private fechar(r: any, lembrar: () => void, equipeChamada = false): 'segue' | 'respondido' {
    if (r?.enviado) {
      lembrar();
      return 'respondido';
    }
    this.logger.log(`resposta do comprovante segurada (${r?.motivo ?? 'sem motivo'})`);
    return equipeChamada ? 'respondido' : 'segue';
  }

  /** Os pedidos deste telefone (pela chave) nas últimas horas, do mais novo ao mais velho. */
  private async pedidosDoTelefone(tenantId: string, chave: string, agora: Date): Promise<PedidoDoComprovante[]> {
    const rows = await this.db
      .select()
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, tenantId),
          gte(pedidoExterno.criadoEm, new Date(agora.getTime() - JANELA_DOS_PEDIDOS_MS)),
          or(
            sql`${sqlChaveTelefone(sql`${pedidoExterno.clienteTelefone}`)} = ${chave}`,
            sql`${sqlChaveTelefone(sql`${pedidoExterno.clienteTelefone2}`)} = ${chave}`,
          ),
        ),
      )
      .orderBy(desc(pedidoExterno.criadoEm))
      .limit(10);
    return rows.map((r: any) => this.paraARegra(r));
  }

  private paraARegra(r: any): PedidoDoComprovante {
    return {
      id: r.id,
      numero: String(r.displayId ?? r.numero ?? ''),
      status: String(r.status ?? ''),
      statusPagamento: String(r.statusPagamento ?? 'na_entrega'),
      pago: !!r.pago,
      sinalPago: r.sinalStatus === 'pago',
      // A coluna nunca é nula: "na_entrega" e "orcamento" não são pagamento online.
      online: ['aguardando', 'aprovado'].includes(String(r.statusPagamento ?? '')) || !!r.gatewayPaymentId,
      tipo: r.tipo ?? null,
      clienteNome: r.clienteNome ?? null,
      criadoEm: r.criadoEm instanceof Date ? r.criadoEm : new Date(r.criadoEm),
    };
  }

  /**
   * "Ver se ele colocou o número de telefone correto": UM pedido recente (6 h) da loja, com pagamento online, cujo telefone
   * é quase o da conversa. Dois ou mais candidatos = nenhum (não se aponta pedido no escuro). Só para a equipe.
   */
  private async pedidoDeTelefoneParecido(tenantId: string, chave: string, agora: Date): Promise<{ pedido: PedidoDoComprovante; final: string } | null> {
    const rows = await this.db
      .select()
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, tenantId),
          gte(pedidoExterno.criadoEm, new Date(agora.getTime() - JANELA_DOS_PEDIDOS_MS / 2)),
          inArray(pedidoExterno.statusPagamento, ['aguardando', 'aprovado']),
        ),
      )
      .orderBy(desc(pedidoExterno.criadoEm))
      .limit(300);
    const candidatos = rows.filter((r: any) => telefoneParecido(chave, r.clienteTelefone) || telefoneParecido(chave, r.clienteTelefone2));
    if (candidatos.length !== 1) return null;
    const r: any = candidatos[0];
    const tel = String(r.clienteTelefone ?? '').replace(/\D/g, '');
    return { pedido: this.paraARegra(r), final: tel.slice(-4) };
  }

  /**
   * Chama a equipe pelo MESMO caminho do "chamar atendente" do robô (o caso com o resumo em três linhas; fora do horário,
   * o recado). Devolve o que o cliente precisa ouvir (a posição, "já tem alguém", quando a equipe volta) — ou null se o
   * caso não abriu (a resposta sai sem o "já chamei").
   */
  private async chamarEquipe(
    tenantId: string,
    token: string,
    cliente: { nome: string | null; telefone: string },
    pedido: PedidoDoComprovante | null,
    resumo: { motivo: string; quer: string; jaFez: string },
    urgente = false,
  ): Promise<EquipeChamada> {
    try {
      const [cfg] = await this.db
        .select({ id: cardapioConfig.id, unidadeId: cardapioConfig.unidadeId })
        .from(cardapioConfig)
        .where(and(eq(cardapioConfig.token, token), eq(cardapioConfig.tenantId, tenantId)));
      const mensagem = `Motivo: ${resumo.motivo}\nQuer: ${resumo.quer}\nJá fiz: ${resumo.jaFez}`;
      const r: any = await this.atendimento.abrirPeloRobo(tenantId, cfg?.unidadeId ?? null, {
        tipo: 'outro',
        cliente: cliente.nome ?? undefined,
        telefone: cliente.telefone,
        pedidoNumero: pedido?.numero || undefined,
        pedidoId: pedido?.id,
        mensagem,
        prioridade: urgente ? 'urgente' : 'normal',
        resumo: resumoDoRobo({ mensagem }, urgente),
        cardapioId: cfg?.id ?? null,
      });
      return { foraDoHorario: !!r?.foraDoHorario, paraOCliente: r?.paraOCliente ?? null, posicao: r?.posicao ?? null, comAlguem: !!r?.comAlguem };
    } catch (e: any) {
      this.logger.warn(`comprovante: a equipe não foi chamada (${e?.code ?? e?.message ?? e})`);
      return null;
    }
  }
}
