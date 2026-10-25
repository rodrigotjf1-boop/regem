import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import {
  ClienteDmsId,
  ClienteHub,
  type AplicativoAprovado,
  type AvisoRegistrado,
  type ChamadaAtendida,
  type ChamadaRegistrada,
  type ErroDoProduto,
  type ItemDeParada,
  type ListaDeAprovados,
} from '../../dms/integracao-dms';
import { aceitaIntegracoes, lerConfigHub, semCredencialDoRegem, versaoNoAr } from './hub.regras';
import { lerParceirosLigados, parceirosQueValem } from './parceiros.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O HUB DA DMS no Regem (Hub DMS, F3, parte A2): o cliente do pacote comum (`ClienteHub`), um por processo.
//
// - Registro central: cada chamada da API de integração (quem chamou, a rota, o resultado e a duração; nunca o
//   conteúdo) vai ao hub em lote, a cada 5 s. Quem anota é o middleware (`RegistroDaIntegracao`).
// - Erros: o 5xx da API de integração vai também à lista de erros do hub, limpo de dado pessoal e de credencial.
// - Lista de parada: lida a cada 15 s, só quando muda; o guard recusa a chamada parada (503 `integracao-parada`). Se o
//   hub cair, vale a última lista lida.
// - Batida: a cada minuto, com a versão no ar e a chave própria.
// - Avisos (F3, parte D; pacote 0.4.0): cada envio de aviso a um aplicativo vai ao registro do hub (rota própria; o
//   hub de antes responde 404 e o pacote para de mandar avisos por 30 min, sem tocar nas chamadas), e a lista de
//   parada vale para eles: o job dos avisos pergunta `avisoParado` antes de mandar.
//
// - Aplicativos de parceiro (F4, parte F; pacote 0.9.0): só com `PARCEIROS_LIGADOS`, o cliente lê também a lista de
//   aprovados (um token à parte, com `aplicativos.ler`): ao iniciar e quando a batida mostra versão nova. O que vale
//   dela (`parceirosQueValem`) fica guardado; nenhum parceiro vale antes de a lista de parada ser lida uma vez por este
//   processo (senão um parceiro parado pela F4-7 entraria enquanto o hub está instável).
//
// Nasce DESLIGADO (`HUB_LIGADO`): sem ele, nada sai daqui e nada é parado pelo hub. A chave própria
// (`ACEITAR_INTEGRACOES`) vale com ou sem o hub. Nada aqui espera o hub nem falha a chamada de quem integra: o hub fora
// do ar vira aviso no log. A fila fica na memória do processo (até 5.000 chamadas): um reinício perde o que não saiu,
// e a lista de parada é lida de novo na subida. Só nuvem (o módulo não sobe no servidor da loja).

/** O mesmo motivo de falha só volta ao log depois deste tempo: o hub fora não pode afogar o log a cada 5 s. */
const SILENCIO_DO_MESMO_AVISO_MS = 5 * 60_000;
/** O nome comercial de uma conta fica guardado este tempo (uma consulta por loja por hora, no máximo). */
const NOME_VALE_MS = 60 * 60_000;

/** O `fetch` do cliente do hub, preso às rotas do hub e sem seguir redirecionamento: o token não vai a outro lugar. */
export function buscarSoNoHub(base: string): typeof fetch {
  const origem = new URL(base).origin;
  return (entrada, init) => {
    const texto = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    const alvo = new URL(texto);
    if (alvo.origin !== origem || !alvo.pathname.startsWith('/api/v1/')) return Promise.reject(new Error('endereço fora do hub'));
    return fetch(alvo, { ...init, redirect: 'error' });
  };
}

@Injectable()
export class HubDmsService implements OnModuleInit, OnApplicationShutdown {
  private readonly log = new Logger('HubDms');
  private cliente: ClienteHub | null = null;
  private ultimoAviso: { motivo: string; em: number } | null = null;
  private readonly nomes = new Map<string, { nome: string | null; ate: number }>();
  /** Os aplicativos de parceiro que valem, da última lista de aprovados recebida (só com `PARCEIROS_LIGADOS`). */
  private parceiros: Map<string, AplicativoAprovado> | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** Mandando ao hub e lendo a lista de parada (`HUB_LIGADO`). */
  get ligado(): boolean {
    return this.cliente !== null;
  }

  /** A chave própria do Padrão (§10): falsa = a API recusa toda chamada de integração, com ou sem o hub. */
  get aceitaIntegracoes(): boolean {
    return aceitaIntegracoes();
  }

  /** A fila, os erros guardados, a versão da lista e a última falha (para o diagnóstico). Nulo: desligado. */
  get estado(): ClienteHub['estado'] | null {
    return this.cliente ? this.cliente.estado : null;
  }

  onModuleInit(): void {
    if (ehServidorLocal()) return;
    if (!aceitaIntegracoes()) this.log.warn('ACEITAR_INTEGRACOES: a API de integração recusa toda chamada (503 integracao-parada).');
    const c = lerConfigHub();
    if (!c.ligado) {
      if (c.motivo) this.log.error(`hub desligado: ${c.motivo}`);
      return;
    }
    this.cliente = new ClienteHub({
      url: c.url,
      recurso: c.recurso,
      dmsId: new ClienteDmsId({ emissor: c.emissor, aplicativo: c.aplicativo, segredo: c.segredo }),
      produto: 'regem',
      versao: versaoNoAr(),
      aceitaIntegracoes: () => aceitaIntegracoes(),
      aoFalhar: (motivo) => this.avisar(motivo),
      buscar: buscarSoNoHub(c.url),
      ...(lerParceirosLigados() ? { aprovados: { aoMudar: (lista: ListaDeAprovados) => this.guardarParceiros(lista) } } : {}),
    });
    this.cliente.iniciar();
    this.log.log(
      `hub ligado (${c.url}): registro da API de integração, erros, batida e lista de parada` +
        `${lerParceirosLigados() ? ', e a lista de aplicativos de parceiro' : ''}.`,
    );
  }

  /** A lista de aprovados mudou: guarda o que vale; o que fica de fora vai ao log (sem dado da empresa, só o motivo). */
  private guardarParceiros(lista: ListaDeAprovados): void {
    const { validos, fora } = parceirosQueValem(lista);
    this.parceiros = validos;
    for (const f of fora) this.log.warn(`aplicativo de parceiro ${f.aplicativo} fora da lista que vale no Regem: ${f.motivo}`);
  }

  /**
   * O aplicativo de parceiro aprovado para este client_id, ou nulo: com `PARCEIROS_LIGADOS` desligado, com o hub
   * desligado, antes de a lista de parada ser lida uma vez por este processo, ou fora da lista que vale. Quem chama decide
   * antes se o client_id é de um produto da DMS (esse nunca é parceiro).
   */
  parceiroAprovado(clientId: string | null | undefined): AplicativoAprovado | null {
    if (!clientId || !this.cliente || !lerParceirosLigados()) return null;
    if (this.cliente.estado.paradaVersao === null) return null;
    return this.parceiros?.get(clientId) ?? null;
  }

  /**
   * Todos os aplicativos de parceiro que valem agora, com as mesmas guardas de `parceiroAprovado` (a chave, o hub e a
   * parada lida uma vez). É a lista que a fila dos avisos usa: o aplicativo fora dela não recebe nada.
   */
  parceirosAprovados(): AplicativoAprovado[] {
    if (!this.cliente || !lerParceirosLigados()) return [];
    if (this.cliente.estado.paradaVersao === null) return [];
    return [...(this.parceiros?.values() ?? [])];
  }

  /** Lê a lista de aprovados agora (a leitura normal é ao iniciar e quando a batida mostra versão nova). */
  async lerAprovadosAgora(): Promise<void> {
    if (this.cliente) await this.cliente.lerAprovados();
  }

  /** No desligamento: para os relógios e manda o que falta, uma vez. */
  async onApplicationShutdown(): Promise<void> {
    const cliente = this.cliente;
    this.cliente = null;
    if (cliente) await cliente.parar();
  }

  /** A parada que vale para esta chamada, pela última lista lida (nula: pode atender). Desligado: nunca para. */
  parado(chamada: ChamadaAtendida): ItemDeParada | null {
    return this.cliente ? this.cliente.parado(chamada) : null;
  }

  /** Anota uma chamada para o registro central. Desligado: nada. */
  registrar(chamada: ChamadaRegistrada): void {
    if (this.cliente) this.cliente.registrar(chamada);
  }

  /**
   * A parada que vale para um aviso (o aplicativo que recebe, cada prefixo do acesso e o tipo do aviso), pela última
   * lista lida. Nula: pode mandar. Desligado: nunca para (a chave própria é conferida à parte, por quem manda).
   */
  avisoParado(aviso: { aplicativo: string; ligacaoPrefixos?: readonly (string | null | undefined)[]; tipo: string }): ItemDeParada | null {
    return this.cliente ? this.cliente.avisoParado(aviso) : null;
  }

  /** Anota um aviso mandado para o registro do hub. Desligado: nada. */
  registrarAviso(aviso: AvisoRegistrado): void {
    if (this.cliente) this.cliente.registrarAviso(aviso);
  }

  /** Anota um erro para a lista de erros do hub (sem as credenciais do Regem; o pacote limpa o resto). Desligado: nada. */
  erro(erro: ErroDoProduto): void {
    if (!this.cliente) return;
    this.cliente.erro({ ...erro, tipo: semCredencialDoRegem(erro.tipo), mensagem: semCredencialDoRegem(erro.mensagem) });
  }

  /**
   * O nome comercial da conta (a loja; sem loja, a empresa), guardado por uma hora. Nunca rejeita: sem o nome, o registro
   * vai sem ele.
   */
  async nomeDaConta(tenantId: string, unidadeId: string | null): Promise<string | null> {
    const chave = unidadeId ?? tenantId;
    const guardado = this.nomes.get(chave);
    if (guardado && guardado.ate > Date.now()) return guardado.nome;
    try {
      const r: any = await this.db.execute(sql`
        select coalesce(u.nome, e.nome) as nome
          from empresa e
          left join unidade u on u.id = ${unidadeId}::uuid and u.tenant_id = e.id
         where e.id = ${tenantId}::uuid`);
      const nome = ((r.rows ?? r)[0]?.nome as string | undefined) ?? null;
      if (this.nomes.size > 10_000) this.nomes.clear();
      this.nomes.set(chave, { nome, ate: Date.now() + NOME_VALE_MS });
      return nome;
    } catch (e: any) {
      this.avisar(`nome da conta para o registro do hub não saiu: ${e?.message ?? e}`);
      return null;
    }
  }

  /** Manda a fila agora (o envio normal é a cada 5 s). */
  async enviarAgora(): Promise<void> {
    if (this.cliente) await this.cliente.enviar();
  }

  /** Lê a lista de parada agora (a leitura normal é a cada 15 s, só quando muda). */
  async lerParadaAgora(): Promise<void> {
    if (this.cliente) await this.cliente.lerParada();
  }

  /** Falha de envio ou de leitura (hub fora, rede, recusa): aviso no log, sem repetir o mesmo motivo a cada volta. */
  private avisar(motivo: string): void {
    const agora = Date.now();
    if (this.ultimoAviso && this.ultimoAviso.motivo === motivo && agora - this.ultimoAviso.em < SILENCIO_DO_MESMO_AVISO_MS) return;
    this.ultimoAviso = { motivo, em: agora };
    this.log.warn(`hub: ${motivo}`);
  }
}
