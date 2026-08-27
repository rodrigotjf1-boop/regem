import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig } from '../../db/schema';
import { AuthUser } from '../../auth/auth-user';
import { WhatsappService } from './whatsapp.service';
import { WhatsappCloudService } from './whatsapp-cloud.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Escolha do PROVEDOR de WhatsApp pela loja (F2c).
//
// O texto dos termos mora AQUI, não no front, e é servido pelo mesmo endpoint que a
// tela consome. Assim o que o gestor lê é literalmente o que fica gravado na
// auditoria — sem chance de o front mostrar uma versão e o registro guardar outra,
// que é justamente o furo que inutilizaria o aceite numa discussão futura.
export const TERMO_PROVEDOR = {
  versao: '2026-08-27',
  evolution:
    'Conexão NÃO OFICIAL, por leitura de QR Code. O número pode ser bloqueado ou banido ' +
    'pela Meta a qualquer momento, sem aviso prévio e sem direito a recurso, e a recuperação ' +
    'depende exclusivamente dela. O uso e o risco são de responsabilidade exclusiva da minha ' +
    'empresa. Não há custo por mensagem.',
  cloud:
    'API OFICIAL da Meta. As mensagens são cobradas pela Meta DIRETAMENTE da minha empresa, ' +
    'conforme a tabela e as categorias definidas por ela, que podem mudar a qualquer tempo. ' +
    'Mensagem iniciada pela empresa exige modelo aprovado e meio de pagamento cadastrado na ' +
    'conta do WhatsApp Business. O número fica registrado na Meta e sai do aplicativo comum ' +
    'do WhatsApp.',
} as const;

export type Provedor = 'evolution' | 'cloud';

@Injectable()
export class WhatsappProvedorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly evolution: WhatsappService,
    private readonly cloud: WhatsappCloudService,
  ) {}

  private async cfgDe(tenantId: string) {
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId));
    if (!cfg) throw new NotFoundException('Cardápio não configurado.');
    return cfg;
  }

  // Estado para a tela: qual provedor está escolhido, o que cada um tem conectado, e
  // o texto dos termos que a tela deve exibir.
  async estado(tenantId: string) {
    const cfg = await this.cfgDe(tenantId);
    return {
      provedor: (cfg.provedor ?? 'evolution') as Provedor,
      termo: TERMO_PROVEDOR,
      evolution: {
        vinculado: !!cfg.evolutionInstancia,
        instancia: cfg.evolutionInstancia ?? null,
        numero: cfg.evolutionNumero ?? null,
      },
      cloud: {
        vinculado: !!cfg.waCloudPhoneId,
        phoneNumberId: cfg.waCloudPhoneId ?? null,
        wabaId: cfg.waCloudWabaId ?? null,
        numero: cfg.waCloudNumero ?? null,
      },
    };
  }

  // Troca o provedor da loja. Exige aceite explícito do termo daquele provedor.
  async definir(
    ator: AuthUser,
    dto: {
      provedor?: string;
      aceite?: boolean;
      termoVersao?: string;
      waCloudPhoneId?: string;
      waCloudWabaId?: string;
      waCloudNumero?: string;
    },
  ) {
    const alvo = String(dto?.provedor ?? '') as Provedor;
    if (alvo !== 'evolution' && alvo !== 'cloud')
      throw new BadRequestException("Provedor inválido (use 'evolution' ou 'cloud').");
    if (dto?.aceite !== true) throw new BadRequestException('É preciso aceitar os termos do provedor.');
    if (String(dto?.termoVersao ?? '') !== TERMO_PROVEDOR.versao)
      // A tela leu uma versão antiga do termo (aba aberta há dias, deploy no meio).
      // Recusar é melhor que gravar um aceite de texto que o gestor não viu.
      throw new BadRequestException('Os termos foram atualizados. Recarregue a página e leia de novo.');

    const cfg = await this.cfgDe(ator.tenantId);
    const de = (cfg.provedor ?? 'evolution') as Provedor;

    // Sem sobreposição: dois provedores ativos ao mesmo tempo fazem o cliente receber
    // resposta em dobro. Quem troca precisa soltar o atual antes.
    if (alvo !== de) {
      if (de === 'evolution' && cfg.evolutionInstancia)
        throw new BadRequestException(
          'Desconecte o WhatsApp atual (QR Code) antes de mudar para a API oficial.',
        );
      if (de === 'cloud' && cfg.waCloudPhoneId)
        throw new BadRequestException(
          'Desvincule o número da API oficial antes de voltar para a conexão por QR Code.',
        );
    }

    const patch: any = { provedor: alvo, updatedAt: new Date() };
    if (alvo === 'cloud') {
      const pid = String(dto?.waCloudPhoneId ?? '').trim();
      if (pid) {
        if (!/^[0-9]{5,32}$/.test(pid))
          throw new BadRequestException('Identificação do número (Phone Number ID) inválida.');
        // O índice único parcial da mig 214 é a trava real; esta checagem só troca o
        // erro cru do banco por uma mensagem que o gestor entende.
        const donos = await this.db
          .select({ tenantId: cardapioConfig.tenantId })
          .from(cardapioConfig)
          .where(eq(cardapioConfig.waCloudPhoneId, pid));
        if (donos.some((d) => d.tenantId !== cfg.tenantId))
          throw new BadRequestException('Este número da API oficial já pertence a outra loja.');
        patch.waCloudPhoneId = pid;
        patch.waCloudWabaId = String(dto?.waCloudWabaId ?? '').trim() || null;
        patch.waCloudNumero = String(dto?.waCloudNumero ?? '').replace(/\D/g, '') || null;
      }
    }

    await this.db.update(cardapioConfig).set(patch).where(eq(cardapioConfig.id, cfg.id));

    // O texto INTEIRO vai para a auditoria, não só a versão: é isso que sustenta o
    // aceite se um dia o lojista disser que não foi avisado.
    await this.auditoria.registrar({
      tenantId: cfg.tenantId,
      atorId: ator.colaboradorId,
      atorPerfil: ator.categoria,
      tipo: 'config',
      acao: 'whatsapp_provedor_alterado',
      entidadeTipo: 'cardapio_config',
      entidadeId: cfg.id,
      detalhe: {
        de,
        para: alvo,
        termoVersao: TERMO_PROVEDOR.versao,
        termoTexto: TERMO_PROVEDOR[alvo],
        waCloudPhoneId: patch.waCloudPhoneId ?? null,
      },
    });

    return this.estado(cfg.tenantId);
  }

  // Desvincula o número da API oficial (o equivalente ao "Desconectar" do Evolution).
  async desvincularCloud(ator: AuthUser) {
    const cfg = await this.cfgDe(ator.tenantId);
    if (!cfg.waCloudPhoneId) throw new BadRequestException('Nenhum número da API oficial vinculado.');
    await this.db
      .update(cardapioConfig)
      .set({ waCloudPhoneId: null, waCloudWabaId: null, waCloudNumero: null, updatedAt: new Date() })
      .where(eq(cardapioConfig.id, cfg.id));
    await this.auditoria.registrar({
      tenantId: cfg.tenantId,
      atorId: ator.colaboradorId,
      atorPerfil: ator.categoria,
      tipo: 'config',
      acao: 'whatsapp_cloud_desvinculado',
      entidadeTipo: 'cardapio_config',
      entidadeId: cfg.id,
      detalhe: { phoneNumberId: cfg.waCloudPhoneId },
    });
    return this.estado(cfg.tenantId);
  }

  // ===== Despacho do inbox por provedor (F2b) =====
  // O painel chama sempre os mesmos endpoints; quem decide de onde vem o historico
  // e este servico. No Evolution o proprio Evolution guarda as conversas; na Cloud
  // elas vem da tabela whatsapp_mensagem, porque a Meta nao guarda nada.

  private async provedorDe(tenantId: string): Promise<Provedor> {
    const [cfg] = await this.db
      .select({ provedor: cardapioConfig.provedor })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId));
    return ((cfg?.provedor ?? 'evolution') as Provedor);
  }

  async conversas(tenantId: string) {
    return (await this.provedorDe(tenantId)) === 'cloud'
      ? this.cloud.listarConversas(tenantId)
      : this.evolution.listarConversas(tenantId);
  }

  async mensagens(tenantId: string, chaves: string) {
    return (await this.provedorDe(tenantId)) === 'cloud'
      ? this.cloud.mensagens(tenantId, chaves)
      : this.evolution.mensagens(tenantId, chaves);
  }

  // Envio manual do painel (o humano assume a conversa do robo).
  async enviar(tenantId: string, numero: string, texto: string) {
    return (await this.provedorDe(tenantId)) === 'cloud'
      ? this.cloud.enviarTexto(tenantId, numero, texto)
      : this.evolution.enviar(tenantId, numero, texto);
  }
}
