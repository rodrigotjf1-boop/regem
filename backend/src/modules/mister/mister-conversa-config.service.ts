import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuthUser } from '../../auth/auth-user';
import { ModoDoBoleto, documentosNaInstalacao, notasNaInstalacao } from '../../common/documento-por-foto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS AJUSTES DA CONVERSA DO MISTER por empresa (mig 440; versão 3 do protótipo, "Avisos e relatórios › Conversa").
// O primeiro é o dos documentos por foto (M3a, parte 3): ligar a leitura e o jeito de lançar o boleto. Sem linha salva,
// vale o padrão (ligado, "sozinho se o código confere"). Só o presidente muda (o controlador). Só na nuvem: no servidor
// da loja a tabela não existe (lê como o padrão).

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703' || e?.cause?.code === '42P01';

export const MODOS_DO_BOLETO: readonly ModoDoBoleto[] = ['sozinho', 'perguntar'];

export interface ConversaDoMister {
  documentosLigado: boolean;
  documentosModo: ModoDoBoleto;
}
export const CONVERSA_PADRAO: ConversaDoMister = { documentosLigado: true, documentosModo: 'sozinho' };

/** O que a tela manda. Cada campo é opcional (ausente mantém o salvo — V16); presente, tem de ser válido (V15). */
export function conferirConversa(dto: unknown): Partial<ConversaDoMister> | { erro: string } {
  const d = (dto ?? {}) as any;
  const fora: Partial<ConversaDoMister> = {};
  if (d.documentosLigado !== undefined) {
    if (typeof d.documentosLigado !== 'boolean') return { erro: 'Lançar documentos por foto: diga se fica ligado ou desligado.' };
    fora.documentosLigado = d.documentosLigado;
  }
  if (d.documentosModo !== undefined) {
    if (!MODOS_DO_BOLETO.includes(d.documentosModo)) return { erro: 'Escolha como lançar o boleto.' };
    fora.documentosModo = d.documentosModo;
  }
  if (!Object.keys(fora).length) return { erro: 'Nada para salvar.' };
  return fora;
}

@Injectable()
export class MisterConversaConfigService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  /** Os ajustes que valem para a empresa (o salvo, ou o padrão). */
  async daEmpresa(tenantId: string): Promise<ConversaDoMister> {
    try {
      const [l] = linhas(
        await this.db.execute(sql`
          select documentos_ligado as "documentosLigado", documentos_modo as "documentosModo"
            from mister_conversa_config where tenant_id = ${tenantId}::uuid`),
      );
      if (!l) return { ...CONVERSA_PADRAO };
      return {
        documentosLigado: l.documentosLigado !== false,
        documentosModo: MODOS_DO_BOLETO.includes(l.documentosModo) ? l.documentosModo : CONVERSA_PADRAO.documentosModo,
      };
    } catch (e: any) {
      if (semTabela(e)) return { ...CONVERSA_PADRAO };
      throw e;
    }
  }

  /**
   * O que a tela mostra: os ajustes da empresa e se a função está ligada NESTA instalação (a variável que o dono liga —
   * a mesma regra que os serviços usam). A tela Resumo diz "em breve" quando ela ainda não está ligada.
   */
  async daTela(tenantId: string): Promise<{ conversa: ConversaDoMister; disponivel: { documentos: boolean; notas: boolean } }> {
    return { conversa: await this.daEmpresa(tenantId), disponivel: { documentos: documentosNaInstalacao(), notas: notasNaInstalacao() } };
  }

  /** Salva o que veio (o ausente mantém o salvo), numa gravação só, e audita o antes e o depois. */
  async salvar(user: AuthUser, dto: unknown) {
    const r = conferirConversa(dto);
    if ('erro' in r) throw new BadRequestException(r.erro);
    const antes = await this.daEmpresa(user.tenantId);
    const depois: ConversaDoMister = { ...antes, ...r };
    await this.db.execute(sql`
      insert into mister_conversa_config (tenant_id, documentos_ligado, documentos_modo, alterado_por, atualizado_em)
      values (${user.tenantId}::uuid, ${depois.documentosLigado}, ${depois.documentosModo}, ${user.colaboradorId}::uuid, now())
      on conflict (tenant_id) do update
         set documentos_ligado = excluded.documentos_ligado, documentos_modo = excluded.documentos_modo,
             alterado_por = excluded.alterado_por, atualizado_em = now()`);
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'mister_conversa_alterada',
      entidadeTipo: 'mister_conversa_config',
      entidadeId: user.tenantId,
      detalhe: { antes, depois },
    });
    return this.daTela(user.tenantId);
  }
}
