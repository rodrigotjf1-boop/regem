import { BadRequestException, Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { ehServidorLocal } from '../../common/modo';
import { hojeISO, somarDias } from '../../common/data';
import { FUSO_SQL } from '../../common/fuso-sql';
import { saiuDoMarketing } from '../../common/marketing-quem-recebe';
import { registrarSaida } from '../../common/consentimento-marketing';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';
import { RespostaDoMarketing, RespostasDoMarketingService } from '../whatsapp/respostas-do-marketing.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { WhatsappNumeroService } from '../whatsapp/whatsapp-numero.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { VagasService } from './vagas.service';
import {
  AVISOS_POR_PEDIDO,
  DE_DO_AVISO,
  DIAS_ENTRE_AVISOS,
  MODELO_DA_VAGA,
  RITMO_DO_AVISO_S,
  ViaDoAviso,
  detalheDaVaga,
  mensagemDoAvisoPeloMarketing,
  paginaDaLinha,
  parametrosDoModeloDaVaga,
  respostaAoAviso,
  textoDaSaidaDosAvisos,
  textoDoInteresse,
  viaDoAviso,
  viaManda,
} from './vagas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O AVISO DA VAGA AO BANCO DE TALENTOS PELO NÚMERO DE MARKETING DA LOJA (F4b parte 2, mig 438; protótipo
// `mockups/regem-vagas-talentos.html`, decisões 4 e 5). A parte 1 (#1032) abre cada conversa no WhatsApp de quem avisa;
// esta põe as pessoas numa FILA que a rotina da nuvem manda uma por vez, no ritmo das campanhas, pelo número de
// marketing: na API oficial com o modelo `vaga_aberta` aprovado pela Meta, no Evolution com o texto. Antes de cada envio
// tudo é conferido de novo (a ficha no banco de talentos, a autorização de mensagens, o SAIR da loja, a função aberta).
// As respostas ("Tenho interesse", "Não quero mais receber") chegam pela entrada do número de marketing (a parte seguinte).

const linhas = (r: any): any[] => r?.rows ?? r ?? [];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const curto = (v: unknown, n = 200) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** A frase de cada via que não manda (a tela mostra; o servidor recusa com ela). */
const POR_QUE_NAO_MANDA: Record<ViaDoAviso, string | null> = {
  oficial_aprovado: null,
  evolution: null,
  oficial_analise: 'O modelo vaga_aberta está em análise na Meta. O envio libera quando ela aprovar.',
  oficial_sem_modelo: 'O modelo vaga_aberta ainda não foi enviado à Meta. Envie o modelo antes de avisar pelo número de marketing.',
  oficial_recusado: 'A Meta recusou (ou pausou) o modelo vaga_aberta. Avise pelo seu WhatsApp enquanto isso.',
  sem: 'A loja não tem número de marketing ligado. Avise pelo seu WhatsApp, com a mensagem pronta.',
};

export interface ViaNaTela {
  via: ViaDoAviso;
  /** Os 4 últimos dígitos do número de marketing (o protótipo mostra "final 7781"). */
  final: string | null;
  /** Por que não manda agora (null = manda). */
  motivo: string | null;
  /** O motivo da Meta, quando ela recusou o modelo. */
  motivoDaMeta: string | null;
}

@Injectable()
export class VagasAvisoService implements OnModuleInit {
  private readonly logger = new Logger('VagasAviso');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly vagas: VagasService,
    private readonly numeros: WhatsappNumeroService,
    private readonly cloud: WhatsappCloudService,
    private readonly whatsapp: WhatsappService,
    private readonly auditoria: AuditoriaService,
    // As respostas ao aviso chegam pela entrada do número de marketing (o módulo do WhatsApp): o gancho se registra ao subir.
    @Optional() private readonly respostas?: RespostasDoMarketingService,
  ) {}

  onModuleInit(): void {
    this.respostas?.registrar((r) => this.responderAoAviso(r));
  }

  // ── as respostas ao aviso (cenas 3 e 4 do protótipo) ───────────────────────────────────────────────────────────

  /**
   * A resposta ao número de marketing que é ao AVISO DA VAGA: só quando esse telefone recebeu um aviso desta empresa nos
   * últimos 30 dias e ainda não respondeu (o mais recente). "Tenho interesse" leva a ficha do banco de talentos para Em
   * análise; "Não quero mais receber" tira das mensagens (as fichas dessa pessoa na empresa) e a situação não muda; o SAIR
   * faz o mesmo e sai também das ofertas da loja. A resposta vai pelo mesmo número. Cada aviso responde uma vez (gravação
   * condicional). Devolve false quando não é resposta a um aviso — a entrada segue o caminho de sempre.
   */
  async responderAoAviso(r: RespostaDoMarketing): Promise<boolean> {
    const qual = respostaAoAviso(r.texto);
    const chave = chaveTelefone(r.telefone);
    if (!qual || !chave) return false;
    const [a] = linhas(
      await this.db.execute(sql`
        select a.id::text as id, a.candidato_id::text as "candidatoId", a.unidade_id::text as "unidadeId", a.funcao
          from vaga_aviso a
         where a.tenant_id = ${r.tenantId}::uuid and a.situacao = 'enviado' and a.resposta is null
           and a.enviado_em > clock_timestamp() - make_interval(days => ${DIAS_ENTRE_AVISOS}::int)
           and ${sqlChaveTelefone(sql`a.telefone`)} = ${chave}
         order by a.enviado_em desc limit 1`),
    );
    if (!a) return false;
    const resposta = qual === 'interesse' ? 'interesse' : 'saiu';
    const [vez] = linhas(
      await this.db.execute(sql`
        update vaga_aviso set resposta = ${resposta}, respondido_em = clock_timestamp()
         where id = ${a.id}::uuid and resposta is null returning id`),
    );
    if (!vez) return true; // outra entrada (o reenvio, outra réplica) já respondeu este aviso
    const [pg] = linhas(await this.db.execute(sql`select * from vaga_pagina where tenant_id = ${r.tenantId}::uuid and unidade_id = ${a.unidadeId}::uuid`));
    const nomeDaFuncao = (pg ? paginaDaLinha(pg).funcoes.find((f) => f.codigo === a.funcao)?.nome : null) ?? a.funcao;
    const loja = await this.vagas.lojaPublica(r.tenantId, a.unidadeId);
    const [c] = linhas(
      await this.db.execute(sql`select id, tenant_id, nome, situacao, expurgo_em from candidato where id = ${a.candidatoId}::uuid and tenant_id = ${r.tenantId}::uuid`),
    );
    if (!c) return true;

    if (qual === 'interesse') {
      await this.db.transaction(async (tx: any) => {
        const [mudou] = linhas(await tx.execute(sql`update candidato set situacao = 'analise' where id = ${c.id} and situacao = 'banco' returning id`));
        await tx.execute(sql`
          insert into candidato_evento (candidato_id, tenant_id, tipo, de, para, texto, autor_nome)
          values (${c.id}, ${c.tenant_id}, ${mudou ? 'situacao' : 'comunicacao'}, ${mudou ? 'banco' : null}, ${mudou ? 'analise' : null},
                  ${`Respondeu "Tenho interesse" ao aviso da vaga de ${nomeDaFuncao}`}, 'WhatsApp da pessoa')`);
      });
      await this.auditoria.registrar({
        tenantId: r.tenantId, unidadeId: a.unidadeId, atorId: null, atorPerfil: null,
        tipo: 'pessoas', acao: 'candidato.respondeu_aviso', entidadeTipo: 'candidato', entidadeId: c.id,
        detalhe: { resposta: 'interesse', funcao: a.funcao }, origem: 'whatsapp',
      });
      await r.responder(textoDoInteresse(c.nome, loja.nome)).catch((e) => this.logger.warn(`a resposta ao "Tenho interesse" não saiu — ${e?.message ?? e}`));
      return true;
    }

    // "Não quero mais receber" e SAIR: sai das mensagens da loja (todas as fichas dessa pessoa na empresa).
    await this.db.transaction(async (tx: any) => {
      const fichas = linhas(
        await tx.execute(sql`
          update candidato set comunicacao_cancelada_em = clock_timestamp()
           where tenant_id = ${r.tenantId}::uuid and comunicacao_cancelada_em is null and ${sqlChaveTelefone(sql`telefone`)} = ${chave}
          returning id, tenant_id`),
      );
      for (const f of fichas)
        await tx.execute(sql`
          insert into candidato_evento (candidato_id, tenant_id, tipo, texto, autor_nome)
          values (${f.id}, ${f.tenant_id}, 'comunicacao', ${`Saiu das mensagens: respondeu "${String(r.texto).trim().slice(0, 40)}" ao aviso da vaga de ${nomeDaFuncao}`}, 'WhatsApp da pessoa')`);
    });
    if (qual === 'sair') await registrarSaida(this.db, { tenantId: r.tenantId, telefone: r.telefone, origem: 'whatsapp', motivo: 'palavra_chave' });
    await this.auditoria.registrar({
      tenantId: r.tenantId, unidadeId: a.unidadeId, atorId: null, atorPerfil: null,
      tipo: 'pessoas', acao: 'candidato.respondeu_aviso', entidadeTipo: 'candidato', entidadeId: c.id,
      detalhe: { resposta: qual, funcao: a.funcao }, origem: 'whatsapp',
    });
    await r.responder(textoDaSaidaDosAvisos(c.nome, loja.nome, c.expurgo_em)).catch((e) => this.logger.warn(`a resposta à saída dos avisos não saiu — ${e?.message ?? e}`));
    return true;
  }

  /** O número de marketing da loja e a situação do modelo `vaga_aberta` (só na oficial). */
  private async numeroEModelo(tenantId: string) {
    const n = await this.numeros.resolver(tenantId, 'marketing').catch(() => null);
    let modelo: { status: string | null; motivo: string | null } = { status: null, motivo: null };
    if (n?.vinculado && n.provedor === 'cloud') {
      const [m] = linhas(
        await this.db.execute(sql`
          select status, motivo_rejeicao as motivo from whatsapp_template
           where tenant_id = ${tenantId}::uuid and nome = ${MODELO_DA_VAGA} and idioma = 'pt_BR'
           limit 1`),
      );
      modelo = { status: m?.status ?? null, motivo: m?.motivo ?? null };
    }
    return { n, modelo };
  }

  /** Por onde o aviso sai agora (o bloco "Por onde sai" da gaveta). */
  async via(tenantId: string): Promise<ViaNaTela> {
    const { n, modelo } = await this.numeroEModelo(tenantId);
    const via = viaDoAviso(n ? { provedor: n.provedor, vinculado: !!n.vinculado } : null, modelo.status);
    const final = String(n?.numero ?? '').replace(/\D/g, '').slice(-4) || null;
    return { via, final: via === 'sem' ? null : final, motivo: POR_QUE_NAO_MANDA[via], motivoDaMeta: via === 'oficial_recusado' ? curto(modelo.motivo) || null : null };
  }

  /** "Enviar o modelo à Meta": o caminho dos outros modelos (`garantirModeloRelacionamento`), na conta do marketing. */
  async pedirModelo(user: AuthUser): Promise<ViaNaTela> {
    const { n } = await this.numeroEModelo(user.tenantId);
    if (!n?.vinculado || n.provedor !== 'cloud') throw new BadRequestException('O modelo da Meta só vale para o número de marketing na API oficial.');
    const situacao = await this.cloud.garantirModeloRelacionamento(user.tenantId, MODELO_DA_VAGA);
    await this.auditoria.registrar({
      tenantId: user.tenantId, unidadeId: null, atorId: user.colaboradorId, atorPerfil: user.categoria,
      tipo: 'pessoas', acao: 'vaga.modelo_pedido', entidadeTipo: 'whatsapp_template', entidadeId: null,
      detalhe: { modelo: MODELO_DA_VAGA, situacao }, origem: 'web',
    });
    return this.via(user.tenantId);
  }

  /**
   * A leitura da gaveta (a da parte 1) com a via e a fila: cada pessoa de "recebem" diz se já espera na fila desta função
   * (`naFila`), e `naFila` no topo conta quantos esperam.
   */
  async comAFila<T extends { funcao: string | null; dentro: any[] }>(tenantId: string, unidade: string | null, r: T) {
    const via = await this.via(tenantId);
    if (!r.funcao || !r.dentro.length) return { ...r, via, naFila: 0 };
    const u = await this.vagas.lojaDosAjustes(tenantId, unidade);
    const esperando = new Set(
      linhas(
        await this.db.execute(sql`
          select candidato_id::text as id from vaga_aviso
           where tenant_id = ${tenantId}::uuid and unidade_id = ${u}::uuid and funcao = ${r.funcao} and situacao in ('na_fila', 'enviando')`),
      ).map((l) => String(l.id)),
    );
    return { ...r, via, naFila: esperando.size, dentro: r.dentro.map((p) => ({ ...p, naFila: esperando.has(String(p.id)) })) };
  }

  /**
   * "Avisar pelo número de marketing": põe na fila, numa consulta só, quem desta loja ainda pode receber o aviso desta
   * função — a MESMA régua da parte 1 (banco de talentos, autorização ativa, a função marcada na ficha, 30 dias desde o
   * último aviso pelo dia da operação, V74) e quem já não está esperando. Devolve quantos entraram e quantos ficaram de
   * fora (o que mudou desde que a gaveta abriu).
   */
  async enfileirar(user: AuthUser, unidade: string | null, dto: any): Promise<{ entraram: number; ficaramDeFora: number; via: ViaNaTela }> {
    const v = await this.via(user.tenantId);
    if (!viaManda(v.via)) throw new BadRequestException(v.motivo ?? 'O número de marketing não está pronto para avisar.');
    const u = await this.vagas.lojaDosAjustes(user.tenantId, unidade);
    const funcao = String(dto?.funcao ?? '');
    const [pg] = linhas(await this.db.execute(sql`select * from vaga_pagina where tenant_id = ${user.tenantId} and unidade_id = ${u}::uuid`));
    const f = pg ? paginaDaLinha(pg).funcoes.find((x) => x.codigo === funcao && x.aberta) : undefined;
    if (!f) throw new BadRequestException('Essa função não está aberta na Página de vagas.');
    const ids = [...new Set((Array.isArray(dto?.candidatoIds) ? dto.candidatoIds : []).map(String).filter((x: string) => UUID.test(x)))];
    if (!ids.length) throw new BadRequestException('Escolha quem vai receber o aviso.');
    if (ids.length > AVISOS_POR_PEDIDO) throw new BadRequestException(`No máximo ${AVISOS_POR_PEDIDO} pessoas por vez.`);
    const limite = somarDias(hojeISO(), -DIAS_ENTRE_AVISOS);
    const entraram = linhas(
      await this.db.execute(sql`
        insert into vaga_aviso (tenant_id, unidade_id, candidato_id, funcao, telefone, pedido_por, pedido_por_nome)
        select c.tenant_id, c.unidade_id, c.id, ${funcao}, c.telefone, ${user.colaboradorId ?? null}, ${user.nome ?? null}
          from candidato c
         where c.tenant_id = ${user.tenantId} and c.unidade_id = ${u}::uuid
           and c.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
           and c.situacao = 'banco' and c.comunicacao_aceita_em is not null and c.comunicacao_cancelada_em is null
           and ${funcao} = any(c.funcoes) and coalesce(c.telefone, '') <> ''
           and not exists (
             select 1 from candidato_evento e
              where e.candidato_id = c.id and e.tipo = 'comunicacao' and e.de = ${DE_DO_AVISO} and e.para = ${funcao}
                and to_char(e.criado_em at time zone ${FUSO_SQL}, 'YYYY-MM-DD') > ${limite})
         order by c.nome, c.id
        on conflict do nothing
        returning id`),
    ).length;
    await this.auditoria.registrar({
      tenantId: user.tenantId, unidadeId: u, atorId: user.colaboradorId, atorPerfil: user.categoria,
      tipo: 'pessoas', acao: 'vaga.aviso_na_fila', entidadeTipo: 'vaga_pagina', entidadeId: null,
      detalhe: { funcao, pedidos: ids.length, entraram, via: v.via }, origem: 'web',
    });
    return { entraram, ficaramDeFora: ids.length - entraram, via: v };
  }

  // ── a rotina: uma por loja por vez, no ritmo das campanhas ──────────────────────────────────────────────────────

  @Interval(5000)
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      // O que ficou "enviando" (a réplica caiu no meio) não volta à fila: não dá para saber se saiu — vira "não enviado".
      await this.db.execute(sql`
        update vaga_aviso set situacao = 'nao_enviado', motivo = 'o envio foi interrompido; confira se a pessoa recebeu antes de avisar de novo'
         where situacao = 'enviando' and enviado_em < clock_timestamp() - interval '10 minutes'`);
      const lojas = linhas(await this.db.execute(sql`select distinct tenant_id from vaga_aviso where situacao = 'na_fila' limit 50`));
      for (const l of lojas) await this.mandarUm(String(l.tenant_id)).catch((e) => this.logger.warn(`aviso de vaga da empresa ${String(l.tenant_id).slice(0, 8)} não andou — ${e?.message ?? e}`));
    } catch (e: any) {
      if (e?.code !== '42P01') this.logger.warn(`a fila do aviso de vaga não rodou — ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Manda o mais antigo da fila desta empresa, se o ritmo deixa (nenhum saiu nos últimos N segundos). A vez é pega por
   * gravação condicional (`for update skip locked` + o ritmo no mesmo `update`). Devolve a situação em que ficou (ou null
   * se não era a vez).
   */
  async mandarUm(tenantId: string): Promise<'enviado' | 'nao_enviado' | null> {
    const { n, modelo } = await this.numeroEModelo(tenantId);
    const via = viaDoAviso(n ? { provedor: n.provedor, vinculado: !!n.vinculado } : null, modelo.status);
    const ritmo = via === 'evolution' ? RITMO_DO_AVISO_S.evolution : RITMO_DO_AVISO_S.oficial;
    const [a] = linhas(
      await this.db.execute(sql`
        update vaga_aviso set situacao = 'enviando', enviado_em = clock_timestamp()
         where id = (select id from vaga_aviso where tenant_id = ${tenantId}::uuid and situacao = 'na_fila'
                      order by criado_em, id limit 1 for update skip locked)
           and not exists (select 1 from vaga_aviso v where v.tenant_id = ${tenantId}::uuid and v.situacao in ('enviando', 'enviado')
                             and v.enviado_em > clock_timestamp() - make_interval(secs => ${ritmo}::int))
        returning id::text as id, unidade_id::text as "unidadeId", candidato_id::text as "candidatoId", funcao, telefone,
                  pedido_por::text as "pedidoPor", pedido_por_nome as "pedidoPorNome"`),
    );
    if (!a) return null;
    const naoEnviado = async (motivo: string) => {
      await this.db.execute(sql`update vaga_aviso set situacao = 'nao_enviado', motivo = ${curto(motivo, 300)} where id = ${a.id}::uuid`);
      return 'nao_enviado' as const;
    };
    if (!viaManda(via) || !n) return naoEnviado(POR_QUE_NAO_MANDA[via] ?? 'o número de marketing não está pronto');

    // Conferido de novo na hora de mandar: a ficha, a autorização, o SAIR da loja e a função aberta.
    const [c] = linhas(
      await this.db.execute(sql`
        select id, tenant_id, nome, telefone, situacao, comunicacao_aceita_em, comunicacao_cancelada_em from candidato
         where id = ${a.candidatoId}::uuid and tenant_id = ${tenantId}::uuid`),
    );
    if (!c) return naoEnviado('a ficha não existe mais');
    if (c.situacao !== 'banco') return naoEnviado('a ficha saiu do banco de talentos');
    if (!c.comunicacao_aceita_em || c.comunicacao_cancelada_em) return naoEnviado('a pessoa pediu para não receber mensagens');
    const telefone = `55${String(c.telefone ?? a.telefone ?? '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '')}`;
    if (await saiuDoMarketing(this.db, tenantId, telefone, null)) return naoEnviado('a pessoa respondeu SAIR às mensagens da loja');
    const [pg] = linhas(await this.db.execute(sql`select * from vaga_pagina where tenant_id = ${tenantId}::uuid and unidade_id = ${a.unidadeId}::uuid`));
    const pagina = pg ? paginaDaLinha(pg) : null;
    const f = pagina?.funcoes.find((x) => x.codigo === a.funcao && x.aberta);
    if (!pagina || !f) return naoEnviado('a vaga fechou antes do envio');
    const loja = await this.vagas.lojaPublica(tenantId, a.unidadeId);
    const dados = { nome: String(c.nome ?? ''), loja: loja.nome, funcao: f.nome, detalhe: detalheDaVaga(pagina, f) };

    let wamid: string | null = null;
    try {
      if (via === 'evolution') {
        await this.whatsapp.enviarPorInstancia(tenantId, String(n.instancia ?? ''), telefone, mensagemDoAvisoPeloMarketing(dados));
      } else {
        const r: any = await this.cloud.enviarTemplate(tenantId, telefone, MODELO_DA_VAGA, 'pt_BR', parametrosDoModeloDaVaga(dados), { phoneId: n.phoneId ?? undefined });
        wamid = r?.id ? String(r.id) : null;
      }
    } catch (e: any) {
      return naoEnviado(`o WhatsApp recusou o envio (${curto(e?.response?.message ?? e?.message ?? e, 160)})`);
    }
    await this.db.transaction(async (tx: any) => {
      await tx.execute(sql`update vaga_aviso set situacao = 'enviado', wamid = ${wamid}, enviado_em = clock_timestamp() where id = ${a.id}::uuid`);
      // O histórico da ficha: é ele que conta os 30 dias, como na parte 1 (quem pediu o aviso é quem avisou).
      await tx.execute(sql`
        insert into candidato_evento (candidato_id, tenant_id, tipo, de, para, texto, autor_id, autor_nome)
        values (${c.id}, ${c.tenant_id}, 'comunicacao', ${DE_DO_AVISO}, ${a.funcao},
                ${`Avisada da vaga de ${f.nome} pelo número de marketing da loja`}, ${a.pedidoPor}::uuid, ${a.pedidoPorNome})`);
    });
    return 'enviado';
  }
}
