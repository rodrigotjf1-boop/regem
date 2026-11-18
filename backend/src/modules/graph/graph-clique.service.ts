import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthUser } from '../../auth/auth-user';
import { ClienteDmsId } from '../../dms/integracao-dms';
import { chaveSegredosDisponivel, cifrar, decifrar } from '../../common/cifra-segredo';
import { ehServidorLocal } from '../../common/modo';
import { hojeISO } from '../../common/data';
import { cnpjValido } from '../../common/validadores-br';
import {
  VALIDADE_DO_PEDIDO_MS,
  estadoValido,
  lerVolta,
  novoPedido,
  paginaDeAutorizacao,
  problemaDoCorpo,
  resumoDoEstado,
} from '../../common/clique-dms';
import {
  FRASE_DA_PERMISSAO,
  PERMISSAO_DO_GRAPH,
  PERMISSOES_DO_GRAPH,
  type ConfigGraph,
  codigoValido,
  fraseDaVolta,
  graphLigadoNoAmbiente,
  lerConfigGraph,
  numeroValido,
  paginaPadraoDoGraph,
  segredoValido,
  voltaDoGraph,
} from './graph.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

const NAO_LIGADO = 'O DMS Graph não está ligado no Regem agora.';

/** O que o cartão "DMS Graph" mostra (as telas esperam a aprovação do protótipo; este é o contrato delas). */
export type SituacaoDoGraph = {
  /** A distribuição ligou o DMS Graph neste Regem (`GRAPH_LIGADO`). Falso: o cartão diz que não está disponível. */
  ligado: boolean;
  /** A credencial do Regem no DMS ID e a chave dos segredos estão prontas (sem isso, "avise o suporte"). */
  pronto: boolean;
  /** No servidor da loja a ligação não se faz (V37): a tela manda abrir o Regem na nuvem. */
  naNuvem: boolean;
  /** Quem vê pode ligar e desligar? Só o presidente (GR-2). */
  podeLigar: boolean;
  ligacao: null | {
    contaNome: string | null;
    desde: string;
    por: string | null;
    permissoes: string[];
    /** A última foto lida pelo Graph. */
    ultimoUso: string | null;
    /** A última tentativa: `lida` ou o motivo curto (franquia-esgotada, demora, recusada:<código>, integracao-parada…). */
    ultimaLeitura: { em: string; resultado: string } | null;
    /** O último número da franquia que veio (GR-5); `doMesAtual` falso = é de um mês que já passou. */
    franquia: { mes: string; usados: number; total: number; em: string; doMesAtual: boolean } | null;
  };
  /** A ligação foi desfeita do lado do Graph (GR-6): quando. A tela avisa e oferece ligar de novo. */
  desligadaPeloGraphEm: string | null;
  permissoes: Array<{ id: string; frase: string; necessaria: boolean }>;
};

/**
 * O CLIQUE REGEM → DMS GRAPH (G5a; mig 450) — o MESMO contrato do clique do Orzuni (mig 416), com a ligação por EMPRESA
 * (G-3): o Regem empurra o pedido ao Graph (`POST /v1/dms-id/autorizacao/pedido`, RFC 9126 + PKCE, com o token do DMS ID
 * do aplicativo do Regem, o `conta_empresa_id` = a empresa e o CNPJ dela, obrigatório), o presidente autoriza na página do
 * Graph, e na volta o Regem troca o código pelo segredo da ligação (`/token`), guardado CIFRADO. Desligar avisa o Graph
 * (`DELETE /v1/dms-id/ligacao`). Só o presidente liga e desliga (GR-2, no servidor). Só pede `arquivos.analisar` (GR-3).
 * Tudo atrás de `GRAPH_LIGADO`: desligada, as rotas dizem que não está ligado e a foto segue como hoje.
 */
@Injectable()
export class GraphCliqueService {
  private readonly log = new Logger('GraphClique');
  /** O fetch do DMS ID e do Graph — os testes trocam por um falso. */
  buscar: typeof fetch = fetch;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async rows(q: any, executor: any = this.db): Promise<any[]> {
    const r: any = await executor.execute(q);
    return (r.rows ?? r) as any[];
  }

  private config(): ConfigGraph {
    const cfg = lerConfigGraph();
    if (!graphLigadoNoAmbiente()) throw new ConflictException(NAO_LIGADO);
    if (!cfg.credencialOk) {
      this.log.warn(`clique: a configuração do DMS Graph não está pronta: ${cfg.motivo}`);
      throw new ConflictException('A ligação do Regem com o DMS Graph não está pronta nesta nuvem. Avise o suporte.');
    }
    if (!chaveSegredosDisponivel()) throw new ConflictException('Falta a chave dos segredos nesta nuvem. Avise o suporte.');
    return cfg;
  }

  private async tokenDoDmsId(cfg: ConfigGraph): Promise<string> {
    try {
      const dmsId = new ClienteDmsId({ emissor: cfg.emissor, aplicativo: cfg.aplicativo, segredo: cfg.segredo, buscar: this.buscar });
      return await dmsId.token(cfg.recurso, PERMISSOES_DO_GRAPH);
    } catch (e: any) {
      this.log.warn(`clique: o DMS ID não deu o token (${e?.message ?? e})`);
      throw new BadGatewayException('O DMS ID não entregou o token do Regem agora. Tente de novo em instantes.');
    }
  }

  /**
   * Uma chamada ao Graph com o token do DMS ID. Só ao endereço da configuração (da distribuição, conferido em
   * `lerConfigGraph`) e nunca segue redirecionamento: o token não vai a outro endereço (V68).
   */
  private async chamarOGraph(cfg: ConfigGraph, caminho: string, corpo: unknown, cabecalhos: Record<string, string> = {}, metodo = 'POST') {
    const token = await this.tokenDoDmsId(cfg);
    let r: Response;
    try {
      r = await this.buscar(new URL(caminho, cfg.origem).href, {
        method: metodo,
        redirect: 'manual',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json', ...cabecalhos },
        body: metodo === 'DELETE' ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e: any) {
      this.log.warn(`clique: sem resposta do DMS Graph em ${caminho} (${e?.cause?.code ?? e?.message ?? e})`);
      throw new BadGatewayException('O DMS Graph não respondeu agora. Tente de novo em instantes.');
    }
    const lido: any = await r.json().catch(() => null);
    return { status: r.status, corpo: lido };
  }

  private async ligacaoViva(tenantId: string, executor: any = this.db) {
    const [l] = await this.rows(
      sql`
      select id, prefixo, segredo_cifrado, conta_graph_nome, permissoes, criada_em, criada_por, ultimo_uso_em,
             ultima_leitura_em, ultima_leitura_resultado, franquia_mes, franquia_usados, franquia_total, franquia_em
        from graph_ligacao where tenant_id = ${tenantId}::uuid and revogada_em is null`,
      executor,
    );
    return l ?? null;
  }

  /** `GET /graph/clique/situacao`: o que o cartão mostra. Desligado (`GRAPH_LIGADO`): só `ligado: false`. */
  async situacao(user: AuthUser): Promise<SituacaoDoGraph> {
    const cfg = lerConfigGraph();
    const base: SituacaoDoGraph = {
      ligado: graphLigadoNoAmbiente(),
      pronto: cfg.credencialOk && chaveSegredosDisponivel(),
      naNuvem: !ehServidorLocal(),
      podeLigar: user.categoria === 'presidente',
      ligacao: null,
      desligadaPeloGraphEm: null,
      permissoes: [{ id: PERMISSAO_DO_GRAPH, frase: FRASE_DA_PERMISSAO, necessaria: true }],
    };
    if (!base.ligado || ehServidorLocal()) return base;
    const l = await this.ligacaoViva(user.tenantId);
    if (!l) {
      // A última ligação desta empresa, se foi o Graph que a desfez: o cartão avisa e oferece ligar de novo.
      const [u] = await this.rows(sql`
        select revogada_em, revogada_origem from graph_ligacao
         where tenant_id = ${user.tenantId}::uuid order by revogada_em desc nulls last limit 1`);
      const desligadaPeloGraphEm = u?.revogada_em && u.revogada_origem === 'graph' ? new Date(u.revogada_em).toISOString() : null;
      return { ...base, desligadaPeloGraphEm };
    }
    const iso = (v: any) => (v ? new Date(v).toISOString() : null);
    const temFranquia = l.franquia_mes && l.franquia_usados !== null && l.franquia_total !== null;
    return {
      ...base,
      ligacao: {
        contaNome: l.conta_graph_nome ?? null,
        desde: new Date(l.criada_em).toISOString(),
        por: l.criada_por ?? null,
        permissoes: Array.isArray(l.permissoes) ? l.permissoes.map(String) : [],
        ultimoUso: iso(l.ultimo_uso_em),
        ultimaLeitura: l.ultima_leitura_em ? { em: new Date(l.ultima_leitura_em).toISOString(), resultado: String(l.ultima_leitura_resultado ?? '') } : null,
        franquia: temFranquia
          ? {
              mes: String(l.franquia_mes),
              usados: Number(l.franquia_usados),
              total: Number(l.franquia_total),
              em: new Date(l.franquia_em).toISOString(),
              doMesAtual: String(l.franquia_mes) === hojeISO().slice(0, 7),
            }
          : null,
      },
    };
  }

  /**
   * `POST /graph/clique/iniciar`: empurra o pedido ao Graph e devolve o endereço da página. Toda recusa vem ANTES de
   * gravar. Já ligada: ligar de novo gira o segredo lá (a anterior sai na volta).
   */
  async iniciar(user: AuthUser): Promise<{ url: string }> {
    if (ehServidorLocal()) throw new BadRequestException('A ligação com o DMS Graph se faz no Regem na nuvem (app.dmsregem.com), não no servidor da loja.');
    const cfg = this.config();
    const [emp] = await this.rows(sql`select nome, cnpj from empresa where id = ${user.tenantId}::uuid and deleted_at is null`);
    if (!emp) throw new BadRequestException('Empresa não encontrada.');
    const cnpj = String(emp.cnpj ?? '').replace(/\D/g, '');
    if (!cnpjValido(cnpj)) {
      throw new BadRequestException('Cadastre o CNPJ da empresa antes de ligar: a conta da empresa no DMS Graph nasce e é achada por ele.');
    }
    const [quem] = await this.rows(sql`select nome, email from colaborador where id = ${user.colaboradorId}::uuid and tenant_id = ${user.tenantId}::uuid`);
    const email = String(quem?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Cadastre o seu e-mail no seu perfil antes de ligar: o DMS Graph mostra ao dono quem pediu.');
    }

    const p = novoPedido();
    const corpo = {
      response_type: 'code',
      client_id: cfg.aplicativo,
      redirect_uri: voltaDoGraph(),
      scope: PERMISSAO_DO_GRAPH,
      state: p.estado,
      code_challenge: p.desafio,
      code_challenge_method: 'S256',
      conta_nome: String(emp.nome ?? 'Empresa').trim().slice(0, 120) || 'Empresa',
      conta_cnpj: cnpj,
      conta_email: email,
      // A ligação do Graph é por EMPRESA (G-3): é por este id que a mesma empresa não fica ligada a duas contas lá.
      conta_empresa_id: user.tenantId,
    };
    const r = await this.chamarOGraph(cfg, '/v1/dms-id/autorizacao/pedido', corpo);
    if (r.status < 200 || r.status >= 300 || !numeroValido(r.corpo?.request_uri)) {
      const problema = problemaDoCorpo(r.corpo, r.status);
      this.log.warn(`clique: o DMS Graph recusou o pedido: ${r.status} ${problema} ${String(r.corpo?.detail ?? '').slice(0, 200)}`);
      throw new BadGatewayException(
        problema === 'integracao-parada'
          ? 'O DMS Graph pausou novas ligações por enquanto. Tente de novo mais tarde.'
          : 'O DMS Graph não aceitou o pedido agora. Tente de novo em alguns minutos; se continuar, avise o suporte.',
      );
    }
    const vale = Math.min(Number(r.corpo?.expires_in) || 600, VALIDADE_DO_PEDIDO_MS / 1000);
    // Pedidos mortos há mais de um dia saem aqui (não há rotina para isso); nunca derruba o pedido novo.
    await this.db
      .execute(sql`delete from graph_clique_pedido where vence_em < now() - interval '1 day'`)
      .catch((e: any) => this.log.warn(`clique: limpeza dos pedidos vencidos falhou: ${e?.message ?? e}`));
    await this.db.execute(sql`
      insert into graph_clique_pedido (tenant_id, colaborador_id, estado_hash, verificador_cifrado, permissoes, vence_em)
      values (${user.tenantId}::uuid, ${user.colaboradorId}::uuid, ${resumoDoEstado(p.estado)}, ${cifrar(p.verificador)},
              ${JSON.stringify(PERMISSOES_DO_GRAPH)}::jsonb, now() + make_interval(secs => ${vale}))`);
    return { url: paginaDeAutorizacao(r.corpo?.authorization_endpoint, paginaPadraoDoGraph(cfg), cfg.aplicativo, String(r.corpo.request_uri)) };
  }

  /**
   * `POST /graph/clique/concluir`: a volta do Graph. O pedido é GASTO primeiro (uma volta só leva); a volta só vale para
   * quem começou (o state preso à sessão, Padrão §3) e só com o `iss` do Graph (RFC 9207). Troca o código pela ligação e
   * grava — a viva de antes desta empresa, se houver, sai na mesma transação (o Graph girou o segredo).
   */
  async concluir(user: AuthUser, q: unknown): Promise<{ ligada: true; contaNome: string | null; permissoes: string[] } | { ligada: false; mensagem: string }> {
    if (ehServidorLocal()) return { ligada: false, mensagem: fraseDaVolta('erro') };
    if (!graphLigadoNoAmbiente()) return { ligada: false, mensagem: fraseDaVolta('desligado') };
    const v = lerVolta(q);
    if (!estadoValido(v.state)) return { ligada: false, mensagem: fraseDaVolta('outra_sessao') };
    const [p] = await this.rows(sql`
      update graph_clique_pedido set concluido_em = now()
       where estado_hash = ${resumoDoEstado(v.state)} and tenant_id = ${user.tenantId}::uuid and colaborador_id = ${user.colaboradorId}::uuid
         and concluido_em is null
      returning id, verificador_cifrado, vence_em`);
    if (!p) return { ligada: false, mensagem: fraseDaVolta('outra_sessao') };
    const fim = (resultado: string) => this.db.execute(sql`update graph_clique_pedido set resultado = ${resultado} where id = ${p.id}`).catch(() => {});

    if (v.error) {
      await fim(v.error === 'access_denied' ? 'recusado' : 'vencido');
      return { ligada: false, mensagem: fraseDaVolta(v.error === 'access_denied' ? 'access_denied' : 'invalid_request_uri') };
    }
    if (new Date(p.vence_em).getTime() < Date.now()) {
      await fim('vencido');
      return { ligada: false, mensagem: fraseDaVolta('vencido') };
    }
    let cfg: ConfigGraph;
    try {
      cfg = this.config();
    } catch {
      await fim('erro');
      return { ligada: false, mensagem: fraseDaVolta('erro') };
    }
    if (v.iss !== cfg.origem) {
      await fim('erro');
      this.log.warn(`clique: a volta trouxe o iss "${String(v.iss).slice(0, 80)}", não o do DMS Graph`);
      return { ligada: false, mensagem: fraseDaVolta('emissor') };
    }
    if (!codigoValido(v.code)) {
      await fim('erro');
      return { ligada: false, mensagem: fraseDaVolta('erro') };
    }

    let r: { status: number; corpo: any };
    try {
      r = await this.chamarOGraph(cfg, '/v1/dms-id/autorizacao/token', {
        grant_type: 'authorization_code',
        client_id: cfg.aplicativo,
        code: v.code,
        redirect_uri: voltaDoGraph(),
        code_verifier: decifrar(p.verificador_cifrado),
      });
    } catch {
      await fim('erro');
      return { ligada: false, mensagem: fraseDaVolta('erro') };
    }
    const ligacao = String(r.corpo?.ligacao ?? '');
    if (r.status !== 200 || !segredoValido(ligacao)) {
      await fim('erro');
      this.log.warn(`clique: a troca do código foi recusada pelo DMS Graph: ${r.status} ${problemaDoCorpo(r.corpo, r.status)}`);
      return { ligada: false, mensagem: fraseDaVolta('erro') };
    }
    const permissoes = Array.isArray(r.corpo?.permissoes) ? (r.corpo.permissoes as unknown[]).map(String).slice(0, 20) : [];
    const contaNome = r.corpo?.conta_nome ? String(r.corpo.conta_nome).slice(0, 200) : null;
    const quem = String(user.nome ?? '').trim() || 'presidente';
    const anterior = await this.db.transaction(async (tx: any) => {
      // Duas voltas da mesma empresa ao mesmo tempo: uma de cada vez (a ligação viva é uma só — índice único). A trava é
      // na linha da empresa, no modo que não segura as gravações das outras tabelas dela (a chave estrangeira).
      await tx.execute(sql`select 1 from empresa where id = ${user.tenantId}::uuid for no key update`);
      const [ant] = await this.rows(sql`select prefixo from graph_ligacao where tenant_id = ${user.tenantId}::uuid and revogada_em is null`, tx);
      // Ligar de novo GIRA o segredo no Graph: a anterior já não vale lá — sai aqui também, na mesma transação.
      await tx.execute(sql`
        update graph_ligacao set revogada_em = clock_timestamp(), revogada_origem = 'troca', revogada_por = ${quem},
                                 revogada_por_id = ${user.colaboradorId}::uuid, revogada_motivo = 'trocada por uma nova autorização por clique'
         where tenant_id = ${user.tenantId}::uuid and revogada_em is null`);
      await tx.execute(sql`
        insert into graph_ligacao (tenant_id, segredo_cifrado, prefixo, conta_graph, conta_graph_nome, permissoes, criada_por, criada_por_id, segredo_em)
        values (${user.tenantId}::uuid, ${cifrar(ligacao)}, ${String(r.corpo?.prefixo ?? '').slice(0, 40) || ligacao.slice(0, 18)},
                ${r.corpo?.conta_id ? String(r.corpo.conta_id).slice(0, 100) : null}, ${contaNome}, ${JSON.stringify(permissoes)}::jsonb,
                ${quem}, ${user.colaboradorId}::uuid,
                ${typeof r.corpo?.segredo_em === 'string' && !Number.isNaN(Date.parse(r.corpo.segredo_em)) ? r.corpo.segredo_em : new Date().toISOString()}::timestamptz)`);
      await tx.execute(sql`update graph_clique_pedido set resultado = 'ligada' where id = ${p.id}`);
      return ant?.prefixo ?? null;
    });
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      atorTipo: 'colaborador',
      tipo: 'integracao',
      acao: 'ligou_empresa_ao_graph',
      entidadeTipo: 'empresa',
      entidadeId: user.tenantId,
      origem: 'clique',
      detalhe: { contaGraph: contaNome, permissoes, anterior },
    });
    return { ligada: true, contaNome, permissoes };
  }

  /**
   * `POST /graph/clique/desligar`: o presidente desliga a empresa do Graph. Sai aqui na hora (a próxima foto já vai à IA
   * da empresa), e o Regem avisa o Graph (`DELETE /v1/dms-id/ligacao`) — falha lá não segura o desligar daqui. Repetir
   * não dá erro.
   */
  async desligar(user: AuthUser): Promise<{ desligada: boolean }> {
    if (ehServidorLocal()) throw new BadRequestException('A ligação com o DMS Graph se faz no Regem na nuvem (app.dmsregem.com), não no servidor da loja.');
    if (!graphLigadoNoAmbiente()) throw new ConflictException(NAO_LIGADO);
    const quem = String(user.nome ?? '').trim() || 'presidente';
    const [viva] = await this.rows(sql`
      update graph_ligacao set revogada_em = clock_timestamp(), revogada_origem = 'presidente', revogada_por = ${quem},
                               revogada_por_id = ${user.colaboradorId}::uuid, revogada_motivo = 'desligada pelo presidente'
       where tenant_id = ${user.tenantId}::uuid and revogada_em is null
      returning id, prefixo, segredo_cifrado`);
    if (!viva) return { desligada: false };
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      atorTipo: 'colaborador',
      tipo: 'integracao',
      acao: 'desligou_empresa_do_graph',
      entidadeTipo: 'graph_ligacao',
      entidadeId: String(viva.id),
      origem: 'clique',
      detalhe: { prefixo: viva.prefixo },
    });
    try {
      const cfg = this.config();
      const r = await this.chamarOGraph(cfg, '/v1/dms-id/ligacao', null, { 'dms-ligacao': decifrar(viva.segredo_cifrado) }, 'DELETE');
      if (r.status >= 300 && r.status !== 401) this.log.warn(`clique: o DMS Graph não confirmou o desligar (${r.status}); aqui já está desligada`);
    } catch (e: any) {
      this.log.warn(`clique: avisar o DMS Graph do desligar falhou (${e?.message ?? e}); aqui já está desligada`);
    }
    return { desligada: true };
  }
}
