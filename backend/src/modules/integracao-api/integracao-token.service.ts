import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { perfilPadrao, podeAcessar, type Permissoes } from '../../auth/permissoes';
import {
  CLIENTES_INTEGRACAO,
  EscopoIntegracao,
  ROTULO_ESCOPO,
  ESCOPOS_INTEGRACAO,
  ehClienteIntegracao,
  validarEscopos,
} from './escopos';
import { gerarTokenIntegracao, hashTokenIntegracao } from './token-integracao';
import {
  marcarUsoLigacaoIntegracao,
  marcarUsoTokenIntegracao,
  validarLigacaoIntegracao,
  validarTokenIntegracao,
  type DoParceiro,
  type LimiteContado,
} from './validar-token-integracao';
import type { AplicativoAprovado } from '../../dms/integracao-dms';
import type { IntegracaoCtxData } from './integracao-token.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quem autorizou, como o sistema o vê hoje: nível e "ver valores em R$" do perfil. */
export type Autorizador = { id: string; nome: string; presidente: boolean; verFinanceiro: boolean };

/**
 * Token de integração POR LOJA (trilha C, C1a — mig 295, só nuvem). Emissão e revogação pelo
 * console da distribuição; validação a cada chamada da API de integração; a própria integração
 * pode revogar o dela. O token em claro só existe na resposta da emissão.
 */
@Injectable()
export class IntegracaoTokenService {
  private readonly log = new Logger('IntegracaoToken');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async rows(q: SQL): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return r.rows ?? r;
  }

  // ───────────────────────────── API de integração ─────────────────────────────

  /**
   * O token (já com o formato conferido) vale? A regra mora em `validar-token-integracao.ts`, a
   * mesma do guard das rotas do totem (GoGeM, mig 323), que roda também em módulos da loja. Com
   * `contar`, a chamada já entra no limite por minuto do banco (mig 333), na mesma ida.
   */
  async validar(token: string, o: { contar?: boolean } = {}): Promise<(IntegracaoCtxData & { limite?: LimiteContado }) | null> {
    return validarTokenIntegracao(this.db, token, o);
  }

  /** Grava o último uso (no máximo 1×/min por token). Nunca rejeita (V3): não derruba a chamada. */
  marcarUso(tokenId: string, ip: string | null): void {
    marcarUsoTokenIntegracao(this.db, tokenId, ip);
  }

  /**
   * A ligação do Hub DMS (F3, mig 329) vale para o aplicativo do token do DMS ID? A regra mora em
   * `validar-token-integracao.ts`, junto da do token: a ligação lê o token de onde veio.
   */
  async validarLigacao(
    segredo: string,
    doToken: { aplicativo: string; permissoes: readonly string[] },
    aplicativos: Readonly<Record<string, string>>,
    o: { contar?: boolean; parceiro?: (clientId: string) => AplicativoAprovado | null } = {},
  ): Promise<(IntegracaoCtxData & { limite?: LimiteContado; parceiro?: DoParceiro }) | null> {
    return validarLigacaoIntegracao(this.db, segredo, doToken, aplicativos, o);
  }

  /** O último uso pela ligação (na ligação e no token), no máximo 1×/min. Nunca rejeita (V3). */
  marcarUsoLigacao(ligacaoId: string, ip: string | null): void {
    marcarUsoLigacaoIntegracao(this.db, ligacaoId, ip);
  }

  /**
   * `GET /integracao/loja`: quem é a loja do token. `cardapio_url` = o endereço público do
   * cardápio online que vende PARA esta loja: o cardápio ativo da própria loja; na falta, o da
   * rede (sem loja) quando os pedidos dele caem nesta loja — a matriz (ou a mais antiga), a
   * mesma regra do `unidadePadrao` do delivery. Sem cardápio ativo, `null`.
   */
  async dadosDaLoja(ctx: IntegracaoCtxData) {
    if (!ctx.unidadeId) return this.dadosDaEmpresa(ctx);
    const [l] = await this.rows(sql`
      select u.id, u.nome, u.timezone, e.nome as empresa
        from unidade u join empresa e on e.id = u.tenant_id
       where u.id = ${ctx.unidadeId} and u.tenant_id = ${ctx.tenantId}`);
    if (!l) throw new NotFoundException('Loja não encontrada.');
    const [cfg] = await this.rows(sql`
      select c.token
        from cardapio_config c
       where c.tenant_id = ${ctx.tenantId} and c.ativo = true
         and (c.unidade_id = ${ctx.unidadeId}
              or (c.unidade_id is null
                  and ${ctx.unidadeId}::uuid = (
                    select u.id from unidade u
                     where u.tenant_id = ${ctx.tenantId} and u.deleted_at is null
                     order by (u.tipo = 'matriz') desc, u.created_at asc
                     limit 1)))
       order by (c.unidade_id is null) asc, c.created_at asc
       limit 1`);
    const base = (process.env.CARDAPIO_PUBLIC_URL || process.env.APP_URL || 'https://app.dmsregem.com').replace(
      /\/+$/,
      '',
    );
    return {
      loja_id: l.id as string,
      loja_nome: l.nome as string,
      empresa_nome: l.empresa as string,
      fuso: (l.timezone as string) || 'America/Sao_Paulo',
      moeda: 'BRL',
      escopos: ctx.escopos,
      cardapio_url: cfg?.token ? `${base}/c/${cfg.token}` : null,
    };
  }

  /**
   * `GET /integracao/loja` com token da EMPRESA (RegemCast): a empresa e as lojas vivas dela.
   * `empresa_id` é a identidade ESTÁVEL da conexão do lado de lá (renomear a empresa não pode
   * parecer "outra empresa"). O fuso é o da matriz (ou da loja mais antiga).
   */
  private async dadosDaEmpresa(ctx: IntegracaoCtxData) {
    const [e] = await this.rows(sql`
      select e.id, e.nome from empresa e where e.id = ${ctx.tenantId} and e.deleted_at is null`);
    if (!e) throw new NotFoundException('Empresa não encontrada.');
    const lojas = await this.rows(sql`
      select u.id, u.nome, u.timezone
        from unidade u
       where u.tenant_id = ${ctx.tenantId} and u.deleted_at is null
       order by (u.tipo = 'matriz') desc, u.created_at asc`);
    return {
      empresa_id: e.id as string,
      empresa_nome: e.nome as string,
      lojas: lojas.map((u) => ({ id: u.id as string, nome: u.nome as string })),
      fuso: (lojas[0]?.timezone as string) || 'America/Sao_Paulo',
      moeda: 'BRL',
      escopos: ctx.escopos,
    };
  }

  /** `POST /integracao/autorizacao/revogar`: a integração desliga o próprio token. */
  async revogarPelaIntegracao(ctx: IntegracaoCtxData) {
    const feito = await this.rows(sql`
      update integracao_token_loja
         set revogado_em = now(), revogado_por = ${`integracao:${ctx.cliente}`},
             motivo_revogacao = 'revogado pela própria integração'
       where id = ${ctx.tokenId} and revogado_em is null
       returning revogado_em`);
    if (feito.length) {
      await this.auditoria.registrar({
        tenantId: ctx.tenantId,
        unidadeId: ctx.unidadeId,
        atorTipo: 'integracao',
        tipo: 'integracao',
        acao: 'integracao.token_revogado',
        origem: 'integracao',
        entidadeTipo: 'integracao_token',
        entidadeId: ctx.tokenId,
        detalhe: { cliente: ctx.cliente, prefixo: ctx.prefixo, por: 'integracao' },
      });
    }
    const [atual] = await this.rows(sql`
      select revogado_em from integracao_token_loja where id = ${ctx.tokenId}`);
    return { revogado: true, revogado_em: atual?.revogado_em ?? null };
  }

  // ───────────────────────────── Console da distribuição ─────────────────────────────

  /**
   * Pessoas ativas da empresa com o nível e o "ver valores em R$" de HOJE — a mesma regra do
   * login e do `JwtAuthGuard`: nível = perfil ?? função; permissões = perfil ?? padrão do nível.
   */
  private async pessoas(tenantId: string, filtro: SQL): Promise<Autorizador[]> {
    const linhas = await this.rows(sql`
      select c.id, c.nome, coalesce(pa.nivel::text, f.categoria::text, 'execucao') as nivel,
             pa.permissoes
        from colaborador c
        left join funcao f on f.id = c.funcao_id
        left join perfil_acesso pa on pa.id = c.perfil_acesso_id
       where c.tenant_id = ${tenantId} and c.deleted_at is null and c.status <> 'bloqueado'
         and ${filtro}
       order by c.nome`);
    return linhas.map((c) => {
      const perm = (c.permissoes ?? perfilPadrao(c.nivel).permissoes) as Permissoes;
      return {
        id: c.id,
        nome: c.nome,
        presidente: c.nivel === 'presidente',
        verFinanceiro: podeAcessar(perm, 'ver_financeiro'),
      };
    });
  }

  /** Quem autoriza, lido do cadastro: presidente e "ver valores em R$" pelo perfil de hoje. */
  async autorizador(tenantId: string, colaboradorId: string): Promise<Autorizador | null> {
    const [a] = await this.pessoas(tenantId, sql`c.id = ${colaboradorId}`);
    return a ?? null;
  }

  /** Aba Integrações → Tokens: lojas e presidentes da empresa (para emitir) e os tokens dela. */
  async painelEmpresa(tenantId: unknown) {
    const t = this.uuid(tenantId, 'tenantId');
    const [emp] = await this.rows(sql`select id, nome from empresa where id = ${t} and deleted_at is null`);
    if (!emp) throw new NotFoundException('Empresa não encontrada.');
    const lojas = await this.rows(sql`
      select id, nome, tipo from unidade where tenant_id = ${t} and deleted_at is null order by nome`);
    const presidentes = await this.pessoas(
      t,
      sql`coalesce(pa.nivel::text, f.categoria::text, 'execucao') = 'presidente'`,
    );
    const tokens = await this.rows(sql`
      select t.id, t.unidade_id as "lojaId", u.nome as "lojaNome", t.cliente, t.prefixo, t.escopos,
             t.autorizado_por_nome as "autorizadoPor", t.autorizado_via as "autorizadoVia",
             t.evidencia, t.criado_em as "criadoEm", t.ultimo_uso_em as "ultimoUsoEm",
             t.ultimo_ip as "ultimoIp", t.revogado_em as "revogadoEm", t.revogado_por as "revogadoPor",
             t.motivo_revogacao as "motivoRevogacao"
        from integracao_token_loja t
        left join unidade u on u.id = t.unidade_id
       where t.tenant_id = ${t}
       order by (t.revogado_em is null) desc, t.criado_em desc
       limit 200`);
    return {
      empresa: { id: emp.id, nome: emp.nome },
      lojas,
      presidentes,
      tokens,
      escopos: ESCOPOS_INTEGRACAO.map((e) => ({ chave: e, rotulo: ROTULO_ESCOPO[e] })),
      // Para quem se emite: o console mostra só os escopos que valem para o cliente escolhido e,
      // no de empresa (RegemCast), não pede loja.
      clientes: Object.entries(CLIENTES_INTEGRACAO).map(([chave, c]) => ({
        chave,
        rotulo: c.rotulo,
        abrangencia: c.abrangencia,
        escopos: [...c.escopos],
      })),
    };
  }

  /**
   * Emite um token (console da distribuição, piloto). Confere empresa, loja DA empresa,
   * escopos, presidente da empresa (e "ver valores em R$" para `custos.ler`) e a evidência da
   * autorização. Devolve o token em claro UMA vez — o banco guarda só o hash.
   */
  async emitir(dto: any, autor: { sub: string; nome?: string; perfil?: string }) {
    const tenantId = this.uuid(dto?.tenantId, 'tenantId');
    const cliente = String(dto?.cliente ?? 'liame');
    if (!ehClienteIntegracao(cliente)) {
      throw new BadRequestException(`Cliente de integração desconhecido: ${cliente}.`);
    }
    const cfg = CLIENTES_INTEGRACAO[cliente];
    // Liame: token de UMA loja. RegemCast: da empresa inteira (sem loja — trava da mig 302).
    const unidadeId = cfg.abrangencia === 'loja' ? this.uuid(dto?.unidadeId, 'unidadeId') : null;
    if (cfg.abrangencia === 'empresa' && dto?.unidadeId) {
      throw new BadRequestException(`O token do ${cfg.rotulo} vale para a empresa inteira: não escolha loja.`);
    }
    const autorizadoPor = this.uuid(dto?.autorizadoPor, 'autorizadoPor');
    const escopos = validarEscopos(dto?.escopos);
    const foraDoCliente = escopos.filter((e) => !cfg.escopos.includes(e));
    if (foraDoCliente.length) {
      throw new BadRequestException(`Escopo que não vale para o ${cfg.rotulo}: ${foraDoCliente.join(', ')}.`);
    }
    const evidencia = typeof dto?.evidencia === 'string' ? dto.evidencia.trim() : '';
    if (evidencia.length < 5 || evidencia.length > 500) {
      throw new BadRequestException(
        'Descreva a autorização do presidente (ex.: "autorização por escrito em 29/09/2026"), até 500 caracteres.',
      );
    }

    let loja: { id: string; nome: string } | null = null;
    if (unidadeId) {
      [loja] = await this.rows(sql`
        select u.id, u.nome from unidade u join empresa e on e.id = u.tenant_id
         where u.id = ${unidadeId} and u.tenant_id = ${tenantId}
           and u.deleted_at is null and e.deleted_at is null`);
      if (!loja) throw new BadRequestException('Loja não encontrada nesta empresa.');
    } else {
      const [emp] = await this.rows(sql`select id from empresa where id = ${tenantId} and deleted_at is null`);
      if (!emp) throw new BadRequestException('Empresa não encontrada.');
    }
    const quem = await this.autorizador(tenantId, autorizadoPor);
    if (!quem?.presidente) {
      throw new BadRequestException('Quem autoriza tem de ser presidente ativo desta empresa.');
    }
    if (escopos.includes('custos.ler') && !quem.verFinanceiro) {
      throw new BadRequestException(
        `O escopo custos.ler exige que ${quem.nome} tenha "Ver valores em R$" no perfil.`,
      );
    }

    const gerado = gerarTokenIntegracao();
    const [novo] = await this.rows(sql`
      insert into integracao_token_loja
        (tenant_id, unidade_id, cliente, prefixo, token_hash, escopos, autorizado_por,
         autorizado_por_nome, autorizado_via, emitido_por_dist, evidencia)
      values (${tenantId}, ${unidadeId}, ${cliente}, ${gerado.prefixo}, ${gerado.hash},
              ${`{${escopos.join(',')}}`}::text[], ${quem.id}, ${quem.nome}, 'console_distribuicao',
              ${this.uuidOuNulo(autor?.sub)}, ${evidencia})
      returning id, criado_em`);

    // Na trilha da EMPRESA (a loja vê no log dela quem ligou a integração); nunca o token.
    await this.auditoria.registrar({
      tenantId,
      unidadeId,
      atorId: this.uuidOuNulo(autor?.sub),
      atorPerfil: autor?.perfil ?? null,
      atorTipo: 'distribuicao',
      tipo: 'integracao',
      acao: 'integracao.token_emitido',
      origem: 'distribuicao',
      entidadeTipo: 'integracao_token',
      entidadeId: novo.id,
      detalhe: {
        cliente,
        prefixo: gerado.prefixo,
        escopos,
        loja: loja?.nome ?? 'Empresa inteira',
        autorizadoPor: quem.nome,
        evidencia,
        emitidoPor: autor?.nome ?? null,
      },
    });

    return {
      id: novo.id as string,
      token: gerado.token,
      prefixo: gerado.prefixo,
      cliente,
      escopos,
      loja: loja ? { id: loja.id, nome: loja.nome } : null,
      autorizadoPor: quem.nome,
      criadoEm: novo.criado_em,
    };
  }

  /** Revoga pelo console. Idempotente: já revogado devolve `jaRevogado`. */
  async revogarPeloConsole(id: unknown, motivo: unknown, autor: { sub: string; nome?: string; perfil?: string }) {
    const tokenId = this.uuid(id, 'id');
    const texto = typeof motivo === 'string' ? motivo.trim() : '';
    if (texto.length < 3 || texto.length > 300) {
      throw new BadRequestException('Informe o motivo da revogação (até 300 caracteres).');
    }
    const [feito] = await this.rows(sql`
      update integracao_token_loja
         set revogado_em = now(), revogado_por = ${`distribuicao:${autor?.nome ?? autor?.sub ?? '?'}`},
             motivo_revogacao = ${texto}
       where id = ${tokenId} and revogado_em is null
       returning tenant_id, unidade_id, cliente, prefixo, revogado_em`);
    if (!feito) {
      const [ja] = await this.rows(sql`
        select revogado_em from integracao_token_loja where id = ${tokenId}`);
      if (!ja) throw new NotFoundException('Token não encontrado.');
      return { ok: true, jaRevogado: true, revogadoEm: ja.revogado_em };
    }
    await this.auditoria.registrar({
      tenantId: feito.tenant_id,
      unidadeId: feito.unidade_id,
      atorId: this.uuidOuNulo(autor?.sub),
      atorPerfil: autor?.perfil ?? null,
      atorTipo: 'distribuicao',
      tipo: 'integracao',
      acao: 'integracao.token_revogado',
      origem: 'distribuicao',
      entidadeTipo: 'integracao_token',
      entidadeId: tokenId,
      detalhe: { cliente: feito.cliente, prefixo: feito.prefixo, motivo: texto, por: autor?.nome ?? null },
    });
    return {
      ok: true,
      jaRevogado: false,
      revogadoEm: feito.revogado_em,
      tenantId: feito.tenant_id as string,
      prefixo: feito.prefixo as string,
    };
  }

  private uuid(v: unknown, campo: string): string {
    if (typeof v !== 'string' || !UUID.test(v)) throw new BadRequestException(`Informe "${campo}" (uuid).`);
    return v;
  }

  private uuidOuNulo(v: unknown): string | null {
    return typeof v === 'string' && UUID.test(v) ? v : null;
  }
}
