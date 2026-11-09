/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { ehServidorLocal } from '../../common/modo';
import { exigirBooleano } from '../../common/exigir';
import { chaveSegredosDisponivel, cifrar, decifrar } from '../../common/cifra-segredo';
import { uuidDeChave } from '../../common/id-deterministico';
import {
  ID_DO_MESSENGER_RE,
  assinarConversaDoMessenger,
  chaveDoMessenger,
  idDaChaveDoMessenger,
  lerConversaDoMessenger,
} from '../../common/conversa-do-robo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { entregarJuntando } from '../whatsapp/juntar-mensagens';
import { juntarMensagem, posicaoNaFila } from '../atendimento/abrir-chamado';
import {
  type Recado,
  inicioDoCasoSql,
  lerRecado,
  recadoAtivoSql,
  recadoDoCasoNovo,
  respostaDoRecado,
  situacaoDaEquipe,
} from '../atendimento/horario-da-equipe';
import { resumoDoRobo } from '../atendimento/resumo-do-robo';
import { recadoParaOResponsavel, respostaParaOResponsavel, resumoComORecado, responsavelNaEsperaSql } from '../cardapio/assuntos-do-atendente';
// A MESMA régua de quem responde do Direct (o robô quieto com a conversa com alguém, o recado, a pausa da loja).
import { CALADO_SEM_PRAZO_MS, SEM_RESPOSTA_MS, quemRespondeNoDirect } from '../instagram/instagram';
import {
  ESCOLHA_VALE_MS,
  DESCRICAO_DO_TIPO,
  assinarEstado,
  frase,
  janela,
  lerAvisoDoMessenger,
  lerEstado,
  nomeDoCliente,
  nomeDoPerfil,
  paginasQueRespondem,
  partirTexto,
  permissoesConcedidas,
  textoDaResposta,
  textoParaORobo,
  urlDeAutorizacao,
  type EventoDoMessenger,
  type PaginaDoLogin,
} from './messenger';
import * as meta from './messenger-graph';

/** O cardápio que o robô do Messenger usa (o horário, a taxa, o link e os textos do robô da loja). */
export type CardapioDoRobo = {
  id: string;
  token: string;
  ativo: boolean;
  aberto: boolean;
  nomePublico: string | null;
  roboSaudacao: string | null;
  roboAusencia: string | null;
  roboPrompt: string | null;
  roboMensagens: any;
  site: string | null;
  instagram: string | null;
};

/** Para quem o robô manda a resposta no Messenger (conferido na hora da resposta — V87). */
export type AlvoDoRobo =
  | { ligado: true; tenantId: string; paginaId: string; psid: string; cardapio: CardapioDoRobo }
  | { ligado: false; motivo: 'robo_desligado' };

export type AjusteDoMessenger = { filaLigada?: boolean; roboResponde?: boolean; cardapioId?: string | null };

// O MESSENGER DO FACEBOOK (a última fase do atendente virtual, mig 386; o espelho do Instagram Direct — migs 377/378). A
// loja conecta a PÁGINA dela (entra no Facebook e autoriza); o acesso da página fica cifrado na nuvem, com a distribuição.
// O aviso de mensagem da Meta chega na nuvem: com o robô do Messenger ligado, o MESMO robô do WhatsApp responde (chave
// `fb:`); senão (ou quando a conversa está com alguém) a conversa vira caso na fila. A resposta da equipe sai pela Send API
// dentro das 24 h, e o que a loja responde pelo app do Facebook aparece na conversa (o eco) e cala o robô. No servidor da
// loja a conversa e a resposta vão à nuvem pelo token do servidor (V37).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quem responde no Messenger: a gestão (como no Direct e no WhatsApp). */
export const QUEM_RESPONDE = ['presidente', 'gerente', 'supervisao'] as const;
/** Quem conecta e muda os ajustes do Messenger. */
const QUEM_CONECTA = ['presidente', 'gerente'] as const;
/** O perfil do cliente é lido de novo depois disto. */
const PERFIL_VELHO_DIAS = 7;
/** A Meta diz que o acesso não vale mais (senha trocada, app removido da página): a conta pede "Reconectar". */
const ACESSO_INVALIDO = 190;
const ERRO_DE_ACESSO = 'O Facebook não aceita mais o acesso à página: reconecte a página do Facebook.';

const linhas = (r: any): any[] => (r?.rows ?? r) as any[];
const minutosDaPausa = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 60;
};
const doApp = () => String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
const retornoPadrao = () => String(process.env.FACEBOOK_REDIRECT_URI || 'https://api.dmsregem.com/api/v1/publico/messenger/retorno');
const ajustesDoApp = (situacao: string) => `${doApp()}/delivery/configuracoes?aba=atendimento&messenger=${encodeURIComponent(situacao)}`;
const paginaDeOutraEmpresa = () =>
  new ConflictException({ statusCode: 409, code: 'PAGINA_DE_OUTRA_EMPRESA', message: 'Esta página do Facebook já está conectada em outra empresa.' });

@Injectable()
export class MessengerService {
  private readonly logger = new Logger('Messenger');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private appId = () => String(process.env.FACEBOOK_APP_ID ?? '').trim();
  private segredo = () => String(process.env.FACEBOOK_APP_SECRET ?? '').trim();
  private verifyToken = () => String(process.env.FACEBOOK_VERIFY_TOKEN ?? '').trim();
  /** A configuração do "Login do Facebook para Empresas" (app do tipo empresa — ERR-415); vazia = o login clássico, com `scope`. */
  private configDoLogin = () => String(process.env.FACEBOOK_LOGIN_CONFIG_ID ?? '').trim();

  /** A distribuição liberou o Messenger (o app da Meta, o token do aviso e o cofre configurados) e isto é a nuvem. */
  disponivel(): boolean {
    return !ehServidorLocal() && !!this.appId() && !!this.segredo() && !!this.verifyToken() && chaveSegredosDisponivel();
  }

  /**
   * O robô do Messenger pode rodar (a distribuição): a nuvem, o endereço do fluxo ÚNICO do robô (`N8N_ROBO_WEBHOOK_URL`) e
   * a senha do robô (assina a ficha). Sem isso, quem ligou o robô recebe a conversa como caso (V88).
   */
  roboDisponivel(): boolean {
    return !ehServidorLocal() && !!String(process.env.N8N_ROBO_WEBHOOK_URL ?? '').trim() && !!String(process.env.BOT_RESOLVER_SECRET ?? '').trim();
  }

  /** As tabelas do Messenger existem neste banco? (Sem a 386 — ou no servidor da loja —, o Messenger não está ligado.) */
  private async temTabelas(db: any = this.db): Promise<boolean> {
    const [t] = linhas(await db.execute(sql`select to_regclass(current_schema() || '.messenger_conta') is not null as tem`));
    return t?.tem === true;
  }

  // ───────────────────────── os ajustes ─────────────────────────

  /**
   * O grupo "Messenger do Facebook" dos ajustes: se dá para conectar, se o robô pode rodar, os cardápios, a página
   * conectada (nunca o acesso) e se há uma escolha de página esperando. Num banco sem a 386, conta nula (nunca derruba os
   * ajustes).
   */
  async ajuste(tenantId: string) {
    const cardapios = linhas(
      await this.db.execute(sql`
        select cc.id, coalesce(nullif(trim(cc.nome_publico), ''), u.nome, 'Cardápio') as nome, cc.ativo
          from cardapio_config cc left join unidade u on u.id = cc.unidade_id and u.tenant_id = cc.tenant_id
         where cc.tenant_id = ${tenantId}
         order by 2 limit 50`),
    ).map((x) => ({ id: String(x.id), nome: String(x.nome), ativo: x.ativo === true }));
    const base = { disponivel: this.disponivel(), roboDisponivel: this.roboDisponivel(), cardapios };
    if (!(await this.temTabelas())) return { ...base, conta: null, escolhaPendente: false };
    const [conta, escolha] = await Promise.all([
      this.db.execute(sql`
        select c.pagina_id as "paginaId", c.pagina_nome as "paginaNome", c.fila_ligada as "filaLigada", c.robo_responde as "roboResponde",
               c.cardapio_id as "cardapioId", c.conectado_em as "conectadoEm", col.nome as "conectadoPor", c.erro
          from messenger_conta c left join colaborador col on col.id = c.conectado_por and col.tenant_id = c.tenant_id
         where c.tenant_id = ${tenantId}`),
      this.db.execute(sql`select 1 from messenger_escolha where tenant_id = ${tenantId} and vence_em > now()`),
    ]);
    return { ...base, conta: linhas(conta)[0] ?? null, escolhaPendente: linhas(escolha).length > 0 };
  }

  /**
   * Confere o grupo "Messenger do Facebook" do salvar ANTES de gravar qualquer grupo (V86): liga/desliga só com booleano
   * (V15), o cardápio do robô é desta empresa (ou vazio = o único), e o robô só liga com a página conectada, o robô
   * liberado pela distribuição e um cardápio ativo para ele. O que não veio fica como está (V16). Devolve o que gravar.
   */
  async conferirAjuste(tenantId: string, dto: any): Promise<AjusteDoMessenger> {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) throw new BadRequestException('Messenger: ajuste inválido.');
    const saida: AjusteDoMessenger = {};
    for (const k of ['filaLigada', 'roboResponde'] as const) if (dto[k] !== undefined) saida[k] = exigirBooleano(dto[k], `messenger.${k}`);
    if (dto.cardapioId !== undefined) {
      if (dto.cardapioId === null || dto.cardapioId === '') saida.cardapioId = null;
      else if (typeof dto.cardapioId !== 'string' || !UUID_RE.test(dto.cardapioId)) throw new BadRequestException('Messenger: escolha o cardápio do robô.');
      else {
        const [ok] = linhas(await this.db.execute(sql`select 1 from cardapio_config where id = ${dto.cardapioId} and tenant_id = ${tenantId}`));
        if (!ok) throw new BadRequestException('Messenger: este cardápio não é desta empresa.');
        saida.cardapioId = dto.cardapioId;
      }
    }
    if (!Object.keys(saida).length) return saida;
    if (!(await this.temTabelas())) throw new BadRequestException('O Messenger ainda não está liberado pela Regem.');
    if (saida.roboResponde === true) {
      const [c] = linhas(await this.db.execute(sql`select cardapio_id as "cardapioId" from messenger_conta where tenant_id = ${tenantId}`));
      if (!c) throw new BadRequestException('Conecte a página do Facebook antes de ligar o robô no Messenger.');
      if (!this.roboDisponivel()) throw new BadRequestException('O atendente virtual ainda não está liberado pela Regem para o Messenger.');
      const cardapio = await this.cardapioDoRobo(this.db, tenantId, saida.cardapioId !== undefined ? saida.cardapioId : (c.cardapioId ?? null));
      if (!cardapio?.ativo) throw new BadRequestException('Escolha o cardápio (ativo) que o robô usa no Messenger.');
    }
    return saida;
  }

  /** Grava o que `conferirAjuste` devolveu, só nas colunas que vieram, e cada mudança fica na auditoria. */
  async salvarAjuste(user: AuthUser, a: AjusteDoMessenger) {
    const auditar = (acao: string, detalhe: any = {}) =>
      this.auditoria?.registrar({
        tenantId: user.tenantId,
        atorId: user.colaboradorId,
        atorPerfil: user.categoria,
        tipo: 'config',
        acao,
        entidadeTipo: 'messenger_conta',
        entidadeId: user.tenantId,
        detalhe,
      });
    if (a.filaLigada !== undefined) {
      const r = linhas(
        await this.db.execute(sql`
          update messenger_conta set fila_ligada = ${a.filaLigada}, atualizado_em = clock_timestamp()
           where tenant_id = ${user.tenantId} and fila_ligada is distinct from ${a.filaLigada} returning id`),
      );
      if (r[0]) await auditar(a.filaLigada ? 'messenger_na_fila_ligado' : 'messenger_na_fila_desligado');
    }
    if (a.roboResponde !== undefined) {
      const r = linhas(
        await this.db.execute(sql`
          update messenger_conta set robo_responde = ${a.roboResponde}, atualizado_em = clock_timestamp()
           where tenant_id = ${user.tenantId} and robo_responde is distinct from ${a.roboResponde} returning id`),
      );
      if (r[0]) await auditar(a.roboResponde ? 'robo_no_messenger_ligado' : 'robo_no_messenger_desligado');
    }
    if (a.cardapioId !== undefined) {
      const r = linhas(
        await this.db.execute(sql`
          update messenger_conta set cardapio_id = ${a.cardapioId}, atualizado_em = clock_timestamp()
           where tenant_id = ${user.tenantId} and cardapio_id is distinct from ${a.cardapioId}::uuid returning id`),
      );
      if (r[0]) await auditar('cardapio_do_robo_no_messenger', { cardapioId: a.cardapioId });
    }
  }

  /**
   * O cardápio que o robô do Messenger usa: o escolhido, se for desta empresa; sem escolha, o ÚNICO cardápio da empresa;
   * com mais de um e nenhum escolhido, nenhum (o robô não liga).
   */
  async cardapioDoRobo(db: any, tenantId: string, cardapioId: string | null): Promise<CardapioDoRobo | null> {
    const l = linhas(
      await db.execute(sql`
        select id, token, ativo, aberto, nome_publico as "nomePublico", robo_saudacao as "roboSaudacao", robo_ausencia as "roboAusencia",
               robo_prompt as "roboPrompt", robo_mensagens as "roboMensagens", site, instagram
          from cardapio_config
         where tenant_id = ${tenantId} and (${cardapioId}::uuid is null or id = ${cardapioId}::uuid)
         order by id limit 2`),
    ) as CardapioDoRobo[];
    if (cardapioId) return l[0] ?? null;
    return l.length === 1 ? l[0] : null;
  }

  // ───────────────────────── conectar a página ─────────────────────────

  /** O endereço do login do Facebook, com o "state" assinado (empresa, pessoa, 15 min). */
  conectar(user: AuthUser) {
    if (!this.disponivel())
      throw new BadGatewayException({ statusCode: 502, code: 'MESSENGER_INDISPONIVEL', message: 'A Regem ainda está liberando o Messenger com a Meta. Tente de novo mais tarde.' });
    const estado = assinarEstado(user.tenantId, user.colaboradorId, this.segredo());
    return {
      url: urlDeAutorizacao({ appId: this.appId(), redirect: retornoPadrao(), estado, base: meta.login(), versao: meta.versao(), configId: this.configDoLogin() }),
    };
  }

  /** Quem pediu ainda é gestão (presidente ou gerente) e está ativo na empresa viva — a régua da porta na hora da volta (V75). */
  private async gestaoAtiva(tenantId: string, colaboradorId: string): Promise<{ id: string; nivel: string } | null> {
    if (!UUID_RE.test(tenantId) || !UUID_RE.test(colaboradorId)) return null;
    const [q] = linhas(
      await this.db.execute(sql`
        select c.id, coalesce(p.nivel, f.categoria::text) as nivel
          from colaborador c join empresa e on e.id = c.tenant_id and e.deleted_at is null
          left join funcao f on f.id = c.funcao_id left join perfil_acesso p on p.id = c.perfil_acesso_id
         where c.id = ${colaboradorId} and c.tenant_id = ${tenantId} and c.status = 'ativo' and c.deleted_at is null`),
    );
    return q && (QUEM_CONECTA as readonly string[]).includes(String(q.nivel)) ? { id: String(q.id), nivel: String(q.nivel) } : null;
  }

  /**
   * A volta do login do Facebook (rota pública): confere o "state" e quem pediu, troca o código pelo acesso do usuário, o
   * curto pelo longo, e lê as páginas (com o acesso de cada uma) e as permissões. Nenhuma página que responda → "sem
   * página"; uma → conecta; mais de uma → guarda a escolha (cifrada, 15 min) e a tela pergunta qual. Devolve para onde a
   * tela volta, com a situação.
   */
  async retorno(q: { code?: unknown; state?: unknown; error?: unknown }): Promise<string> {
    const e = lerEstado(q?.state, this.segredo());
    if (!e) return ajustesDoApp('expirou');
    if (q?.error) return ajustesDoApp('cancelado');
    const codigo = typeof q?.code === 'string' ? q.code.replace(/#_=_$/, '').replace(/#_$/, '') : '';
    if (!codigo || !this.disponivel()) return ajustesDoApp('erro');
    const quem = await this.gestaoAtiva(e.t, e.c);
    if (!quem) return ajustesDoApp('sem-permissao');
    try {
      const curto = await meta.trocarCodigo({ appId: this.appId(), segredo: this.segredo(), redirect: retornoPadrao(), codigo });
      const longo = await meta.acessoLongo({ appId: this.appId(), segredo: this.segredo(), curto: curto.token });
      const [lista, perms] = await Promise.all([
        meta.paginas(longo.token),
        meta.permissoes(longo.token).catch((err: any) => {
          this.logger.warn(`permissões do Facebook não lidas (empresa ${e.t}): ${err?.message ?? err}`);
          return [];
        }),
      ]);
      const permissoes = permissoesConcedidas(perms);
      // A pessoa desmarcou no Facebook o que o Messenger precisa (ler/responder e ligar os avisos): nada conecta.
      if (permissoes && !['pages_messaging', 'pages_manage_metadata'].every((p) => permissoes.split(',').includes(p))) return ajustesDoApp('faltou-permissao');
      const paginas = paginasQueRespondem(lista);
      if (!paginas.length) return ajustesDoApp('sem-pagina');
      if (paginas.length === 1) {
        await this.ligarPagina({ tenantId: e.t, atorId: quem.id, atorPerfil: quem.nivel }, paginas[0], permissoes);
        return ajustesDoApp('conectado');
      }
      await this.db.execute(sql`
        insert into messenger_escolha (tenant_id, colaborador_id, paginas_cifradas, permissoes, vence_em)
        values (${e.t}, ${quem.id}, ${cifrar(JSON.stringify(paginas))}, ${permissoes}, ${new Date(Date.now() + ESCOLHA_VALE_MS).toISOString()})
        on conflict (tenant_id) do update
           set colaborador_id = excluded.colaborador_id, paginas_cifradas = excluded.paginas_cifradas, permissoes = excluded.permissoes,
               vence_em = excluded.vence_em, criado_em = clock_timestamp()`);
      return ajustesDoApp('escolher');
    } catch (err: any) {
      if (err instanceof ConflictException) return ajustesDoApp('em-outra-empresa');
      this.logger.warn(`conectar o Messenger (empresa ${e.t}): ${err?.message ?? err}`);
      return ajustesDoApp('erro');
    }
  }

  /** A escolha VIVA da empresa (as páginas decifradas), ou null. */
  private async escolhaViva(tenantId: string): Promise<{ id: string; paginas: PaginaDoLogin[]; permissoes: string | null } | null> {
    if (!(await this.temTabelas())) return null;
    const [l] = linhas(
      await this.db.execute(sql`
        select id, paginas_cifradas as cifradas, permissoes from messenger_escolha where tenant_id = ${tenantId} and vence_em > now()`),
    );
    if (!l) return null;
    try {
      const paginas = paginasQueRespondem(
        (JSON.parse(decifrar(l.cifradas)) as any[]).map((p) => ({ id: p?.id, name: p?.nome, access_token: p?.token, tasks: ['MESSAGING'] })),
      );
      return paginas.length ? { id: String(l.id), paginas, permissoes: l.permissoes ?? null } : null;
    } catch (e: any) {
      this.logger.warn(`a escolha da página do Messenger não abriu (empresa ${tenantId}): ${e?.message ?? e}`);
      return null;
    }
  }

  /** As páginas da escolha viva (id e nome — NUNCA o acesso). Sem escolha viva: 404 SEM_ESCOLHA. */
  async paginasDaEscolha(user: AuthUser) {
    const esc = await this.escolhaViva(user.tenantId);
    if (!esc) throw new NotFoundException({ statusCode: 404, code: 'SEM_ESCOLHA', message: 'A escolha da página venceu: conecte de novo.' });
    return { paginas: esc.paginas.map((p) => ({ id: p.id, nome: p.nome })) };
  }

  /** Conecta a página escolhida (da escolha viva da empresa) e apaga a escolha. */
  async escolher(user: AuthUser, dto: any) {
    if (!(QUEM_CONECTA as readonly string[]).includes(user.categoria)) throw new ForbiddenException('Quem conecta o Messenger é a gerência.');
    const paginaId = typeof dto?.paginaId === 'string' ? dto.paginaId.trim() : '';
    if (!ID_DO_MESSENGER_RE.test(paginaId)) throw new BadRequestException('Escolha a página do Facebook.');
    if (!this.disponivel())
      throw new BadGatewayException({ statusCode: 502, code: 'MESSENGER_INDISPONIVEL', message: 'A Regem ainda está liberando o Messenger com a Meta. Tente de novo mais tarde.' });
    const esc = await this.escolhaViva(user.tenantId);
    if (!esc) throw new NotFoundException({ statusCode: 404, code: 'SEM_ESCOLHA', message: 'A escolha da página venceu: conecte de novo.' });
    const pagina = esc.paginas.find((p) => p.id === paginaId);
    if (!pagina) throw new BadRequestException({ statusCode: 400, code: 'PAGINA_FORA_DA_ESCOLHA', message: 'Esta página não está entre as que você pode conectar.' });
    try {
      await this.ligarPagina({ tenantId: user.tenantId, atorId: user.colaboradorId, atorPerfil: user.categoria }, pagina, esc.permissoes);
    } catch (e: any) {
      if (e instanceof ConflictException) throw e;
      this.logger.warn(`conectar a página do Messenger (empresa ${user.tenantId}): ${e?.message ?? e}`);
      throw new BadGatewayException(`O Facebook não ligou a página${e?.message ? `: ${String(e.message).slice(0, 200)}` : '.'}`);
    }
    await this.db.execute(sql`delete from messenger_escolha where tenant_id = ${user.tenantId} and id = ${esc.id}`);
    return { ok: true, pagina: { id: pagina.id, nome: pagina.nome } };
  }

  /**
   * Liga a página à empresa: a página já ligada a OUTRA empresa = 409 PAGINA_DE_OUTRA_EMPRESA (V24 — o índice único também
   * segura a corrida); liga os avisos da página para o nosso app; grava por empresa (uma página por empresa: reconectar ou
   * trocar de página substitui — a fila, o robô e o cardápio ficam); a página antiga, se era outra, deixa de avisar.
   */
  private async ligarPagina(quem: { tenantId: string; atorId: string; atorPerfil: string }, p: PaginaDoLogin, permissoes: string | null) {
    const [outra] = linhas(await this.db.execute(sql`select 1 from messenger_conta where pagina_id = ${p.id} and tenant_id <> ${quem.tenantId}`));
    if (outra) throw paginaDeOutraEmpresa();
    const [antiga] = linhas(await this.db.execute(sql`select pagina_id, token_cifrado from messenger_conta where tenant_id = ${quem.tenantId}`));
    await meta.assinarAvisos(p.id, p.token);
    try {
      await this.db.execute(sql`
        insert into messenger_conta (tenant_id, pagina_id, pagina_nome, token_cifrado, permissoes, conectado_por, conectado_em, erro, erro_em, atualizado_em)
        values (${quem.tenantId}, ${p.id}, ${p.nome}, ${cifrar(p.token)}, ${permissoes}, ${quem.atorId}, clock_timestamp(), null, null, clock_timestamp())
        on conflict (tenant_id) do update
           set pagina_id = excluded.pagina_id, pagina_nome = excluded.pagina_nome, token_cifrado = excluded.token_cifrado,
               permissoes = excluded.permissoes, conectado_por = excluded.conectado_por, conectado_em = excluded.conectado_em,
               erro = null, erro_em = null, atualizado_em = clock_timestamp()`);
    } catch (err: any) {
      if (err?.code === '23505') throw paginaDeOutraEmpresa();
      throw err;
    }
    await this.db.execute(sql`delete from messenger_escolha where tenant_id = ${quem.tenantId}`);
    if (antiga && antiga.pagina_id !== p.id)
      await meta.desligarAvisos(antiga.pagina_id, decifrar(antiga.token_cifrado)).catch((e: any) =>
        this.logger.warn(`a página antiga do Messenger não deixou de avisar (empresa ${quem.tenantId}): ${e?.message ?? e}`),
      );
    await this.auditoria?.registrar({
      tenantId: quem.tenantId,
      atorId: quem.atorId,
      atorPerfil: quem.atorPerfil,
      tipo: 'config',
      acao: 'messenger_conectado',
      entidadeTipo: 'messenger_conta',
      entidadeId: quem.tenantId,
      detalhe: { paginaId: p.id, paginaNome: p.nome },
    });
  }

  /** Desconecta: desliga os avisos da página na Meta (se der) e apaga a conta — o acesso some junto. Os casos ficam. */
  async desconectar(user: AuthUser) {
    if (!(await this.temTabelas())) return { ok: true };
    await this.db.execute(sql`delete from messenger_escolha where tenant_id = ${user.tenantId}`);
    const [c] = linhas(await this.db.execute(sql`delete from messenger_conta where tenant_id = ${user.tenantId} returning pagina_id, pagina_nome, token_cifrado`));
    if (!c) return { ok: true };
    try {
      await meta.desligarAvisos(c.pagina_id, decifrar(c.token_cifrado));
    } catch (e: any) {
      this.logger.warn(`desconectar o Messenger (empresa ${user.tenantId}): a Meta não desligou o aviso (${e?.message ?? e})`);
    }
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'messenger_desconectado',
      entidadeTipo: 'messenger_conta',
      entidadeId: user.tenantId,
      detalhe: { paginaId: c.pagina_id, paginaNome: c.pagina_nome },
    });
    return { ok: true };
  }

  // ───────────────────────── o aviso de mensagem ─────────────────────────

  /** O aviso da Meta (já com a assinatura conferida). Nunca lança: cada mensagem é tratada sozinha. */
  async processar(body: any): Promise<void> {
    for (const ev of lerAvisoDoMessenger(body)) {
      try {
        await this.umaMensagem(ev);
      } catch (e: any) {
        this.logger.error(`aviso do Messenger (página ${ev.pagina}): ${e?.message ?? e}`);
      }
    }
  }

  private async umaMensagem(ev: EventoDoMessenger) {
    // O eco do NOSSO app (a equipe ou o robô pelo Regem): já gravado ao enviar — nem entra de novo, nem cala o robô.
    if (ev.eco && ev.appId && ev.appId === this.appId()) return;
    let paraORobo: any = null;
    const aviso: { evento: string; dados: any } | null = await this.db.transaction(async (tx: any) => {
      // A trava da página: dois avisos do mesmo cliente ao mesmo tempo — um decide, o outro espera e já vê o caso. Só a
      // página de uma empresa viva (V75).
      const [conta] = linhas(
        await tx.execute(sql`
          select c.id, c.tenant_id as "tenantId", c.fila_ligada as "filaLigada", c.robo_responde as "roboResponde", c.cardapio_id as "cardapioId"
            from messenger_conta c join empresa e on e.id = c.tenant_id and e.deleted_at is null
           where c.pagina_id = ${ev.pagina} for update of c`),
      );
      if (!conta) return null; // página que não está (mais) conectada: nada a fazer
      const texto = frase(ev);
      const [msg] = linhas(
        await tx.execute(sql`
          insert into messenger_mensagem (tenant_id, pagina_id, psid, direcao, autor, tipo, texto, midia_url, mid, estado, criado_em)
          values (${conta.tenantId}, ${ev.pagina}, ${ev.psid}, ${ev.eco ? 'saida' : 'entrada'}, ${ev.eco ? 'loja' : 'cliente'}, ${ev.tipo},
                  ${ev.texto}, ${ev.midiaUrl}, ${ev.mid}, ${ev.eco ? 'enviada' : 'recebida'}, ${ev.em.toISOString()})
          on conflict (tenant_id, mid) where mid is not null do nothing
          returning id`),
      );
      // Aviso repetido: nada mais — nem caso, nem o robô (V79/ERR-319: o efeito só quando a gravação idempotente diz NOVA).
      if (!msg) return null;
      if (ev.eco) return null; // a loja escreveu pelo app do Facebook: fica na conversa (e cala o robô — quemRespondeNoDirect)
      const querRobo = conta.roboResponde === true;
      const cardapio = querRobo ? await this.cardapioDoRobo(tx, conta.tenantId, conta.cardapioId) : null;
      const roboLigado = querRobo && this.roboDisponivel() && !!cardapio?.ativo;
      // V88: quem ligou o robô e ele não pode responder recebe a conversa como CASO, mesmo com a fila desligada.
      const filaLigada = conta.filaLigada === true || (querRobo && !roboLigado);
      if (!filaLigada && !roboLigado) return null;
      const [contato] = linhas(await tx.execute(sql`select nome from messenger_contato where tenant_id = ${conta.tenantId} and psid = ${ev.psid}`));
      // O caso da conversa: o comum antes do recado para o responsável que espera alguém (mig 381); depois, o mais novo.
      const [aberto] = linhas(
        await tx.execute(sql`
          select id, ${inicioDoCasoSql('atendimento_chamado')} as "criadoEm", responsavel_id as "responsavelId",
                 ${recadoAtivoSql('atendimento_chamado')} as recado, ${responsavelNaEsperaSql('atendimento_chamado')} as "paraOResponsavel"
            from atendimento_chamado
           where tenant_id = ${conta.tenantId} and tipo = 'messenger' and status = 'aberto' and detalhe #>> '{messenger,psid}' = ${ev.psid}
           order by ${responsavelNaEsperaSql('atendimento_chamado')}, criado_em desc limit 1`),
      );
      const [quieto] = roboLigado
        ? linhas(
            await tx.execute(sql`
              select (select max(m.criado_em) from messenger_mensagem m
                       where m.tenant_id = ${conta.tenantId} and m.psid = ${ev.psid} and m.autor = 'loja') as "ultimaDaLojaEm",
                     (select pausa_minutos from robo_config where tenant_id = ${conta.tenantId}) as minutos,
                     now() as agora`),
          )
        : [null];
      const decisao = quemRespondeNoDirect({
        roboLigado,
        filaLigada,
        caso: aberto ?? null,
        ultimaDaLojaEm: quieto?.ultimaDaLojaEm ?? null,
        minutos: minutosDaPausa(quieto?.minutos),
        agora: quieto?.agora ? new Date(quieto.agora).getTime() : Date.now(),
      });
      if (decisao.robo && cardapio) paraORobo = this.mensagemParaORobo({ tenantId: conta.tenantId, paginaId: ev.pagina, ev, contato, cardapio });
      if (aberto && decisao.anexar) {
        await tx.execute(sql`
          update atendimento_chamado
             set mensagem = ${texto}, aguardando_desde = null,
                 detalhe = coalesce(detalhe, '{}'::jsonb)
                           || jsonb_build_object('messenger', coalesce(detalhe -> 'messenger', '{}'::jsonb) || jsonb_build_object('ultimaEm', ${ev.em.toISOString()}::text))
           where id = ${aberto.id}`);
        await tx.execute(sql`update messenger_mensagem set chamado_id = ${aberto.id} where id = ${msg.id}`);
        return { evento: 'atendimento.mudou', dados: { tenantId: conta.tenantId, id: aberto.id, motivo: 'messenger_mensagem' } };
      }
      if (!decisao.abrir) return null; // o robô responde (ou a loja está respondendo pelo app do Facebook)
      const semRobo = querRobo && !roboLigado ? 'robo_indisponivel' : null;
      // Fora do HORÁRIO DA EQUIPE (mig 379), pelo horário do cardápio do robô: o caso nasce como recado para a abertura
      // (não toca). No Messenger o robô não vê pedido — vale só o horário. Lido fora da transação (não a derruba).
      const fora = await recadoDoCasoNovo(this.db, conta.tenantId, { cardapioId: cardapio?.id ?? conta.cardapioId ?? null });
      const detalhe = {
        plataforma: 'messenger',
        messenger: { psid: ev.psid, nome: contato?.nome ?? null, ultimaEm: ev.em.toISOString(), ...(semRobo ? { semRobo } : {}) },
        ...(fora ? { recado: fora.recado } : {}),
      };
      const [novo] = linhas(
        await tx.execute(sql`
          insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, detalhe)
          values (${conta.tenantId}, null, 'messenger', 'messenger', ${nomeDoCliente(contato)}, ${texto}, 'normal', ${JSON.stringify(detalhe)}::jsonb)
          returning *`),
      );
      await tx.execute(sql`update messenger_mensagem set chamado_id = ${novo.id} where id = ${msg.id}`);
      return { evento: 'atendimento.novo', dados: { tenantId: conta.tenantId, chamado: novo } };
    });
    if (aviso) this.events.emit(aviso.evento, aviso.dados);
    // Ao robô só DEPOIS de gravar (a resposta dele confere o caso e a janela no banco). Nunca rejeita (V3).
    if (paraORobo) void entregarJuntando(paraORobo).catch((e: any) => this.logger.warn(`Messenger ao robô: ${e?.message ?? e}`));
    if (!ev.eco) void this.lerPerfil(ev.pagina, ev.psid);
  }

  /**
   * A mensagem do Messenger no formato que o robô (n8n) recebe — o MESMO do Direct (`MsgNormalizada`): `provedor:
   * 'instagram'` (o caminho só-texto do fluxo), `canal: 'messenger'`, a página na chave `instancia` (`fb:<página>`), o
   * cliente em `de` (`fb:<psid>`), a ficha do Messenger em `conversa`. O `tipo` é sempre texto: no Messenger o robô não ouve
   * áudio (o texto diz o que veio) e não responde em voz.
   */
  mensagemParaORobo(o: { tenantId: string; paginaId: string; ev: EventoDoMessenger; contato: any; cardapio: CardapioDoRobo }) {
    const { ev, cardapio } = o;
    return {
      provedor: 'instagram',
      canal: 'messenger',
      tenantId: o.tenantId,
      cardapioToken: cardapio.token,
      phoneNumberId: null,
      instancia: chaveDoMessenger(o.paginaId),
      jid: null,
      loja: { nome: cardapio.nomePublico ?? null, aberto: cardapio.aberto !== false },
      de: chaveDoMessenger(ev.psid),
      nome: (o.contato?.nome || null) as string | null,
      tipo: 'text',
      texto: textoParaORobo(ev),
      mensagemId: ev.mid ?? '',
      timestamp: Math.floor(ev.em.getTime() / 1000),
      midiaId: null,
      opcaoId: null,
      roboSaudacao: cardapio.roboSaudacao ?? null,
      roboAusencia: cardapio.roboAusencia ?? null,
      roboPrompt: cardapio.roboPrompt ?? null,
      roboMensagens: Array.isArray(cardapio.roboMensagens) ? cardapio.roboMensagens : [],
      conversa: assinarConversaDoMessenger(o.tenantId, ev.psid),
    };
  }

  /** O nome do cliente (o perfil do Messenger): na primeira mensagem e depois de uma semana. Falha = sem nome. Nunca lança (V3). */
  private async lerPerfil(paginaId: string, psid: string): Promise<void> {
    try {
      const [c] = linhas(
        await this.db.execute(sql`
          select c.tenant_id as "tenantId", c.token_cifrado as token, ct.atualizado_em as "lidoEm"
            from messenger_conta c left join messenger_contato ct on ct.tenant_id = c.tenant_id and ct.psid = ${psid}
           where c.pagina_id = ${paginaId}`),
      );
      if (!c) return;
      if (c.lidoEm && Date.now() - new Date(c.lidoEm).getTime() < PERFIL_VELHO_DIAS * 86_400_000) return;
      const nome = nomeDoPerfil(await meta.perfilDoCliente(psid, decifrar(c.token)));
      await this.db.execute(sql`
        insert into messenger_contato (tenant_id, psid, nome, atualizado_em) values (${c.tenantId}, ${psid}, ${nome}, clock_timestamp())
        on conflict (tenant_id, psid) do update set nome = coalesce(excluded.nome, messenger_contato.nome), atualizado_em = clock_timestamp()`);
      if (!nome) return;
      // O caso aberto que nasceu sem o nome ganha o nome do perfil.
      const r = linhas(
        await this.db.execute(sql`
          update atendimento_chamado
             set cliente = ${nome},
                 detalhe = detalhe || jsonb_build_object('messenger', coalesce(detalhe -> 'messenger', '{}'::jsonb) || jsonb_build_object('nome', ${nome}::text))
           where tenant_id = ${c.tenantId} and tipo = 'messenger' and status = 'aberto' and detalhe #>> '{messenger,psid}' = ${psid}
             and (detalhe #>> '{messenger,nome}') is null
           returning id`),
      );
      for (const l of r) this.events.emit('atendimento.mudou', { tenantId: c.tenantId, id: l.id, motivo: 'messenger_perfil' });
    } catch (e: any) {
      this.logger.warn(`perfil do cliente do Messenger: ${e?.message ?? e}`);
    }
  }

  // ───────────────────────── a conversa e a resposta da equipe ─────────────────────────

  private async casoDoMessenger(tenantId: string, id: string) {
    if (!UUID_RE.test(String(id ?? ''))) throw new NotFoundException('Caso não encontrado.');
    const [c] = linhas(
      await this.db.execute(sql`
        select id, status, responsavel_id as "responsavelId", detalhe #>> '{messenger,psid}' as psid
          from atendimento_chamado where tenant_id = ${tenantId} and id = ${id} and tipo = 'messenger'`),
    );
    if (!c || !c.psid) throw new NotFoundException('Caso do Messenger não encontrado.');
    return c;
  }

  /** A conversa do caso: as últimas 60 mensagens, o nome do cliente, a página da loja e a janela de 24 h. */
  async conversa(tenantId: string, id: string) {
    if (ehServidorLocal()) return this.pelaNuvem('GET', `messenger-da-loja?chamado=${encodeURIComponent(String(id ?? ''))}`);
    const c = await this.casoDoMessenger(tenantId, id);
    const [msgs, perfil, conta, ultima] = await Promise.all([
      this.db.execute(sql`
        select * from (
          select id, direcao, autor, tipo, texto, midia_url as "midiaUrl", estado, erro, criado_em as "criadoEm",
                 (select nome from colaborador where id = m.autor_id and tenant_id = m.tenant_id) as "autorNome"
            from messenger_mensagem m where tenant_id = ${tenantId} and psid = ${c.psid}
           order by criado_em desc, id desc limit 60) x order by "criadoEm", id`),
      this.db.execute(sql`select nome from messenger_contato where tenant_id = ${tenantId} and psid = ${c.psid}`),
      this.db.execute(sql`select pagina_nome as "paginaNome" from messenger_conta where tenant_id = ${tenantId}`),
      this.db.execute(sql`select max(criado_em) as em from messenger_mensagem where tenant_id = ${tenantId} and psid = ${c.psid} and autor = 'cliente'`),
    ]);
    const mensagens = linhas(msgs).map((m) => ({ ...m, texto: m.texto ?? (DESCRICAO_DO_TIPO as any)[m.tipo] ?? '' }));
    return {
      mensagens,
      perfil: linhas(perfil)[0] ?? null,
      pagina: linhas(conta)[0]?.paginaNome ?? null,
      conectada: !!linhas(conta)[0],
      janela: janela(linhas(ultima)[0]?.em ?? null),
    };
  }

  /**
   * A resposta da equipe no Messenger: a gestão, dentro das 24 h, com a página conectada. Sai pela Send API e fica na
   * conversa (com o id da Meta). Responder pega o caso para quem respondeu.
   */
  async responder(user: AuthUser, id: string, dto: any) {
    if (!(QUEM_RESPONDE as readonly string[]).includes(user.categoria)) throw new ForbiddenException('Quem responde no Messenger é a gestão.');
    const t = textoDaResposta(dto?.texto);
    if (!t.ok) throw new BadRequestException(t.erro);
    if (ehServidorLocal())
      return this.pelaNuvem('POST', 'messenger-da-loja', { chamadoId: id, texto: t.texto, atorId: user.colaboradorId, atorPerfil: user.categoria });
    return this.enviar(user.tenantId, id, t.texto, { id: user.colaboradorId, perfil: user.categoria });
  }

  /** A resposta vinda do servidor da loja: quem respondeu é colaborador ativo da empresa e da gestão (conferido aqui). */
  async responderVindoDaLoja(tenantId: string, dto: any) {
    const t = textoDaResposta(dto?.texto);
    if (!t.ok) throw new BadRequestException(t.erro);
    const atorId = typeof dto?.atorId === 'string' && UUID_RE.test(dto.atorId) ? dto.atorId : null;
    const [quem] = atorId
      ? linhas(
          await this.db.execute(sql`
            select c.id, coalesce(p.nivel, f.categoria::text) as nivel
              from colaborador c left join funcao f on f.id = c.funcao_id left join perfil_acesso p on p.id = c.perfil_acesso_id
             where c.id = ${atorId} and c.tenant_id = ${tenantId} and c.status = 'ativo' and c.deleted_at is null`),
        )
      : [];
    if (!quem || !(QUEM_RESPONDE as readonly string[]).includes(String(quem.nivel))) throw new ForbiddenException('Quem responde no Messenger é a gestão.');
    return this.enviar(tenantId, String(dto?.chamadoId ?? ''), t.texto, { id: quem.id, perfil: String(quem.nivel) });
  }

  /** O acesso da página que a Meta recusou (190): a conta pede "Reconectar". Nunca lança. */
  private async marcarAcessoInvalido(tenantId: string, e: any) {
    if (!(e instanceof meta.ErroDaMeta) || e.codigo !== ACESSO_INVALIDO) return;
    await this.db
      .execute(sql`update messenger_conta set erro = ${ERRO_DE_ACESSO}, erro_em = clock_timestamp() where tenant_id = ${tenantId}`)
      .catch((x: any) => this.logger.warn(`marcar o acesso do Messenger (empresa ${tenantId}): ${x?.message ?? x}`));
  }

  private async enviar(tenantId: string, id: string, texto: string, quem: { id: string; perfil: string }) {
    const c = await this.casoDoMessenger(tenantId, id);
    const [conta] = linhas(await this.db.execute(sql`select pagina_id as "paginaId", token_cifrado as token from messenger_conta where tenant_id = ${tenantId}`));
    if (!conta)
      throw new ConflictException({
        statusCode: 409,
        code: 'MESSENGER_NAO_CONECTADO',
        message: 'A página do Facebook não está conectada: conecte em Delivery › Configurações › Atendimento.',
      });
    const [u] = linhas(await this.db.execute(sql`select max(criado_em) as em from messenger_mensagem where tenant_id = ${tenantId} and psid = ${c.psid} and autor = 'cliente'`));
    if (!janela(u?.em ?? null).aberta)
      throw new ConflictException({
        statusCode: 409,
        code: 'FORA_DA_JANELA',
        message: 'Passaram 24 h da última mensagem do cliente: o Messenger não deixa a loja responder agora. Quando ele escrever de novo, a conversa abre.',
      });
    let mid: string | null = null;
    try {
      mid = (await meta.enviarTexto(conta.paginaId, decifrar(conta.token), c.psid, texto)).mid;
    } catch (e: any) {
      await this.db.execute(sql`
        insert into messenger_mensagem (tenant_id, pagina_id, psid, direcao, autor, tipo, texto, chamado_id, autor_id, estado, erro)
        values (${tenantId}, ${conta.paginaId}, ${c.psid}, 'saida', 'equipe', 'texto', ${texto}, ${c.id}, ${quem.id}, 'falhou', ${String(e?.message ?? e).slice(0, 300)})`);
      await this.marcarAcessoInvalido(tenantId, e);
      this.logger.warn(`resposta no Messenger (empresa ${tenantId}): ${e?.message ?? e}`);
      throw new BadGatewayException(`O Messenger não aceitou a mensagem${e?.message ? `: ${String(e.message).slice(0, 200)}` : '.'}`);
    }
    await this.db.execute(sql`
      insert into messenger_mensagem (tenant_id, pagina_id, psid, direcao, autor, tipo, texto, mid, chamado_id, autor_id, estado)
      values (${tenantId}, ${conta.paginaId}, ${c.psid}, 'saida', 'equipe', 'texto', ${texto}, ${mid}, ${c.id}, ${quem.id}, 'enviada')
      on conflict (tenant_id, mid) where mid is not null do update set autor = 'equipe', autor_id = excluded.autor_id, chamado_id = excluded.chamado_id`);
    await this.db.execute(sql`
      update atendimento_chamado set responsavel_id = coalesce(responsavel_id, ${quem.id}), pego_em = coalesce(pego_em, now())
       where id = ${c.id} and status = 'aberto'`);
    await this.auditoria?.registrar({
      tenantId,
      atorId: quem.id,
      atorPerfil: quem.perfil,
      tipo: 'atendimento',
      acao: 'respondeu_messenger',
      entidadeTipo: 'atendimento_chamado',
      entidadeId: c.id,
      detalhe: {},
    });
    this.events.emit('atendimento.mudou', { tenantId, id: c.id, motivo: 'respondeu_messenger' });
    return { ok: true, mid };
  }

  // ───────────────────────── o robô no Messenger ─────────────────────────

  /** A página da chave `fb:<página>`, conectada a uma empresa viva. */
  private async contaDaPagina(paginaId: string) {
    const [c] = linhas(
      await this.db.execute(sql`
        select c.tenant_id as "tenantId", c.robo_responde as "roboResponde", c.cardapio_id as "cardapioId"
          from messenger_conta c join empresa e on e.id = c.tenant_id and e.deleted_at is null
         where c.pagina_id = ${paginaId}`),
    );
    return c ?? null;
  }

  /**
   * O cardápio que as consultas do robô usam no Messenger (loja, cardápio, taxa e as instruções — chave `fb:<página>`):
   * só com a página conectada, o robô do Messenger ligado, a distribuição pronta e o cardápio ativo; senão `null` (404).
   */
  async cardapioDaConta(instancia: unknown): Promise<CardapioDoRobo | null> {
    const paginaId = idDaChaveDoMessenger(instancia);
    if (!paginaId || !this.roboDisponivel() || !(await this.temTabelas())) return null;
    const c = await this.contaDaPagina(paginaId);
    if (!c || c.roboResponde !== true) return null;
    const cardapio = await this.cardapioDoRobo(this.db, c.tenantId, c.cardapioId);
    return cardapio?.ativo ? cardapio : null;
  }

  /**
   * Para quem vai a resposta do robô (`publico/bot/responder` com a chave `fb:`), RECONFERIDO na hora (V87): a página
   * conectada, o robô ligado e a distribuição pronta, o cardápio dele ativo. 400 para chave que não é do Messenger; 404 para
   * página que não está conectada.
   */
  async alvoDoRobo(instancia: unknown, para: unknown): Promise<AlvoDoRobo> {
    const paginaId = idDaChaveDoMessenger(instancia);
    const psid = idDaChaveDoMessenger(para);
    if (!paginaId || !psid || paginaId === psid) throw new BadRequestException('Conversa do Messenger inválida.');
    const c = (await this.temTabelas()) ? await this.contaDaPagina(paginaId) : null;
    if (!c) throw new NotFoundException('Página do Facebook não conectada a uma loja.');
    if (c.roboResponde !== true || !this.roboDisponivel()) return { ligado: false, motivo: 'robo_desligado' };
    const cardapio = await this.cardapioDoRobo(this.db, c.tenantId, c.cardapioId);
    if (!cardapio?.ativo) return { ligado: false, motivo: 'robo_desligado' };
    return { ligado: true, tenantId: c.tenantId, paginaId, psid, cardapio };
  }

  /**
   * A resposta do robô no Messenger (o texto já pronto: links da loja e opções numeradas — robo-resposta.service). Na
   * trava da página: SEGURA quando a conversa está com alguém (a mesma régua da entrada — quemRespondeNoDirect), salvo UMA
   * vez o "já chamei a equipe" que o handoff liberou (V83); segura também fora das 24 h. Sai em até 3 mensagens de 2.000
   * caracteres; cada uma fica na conversa como `robo`, com o id da Meta. Falha da Meta fica na conversa e volta 502.
   */
  async enviarDoRobo(alvo: Extract<AlvoDoRobo, { ligado: true }>, texto: string): Promise<{ ok: true; enviado: boolean; motivo?: string; enviados?: string[] }> {
    const { tenantId, paginaId, psid } = alvo;
    const partes = partirTexto(texto);
    if (!partes.length) throw new BadRequestException('Nada para enviar.');
    const decisao = await this.db.transaction(async (tx: any) => {
      const [conta] = linhas(
        await tx.execute(sql`select token_cifrado as token from messenger_conta where tenant_id = ${tenantId} and pagina_id = ${paginaId} for update`),
      );
      if (!conta) return { pode: false as const, motivo: 'robo_desligado' };
      const [l] = linhas(
        await tx.execute(sql`
          select (select row_to_json(x) from (
                    select a.id, ${inicioDoCasoSql('a')} as "criadoEm", a.responsavel_id as "responsavelId",
                           ${recadoAtivoSql('a')} as recado, ${responsavelNaEsperaSql('a')} as "paraOResponsavel",
                           (a.detalhe #>> '{messenger,avisoLiberado}') = 'true' as "avisoLiberado"
                      from atendimento_chamado a
                     where a.tenant_id = ${tenantId} and a.tipo = 'messenger' and a.status = 'aberto' and a.detalhe #>> '{messenger,psid}' = ${psid}
                     order by ${responsavelNaEsperaSql('a')}, a.criado_em desc limit 1) x) as caso,
                 (select max(m.criado_em) from messenger_mensagem m where m.tenant_id = ${tenantId} and m.psid = ${psid} and m.autor = 'loja') as "ultimaDaLojaEm",
                 (select max(m.criado_em) from messenger_mensagem m where m.tenant_id = ${tenantId} and m.psid = ${psid} and m.autor = 'cliente') as "ultimaDoCliente",
                 (select pausa_minutos from robo_config where tenant_id = ${tenantId}) as minutos,
                 now() as agora`),
      );
      if (!janela(l?.ultimaDoCliente ?? null).aberta) return { pode: false as const, motivo: 'fora_da_janela' };
      const caso = l?.caso ?? null;
      const r = quemRespondeNoDirect({
        roboLigado: true,
        filaLigada: false,
        caso,
        ultimaDaLojaEm: l?.ultimaDaLojaEm ?? null,
        minutos: minutosDaPausa(l?.minutos),
        agora: l?.agora ? new Date(l.agora).getTime() : Date.now(),
      });
      if (!r.robo) {
        // O "já chamei" do handoff: liberado uma vez só, consumido aqui (vale com várias instâncias da API).
        if (!caso?.avisoLiberado) return { pode: false as const, motivo: 'conversa_pausada' };
        const usado = linhas(
          await tx.execute(sql`
            update atendimento_chamado
               set detalhe = detalhe || jsonb_build_object('messenger', (detalhe -> 'messenger') || jsonb_build_object('avisoLiberado', false))
             where id = ${caso.id} and status = 'aberto' and (detalhe #>> '{messenger,avisoLiberado}') = 'true'
             returning id`),
        );
        if (!usado[0]) return { pode: false as const, motivo: 'conversa_pausada' };
      }
      return { pode: true as const, token: conta.token as string, chamadoId: (caso?.id as string) ?? null };
    });
    if (!decisao.pode) {
      this.logger.log(`resposta do robô no Messenger segurada (${decisao.motivo}) empresa=${tenantId}`);
      return { ok: true, enviado: false, motivo: decisao.motivo };
    }
    const enviados: string[] = [];
    for (const parte of partes) {
      let mid: string | null = null;
      try {
        mid = (await meta.enviarTexto(paginaId, decifrar(decisao.token), psid, parte)).mid;
      } catch (e: any) {
        await this.db.execute(sql`
          insert into messenger_mensagem (tenant_id, pagina_id, psid, direcao, autor, tipo, texto, chamado_id, estado, erro)
          values (${tenantId}, ${paginaId}, ${psid}, 'saida', 'robo', 'texto', ${parte}, ${decisao.chamadoId}, 'falhou', ${String(e?.message ?? e).slice(0, 300)})`);
        await this.marcarAcessoInvalido(tenantId, e);
        this.logger.warn(`resposta do robô no Messenger (empresa ${tenantId}): ${e?.message ?? e}`);
        throw new BadGatewayException(`O Messenger não aceitou a mensagem${e?.message ? `: ${String(e.message).slice(0, 200)}` : '.'}`);
      }
      await this.db.execute(sql`
        insert into messenger_mensagem (tenant_id, pagina_id, psid, direcao, autor, tipo, texto, mid, chamado_id, estado)
        values (${tenantId}, ${paginaId}, ${psid}, 'saida', 'robo', 'texto', ${parte}, ${mid}, ${decisao.chamadoId}, 'enviada')
        on conflict (tenant_id, mid) where mid is not null do update set autor = 'robo', chamado_id = coalesce(messenger_mensagem.chamado_id, excluded.chamado_id)`);
      enviados.push('texto');
    }
    if (decisao.chamadoId) this.events.emit('atendimento.mudou', { tenantId, id: decisao.chamadoId, motivo: 'robo_respondeu_messenger' });
    return { ok: true, enviado: true, enviados };
  }

  /**
   * "CHAMAR ATENDENTE" no Messenger (a ferramenta do robô, pela rota do cardápio com `telefone: fb:<psid>`): só com a ficha
   * do Messenger desta empresa e deste cliente (V79). Na trava da página: lê ANTES se a conversa já estava com alguém (V83)
   * — se não estava, libera UMA resposta do robô (o "já chamei a equipe"); abre o caso do Messenger com o resumo (Motivo /
   * Quer / Já fiz), ou soma ao que já está aberto (a prioridade só sobe). Fora do HORÁRIO DA EQUIPE (mig 379) o caso nasce
   * RECADO; o assunto que não é pedido em "recado" (mig 381) vira RECADO PARA O RESPONSÁVEL — como no Direct.
   */
  async abrirPeloRobo(tenantIdDoCardapio: string, dto: any) {
    const conv = lerConversaDoMessenger(dto?.conversa);
    if (!conv || conv.tenantId !== tenantIdDoCardapio) throw new UnauthorizedException('Conversa do Messenger inválida.');
    const psidDoTelefone = idDaChaveDoMessenger(dto?.telefone);
    if (!psidDoTelefone || psidDoTelefone !== conv.psid) throw new UnauthorizedException('Conversa do Messenger inválida.');
    const { tenantId, psid } = conv;
    const aceito = await recadoParaOResponsavel(this.db, tenantId, dto?.tipo);
    const urgente = !aceito && (dto?.prioridade === 'urgente' || dto?.urgente === true || dto?.urgente === 'true');
    const resumo = resumoDoRobo(dto, urgente);
    const mensagem = typeof dto?.mensagem === 'string' && dto.mensagem.trim() ? dto.mensagem.trim().slice(0, 1000) : null;
    type Chamou = { id: string; novo: any; mudou: boolean; prioridade: string; recado: Recado | null; textoFora?: string | null; cardapioId: string | null; paraOResponsavel?: true };
    const r = await this.db.transaction(async (tx: any): Promise<Chamou> => {
      const [conta] = linhas(await tx.execute(sql`select id, cardapio_id as "cardapioId" from messenger_conta where tenant_id = ${tenantId} for update`));
      if (!conta) throw new NotFoundException('Messenger não conectado.');
      const cardapioId: string | null = conta.cardapioId ?? null;
      const daConversa = sql`a.tenant_id = ${tenantId} and a.tipo = 'messenger' and a.status = 'aberto' and a.detalhe #>> '{messenger,psid}' = ${psid}`;
      const [l] = linhas(
        await tx.execute(sql`
          select (select row_to_json(x) from (
                    select a.id, a.responsavel_id as "responsavelId"
                      from atendimento_chamado a where ${daConversa}
                     order by ${responsavelNaEsperaSql('a')}, a.criado_em desc limit 1) x) as caso,
                 (select row_to_json(x) from (
                    select a.id, a.prioridade, a.mensagem, a.responsavel_id as "responsavelId", a.criado_em as "criadoEm",
                           a.detalhe -> 'recado' as recado, ${recadoAtivoSql('a')} as "recadoAtivo"
                      from atendimento_chamado a
                     where ${daConversa}
                       and ${aceito ? sql`a.detalhe #>> '{responsavel,assunto}' = ${aceito.assunto}::text` : sql`(a.detalhe -> 'responsavel') is null`}
                     order by a.criado_em desc limit 1) x) as alvo,
                 (select max(m.criado_em) from messenger_mensagem m where m.tenant_id = ${tenantId} and m.psid = ${psid} and m.autor = 'loja') as "ultimaDaLojaEm",
                 (select pausa_minutos from robo_config where tenant_id = ${tenantId}) as minutos,
                 (select row_to_json(ct) from (select nome from messenger_contato where tenant_id = ${tenantId} and psid = ${psid}) ct) as contato,
                 now() as agora`),
      );
      const caso = l?.alvo ?? null;
      const minutos = minutosDaPausa(l?.minutos);
      const agora = l?.agora ? new Date(l.agora).getTime() : Date.now();
      const t = l?.ultimaDaLojaEm ? new Date(l.ultimaDaLojaEm).getTime() : NaN;
      const lojaRespondeu = Number.isFinite(t) && agora - t < (minutos > 0 ? minutos * 60_000 : CALADO_SEM_PRAZO_MS);
      // V83: a leitura de ANTES de abrir decide o "já chamei" — com a conversa já com alguém, o robô não fala por cima.
      const liberar = !(l?.caso?.responsavelId || lojaRespondeu);
      const emIso = new Date(agora).toISOString();
      if (aceito) {
        const robo = { ...(resumoComORecado(resumo, mensagem) ?? {}), em: emIso };
        if (caso) {
          await tx.execute(sql`
            update atendimento_chamado
               set mensagem = ${juntarMensagem(caso.mensagem, mensagem)}, aguardando_desde = null,
                   detalhe = coalesce(detalhe, '{}'::jsonb) || ${JSON.stringify({ robo })}::jsonb
             where id = ${caso.id}`);
          return { id: caso.id as string, novo: null, mudou: true, prioridade: caso.prioridade, recado: null, cardapioId, paraOResponsavel: true };
        }
        const detalhe = {
          plataforma: 'messenger',
          messenger: { psid, nome: l?.contato?.nome ?? null, ultimaEm: emIso, abertoPeloRobo: true, avisoLiberado: false },
          robo,
          responsavel: { assunto: aceito.assunto, em: emIso },
        };
        const [novo] = linhas(
          await tx.execute(sql`
            insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, detalhe)
            values (${tenantId}, null, 'messenger', 'messenger', ${nomeDoCliente(l?.contato)}, ${mensagem ?? 'O robô deixou um recado para o responsável'},
                    'normal', ${JSON.stringify(detalhe)}::jsonb)
            returning *`),
        );
        await tx.execute(sql`
          update messenger_mensagem set chamado_id = ${novo.id}
           where tenant_id = ${tenantId} and psid = ${psid} and chamado_id is null and criado_em > now() - interval '12 hours'`);
        return { id: novo.id as string, novo, mudou: false, prioridade: 'normal', recado: null, cardapioId, paraOResponsavel: true };
      }
      const robo = resumo ? { ...resumo, em: emIso } : null;
      if (caso) {
        const subiu = urgente && caso.prioridade !== 'urgente';
        const [row] = linhas(
          await tx.execute(sql`
            update atendimento_chamado
               set prioridade = ${subiu ? 'urgente' : caso.prioridade}, mensagem = ${juntarMensagem(caso.mensagem, mensagem)}, aguardando_desde = null,
                   detalhe = coalesce(detalhe, '{}'::jsonb)
                             || ${JSON.stringify(robo ? { robo } : {})}::jsonb
                             || jsonb_build_object('messenger', coalesce(detalhe -> 'messenger', '{}'::jsonb) || jsonb_build_object('avisoLiberado', ${liberar}::boolean))
             where id = ${caso.id}
             returning *`),
        );
        const recado = caso.recadoAtivo === true ? lerRecado({ recado: caso.recado }) : null;
        return { id: caso.id as string, novo: subiu ? row : null, mudou: !subiu, prioridade: row?.prioridade ?? caso.prioridade, recado, cardapioId };
      }
      const fora = await recadoDoCasoNovo(this.db, tenantId, { cardapioId });
      const detalhe = {
        plataforma: 'messenger',
        messenger: { psid, nome: l?.contato?.nome ?? null, ultimaEm: emIso, abertoPeloRobo: true, avisoLiberado: liberar },
        ...(robo ? { robo } : {}),
        ...(fora ? { recado: fora.recado } : {}),
      };
      const [novo] = linhas(
        await tx.execute(sql`
          insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, detalhe)
          values (${tenantId}, null, 'messenger', 'messenger', ${nomeDoCliente(l?.contato)}, ${mensagem ?? 'O robô chamou a equipe no Messenger'},
                  ${urgente ? 'urgente' : 'normal'}, ${JSON.stringify(detalhe)}::jsonb)
          returning *`),
      );
      await tx.execute(sql`
        update messenger_mensagem set chamado_id = ${novo.id}
         where tenant_id = ${tenantId} and psid = ${psid} and chamado_id is null and criado_em > now() - interval '12 hours'`);
      return { id: novo.id as string, novo, mudou: false, prioridade: novo.prioridade, recado: fora?.recado ?? null, textoFora: fora?.situacao.textoFora ?? null, cardapioId };
    });
    if (r.paraOResponsavel && aceito) {
      this.events.emit('atendimento.mudou', { tenantId, id: r.id, motivo: r.novo ? 'recado_para_o_responsavel' : 'robo_somou' });
      return respostaParaOResponsavel(r.id, aceito, !r.novo);
    }
    if (r.novo) this.events.emit('atendimento.novo', { tenantId, chamado: r.novo });
    else if (r.mudou) this.events.emit('atendimento.mudou', { tenantId, id: r.id, motivo: 'robo_somou' });
    if (r.recado) {
      const textoFora = r.textoFora !== undefined ? r.textoFora : (await situacaoDaEquipe(this.db, tenantId, { cardapioId: r.cardapioId })).textoFora;
      return { ok: true, id: r.id, prioridade: r.prioridade, comAlguem: false, ...respostaDoRecado(r.recado, textoFora) };
    }
    const pos = await posicaoNaFila(this.db, tenantId, r.id);
    const [cfg] = linhas(await this.db.execute(sql`select dizer_posicao as "dizer" from robo_config where tenant_id = ${tenantId}`));
    return { ok: true, id: r.id, prioridade: r.prioridade, posicao: cfg?.dizer === false ? null : pos.posicao, comAlguem: pos.comAlguem };
  }

  /**
   * O ROBÔ NÃO RESPONDEU (V88), a cada minuto, só na nuvem: a conversa do Messenger com o robô ligado em que a ÚLTIMA
   * mensagem é do cliente, há mais de 3 min, sem caso aberto, vira caso para uma pessoa. A condição toda no `where` (V84);
   * as últimas 30 min, até 100 por rodada. Na trava da página, confere de novo; o id do caso vem da mensagem
   * (`uuidDeChave`: duas rodadas ou duas instâncias = um caso — V42). Num banco sem a 386: nada (0).
   */
  @Cron('*/1 * * * *')
  async semResposta(): Promise<number> {
    if (ehServidorLocal()) return 0;
    let r: any[];
    try {
      r = linhas(
        await this.db.execute(sql`
          select c.tenant_id as "tenantId", c.cardapio_id as "cardapioId", m.psid, m.id as "msgId", m.texto, m.tipo
            from messenger_conta c
            join empresa e on e.id = c.tenant_id and e.deleted_at is null
            join lateral (
              select distinct on (x.psid) x.psid, x.id, x.texto, x.tipo, x.autor, x.criado_em
                from messenger_mensagem x
               where x.tenant_id = c.tenant_id and x.criado_em > now() - interval '30 minutes' and x.estado <> 'falhou'
               order by x.psid, x.criado_em desc, x.id desc) m on true
           where c.robo_responde
             and m.autor = 'cliente' and m.criado_em < now() - make_interval(secs => ${SEM_RESPOSTA_MS / 1000})
             and not exists (select 1 from atendimento_chamado a
                              where a.tenant_id = c.tenant_id and a.tipo = 'messenger' and a.status = 'aberto'
                                and a.detalhe #>> '{messenger,psid}' = m.psid and not ${responsavelNaEsperaSql('a')})
           limit 100`),
      );
    } catch (e: any) {
      if (e?.code === '42P01') return 0; // a 386 ainda não está neste banco
      throw e;
    }
    let abertos = 0;
    for (const p of r) {
      try {
        const novo = await this.db.transaction(async (tx: any) => {
          await tx.execute(sql`select 1 from messenger_conta where tenant_id = ${p.tenantId} for update`);
          const [ainda] = linhas(
            await tx.execute(sql`
              select 1 where not exists (select 1 from atendimento_chamado a
                                          where a.tenant_id = ${p.tenantId} and a.tipo = 'messenger' and a.status = 'aberto'
                                            and a.detalhe #>> '{messenger,psid}' = ${p.psid} and not ${responsavelNaEsperaSql('a')})
                         and (select autor from messenger_mensagem where tenant_id = ${p.tenantId} and psid = ${p.psid} and estado <> 'falhou'
                               order by criado_em desc, id desc limit 1) = 'cliente'`),
          );
          if (!ainda) return null;
          const [ct] = linhas(await tx.execute(sql`select nome from messenger_contato where tenant_id = ${p.tenantId} and psid = ${p.psid}`));
          const fora = await recadoDoCasoNovo(this.db, p.tenantId, { cardapioId: p.cardapioId ?? null });
          const detalhe = {
            plataforma: 'messenger',
            messenger: { psid: p.psid, nome: ct?.nome ?? null, ultimaEm: new Date().toISOString(), semResposta: true },
            ...(fora ? { recado: fora.recado } : {}),
          };
          const [c] = linhas(
            await tx.execute(sql`
              insert into atendimento_chamado (id, tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, detalhe)
              values (${uuidDeChave('messenger-sem-resposta', p.tenantId, p.msgId)}, ${p.tenantId}, null, 'messenger', 'messenger', ${nomeDoCliente(ct)},
                      ${frase({ texto: p.texto, tipo: p.tipo as any })}, 'normal', ${JSON.stringify(detalhe)}::jsonb)
              on conflict (id) do nothing
              returning *`),
          );
          if (!c) return null;
          await tx.execute(sql`
            update messenger_mensagem set chamado_id = ${c.id}
             where tenant_id = ${p.tenantId} and psid = ${p.psid} and chamado_id is null and criado_em > now() - interval '12 hours'`);
          return c;
        });
        if (novo) {
          abertos++;
          this.logger.log(`Messenger sem resposta do robô virou caso (empresa ${p.tenantId}).`);
          this.events.emit('atendimento.novo', { tenantId: p.tenantId, chamado: novo });
        }
      } catch (e: any) {
        this.logger.warn(`Messenger sem resposta (empresa ${p.tenantId}): ${e?.message ?? e}`);
      }
    }
    return abertos;
  }

  // ───────────────────────── "Conversas agora" e "Assumir" (chat-do-caso.service) ─────────────────────────

  /**
   * O MESSENGER com o robô agora: com o robô do Messenger ligado, as conversas com mensagem na última hora e SEM caso
   * aberto — o robô está nelas. Com as últimas 8 mensagens e o nome do cliente. Da empresa (a página é da empresa).
   * NUNCA derruba "Conversas agora": sem a 386 neste banco, o Messenger não está ligado; outra falha vem como "não li"
   * (`lida: false` — V37, ERR-393).
   */
  async conversasAgora(tenantId: string): Promise<{ ligado: boolean; lida: boolean; conversas: any[] }> {
    try {
      if (!(await this.temTabelas())) return { ligado: false, lida: true, conversas: [] };
      const [conta] = linhas(await this.db.execute(sql`select robo_responde from messenger_conta where tenant_id = ${tenantId}::uuid`));
      if (conta?.robo_responde !== true) return { ligado: false, lida: true, conversas: [] };
      const r = linhas(
        await this.db.execute(sql`
          with ativas as (
            select m.psid, max(m.criado_em) as ultima
              from messenger_mensagem m
             where m.tenant_id = ${tenantId}::uuid and m.criado_em > now() - interval '60 minutes'
               and not exists (select 1 from atendimento_chamado a
                                where a.tenant_id = ${tenantId}::uuid and a.tipo = 'messenger' and a.status = 'aberto'
                                  and a.detalhe #>> '{messenger,psid}' = m.psid)
             group by m.psid
             order by 2 desc
             limit 50
          )
          select a.psid, a.ultima, ct.nome,
                 (select jsonb_agg(jsonb_build_object('id', x.id, 'direcao', x.direcao, 'autor', x.autor, 'texto', x.texto, 'tipo', x.tipo,
                                                      'estado', x.estado, 'motivo', null, 'em', x.criado_em) order by x.criado_em, x.id)
                    from (select y.* from messenger_mensagem y
                           where y.tenant_id = ${tenantId}::uuid and y.psid = a.psid
                           order by y.criado_em desc, y.id desc limit 8) x) as mensagens
            from ativas a
            left join messenger_contato ct on ct.tenant_id = ${tenantId}::uuid and ct.psid = a.psid
           order by a.ultima desc`),
      );
      const conversas = r.map((c) => ({
        canal: 'messenger',
        chave: chaveDoMessenger(String(c.psid)),
        ultima: new Date(c.ultima).toISOString(),
        cliente: c.nome ? nomeDoCliente({ nome: c.nome }) : null,
        pedidoId: null,
        pedidoNumero: null,
        pedidoStatus: null,
        mensagens: (Array.isArray(c.mensagens) ? c.mensagens : []).map(({ tipo, ...m }: any) => ({ ...m, texto: String(m?.texto || (DESCRICAO_DO_TIPO as any)[tipo] || '') })),
        comRobo: true,
      }));
      return { ligado: true, lida: true, conversas };
    } catch (e: any) {
      if (e?.code === '42P01' || e?.code === '42703') return { ligado: false, lida: true, conversas: [] };
      this.logger.warn(`o Messenger em "Conversas agora" (empresa ${tenantId}): ${e?.message ?? e}`);
      return { ligado: true, lida: false, conversas: [] };
    }
  }

  /**
   * "ASSUMIR A CONVERSA" DO MESSENGER: quem responde no Messenger (a gestão). Na trava da PÁGINA — a mesma do aviso e do
   * robô —: a conversa já tem caso aberto — sem ninguém, fica com quem assumiu; com outra pessoa, 409 com o nome —; senão
   * nasce o caso do Messenger já com a pessoa (as mensagens das últimas 12 h passam a ser dele). O caso aberto com alguém
   * cala o robô; resolver devolve a conversa ao robô.
   */
  async assumir(user: AuthUser, eu: string, chave: string, origem: 'web' | 'servidor_loja' = 'web') {
    if (!(QUEM_RESPONDE as readonly string[]).includes(String(user?.categoria ?? '')))
      throw new ForbiddenException('Quem assume a conversa do Messenger é a gerência ou a supervisão.');
    const psid = idDaChaveDoMessenger(chave);
    if (!psid) throw new BadRequestException('Conversa inválida.');
    if (!(await this.temTabelas())) throw new NotFoundException('A página do Facebook da loja não está conectada.');
    const r = await this.db.transaction(async (tx: any) => {
      const [conta] = linhas(await tx.execute(sql`select id from messenger_conta where tenant_id = ${user.tenantId}::uuid for update`));
      if (!conta) throw new NotFoundException('A página do Facebook da loja não está conectada.');
      const [aberto] = linhas(
        await tx.execute(sql`
          select c.id, c.responsavel_id, col.nome from atendimento_chamado c
            left join colaborador col on col.id = c.responsavel_id and col.tenant_id = c.tenant_id
           where c.tenant_id = ${user.tenantId}::uuid and c.tipo = 'messenger' and c.status = 'aberto'
             and c.detalhe #>> '{messenger,psid}' = ${psid}
           order by c.criado_em desc limit 1`),
      );
      if (aberto) {
        if (aberto.responsavel_id && aberto.responsavel_id !== eu) throw new ConflictException(`${aberto.nome ?? 'Outra pessoa'} já está com esta conversa.`);
        if (!aberto.responsavel_id)
          await tx.execute(sql`update atendimento_chamado set responsavel_id = ${eu}::uuid, pego_em = now() where id = ${aberto.id}::uuid`);
        return { id: aberto.id as string, novo: null };
      }
      const [c] = linhas(
        await tx.execute(sql`
          select (array_agg(m.texto order by m.criado_em desc) filter (where m.autor = 'cliente' and m.texto is not null))[1] as fala,
                 max(m.criado_em) as ultima, count(*)::int as n,
                 (select row_to_json(ct) from (select nome from messenger_contato
                                                where tenant_id = ${user.tenantId}::uuid and psid = ${psid}) ct) as contato
            from messenger_mensagem m
           where m.tenant_id = ${user.tenantId}::uuid and m.psid = ${psid} and m.criado_em > now() - interval '1 day'`),
      );
      if (!c?.n) throw new NotFoundException('Esta conversa não está mais no Messenger.');
      const detalhe = {
        plataforma: 'messenger',
        messenger: { psid, nome: c.contato?.nome ?? null, ultimaEm: new Date(c.ultima).toISOString() },
        assumida: true,
      };
      const [novo] = linhas(
        await tx.execute(sql`
          insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, mensagem, prioridade, responsavel_id, pego_em, detalhe)
          values (${user.tenantId}::uuid, null, 'messenger', 'messenger', ${nomeDoCliente(c.contato)}, ${c.fala ?? 'Conversa do Messenger assumida do robô'},
                  'normal', ${eu}::uuid, now(), ${JSON.stringify(detalhe)}::jsonb)
          returning *`),
      );
      await tx.execute(sql`
        update messenger_mensagem set chamado_id = ${novo.id}::uuid
         where tenant_id = ${user.tenantId}::uuid and psid = ${psid} and chamado_id is null and criado_em > now() - interval '12 hours'`);
      return { id: novo.id as string, novo };
    });
    await this.auditoria
      ?.registrar({
        tenantId: user.tenantId,
        atorId: eu,
        atorPerfil: user.categoria,
        tipo: 'atendimento',
        acao: 'assumiu_conversa_do_chat',
        entidadeTipo: 'atendimento_chamado',
        entidadeId: r.id,
        detalhe: { canal: 'messenger' },
        origem,
      })
      .catch((e: any) => this.logger.warn(`auditoria do "assumir a conversa" (${r.id}): ${e?.message ?? e}`));
    if (r.novo) this.events.emit('atendimento.novo', { tenantId: user.tenantId, chamado: r.novo });
    else this.events.emit('atendimento.mudou', { tenantId: user.tenantId, id: r.id, motivo: 'assumiu_a_conversa' });
    return { ok: true, id: r.id };
  }

  // ───────────────────────── servidor da loja → nuvem ─────────────────────────

  /** O pedido do servidor da loja à nuvem (token do servidor). A recusa da nuvem volta com o mesmo código HTTP (e o `code`). */
  async pelaNuvem(metodo: 'GET' | 'POST', caminho: string, corpo?: unknown): Promise<any> {
    const nuvem = String(process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!nuvem || !token) throw new BadGatewayException('Este servidor não está ligado à nuvem: o Messenger da loja fala com ela.');
    let res: Response;
    try {
      res = await fetch(`${nuvem}/atendimento/${caminho}`, {
        method: metodo,
        headers: { 'x-sync-token': token, ...(corpo ? { 'content-type': 'application/json' } : {}) },
        ...(corpo ? { body: JSON.stringify(corpo) } : {}),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e: any) {
      this.logger.warn(`Messenger (${metodo} ${caminho.split('?')[0]}): a nuvem não respondeu (${e?.cause?.code ?? e?.message ?? e})`);
      throw new BadGatewayException('A nuvem não respondeu agora. Tente de novo em instantes.');
    }
    const j: any = await res.json().catch(() => null);
    if (!res.ok) {
      const msg = typeof j?.message === 'string' ? j.message : `a nuvem recusou (HTTP ${res.status})`;
      const corpoDoErro = (status: number) => (typeof j?.code === 'string' ? { statusCode: status, code: j.code, message: msg } : msg);
      if (res.status === 409) throw new ConflictException(corpoDoErro(409));
      if (res.status === 404) throw new NotFoundException(corpoDoErro(404));
      if (res.status === 403) throw new ForbiddenException(corpoDoErro(403));
      if (res.status === 400) throw new BadRequestException(corpoDoErro(400));
      throw new BadGatewayException(corpoDoErro(502));
    }
    return j;
  }
}
