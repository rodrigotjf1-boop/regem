import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { chaveTelefone, sqlChaveTelefone, telefoneCadastro } from '../../common/telefone-chave';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { telefoneParaWhatsapp } from '../compras/pedido-texto';
import { WhatsappProvedorService } from '../whatsapp/whatsapp-provedor.service';
import {
  LIMITES_DA_RECLAMACAO,
  MENSAGEM_DESCULPAS_MAX,
  MENSAGEM_DESCULPAS_PADRAO,
  mensagemDasDesculpas,
  podeMandarDesculpas,
  QUEM_MANDA_DESCULPAS,
} from './clube.regras';
import { ClubeService } from './clube.service';
import { ClubeSurpresaService } from './clube-surpresa.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Os canais em que o cupom do Regem não vale (e o telefone do cliente não é o dele): o caso não ganha prêmio. */
const CANAIS_SEM_PREMIO = ['ifood', '99food', 'keeta', 'anotaai', 'rappi'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quem está mandando (o usuário logado; no servidor da loja, o que ele repassou à nuvem). */
export type QuemManda = { tenantId: string; perfil: string; colaboradorId: string | null };

export type EstadoDasDesculpas = {
  /** O gatilho e o prêmio surpresa ligados: o botão aparece no caso. */
  mostrar: boolean;
  /** Pode mandar agora (com o motivo quando não pode). */
  disponivel: boolean;
  motivo: string | null;
  cliente: string | null;
  premios: Array<{ id: string; nome: string; descricao: string }>;
  limite: string;
  /** Quantos prêmios de desculpas o cliente já recebeu na janela do limite. */
  recebidos: number;
  /** O que este caso já recebeu (um prêmio por caso). */
  dado: { premio: string; em: string; link: string } | null;
  mensagemPadrao: string;
  mensagemMax: number;
};

// CLUBE — O PRÊMIO DE DESCULPAS (fase A1b; o gatilho "Depois de uma reclamação", sem migration). A equipe manda pelo caso
// do Atendimento, escolhendo entre os prêmios que o presidente liberou: um por caso (o índice único da 474, com a
// referência = o caso), com o limite por cliente conferido SOB TRAVA da transação por empresa e telefone (dois casos do
// mesmo cliente ao mesmo tempo não passam do limite — V98), e só o perfil que o presidente escolheu. O prêmio vira cupom pessoal (como o
// do pedido entregue) e a mensagem com o link pessoal (`/p/…`) sai pela conversa do WhatsApp da loja. Só NUVEM: no
// servidor da loja, o Atendimento repassa à nuvem (`clube/da-loja`).
@Injectable()
export class ClubeDesculpasService {
  private readonly logger = new Logger('ClubeDesculpas');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly clube: ClubeService,
    private readonly surpresa: ClubeSurpresaService,
    @Optional() private readonly provedores?: WhatsappProvedorService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private rows(r: any): any[] {
    return (r?.rows ?? r) as any[];
  }

  private async caso(tenantId: string, casoId: string) {
    if (!UUID.test(String(casoId ?? ''))) throw new NotFoundException('Caso não encontrado.');
    const [c] = this.rows(
      await this.db.execute(sql`
        select id, cliente, telefone, canal from atendimento_chamado where id = ${casoId}::uuid and tenant_id = ${tenantId}::uuid`),
    );
    if (!c) throw new NotFoundException('Caso não encontrado.');
    return c;
  }

  /** O que este caso já recebeu. */
  private async doCaso(tenantId: string, casoId: string) {
    const [d] = this.rows(
      await this.db.execute(sql`
        select premio_nome, criado_em, codigo from clube_direito
         where tenant_id = ${tenantId}::uuid and gatilho = 'reclamacao' and ref = ${casoId}`),
    );
    return d ? { premio: String(d.premio_nome), em: new Date(d.criado_em).toISOString(), link: ClubeSurpresaService.linkDoDireito(String(d.codigo)) } : null;
  }

  private async recebidosNaJanela(executor: any, tenantId: string, chave: string, dias: number): Promise<number> {
    const [{ n }] = this.rows(
      await executor.execute(sql`
        select count(*)::int as n from clube_direito
         where tenant_id = ${tenantId}::uuid and gatilho = 'reclamacao' and chave_telefone = ${chave}
           and criado_em > now() - make_interval(days => ${dias})`),
    );
    return Number(n);
  }

  /** `GET /atendimento/:id/premio-desculpas` — a gaveta do caso: se aparece, se pode mandar, os prêmios e o limite. */
  async estado(quem: QuemManda, casoId: string): Promise<EstadoDasDesculpas> {
    const c = await this.caso(quem.tenantId, casoId);
    const config = await this.clube.config(quem.tenantId);
    const g = (await this.clube.gatilhos(quem.tenantId)).reclamacao;
    const limite = LIMITES_DA_RECLAMACAO[g.limite];
    const vazio: EstadoDasDesculpas = {
      mostrar: false,
      disponivel: false,
      motivo: null,
      cliente: c.cliente ?? null,
      premios: [],
      limite: limite.rotulo,
      recebidos: 0,
      dado: null,
      mensagemPadrao: MENSAGEM_DESCULPAS_PADRAO,
      mensagemMax: MENSAGEM_DESCULPAS_MAX,
    };
    if (!config.surpresaAtivo || !g.ativo) return vazio;
    const lista = (await this.clube.premios(quem.tenantId, config)).filter((p) => g.premios.includes(p.id) && p.tipo !== 'produto');
    const base = { ...vazio, mostrar: true, premios: lista.map((p) => ({ id: p.id, nome: p.nome, descricao: p.descricao })) };
    const dado = await this.doCaso(quem.tenantId, casoId);
    if (dado) return { ...base, dado, motivo: 'Este caso já recebeu um prêmio de desculpas.' };
    const chave = chaveTelefone(c.telefone);
    if (CANAIS_SEM_PREMIO.includes(String(c.canal ?? '').toLowerCase()) || !chave)
      return { ...base, motivo: 'Só nos casos com o telefone do cliente (WhatsApp ou cardápio): o iFood e a 99 não aceitam o cupom do Regem.' };
    if (!podeMandarDesculpas(g.quem, quem.perfil))
      return { ...base, motivo: `Nesta loja, quem manda o prêmio de desculpas é: ${QUEM_MANDA_DESCULPAS[g.quem].rotulo.toLowerCase()}.` };
    if (!lista.length) return { ...base, motivo: 'Nenhum prêmio liberado para a equipe: o presidente escolhe em Marketing › Clube › Prêmio surpresa.' };
    const recebidos = await this.recebidosNaJanela(this.db, quem.tenantId, chave, limite.dias);
    if (recebidos >= limite.maximo)
      return { ...base, recebidos, motivo: `Este cliente já recebeu o limite de prêmios de desculpas (${limite.rotulo}).` };
    return { ...base, recebidos, disponivel: true };
  }

  /**
   * `POST /atendimento/:id/premio-desculpas` — dá o prêmio e manda a mensagem. TODA recusa antes de gravar (V86): o gatilho
   * ligado, o caso com telefone e fora do iFood/99, o perfil, o prêmio liberado e a mensagem. O limite por cliente é
   * conferido DENTRO da transação, com o cadastro do cliente travado (`for update`). O envio pelo WhatsApp vem depois de
   * gravar: se não sair (fora da janela de 24 h da Meta, sem conexão), o prêmio fica na conta do cliente e a tela mostra o
   * link para a equipe mandar de outro jeito.
   */
  async mandar(quem: QuemManda, casoId: string, dto: any) {
    const estado = await this.estado(quem, casoId);
    if (!estado.mostrar) throw new ForbiddenException('O prêmio de desculpas está desligado nesta empresa.');
    if (estado.dado) throw new ConflictException('Este caso já recebeu um prêmio de desculpas.');
    if (!estado.disponivel) throw new BadRequestException(estado.motivo ?? 'Não dá para mandar o prêmio de desculpas agora.');
    const premioId = typeof dto?.premioId === 'string' ? dto.premioId.toLowerCase() : '';
    const escolhido = estado.premios.find((p) => p.id === premioId);
    if (!escolhido) throw new BadRequestException('Escolha um dos prêmios da lista.');
    mensagemDasDesculpas(dto?.mensagem, ''); // recusa a mensagem longa ANTES de gravar
    const c = await this.caso(quem.tenantId, casoId);
    const chave = chaveTelefone(c.telefone)!;
    const config = await this.clube.config(quem.tenantId);
    const g = (await this.clube.gatilhos(quem.tenantId)).reclamacao;
    const limite = LIMITES_DA_RECLAMACAO[g.limite];
    const [p] = this.rows(
      await this.db.execute(sql`
        select id, nome, tipo, valor::float8 as valor, teto::float8 as teto, minimo::float8 as minimo, validade_dias
          from clube_premio where id = ${premioId}::uuid and tenant_id = ${quem.tenantId}::uuid and excluido_em is null`),
    );
    if (!p || p.tipo === 'produto') throw new BadRequestException('Escolha um dos prêmios da lista.');

    const novo = await this.db.transaction(async (tx: any) => {
      // A trava da transação por empresa e telefone (como a da auditoria): dois casos do mesmo cliente ao mesmo tempo
      // contam um depois do outro — vale também quando o cliente ainda não tem cadastro (não há linha para travar).
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`clube-desculpas:${quem.tenantId}`}), hashtext(${chave}))`);
      // O cadastro do cliente (o cupom pessoal pede um): o mais recente com a mesma chave; sem nenhum, nasce agora.
      let [cli] = this.rows(
        await tx.execute(sql`
          select id from cliente where tenant_id = ${quem.tenantId}::uuid and ${sqlChaveTelefone(sql`telefone`)} = ${chave}
           order by ultimo_pedido_em desc nulls last, criado_em limit 1`),
      );
      if (!cli)
        [cli] = this.rows(
          await tx.execute(sql`
            insert into cliente (tenant_id, nome, telefone) values (${quem.tenantId}::uuid, ${c.cliente ?? null}, ${telefoneCadastro(c.telefone)})
            returning id`),
        );
      if ((await this.recebidosNaJanela(tx, quem.tenantId, chave, limite.dias)) >= limite.maximo)
        throw new BadRequestException(`Este cliente já recebeu o limite de prêmios de desculpas (${limite.rotulo}).`);
      const r = await this.surpresa.criarDireito(tx, {
        tenantId: quem.tenantId,
        clienteId: String(cli.id),
        chave,
        gatilho: 'reclamacao',
        ref: casoId,
        forma: config.surpresaForma,
        premio: {
          id: String(p.id),
          nome: String(p.nome),
          tipo: p.tipo,
          valor: Number(p.valor),
          teto: p.teto == null ? null : Number(p.teto),
          minimo: Number(p.minimo),
          validadeDias: Number(p.validade_dias),
        },
      });
      if (!r) throw new ConflictException('Este caso já recebeu um prêmio de desculpas.');
      return r;
    });

    const link = ClubeSurpresaService.linkDoDireito(novo.codigo);
    let enviado = false;
    let motivoEnvio: string | null = null;
    const numero = telefoneParaWhatsapp(c.telefone);
    if (!numero || !this.provedores) motivoEnvio = 'Sem o número do WhatsApp deste cliente: mande o link de outro jeito.';
    else
      try {
        await this.provedores.enviar(quem.tenantId, numero, mensagemDasDesculpas(dto?.mensagem, link), quem.colaboradorId);
        enviado = true;
      } catch (e: any) {
        this.logger.warn(`prêmio de desculpas do caso ${casoId}: a mensagem não saiu: ${e?.message ?? e}`);
        motivoEnvio = 'A mensagem não saiu pelo WhatsApp (a conversa pode ter passado de 24 horas). O prêmio já está na conta do cliente: mande o link de outro jeito.';
      }
    await this.auditoria
      ?.registrar({
        tenantId: quem.tenantId,
        atorId: quem.colaboradorId,
        atorPerfil: quem.perfil,
        tipo: 'atendimento',
        acao: 'clube_premio_desculpas',
        entidadeTipo: 'atendimento_chamado',
        entidadeId: casoId,
        detalhe: { premio: escolhido.nome, direito: novo.id, enviado },
      })
      ?.catch((e: any) => this.logger.warn(`prêmio de desculpas: auditoria não gravada: ${e?.message ?? e}`));
    return { premio: escolhido.nome, link, validoAte: novo.validoAte, enviado, motivoEnvio };
  }
}
