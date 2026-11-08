import { ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthUser } from '../../auth/auth-user';
import { entregarAoRobo } from '../whatsapp/entregar-ao-robo';
import {
  MENSAGENS_POR_MINUTO,
  type TesteDoAtendente,
  criarTeste,
  escolherCardapioDoTeste,
  gravarMensagem,
  lerNovoTeste,
  lerTextoDoCliente,
  mensagemParaORobo,
  mensagensDoTeste,
  mensagensDoUsuarioNoMinuto,
  roboDisponivelParaTeste,
  testeDaEmpresa,
  testeParaATela,
} from './teste-do-atendente';
import {
  LIMITE_DO_CONHECIMENTO,
  type RegistrarAuditoria,
  apagarItem,
  criarItem,
  editarItem,
  itensDaEmpresa,
} from '../cardapio/conhecimento-do-atendente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TREINAR O ATENDENTE (F4 do atendente virtual, mig 382; protótipo `mockups/regem-central-atendimento.html`): a conversa de
// TESTE com o robô de verdade (`teste-do-atendente.ts`) e o que ele APRENDEU (`cardapio/conhecimento-do-atendente.ts`).
// Só gerente e presidente (a rota confere — RBAC no servidor); a empresa é sempre a da sessão. Só na nuvem: o robô mora lá.

export const ROBO_INDISPONIVEL = { statusCode: 409, code: 'ROBO_INDISPONIVEL', message: 'O atendente virtual não está disponível nesta instalação.' };
export const SEM_CARDAPIO = {
  statusCode: 409,
  code: 'SEM_CARDAPIO',
  message: 'Ative o cardápio online da loja antes de testar o atendente: é nele que o atendente consulta preços, horários e taxas.',
};
/** O texto da linha 'sistema' quando o robô não recebeu a mensagem do teste (a tela para de esperar). */
export const TEXTO_NAO_RECEBEU = 'O atendente virtual não recebeu esta mensagem agora. Mande de novo daqui a pouco.';

@Injectable()
export class TreinoDoAtendenteService {
  private readonly logger = new Logger('TreinoDoAtendente');
  /** A busca da entrega ao robô (o teste troca por uma de mentira e confere o corpo que sai). */
  buscar: typeof fetch = (url, init) => fetch(url, init);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // Criar, editar e apagar o que o atendente aprendeu fica na auditoria. Opcional: os testes montam sem ela.
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private registrar(): RegistrarAuditoria | undefined {
    return this.auditoria ? (e) => this.auditoria!.registrar(e as any) : undefined;
  }

  private exigirRobo(): void {
    if (!roboDisponivelParaTeste()) throw new ConflictException(ROBO_INDISPONIVEL);
  }

  private async teste(user: AuthUser, id: string): Promise<TesteDoAtendente> {
    const t = await testeDaEmpresa(this.db, user.tenantId, id);
    if (!t) throw new NotFoundException('Conversa de teste não encontrada.');
    return t;
  }

  // ───────────────────────── a conversa de teste ─────────────────────────

  /**
   * Abre uma conversa de teste no canal escolhido (as instruções e o perfil dele) e com "simular fora do horário". Funciona
   * com o robô desligado na loja e sem WhatsApp/Instagram conectado (é para testar antes de ligar). Recusas antes de gravar
   * (V86): a escolha (400), o robô indisponível nesta instalação (409 `ROBO_INDISPONIVEL`) e a empresa sem cardápio ativo
   * (409 `SEM_CARDAPIO`). Abrir apaga as conversas de teste da empresa paradas há mais de 7 dias.
   */
  async criarTeste(user: AuthUser, dto: unknown) {
    const lido = lerNovoTeste(dto);
    this.exigirRobo();
    const cardapioId = await escolherCardapioDoTeste(this.db, user.tenantId, lido.canal);
    if (!cardapioId) throw new ConflictException(SEM_CARDAPIO);
    const t = await criarTeste(this.db, { tenantId: user.tenantId, colaboradorId: user.colaboradorId }, lido, cardapioId);
    return { id: t.id, canal: t.canal, foraDoHorario: t.foraDoHorario, esperandoResposta: false, mensagens: [] };
  }

  /** A conversa de teste DESTA empresa (outra = 404), na ordem em que foi gravada, e se a tela ainda espera o robô. */
  async verTeste(user: AuthUser, id: string) {
    const t = await this.teste(user, id);
    const { mensagens, agora } = await mensagensDoTeste(this.db, t.id);
    return testeParaATela(t, mensagens, agora);
  }

  /**
   * O "cliente" do teste escreve: grava a mensagem e entrega ao robô de verdade (n8n) no formato das outras vias, com a
   * chave `teste:<id>`. Recusas ANTES de gravar (V86): o texto (400), a conversa de outra empresa (404), o robô indisponível
   * (409), o cardápio que sumiu ou foi desativado (409) e o limite de 20 mensagens por minuto por pessoa (429). O robô que
   * não recebe (fora do ar, recusou): `entregue: false` e uma linha 'sistema' dizendo isso (a tela para de esperar).
   */
  async mandarMensagem(user: AuthUser, id: string, dto: unknown) {
    const texto = lerTextoDoCliente(dto);
    const t = await this.teste(user, id);
    this.exigirRobo();
    if (!t.cardapio?.token || !t.cardapio.ativo) throw new ConflictException(SEM_CARDAPIO);
    if ((await mensagensDoUsuarioNoMinuto(this.db, user.tenantId, user.colaboradorId)) >= MENSAGENS_POR_MINUTO)
      throw new HttpException(
        {
          statusCode: 429,
          code: 'MUITAS_MENSAGENS',
          message: `Muitas mensagens de teste em pouco tempo (até ${MENSAGENS_POR_MINUTO} por minuto). Espere um minuto e mande de novo.`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const mensagem = await gravarMensagem(this.db, t, { autor: 'cliente', texto });
    const entregue = await entregarAoRobo(mensagemParaORobo(t as TesteDoAtendente & { cardapio: NonNullable<TesteDoAtendente['cardapio']> }, texto, mensagem.id), this.buscar);
    if (entregue) return { mensagem, entregue: true };
    this.logger.warn(`teste do atendente: o robô não recebeu a mensagem (empresa ${t.tenantId}, teste ${t.id})`);
    await gravarMensagem(this.db, t, { autor: 'sistema', texto: TEXTO_NAO_RECEBEU });
    return { mensagem, entregue: false, motivo: 'robo_nao_recebeu' };
  }

  // ───────────────────────── o que ele aprendeu ─────────────────────────

  async listarConhecimento(user: AuthUser) {
    return { itens: await itensDaEmpresa(this.db, user.tenantId), limite: LIMITE_DO_CONHECIMENTO };
  }

  criarConhecimento(user: AuthUser, dto: unknown) {
    return criarItem(this.db, this.quem(user), dto, this.registrar());
  }

  editarConhecimento(user: AuthUser, id: string, dto: unknown) {
    return editarItem(this.db, this.quem(user), id, dto, this.registrar());
  }

  apagarConhecimento(user: AuthUser, id: string) {
    return apagarItem(this.db, this.quem(user), id, this.registrar());
  }

  private quem(user: AuthUser) {
    return { tenantId: user.tenantId, colaboradorId: user.colaboradorId, categoria: user.categoria, nome: user.nome ?? null };
  }
}
