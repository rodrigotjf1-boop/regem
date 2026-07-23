import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { colaborador, contador, integracao } from '../../db/schema';
import { EscalaService } from '../escala/escala.service';
import { AuditoriaService } from '../auditoria/auditoria.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const addDays = (iso: string, d: number) => {
  const dt = new Date(iso + 'T00:00:00');
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
};
const hojeISO = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class DesligamentoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly escala: EscalaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ===== Contador (destino do relatório de ponto) =====
  listarContadores(tenantId: string) {
    return this.db
      .select()
      .from(contador)
      .where(eq(contador.tenantId, tenantId))
      .orderBy(desc(contador.createdAt));
  }

  async salvarContador(tenantId: string, atorId: string | null, dto: any) {
    const nome = (dto?.nome ?? '').trim();
    const whatsapp = (dto?.whatsapp ?? '').trim();
    if (!nome || !whatsapp)
      throw new BadRequestException('Informe nome e WhatsApp do contador.');
    if (dto?.id) {
      const [row] = await this.db
        .update(contador)
        .set({ nome, whatsapp, email: dto.email ?? null, ativo: dto.ativo !== false, updatedAt: new Date() })
        .where(and(eq(contador.id, dto.id), eq(contador.tenantId, tenantId)))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(contador)
      .values({ tenantId, nome, whatsapp, email: dto.email ?? null, cadastradoPorId: atorId ?? null })
      .returning();
    return row;
  }

  async removerContador(tenantId: string, id: string) {
    await this.db
      .update(contador)
      .set({ ativo: false, updatedAt: new Date() })
      .where(and(eq(contador.id, id), eq(contador.tenantId, tenantId)));
    return { ok: true };
  }

  // ===== Desligamento =====
  async desligar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    colaboradorId: string,
    dto: {
      tipo: string; // sem_justa_causa | justa_causa | pedido_demissao | acordo | experiencia
      motivo?: string;
      avisoInicio?: string; // YYYY-MM-DD (só sem_justa_causa)
      avisoOpcao?: '2h' | '7dias';
      avisoDias?: number; // 30 + proporcional (teto 90)
      desligamentoData?: string; // justa causa / imediato
      enviarPonto?: boolean;
      contadorId?: string;
      pontoInicio?: string;
      pontoFim?: string;
    },
  ) {
    const [colab] = await this.db
      .select()
      .from(colaborador)
      .where(and(eq(colaborador.id, colaboradorId), eq(colaborador.tenantId, tenantId)));
    if (!colab) throw new NotFoundException('Colaborador não encontrado.');

    const patch: any = {
      desligamentoTipo: dto.tipo,
      desligamentoMotivo: dto.motivo ?? null,
      desligamentoPorId: atorId,
      updatedAt: new Date(),
    };

    const comAviso = dto.tipo === 'sem_justa_causa' && dto.avisoInicio && dto.avisoOpcao;
    if (comAviso) {
      // Aviso prévio trabalhado (Art. 488): 30 + proporcional (teto 90).
      const dias = Math.min(90, Math.max(30, Number(dto.avisoDias) || 30));
      const fim = addDays(dto.avisoInicio as string, dias - 1);
      patch.avisoInicio = dto.avisoInicio;
      patch.avisoOpcao = dto.avisoOpcao;
      patch.avisoFim = fim;
      patch.desligamentoData = fim;
      // Escala muda sozinha no período do aviso.
      await this.escala.aplicarAvisoPrevio(
        tenantId,
        colaboradorId,
        dto.avisoInicio as string,
        fim,
        dto.avisoOpcao as '2h' | '7dias',
      );
      // Segue trabalhando o aviso: status permanece ativo até a data final.
    } else {
      // Justa causa / imediato / pedido de demissão: encerra já.
      const data = dto.desligamentoData || hojeISO();
      patch.desligamentoData = data;
      patch.desligadoEm = new Date();
      patch.status = 'bloqueado'; // corta o acesso imediatamente
      await this.escala.encerrarEscala(tenantId, colaboradorId, data);
    }

    // Envio do relatório de ponto ao contador (via WhatsApp/n8n).
    let avisoContador: string | null = null;
    if (dto.enviarPonto) {
      if (!dto.contadorId)
        throw new BadRequestException('Selecione o contador (ou cadastre um) para enviar o ponto.');
      const [ct] = await this.db
        .select()
        .from(contador)
        .where(and(eq(contador.id, dto.contadorId), eq(contador.tenantId, tenantId)));
      if (!ct) throw new NotFoundException('Contador não encontrado.');
      const inicio = dto.pontoInicio || addDays(hojeISO(), -90);
      const fim = dto.pontoFim || hojeISO();
      const enviado = await this.enviarPontoContador(tenantId, ct, colab, inicio, fim);
      patch.pontoEnviadoEm = new Date();
      patch.pontoEnviadoContadorId = ct.id;
      avisoContador = enviado
        ? `Relatório de ponto enviado ao contador ${ct.nome}.`
        : `Sem robô (n8n) ativo: cadastre a integração para enviar ao contador ${ct.nome}.`;
    }

    const [row] = await this.db
      .update(colaborador)
      .set(patch)
      .where(eq(colaborador.id, colaboradorId))
      .returning();

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'colaborador',
      acao: 'desligou_colaborador',
      entidadeTipo: 'colaborador',
      entidadeId: colaboradorId,
      detalhe: { tipo: dto.tipo, avisoOpcao: dto.avisoOpcao ?? null, desligamentoData: patch.desligamentoData },
    });

    return { ok: true, colaborador: row, avisoContador };
  }

  // Dispara o relatório de ponto (link do espelho) ao WhatsApp do contador via n8n.
  // Sem PDF no servidor: mandamos o LINK do espelho (retenção 5 anos — Portaria 671).
  private async enviarPontoContador(
    tenantId: string,
    ct: any,
    colab: any,
    inicio: string,
    fim: string,
  ): Promise<boolean> {
    const [row] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, 'n8n')));
    const url = row?.merchantId;
    if (!row?.ativo || !url) return false;
    const base = process.env.APP_URL || process.env.CARDAPIO_BASE_URL || '';
    const link = `${base}/espelho-ponto?colaboradorId=${colab.id}&inicio=${inicio}&fim=${fim}`;
    const payload = {
      evento: 'ponto_contador',
      telefone: ct.whatsapp,
      contadorNome: ct.nome,
      colaboradorNome: colab.nome,
      periodoInicio: inicio,
      periodoFim: fim,
      link,
      tenantId,
      em: new Date().toISOString(),
    };
    try {
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (row.clientSecret) {
        const { createHmac } = await import('node:crypto');
        headers['X-Regem-Signature'] = createHmac('sha256', row.clientSecret).update(body).digest('hex');
      }
      const r = await fetch(url, { method: 'POST', headers, body });
      return r.ok;
    } catch {
      return false;
    }
  }
}
