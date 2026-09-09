import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig, whatsappNumero } from '../../db/schema';
import { TERMO_PROVEDOR } from './whatsapp-provedor.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Modelo de NÚMEROS de WhatsApp por PAPEL × PROVEDOR (mig 225) — épico 2 provedores.
//   papel 'principal' = chatbot só responde (nunca inicia); status/dúvidas.
//   papel 'marketing' = disparo de campanha.
// O mesmo número pode ocupar os 2 papéis. Cada número tem sua instância (Evolution)
// ou phone_number_id (Cloud oficial).
//
// TRANSIÇÃO (Fase 1): a tabela nova é a fonte de verdade de LEITURA, com FALLBACK nas
// colunas legadas de cardapio_config (evolution_instancia/marketing_instancia/
// wa_cloud_*), para que a conexão por QR e o envio legado (que ainda leem
// cardapio_config) continuem funcionando sem regressão. Ao SALVAR pela tela nova,
// fazemos dual-write (grava nas duas) até a Fase 2 migrar o caminho de envio.
export type Papel = 'principal' | 'marketing';
export type Provedor = 'evolution' | 'cloud';

export interface NumeroResolvido {
  papel: Papel;
  provedor: Provedor;
  numero: string | null;
  instancia: string | null;
  phoneId: string | null;
  wabaId: string | null;
  status: string;
  verificado: boolean;
  vinculado: boolean;
}

@Injectable()
export class WhatsappNumeroService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private async cfgDe(tenantId: string) {
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId));
    if (!cfg) throw new NotFoundException('Cardápio não configurado.');
    return cfg;
  }

  // Resolve UM papel COMPONDO as duas fontes durante a transição:
  //  - a ESCOLHA de provedor + dados do Cloud (phone_id/waba) + número/verificado vêm
  //    de whatsapp_numero (a tela nova grava aqui);
  //  - a INSTÂNCIA do Evolution vem SEMPRE de cardapio_config, porque é lá que a
  //    conexão por QR (fluxo legado) grava — assim nunca fica instância velha.
  async resolver(tenantId: string, papel: Papel): Promise<NumeroResolvido> {
    const [row] = await this.db
      .select()
      .from(whatsappNumero)
      .where(
        and(
          eq(whatsappNumero.tenantId, tenantId),
          eq(whatsappNumero.papel, papel),
          isNull(whatsappNumero.unidadeId),
        ),
      );
    const cfg = await this.cfgDe(tenantId);
    // Provedor: linha nova manda; senão o da loja (principal) ou evolution (marketing).
    const provedor = (row?.provedor ??
      (papel === 'principal' ? cfg.provedor : 'evolution') ??
      'evolution') as Provedor;

    if (provedor === 'evolution') {
      const instancia = (papel === 'principal' ? cfg.evolutionInstancia : cfg.marketingInstancia) ?? null;
      return {
        papel,
        provedor,
        numero: row?.numero ?? (papel === 'principal' ? cfg.evolutionNumero ?? cfg.whatsapp : null) ?? null,
        instancia,
        phoneId: null,
        wabaId: null,
        status: instancia ? 'conectado' : 'desconectado',
        verificado: !!row?.verificado,
        vinculado: !!instancia,
      };
    }
    // cloud
    const phoneId = row?.phoneId ?? cfg.waCloudPhoneId ?? null;
    return {
      papel,
      provedor,
      numero: row?.numero ?? cfg.waCloudNumero ?? null,
      instancia: null,
      phoneId,
      wabaId: row?.wabaId ?? cfg.waCloudWabaId ?? null,
      status: phoneId ? 'conectado' : 'desconectado',
      verificado: !!row?.verificado,
      vinculado: !!phoneId,
    };
  }

  // Estado dos DOIS papéis para a tela de configuração + textos dos termos.
  async listar(tenantId: string) {
    const [principal, marketing] = await Promise.all([
      this.resolver(tenantId, 'principal'),
      this.resolver(tenantId, 'marketing'),
    ]);
    return { principal, marketing, termo: TERMO_PROVEDOR };
  }

  // Upsert manual (o índice único é por expressão coalesce(unidade_id,…) → não dá p/
  // usar onConflict do Drizzle direto). Grava whatsapp_numero + dual-write no legado.
  async salvarNumero(
    tenantId: string,
    papel: Papel,
    dto: {
      provedor?: string;
      numero?: string | null;
      instancia?: string | null;
      phoneId?: string | null;
      wabaId?: string | null;
      verificado?: boolean;
      termoAceito?: string | null;
    },
  ) {
    if (papel !== 'principal' && papel !== 'marketing')
      throw new BadRequestException("Papel inválido (use 'principal' ou 'marketing').");
    const provedor = (dto.provedor === 'cloud' ? 'cloud' : 'evolution') as Provedor;
    const numero = dto.numero ? String(dto.numero).replace(/\D/g, '') : null;
    const patch = {
      provedor,
      numero,
      instancia: dto.instancia ?? null,
      phoneId: dto.phoneId ? String(dto.phoneId).trim() : null,
      wabaId: dto.wabaId ? String(dto.wabaId).trim() : null,
      verificado: !!dto.verificado,
      termoAceito: dto.termoAceito ?? null,
      updatedAt: new Date(),
    };

    const [existe] = await this.db
      .select({ id: whatsappNumero.id })
      .from(whatsappNumero)
      .where(
        and(
          eq(whatsappNumero.tenantId, tenantId),
          eq(whatsappNumero.papel, papel),
          isNull(whatsappNumero.unidadeId),
        ),
      );
    if (existe) {
      await this.db.update(whatsappNumero).set(patch).where(eq(whatsappNumero.id, existe.id));
    } else {
      await this.db.insert(whatsappNumero).values({ tenantId, papel, status: 'desconectado', ...patch });
    }

    await this.sincronizarLegado(tenantId, papel, provedor, patch);
    return this.resolver(tenantId, papel);
  }

  // Dual-write MÍNIMO: só o que a tela gerencia. NÃO toca em evolution_instancia/
  // marketing_instancia — essas são da CONEXÃO por QR (fluxo legado), que continua dono.
  private async sincronizarLegado(
    tenantId: string,
    papel: Papel,
    provedor: Provedor,
    patch: { numero: string | null; phoneId: string | null; wabaId: string | null },
  ) {
    const cfg = await this.cfgDe(tenantId);
    const set: any = { updatedAt: new Date() };
    if (papel === 'principal') {
      // O provedor da loja (usado pelo webhook/provedorDe legado) é o do PRINCIPAL.
      set.provedor = provedor;
      if (provedor === 'cloud') {
        set.waCloudPhoneId = patch.phoneId;
        set.waCloudWabaId = patch.wabaId;
        set.waCloudNumero = patch.numero;
      } else if (patch.numero) {
        set.evolutionNumero = patch.numero; // só o número de exibição
      }
    }
    // marketing: nada no legado (marketing_instancia é da conexão por QR).
    await this.db.update(cardapioConfig).set(set).where(eq(cardapioConfig.id, cfg.id));
  }

  // Reseta a ESCOLHA de um papel (apaga a linha em whatsapp_numero). NÃO desconecta a
  // instância nem apaga histórico — desconectar é ação separada (fluxo de QR/Cloud).
  async remover(tenantId: string, papel: Papel) {
    await this.db
      .delete(whatsappNumero)
      .where(
        and(
          eq(whatsappNumero.tenantId, tenantId),
          eq(whatsappNumero.papel, papel),
          isNull(whatsappNumero.unidadeId),
        ),
      );
    return { ok: true };
  }
}
