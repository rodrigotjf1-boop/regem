import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { AuthUser } from '../../auth/auth-user';
import { exigirBooleano } from '../../common/exigir';
import {
  AUTORIZACAO_LOJA,
  CLIENTES_INTEGRACAO,
  DESCRICAO_CLIENTE,
  EscopoIntegracao,
  ROTULO_ESCOPO,
  ehClienteIntegracao,
  validarEscopos,
} from './escopos';
import {
  ClienteAutorizacao,
  VALIDADE_CODIGO_MIN,
  clienteAutorizacao,
  desafioValido,
  estadoValido,
  formatoCodigoAutorizacao,
  gerarCodigoAutorizacao,
  hashCodigoAutorizacao,
  redirectPermitido,
  segredoConfere,
  urlDeVolta,
  verificadorConfere,
} from './autorizacao-loja';
import { gerarTokenIntegracao } from './token-integracao';
import { Autorizador, IntegracaoTokenService } from './integracao-token.service';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { ProblemaException } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quantas linhas revogadas de cada aplicativo a tela mostra (as mais recentes). */
const REVOGADOS_NA_TELA = 5;

type PedidoValido = { cliente: ClienteAutorizacao; redirectUri: string; state: string; desafio: string };

/**
 * Autorização PELA LOJA (trilha C, C1b — mig 303, só nuvem): a página "Autorizar o Liame", a
 * troca do código pelos tokens das lojas e a tela "Aplicativos conectados" (ver e revogar).
 *
 * Só o presidente autoriza e revoga, e isso é conferido no cadastro de HOJE (não no que o login
 * guardou). O código vale 10 minutos e uma tentativa de troca; o token da loja só nasce na troca.
 * Nem o código, nem o token, nem o segredo de cliente vão para log, erro ou auditoria.
 */
@Injectable()
export class AutorizacaoLojaService {
  private readonly log = new Logger('AutorizacaoLoja');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly tokens: IntegracaoTokenService,
  ) {}

  private async rows(q: SQL, executor: any = this.db): Promise<any[]> {
    const r: any = await executor.execute(q);
    return r.rows ?? r;
  }

  private lista(ids: string[]): SQL {
    return sql.join(
      ids.map((i) => sql`${i}::uuid`),
      sql`, `,
    );
  }

  // ───────────────────────────── a página de autorização ─────────────────────────────

  /**
   * Confere o que o cliente mandou na URL. Qualquer falha vira o MESMO 400 para a tela (que
   * mostra "este pedido não vale" e NÃO devolve a pessoa a endereço nenhum); o motivo fica no log.
   */
  private conferirPedido(p: any): PedidoValido {
    const recusar = (motivo: string): never => {
      this.log.warn(`pedido de autorização recusado: ${motivo}`);
      throw new BadRequestException('Este pedido de autorização não vale: o link chegou incompleto ou venceu.');
    };
    const cliente = clienteAutorizacao(p?.cliente);
    if (!cliente) return recusar('cliente desconhecido');
    if (!redirectPermitido(cliente, p?.redirect_uri)) {
      return recusar(`endereço de volta fora da lista do ${cliente.rotulo}`);
    }
    if (!estadoValido(p?.state)) return recusar('state ausente ou fora do formato');
    if (p?.code_challenge_method !== 'S256' || !desafioValido(p?.code_challenge)) {
      return recusar('PKCE ausente ou diferente de S256');
    }
    if (!cliente.segredo) {
      this.log.warn(`autorização do ${cliente.rotulo} pedida sem o segredo de cliente configurado no ambiente`);
      throw new ServiceUnavailableException(
        `A autorização do ${cliente.rotulo} ainda não está disponível. Tente de novo mais tarde.`,
      );
    }
    return { cliente, redirectUri: p.redirect_uri, state: p.state, desafio: p.code_challenge };
  }

  /** Quem está logado, lido do cadastro de hoje. O técnico do suporte não é colaborador: `null`. */
  private async quemAutoriza(user: AuthUser): Promise<Autorizador | null> {
    if (user.categoria === 'suporte' || !UUID.test(String(user.colaboradorId))) return null;
    return this.tokens.autorizador(user.tenantId, user.colaboradorId);
  }

  /**
   * `GET /integracao-autorizacao/pedido`: o que a página mostra. Quem não é presidente recebe
   * só a recusa (sem lojas nem escopos) e o endereço para voltar ao cliente sem autorizar.
   */
  async pedido(user: AuthUser, q: any) {
    const p = this.conferirPedido(q);
    const cfg = AUTORIZACAO_LOJA[p.cliente.chave];
    const [emp] = await this.rows(sql`
      select nome from empresa where id = ${user.tenantId}::uuid and deleted_at is null`);
    if (!emp) throw new NotFoundException('Empresa não encontrada.');
    const quem = await this.quemAutoriza(user);
    const base = {
      cliente: { chave: p.cliente.chave, rotulo: p.cliente.rotulo, descricao: cfg.descricao, site: cfg.site },
      empresa: emp.nome as string,
      cancelarUrl: urlDeVolta(p.redirectUri, { error: 'access_denied', state: p.state }),
    };
    if (!quem?.presidente) {
      return {
        situacao: 'nao_presidente' as const,
        ...base,
        quem: { nome: quem?.nome ?? user.nome ?? null, nivel: user.categoria },
      };
    }
    const lojas = await this.rows(sql`
      select u.id, u.nome, u.tipo,
             (select max(t.criado_em) from integracao_token_loja t
               where t.tenant_id = u.tenant_id and t.unidade_id = u.id and t.cliente = ${p.cliente.chave}
                 and t.revogado_em is null and (t.expira_em is null or t.expira_em > now())) as "conectadaDesde"
        from unidade u
       where u.tenant_id = ${user.tenantId}::uuid and u.deleted_at is null
       order by (u.tipo = 'matriz') desc, u.nome`);
    return {
      situacao: 'ok' as const,
      ...base,
      quem: { nome: quem.nome, verFinanceiro: quem.verFinanceiro },
      lojas,
      sempre: cfg.sempre.map((e) => ({ chave: e, rotulo: ROTULO_ESCOPO[e] })),
      opcionais: cfg.opcionais.map((o) => {
        const disponivel = !o.financeiro || quem.verFinanceiro;
        return {
          campo: o.campo,
          chave: o.escopo,
          rotulo: ROTULO_ESCOPO[o.escopo],
          padrao: o.padrao && disponivel,
          disponivel,
        };
      }),
    };
  }

  private lojasDoCorpo(v: unknown): string[] {
    if (!Array.isArray(v) || !v.length) throw new BadRequestException('Marque ao menos uma loja.');
    if (v.length > 200) throw new BadRequestException('Lojas demais numa autorização só (até 200).');
    const ids = [...new Set(v.map((i) => String(i).toLowerCase()))];
    if (ids.some((i) => !UUID.test(i))) throw new BadRequestException('Loja inválida.');
    return ids;
  }

  /**
   * `POST /integracao-autorizacao`: o presidente autoriza. Grava o código (só o hash) com as
   * lojas e os escopos e devolve o endereço para onde a página leva a pessoa — o do cliente,
   * com `code` e `state`.
   */
  async autorizar(user: AuthUser, dto: any) {
    const p = this.conferirPedido(dto);
    const cfg = AUTORIZACAO_LOJA[p.cliente.chave];
    const quem = await this.quemAutoriza(user);
    if (!quem?.presidente) {
      throw new ForbiddenException('Só o presidente da empresa autoriza outra ferramenta a ler as vendas.');
    }
    const ids = this.lojasDoCorpo(dto?.lojas);
    const lojas = await this.rows(sql`
      select u.id, u.nome from unidade u
       where u.tenant_id = ${user.tenantId}::uuid and u.deleted_at is null and u.id in (${this.lista(ids)})
       order by u.nome`);
    if (lojas.length !== ids.length) throw new BadRequestException('Loja não encontrada nesta empresa.');

    const pedidos: EscopoIntegracao[] = [...cfg.sempre];
    for (const o of cfg.opcionais) {
      // Liga/desliga obrigatório (V15): campo ausente não vira "não" nem "sim" calado.
      if (!exigirBooleano(dto?.[o.campo], o.campo)) continue;
      if (o.financeiro && !quem.verFinanceiro) {
        throw new BadRequestException(
          `Seu perfil não tem "Ver valores em R$": ${ROTULO_ESCOPO[o.escopo].toLowerCase()} não pode ser liberado.`,
        );
      }
      pedidos.push(o.escopo);
    }
    const escopos = validarEscopos(pedidos);

    // Códigos vencidos há mais de um dia saem aqui (não há job para isso). Nunca derruba a autorização.
    await this.db
      .execute(sql`delete from integracao_autorizacao where expira_em < now() - interval '1 day'`)
      .catch((e: any) => this.log.warn(`limpeza dos códigos vencidos falhou: ${e?.message ?? e}`));

    const gerado = gerarCodigoAutorizacao();
    const [nova] = await this.rows(sql`
      insert into integracao_autorizacao
        (tenant_id, cliente, codigo_hash, desafio, redirect_uri, lojas, escopos, autorizado_por,
         autorizado_por_nome, expira_em)
      values (${user.tenantId}::uuid, ${p.cliente.chave}, ${gerado.hash}, ${p.desafio}, ${p.redirectUri},
              ${`{${ids.join(',')}}`}::uuid[], ${`{${escopos.join(',')}}`}::text[], ${quem.id}::uuid, ${quem.nome},
              now() + make_interval(mins => ${VALIDADE_CODIGO_MIN}))
      returning id`);

    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: quem.id,
      atorPerfil: user.categoria,
      tipo: 'integracao',
      acao: 'integracao.autorizacao_concedida',
      origem: 'web',
      entidadeTipo: 'integracao_autorizacao',
      entidadeId: nova.id,
      detalhe: { cliente: p.cliente.chave, lojas: lojas.map((l) => l.nome), escopos, autorizadoPor: quem.nome },
    });

    return { redirect: urlDeVolta(p.redirectUri, { code: gerado.codigo, state: p.state }) };
  }

  // ───────────────────────────── a troca do código (entre servidores) ─────────────────────────────

  /**
   * `POST /integracao/autorizacao/token`: o servidor do cliente troca o código pelos tokens.
   * Confere o segredo de cliente, GASTA o código (uma instrução: de duas trocas ao mesmo tempo
   * só uma leva; a tentativa que falha depois disso também gasta), confere o endereço de volta
   * e o PKCE, e que quem autorizou continua presidente. Aí, numa transação, revoga o token que
   * a loja já tinha com este cliente e cria o novo. Resposta: `{ lojas: [{ …loja, token }] }`.
   */
  async trocar(body: any) {
    const cliente = clienteAutorizacao(body?.client_id);
    if (!cliente || !segredoConfere(cliente, body?.client_secret)) {
      throw new ProblemaException(401, 'cliente-invalido', 'Cliente ou segredo de cliente inválido.');
    }
    const recusar = (motivo: string): never => {
      this.log.warn(`troca do código recusada (${cliente.chave}): ${motivo}`);
      throw new ProblemaException(400, 'autorizacao-invalida', 'Código de autorização inválido, vencido ou já usado.');
    };
    if (!formatoCodigoAutorizacao(body?.code)) return recusar('código fora do formato');
    const hash = hashCodigoAutorizacao(body.code);

    const [a] = await this.rows(sql`
      update integracao_autorizacao set usado_em = now()
       where codigo_hash = ${hash} and cliente = ${cliente.chave} and usado_em is null and expira_em > now()
       returning id, tenant_id, lojas, escopos, autorizado_por, desafio, redirect_uri`);
    if (!a) {
      const [v] = await this.rows(sql`
        select usado_em is not null as usado, expira_em <= now() as vencido
          from integracao_autorizacao where codigo_hash = ${hash}`);
      return recusar(!v ? 'código desconhecido' : v.usado ? 'código já usado' : v.vencido ? 'código vencido' : 'código de outro cliente');
    }
    if (body?.redirect_uri !== a.redirect_uri) return recusar('endereço de volta diferente do da autorização');
    if (!verificadorConfere(body?.code_verifier, a.desafio)) return recusar('o verificador do PKCE não confere');

    const tenantId = a.tenant_id as string;
    const escopos = validarEscopos(a.escopos);
    const quem = await this.tokens.autorizador(tenantId, a.autorizado_por);
    if (!quem?.presidente) return recusar('quem autorizou deixou de ser presidente');
    if (escopos.includes('custos.ler') && !quem.verFinanceiro) {
      return recusar('quem autorizou perdeu "Ver valores em R$"');
    }
    const ids = a.lojas as string[];
    const lojas = await this.rows(sql`
      select u.id, u.nome from unidade u join empresa e on e.id = u.tenant_id
       where u.tenant_id = ${tenantId}::uuid and u.deleted_at is null and e.deleted_at is null
         and u.id in (${this.lista(ids)})
       order by (u.tipo = 'matriz') desc, u.nome`);
    if (lojas.length !== ids.length) return recusar('loja apagada depois da autorização');

    const novos = lojas.map((l) => ({ loja: l as { id: string; nome: string }, ...gerarTokenIntegracao() }));
    const evidencia = `autorizado pelo presidente na página de autorização (${a.id})`;
    const { antigos, inseridos } = await this.db.transaction(async (tx: any) => {
      // A loja que já estava conectada (o piloto, pela distribuição; ou uma autorização anterior)
      // troca de token: o antigo para de valer na mesma transação em que o novo nasce.
      const antigos = await this.rows(
        sql`
        update integracao_token_loja
           set revogado_em = now(), revogado_por = ${`autorizacao:${quem.nome}`},
               motivo_revogacao = 'trocado por uma autorização nova'
         where tenant_id = ${tenantId}::uuid and cliente = ${cliente.chave} and revogado_em is null
           and unidade_id in (${this.lista(ids)})
         returning id, unidade_id, prefixo`,
        tx,
      );
      const inseridos = await this.rows(
        sql`
        insert into integracao_token_loja
          (tenant_id, unidade_id, cliente, prefixo, token_hash, escopos, autorizado_por,
           autorizado_por_nome, autorizado_via, evidencia)
        values ${sql.join(
          novos.map(
            (n) =>
              sql`(${tenantId}::uuid, ${n.loja.id}::uuid, ${cliente.chave}, ${n.prefixo}, ${n.hash},
                   ${`{${escopos.join(',')}}`}::text[], ${quem.id}::uuid, ${quem.nome}, 'autorizacao_loja', ${evidencia})`,
          ),
          sql`, `,
        )}
        returning id, unidade_id`,
        tx,
      );
      return { antigos, inseridos };
    });

    const idDoToken = new Map(inseridos.map((t: any) => [t.unidade_id as string, t.id as string]));
    for (const n of novos) {
      await this.auditoria.registrar({
        tenantId,
        unidadeId: n.loja.id,
        atorId: quem.id,
        atorPerfil: 'presidente',
        tipo: 'integracao',
        acao: 'integracao.token_emitido',
        origem: 'integracao',
        entidadeTipo: 'integracao_token',
        entidadeId: idDoToken.get(n.loja.id),
        detalhe: { cliente: cliente.chave, prefixo: n.prefixo, escopos, loja: n.loja.nome, autorizadoPor: quem.nome, via: 'autorizacao_loja' },
      });
    }
    for (const t of antigos) {
      await this.auditoria.registrar({
        tenantId,
        unidadeId: t.unidade_id,
        atorId: quem.id,
        atorPerfil: 'presidente',
        tipo: 'integracao',
        acao: 'integracao.token_revogado',
        origem: 'integracao',
        entidadeTipo: 'integracao_token',
        entidadeId: t.id,
        detalhe: { cliente: cliente.chave, prefixo: t.prefixo, por: 'autorizacao', motivo: 'trocado por uma autorização nova' },
      });
    }

    const saida: any[] = [];
    for (const n of novos) {
      const ctx: IntegracaoCtxData = {
        tokenId: idDoToken.get(n.loja.id) as string,
        tenantId,
        unidadeId: n.loja.id,
        abrangencia: 'loja',
        lojaUnica: lojas.length === 1,
        escopos,
        cliente: cliente.chave,
        autorizadoPor: quem.id,
        prefixo: n.prefixo,
      };
      saida.push({ ...(await this.tokens.dadosDaLoja(ctx)), token: n.token });
    }
    return { lojas: saida };
  }

  // ───────────────────────────── Aplicativos conectados ─────────────────────────────

  /** Quem revogou, para a tela: nunca o texto cru (que leva o nome de quem é da distribuição). */
  private porQuem(revogadoPor: string | null): { tipo: string; nome: string | null } | null {
    if (!revogadoPor) return null;
    const [tipo, ...resto] = revogadoPor.split(':');
    const nome = resto.join(':') || null;
    if (tipo === 'loja') return { tipo: 'loja', nome };
    if (tipo === 'autorizacao') return { tipo: 'troca', nome };
    if (tipo === 'integracao') return { tipo: 'aplicativo', nome: null };
    return { tipo: 'distribuicao', nome: null };
  }

  /**
   * `GET /aplicativos-conectados`: as ferramentas que leem dados da empresa, por aplicativo. Os
   * acessos ativos e os últimos revogados; sem prefixo do token, sem IP, sem nada da distribuição
   * além de "foi ela que emitiu".
   */
  async aplicativos(user: AuthUser) {
    const linhas = await this.rows(sql`
      select t.id, t.cliente, t.unidade_id as "lojaId", u.nome as "lojaNome", t.escopos,
             t.autorizado_por_nome as "autorizadoPor", t.autorizado_via as via, t.criado_em as "criadoEm",
             t.ultimo_uso_em as "ultimoUsoEm", t.revogado_em as "revogadoEm", t.revogado_por
        from integracao_token_loja t
        left join unidade u on u.id = t.unidade_id
       where t.tenant_id = ${user.tenantId}::uuid
       order by (t.revogado_em is null) desc, t.revogado_em desc nulls first,
                (u.tipo = 'matriz') desc nulls last, u.nome, t.criado_em desc
       limit 500`);
    const porCliente = new Map<string, any[]>();
    for (const l of linhas) {
      const lista = porCliente.get(l.cliente) ?? [];
      porCliente.set(l.cliente, lista);
      const ativo = !l.revogadoEm;
      if (!ativo && lista.filter((x) => !x.ativo).length >= REVOGADOS_NA_TELA) continue;
      lista.push({
        id: l.id,
        ativo,
        lojaId: l.lojaId ?? null,
        lojaNome: l.lojaNome ?? null,
        escopos: l.escopos ?? [],
        autorizadoPor: l.autorizadoPor,
        via: l.via === 'autorizacao_loja' ? 'loja' : 'distribuicao',
        criadoEm: l.criadoEm,
        ultimoUsoEm: l.ultimoUsoEm ?? null,
        revogadoEm: l.revogadoEm ?? null,
        revogadoPor: this.porQuem(l.revogado_por ?? null),
      });
    }
    return {
      aplicativos: [...porCliente.entries()].map(([cliente, acessos]) => ({
        cliente,
        rotulo: CLIENTES_INTEGRACAO[cliente]?.rotulo ?? cliente,
        descricao: DESCRICAO_CLIENTE[cliente] ?? null,
        abrangencia: CLIENTES_INTEGRACAO[cliente]?.abrangencia ?? 'loja',
        ativos: acessos.filter((a) => a.ativo).length,
        acessos,
      })),
    };
  }

  private async auditarRevogacao(user: AuthUser, t: any) {
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      unidadeId: t.unidade_id ?? null,
      atorId: UUID.test(String(user.colaboradorId)) ? user.colaboradorId : undefined,
      atorPerfil: user.categoria,
      tipo: 'integracao',
      acao: 'integracao.token_revogado',
      origem: 'web',
      entidadeTipo: 'integracao_token',
      entidadeId: t.id,
      detalhe: { cliente: t.cliente, prefixo: t.prefixo, por: 'loja', quem: user.nome ?? null },
    });
  }

  /** `POST /aplicativos-conectados/:id/revogar`: o presidente desliga um acesso. Idempotente. */
  async revogar(user: AuthUser, id: unknown) {
    if (typeof id !== 'string' || !UUID.test(id)) throw new BadRequestException('Acesso inválido.');
    const [feito] = await this.rows(sql`
      update integracao_token_loja
         set revogado_em = now(), revogado_por = ${`loja:${user.nome ?? 'presidente'}`},
             motivo_revogacao = 'revogado pela loja em Aplicativos conectados'
       where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid and revogado_em is null
       returning id, unidade_id, cliente, prefixo, revogado_em`);
    if (!feito) {
      const [ja] = await this.rows(sql`
        select revogado_em from integracao_token_loja where id = ${id}::uuid and tenant_id = ${user.tenantId}::uuid`);
      if (!ja) throw new NotFoundException('Acesso não encontrado.');
      return { ok: true, jaRevogado: true, revogadoEm: ja.revogado_em };
    }
    await this.auditarRevogacao(user, feito);
    return { ok: true, jaRevogado: false, revogadoEm: feito.revogado_em };
  }

  /** `POST /aplicativos-conectados/revogar-todos`: desliga todos os acessos de um aplicativo. */
  async revogarTodos(user: AuthUser, cliente: unknown) {
    if (!ehClienteIntegracao(cliente)) throw new BadRequestException('Aplicativo desconhecido.');
    const feitos = await this.rows(sql`
      update integracao_token_loja
         set revogado_em = now(), revogado_por = ${`loja:${user.nome ?? 'presidente'}`},
             motivo_revogacao = 'revogado pela loja em Aplicativos conectados'
       where tenant_id = ${user.tenantId}::uuid and cliente = ${cliente} and revogado_em is null
       returning id, unidade_id, cliente, prefixo`);
    for (const t of feitos) await this.auditarRevogacao(user, t);
    return { ok: true, revogados: feitos.length };
  }
}
