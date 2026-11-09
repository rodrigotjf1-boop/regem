import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { minutosDaPausa, pausarPeloAtendente } from './robo-pausa';
import { sql } from 'drizzle-orm';
import { exigirBooleano } from '../../common/exigir';

/** Opções do "o robô volta sozinho em" (minutos; 0 = só quando alguém retomar). */
export const OPCOES_PAUSA = [15, 30, 60, 120, 240, 0];
/** Opções da tolerância do aviso de atraso: minutos além do tempo prometido ao cliente (mig 347). */
export const OPCOES_TOLERANCIA_ATRASO = [0, 5, 10, 15, 20, 30];
import { eq } from 'drizzle-orm';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig } from '../../db/schema';
import { AuthUser } from '../../auth/auth-user';
import { WhatsappService } from './whatsapp.service';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { comMarcaDoRobo } from './mensagens-do-robo';
import { OPCOES_A_PARTIR_DO, OPCOES_DEPOIS_MIN, OPCOES_DE_NOVO_DIAS, TEXTO_PADRAO, ajustesNovos, lerAvaliacao } from './pedir-avaliacao';

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
  private readonly logger = new Logger('WhatsappProvedor');
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

  // ===== Ajustes do robô (mig 342) =====
  // Por quanto tempo o robô fica calado depois que o humano assume (ou que ele mesmo chama o atendente).
  async roboConfig(tenantId: string) {
    return {
      pausaMinutos: await minutosDaPausa(this.db, tenantId),
      opcoesPausa: OPCOES_PAUSA,
      ...(await this.avisosDoRobo(tenantId)),
      opcoesToleranciaAtraso: OPCOES_TOLERANCIA_ATRASO,
      // "Pedir avaliação" depois da entrega (mig 365): os ajustes, o que saiu no mês e as opções da tela.
      avaliacao: {
        ...(await lerAvaliacao(this.db, tenantId)),
        opcoes: { depoisMin: OPCOES_DEPOIS_MIN, aPartirDo: OPCOES_A_PARTIR_DO, deNovoDias: OPCOES_DE_NOVO_DIAS },
        textoPadrao: TEXTO_PADRAO,
      },
    };
  }

  /**
   * Salva os ajustes do "Pedir avaliação" (mig 365) — SÓ as colunas dele (um escritor por coluna — V82): o ausente
   * mantém (V16), os liga/desliga só verdadeiro/falso (V15), o link só do Google, a mensagem com {link}; ligar exige o
   * link. Cada mudança vai para a auditoria.
   */
  async salvarAvaliacao(ator: AuthUser, dto: any) {
    const antes = await lerAvaliacao(this.db, ator.tenantId);
    const novo = ajustesNovos(dto, antes);
    // Na linha que já existe, grava SÓ o que a tela mandou (V16): duas telas salvando ao mesmo tempo não desfazem o ajuste
    // uma da outra. Sem linha ainda, entra tudo (o que não veio é o padrão).
    const colunas = {
      ativa: sql`avaliacao_ativa = excluded.avaliacao_ativa`,
      link: sql`avaliacao_link = excluded.avaliacao_link`,
      texto: sql`avaliacao_texto = excluded.avaliacao_texto`,
      depoisMin: sql`avaliacao_depois_min = excluded.avaliacao_depois_min`,
      soSemProblema: sql`avaliacao_so_sem_problema = excluded.avaliacao_so_sem_problema`,
      aPartirDo: sql`avaliacao_a_partir_do = excluded.avaliacao_a_partir_do`,
      deNovoDias: sql`avaliacao_de_novo_dias = excluded.avaliacao_de_novo_dias`,
    };
    const mudar = (Object.keys(colunas) as (keyof typeof colunas)[]).filter((k) => dto[k] !== undefined).map((k) => colunas[k]);
    await this.db.execute(sql`
      insert into robo_config (tenant_id, avaliacao_ativa, avaliacao_link, avaliacao_texto, avaliacao_depois_min,
                               avaliacao_so_sem_problema, avaliacao_a_partir_do, avaliacao_de_novo_dias, atualizado_por)
      values (${ator.tenantId}::uuid, ${novo.ativa}, ${novo.link}, ${novo.texto === TEXTO_PADRAO ? null : novo.texto}, ${novo.depoisMin},
              ${novo.soSemProblema}, ${novo.aPartirDo}, ${novo.deNovoDias}, ${ator.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set ${sql.join(mudar, sql`, `)}, atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
    const mudou: Record<string, { de: unknown; para: unknown }> = {};
    for (const k of ['ativa', 'link', 'texto', 'depoisMin', 'soSemProblema', 'aPartirDo', 'deNovoDias'] as const)
      if (antes[k] !== novo[k]) mudou[k] = { de: antes[k], para: novo[k] };
    if (Object.keys(mudou).length)
      await this.auditoria.registrar({
        tenantId: ator.tenantId,
        atorId: ator.colaboradorId,
        atorPerfil: ator.categoria,
        tipo: 'config',
        acao: antes.ativa !== novo.ativa ? (novo.ativa ? 'pedir_avaliacao_ligado' : 'pedir_avaliacao_desligado') : 'pedir_avaliacao_alterado',
        entidadeTipo: 'robo_config',
        entidadeId: ator.tenantId,
        detalhe: mudou,
      });
    return this.roboConfig(ator.tenantId);
  }

  /**
   * Os avisos automáticos da loja: o de atraso (mig 347) e o lembrete do pedido que ficou pela metade no robô (mig 349).
   * Os dois nascem desligados; sem linha, o padrão.
   */
  private async avisosDoRobo(
    tenantId: string,
  ): Promise<{ avisoAtraso: boolean; avisoAtrasoToleranciaMin: number; lembreteCarrinho: boolean; conferirEntrega: boolean }> {
    const r: any = await this.db.execute(
      sql`select aviso_atraso, aviso_atraso_tolerancia_min, lembrete_carrinho, conferir_entrega from robo_config where tenant_id = ${tenantId}::uuid`,
    );
    const l = (r?.rows ?? r ?? [])[0];
    return {
      avisoAtraso: l?.aviso_atraso === true,
      avisoAtrasoToleranciaMin: l ? Number(l.aviso_atraso_tolerancia_min) : 10,
      lembreteCarrinho: l?.lembrete_carrinho === true,
      // "Chegou tudo certo?" depois da entrega (B1, mig 352): nasce desligado.
      conferirEntrega: l?.conferir_entrega === true,
    };
  }

  /**
   * Salva os ajustes do robô. Cada campo é opcional e o ausente MANTÉM o que estava (V16): a tela grava um de cada vez.
   * Os liga/desliga (aviso de atraso, lembrete do carrinho) só como verdadeiro/falso (V15). Cada mudança vai para a
   * auditoria.
   */
  async salvarRoboConfig(ator: AuthUser, dto: any) {
    const temPausa = dto?.pausaMinutos !== undefined;
    const temAviso = dto?.avisoAtraso !== undefined;
    const temTolerancia = dto?.avisoAtrasoToleranciaMin !== undefined;
    const temLembrete = dto?.lembreteCarrinho !== undefined;
    const temConferir = dto?.conferirEntrega !== undefined;
    if (!temPausa && !temAviso && !temTolerancia && !temLembrete && !temConferir)
      throw new BadRequestException(
        'Nada para salvar: informe pausaMinutos, avisoAtraso, avisoAtrasoToleranciaMin, lembreteCarrinho ou conferirEntrega.',
      );
    const v = dto?.pausaMinutos;
    if (temPausa && (typeof v !== 'number' || !OPCOES_PAUSA.includes(v)))
      throw new BadRequestException(`pausaMinutos deve ser um destes: ${OPCOES_PAUSA.join(', ')} (0 = até alguém retomar).`);
    const aviso = temAviso ? exigirBooleano(dto.avisoAtraso, 'avisoAtraso') : undefined;
    const tol = dto?.avisoAtrasoToleranciaMin;
    if (temTolerancia && (typeof tol !== 'number' || !OPCOES_TOLERANCIA_ATRASO.includes(tol)))
      throw new BadRequestException(`avisoAtrasoToleranciaMin deve ser um destes: ${OPCOES_TOLERANCIA_ATRASO.join(', ')}.`);
    const lembrete = temLembrete ? exigirBooleano(dto.lembreteCarrinho, 'lembreteCarrinho') : undefined;
    const conferir = temConferir ? exigirBooleano(dto.conferirEntrega, 'conferirEntrega') : undefined;

    const de = await minutosDaPausa(this.db, ator.tenantId);
    const antes = await this.avisosDoRobo(ator.tenantId);
    const pausa = temPausa ? v : de;
    const ligado = aviso ?? antes.avisoAtraso;
    const tolerancia = temTolerancia ? tol : antes.avisoAtrasoToleranciaMin;
    const lembra = lembrete ?? antes.lembreteCarrinho;
    const confere = conferir ?? antes.conferirEntrega;
    await this.db.execute(sql`
      insert into robo_config (tenant_id, pausa_minutos, aviso_atraso, aviso_atraso_tolerancia_min, lembrete_carrinho, conferir_entrega, atualizado_por)
      values (${ator.tenantId}::uuid, ${pausa}, ${ligado}, ${tolerancia}, ${lembra}, ${confere}, ${ator.colaboradorId}::uuid)
      on conflict (tenant_id) do update
         set pausa_minutos = excluded.pausa_minutos, aviso_atraso = excluded.aviso_atraso,
             aviso_atraso_tolerancia_min = excluded.aviso_atraso_tolerancia_min,
             lembrete_carrinho = excluded.lembrete_carrinho,
             conferir_entrega = excluded.conferir_entrega,
             atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
    const registrar = (acao: string, detalhe: Record<string, unknown>) =>
      this.auditoria.registrar({
        tenantId: ator.tenantId,
        atorId: ator.colaboradorId,
        atorPerfil: ator.categoria,
        tipo: 'config',
        acao,
        entidadeTipo: 'robo_config',
        entidadeId: ator.tenantId,
        detalhe,
      });
    if (de !== pausa) await registrar('robo_pausa_alterada', { de, para: pausa });
    if (antes.avisoAtraso !== ligado) await registrar(ligado ? 'aviso_atraso_ligado' : 'aviso_atraso_desligado', { tolerancia });
    if (antes.avisoAtrasoToleranciaMin !== tolerancia)
      await registrar('aviso_atraso_tolerancia_alterada', { de: antes.avisoAtrasoToleranciaMin, para: tolerancia });
    if (antes.lembreteCarrinho !== lembra) await registrar(lembra ? 'lembrete_carrinho_ligado' : 'lembrete_carrinho_desligado', {});
    if (antes.conferirEntrega !== confere) await registrar(confere ? 'conferir_entrega_ligado' : 'conferir_entrega_desligado', {});
    return this.roboConfig(ator.tenantId);
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

  // Cada mensagem com `doRobo` (mig 385): a loja mandou e saiu da resposta do robô — a tela oferece "Corrigir" nela. Vale
  // para as duas vias e para o servidor da loja (whatsapp/da-loja chega aqui); sem a 385, todas `false`.
  async mensagens(tenantId: string, chaves: string) {
    const lista: any[] =
      (await this.provedorDe(tenantId)) === 'cloud'
        ? await this.cloud.mensagens(tenantId, chaves)
        : await this.evolution.mensagens(tenantId, chaves);
    return comMarcaDoRobo(this.db, tenantId, lista, this.logger);
  }

  // Envio manual do painel (o humano assume a conversa do robo): enviado, o robô fica calado nesta conversa pelo
  // tempo da loja (robo-pausa.ts) — senão ele responde por cima do atendente na mensagem seguinte do cliente.
  async enviar(tenantId: string, numero: string, texto: string, por?: string | null) {
    const r = (await this.provedorDe(tenantId)) === 'cloud'
      ? await this.cloud.enviarTexto(tenantId, numero, texto)
      : await this.evolution.enviar(tenantId, numero, texto);
    const tel = String(numero ?? '').split('@')[0].replace(/\D/g, '');
    if (tel) {
      await pausarPeloAtendente(this.db, { tenantId, telefone: tel, motivo: 'atendente', por: por ?? null }).catch(
        (e: any) => this.logger.warn(`envio do atendente: pausa não gravada: ${e?.message ?? e}`),
      );
    }
    return r;
  }

  /**
   * O cardápio em PDF para o número da conversa (o botão da caixa de conversas), pela via da loja (Bloco 6): na API
   * oficial, o PDF sobe à Meta e vai como documento (só na janela de 24 h); na Evolution, como sempre.
   */
  async enviarCardapio(tenantId: string, numero: string, cardapioId?: string) {
    if ((await this.provedorDe(tenantId)) !== 'cloud') return this.evolution.enviarCardapio(tenantId, numero, cardapioId);
    const { pdf, arquivo, legenda, itens } = await this.evolution.pdfDoCardapio(tenantId, cardapioId);
    await this.cloud.enviarDocumentoPdf(tenantId, numero, pdf, arquivo, legenda);
    return { ok: true, itens };
  }
}
