import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { empresa } from '../../db/schema';
import { AuthUser } from '../../auth/auth-user';
import { cnpjValido } from '../../common/validadores-br';
import { consultarCnpjReceita } from '../../common/receita-cnpj';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CreateEmpresaDto } from './dto/create-empresa.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const CNPJ_JA_EXISTE = 'A empresa já tem CNPJ. Para trocar, fale com o suporte da DMS.';
export const CNPJ_DE_OUTRA = 'Outra empresa do Regem já usa este CNPJ. Confira o número; se ele é mesmo desta empresa, fale com o suporte da DMS.';

@Injectable()
export class EmpresaService {
  /** A consulta à Receita (BrasilAPI) — os testes trocam por uma falsa. */
  consultarReceita = consultarCnpjReceita;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * GR-8 do DMS Graph (protótipo aprovado em 19/11/2026): o presidente informa o CNPJ da empresa UMA vez, quando ela
   * está sem (as contas de antes do "Criar conta" com CNPJ). As mesmas conferências do cadastro da landing: os dígitos e
   * a Receita (só barra o que a Receita diz que não existe ou está baixado; fora do ar, não barra). Outra empresa com o
   * mesmo número: o índice único `empresa_cnpj_key` recusa (23505 → 409, V24). Grava só se a empresa AINDA está sem
   * CNPJ (gravação condicional: duas abas não trocam um pelo outro); trocar um CNPJ que já existe é do suporte da DMS.
   * Fica na auditoria. Guardado só com os 14 números, como no cadastro.
   */
  async informarCnpj(user: AuthUser, bruto: unknown): Promise<{ cnpj: string }> {
    const cnpj = String(bruto ?? '').replace(/\D/g, '');
    if (!cnpjValido(cnpj)) throw new BadRequestException('Confira o CNPJ: os dígitos não batem.');
    const atual = await this.findOne(user.tenantId);
    if (cnpjValido(atual.cnpj)) throw new ConflictException(CNPJ_JA_EXISTE);
    const receita = await this.consultarReceita(cnpj);
    if (receita.estado === 'nao_existe') throw new BadRequestException('Este CNPJ não existe na Receita.');
    if (receita.estado === 'existe' && /baixad/i.test(String(receita.situacao ?? ''))) throw new BadRequestException('Este CNPJ está baixado na Receita.');
    let feito: Array<{ id: string }>;
    try {
      feito = await this.db
        .update(empresa)
        .set({ cnpj, updatedAt: new Date() })
        .where(
          and(
            eq(empresa.id, user.tenantId),
            isNull(empresa.deletedAt),
            or(isNull(empresa.cnpj), sql`length(regexp_replace(${empresa.cnpj}, '\\D', '', 'g')) <> 14`),
          ),
        )
        .returning({ id: empresa.id });
    } catch (e: any) {
      if (e?.code === '23505' || e?.cause?.code === '23505') throw new ConflictException(CNPJ_DE_OUTRA);
      throw e;
    }
    if (!feito.length) throw new ConflictException(CNPJ_JA_EXISTE);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      atorTipo: 'colaborador',
      tipo: 'empresa',
      acao: 'informou_cnpj_da_empresa',
      entidadeTipo: 'empresa',
      entidadeId: user.tenantId,
      origem: 'tela',
      detalhe: { cnpj, receita: receita.estado },
    });
    return { cnpj };
  }

  async create(dto: CreateEmpresaDto) {
    const [row] = await this.db.insert(empresa).values(dto).returning();
    return row;
  }

  findAll() {
    return this.db.select().from(empresa).where(isNull(empresa.deletedAt));
  }

  async findOne(id: string) {
    const [row] = await this.db
      .select()
      .from(empresa)
      .where(and(eq(empresa.id, id), isNull(empresa.deletedAt)));
    if (!row) throw new NotFoundException('Empresa não encontrada');
    return row;
  }

  // Config do presidente: janela de espelho do servidor local e hora do snapshot de
  // estoque. Grava SÓ o que veio — antes o campo único era obrigatório; com dois, salvar
  // a hora não pode resetar a janela para o padrão.
  async atualizarConfig(id: string, dto: { mirrorDias?: number; snapshotHora?: string }) {
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (dto.mirrorDias != null)
      patch.mirrorDias = Math.min(3650, Math.max(7, Math.round(Number(dto.mirrorDias) || 60)));
    if (dto.snapshotHora != null) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dto.snapshotHora))
        throw new BadRequestException('Hora do fechamento inválida (use HH:MM).');
      patch.snapshotHora = dto.snapshotHora;
    }
    const [row] = await this.db
      .update(empresa)
      .set(patch)
      .where(and(eq(empresa.id, id), isNull(empresa.deletedAt)))
      .returning();
    if (!row) throw new NotFoundException('Empresa não encontrada');
    return row;
  }
}
