import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { idEntitlement } from '../../common/id-deterministico';
import { MODULO_PRECOS_NA_99, VERSAO_MINIMA_PRECOS_NA_99 } from '../../common/precos-na-99';
import { servidoresDaEmpresa } from '../../common/servidores-da-empresa';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quem age no console da distribuição (`DistCtx`). */
type QuemDist = { sub?: string; nome?: string; perfil?: string };

/**
 * O lado da DISTRIBUIÇÃO do "Preço e pausa na 99" (R3 F2; mig 401), no console (aba Integrações, só Diretoria): ligar
 * ou desligar o direito `precos_na_99` da empresa. LIGAR exige TODOS os servidores de loja ativos dela na versão com a
 * mig 401 (o porquê está no cabeçalho dela). O lojista nunca grava este direito.
 */
@Injectable()
export class PrecosNa99Service {
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

  /** O painel da empresa: a liberação, os servidores de loja com a versão, se a 99 está conectada e os últimos envios. */
  async painel(tenantId: string) {
    const emp = await this.empresa(tenantId);
    const [lib, servidores, integ, envios] = await Promise.all([
      this.rows(sql`select ativo from entitlement where tenant_id = ${emp.id} and modulo = ${MODULO_PRECOS_NA_99}`),
      servidoresDaEmpresa(this.db, emp.id, VERSAO_MINIMA_PRECOS_NA_99),
      this.rows(sql`select exists (select 1 from integracao where tenant_id = ${emp.id} and canal = '99food' and ativo) as ligada`),
      // A fila da 99 (mig 402, só nuvem — o console também).
      this.rows(sql`
        select e.id, e.tipo, e.situacao, e.resultado, e.resposta, e.ultimo_erro, e.tentativas, e.marcado_em, e.enviado_em,
               coalesce(u.nome, nullif(i.config ->> 'shopName', '')) as loja, p.nome as alvo, p.codigo
          from food99_envio e
          join integracao i on i.id = e.integracao_id
          left join unidade u on u.id = i.unidade_id
          left join produto p on p.id = e.ref_id
         where e.tenant_id = ${emp.id}
         order by e.marcado_em desc
         limit 30`),
    ]);
    return {
      empresa: emp,
      liberado: lib[0]?.ativo === true,
      versaoMinima: VERSAO_MINIMA_PRECOS_NA_99,
      servidores,
      com99: integ[0]?.ligada === true,
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
   * Liga ou desliga o direito `precos_na_99` da empresa. LIGAR exige todos os servidores de loja ativos dela na versão
   * com a mig 401 (V9e/ERR-029 do lado da loja; e o preço da 99 não pode voltar vazio da loja).
   */
  async liberacao(dto: { tenantId?: string; ligar?: unknown }, quem: QuemDist) {
    const emp = await this.empresa(String(dto?.tenantId ?? ''));
    if (dto?.ligar !== true && dto?.ligar !== false) throw new BadRequestException('Informe "ligar" (true ou false).');
    const ligar = dto.ligar === true;
    if (ligar) {
      const atrasados = (await servidoresDaEmpresa(this.db, emp.id, VERSAO_MINIMA_PRECOS_NA_99)).filter((s) => !s.pronto);
      if (atrasados.length) {
        const lista = atrasados.map((s) => `"${s.nome}" (${s.versao ? `versão ${s.versao}` : 'sem versão informada'})`).join(', ');
        throw new ConflictException(
          `Não dá para ligar ainda: o servidor da loja ${lista} precisa estar na ${VERSAO_MINIMA_PRECOS_NA_99} ou mais nova (o .zip com os campos da 99).`,
        );
      }
    }
    const [antes] = await this.rows(sql`select ativo from entitlement where tenant_id = ${emp.id} and modulo = ${MODULO_PRECOS_NA_99}`);
    // Dois únicos (o id da chave e empresa+módulo): "não faz nada" vale para qualquer um, e o valor vai pela chave
    // natural — dois salvamentos juntos não dão 23505 (ERR-391).
    await this.db.execute(sql`
      insert into entitlement (id, tenant_id, modulo, ativo)
      values (${idEntitlement(emp.id, MODULO_PRECOS_NA_99)}, ${emp.id}, ${MODULO_PRECOS_NA_99}, ${ligar})
      on conflict do nothing`);
    await this.db.execute(sql`
      update entitlement set ativo = ${ligar}, updated_at = now() where tenant_id = ${emp.id} and modulo = ${MODULO_PRECOS_NA_99}`);
    if ((antes?.ativo === true) !== ligar) {
      await this.auditoria.registrar({
        tenantId: emp.id,
        atorId: null,
        atorPerfil: quem?.perfil ?? null,
        atorTipo: 'distribuicao',
        tipo: 'integracao',
        acao: ligar ? 'ligou_precos_na_99' : 'desligou_precos_na_99',
        entidadeTipo: 'empresa',
        entidadeId: emp.id,
        origem: 'distribuicao',
        detalhe: { por: quem?.nome ?? null },
      });
    }
    return { tenantId: emp.id, liberado: ligar };
  }
}
