import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ClienteDmsId } from '../../dms/integracao-dms';
import { chaveSegredosDisponivel, cifrar } from '../../common/cifra-segredo';
import { idEntitlement } from '../../common/id-deterministico';
import { MODULO_IFOOD_PELO_ORZUNI } from '../../common/ifood-pelo-orzuni';
import { compararVersao } from '../edge/release-selecao';
import {
  CHAVE_ORZUNI,
  PERMISSOES_ORZUNI,
  SEGREDO_LIGACAO,
  VERSAO_MINIMA_DA_LOJA,
  fraseDaTroca,
  lerConfigOrzuni,
} from './orzuni.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quem age no console da distribuição (`DistCtx`). */
type QuemDist = { sub?: string; nome?: string; perfil?: string };

/**
 * O lado da DISTRIBUIÇÃO do iFood pelo Orzuni (R2a; mig 370), no console (aba Integrações, só Diretoria):
 *  • registrar a ligação da loja: a distribuição cola a chave `orz_live_` da conta da loja no Orzuni; o Regem a troca,
 *    com o token do DMS ID do aplicativo dele, pelo segredo da ligação (`POST /v1/dms-id/ligacao` do Orzuni), que
 *    aparece UMA vez e é guardado CIFRADO. A chave `orz_live_` não é guardada. O lojista nunca vê nenhum dos dois;
 *  • revogar a ligação (só aqui; no Orzuni ela segue até a loja revogar lá ou a troca girar o segredo);
 *  • ligar/desligar o direito `ifood_pelo_orzuni` da empresa — ligar só com TODOS os servidores de loja dela na
 *    versão que tem a mig 369 (o porquê está no cabeçalho dela).
 */
@Injectable()
export class OrzuniLigacaoService {
  private readonly log = new Logger('OrzuniLigacao');
  /** O fetch da troca (DMS ID e Orzuni) — os testes trocam por um falso. */
  buscar: typeof fetch = fetch;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return (r.rows ?? r) as any[];
  }

  private async empresa(tenantId: string) {
    if (!UUID.test(String(tenantId ?? ''))) throw new BadRequestException('Escolha a empresa.');
    const [e] = await this.rows(sql`select id, nome from empresa where id = ${tenantId} and deleted_at is null`);
    if (!e) throw new NotFoundException('Empresa não encontrada.');
    return e as { id: string; nome: string };
  }

  /** Os servidores de loja ativos da empresa e se cada um já está na versão com a mig 369. */
  private async servidores(tenantId: string) {
    const lista = await this.rows(sql`
      select eq.id, eq.nome, es.versao, es.recebido_em
        from equipamento eq
        left join edge_status es on es.equipamento_id = eq.id
       where eq.tenant_id = ${tenantId} and eq.tipo = 'servidor_local' and eq.ativo and eq.revogado_em is null
       order by eq.nome`);
    return lista.map((s) => ({
      id: String(s.id),
      nome: String(s.nome),
      versao: s.versao ? String(s.versao) : null,
      vistoEm: s.recebido_em ?? null,
      pronto: !!s.versao && compararVersao(String(s.versao), VERSAO_MINIMA_DA_LOJA) >= 0,
    }));
  }

  /** O painel da empresa: configuração, liberação, servidores, lojas com a ligação e os últimos envios. */
  async painel(tenantId: string) {
    const emp = await this.empresa(tenantId);
    const cfg = lerConfigOrzuni();
    const [lojas, ligacoes, lib, servidores, envios] = await Promise.all([
      this.rows(sql`select id, nome from unidade where tenant_id = ${emp.id} and deleted_at is null order by created_at, nome`),
      this.rows(sql`
        select id, unidade_id, prefixo, loja_ifood, permissoes, criada_em, criada_por, ultimo_uso_em
          from orzuni_ligacao where tenant_id = ${emp.id} and revogada_em is null`),
      this.rows(sql`select ativo from entitlement where tenant_id = ${emp.id} and modulo = ${MODULO_IFOOD_PELO_ORZUNI}`),
      this.servidores(emp.id),
      this.rows(sql`
        select e.id, e.tipo, e.situacao, e.resultado, e.resposta, e.ultimo_erro, e.tentativas, e.marcado_em, e.enviado_em,
               u.nome as loja, coalesce(p.nome, o.nome) as alvo, coalesce(p.codigo, o.codigo_pdv) as codigo
          from orzuni_envio e
          left join unidade u on u.id = e.unidade_id
          left join produto p on p.id = e.ref_id and e.tipo in ('preco_item', 'status_item', 'cadastro_item', 'codigo_item')
          left join opcao o on o.id = e.ref_id and e.tipo in ('preco_opcao', 'status_opcao')
         where e.tenant_id = ${emp.id}
         order by e.marcado_em desc
         limit 30`),
    ]);
    const porLoja = new Map(ligacoes.map((l) => [String(l.unidade_id), l]));
    return {
      empresa: emp,
      config: {
        envioLigado: cfg.envioLigado,
        credencialOk: cfg.credencialOk,
        motivo: cfg.motivo,
        segredosChave: chaveSegredosDisponivel(),
        endereco: cfg.endereco,
      },
      liberado: lib[0]?.ativo === true,
      versaoMinima: VERSAO_MINIMA_DA_LOJA,
      servidores,
      lojas: lojas.map((l) => {
        const lig = porLoja.get(String(l.id));
        return {
          id: String(l.id),
          nome: String(l.nome),
          ligacao: lig
            ? {
                id: String(lig.id),
                prefixo: String(lig.prefixo),
                lojaIfood: lig.loja_ifood ? String(lig.loja_ifood) : null,
                permissoes: Array.isArray(lig.permissoes) ? lig.permissoes : [],
                criadaEm: lig.criada_em,
                criadaPor: lig.criada_por ?? null,
                ultimoUsoEm: lig.ultimo_uso_em ?? null,
              }
            : null,
        };
      }),
      envios: envios.map((e) => ({
        id: String(e.id),
        tipo: String(e.tipo),
        situacao: String(e.situacao),
        resultado: e.resultado ?? null,
        resposta: e.resposta ?? null,
        erro: e.ultimo_erro ?? null,
        tentativas: Number(e.tentativas),
        loja: e.loja ?? null,
        alvo: e.alvo ?? null,
        codigo: e.codigo ?? null,
        marcadoEm: e.marcado_em,
        enviadoEm: e.enviado_em ?? null,
      })),
    };
  }

  /**
   * Registra (ou troca) a ligação da loja: a chave `orz_live_` vira o segredo da ligação, guardado cifrado. Toda
   * recusa acontece ANTES de gravar (V86); a chave em si não é guardada nem registrada em log.
   */
  async registrar(dto: { tenantId?: string; unidadeId?: string; chave?: string }, quem: QuemDist) {
    const emp = await this.empresa(String(dto?.tenantId ?? ''));
    const unidadeId = String(dto?.unidadeId ?? '');
    if (!UUID.test(unidadeId)) throw new BadRequestException('Escolha a loja.');
    const chave = String(dto?.chave ?? '').trim();
    if (!CHAVE_ORZUNI.test(chave)) {
      throw new BadRequestException('A chave precisa ser a "orz_live_…" da conta da loja no Orzuni (copie inteira, sem espaços).');
    }
    const [loja] = await this.rows(sql`
      select id, nome from unidade where id = ${unidadeId} and tenant_id = ${emp.id} and deleted_at is null`);
    if (!loja) throw new NotFoundException('Loja não encontrada nesta empresa.');
    const cfg = lerConfigOrzuni();
    if (!cfg.credencialOk) throw new ConflictException(`A credencial do Regem no DMS ID não está pronta: ${cfg.motivo}.`);
    if (!chaveSegredosDisponivel()) {
      throw new ConflictException('Falta a SEGREDOS_CHAVE nesta máquina: sem ela o segredo da ligação não pode ser guardado.');
    }

    const entregue = await this.trocar(cfg, chave);

    const [ant] = await this.rows(sql`
      select id, prefixo from orzuni_ligacao where unidade_id = ${unidadeId} and revogada_em is null`);
    const id = await this.db.transaction(async (tx: any) => {
      // Registrar de novo GIRA o segredo no Orzuni: a anterior já não vale lá — revoga aqui também.
      await tx.execute(sql`
        update orzuni_ligacao
           set revogada_em = now(), revogada_por = ${quem?.nome ?? 'distribuição'}, revogada_motivo = 'trocada por uma chave nova'
         where unidade_id = ${unidadeId} and revogada_em is null`);
      const r: any = await tx.execute(sql`
        insert into orzuni_ligacao (tenant_id, unidade_id, segredo_cifrado, prefixo, conta_orzuni, loja_ifood, permissoes,
                                    criada_por, segredo_em)
        values (${emp.id}, ${unidadeId}, ${cifrar(entregue.ligacao)}, ${entregue.prefixo}, ${entregue.contaId},
                ${entregue.loja}, ${JSON.stringify(entregue.permissoes)}::jsonb, ${quem?.nome ?? null},
                ${entregue.segredoEm ?? new Date().toISOString()})
        returning id`);
      return String((r.rows ?? r)[0].id);
    });
    await this.auditoria.registrar({
      tenantId: emp.id,
      unidadeId,
      atorId: null,
      atorPerfil: quem?.perfil ?? null,
      atorTipo: 'distribuicao',
      tipo: 'integracao',
      acao: 'ligou_loja_ao_orzuni',
      entidadeTipo: 'unidade',
      entidadeId: unidadeId,
      origem: 'distribuicao',
      detalhe: { loja: loja.nome, prefixo: entregue.prefixo, anterior: ant?.prefixo ?? null, por: quem?.nome ?? null },
    });
    return {
      id,
      unidadeId,
      loja: String(loja.nome),
      prefixo: entregue.prefixo,
      lojaIfood: entregue.loja,
      permissoes: entregue.permissoes,
      trocouAnterior: !!ant,
    };
  }

  /** A troca no Orzuni. Falha da rede ou do DMS ID: 502 com a frase; recusa do Orzuni: 400 com a frase dele. */
  private async trocar(cfg: ReturnType<typeof lerConfigOrzuni>, chave: string) {
    let token: string;
    try {
      const dmsId = new ClienteDmsId({ emissor: cfg.emissor, aplicativo: cfg.aplicativo, segredo: cfg.segredo, buscar: this.buscar });
      token = await dmsId.token(cfg.recurso, PERMISSOES_ORZUNI);
    } catch (e: any) {
      this.log.warn(`troca da ligação: o DMS ID não deu o token (${e?.message ?? e})`);
      throw new BadGatewayException('O DMS ID não entregou o token do Regem agora. Tente de novo em instantes.');
    }
    let r: Response;
    try {
      r = await this.buscar(cfg.urlLigacao, {
        method: 'POST',
        redirect: 'manual', // o token não vai a outro endereço
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ chave_orzuni: chave }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e: any) {
      this.log.warn(`troca da ligação: sem resposta do Orzuni (${e?.cause?.code ?? e?.message ?? e})`);
      throw new BadGatewayException('O Orzuni não respondeu agora. Tente de novo em instantes.');
    }
    const corpo: any = await r.json().catch(() => null);
    if (!r.ok) {
      const problema = String(corpo?.type ?? '').split('/').pop() || `http-${r.status}`;
      this.log.warn(`troca da ligação recusada pelo Orzuni: ${r.status} ${problema}`);
      if (r.status >= 500) throw new BadGatewayException(fraseDaTroca(problema));
      throw new BadRequestException(fraseDaTroca(problema));
    }
    const ligacao = String(corpo?.ligacao ?? '');
    if (!SEGREDO_LIGACAO.test(ligacao)) {
      this.log.error('troca da ligação: o Orzuni respondeu 2xx sem um segredo de ligação no formato esperado');
      throw new BadGatewayException('O Orzuni respondeu fora do combinado (sem o segredo da ligação). Nada foi gravado.');
    }
    return {
      ligacao,
      prefixo: String(corpo?.prefixo ?? ligacao.slice(0, 19)),
      contaId: corpo?.conta_id ? String(corpo.conta_id) : null,
      loja: corpo?.loja ? String(corpo.loja) : null,
      permissoes: Array.isArray(corpo?.permissoes) ? (corpo.permissoes as unknown[]).map(String) : [],
      segredoEm: typeof corpo?.segredo_em === 'string' ? corpo.segredo_em : null,
    };
  }

  /** Revoga a ligação aqui (o envio para na hora). Repetir não muda nada. */
  async revogar(id: string, motivo: string | undefined, quem: QuemDist) {
    if (!UUID.test(String(id ?? ''))) throw new BadRequestException('Ligação inválida.');
    const [l] = await this.rows(sql`select id, tenant_id, unidade_id, prefixo, revogada_em from orzuni_ligacao where id = ${id}`);
    if (!l) throw new NotFoundException('Ligação não encontrada.');
    if (l.revogada_em) return { id, tenantId: String(l.tenant_id), prefixo: String(l.prefixo), jaRevogada: true };
    const m = String(motivo ?? '').trim().slice(0, 200) || 'revogada no console';
    await this.db.execute(sql`
      update orzuni_ligacao set revogada_em = now(), revogada_por = ${quem?.nome ?? 'distribuição'}, revogada_motivo = ${m}
       where id = ${id} and revogada_em is null`);
    await this.auditoria.registrar({
      tenantId: String(l.tenant_id),
      unidadeId: String(l.unidade_id),
      atorId: null,
      atorPerfil: quem?.perfil ?? null,
      atorTipo: 'distribuicao',
      tipo: 'integracao',
      acao: 'desligou_loja_do_orzuni',
      entidadeTipo: 'unidade',
      entidadeId: String(l.unidade_id),
      origem: 'distribuicao',
      detalhe: { prefixo: l.prefixo, motivo: m, por: quem?.nome ?? null },
    });
    return { id, tenantId: String(l.tenant_id), prefixo: String(l.prefixo), jaRevogada: false };
  }

  /**
   * Liga ou desliga o direito `ifood_pelo_orzuni` da empresa. LIGAR exige todos os servidores de loja ativos dela na
   * versão com a mig 369 (V9e/ERR-029 do lado da loja; e o preço iFood não pode voltar vazio da loja — mig 369).
   */
  async liberacao(dto: { tenantId?: string; ligar?: unknown }, quem: QuemDist) {
    const emp = await this.empresa(String(dto?.tenantId ?? ''));
    if (dto?.ligar !== true && dto?.ligar !== false) throw new BadRequestException('Informe "ligar" (true ou false).');
    const ligar = dto.ligar === true;
    if (ligar) {
      const atrasados = (await this.servidores(emp.id)).filter((s) => !s.pronto);
      if (atrasados.length) {
        const lista = atrasados.map((s) => `"${s.nome}" (${s.versao ? `versão ${s.versao}` : 'sem versão informada'})`).join(', ');
        throw new ConflictException(
          `Não dá para ligar ainda: o servidor da loja ${lista} precisa estar na ${VERSAO_MINIMA_DA_LOJA} ou mais nova (o .zip com os campos do iFood).`,
        );
      }
    }
    const [antes] = await this.rows(sql`select ativo from entitlement where tenant_id = ${emp.id} and modulo = ${MODULO_IFOOD_PELO_ORZUNI}`);
    // Dois únicos (o id da chave e empresa+módulo): "não faz nada" vale para qualquer um, e o valor vai pela chave
    // natural — dois salvamentos juntos não dão 23505 (ERR-391).
    await this.db.execute(sql`
      insert into entitlement (id, tenant_id, modulo, ativo)
      values (${idEntitlement(emp.id, MODULO_IFOOD_PELO_ORZUNI)}, ${emp.id}, ${MODULO_IFOOD_PELO_ORZUNI}, ${ligar})
      on conflict do nothing`);
    await this.db.execute(sql`
      update entitlement set ativo = ${ligar}, updated_at = now() where tenant_id = ${emp.id} and modulo = ${MODULO_IFOOD_PELO_ORZUNI}`);
    if ((antes?.ativo === true) !== ligar) {
      await this.auditoria.registrar({
        tenantId: emp.id,
        atorId: null,
        atorPerfil: quem?.perfil ?? null,
        atorTipo: 'distribuicao',
        tipo: 'integracao',
        acao: ligar ? 'ligou_ifood_pelo_orzuni' : 'desligou_ifood_pelo_orzuni',
        entidadeTipo: 'empresa',
        entidadeId: emp.id,
        origem: 'distribuicao',
        detalhe: { por: quem?.nome ?? null },
      });
    }
    return { tenantId: emp.id, liberado: ligar };
  }
}
