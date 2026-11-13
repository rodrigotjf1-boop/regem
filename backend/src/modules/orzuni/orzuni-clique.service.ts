import { BadGatewayException, BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthUser } from '../../auth/auth-user';
import { ClienteDmsId } from '../../dms/integracao-dms';
import { chaveSegredosDisponivel, cifrar, decifrar } from '../../common/cifra-segredo';
import { ifoodPeloOrzuniLigado } from '../../common/ifood-pelo-orzuni';
import { ehServidorLocal } from '../../common/modo';
import { PERMISSOES_ORZUNI, SEGREDO_LIGACAO, lerConfigOrzuni } from './orzuni.regras';
import {
  FRASE_DA_PERMISSAO,
  NECESSARIAS_DO_CLIQUE,
  OPCIONAIS_DO_CLIQUE,
  type PermissaoDoClique,
  VALIDADE_DO_PEDIDO_MS,
  codigoValido,
  emissorDoOrzuni,
  estadoValido,
  fraseDaVolta,
  lerVolta,
  novoPedido,
  numeroValido,
  permissoesDoPedido,
  resumoDoEstado,
  urlDaPagina,
  voltaDoRegem,
} from './orzuni-clique.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** O que a janela "Orzuni" de Delivery › Configurações › Integrações mostra (mockup aprovado, vistas 1, 2 e 5). */
export type SituacaoDoClique = {
  /** A empresa tem o iFood pelo Orzuni liberado (no piloto, OZ-5): sem isso, o cartão nem aparece. */
  liberado: boolean;
  /** No servidor da loja a ligação não se faz: a tela manda abrir o Regem na nuvem (V37). */
  naNuvem: boolean;
  /** Quem vê pode ligar? Só o presidente (OZ-2). */
  podeLigar: boolean;
  loja: { id: string; nome: string } | null;
  /** Mais de uma loja e nenhuma escolhida no topo: a tela pede para escolher. */
  escolherLoja: boolean;
  ligacao: null | {
    lojaIfood: string | null;
    lojaIfoodNome: string | null;
    origem: 'chave' | 'clique';
    desde: string;
    por: string | null;
    ultimoUso: string | null;
    permissoes: string[];
  };
  /** Desligada pelo Orzuni (a ligação viva não vale mais lá): a tela mostra o aviso e o "conectar de novo". */
  desligadaEm: string | null;
  permissoes: Array<{ id: PermissaoDoClique; frase: string; necessaria: boolean }>;
};

@Injectable()
export class OrzuniCliqueService {
  private readonly log = new Logger('OrzuniClique');
  /** O fetch do DMS ID e do Orzuni — os testes trocam por um falso. */
  buscar: typeof fetch = fetch;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async rows(q: any, executor: any = this.db): Promise<any[]> {
    const r: any = await executor.execute(q);
    return (r.rows ?? r) as any[];
  }

  /**
   * A loja do clique (V86): a do cabeçalho (conferida na empresa — ERR-428) ou, sem ela, a única loja da empresa.
   * Mais de uma e nenhuma escolhida: nula (a tela pede para escolher no topo).
   */
  private async lojaAlvo(tenantId: string, unidadeAtual: string | null): Promise<{ id: string; nome: string } | null> {
    if (unidadeAtual && unidadeAtual !== NIL_UUID) {
      if (!UUID.test(unidadeAtual)) throw new BadRequestException('Loja inválida.');
      const [l] = await this.rows(sql`select id, nome from unidade where id = ${unidadeAtual} and tenant_id = ${tenantId} and deleted_at is null`);
      if (!l) throw new NotFoundException('Loja não encontrada nesta empresa.');
      return { id: String(l.id), nome: String(l.nome) };
    }
    const lojas = await this.rows(sql`select id, nome from unidade where tenant_id = ${tenantId} and deleted_at is null order by nome limit 2`);
    return lojas.length === 1 ? { id: String(lojas[0].id), nome: String(lojas[0].nome) } : null;
  }

  private async ligacaoViva(unidadeId: string) {
    const [l] = await this.rows(sql`
      select id, prefixo, segredo_cifrado, loja_ifood, loja_ifood_nome, origem, permissoes, criada_em, criada_por, ultimo_uso_em
        from orzuni_ligacao where unidade_id = ${unidadeId} and revogada_em is null`);
    return l ?? null;
  }

  private config() {
    const cfg = lerConfigOrzuni();
    if (!cfg.credencialOk) throw new ConflictException(`A credencial do Regem no DMS ID não está pronta: ${cfg.motivo}. Avise o suporte.`);
    if (!chaveSegredosDisponivel()) throw new ConflictException('Falta a chave dos segredos nesta nuvem. Avise o suporte.');
    return cfg;
  }

  private async tokenDoDmsId(cfg: ReturnType<typeof lerConfigOrzuni>): Promise<string> {
    try {
      const dmsId = new ClienteDmsId({ emissor: cfg.emissor, aplicativo: cfg.aplicativo, segredo: cfg.segredo, buscar: this.buscar });
      return await dmsId.token(cfg.recurso, PERMISSOES_ORZUNI);
    } catch (e: any) {
      this.log.warn(`clique: o DMS ID não deu o token (${e?.message ?? e})`);
      throw new BadGatewayException('O DMS ID não entregou o token do Regem agora. Tente de novo em instantes.');
    }
  }

  /** Um POST ao Orzuni com o token do DMS ID. Nunca segue redirecionamento (o token não vai a outro endereço). */
  private async postarNoOrzuni(cfg: ReturnType<typeof lerConfigOrzuni>, caminho: string, corpo: unknown, cabecalhos: Record<string, string> = {}, metodo = 'POST') {
    const token = await this.tokenDoDmsId(cfg);
    let r: Response;
    try {
      r = await this.buscar(new URL(caminho, emissorDoOrzuni(cfg.endereco)).href, {
        method: metodo,
        redirect: 'manual',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json', ...cabecalhos },
        body: metodo === 'DELETE' ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e: any) {
      this.log.warn(`clique: sem resposta do Orzuni em ${caminho} (${e?.cause?.code ?? e?.message ?? e})`);
      throw new BadGatewayException('O Orzuni não respondeu agora. Tente de novo em instantes.');
    }
    const lido: any = await r.json().catch(() => null);
    return { status: r.status, corpo: lido };
  }

  /** `GET /orzuni/clique/situacao`: o que a janela mostra. */
  async situacao(user: AuthUser, unidadeAtual: string | null): Promise<SituacaoDoClique> {
    const liberado = await ifoodPeloOrzuniLigado(this.db, user.tenantId);
    const permissoes = [
      ...NECESSARIAS_DO_CLIQUE.map((id) => ({ id, frase: FRASE_DA_PERMISSAO[id], necessaria: true })),
      ...OPCIONAIS_DO_CLIQUE.map((id) => ({ id, frase: FRASE_DA_PERMISSAO[id], necessaria: false })),
    ];
    const base: SituacaoDoClique = {
      liberado,
      naNuvem: !ehServidorLocal(),
      podeLigar: user.categoria === 'presidente',
      loja: null,
      escolherLoja: false,
      ligacao: null,
      desligadaEm: null,
      permissoes,
    };
    if (!liberado || ehServidorLocal()) return base;
    const loja = await this.lojaAlvo(user.tenantId, unidadeAtual);
    if (!loja) return { ...base, escolherLoja: true };
    const l = await this.ligacaoViva(loja.id);
    let desligadaEm: string | null = null;
    if (!l) {
      // A última ligação desta loja, se foi o Orzuni que a recusou (o envio marca `revogada_por = 'orzuni'`): a tela
      // avisa e oferece conectar de novo.
      const [u] = await this.rows(sql`
        select revogada_em, revogada_por from orzuni_ligacao where unidade_id = ${loja.id} order by revogada_em desc nulls last limit 1`);
      if (u?.revogada_em && u.revogada_por === 'orzuni') desligadaEm = new Date(u.revogada_em).toISOString();
    }
    return {
      ...base,
      loja,
      desligadaEm,
      ligacao: l
        ? {
            lojaIfood: l.loja_ifood ?? null,
            lojaIfoodNome: l.loja_ifood_nome ?? null,
            origem: l.origem === 'clique' ? 'clique' : 'chave',
            desde: new Date(l.criada_em).toISOString(),
            por: l.criada_por ?? null,
            ultimoUso: l.ultimo_uso_em ? new Date(l.ultimo_uso_em).toISOString() : null,
            permissoes: Array.isArray(l.permissoes) ? l.permissoes.map(String) : [],
          }
        : null,
    };
  }

  /**
   * `POST /orzuni/clique/iniciar`: empurra o pedido ao Orzuni e devolve o endereço da página. "Pedir mais" (já ligada
   * pelo clique) pede só as opcionais que o presidente marcou e a ligação não tem. Toda recusa vem ANTES de gravar.
   */
  async iniciar(user: AuthUser, unidadeAtual: string | null, dto: any): Promise<{ url: string }> {
    if (ehServidorLocal()) throw new BadRequestException('A ligação com o Orzuni se faz no Regem na nuvem (app.dmsregem.com), não no servidor da loja.');
    if (!(await ifoodPeloOrzuniLigado(this.db, user.tenantId))) throw new ConflictException('O iFood pelo Orzuni não está liberado para esta empresa.');
    const loja = await this.lojaAlvo(user.tenantId, unidadeAtual);
    if (!loja) throw new BadRequestException('Escolha no topo da tela a loja que vai ligar ao Orzuni.');
    const cfg = this.config();

    const viva = await this.ligacaoViva(loja.id);
    const modo: 'novo' | 'mais' = viva && viva.origem === 'clique' && dto?.mais === true ? 'mais' : 'novo';
    const jaTem: string[] = viva && Array.isArray(viva.permissoes) ? viva.permissoes.map(String) : [];
    const permissoes = permissoesDoPedido(modo, jaTem, dto?.opcionais);
    if (!permissoes.length) throw new BadRequestException('Ligue ao menos uma permissão que a loja ainda não tem.');

    const [emp] = await this.rows(sql`select nome, cnpj from empresa where id = ${user.tenantId}`);
    const [quem] = await this.rows(sql`select nome, email from colaborador where id = ${user.colaboradorId} and tenant_id = ${user.tenantId}`);
    const email = String(quem?.email ?? '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new BadRequestException('Cadastre o seu e-mail no seu perfil antes de ligar: o Orzuni mostra ao dono quem pediu.');
    }

    const p = novoPedido();
    const corpo = {
      response_type: 'code',
      client_id: cfg.aplicativo,
      redirect_uri: voltaDoRegem(),
      scope: permissoes.join(' '),
      state: p.estado,
      code_challenge: p.desafio,
      code_challenge_method: 'S256',
      conta_nome: String(emp?.nome ?? 'Empresa').slice(0, 120),
      conta_cnpj: emp?.cnpj ? String(emp.cnpj) : '',
      conta_email: email,
      conta_loja: loja.nome.slice(0, 120),
      conta_loja_id: loja.id,
    };
    const r = await this.postarNoOrzuni(cfg, '/v1/dms-id/autorizacao/pedido', corpo);
    if (r.status < 200 || r.status >= 300 || !numeroValido(r.corpo?.request_uri)) {
      const problema = String(r.corpo?.type ?? '').split('/').pop() || `http-${r.status}`;
      this.log.warn(`clique: o Orzuni recusou o pedido: ${r.status} ${problema} ${String(r.corpo?.detail ?? '').slice(0, 200)}`);
      throw new BadGatewayException(
        problema === 'integracao-parada'
          ? 'O Orzuni pausou novas ligações do Regem por enquanto. As ligações que já existem seguem como estão.'
          : 'O Orzuni não aceitou o pedido agora. Tente de novo em alguns minutos; se continuar, avise o suporte.',
      );
    }
    const vale = Math.min(Number(r.corpo?.expires_in) || 600, VALIDADE_DO_PEDIDO_MS / 1000);
    // Pedidos mortos há mais de um dia saem aqui (não há rotina para isso); nunca derruba o pedido novo.
    await this.db
      .execute(sql`delete from orzuni_clique_pedido where vence_em < now() - interval '1 day'`)
      .catch((e: any) => this.log.warn(`clique: limpeza dos pedidos vencidos falhou: ${e?.message ?? e}`));
    await this.db.execute(sql`
      insert into orzuni_clique_pedido (tenant_id, unidade_id, colaborador_id, estado_hash, verificador_cifrado, permissoes, modo, vence_em)
      values (${user.tenantId}, ${loja.id}, ${user.colaboradorId}, ${resumoDoEstado(p.estado)}, ${cifrar(p.verificador)},
              ${JSON.stringify(permissoes)}::jsonb, ${modo}, now() + make_interval(secs => ${vale}))`);
    return { url: urlDaPagina(r.corpo?.authorization_endpoint, cfg.aplicativo, String(r.corpo.request_uri)) };
  }

  /**
   * `POST /orzuni/clique/concluir`: a volta do Orzuni. O pedido é GASTO primeiro (uma volta só leva); a volta só vale
   * para quem começou (o state preso à sessão, Padrão §3) e só com o `iss` do Orzuni (RFC 9207). Troca o código pela
   * ligação e grava na `orzuni_ligacao` — a de antes desta loja, se houver, sai (o Orzuni girou o segredo).
   */
  async concluir(user: AuthUser, q: unknown): Promise<{ ligada: true; lojaIfoodNome: string | null; permissoes: string[] } | { ligada: false; mensagem: string }> {
    if (ehServidorLocal()) return { ligada: false, mensagem: fraseDaVolta('erro') };
    const v = lerVolta(q);
    if (!estadoValido(v.state)) return { ligada: false, mensagem: fraseDaVolta('outra_sessao') };
    const [p] = await this.rows(sql`
      update orzuni_clique_pedido set concluido_em = now()
       where estado_hash = ${resumoDoEstado(v.state)} and tenant_id = ${user.tenantId} and colaborador_id = ${user.colaboradorId}
         and concluido_em is null
      returning id, unidade_id, verificador_cifrado, permissoes, modo, vence_em`);
    if (!p) return { ligada: false, mensagem: fraseDaVolta('outra_sessao') };
    const fim = (resultado: string) => this.db.execute(sql`update orzuni_clique_pedido set resultado = ${resultado} where id = ${p.id}`).catch(() => {});

    if (v.error) {
      await fim(v.error === 'access_denied' ? 'recusado' : 'vencido');
      return { ligada: false, mensagem: fraseDaVolta(v.error === 'access_denied' ? 'access_denied' : 'invalid_request_uri') };
    }
    if (new Date(p.vence_em).getTime() < Date.now()) {
      await fim('vencido');
      return { ligada: false, mensagem: fraseDaVolta('vencido') };
    }
    const cfg = this.config();
    if (v.iss !== emissorDoOrzuni(cfg.endereco)) {
      await fim('erro');
      this.log.warn(`clique: a volta trouxe o iss "${String(v.iss).slice(0, 80)}", não o do Orzuni`);
      return { ligada: false, mensagem: fraseDaVolta('emissor') };
    }
    if (!codigoValido(v.code)) {
      await fim('erro');
      return { ligada: false, mensagem: fraseDaVolta('erro') };
    }

    const r = await this.postarNoOrzuni(cfg, '/v1/dms-id/autorizacao/token', {
      grant_type: 'authorization_code',
      client_id: cfg.aplicativo,
      code: v.code,
      redirect_uri: voltaDoRegem(),
      code_verifier: decifrar(p.verificador_cifrado),
    });
    const ligacao = String(r.corpo?.ligacao ?? '');
    if (r.status !== 200 || !SEGREDO_LIGACAO.test(ligacao)) {
      await fim('erro');
      const problema = String(r.corpo?.type ?? '').split('/').pop() || `http-${r.status}`;
      this.log.warn(`clique: a troca do código foi recusada pelo Orzuni: ${r.status} ${problema}`);
      return { ligada: false, mensagem: fraseDaVolta('erro') };
    }
    const permissoes = Array.isArray(r.corpo?.permissoes) ? (r.corpo.permissoes as unknown[]).map(String) : [];
    const lojaIfoodNome = r.corpo?.loja_nome ? String(r.corpo.loja_nome).slice(0, 200) : null;
    const quem = String(user.nome ?? '').trim() || 'presidente';
    const [unidade] = await this.rows(sql`select nome from unidade where id = ${p.unidade_id}`);
    const anterior = await this.db.transaction(async (tx: any) => {
      const [ant] = await this.rows(sql`select prefixo from orzuni_ligacao where unidade_id = ${p.unidade_id} and revogada_em is null`, tx);
      // Ligar de novo GIRA o segredo no Orzuni: a anterior já não vale lá — sai aqui também, na mesma transação.
      await tx.execute(sql`
        update orzuni_ligacao set revogada_em = now(), revogada_por = ${quem}, revogada_motivo = 'trocada pela autorização por clique'
         where unidade_id = ${p.unidade_id} and revogada_em is null`);
      await tx.execute(sql`
        insert into orzuni_ligacao (tenant_id, unidade_id, segredo_cifrado, prefixo, conta_orzuni, loja_ifood, loja_ifood_nome, permissoes,
                                    criada_por, segredo_em, origem)
        values (${user.tenantId}, ${p.unidade_id}, ${cifrar(ligacao)}, ${String(r.corpo?.prefixo ?? ligacao.slice(0, 19))},
                ${r.corpo?.conta_id ? String(r.corpo.conta_id) : null}, ${r.corpo?.loja ? String(r.corpo.loja) : null}, ${lojaIfoodNome},
                ${JSON.stringify(permissoes)}::jsonb, ${quem}, ${typeof r.corpo?.segredo_em === 'string' ? r.corpo.segredo_em : new Date().toISOString()},
                'clique')`);
      await tx.execute(sql`update orzuni_clique_pedido set resultado = 'ligada' where id = ${p.id}`);
      return ant?.prefixo ?? null;
    });
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      unidadeId: p.unidade_id,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      atorTipo: 'colaborador',
      tipo: 'integracao',
      acao: 'ligou_loja_ao_orzuni',
      entidadeTipo: 'unidade',
      entidadeId: p.unidade_id,
      origem: 'clique',
      detalhe: { loja: unidade?.nome ?? null, lojaIfood: lojaIfoodNome, permissoes, modo: p.modo, anterior },
    });
    return { ligada: true, lojaIfoodNome, permissoes };
  }

  /**
   * `POST /orzuni/clique/desligar`: o presidente desliga a loja do Orzuni. Sai aqui na hora (o envio para), e o Regem
   * avisa o Orzuni (`DELETE /v1/dms-id/ligacao`) — falha lá não segura o desligar daqui. Repetir não dá erro.
   */
  async desligar(user: AuthUser, unidadeAtual: string | null): Promise<{ desligada: boolean }> {
    if (ehServidorLocal()) throw new BadRequestException('A ligação com o Orzuni se faz no Regem na nuvem (app.dmsregem.com), não no servidor da loja.');
    const loja = await this.lojaAlvo(user.tenantId, unidadeAtual);
    if (!loja) throw new BadRequestException('Escolha no topo da tela a loja que vai desligar do Orzuni.');
    const viva = await this.ligacaoViva(loja.id);
    if (!viva) return { desligada: false };
    const quem = String(user.nome ?? '').trim() || 'presidente';
    await this.db.execute(sql`
      update orzuni_ligacao set revogada_em = now(), revogada_por = ${quem}, revogada_motivo = 'desligada pelo presidente'
       where id = ${viva.id} and revogada_em is null`);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      unidadeId: loja.id,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      atorTipo: 'colaborador',
      tipo: 'integracao',
      acao: 'desligou_loja_do_orzuni',
      entidadeTipo: 'unidade',
      entidadeId: loja.id,
      origem: 'clique',
      detalhe: { loja: loja.nome, prefixo: viva.prefixo },
    });
    try {
      const cfg = this.config();
      const r = await this.postarNoOrzuni(cfg, '/v1/dms-id/ligacao', null, { 'dms-ligacao': decifrar(viva.segredo_cifrado) }, 'DELETE');
      if (r.status >= 300 && r.status !== 401) this.log.warn(`clique: o Orzuni não confirmou o desligar (${r.status}); aqui já está desligada`);
    } catch (e: any) {
      this.log.warn(`clique: avisar o Orzuni do desligar falhou (${e?.message ?? e}); aqui já está desligada`);
    }
    return { desligada: true };
  }
}
