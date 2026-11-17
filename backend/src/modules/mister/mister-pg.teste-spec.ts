import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHash, randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { perfilPadrao } from '../../auth/permissoes';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { hojeISO, horaNoFuso, somarDias } from '../../common/data';
import { uuidDeChave } from '../../common/id-deterministico';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PausaDoCanalService } from '../delivery/pausa-do-canal.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { EstoqueService } from '../estoque/estoque.service';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { RelatoriosService } from '../relatorios/relatorios.service';
import { ModuloService } from '../modulo/modulo.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { MisterConsoleService } from './mister-console.service';
import { FERRAMENTAS, FERRAMENTA_DO_QUE_FALTA, INSTRUCOES_DO_MISTER, TETOS, TEXTOS_DO_AGENTE } from './mister-agente.regras';
import { MisterAgenteService } from './mister-agente.service';
import { MisterAvisosConfigService } from './mister-avisos-config.service';
import { MisterAvisosService } from './mister-avisos.service';
import { AvisosNaTelaService } from './avisos-na-tela.service';
import { MisterAvisosHistoricoService } from './mister-avisos-historico.service';
import { MAX_TENTATIVAS_CONSULTA_DA_NOTA } from '../fiscal/fiscal.service';
import { IfoodService } from '../integracoes/ifood/ifood.service';
import { IbptService } from '../fiscal/ibpt/ibpt.service';
import { MisterEntradaService } from './mister-entrada.service';
import { MisterDocumentosService } from './mister-documentos.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { FRASES_DO_DOCUMENTO } from '../../common/documento-por-foto';
import { MisterPropostasService } from './mister-propostas.service';
import { TEXTOS_DA_PROPOSTA, TEXTOS_DO_LINK } from './mister-procedimentos';
import { MODELO_DO_AVISO } from './mister-modelos';
import { EvolutionEntradaService } from '../whatsapp/evolution-entrada.service';
import { MisterFerramentasService } from './mister-ferramentas.service';
import { MisterFilaService } from './mister-fila.service';
import { MisterRelatoriosConfigService } from './mister-relatorios-config.service';
import { MisterRelatoriosService } from './mister-relatorios.service';
import { MisterQualidadeService } from './mister-qualidade.service';
import { MisterAvaliacaoService } from './mister-avaliacao.service';
import { MisterSegurancaService } from './mister-seguranca.service';
import { MisterSentinelaService } from './mister-sentinela.service';
import { INSTRUCOES_DO_SENTINELA } from './mister-sentinela';
import { MisterInstrucoesService } from './mister-instrucoes.service';
import { INSTRUCOES_DO_MENTOR, versaoDoTexto } from './mister-instrucoes';
import { CASOS_DA_AVALIACAO, CasoDaAvaliacao, versaoDasInstrucoes } from './mister-avaliacao-casos';
import { PRECOS_LIDOS_EM } from '../ia/ia.regras';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { MisterQrService } from './mister-qr.service';
import { assinaturaDaInstancia } from '../../common/segredo-robo';
import { MisterVinculoService } from './mister-vinculo.service';
import * as regras from './mister.regras';
import { TEXTOS, idDoBotaoDaEmpresa } from './mister.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O MISTER (migs 417 e 418), contra o Postgres real, com a Meta e a IA de mentira (nenhum teste fala com a Meta nem
// com um modelo de IA).
//
// Este arquivo NÃO é uma spec sozinha: quem o roda é a `ia/ia-empresa-pg.spec.ts`, que já aplica a 415 — o painel do
// console lê as tabelas dela, e duas specs aplicando a mesma migration só-nuvem em paralelo disputam trava no banco que
// o CI divide (ERR-451). Aqui se aplicam a 415 e a 417 em sequência, no mesmo arquivo de teste.
//
// O que se prova — as regras de separação entre empresas, uma a uma: o telefone só representa alguém depois de ligado
// com o código (único na nuvem inteira, 10 minutos, uma vez); quem não está ligado leva a resposta fixa, sem dado de
// ninguém, e no máximo uma a cada 12 horas; quem deixou de valer (saiu, foi rebaixado, a empresa desligou o módulo)
// deixa de ser reconhecido na mensagem seguinte; o telefone em duas empresas é perguntado e nunca atendido na errada;
// a chave geral desligada cala tudo; o console vê situação e volume, nunca chave, telefone ou conversa.
//
// As PERGUNTAS (mig 418): a mensagem entra na fila uma vez e a entrada não espera a IA; a fila entrega uma conversa por
// vez, juntando as mensagens seguidas; a pega vence; o agente chama o modelo com as ferramentas e devolve o resultado do
// serviço da tela; o escopo (empresa, loja, permissões, valores em reais) é do servidor, e o que o modelo escreve não o
// muda; quem perde o acesso no meio não é respondido; a IA que falha tem a sua frase; os tetos e o filtro de saída.
// A IA de mentira segue um ROTEIRO em ordem (LIC-567): nunca escolhe a resposta por palavra do pedido.
const URL_PG = process.env.TEST_PG_URL;
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const GRAPH = 'https://graph.facebook.com/v25.0';
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

type Pedido = { url: string; metodo: string; corpo: any };

class NumeroDeMentira extends MisterNumeroService {
  pedidos: Pedido[] = [];
  /** O que a Meta de mentira responde a cada pedido: `undefined` = o padrão (200 com o que aquele endereço devolve). */
  responder: (p: Pedido) => { status: number; corpo: any } | undefined = () => undefined;
  protected async buscar(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) {
    const p: Pedido = { url, metodo: init?.method ?? 'GET', corpo: init?.body ? JSON.parse(init.body) : null };
    this.pedidos.push(p);
    // M3a: a mídia de mentira — os metadados na Graph API e o arquivo no endereço temporário (os dois pedem o Bearer).
    const meta = new RegExp(`^${GRAPH.replace(/\./g, '\\.')}/(\\d+)$`).exec(url)?.[1];
    const arq = /^https:\/\/lookaside\.fbsbx\.com\/whatsapp_business\/attachments\/\?mid=(\d+)$/.exec(url)?.[1];
    const m = this.midias.get(meta ?? arq ?? '');
    if (m && init?.headers?.Authorization === 'Bearer token-de-teste') {
      if (meta) {
        const corpo = { url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${meta}`, mime_type: m.mime, file_size: m.bytes.length };
        return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) };
      }
      const b = m.bytes;
      return { ok: true, status: 200, json: async () => ({}), text: async () => '', arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
    }
    const r = this.responder(p) ?? { status: 200, corpo: this.padrao(p) };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corpo, text: async () => JSON.stringify(r.corpo) };
  }
  /** Os modelos que a conta da Meta de mentira tem (a leitura devolve os que casam com o filtro `name`; o pedido inclui). */
  modelosDaMeta: any[] = [];
  /** M3a: as fotos e PDFs que a Meta de mentira tem, pelo id da mídia. */
  midias = new Map<string, { mime: string; bytes: Buffer }>();
  private padrao(p: Pedido): any {
    if (p.url.endsWith('/messages')) return { messages: [{ id: `wamid.saida.${randomUUID()}` }] };
    if (p.url.includes('/phone_numbers')) return { data: [] };
    if (p.url.includes('fields=display_phone_number')) return { display_phone_number: '+55 21 90000-0000', verified_name: 'Mister', quality_rating: 'GREEN', whatsapp_business_manager_messaging_limit: 'TIER_2K' };
    if (p.url.includes('/message_templates') && p.metodo === 'POST') {
      this.modelosDaMeta.push({ name: p.corpo.name, language: p.corpo.language, status: 'PENDING', category: p.corpo.category });
      return { id: `t${randomInt(1e9, 1e10)}`, status: 'PENDING', category: p.corpo.category };
    }
    if (p.url.includes('/message_templates')) {
      // O filtro `name` da Meta acha por trecho.
      const nome = decodeURIComponent(/[?&]name=([^&]+)/.exec(p.url)?.[1] ?? '');
      return { data: this.modelosDaMeta.filter((t) => String(t.name).includes(nome)) };
    }
    return { success: true };
  }
  /**
   * As mensagens que saíram pelo número: para quem, o texto e os botões. O MODELO da Meta aparece como
   * "modelo:<nome>:<parâmetro 1>|<parâmetro 2>", com o código do botão em `botoes[0].id`.
   */
  get enviadas(): { para: string; texto: string; botoes: { id: string; titulo: string }[]; link?: { titulo: string; url: string } }[] {
    return this.pedidos
      .filter((p) => p.url.endsWith('/messages') && p.corpo?.to)
      .map((p) => {
        if (p.corpo.type === 'template') {
          const [corpo, botao] = p.corpo.template.components;
          return {
            para: p.corpo.to,
            texto: `modelo:${p.corpo.template.name}:${corpo.parameters.map((x: any) => x.text).join('|')}`,
            botoes: [{ id: botao.parameters[0].payload, titulo: 'modelo' }],
          };
        }
        // O botão de link (F4.2a): `interactive.type = 'cta_url'`, sem botões de resposta.
        if (p.corpo.type === 'interactive' && p.corpo.interactive.type === 'cta_url')
          return {
            para: p.corpo.to,
            texto: p.corpo.interactive.body.text,
            botoes: [],
            link: { titulo: p.corpo.interactive.action.parameters.display_text, url: p.corpo.interactive.action.parameters.url },
          };
        return {
          para: p.corpo.to,
          texto: p.corpo.type === 'text' ? p.corpo.text.body : p.corpo.interactive.body.text,
          botoes: p.corpo.type === 'interactive' ? p.corpo.interactive.action.buttons.map((b: any) => ({ id: b.reply.id, titulo: b.reply.title })) : [],
        };
      });
  }
}

/** A IA de mentira: a porta de verdade (`pedir`, o medidor, a escolha da chave) com o cliente do provedor trocado por um roteiro. */
class IaDeMentira extends IaEmpresaService {
  /** Cada pedido que chegou ao "provedor", copiado na hora (o laço muda a lista de mensagens depois). */
  pedidos: any[] = [];
  /** O que o provedor responde, em ordem. `{ erro }` = o provedor recusa com aquele erro. */
  roteiro: any[] = [];
  protected criarCliente() {
    return {
      messages: {
        create: async (pedido: any) => {
          this.pedidos.push(JSON.parse(JSON.stringify(pedido)));
          const passo = this.roteiro.shift();
          if (!passo) throw new Error('a IA de mentira ficou sem roteiro');
          if (passo.erro) throw passo.erro;
          return passo;
        },
      },
    } as any;
  }
}

/**
 * M3a: os documentos com a leitura do botão segurável. `juntar = 2` segura as leituras até as duas chegarem: os dois toques
 * leem "confirmar" ANTES de qualquer um lançar — o cruzamento de verdade, que o `Promise.all` sozinho não garante.
 */
class DocumentosDeTeste extends MisterDocumentosService {
  juntar = 0;
  private esperando: Array<() => void> = [];
  protected async documentoDoBotao(documentoId: string, empresas: string[]) {
    const d = await super.documentoDoBotao(documentoId, empresas);
    if (this.juntar > 1)
      await new Promise<void>((solta) => {
        this.esperando.push(solta);
        if (this.esperando.length >= this.juntar) {
          this.esperando.forEach((f) => f());
          this.esperando = [];
          this.juntar = 0;
        }
      });
    return d;
  }
}

/** A rotina dos avisos com a leitura do vigia trocável: `incidentes` = os incidentes de mentira; null = o banco de verdade. */
class AvisosDeTeste extends MisterAvisosService {
  incidentes: any[] | null = [];
  protected async incidentesDoVigia(so?: string[]) {
    return this.incidentes ?? super.incidentesDoVigia(so);
  }
  /** A leitura do chat do iFood sem resposta, trocável: a lista de mentira; null = o banco de verdade. */
  chats: any[] | null = [];
  protected async chatsSemResposta(so?: string[]) {
    return this.chats ?? super.chatsSemResposta(so);
  }
}

export function testesDoMisterComPostgres(): void {
  const descrever = URL_PG ? describe : describe.skip;

  descrever('o Mister: o número, a entrada do WhatsApp e o console (Postgres)', () => {
    const pool = new Pool({ connectionString: URL_PG });
    const db = drizzle(pool, { schema }) as any;
    const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
    const auditados: any[] = [];
    const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
    const numero = new NumeroDeMentira(db);
    const modulos = new ModuloService(db, auditoria);
    const vinculo = new MisterVinculoService(db, numero, auditoria);
    const fila = new MisterFilaService(db);
    const entrada = new MisterEntradaService(db, numero, modulos, fila, auditoria);
    // O agente: a IA segue um roteiro; o Painel, os Relatórios e o Estoque são os serviços de verdade (só SQL); o quadro
    // do Delivery, a cozinha e o servidor são dublês que ANOTAM com que empresa e loja foram chamados.
    const ia = new IaDeMentira(db);
    const lidos: any[] = [];
    const haMin = (min: number) => new Date(Date.now() - min * 60_000 - 5_000);
    /** A comanda do pedido 1 da fila de mentira: um uuid de verdade, para a ligação com o pedido do canal. */
    const COMANDA_1 = randomUUID();
    const deliveryDeMentira = {
      listar: async (tenantId: string, atual: string | null) => {
        lidos.push(['delivery', tenantId, atual]);
        return [
          { status: 'novo', canal: 'ifood', displayId: '4830', criadoEm: haMin(5) },
          { status: 'confirmado', canal: 'ifood', displayId: '4821', numero: 284, criadoEm: haMin(22) },
          { status: 'despachado', canal: 'cardapio', displayId: '77', criadoEm: haMin(40) },
          { status: 'confirmado', canal: 'cardapio', displayId: '78', criadoEm: haMin(90), agendamento: new Date(Date.now() + 3 * 3_600_000) },
          { status: 'concluido', canal: 'ifood', displayId: '4700', criadoEm: haMin(120) },
          { status: 'cancelado', canal: 'ifood', displayId: '4701', criadoEm: haMin(130) },
        ];
      },
    };
    const cozinhaDeMentira = {
      getCores: async () => ({ verdeAteMin: 5, amareloAteMin: 10, usaPreparo: true, usaEntregue: true }),
      filaKds: async (tenantId: string, opts: any) => {
        lidos.push(['cozinha', tenantId, opts?.unidadeId]);
        return {
          cores: {},
          nuvemComServidor: false,
          pedidos: [
            { id: 'c1', comandaId: COMANDA_1, status: 'preparo', origem: 'delivery', plataforma: 'iFood', senha: 12, senhaPrefixo: 'D', criadoEm: haMin(22) },
            { id: 'c2', comandaId: COMANDA_1, status: 'pronto', origem: 'delivery', plataforma: 'iFood', senha: 12, senhaPrefixo: 'D', criadoEm: haMin(22) },
            { id: 'c3', comandaId: 'comanda-2', status: 'recebido', origem: 'balcao', plataforma: null, senha: 7, senhaPrefixo: 'B', criadoEm: haMin(3) },
            { id: 'c4', comandaId: 'comanda-3', status: 'entregue', origem: 'balcao', plataforma: null, senha: 6, senhaPrefixo: 'B', criadoEm: haMin(50) },
          ],
        };
      },
    };
    const servidorDeMentira = {
      minhaLojaServidor: async (tenantId: string) => {
        lidos.push(['servidor', tenantId]);
        return { instalado: true, online: true, versao: '1.30.12', ultimoSync: haMin(2).toISOString(), backup: { ok: true, horas: 3 }, precisaManutencao: false };
      },
    };
    // As três telas da parte 2 das perguntas: dublês que anotam a empresa e a loja pedidas e devolvem o que a tela devolveria.
    const vendasDeMentira = {
      remocoesItens: async (tenantId: string, de: string, ate: string, atual: string | null) => {
        lidos.push(['itens-removidos', tenantId, de, ate, atual]);
        return [
          { id: 'r1', data: haMin(50), ator: 'Edu Balcão', descricao: 'Refrigerante lata', justificativa: '' },
          { id: 'r2', data: haMin(10), ator: 'Carlos Lima', descricao: 'Batata grande', justificativa: 'cliente desistiu' },
        ];
      },
    };
    const escalaDeMentira = {
      findAll: async (tenantId: string, _data: string, unidadeId?: string) => {
        lidos.push(['escala', tenantId, unidadeId]);
        const turno = { turnoInicio: '00:00:00', turnoFim: '08:00:00' };
        return [
          { colaboradorId: 'col-2', colaboradorNome: 'Caio Caixa', setorNome: 'Salão', presenca: 'presente', ...turno },
          { colaboradorId: 'col-1', colaboradorNome: 'Bia Chapa', setorNome: 'Cozinha', presenca: 'prevista', ...turno },
          { colaboradorId: 'col-3', colaboradorNome: 'Dani Salão', setorNome: 'Salão', presenca: 'falta_injustificada', ...turno },
          { colaboradorId: null, colaboradorNome: null, setorNome: 'Cozinha', presenca: 'prevista', turnoInicio: '10:00:00', turnoFim: '18:00:00' },
        ];
      },
    };
    const pontoDeMentira = {
      pessoas: async (tenantId: string, _data: string, atual: string | null) => {
        lidos.push(['ponto', tenantId, atual]);
        return [{ colaboradorId: 'col-2', nome: 'Caio Caixa', marcacoes: 1, primeiraEntrada: haMin(95).toISOString(), ultimaMarcacao: { tipo: 'entrada', hora: haMin(95).toISOString() }, trabalhadoMin: 95, status: 'trabalhando' }];
      },
    };
    const ferramentas = new MisterFerramentasService(
      db,
      modulos,
      new DashboardService(db),
      new RelatoriosService(db, { custoEfetivoMapa: async () => ({}) } as any),
      new EstoqueService(db, auditoria as AuditoriaService),
      deliveryDeMentira as any,
      cozinhaDeMentira as any,
      servidorDeMentira as any,
      vendasDeMentira as any,
      escalaDeMentira as any,
      pontoDeMentira as any,
    );
    const agente = new MisterAgenteService(fila, ferramentas, ia, numero);
    // Os avisos (mig 419): o KDS e os eventos são dublês que anotam.
    const avisosConfig = new MisterAvisosConfigService(db, auditoria);
    const kdsAvisos: any[] = [];
    const emitidos: any[] = [];
    // As propostas (F4.1, mig 428): a consulta da nota é um dublê que ANOTA com que empresa, nota e pessoa foi chamada.
    const consultas: any[] = [];
    let respostaDaConsulta: () => Promise<any> = async () => ({ status: 'autorizada', numero: 904 });
    const fiscalDeMentira = {
      consultarNota: async (tenantId: string, notaId: string, atorId: string | null) => {
        consultas.push([tenantId, notaId, atorId]);
        return respostaDaConsulta();
      },
    };
    const propostas = new MisterPropostasService(db, numero, entrada, fiscalDeMentira as any, auditoria);
    // O toque em "Autorizar" chega pela entrada: o serviço das propostas se apresenta a ela, como ao subir o app.
    propostas.onModuleInit();
    const avisos = new AvisosDeTeste(
      db,
      avisosConfig,
      numero,
      modulos,
      { guardarEMostrar: async (p: any) => (kdsAvisos.push(p), { aviso: {}, situacao: 'novo' }) } as any,
      { emit: (n: string, p: any) => emitidos.push([n, p]) } as any,
      entrada,
      propostas,
    );
    // O toque em "Ver o que fazer" chega pela entrada: o serviço dos avisos se apresenta a ela, como ao subir o app.
    avisos.onModuleInit();
    const consoleDoMister = new MisterConsoleService(db, numero, new IaEmpresaService(db));

    // Tudo o que este arquivo cria leva uma marca própria: o banco do CI é dividido com as outras specs.
    const MARCA = randomUUID().slice(0, 8);
    const PHONE_ID = `9${randomInt(1e13, 1e14)}`;
    const WABA = `8${randomInt(1e13, 1e14)}`;
    const NUMERO_DO_MISTER = '5521900000000';
    const telefones: string[] = [];
    const telefone = () => {
      const t = `55219${randomInt(1e7, 1e8)}`;
      telefones.push(t);
      return t;
    };
    const wamid = () => `wamid.${MARCA}.${randomUUID()}`;
    const antes = { token: process.env.WA_CLOUD_TOKEN, app: process.env.WA_CLOUD_APP_ID, cfg: process.env.WA_CLOUD_CONFIG_ID, segredo: process.env.WA_CLOUD_APP_SECRET, edge: process.env.EDGE_MODE, ia: process.env.ANTHROPIC_API_KEY };

    let A: string; // empresa "Burger"
    let B: string; // empresa "Pizzaria"
    let lojaDeA: string; // a "Loja Centro" da empresa A
    const funcao: Record<string, string> = {};
    const pessoa: Record<string, string> = {};
    const usuario = (nome: string, tenant = A, categoria = 'presidente') => ({ tenantId: tenant, colaboradorId: pessoa[nome], categoria, unidadeId: null }) as any;
    const NOME_A = `Burger da Praça ${MARCA}`;
    const NOME_B = `Pizzaria do Porto ${MARCA}`;

    const linha = async (nome: string) => (await q(`select * from mister_vinculo where colaborador_id = $1`, [pessoa[nome]]))[0];
    const mandar = (tel: string, texto: string, extra: { botaoId?: string; wamid?: string; codigoDoModelo?: string } = {}) =>
      entrada.receber({ telefone: tel, texto, botaoId: extra.botaoId ?? null, wamid: extra.wamid ?? wamid(), codigoDoModelo: extra.codigoDoModelo ?? null });
    const modulo = async (tenant: string, ativo: boolean) => {
      await q(`delete from modulo_ativacao where tenant_id = $1 and modulo = 'mister'`, [tenant]);
      await q(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1, null, 'mister', $2)`, [tenant, ativo]);
    };
    /** Deixa o número conectado e a chave geral como pedido, direto no banco. */
    const numeroConectado = (ligado: boolean) =>
      q(
        `insert into mister_numero (id, phone_id, waba_id, numero, nome_exibido, forma, situacao, ligado, conectado_em, situacao_em)
         values (1, $1, $2, $3, 'Mister', 'coexistencia', 'conectado', $4, now(), now())
         on conflict (id) do update set phone_id = excluded.phone_id, waba_id = excluded.waba_id, numero = excluded.numero, nome_exibido = 'Mister',
           forma = 'coexistencia', situacao = 'conectado', motivo = null, ligado = excluded.ligado, conectado_em = now(), situacao_em = now()`,
        [PHONE_ID, WABA, NUMERO_DO_MISTER, ligado],
      );
    const numeroZerado = () =>
      q(`update mister_numero set phone_id = null, waba_id = null, numero = null, nome_exibido = null, forma = null, situacao = 'sem', motivo = null, ligado = false, conectado_em = null where id = 1`);
    /** Gera o código de `nome` e manda do telefone: a pessoa fica ligada. */
    const ligar = async (nome: string, tel: string, tenant = A, categoria = 'presidente') => {
      const r = await vinculo.gerarCodigo(usuario(nome, tenant, categoria));
      expect(await mandar(tel, r.codigo!.mensagem)).toBe('ligou');
      return r.codigo!.codigo;
    };
    const limparConversas = async () => {
      await q(`delete from mister_pergunta where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from mister_proposta where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from mister_documento where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from mister_aviso where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from mister_aviso_regra where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from mister_relatorio where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from mister_relatorio_regra where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from mister_vinculo where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from mister_mensagem where wamid like $1`, [`wamid.${MARCA}.%`]);
      await q(`delete from mister_conversa where telefone = any($1::text[])`, [telefones]);
      telefones.length = 0;
    };

    beforeAll(async () => {
      // A 415, a 417 e a 418 são só da nuvem: o banco do CI é o de uma loja (ERR-273). Duas vezes: as migrations são idempotentes.
      for (let i = 0; i < 2; i++)
        for (const arq of ['415_ia_por_empresa.sql', '417_mister_numero_e_entrada.sql', '418_mister_perguntas.sql', '419_mister_avisos.sql', '420_mister_relatorios.sql', '424_mister_avaliacao.sql', '428_mister_proposta.sql', '432_mister_melhoria_decisao.sql', '433_mister_proposta_link.sql', '372_pedido_estorno.sql', '434_mister_analise.sql', '435_mister_instrucao_troca.sql', '436_mister_numero_provedor.sql', '437_mister_numero_qr.sql', '439_mister_documento.sql'])
          await repetirNaCorridaDeCatalogo(async () => {
            const c = await pool.connect();
            try {
              await c.query('begin');
              await c.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8')));
              await c.query('commit');
            } catch (e) {
              await c.query('rollback').catch(() => {});
              throw e;
            } finally {
              c.release();
            }
          });
      [{ id: A }] = await q(`insert into empresa (nome) values ($1) returning id`, [NOME_A]);
      [{ id: B }] = await q(`insert into empresa (nome) values ($1) returning id`, [NOME_B]);
      for (const [t, sufixo] of [[A, 'a'], [B, 'b']] as const)
        for (const cat of ['presidente', 'gerente', 'execucao'])
          [{ id: funcao[`${cat}-${sufixo}`] }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [t, `F ${cat}`, cat]);
      const criar = async (chave: string, nome: string, tenant: string, f: string) =>
        ([{ id: pessoa[chave] }] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [tenant, nome, funcao[f]]));
      await criar('ana', 'Ana Souza', A, 'presidente-a');
      await criar('carlos', 'Carlos Lima', A, 'gerente-a');
      // O gerente tem loja: é dela que ele fala (e é ela que aparece na parte "Pessoas").
      const [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja Centro') returning id`, [A]);
      lojaDeA = loja;
      await q(`update colaborador set unidade_id = $2 where id = $1`, [pessoa.carlos, loja]);
      await criar('edu', 'Edu Balcão', A, 'execucao-a');
      await criar('anaB', 'Ana Souza', B, 'presidente-b');
    });

    afterAll(async () => {
      const volta = (nome: string, valor: string | undefined) => (valor === undefined ? delete process.env[nome] : (process.env[nome] = valor));
      volta('WA_CLOUD_TOKEN', antes.token);
      volta('WA_CLOUD_APP_ID', antes.app);
      volta('WA_CLOUD_CONFIG_ID', antes.cfg);
      volta('WA_CLOUD_APP_SECRET', antes.segredo);
      volta('EDGE_MODE', antes.edge);
      volta('ANTHROPIC_API_KEY', antes.ia);
      await limparConversas().catch(() => {});
      await numeroZerado().catch(() => {});
      for (const t of ['ia_uso_dia', 'ia_credencial', 'modulo_ativacao', 'cardapio_config', 'titulo_financeiro', 'fornecedor', 'colaborador', 'funcao', 'unidade'])
        await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[A, B]]).catch(() => {});
      await q(`delete from empresa where id = any($1::uuid[])`, [[A, B]]).catch(() => {});
      await pool.end();
    });

    beforeEach(async () => {
      process.env.WA_CLOUD_TOKEN = 'token-de-teste';
      process.env.WA_CLOUD_APP_ID = '111';
      process.env.WA_CLOUD_CONFIG_ID = '222';
      process.env.WA_CLOUD_APP_SECRET = 'segredo-de-teste';
      delete process.env.EDGE_MODE; // como NUVEM
      delete process.env.ANTHROPIC_API_KEY;
      await limparConversas();
      await q(`update colaborador set status = 'ativo', deleted_at = null, funcao_id = $2 where id = $1`, [pessoa.carlos, funcao['gerente-a']]);
      await q(`update colaborador set status = 'ativo', deleted_at = null where id = any($1::uuid[])`, [[pessoa.ana, pessoa.anaB, pessoa.edu]]);
      await q(`update empresa set deleted_at = null where id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from ia_uso_dia where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from ia_credencial where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from cardapio_config where tenant_id = any($1::uuid[])`, [[A, B]]);
      await modulo(A, true);
      await modulo(B, true);
      await numeroConectado(true);
      auditados.length = 0;
      numero.pedidos.length = 0;
      numero.responder = () => undefined;
      ia.pedidos.length = 0;
      ia.roteiro = [];
      lidos.length = 0;
      kdsAvisos.length = 0;
      emitidos.length = 0;
      avisos.incidentes = [];
    });

    // ───────────────────────────── o número e a chave geral ─────────────────────────────

    it('sem número conectado, a mensagem não é do Mister: o webhook segue como sempre e nada é gravado', async () => {
      await numeroZerado();
      const id = wamid();
      expect(await entrada.receberDaMeta(PHONE_ID, { messages: [{ from: telefone(), id, type: 'text', text: { body: 'oi' } }] })).toBe(false);
      expect(await entrada.ehONumeroDoMister(PHONE_ID)).toBe(false);
      expect(await q(`select 1 from mister_mensagem where wamid = $1`, [id])).toEqual([]);
      expect(numero.pedidos).toEqual([]);
    });

    it('conectar na coexistência: acha o número que está no celular, assina o aplicativo, pede a cópia e NÃO liga a chave geral', async () => {
      await numeroZerado();
      numero.responder = (p) => (p.url.includes('/phone_numbers') ? { status: 200, corpo: { data: [{ id: '70001', is_on_biz_app: false }, { id: PHONE_ID, is_on_biz_app: true }] } } : undefined);
      const r = await numero.conectar({ code: 'abc', wabaId: WABA, forma: 'coexistencia' }, { nome: 'Rodrigo' });
      expect(r.avisos).toEqual([]);
      expect(r.numero).toMatchObject({ phoneId: PHONE_ID, wabaId: WABA, numero: NUMERO_DO_MISTER, nome: 'Mister', forma: 'coexistencia', situacao: 'conectado', ligado: false });
      expect(r.numero.conectadoEm).toMatch(ISO);
      const feitos = numero.pedidos.map((p) => `${p.metodo} ${p.url.replace(GRAPH, '').split('?')[0]}${p.corpo?.sync_type ? ` ${p.corpo.sync_type}` : ''}`);
      expect(feitos).toEqual([
        `GET /${WABA}/phone_numbers`,
        'GET /oauth/access_token',
        `POST /${WABA}/subscribed_apps`,
        `GET /${PHONE_ID}`,
        `POST /${PHONE_ID}/smb_app_data smb_app_state_sync`,
        `POST /${PHONE_ID}/smb_app_data history`,
      ]);
      expect(feitos.some((f) => f.includes('/register'))).toBe(false);
      expect((await q(`select alterado_por from mister_numero where id = 1`))[0].alterado_por).toBe('Rodrigo');
      // Conectado e desligado: nada sai.
      await expect(numero.enviar(telefone(), { texto: 'oi' })).rejects.toMatchObject({ motivo: 'desligado' });
    });

    it('conectar avisa quando a Meta não confirma a assinatura ou recusa a cópia — e mesmo assim guarda o número', async () => {
      await numeroZerado();
      numero.responder = (p) =>
        p.url.endsWith('/subscribed_apps') ? { status: 400, corpo: { error: { message: 'sem permissão na conta' } } } : p.url.endsWith('/smb_app_data') ? { status: 400, corpo: { error: { message: 'fora do prazo' } } } : undefined;
      const r = await numero.conectar({ wabaId: WABA, phoneNumberId: PHONE_ID, forma: 'coexistencia' }, { nome: 'Rodrigo' });
      expect(r.numero.situacao).toBe('conectado');
      expect(r.avisos).toHaveLength(2);
      expect(r.avisos[0]).toContain('sem permissão na conta');
      expect(r.avisos[1]).toContain('fora do prazo');
    });

    it('conectar "só na API": exige o PIN de seis dígitos e registra o número; sem forma ou sem conta, recusa antes de falar com a Meta', async () => {
      await numeroZerado();
      await expect(numero.conectar({ wabaId: WABA, phoneNumberId: PHONE_ID }, { nome: 'R' })).rejects.toThrow('Escolha como o número vai funcionar');
      await expect(numero.conectar({ forma: 'api', phoneNumberId: PHONE_ID }, { nome: 'R' })).rejects.toThrow('faltou a conta');
      await expect(numero.conectar({ forma: 'api', wabaId: WABA, phoneNumberId: PHONE_ID, pin: '123' }, { nome: 'R' })).rejects.toThrow('PIN de seis dígitos');
      expect(numero.pedidos).toEqual([]);
      const r = await numero.conectar({ forma: 'api', wabaId: WABA, phoneNumberId: PHONE_ID, pin: '123456' }, { nome: 'R' });
      expect(r.numero).toMatchObject({ forma: 'api', situacao: 'conectado' });
      const registro = numero.pedidos.find((p) => p.url.endsWith('/register'))!;
      expect(registro.corpo).toEqual({ messaging_product: 'whatsapp', pin: '123456' });
      expect(numero.pedidos.some((p) => p.url.endsWith('/smb_app_data'))).toBe(false);
      // A Meta recusa o registro: o número não é guardado como conectado.
      await numeroZerado();
      numero.responder = (p) => (p.url.endsWith('/register') ? { status: 400, corpo: { error: { message: 'PIN errado' } } } : undefined);
      await expect(numero.conectar({ forma: 'api', wabaId: WABA, phoneNumberId: PHONE_ID, pin: '123456' }, { nome: 'R' })).rejects.toThrow('PIN errado');
      expect((await numero.ler()).situacao).toBe('sem');
    });

    it('o número de uma loja não vira o do Mister, e a loja não conecta o número do Mister como dela', async () => {
      await numeroZerado();
      const daLoja = `7${randomInt(1e13, 1e14)}`;
      await q(`insert into cardapio_config (tenant_id, token, ativo, provedor, wa_cloud_phone_id) values ($1, $2, true, 'cloud', $3)`, [A, `tok-${randomUUID()}`, daLoja]);
      await expect(numero.conectar({ forma: 'coexistencia', wabaId: WABA, phoneNumberId: daLoja }, { nome: 'R' })).rejects.toThrow(`já é o WhatsApp de uma loja (${NOME_A})`);
      expect((await numero.ler()).situacao).toBe('sem');
      // O número de marketing mora em outra tabela, que só a nuvem tem: onde ela existe, vale a mesma recusa.
      if ((await q(`select to_regclass('whatsapp_numero') as t`))[0].t) {
        const deMarketing = `5${randomInt(1e13, 1e14)}`;
        await q(`insert into whatsapp_numero (tenant_id, papel, provedor, phone_id, status) values ($1, 'marketing', 'cloud', $2, 'conectado')`, [B, deMarketing]);
        try {
          await expect(numero.conectar({ forma: 'coexistencia', wabaId: WABA, phoneNumberId: deMarketing }, { nome: 'R' })).rejects.toThrow(`já é o WhatsApp de uma loja (${NOME_B})`);
        } finally {
          await q(`delete from whatsapp_numero where phone_id = $1`, [deMarketing]);
        }
      }
      // O outro sentido, pelo cadastro integrado das lojas.
      await numeroConectado(true);
      const cloud = new WhatsappCloudService(db, undefined, undefined, entrada);
      await expect(cloud.finalizarEmbeddedSignup(B, { wabaId: WABA, phoneNumberId: PHONE_ID, papel: 'principal' })).rejects.toThrow('Este número é o do Mister');
      expect(await q(`select 1 from cardapio_config where wa_cloud_phone_id = $1`, [PHONE_ID])).toEqual([]);
    });

    it('a chave geral: só aceita verdadeiro ou falso; desligada, o Mister anota a mensagem e fica calado até com quem está ligado', async () => {
      await expect(numero.liberacao({ ligado: 'sim' }, { nome: 'R' })).rejects.toThrow('ligado');
      await expect(numero.liberacao({}, { nome: 'R' })).rejects.toThrow('ligado');
      const tel = telefone();
      await ligar('ana', tel);
      numero.pedidos.length = 0;
      expect(await numero.liberacao({ ligado: false }, { nome: 'Rodrigo' })).toEqual({ ligado: false });
      const id = wamid();
      expect(await mandar(tel, 'PARAR AVISOS', { wamid: id })).toBe('desligado');
      expect(await mandar(telefone(), 'oi')).toBe('desligado');
      expect(numero.enviadas).toEqual([]);
      expect((await linha('ana')).pausado_em).toBeNull();
      expect((await q(`select desfecho from mister_mensagem where wamid = $1`, [id]))[0].desfecho).toBe('desligado');
      // Código não se gera com o Mister desligado.
      await expect(vinculo.gerarCodigo(usuario('carlos', A, 'gerente'))).rejects.toThrow('ainda não está disponível');
      expect(await numero.liberacao({ ligado: true }, { nome: 'Rodrigo' })).toEqual({ ligado: true });
      expect(await mandar(tel, 'PARAR AVISOS')).toBe('parou');
    });

    it('a Meta deixa de reconhecer o número: a situação vira "caiu" com o motivo; a mensagem seguinte que chega o traz de volta', async () => {
      const tel = telefone();
      numero.responder = (p) => (p.url.endsWith('/messages') ? { status: 400, corpo: { error: { code: 100, error_subcode: 33, message: 'Object with ID does not exist' } } } : undefined);
      await expect(numero.enviar(tel, { texto: 'oi' })).rejects.toBeInstanceOf(FalhaDoEnvioDoMister);
      expect(await numero.ler()).toMatchObject({ situacao: 'caiu', motivo: 'Object with ID does not exist' });
      // Outra recusa qualquer é só a falha daquele envio.
      await numeroConectado(true);
      numero.responder = (p) => (p.url.endsWith('/messages') ? { status: 400, corpo: { error: { code: 131047, message: 'fora da janela' } } } : undefined);
      await expect(numero.enviar(tel, { texto: 'oi' })).rejects.toMatchObject({ motivo: 'meta', status: 400, detalhe: 'fora da janela' });
      expect((await numero.ler()).situacao).toBe('conectado');
      // Caiu, e a Meta volta a entregar: a entrada devolve a situação a conectado.
      await q(`update mister_numero set situacao = 'caiu', motivo = 'x' where id = 1`);
      numero.responder = () => undefined;
      expect(await entrada.receberDaMeta(PHONE_ID, { messages: [{ from: tel, id: wamid(), type: 'text', text: { body: 'oi' } }] })).toBe(true);
      expect(await numero.ler()).toMatchObject({ situacao: 'conectado', motivo: null });
      expect((await numero.ler()).ultimaEntradaEm).toMatch(ISO);
    });

    // ───────────────────────────── ligar o telefone ─────────────────────────────

    it('o código sai para gerente ou presidente, com o link do número do Mister; quem é da execução não gera', async () => {
      const r = await vinculo.gerarCodigo(usuario('ana'));
      expect(r).toMatchObject({ disponivel: true, numeroDoMister: NUMERO_DO_MISTER, ligado: false, final: null, pausado: false });
      expect(r.codigo!.codigo).toMatch(/^[1-9]\d{5}$/);
      expect(r.codigo!.mensagem).toBe(`MISTER ${r.codigo!.codigo}`);
      expect(r.codigo!.link).toBe(`https://wa.me/${NUMERO_DO_MISTER}?text=MISTER%20${r.codigo!.codigo}`);
      expect(r.codigo!.expiraEm).toMatch(ISO);
      const [l] = await q(`select extract(epoch from (codigo_expira_em - now()))::int as s from mister_vinculo where colaborador_id = $1`, [pessoa.ana]);
      expect(l.s).toBeGreaterThan(590);
      expect(l.s).toBeLessThanOrEqual(600);
      expect(auditados.map((a) => a.acao)).toEqual(['mister_whatsapp_codigo']);
      expect(JSON.stringify(auditados)).not.toContain(r.codigo!.codigo);
      // Gerar de novo troca o código: o anterior não liga mais ninguém.
      const r2 = await vinculo.gerarCodigo(usuario('ana'));
      expect(r2.codigo!.codigo).not.toBe(r.codigo!.codigo);
      expect(await mandar(telefone(), r.codigo!.mensagem)).toBe('codigo_nao_vale');
      await expect(vinculo.gerarCodigo(usuario('edu', A, 'execucao'))).rejects.toThrow('Só gerente ou presidente');
      // O token dizia "gerente", mas a pessoa foi rebaixada: o banco é que vale.
      await q(`update colaborador set funcao_id = $2 where id = $1`, [pessoa.carlos, funcao['execucao-a']]);
      await expect(vinculo.gerarCodigo(usuario('carlos', A, 'gerente'))).rejects.toThrow('Só gerente ou presidente');
    });

    it('o código é único na nuvem inteira: duas empresas nunca ficam com o mesmo código vivo', async () => {
      const deA = (await vinculo.gerarCodigo(usuario('ana'))).codigo!.codigo;
      const sorteio = jest.spyOn(regras, 'novoCodigo').mockReturnValueOnce(deA).mockReturnValueOnce(deA).mockReturnValueOnce('654321');
      try {
        const deB = (await vinculo.gerarCodigo(usuario('anaB', B))).codigo!.codigo;
        expect(deB).toBe('654321');
        expect(sorteio).toHaveBeenCalledTimes(3);
      } finally {
        sorteio.mockRestore();
      }
      expect((await q(`select count(*)::int as n from mister_vinculo where codigo = $1`, [deA]))[0].n).toBe(1);
      // E o código de A liga na A — nunca na B, de onde quer que a mensagem venha.
      const tel = telefone();
      expect(await mandar(tel, `MISTER ${deA}`)).toBe('ligou');
      expect((await linha('ana')).telefone).toBe(tel);
      expect((await linha('anaB')).telefone).toBeNull();
    });

    it('ligar: a mensagem com o código liga o telefone à pessoa, o Mister responde com o nome e a empresa, e fica na auditoria', async () => {
      const tel = telefone();
      const codigo = (await vinculo.gerarCodigo(usuario('ana'))).codigo!.codigo;
      auditados.length = 0;
      const id = wamid();
      expect(await mandar(tel, `mister ${codigo}`, { wamid: id })).toBe('ligou');
      const l = await linha('ana');
      expect(l).toMatchObject({ telefone: tel, codigo: null, codigo_expira_em: null, pausado_em: null });
      expect(l.ligado_em).toBeTruthy();
      expect(l.ultima_entrada_em).toBeTruthy();
      expect(numero.enviadas).toEqual([{ para: tel, texto: TEXTOS.ligado('Ana', NOME_A), botoes: [] }]);
      expect(auditados).toEqual([expect.objectContaining({ tenantId: A, atorId: pessoa.ana, acao: 'mister_whatsapp_ligado', origem: 'whatsapp', detalhe: { final: tel.slice(-4) } })]);
      expect(JSON.stringify(auditados)).not.toContain(tel);
      expect(await q(`select telefone, tenant_id, desfecho from mister_mensagem where wamid = $1`, [id])).toEqual([{ telefone: tel, tenant_id: A, desfecho: 'ligou' }]);
      expect(await vinculo.meu(usuario('ana'))).toMatchObject({ ligado: true, final: tel.slice(-4), pausado: false, codigo: null });
      expect((await vinculo.meu(usuario('ana'))).ligadoEm).toMatch(ISO);
    });

    it('o código vale uma vez e dez minutos; a Meta reenviando e o toque duplo não geram segunda resposta', async () => {
      const tel = telefone();
      const codigo = (await vinculo.gerarCodigo(usuario('ana'))).codigo!.codigo;
      const id = wamid();
      expect(await mandar(tel, `MISTER ${codigo}`, { wamid: id })).toBe('ligou');
      numero.pedidos.length = 0;
      expect(await mandar(tel, `MISTER ${codigo}`, { wamid: id })).toBe('repetida'); // o reenvio da Meta
      expect(await mandar(tel, `MISTER ${codigo}`)).toBe('calado'); // o toque duplo de quem acabou de ligar
      expect(numero.enviadas).toEqual([]);
      // Outro telefone com o código já usado: não vale, e não liga.
      const outro = telefone();
      expect(await mandar(outro, `MISTER ${codigo}`)).toBe('codigo_nao_vale');
      expect(numero.enviadas).toEqual([{ para: outro, texto: TEXTOS.codigoNaoVale, botoes: [] }]);
      // Código vencido.
      const vencido = (await vinculo.gerarCodigo(usuario('carlos', A, 'gerente'))).codigo!.codigo;
      await q(`update mister_vinculo set codigo_expira_em = now() - interval '1 second' where colaborador_id = $1`, [pessoa.carlos]);
      expect(await mandar(telefone(), `MISTER ${vencido}`)).toBe('codigo_nao_vale');
      expect((await linha('carlos')).telefone).toBeNull();
      expect((await vinculo.meu(usuario('carlos', A, 'gerente'))).codigo).toBeNull();
    });

    it('um número liga uma pessoa só, por empresa: o segundo é avisado e o primeiro continua ligado', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const codigo = (await vinculo.gerarCodigo(usuario('carlos', A, 'gerente'))).codigo!.codigo;
      numero.pedidos.length = 0;
      expect(await mandar(tel, `MISTER ${codigo}`)).toBe('numero_de_outra_pessoa');
      expect(numero.enviadas).toEqual([{ para: tel, texto: TEXTOS.numeroDeOutraPessoa(NOME_A), botoes: [] }]);
      expect((await linha('ana')).telefone).toBe(tel);
      expect((await linha('carlos')).telefone).toBeNull();
      // Se quem estava com o número deixou de poder (saiu da empresa), o número é solto e o segundo liga.
      await q(`update colaborador set status = 'desligado' where id = $1`, [pessoa.ana]);
      expect(await mandar(tel, `MISTER ${codigo}`)).toBe('ligou');
      expect((await linha('carlos')).telefone).toBe(tel);
      expect((await linha('ana')).telefone).toBeNull();
    });

    it('ninguém adivinha código: cinco errados e o telefone deixa de ser atendido em códigos — até com o certo', async () => {
      const tel = telefone();
      const certo = (await vinculo.gerarCodigo(usuario('ana'))).codigo!.codigo;
      for (let i = 1; i <= 4; i++) expect(await mandar(tel, `MISTER ${100000 + i}`)).toBe('codigo_nao_vale');
      expect(await mandar(tel, 'MISTER 12')).toBe('codigos_demais'); // formato errado também conta
      expect(numero.enviadas.at(-1)).toEqual({ para: tel, texto: TEXTOS.codigosDemais, botoes: [] });
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'MISTER 100009')).toBe('codigo_calado');
      expect(await mandar(tel, `MISTER ${certo}`)).toBe('codigo_calado');
      expect(numero.enviadas).toEqual([]);
      expect((await linha('ana')).telefone).toBeNull();
      // Passada a janela, o código certo (ainda vivo) liga e a contagem zera.
      await q(`update mister_conversa set codigos_desde = now() - interval '61 minutes' where telefone = $1`, [tel]);
      expect(await mandar(tel, `MISTER ${certo}`)).toBe('ligou');
      expect((await q(`select codigos_errados from mister_conversa where telefone = $1`, [tel]))[0].codigos_errados).toBe(0);
    });

    it('o código de quem deixou de poder não liga: rebaixado, desativado ou com o módulo desligado na empresa', async () => {
      const tel = telefone();
      const codigo = (await vinculo.gerarCodigo(usuario('carlos', A, 'gerente'))).codigo!.codigo;
      await q(`update colaborador set funcao_id = $2 where id = $1`, [pessoa.carlos, funcao['execucao-a']]);
      expect(await mandar(tel, `MISTER ${codigo}`)).toBe('sem_acesso');
      await q(`update colaborador set funcao_id = $2, status = 'bloqueado' where id = $1`, [pessoa.carlos, funcao['gerente-a']]);
      expect(await mandar(tel, `MISTER ${codigo}`)).toBe('sem_acesso');
      await q(`update colaborador set status = 'ativo' where id = $1`, [pessoa.carlos]);
      await modulo(A, false);
      expect(await mandar(tel, `MISTER ${codigo}`)).toBe('sem_acesso');
      expect((await linha('carlos')).telefone).toBeNull();
      expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS.semAcesso, TEXTOS.semAcesso, TEXTOS.semAcesso]);
      await modulo(A, true);
      expect(await mandar(tel, `MISTER ${codigo}`)).toBe('ligou');
    });

    // ───────────────────────────── quem não está ligado ─────────────────────────────

    it('telefone que não está ligado: a resposta fixa, sem dado de ninguém, e no máximo uma a cada 12 horas', async () => {
      const tel = telefone();
      await ligar('ana', telefone()); // existe gente ligada na nuvem — e nada dela vaza
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'oi, queria saber das vendas da loja')).toBe('fixa');
      expect(numero.enviadas).toEqual([{ para: tel, texto: TEXTOS.desconhecido, botoes: [] }]);
      expect(numero.enviadas[0].texto).not.toContain(MARCA);
      expect(await mandar(tel, 'alô?')).toBe('fixa_calada');
      expect(await mandar(tel, 'PARAR AVISOS')).toBe('fixa_calada');
      expect(await mandar(tel, 'trocar de empresa')).toBe('fixa_calada');
      expect(numero.enviadas).toHaveLength(1);
      await q(`update mister_conversa set fixa_em = now() - interval '12 hours 1 minute' where telefone = $1`, [tel]);
      expect(await mandar(tel, 'oi')).toBe('fixa');
      expect(numero.enviadas).toHaveLength(2);
      // O texto da mensagem nunca é guardado.
      expect(JSON.stringify(await q(`select * from mister_mensagem where telefone = $1`, [tel]))).not.toContain('vendas');
      expect((await q(`select pendente from mister_conversa where telefone = $1`, [tel]))[0].pendente).toBeNull();
    });

    it('quem deixa de valer deixa de ser reconhecido na mensagem seguinte: desativado, apagado, rebaixado, módulo ou empresa fora', async () => {
      const tel = telefone();
      await ligar('carlos', tel, A, 'gerente');
      const reconhecido = async () => {
        await q(`update mister_conversa set fixa_em = null, provisoria_em = null where telefone = $1`, [tel]);
        return mandar(tel, 'bom dia');
      };
      expect(await reconhecido()).toBe('pergunta');
      await q(`update colaborador set status = 'bloqueado' where id = $1`, [pessoa.carlos]);
      expect(await reconhecido()).toBe('fixa');
      await q(`update colaborador set status = 'ativo', deleted_at = now() where id = $1`, [pessoa.carlos]);
      expect(await reconhecido()).toBe('fixa');
      await q(`update colaborador set deleted_at = null, funcao_id = $2 where id = $1`, [pessoa.carlos, funcao['execucao-a']]);
      expect(await reconhecido()).toBe('fixa');
      await q(`update colaborador set funcao_id = $2 where id = $1`, [pessoa.carlos, funcao['gerente-a']]);
      await modulo(A, false);
      expect(await reconhecido()).toBe('fixa');
      await modulo(A, true);
      await q(`update empresa set deleted_at = now() where id = $1`, [A]);
      expect(await reconhecido()).toBe('fixa');
      await q(`update empresa set deleted_at = null where id = $1`, [A]);
      // Voltou a valer: volta a ser reconhecido, sem ligar de novo.
      expect(await reconhecido()).toBe('pergunta');
      // Desligou por dentro do Regem: o telefone deixa de representar a pessoa.
      const meu = await vinculo.desligar(usuario('carlos', A, 'gerente'));
      expect(meu).toMatchObject({ ligado: false, final: null });
      expect(await reconhecido()).toBe('fixa');
    });

    // ───────────────────────────── a parte "Pessoas" ─────────────────────────────

    it('Pessoas: o presidente vê gerentes e presidentes da empresa dele, com o final do telefone e nunca o número; o gerente recebe só a própria linha', async () => {
      const tel = telefone();
      const telCarlos = telefone();
      await ligar('ana', tel);
      await ligar('carlos', telCarlos, A, 'gerente');
      await ligar('anaB', telefone(), B);
      expect(await mandar(telCarlos, 'PARAR AVISOS')).toBe('parou');
      const doPresidente = await vinculo.pessoas(usuario('ana'));
      expect(doPresidente).toMatchObject({ disponivel: true, numeroDoMister: NUMERO_DO_MISTER, souPresidente: true, total: 2 });
      expect(doPresidente.pessoas).toEqual([
        { colaboradorId: pessoa.ana, nome: 'Ana Souza', nivel: 'presidente', loja: null, voce: true, ligado: true, final: tel.slice(-4), ligadoEm: expect.stringMatching(ISO), pausado: false, pode: ['avisos', 'consulta', 'autorizacao'] },
        { colaboradorId: pessoa.carlos, nome: 'Carlos Lima', nivel: 'gerente', loja: 'Loja Centro', voce: false, ligado: true, final: telCarlos.slice(-4), ligadoEm: expect.stringMatching(ISO), pausado: true, pode: ['avisos', 'consulta'] },
      ]);
      // Nem o telefone inteiro, nem quem não fala com o Mister (execução), nem gente de outra empresa.
      const cru = JSON.stringify(doPresidente);
      for (const proibido of [tel, telCarlos, 'Edu', pessoa.edu, pessoa.anaB]) expect(cru).not.toContain(proibido);
      // O gerente recebe só a própria linha — a dos outros nem sai do servidor.
      const doGerente = await vinculo.pessoas(usuario('carlos', A, 'gerente'));
      expect(doGerente).toMatchObject({ souPresidente: false, total: 1 });
      expect(doGerente.pessoas.map((p) => [p.colaboradorId, p.voce])).toEqual([[pessoa.carlos, true]]);
      expect(JSON.stringify(doGerente)).not.toContain(pessoa.ana);
      // O token dizia "presidente", mas no banco ele é gerente: vale o banco.
      expect((await vinculo.pessoas(usuario('carlos', A, 'presidente'))).pessoas).toHaveLength(1);
      await expect(vinculo.pessoas(usuario('edu', A, 'execucao'))).rejects.toThrow('Só gerente ou presidente');
      // Quem não ligou aparece como não ligado; sem número conectado, a lista avisa que o Mister não está disponível.
      await vinculo.desligar(usuario('carlos', A, 'gerente'));
      await numeroZerado();
      const semNumero = await vinculo.pessoas(usuario('ana'));
      expect(semNumero).toMatchObject({ disponivel: false, numeroDoMister: null });
      expect(semNumero.pessoas[1]).toMatchObject({ colaboradorId: pessoa.carlos, ligado: false, final: null, ligadoEm: null, pausado: false });
    });

    it('desligar: cada um o próprio; o de outra pessoa só o presidente, e só dentro da empresa dele', async () => {
      const tel = telefone();
      const telCarlos = telefone();
      const telB = telefone();
      await ligar('ana', tel);
      await ligar('carlos', telCarlos, A, 'gerente');
      await ligar('anaB', telB, B);
      auditados.length = 0;
      // O gerente não desliga o presidente — nem com um token que diga "presidente".
      await expect(vinculo.desligarPessoa(usuario('carlos', A, 'gerente'), pessoa.ana)).rejects.toThrow('Só o presidente desliga');
      await expect(vinculo.desligarPessoa(usuario('carlos', A, 'presidente'), pessoa.ana)).rejects.toThrow('Só o presidente desliga');
      expect((await linha('ana')).telefone).toBe(tel);
      // O presidente de A não alcança ninguém de B: a gravação filtra pela empresa de quem pede.
      expect(await vinculo.desligarPessoa(usuario('ana'), pessoa.anaB)).toEqual({ desligado: false });
      expect((await linha('anaB')).telefone).toBe(telB);
      await expect(vinculo.desligarPessoa(usuario('ana'), 'nao-e-um-id')).rejects.toThrow('Pessoa inválida');
      expect(auditados).toEqual([]);
      // O presidente desliga o gerente: fica na auditoria (quem fez e de quem) e o telefone deixa de representar a pessoa.
      expect(await vinculo.desligarPessoa(usuario('ana'), pessoa.carlos)).toEqual({ desligado: true });
      expect(await linha('carlos')).toMatchObject({ telefone: null, ligado_em: null, pausado_em: null, codigo: null });
      expect(auditados).toEqual([expect.objectContaining({ tenantId: A, atorId: pessoa.ana, acao: 'mister_whatsapp_desligado', entidadeId: pessoa.carlos, detalhe: { por: 'presidente', colaboradorId: pessoa.carlos } })]);
      expect(await mandar(telCarlos, 'bom dia')).toBe('fixa');
      // De novo, já desligado: não faz nada nem audita outra vez.
      expect(await vinculo.desligarPessoa(usuario('ana'), pessoa.carlos)).toEqual({ desligado: false });
      expect(auditados).toHaveLength(1);
      // Cada um desliga o próprio.
      expect(await vinculo.desligarPessoa(usuario('ana'), pessoa.ana)).toEqual({ desligado: true });
      expect(auditados.at(-1)).toMatchObject({ atorId: pessoa.ana, entidadeId: pessoa.ana, detalhe: { por: 'a própria pessoa' } });
      expect((await vinculo.meu(usuario('ana'))).ligado).toBe(false);
    });

    // ───────────────────────────── parar, voltar e o que ainda não existe ─────────────────────────────

    it('PARAR AVISOS e VOLTAR AVISOS mexem só no vínculo de quem escreveu, com auditoria; pergunta ainda não tem resposta', async () => {
      const tel = telefone();
      const telCarlos = telefone();
      await ligar('ana', tel);
      await ligar('carlos', telCarlos, A, 'gerente');
      auditados.length = 0;
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'Parar os avisos.')).toBe('parou');
      expect((await linha('ana')).pausado_em).toBeTruthy();
      expect((await linha('carlos')).pausado_em).toBeNull();
      expect((await vinculo.meu(usuario('ana'))).pausado).toBe(true);
      expect(await mandar(tel, 'VOLTAR AVISOS')).toBe('voltou');
      expect((await linha('ana')).pausado_em).toBeNull();
      expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS.parou('Ana'), TEXTOS.voltou('Ana')]);
      expect(auditados.map((a) => [a.acao, a.atorId, a.tenantId])).toEqual([
        ['mister_whatsapp_parou', pessoa.ana, A],
        ['mister_whatsapp_voltou', pessoa.ana, A],
      ]);
      // Qualquer outra coisa é uma pergunta: vai para a fila do agente, e a entrada não responde nada na hora.
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'quanto vendi hoje?')).toBe('pergunta');
      expect(await mandar(tel, 'e ontem?')).toBe('pergunta');
      expect(numero.enviadas).toEqual([]);
      expect((await q(`select pergunta, situacao, nivel from mister_pergunta where tenant_id = $1 order by criado_em`, [A])).map((p) => [p.pergunta, p.situacao, p.nivel])).toEqual([
        ['quanto vendi hoje?', 'na_fila', 'presidente'],
        ['e ontem?', 'na_fila', 'presidente'],
      ]);
    });

    // ───────────────────────────── o mesmo telefone em duas empresas ─────────────────────────────

    it('telefone em duas empresas: segue na última em que ligou, troca quando pede e cada comando cai só na empresa da conversa', async () => {
      const tel = telefone();
      await ligar('ana', tel, A);
      await ligar('anaB', tel, B);
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'PARAR AVISOS')).toBe('parou');
      expect((await linha('anaB')).pausado_em).toBeTruthy();
      expect((await linha('ana')).pausado_em).toBeNull();
      // Pede para trocar: o Mister pergunta, com um botão por empresa, em ordem de nome.
      expect(await mandar(tel, 'trocar de empresa')).toBe('perguntou_empresa');
      const pergunta = numero.enviadas.at(-1)!;
      expect(pergunta.texto).toBe('Este WhatsApp está ligado a duas empresas. De qual você quer falar?');
      expect(pergunta.botoes.map((b) => b.id)).toEqual([idDoBotaoDaEmpresa(A), idDoBotaoDaEmpresa(B)]);
      for (const b of pergunta.botoes) expect(b.titulo.length).toBeLessThanOrEqual(20);
      expect(await mandar(tel, 'x', { botaoId: idDoBotaoDaEmpresa(A) })).toBe('escolheu_empresa');
      expect(numero.enviadas.at(-1)!.texto).toBe(TEXTOS.seguindo(NOME_A));
      expect(await mandar(tel, 'PARAR AVISOS')).toBe('parou');
      expect((await linha('ana')).pausado_em).toBeTruthy();
      expect((await q(`select tenant_id from mister_conversa where telefone = $1`, [tel]))[0].tenant_id).toBe(A);
      expect(auditados.filter((a) => a.acao === 'mister_whatsapp_parou').map((a) => a.tenantId)).toEqual([B, A]);
      // Sem pergunta aberta, um número ou o nome de outra empresa no meio da conversa NÃO troca de empresa.
      // Viram perguntas — e caem na fila da empresa da conversa, nunca na outra.
      expect(await mandar(tel, '2')).toBe('pergunta');
      expect(await mandar(tel, NOME_B)).toBe('pergunta');
      expect((await q(`select tenant_id from mister_conversa where telefone = $1`, [tel]))[0].tenant_id).toBe(A);
      expect((await q(`select tenant_id, colaborador_id from mister_pergunta where telefone = $1`, [tel])).map((p) => [p.tenant_id, p.colaborador_id])).toEqual([
        [A, pessoa.ana],
        [A, pessoa.ana],
      ]);
    });

    it('sem saber de qual empresa, o Mister pergunta, guarda a mensagem e só a atende depois da escolha — na empresa escolhida', async () => {
      const tel = telefone();
      await ligar('ana', tel, A);
      await ligar('anaB', tel, B);
      await q(`update mister_conversa set tenant_id = null, escolhida_em = null where telefone = $1`, [tel]);
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'PARAR AVISOS')).toBe('perguntou_empresa');
      expect((await linha('ana')).pausado_em).toBeNull();
      expect((await linha('anaB')).pausado_em).toBeNull();
      expect((await q(`select pendente from mister_conversa where telefone = $1`, [tel]))[0].pendente).toBe('PARAR AVISOS');
      // Resposta que não diz a empresa: pergunta de novo e a mensagem que esperava continua esperando.
      expect(await mandar(tel, 'a de sempre')).toBe('perguntou_empresa');
      expect(numero.enviadas.at(-1)!.texto).toBe(`${TEXTOS.naoEntendiAEmpresa} Este WhatsApp está ligado a duas empresas. De qual você quer falar?`);
      expect((await q(`select pendente from mister_conversa where telefone = $1`, [tel]))[0].pendente).toBe('PARAR AVISOS');
      // Botão de uma empresa que não é dela (forjado): não escolhe nada.
      expect(await mandar(tel, 'x', { botaoId: idDoBotaoDaEmpresa(randomUUID()) })).toBe('perguntou_empresa');
      expect((await linha('ana')).pausado_em).toBeNull();
      expect((await linha('anaB')).pausado_em).toBeNull();
      // Escolhe pelo número da lista: a 2ª em ordem de nome é a Pizzaria.
      expect(await mandar(tel, '2')).toBe('escolheu_empresa');
      expect((await linha('anaB')).pausado_em).toBeTruthy();
      expect((await linha('ana')).pausado_em).toBeNull();
      expect(numero.enviadas.slice(-2).map((m) => m.texto)).toEqual([TEXTOS.seguindo(NOME_B), TEXTOS.parou('Ana')]);
      expect(await q(`select tenant_id, pendente, perguntada_em from mister_conversa where telefone = $1`, [tel])).toEqual([{ tenant_id: B, pendente: null, perguntada_em: null }]);
      // A mensagem que esperava vence em 10 minutos: escolher depois disso não a executa.
      await q(`update mister_vinculo set pausado_em = null where telefone = $1`, [tel]);
      await q(`update mister_conversa set tenant_id = null where telefone = $1`, [tel]);
      expect(await mandar(tel, 'PARAR AVISOS')).toBe('perguntou_empresa');
      await q(`update mister_conversa set pendente_em = now() - interval '11 minutes' where telefone = $1`, [tel]);
      expect(await mandar(tel, NOME_A)).toBe('escolheu_empresa');
      expect((await linha('ana')).pausado_em).toBeNull();
    });

    it('uma das duas empresas desliga o módulo: o telefone passa a ser de uma só e é atendido nela, sem pergunta', async () => {
      const tel = telefone();
      await ligar('ana', tel, A);
      await ligar('anaB', tel, B); // a conversa ficou na B
      await modulo(B, false);
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'PARAR AVISOS')).toBe('parou');
      expect((await linha('ana')).pausado_em).toBeTruthy();
      expect((await linha('anaB')).pausado_em).toBeNull();
      expect(await mandar(tel, 'trocar de empresa')).toBe('uma_empresa_so');
      expect(numero.enviadas.at(-1)!.texto).toBe(TEXTOS.umaEmpresaSo(NOME_A));
    });

    // ───────────────────────────── o webhook ─────────────────────────────

    it('o webhook entrega ao Mister a mensagem do número dele — e ela nunca entra na caixa de conversas de uma loja', async () => {
      const cloud = new WhatsappCloudService(db, undefined, undefined, entrada);
      // A caixa de conversas das lojas só recebe o que passa por `gravar`: é ele que não pode ser chamado.
      const gravar = jest.spyOn(cloud as any, 'gravar');
      const tel = telefone();
      const id = wamid();
      const corpo = (phoneId: string, mensagem: any) => ({ entry: [{ id: WABA, changes: [{ field: 'messages', value: { metadata: { phone_number_id: phoneId }, contacts: [], messages: [mensagem] } }] }] });
      await cloud.processar(corpo(PHONE_ID, { from: tel, id, type: 'text', text: { body: 'oi' } }));
      expect(numero.enviadas).toEqual([{ para: tel, texto: TEXTOS.desconhecido, botoes: [] }]);
      expect(await q(`select desfecho from mister_mensagem where wamid = $1`, [id])).toEqual([{ desfecho: 'fixa' }]);
      expect(gravar).not.toHaveBeenCalled();
      // O botão de resposta chega com o id: é assim que a escolha da empresa é lida.
      await ligar('ana', tel, A);
      await ligar('anaB', tel, B);
      await cloud.processar(corpo(PHONE_ID, { from: tel, id: wamid(), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: idDoBotaoDaEmpresa(A), title: 'Burger' } } }));
      expect((await q(`select tenant_id from mister_conversa where telefone = $1`, [tel]))[0].tenant_id).toBe(A);
      expect(gravar).not.toHaveBeenCalled();
      // Outro número que não é de loja nem do Mister: segue sem dono, como sempre.
      numero.pedidos.length = 0;
      const outro = wamid();
      await cloud.processar(corpo(`6${randomInt(1e13, 1e14)}`, { from: tel, id: outro, type: 'text', text: { body: 'oi' } }));
      expect(numero.pedidos).toEqual([]);
      expect(await q(`select 1 from mister_mensagem where wamid = $1`, [outro])).toEqual([]);
    });

    it('a limpeza diária tira o registro de mensagens com mais de 30 dias e as conversas paradas há mais de 90 — e só isso; no servidor da loja não roda', async () => {
      const velha = wamid();
      const nova = wamid();
      await q(`insert into mister_mensagem (wamid, telefone, recebida_em) values ($1, '5521900000001', now() - interval '31 days'), ($2, '5521900000001', now() - interval '29 days')`, [velha, nova]);
      const parada = telefone();
      const recente = telefone();
      const tel = telefone();
      await ligar('ana', tel);
      await q(`insert into mister_conversa (telefone, ultima_entrada_em, atualizado_em) values ($1, now() - interval '91 days', now() - interval '91 days'), ($2, now() - interval '89 days', now() - interval '200 days')`, [parada, recente]);
      await q(`update mister_conversa set ultima_entrada_em = now() - interval '91 days' where telefone = $1`, [tel]);
      process.env.EDGE_MODE = 'true';
      expect(await entrada.limparMensagens()).toBe(0);
      delete process.env.EDGE_MODE;
      expect(await entrada.limparMensagens()).toBeGreaterThanOrEqual(3);
      expect((await q(`select wamid from mister_mensagem where wamid = any($1::text[])`, [[velha, nova]])).map((l) => l.wamid)).toEqual([nova]);
      expect((await q(`select telefone from mister_conversa where telefone = any($1::text[])`, [[parada, recente, tel]])).map((l) => l.telefone)).toEqual([recente]);
      // A conversa parada some; o vínculo do telefone com a pessoa, não: ela segue reconhecida.
      expect((await linha('ana')).telefone).toBe(tel);
      expect(await mandar(tel, 'PARAR AVISOS')).toBe('parou');
    });

    // ───────────────────────────── o console da distribuição ─────────────────────────────

    it('o painel do console: o número como a Meta o vê, a chave geral e as empresas com situação e volume — sem chave, telefone ou conversa', async () => {
      const tel = telefone();
      const telCarlos = telefone();
      await ligar('ana', tel);
      await ligar('carlos', telCarlos, A, 'gerente');
      await modulo(B, false);
      await q(`insert into ia_credencial (tenant_id, provedor, chave_cifrada, final, situacao) values ($1, 'anthropic', 'v1:segredo-cifrado', 'zzzz', 'sem_credito')`, [A]);
      await q(
        `insert into ia_uso_dia (tenant_id, dia, recurso, provedor, modelo, origem, chamadas, tokens_entrada, tokens_saida)
         values ($1, $2::date, 'copiloto', 'anthropic', 'claude-haiku-5-5', 'lojista', 3, 1000000, 2000000),
                ($1, $2::date - 40, 'copiloto', 'anthropic', 'claude-haiku-5-5', 'lojista', 9, 9000000, 9000000)`,
        [A, hojeISO()],
      );
      numero.pedidos.length = 0;
      const n = await consoleDoMister.painel();
      expect(n.numero).toMatchObject({ situacao: 'conectado', numero: NUMERO_DO_MISTER, nome: 'Mister', forma: 'coexistencia', qualidade: 'green', avisosPorDia: 2000, motivo: null });
      expect(n.numero.conectadoEm).toMatch(ISO);
      expect(n.liberado).toBe(true);
      expect(n.cadastro).toEqual({ appId: '111', configId: '222', graphVersion: 'v25.0', pronto: true });
      expect(numero.pedidos.map((x) => x.url.replace(GRAPH, '').split('?')[0])).toEqual([`/${PHONE_ID}`]);
      // A lista de empresas é outra leitura: buscar nela não pergunta nada à Meta.
      numero.pedidos.length = 0;
      const p = await consoleDoMister.empresas(MARCA);
      expect(numero.pedidos).toEqual([]);
      expect(p.total).toBe(2);
      expect(p.limite).toBe(200);
      expect(p.empresas).toEqual([
        // Só os 30 dias contam: 1 M de entrada (US$ 0,10) + 2 M de saída (US$ 1,00).
        { tenantId: A, nome: NOME_A, modulo: true, ia: { origem: 'propria', provedor: 'anthropic' }, pessoas: 2, usoUsd: 1.1, situacao: 'ia_parada', motivo: 'sem_credito' },
        { tenantId: B, nome: NOME_B, modulo: false, ia: { origem: null, provedor: null }, pessoas: 0, usoUsd: 0, situacao: 'modulo_desligado', motivo: null },
      ]);
      const cru = JSON.stringify([n, p]);
      for (const proibido of [tel, telCarlos, 'segredo-cifrado', 'zzzz', 'Ana Souza', 'Carlos']) expect(cru).not.toContain(proibido);
      // Sem chave própria, com a IA que a distribuição inclui; a busca não acha quem não combina.
      await q(`delete from ia_credencial where tenant_id = $1`, [A]);
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-da-distribuicao';
      const p2 = await consoleDoMister.empresas(`pizzaria do porto ${MARCA}`);
      expect(p2.empresas.map((e) => e.nome)).toEqual([NOME_B]);
      const [a] = (await consoleDoMister.empresas(MARCA)).empresas;
      expect(a).toMatchObject({ ia: { origem: 'incluida', provedor: null }, situacao: 'funcionando', usoUsd: 1.1 });
      expect((await consoleDoMister.empresas('%')).empresas).toEqual([]);
    });

    it('o painel descobre que o número caiu ao ler a Meta, e sem número mostra "não conectado" sem falar com ela', async () => {
      numero.responder = (p) => (p.url.includes('fields=display_phone_number') ? { status: 400, corpo: { error: { code: 100, error_subcode: 33, message: 'does not exist' } } } : undefined);
      const p = await consoleDoMister.painel();
      expect(p.numero).toMatchObject({ situacao: 'caiu', motivo: 'does not exist', qualidade: null, avisosPorDia: null });
      await numeroZerado();
      numero.pedidos.length = 0;
      const vazio = await consoleDoMister.painel();
      expect(vazio.numero).toMatchObject({ situacao: 'sem', numero: null });
      expect(vazio.liberado).toBe(false);
      expect(numero.pedidos).toEqual([]);
      expect(await vinculo.meu(usuario('ana'))).toMatchObject({ disponivel: false, numeroDoMister: null });
    });

    it('os modelos de mensagem no console: lidos na conta do número do Mister, pedidos uma vez só, a recusa da Meta com o motivo', async () => {
      numero.modelosDaMeta = [
        // Um modelo de outra conta não aparece (a leitura é na conta do número do Mister); um parecido não confunde.
        { name: 'mister_aviso_antigo', language: 'pt_BR', status: 'APPROVED', category: 'UTILITY' },
        { name: 'mister_aviso', language: 'en_US', status: 'APPROVED', category: 'UTILITY' },
      ];
      try {
        const antes = await consoleDoMister.modelos();
        expect(antes.lido).toBe(true);
        expect(antes.modelos.map((m) => [m.nome, m.situacao])).toEqual([
          ['mister_aviso', 'nao_pedido'],
          ['mister_resumo_pronto', 'nao_pedido'],
        ]);
        expect(numero.pedidos.every((p) => p.url.includes(`/${WABA}/message_templates`))).toBe(true);
        // O pedido: os dois modelos, na conta do número do Mister, com o texto do código.
        numero.pedidos.length = 0;
        const r = await consoleDoMister.pedirModelos();
        expect(r.pedidos).toEqual(['mister_aviso', 'mister_resumo_pronto']);
        expect(r.recusas).toEqual([]);
        expect(r.modelos.map((m) => m.situacao)).toEqual(['em_analise', 'em_analise']);
        const posts = numero.pedidos.filter((p) => p.metodo === 'POST');
        expect(posts.map((p) => p.url)).toEqual([`https://graph.facebook.com/v25.0/${WABA}/message_templates`, `https://graph.facebook.com/v25.0/${WABA}/message_templates`]);
        expect(posts[0].corpo).toMatchObject({ name: 'mister_aviso', language: 'pt_BR', category: 'UTILITY' });
        // Pedir de novo não pede nada (já estão na Meta); aprovado e recusado aparecem com a categoria e o motivo.
        numero.pedidos.length = 0;
        expect((await consoleDoMister.pedirModelos()).pedidos).toEqual([]);
        expect(numero.pedidos.filter((p) => p.metodo === 'POST')).toEqual([]);
        numero.modelosDaMeta = numero.modelosDaMeta.map((t) =>
          t.name === 'mister_aviso' && t.language === 'pt_BR'
            ? { ...t, status: 'APPROVED', category: 'MARKETING' }
            : t.name === 'mister_resumo_pronto'
              ? { ...t, status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' }
              : t,
        );
        expect((await consoleDoMister.modelos()).modelos.map((m) => [m.situacao, m.categoria, m.motivo])).toEqual([
          ['aprovado', 'marketing', null],
          ['recusado', 'utility', 'INVALID_FORMAT'],
        ]);
        // A Meta recusa o pedido: o motivo volta, e nada quebra.
        numero.modelosDaMeta = [];
        numero.responder = (p) => (p.metodo === 'POST' && p.url.includes('/message_templates') ? { status: 400, corpo: { error: { message: 'Invalid parameter', error_user_msg: 'O corpo tem parâmetros demais.' } } } : undefined);
        const recusado = await consoleDoMister.pedirModelos();
        expect(recusado.pedidos).toEqual([]);
        expect(recusado.recusas).toEqual([
          { nome: 'mister_aviso', motivo: 'O corpo tem parâmetros demais.' },
          { nome: 'mister_resumo_pronto', motivo: 'O corpo tem parâmetros demais.' },
        ]);
        // Sem o número conectado: nada é lido nem pedido.
        numero.responder = () => undefined;
        await numeroZerado();
        numero.pedidos.length = 0;
        expect((await consoleDoMister.modelos()).lido).toBe(false);
        await expect(consoleDoMister.pedirModelos()).rejects.toThrow('Conecte o número do Mister antes de pedir os modelos.');
        expect(numero.pedidos).toEqual([]);
      } finally {
        numero.modelosDaMeta = [];
      }
    });

    // ───────────────────────────── as perguntas: a fila e o agente de IA (mig 418) ─────────────────────────────

    /** O agente com a IA de mentira (roteiro em ordem), os serviços de leitura de verdade onde é só SQL e dublês que anotam. */
    const CHAVE_DE_TESTE = `sk-ant-api03-${'t'.repeat(60)}`;
    const usar = (nome: string, input: any, id = `toolu_${randomUUID().slice(0, 8)}`) => ({
      stop_reason: 'tool_use',
      content: [
        { type: 'thinking', thinking: '', signature: 'assinatura' },
        { type: 'tool_use', id, name: nome, input },
      ],
      usage: { input_tokens: 100, output_tokens: 20 },
    });
    const falar = (texto: string) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: texto }], usage: { input_tokens: 150, output_tokens: 40 } });
    const perguntar = async (tel: string, texto: string) => {
      expect(await mandar(tel, texto)).toBe('pergunta');
    };
    const perguntasDe = (nome: string) => q(`select * from mister_pergunta where colaborador_id = $1 order by criado_em`, [pessoa[nome]]);
    const comIa = () => (process.env.ANTHROPIC_API_KEY = CHAVE_DE_TESTE);

    it('a pergunta entra na fila uma vez, com a empresa, a pessoa, a loja e o nível do vínculo — e a entrada não espera a IA', async () => {
      const tel = telefone();
      await ligar('carlos', tel, A, 'gerente');
      numero.pedidos.length = 0;
      const id = wamid();
      expect(await mandar(tel, '  quanto vendi hoje?  ', { wamid: id })).toBe('pergunta');
      expect(await mandar(tel, 'quanto vendi hoje?', { wamid: id })).toBe('repetida');
      const [p, ...resto] = await perguntasDe('carlos');
      expect(resto).toEqual([]);
      expect(p).toMatchObject({ tenant_id: A, nivel: 'gerente', telefone: tel, chave: id, wamid: id, pergunta: 'quanto vendi hoje?', situacao: 'na_fila', tentativas: 0, resposta: null });
      expect(p.unidade_id).toBe((await q(`select unidade_id from colaborador where id = $1`, [pessoa.carlos]))[0].unidade_id);
      // A entrada não chamou a IA e não respondeu nada: quem responde é o agente.
      expect(ia.pedidos).toEqual([]);
      expect(numero.enviadas).toEqual([]);
      // O registro das mensagens continua sem texto.
      expect(Object.keys((await q(`select * from mister_mensagem where wamid = $1`, [id]))[0]).sort()).toEqual(['desfecho', 'recebida_em', 'telefone', 'tenant_id', 'wamid']);
    });

    it('mensagem sem texto (áudio, foto, reação): o Mister diz que só lê texto, uma vez a cada meia hora, e nada entra na fila', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      numero.pedidos.length = 0;
      expect(await mandar(tel, '')).toBe('so_texto');
      expect(await mandar(tel, '   ')).toBe('calado');
      expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DO_AGENTE.soTexto]);
      await q(`update mister_conversa set provisoria_em = now() - interval '31 minutes' where telefone = $1`, [tel]);
      expect(await mandar(tel, '')).toBe('so_texto');
      expect(await perguntasDe('ana')).toEqual([]);
    });

    it('a fila entrega uma conversa por vez, junta as mensagens seguidas da mesma pessoa e não entrega a conversa que já está em resposta', async () => {
      const telAna = telefone();
      const telCarlos = telefone();
      await ligar('ana', telAna);
      await ligar('carlos', telCarlos, A, 'gerente');
      await perguntar(telAna, 'quanto vendi hoje?');
      await perguntar(telAna, 'e ontem?');
      await perguntar(telCarlos, 'tem pedido parado?');
      // Duas pegas ao mesmo tempo: cada uma leva UMA conversa inteira, e nenhuma pergunta sai duas vezes.
      const [x, y] = await Promise.all([fila.pegar(), fila.pegar()]);
      const lotes = [x, y].filter(Boolean) as NonNullable<typeof x>[];
      expect(lotes.map((l) => l.map((p) => p.pergunta)).sort((a, b) => b.length - a.length)).toEqual([['quanto vendi hoje?', 'e ontem?'], ['tem pedido parado?']]);
      expect(await fila.pegar()).toBeNull();
      // Enquanto a conversa da Ana está em resposta, a mensagem nova dela espera — mesmo com dezenas na frente (V84).
      await perguntar(telAna, 'e na semana?');
      expect(await fila.pegar()).toBeNull();
      const daAna = lotes.find((l) => l[0].colaboradorId === pessoa.ana)!;
      await fila.concluir(daAna.map((p) => p.id), { resposta: 'Resposta.', trilha: { modelo: 'm', chamadas: 2 }, perguntaJunta: 'quanto vendi hoje?\ne ontem?' });
      const depois = await fila.pegar();
      expect(depois!.map((p) => p.pergunta)).toEqual(['e na semana?']);
      // Respondidas juntas: a última linha guarda a pergunta inteira e a resposta (é o que a memória lê).
      const linhasDaAna = await perguntasDe('ana');
      expect(linhasDaAna.map((p) => [p.situacao, p.pergunta, p.resposta, p.chamadas])).toEqual([
        ['respondida', 'quanto vendi hoje?', null, 0],
        ['respondida', 'quanto vendi hoje?\ne ontem?', 'Resposta.', 2],
        ['respondendo', 'e na semana?', null, 0],
      ]);
      expect(await fila.memoria(A, pessoa.ana)).toEqual([{ pergunta: 'quanto vendi hoje?\ne ontem?', resposta: 'Resposta.', hora: expect.stringMatching(/^\d{2}:\d{2}$/), consultas: [] }]);
    });

    it('a pega vence: a pergunta volta para a fila uma vez e, na segunda, é encerrada como interrompida — e a pessoa é avisada', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      await perguntar(tel, 'como está a loja?');
      const vencer = () => q(`update mister_pergunta set pega_em = now() - interval '4 minutes' where colaborador_id = $1 and situacao = 'respondendo'`, [pessoa.ana]);
      expect((await fila.pegar())!.length).toBe(1);
      expect(await fila.devolverVencidas()).toEqual([]); // ainda dentro do prazo
      await vencer();
      expect(await fila.devolverVencidas()).toEqual([]);
      expect((await perguntasDe('ana'))[0]).toMatchObject({ situacao: 'na_fila', tentativas: 1 });
      expect((await fila.pegar())![0].tentativas).toBe(2);
      await vencer();
      numero.pedidos.length = 0;
      await agente.rotina();
      expect((await perguntasDe('ana'))[0]).toMatchObject({ situacao: 'falhou', motivo: 'interrompida' });
      expect(numero.enviadas).toEqual([{ para: tel, texto: TEXTOS_DO_AGENTE.demorou, botoes: [] }]);
      expect(ia.pedidos).toEqual([]);
    });

    it('o agente responde com a ferramenta: o dado vem do serviço da tela, a resposta sai pelo número do Mister e a trilha fica gravada', async () => {
      comIa();
      const tel = telefone();
      await ligar('ana', tel);
      numero.pedidos.length = 0;
      const id = wamid();
      expect(await mandar(tel, 'quanto vendi hoje?', { wamid: id })).toBe('pergunta');
      ia.roteiro = [usar('resumo_do_dia', { dia: 'hoje' }, 'toolu_resumo'), falar('Hoje, até agora: *nenhuma venda* fechada e R$ 0,00 de faturamento.')];
      expect(await agente.esvaziar()).toBe(1);

      // O que foi ao modelo: as seis ferramentas, as instruções fixas com a marca de cache e, DEPOIS dela, a conversa.
      const [primeiro, segundo] = ia.pedidos;
      expect(primeiro.model).toBe('claude-haiku-5-5');
      expect(primeiro.tools.map((t: any) => t.name)).toEqual(FERRAMENTAS.map((f) => f.name));
      expect(primeiro.system[0]).toEqual({ type: 'text', text: INSTRUCOES_DO_MISTER, cache_control: { type: 'ephemeral' } });
      expect(primeiro.system[1].text).toContain(`Empresa: ${NOME_A}`);
      expect(primeiro.system[1].text).toContain('Você fala com: Ana (presidente)');
      expect(primeiro.system[1].cache_control).toBeUndefined();
      expect(primeiro.messages).toEqual([{ role: 'user', content: 'quanto vendi hoje?' }]);
      // A segunda chamada devolve ao modelo os blocos dele INTEIROS e o resultado da ferramenta — o do Painel de verdade.
      expect(segundo.messages[1]).toEqual({ role: 'assistant', content: usar('resumo_do_dia', { dia: 'hoje' }, 'toolu_resumo').content });
      const [resultado] = segundo.messages[2].content;
      expect(resultado).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_resumo' });
      expect(resultado.is_error).toBeUndefined();
      const dados = JSON.parse(resultado.content);
      expect(dados).toMatchObject({ numeroDeVendas: 0, faturamento: 0, faturamentoDoBalcao: 0, faturamentoDoDelivery: 0, ticketMedio: 0, pedidosDeDeliveryEmAberto: 0 });
      expect(dados.dia).toMatch(/^hoje \(\d{2}\/\d{2}\)$/);
      expect(dados.aviso).toBeUndefined();

      // O que saiu: "digitando" (com a mensagem lida) e a resposta, só para quem perguntou.
      const digitando = numero.pedidos.find((p) => p.corpo?.status === 'read');
      expect(digitando?.corpo).toEqual({ messaging_product: 'whatsapp', status: 'read', message_id: id, typing_indicator: { type: 'text' } });
      expect(numero.enviadas).toEqual([{ para: tel, texto: 'Hoje, até agora: *nenhuma venda* fechada e R$ 0,00 de faturamento.', botoes: [] }]);

      // A trilha: o que foi usado, nunca o dado.
      const [p] = await perguntasDe('ana');
      expect(p).toMatchObject({ situacao: 'respondida', motivo: null, modelo: 'claude-haiku-5-5', chamadas: 2, tokens_entrada: 250, tokens_saida: 60, conferencia: [] });
      expect(p.resposta).toBe('Hoje, até agora: *nenhuma venda* fechada e R$ 0,00 de faturamento.');
      expect(p.ferramentas).toHaveLength(1);
      // … e o que foi PEDIDO (aqui, o dia), para saber depois que período ele consultou.
      expect(p.ferramentas[0]).toMatchObject({ nome: 'resumo_do_dia', ok: true, entrada: { dia: 'hoje' } });
      expect(Object.keys(p.ferramentas[0]).sort()).toEqual(['entrada', 'ms', 'nome', 'ok']);
      // O medidor de IA da empresa contou as duas chamadas no recurso do Mister.
      expect(await q(`select recurso, chamadas, falhas, origem from ia_uso_dia where tenant_id = $1`, [A])).toEqual([{ recurso: 'mister_perguntas', chamadas: 2, falhas: 0, origem: 'distribuicao' }]);
      expect(await q(`select 1 from ia_uso_dia where tenant_id = $1`, [B])).toEqual([]);
    });

    it('a memória da conversa vai junto na pergunta seguinte, com a hora e as consultas de cada resposta, e uma conversa não vê a de outra pessoa', async () => {
      comIa();
      const tel = telefone();
      const telCarlos = telefone();
      await ligar('ana', tel);
      await ligar('carlos', telCarlos, A, 'gerente');
      await perguntar(tel, 'como está o estoque?');
      ia.roteiro = [usar('estoque_em_alerta', {}), falar('Nada abaixo do mínimo.')];
      await agente.esvaziar();
      await perguntar(tel, 'obrigada');
      ia.roteiro = [falar('De nada.')];
      await agente.esvaziar();
      await perguntar(tel, 'e as validades?');
      await perguntar(telCarlos, 'oi');
      ia.roteiro = [falar('Certo.'), falar('Olá.')];
      await agente.esvaziar();
      const daAna = ia.pedidos.find((p) => p.messages.at(-1).content === 'e as validades?')!;
      // A pergunta antiga vai com a hora e com a consulta feita naquela hora; a que não consultou nada, com "sem consulta".
      // Sem isto o modelo concluía que tinha respondido sem consultar e "corrigia" resposta certa (ERR-461).
      expect(daAna.messages).toEqual([
        { role: 'user', content: expect.stringMatching(/^\[pergunta feita às \d{2}:\d{2} · consultas feitas naquela hora: estoque em alerta\]\ncomo está o estoque\?$/) },
        { role: 'assistant', content: 'Nada abaixo do mínimo.' },
        { role: 'user', content: expect.stringMatching(/^\[pergunta feita às \d{2}:\d{2} · sem consulta\]\nobrigada$/) },
        { role: 'assistant', content: 'De nada.' },
        { role: 'user', content: 'e as validades?' },
      ]);
      const doCarlos = ia.pedidos.find((p) => p.messages.at(-1).content === 'oi')!;
      expect(doCarlos.messages).toEqual([{ role: 'user', content: 'oi' }]);
      expect(doCarlos.system[1].text).toContain('Você fala com: Carlos (gerente)');
    });

    it('o escopo é do servidor: o gerente só consulta a loja dele, sem valores em reais, e o que o modelo escrever a mais não muda de quem é o dado', async () => {
      comIa();
      const [{ id: praia }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja Praia') returning id`, [A]);
      try {
        const [{ unidade_id: centro }] = await q(`select unidade_id from colaborador where id = $1`, [pessoa.carlos]);
        const tel = telefone();
        await ligar('carlos', tel, A, 'gerente');
        await perguntar(tel, 'como está a loja agora e quanto vendi?');
        lidos.length = 0;
        ia.roteiro = [
          {
            stop_reason: 'tool_use',
            content: [
              // O modelo tenta outra empresa e outra loja: os campos a mais são ignorados e a loja de fora é recusada.
              { type: 'tool_use', id: 't1', name: 'pedidos_em_andamento', input: { tenantId: B, unidadeId: praia, empresa: NOME_B } },
              { type: 'tool_use', id: 't2', name: 'resumo_do_dia', input: { loja: 'Loja Praia' } },
              { type: 'tool_use', id: 't3', name: 'resumo_do_dia', input: {} },
              { type: 'tool_use', id: 't4', name: 'servidor_e_incidentes', input: {} },
              { type: 'tool_use', id: 't5', name: 'apagar_tudo', input: {} },
              { type: 'tool_use', id: 't6', name: 'vendas_do_periodo', input: { periodo: 'hoje' } },
            ],
            usage: { input_tokens: 10, output_tokens: 10 },
          },
          falar('Pronto.'),
        ];
        await agente.esvaziar();
        const resultados = Object.fromEntries(ia.pedidos[1].messages[2].content.map((r: any) => [r.tool_use_id, { erro: !!r.is_error, dados: JSON.parse(r.content) }]));
        // A consulta do quadro e da cozinha saiu com a empresa e a loja DO GERENTE.
        expect(lidos).toEqual([
          ['delivery', A, centro],
          ['cozinha', A, centro],
        ]);
        expect(resultados.t1).toMatchObject({ erro: false, dados: { loja: 'Loja Centro' } });
        expect(resultados.t2).toEqual({ erro: true, dados: { erro: 'Esta pessoa só consulta a loja Loja Centro.' } });
        // O perfil padrão de gerente não vê valores em reais: vêm vazios, com o aviso — a contagem vem.
        expect(resultados.t3.dados).toMatchObject({ loja: 'Loja Centro', numeroDeVendas: 0, faturamento: null, ticketMedio: null, gorjeta: null });
        expect(resultados.t3.dados.aviso).toContain('não mostra valores em reais');
        // O servidor da loja é só do presidente (como a rota): o gerente não recebe, e o serviço nem é chamado.
        expect(resultados.t4.dados.servidor).toEqual({ aviso: 'A situação do servidor é mostrada só ao presidente.' });
        expect(resultados.t5).toEqual({ erro: true, dados: { erro: 'Essa consulta não existe.' } });
        // Os relatórios de vendas não estão no perfil padrão do gerente: quem não abre a tela não recebe pelo Mister.
        expect(resultados.t6.erro).toBe(true);
        expect(resultados.t6.dados.erro).toContain('não dá acesso a esta informação');
        expect(ia.pedidos[0].system[1].text).toContain('Lojas que esta pessoa consulta: Loja Centro (esta pessoa só consulta esta loja)');
        expect(ia.pedidos[0].system[1].text).toContain('NÃO vê valores em reais');

        // O presidente, na mesma empresa: todas as lojas, ou a que ele nomear (pelo nome ou pelo número da lista).
        const telAna = telefone();
        await ligar('ana', telAna);
        await perguntar(telAna, 'pedidos agora');
        lidos.length = 0;
        ia.pedidos.length = 0;
        ia.roteiro = [
          {
            stop_reason: 'tool_use',
            content: [
              { type: 'tool_use', id: 'p1', name: 'pedidos_em_andamento', input: {} },
              { type: 'tool_use', id: 'p2', name: 'pedidos_em_andamento', input: { loja: 'praia' } },
              { type: 'tool_use', id: 'p3', name: 'pedidos_em_andamento', input: { loja: '1' } },
              { type: 'tool_use', id: 'p4', name: 'pedidos_em_andamento', input: { loja: 'Loja do Porto' } },
              { type: 'tool_use', id: 'p5', name: 'servidor_e_incidentes', input: {} },
            ],
            usage: { input_tokens: 10, output_tokens: 10 },
          },
          falar('Pronto.'),
        ];
        await agente.esvaziar();
        expect(lidos).toEqual([
          ['delivery', A, null],
          ['cozinha', A, undefined],
          ['delivery', A, praia],
          ['cozinha', A, praia],
          ['delivery', A, centro],
          ['cozinha', A, centro],
          ['servidor', A],
        ]);
        const doPresidente = Object.fromEntries(ia.pedidos[1].messages[2].content.map((r: any) => [r.tool_use_id, { erro: !!r.is_error, dados: JSON.parse(r.content) }]));
        expect(doPresidente.p1.dados.loja).toBe('todas as lojas');
        expect(doPresidente.p4).toEqual({ erro: true, dados: { erro: 'Não achei essa loja. As lojas são: 1. Loja Centro; 2. Loja Praia.' } });
        expect(doPresidente.p5.dados.servidor).toMatchObject({ instalado: true, comSinalAgora: true, versao: '1.30.12', copiaDeSeguranca: { emDia: true, haHoras: 3 } });
        // Os pedidos do quadro e da cozinha, contados: o marcado para depois fica à parte e o pedido de duas estações conta uma vez.
        expect(doPresidente.p1.dados.delivery).toMatchObject({
          emAndamento: 3,
          porSituacao: { 'aguardando aceite': 1, 'em preparo': 1, 'a caminho': 1 },
          porPlataforma: { ifood: 2, cardapio: 1 },
          marcadosParaDepois: 1,
          esperaHaMaisTempo: { comoAparece: '#284 · iFood 4821', plataforma: 'ifood', numero: '4821', situacao: 'em preparo', haMinutos: 22 },
        });
        expect(doPresidente.p1.dados.cozinha).toMatchObject({ pedidos: 2, porSituacao: { 'na fila': 1, 'em preparo': 1 }, maisAntigoSemFicarPronto: { origem: 'iFood', senhaNaCozinha: 'D12', situacao: 'em preparo', haMinutos: 22 } });

        // Gerente SEM loja numa empresa de várias lojas: nenhuma consulta responde (como nas rotas).
        await q(`update colaborador set unidade_id = null where id = $1`, [pessoa.carlos]);
        await perguntar(tel, 'e agora?');
        ia.pedidos.length = 0;
        lidos.length = 0;
        ia.roteiro = [usar('pedidos_em_andamento', {}, 's1'), falar('Seu cadastro não tem loja.')];
        await agente.esvaziar();
        expect(JSON.parse(ia.pedidos[1].messages.at(-1).content[0].content).erro).toContain('não está ligado a uma loja');
        expect(lidos).toEqual([]);
        expect(ia.pedidos[0].system[1].text).toContain('Lojas que esta pessoa consulta: nenhuma');
      } finally {
        // A empresa volta a ter uma loja só e o gerente volta para ela, mesmo se o teste parar no meio.
        await q(`update colaborador set unidade_id = (select id from unidade where tenant_id = $2 and nome = 'Loja Centro') where id = $1`, [pessoa.carlos, A]);
        await q(`delete from mister_pergunta where tenant_id = $1`, [A]);
        await q(`delete from unidade where id = $1`, [praia]);
      }
    });

    it('as leituras de verdade (vendas do período, mais vendidos, estoque) respondem de uma empresa sem movimento com zeros — e não com erro', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      expect(e).toMatchObject({ nivel: 'presidente', lojaUnica: true, presa: null, semLoja: false, verValores: true });
      const vendas = await ferramentas.executar(e, 'vendas_do_periodo', { periodo: 'este_mes' });
      expect(vendas).toMatchObject({ ok: true, dados: { numeroDeVendas: 0, faturamento: 0, vendasCanceladas: 0, porFormaDePagamento: [], porCanal: [], porDia: [], delivery: { pedidos: 0, faturamento: 0, ticketMedio: 0, porPlataforma: [] } } });
      // Quem não vê valores em reais não recebe o relatório de Delivery (a rota pede a mesma permissão).
      const semValoresV = { ...e, nivel: 'gerente' as const, verValores: false, permissoes: { relatorios_vendas: true } as any };
      expect(((await ferramentas.executar(semValoresV, 'vendas_do_periodo', {})).dados.delivery as any).aviso).toContain('não mostra valores em reais');
      expect(String(vendas.dados.periodo)).toMatch(/^este mês \(/);
      expect(await ferramentas.executar(e, 'vendas_do_periodo', { de: '2026-13-01', ate: '2026-13-02' })).toEqual({ ok: false, dados: { erro: 'As datas precisam estar no formato AAAA-MM-DD e existir no calendário.' } });
      expect(await ferramentas.executar(e, 'produtos_mais_vendidos', { quantos: 99 })).toMatchObject({ ok: true, dados: { ordenadoPor: 'quantidade', produtos: [] } });
      // Por faturamento a lista sai da curva de produtos (todos os produtos do período), só para quem vê valores em reais.
      expect(await ferramentas.executar(e, 'produtos_mais_vendidos', { ordem: 'faturamento', periodo: 'hoje' })).toMatchObject({ ok: true, dados: { ordenadoPor: 'faturamento', produtosVendidosNoPeriodo: 0, produtos: [] } });
      expect(await ferramentas.executar(e, 'produtos_mais_vendidos', { ordem: 'preco' })).toEqual({ ok: false, dados: { erro: 'A ordem é "quantidade", "faturamento" ou "lucro".' } });
      const semValores = { ...e, nivel: 'gerente' as const, verValores: false, permissoes: { relatorios_vendas: true } as any };
      expect((await ferramentas.executar(semValores, 'produtos_mais_vendidos', { ordem: 'faturamento' })).dados.erro).toContain('não dá para ordenar por faturamento');
      expect(await ferramentas.executar(semValores, 'produtos_mais_vendidos', {})).toMatchObject({ ok: true, dados: { ordenadoPor: 'quantidade' } });
      expect(await ferramentas.executar(e, 'estoque_em_alerta', {})).toMatchObject({
        ok: true,
        dados: { abaixoDoMinimo: { total: 0, itens: [] }, validades: { vencidos: 0, vencemEmAte2Dias: 0, vencemEmAte5Dias: 0, lotes: [] } },
      });
      // Os problemas em aberto são só os desta empresa e só os que são da loja resolver; banco sem a tabela = "não li".
      const [{ tem }] = await q(`select to_regclass('vigia_incidente') is not null as tem`);
      if (tem) {
        await q(
          `insert into vigia_incidente (tenant_id, regra, chave, gravidade, publico) values
             ($1, 'impressora_parada', $3, 'atencao', 'loja'), ($1, 'banco_em_risco', $4, 'critico', 'distribuicao'), ($2, 'servidor_sem_sinal', $5, 'critico', 'loja')`,
          [A, B, `srv:${MARCA}:a`, `srv:${MARCA}:b`, `srv:${MARCA}:c`],
        );
      }
      const servidor = await ferramentas.executar(e, 'servidor_e_incidentes', {});
      if (tem) {
        expect(servidor.dados.problemasEmAberto).toMatchObject({ total: 1, lista: [{ problema: 'impressora parada', gravidade: 'atenção', vezesVisto: 1 }] });
        await q(`delete from vigia_incidente where tenant_id = any($1::uuid[])`, [[A, B]]);
      } else expect(servidor.dados.problemasEmAberto).toEqual({ aviso: 'Não consegui ler os problemas em aberto agora.' });
      // Quem perdeu o acesso não tem escopo: nem pelo telefone de outra pessoa, nem depois de desativado.
      expect(await ferramentas.escopo(A, pessoa.ana, telefone())).toBeNull();
      expect(await ferramentas.escopo(B, pessoa.ana, tel)).toBeNull();
      await q(`update colaborador set status = 'bloqueado' where id = $1`, [pessoa.ana]);
      expect(await ferramentas.escopo(A, pessoa.ana, tel)).toBeNull();
    });

    it('quem perde o acesso entre a pergunta e a resposta não é respondido, e a chave geral desligada cala o agente — sem gastar IA', async () => {
      comIa();
      const tel = telefone();
      await ligar('carlos', tel, A, 'gerente');
      numero.pedidos.length = 0;
      await perguntar(tel, 'quanto vendi?');
      await q(`update colaborador set funcao_id = $2 where id = $1`, [pessoa.carlos, funcao['execucao-a']]);
      expect(await agente.esvaziar()).toBe(1);
      expect((await perguntasDe('carlos'))[0]).toMatchObject({ situacao: 'falhou', motivo: 'sem_acesso', chamadas: 0 });
      await q(`update colaborador set funcao_id = $2 where id = $1`, [pessoa.carlos, funcao['gerente-a']]);
      await perguntar(tel, 'e agora?');
      await numeroConectado(false);
      await agente.esvaziar();
      expect((await perguntasDe('carlos'))[1]).toMatchObject({ situacao: 'falhou', motivo: 'desligado', chamadas: 0 });
      expect(ia.pedidos).toEqual([]);
      expect(numero.enviadas).toEqual([]);
    });

    it('a IA que não responde nunca vira silêncio: sem chave, fora do ar, recusa e laço sem fim têm cada um a sua frase', async () => {
      const tel = telefone();
      const telCarlos = telefone();
      await ligar('ana', tel);
      await ligar('carlos', telCarlos, A, 'gerente');
      numero.pedidos.length = 0;
      const ultima = async (nome: string) => (await perguntasDe(nome)).at(-1);

      // Sem chave nenhuma: o presidente é mandado à tela; o gerente, ao presidente.
      await perguntar(tel, 'quanto vendi?');
      await perguntar(telCarlos, 'quanto vendi?');
      await agente.esvaziar();
      expect(numero.enviadas.map((m) => [m.para, m.texto]).sort()).toEqual(
        [
          [tel, TEXTOS_DO_AGENTE.semChave('presidente')],
          [telCarlos, TEXTOS_DO_AGENTE.semChave('gerente')],
        ].sort(),
      );
      expect(await ultima('ana')).toMatchObject({ situacao: 'falhou', motivo: 'sem_chave', resposta: null });
      expect(ia.pedidos).toEqual([]);

      comIa();
      numero.pedidos.length = 0;
      // O provedor fora do ar.
      await perguntar(tel, 'quanto vendi?');
      ia.roteiro = [{ erro: { status: 529, message: 'overloaded' } }];
      await agente.esvaziar();
      expect(await ultima('ana')).toMatchObject({ situacao: 'falhou', motivo: 'indisponivel' });
      // O modelo se recusa.
      await perguntar(tel, 'outra coisa');
      ia.roteiro = [{ stop_reason: 'refusal', content: [], usage: { input_tokens: 5, output_tokens: 0 } }];
      await agente.esvaziar();
      expect(await ultima('ana')).toMatchObject({ situacao: 'falhou', motivo: 'recusou', chamadas: 1 });
      // O modelo pede ferramenta sem parar: o teto de voltas fecha, e as consultas além do teto voltam como erro.
      await perguntar(tel, 'tudo de uma vez');
      ia.roteiro = Array.from({ length: TETOS.voltas }, () => ({
        stop_reason: 'tool_use',
        content: [1, 2, 3].map((n) => ({ type: 'tool_use', id: `l${n}-${randomUUID().slice(0, 6)}`, name: 'estoque_em_alerta', input: {} })),
        usage: { input_tokens: 1, output_tokens: 1 },
      }));
      await agente.esvaziar();
      const laco = await ultima('ana');
      expect(laco).toMatchObject({ situacao: 'falhou', motivo: 'nao_fechou', chamadas: TETOS.voltas });
      expect(laco.ferramentas).toHaveLength(TETOS.ferramentas);
      expect(JSON.parse(ia.pedidos.at(-1)!.messages.at(-1).content.at(-1).content).erro).toContain('Limite de consultas');
      // Resposta cortada pelo limite de tamanho não sai pela metade.
      await perguntar(tel, 'explique tudo');
      ia.roteiro = [{ stop_reason: 'max_tokens', content: [{ type: 'text', text: 'Hoje a loja ven' }], usage: { input_tokens: 5, output_tokens: 5 } }];
      await agente.esvaziar();
      expect(await ultima('ana')).toMatchObject({ situacao: 'falhou', motivo: 'nao_fechou' });
      expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DO_AGENTE.passageira, TEXTOS_DO_AGENTE.recusou, TEXTOS_DO_AGENTE.naoFechou, TEXTOS_DO_AGENTE.naoFechou]);
      expect(ia.roteiro).toEqual([]);
    });

    it('a trava de emergência da distribuição desliga só as perguntas: a pessoa é avisada e nenhuma IA é chamada', async () => {
      comIa();
      const antesDaTrava = process.env.MISTER_PERGUNTAS_DESLIGADAS;
      try {
        const tel = telefone();
        await ligar('ana', tel);
        numero.pedidos.length = 0;
        process.env.MISTER_PERGUNTAS_DESLIGADAS = '1';
        await perguntar(tel, 'quanto vendi hoje?');
        expect(await agente.esvaziar()).toBe(1);
        expect(numero.enviadas).toEqual([{ para: tel, texto: TEXTOS_DO_AGENTE.emManutencao, botoes: [] }]);
        expect((await perguntasDe('ana'))[0]).toMatchObject({ situacao: 'falhou', motivo: 'manutencao', chamadas: 0 });
        expect(ia.pedidos).toEqual([]);
        // O resto do Mister segue: os comandos da conversa continuam respondendo.
        expect(await mandar(tel, 'PARAR AVISOS')).toBe('parou');
        // Trava solta: a pergunta seguinte é respondida.
        delete process.env.MISTER_PERGUNTAS_DESLIGADAS;
        await perguntar(tel, 'e agora?');
        ia.roteiro = [falar('Agora sim.')];
        await agente.esvaziar();
        expect(numero.enviadas.at(-1)!.texto).toBe('Agora sim.');
      } finally {
        if (antesDaTrava === undefined) delete process.env.MISTER_PERGUNTAS_DESLIGADAS;
        else process.env.MISTER_PERGUNTAS_DESLIGADAS = antesDaTrava;
      }
    });

    it('o teto de perguntas por pessoa em 24 horas: passou, o Mister diz o limite e não chama a IA', async () => {
      comIa();
      const tel = telefone();
      await ligar('ana', tel);
      numero.pedidos.length = 0;
      await q(
        `insert into mister_pergunta (tenant_id, colaborador_id, nivel, telefone, chave, pergunta, resposta, situacao, chamadas, respondida_em)
         select $1, $2, 'presidente', $3, 'teto-' || $4 || '-' || n, 'p', 'r', 'respondida', 1, now() from generate_series(1, $5::int) n`,
        [A, pessoa.ana, tel, MARCA, TETOS.porPessoaEm24h - 1],
      );
      await perguntar(tel, 'a última que cabe');
      ia.roteiro = [falar('Cabe.')];
      await agente.esvaziar();
      await perguntar(tel, 'a que passa do teto');
      await agente.esvaziar();
      expect(numero.enviadas.map((m) => m.texto)).toEqual(['Cabe.', TEXTOS_DO_AGENTE.limite(TETOS.porPessoaEm24h)]);
      expect((await perguntasDe('ana')).at(-1)).toMatchObject({ situacao: 'falhou', motivo: 'limite', chamadas: 0 });
      expect(ia.pedidos).toHaveLength(1);
      // As perguntas velhas saem da conta sozinhas.
      await q(`update mister_pergunta set criado_em = now() - interval '25 hours' where chave like $1`, [`teto-${MARCA}-%`]);
      expect((await fila.usoEm24h(A, pessoa.ana)).pessoa).toBe(1);
    });

    it('o filtro de saída: link não sai, o negrito vira o do WhatsApp, e o valor que nenhuma ferramenta trouxe fica anotado na trilha', async () => {
      comIa();
      const tel = telefone();
      await ligar('ana', tel);
      numero.pedidos.length = 0;
      await perguntar(tel, 'quanto vendi hoje?');
      ia.roteiro = [usar('resumo_do_dia', {}), falar('## Resumo\n**Hoje**: R$ 0,00 no balcão.\nA meta era R$ 9.999,90. Veja em https://exemplo.com/painel agora.')];
      await agente.esvaziar();
      expect(numero.enviadas.at(-1)!.texto).toBe('Resumo\n*Hoje*: R$ 0,00 no balcão.\nA meta era R$ 9.999,90. Veja em agora.');
      expect((await perguntasDe('ana'))[0].conferencia).toEqual(['link_tirado', 'valor_sem_origem']);
      // Resposta que parece trazer um segredo não sai: vai a frase fixa.
      await perguntar(tel, 'qual é a chave?');
      ia.roteiro = [falar(`A chave é ${CHAVE_DE_TESTE}.`)];
      await agente.esvaziar();
      expect(numero.enviadas.at(-1)!.texto).toBe(TEXTOS_DO_AGENTE.naoFechou);
      expect((await perguntasDe('ana'))[1]).toMatchObject({ situacao: 'respondida', conferencia: ['segredo'], resposta: TEXTOS_DO_AGENTE.naoFechou });
    });

    it('a limpeza diária tira o texto das perguntas com mais de 30 dias e a linha com mais de 90; no servidor da loja o agente não faz nada', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      // A trilha com as palavras da pessoa (a busca do estoque, o assunto do guia) e o resto do pedido.
      const trilha = JSON.stringify([
        { nome: 'estoque_em_alerta', ms: 5, ok: true, entrada: { busca: 'bacon da casa', loja: 'Loja Centro', pagina: 2 } },
        { nome: 'como_usar_o_regem', ms: 3, ok: true, entrada: { assunto: 'pausar o iFood' } },
        { nome: 'anotar_o_que_falta', ms: 1, ok: true, entrada: { tema: 'clientes' } },
        { nome: 'resumo_do_dia', ms: 2, ok: true },
      ]);
      for (const [chave, dias, texto] of [['nova', 1, 'pergunta'], ['velha', 31, 'pergunta'], ['ja_sem_texto', 40, null], ['antiga', 91, 'pergunta']] as const)
        await q(
          `insert into mister_pergunta (tenant_id, colaborador_id, nivel, telefone, chave, pergunta, resposta, situacao, chamadas, ferramentas, criado_em)
           values ($1, $2, 'presidente', $3, $4, $6, $6, 'respondida', 1, $7::jsonb, now() - make_interval(days => $5))`,
          [A, pessoa.ana, tel, `limpa-${MARCA}-${chave}`, dias, texto, trilha],
        );
      await entrada.limparMensagens();
      const depois = await q(`select chave, pergunta, resposta, ferramentas from mister_pergunta where chave like $1 order by criado_em desc`, [`limpa-${MARCA}-%`]);
      expect(depois.map((l) => [l.chave.split('-').at(-1), l.pergunta, l.resposta])).toEqual([
        ['nova', 'pergunta', 'pergunta'],
        ['velha', null, null],
        ['ja_sem_texto', null, null],
      ]);
      // A nova guarda tudo; a velha e a que já tinha perdido o texto (antes desta regra) perdem as palavras da pessoa e
      // guardam o resto do pedido, na mesma ordem.
      expect(depois[0].ferramentas).toEqual(JSON.parse(trilha));
      const semPalavras = [
        { nome: 'estoque_em_alerta', ms: 5, ok: true, entrada: { loja: 'Loja Centro', pagina: 2 } },
        { nome: 'como_usar_o_regem', ms: 3, ok: true, entrada: {} },
        { nome: 'anotar_o_que_falta', ms: 1, ok: true, entrada: { tema: 'clientes' } },
        { nome: 'resumo_do_dia', ms: 2, ok: true },
      ];
      expect(depois[1].ferramentas).toEqual(semPalavras);
      expect(depois[2].ferramentas).toEqual(semPalavras);
      // Na volta seguinte, nada mais a mudar nelas.
      await entrada.limparMensagens();
      expect((await q(`select ferramentas from mister_pergunta where chave = $1`, [`limpa-${MARCA}-ja_sem_texto`]))[0].ferramentas).toEqual(semPalavras);
      await perguntar(tel, 'no servidor da loja?');
      process.env.EDGE_MODE = 'true';
      expect(await agente.esvaziar()).toBe(0);
      await agente.rotina();
      agente.acordar();
      expect((await perguntasDe('ana')).at(-1)).toMatchObject({ situacao: 'na_fila', tentativas: 0 });
    });

    // ───────────────────────────── as perguntas, parte 2: cancelamentos, caixas e equipe ─────────────────────────────

    /** O meio-dia de um dia da OPERAÇÃO, como instante: os dados do teste caem no dia certo a qualquer hora em que ele rode. */
    const meioDia = (dia: string, hora = '12:00:00') => `${dia} ${hora}`;
    const NO_FUSO = `at time zone 'America/Sao_Paulo'`;

    it('cancelamentos: os pedidos dos canais, as vendas da loja e os itens removidos do período, com o motivo — só desta empresa e com as permissões de cada tela', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const hoje = hojeISO();
      const [{ id: loja }] = await q(`select id from unidade where tenant_id = $1`, [A]);
      const pedido = (tenant: string, canal: string, status: string, total: number, numero: string, motivo: string | null, dia: string, comandaId: string | null = null, hora = '12:00:00') =>
        q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, status, total, valor_bruto, taxa_entrega, taxa_entrega_dono, display_id, motivo_cancelamento, comanda_id, criado_em, cancelado_em)
           values ($1, $2, $3, $4, $5, $5, 0, 'marketplace', $6, $7, $8, ($9::timestamp ${NO_FUSO}) - interval '20 minutes',
                   case when $4 = 'cancelado' then $9::timestamp ${NO_FUSO} end)`,
          [tenant, tenant === A ? loja : null, canal, status, total, numero, motivo, comandaId, meioDia(dia, hora)],
        );
      const comanda = async (status: string, total: number, motivo: string | null, quem: string | null) =>
        (
          await q(
            `insert into comanda (tenant_id, unidade_id, status, total, forma, aberta_em, cancelada_em, cancelada_por_id, motivo_cancelamento)
             values ($1, $2, $3, $4, 'dinheiro', ($5::timestamp ${NO_FUSO}) - interval '30 minutes', case when $3 = 'cancelada' then $5::timestamp ${NO_FUSO} end, $6, $7) returning id`,
            [A, loja, status, total, meioDia(hoje, '13:00:00'), quem, motivo],
          )
        )[0].id as string;
      try {
        await pedido(A, 'ifood', 'cancelado', 50, '901', 'Cliente desistiu', hoje);
        await pedido(A, 'cardapio', 'cancelado', 30.5, '902', '   ', hoje, null, '11:00:00');
        await pedido(A, 'ifood', 'cancelado', 99, '700', 'Pedido antigo', somarDias(hoje, -3));
        await pedido(B, 'ifood', 'cancelado', 77, '555', 'De outra empresa', hoje);
        await comanda('cancelada', 80, 'Lançada errada', pessoa.carlos);
        // Venda cancelada que é de um pedido de canal não entra em "vendas da loja" (já está nos pedidos).
        const deCanal = await comanda('cancelada', 40, 'Do canal', null);
        await pedido(A, 'ifood', 'confirmado', 40, '903', null, hoje, deCanal);

        lidos.length = 0;
        const r = await ferramentas.executar(e, 'cancelamentos', {});
        expect(r.ok).toBe(true);
        expect(String(r.dados.periodo)).toMatch(/^hoje \(/);
        expect(r.dados.pedidosDosCanais).toMatchObject({
          cancelados: 2,
          valor: 80.5,
          porCanal: { ifood: 1, cardapio: 1 },
          ultimos: [
            { canal: 'ifood', numero: '901', motivo: 'Cliente desistiu', valor: 50 },
            { canal: 'cardapio', numero: '902', motivo: 'sem motivo anotado', valor: 30.5 },
          ],
        });
        expect((r.dados.pedidosDosCanais as any).ultimos[0].quando).toMatch(/^\d{2}\/\d{2} 12:00$/);
        expect((r.dados.pedidosDosCanais as any).porMotivo).toEqual(expect.arrayContaining([{ motivo: 'Cliente desistiu', pedidos: 1 }, { motivo: 'sem motivo anotado', pedidos: 1 }]));
        expect(r.dados.vendasCanceladasNaLoja).toMatchObject({
          canceladas: 1,
          valor: 80,
          porMotivo: [{ motivo: 'Lançada errada', vendas: 1 }],
          ultimas: [{ quemCancelou: 'Carlos Lima', motivo: 'Lançada errada', valor: 80 }],
        });
        expect((r.dados.vendasCanceladasNaLoja as any).ultimas[0].quando).toMatch(/^\d{2}\/\d{2} 13:00$/);
        // Os itens removidos vêm de "Cancelamentos de itens", do mais novo para o mais antigo.
        expect(r.dados.itensRemovidosDeComandas).toMatchObject({
          removidos: 2,
          ultimos: [
            { quemRemoveu: 'Carlos Lima', item: 'Batata grande', justificativa: 'cliente desistiu' },
            { quemRemoveu: 'Edu Balcão', item: 'Refrigerante lata', justificativa: 'sem justificativa' },
          ],
        });
        expect(lidos).toEqual([['itens-removidos', A, hoje, hoje, null]]);
        // Outro período: o pedido de três dias atrás aparece, e só ele.
        const antigo = await ferramentas.executar(e, 'cancelamentos', { de: somarDias(hoje, -3), ate: somarDias(hoje, -3) });
        expect(antigo.dados.pedidosDosCanais).toMatchObject({ cancelados: 1, valor: 99, porCanal: { ifood: 1 } });
        expect(antigo.dados.vendasCanceladasNaLoja).toMatchObject({ canceladas: 0, valor: 0, ultimas: [] });

        // O gerente no perfil padrão: vê os pedidos e as vendas canceladas SEM os valores; a tela de itens removidos não é do perfil dele.
        const gerente = { ...e, nivel: 'gerente' as const, verValores: false, permissoes: perfilPadrao('gerente').permissoes };
        const g = await ferramentas.executar(gerente, 'cancelamentos', {});
        expect(g.dados.aviso).toContain('não mostra valores em reais');
        expect(g.dados.pedidosDosCanais).toMatchObject({ cancelados: 2, valor: null, ultimos: [{ numero: '901', valor: null }, { numero: '902', valor: null }] });
        expect(g.dados.vendasCanceladasNaLoja).toMatchObject({ canceladas: 1, valor: null });
        expect((g.dados.itensRemovidosDeComandas as any).aviso).toContain('não dá acesso');
        // Quem não abre nenhuma das três telas não recebe nada.
        const semNada = { ...gerente, permissoes: { dashboard: true } as any };
        expect(await ferramentas.executar(semNada, 'cancelamentos', {})).toEqual({ ok: false, dados: { erro: expect.stringContaining('não dá acesso') } });
      } finally {
        await q(`delete from pedido_externo where tenant_id = any($1::uuid[])`, [[A, B]]);
        await q(`delete from comanda where tenant_id = $1`, [A]);
      }
    });

    it('caixas e sangrias: o caixa aberto de um dia para o outro aparece como aberto agora, e o turno fechado do período traz a diferença', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const hoje = hojeISO();
      const [{ id: loja }] = await q(`select id from unidade where tenant_id = $1`, [A]);
      try {
        await q(`insert into caixa_sessao (tenant_id, unidade_id, origem, status, valor_abertura, aberta_em, aberta_por_id) values ($1, $2, 'pdv', 'aberta', 100, now() - interval '30 hours', $3)`, [A, loja, pessoa.carlos]);
        await q(
          `insert into caixa_sessao (tenant_id, unidade_id, origem, status, valor_abertura, aberta_em, aberta_por_id, fechada_em, fechada_por_id, valor_esperado, valor_informado, diferenca)
           values ($1, $2, 'pdv', 'fechada', 50, $3::timestamp ${NO_FUSO}, $4, $5::timestamp ${NO_FUSO}, $6, 500, 480, -20)`,
          [A, loja, meioDia(hoje, '00:10:00'), pessoa.carlos, meioDia(hoje, '00:40:00'), pessoa.ana],
        );
        await q(`insert into caixa_sessao (tenant_id, origem, status, valor_abertura, aberta_em) values ($1, 'pdv', 'aberta', 999, now())`, [B]);

        const r = await ferramentas.executar(e, 'caixas_e_sangrias', {});
        expect(r.ok).toBe(true);
        const abertos = r.dados.abertosAgora as any[];
        expect(abertos).toHaveLength(1);
        expect(abertos[0]).toMatchObject({ caixa: 'balcão', abertoPor: 'Carlos Lima', abertura: 100, vendas: 0, sangrias: 0, suprimentos: 0 });
        expect(abertos[0].abertoHaHoras).toBeGreaterThanOrEqual(29.9);
        expect(abertos[0].abertoHaHoras).toBeLessThanOrEqual(30.2);
        expect(abertos[0]).not.toHaveProperty('diferenca');
        expect(r.dados.turnosAbertosNoPeriodo).toMatchObject({
          total: 1,
          fechados: 1,
          fechadosComDiferenca: 1,
          lista: [{ caixa: 'balcão', abertoPor: 'Carlos Lima', fechadoPor: 'Ana Souza', abertura: 50, esperado: 500, informado: 480, diferenca: -20 }],
        });
        expect((r.dados.turnosAbertosNoPeriodo as any).lista[0].abertoEm).toMatch(/^\d{2}\/\d{2} 00:10$/);
        expect(r.dados.sangriasESuprimentos).toMatchObject({ sangrias: 0, suprimentos: 0, porOperador: [] });
        // Quem não vê valores em reais recebe os turnos sem os valores; quem não abre os relatórios de vendas, nada.
        const semValores = { ...e, nivel: 'gerente' as const, verValores: false, permissoes: { relatorios_vendas: true } as any };
        const s = await ferramentas.executar(semValores, 'caixas_e_sangrias', {});
        expect((s.dados.abertosAgora as any[])[0]).toMatchObject({ abertoPor: 'Carlos Lima', abertura: null, vendas: null });
        expect(s.dados.turnosAbertosNoPeriodo).toMatchObject({ total: 1, fechadosComDiferenca: null });
        const gerente = { ...e, nivel: 'gerente' as const, verValores: false, permissoes: perfilPadrao('gerente').permissoes };
        expect((await ferramentas.executar(gerente, 'caixas_e_sangrias', {})).dados.erro).toContain('não dá acesso');
      } finally {
        await q(`delete from caixa_sessao where tenant_id = any($1::uuid[])`, [[A, B]]);
      }
    });

    it('equipe do dia: a escala, o ponto e quem está escalado sem ponto — só com as permissões das duas telas', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      lidos.length = 0;
      const r = await ferramentas.executar(e, 'equipe_do_dia', {});
      expect(lidos).toEqual([
        ['escala', A, undefined],
        ['ponto', A, null],
      ]);
      expect(r.dados.escala).toMatchObject({
        escalados: 3,
        vagasSemPessoa: 1,
        porSetor: { Cozinha: 1, Salão: 2 },
        faltasAnotadas: [{ nome: 'Dani Salão', setor: 'Salão', falta: 'falta sem justificativa' }],
        pessoas: [
          { nome: 'Bia Chapa', setor: 'Cozinha', horario: '00:00 às 08:00', presenca: 'prevista' },
          { nome: 'Caio Caixa', setor: 'Salão', horario: '00:00 às 08:00', presenca: 'presente' },
          { nome: 'Dani Salão', setor: 'Salão', horario: '00:00 às 08:00', presenca: 'falta sem justificativa' },
        ],
      });
      expect(r.dados.ponto).toMatchObject({ bateramPonto: 1, trabalhandoAgora: 1, pessoas: [{ nome: 'Caio Caixa', situacao: 'trabalhando', trabalhado: '1h 35min' }] });
      expect((r.dados.ponto as any).pessoas[0].entrada).toMatch(/^\d{2}:\d{2}$/);
      // Escalada para um horário que já começou, sem falta anotada e sem ponto: só a Bia (o Caio bateu, a Dani tem falta).
      expect(r.dados.escaladosSemPontoAteAgora).toEqual([{ nome: 'Bia Chapa', setor: 'Cozinha', horarioComecouAs: '00:00' }]);
      // Nada além do nome, do setor, do horário e da presença vai ao modelo.
      expect(JSON.stringify(r.dados)).not.toMatch(/col-\d|cpf|telefone|salario/i);
      // De ontem não há "até agora".
      expect((await ferramentas.executar(e, 'equipe_do_dia', { dia: 'ontem' })).dados).not.toHaveProperty('escaladosSemPontoAteAgora');
      // Só a escala no perfil: o ponto vem com o aviso, e a lista cruzada não é montada.
      const soEscala = { ...e, nivel: 'gerente' as const, permissoes: { escalas: { ver: true } } as any };
      const s = await ferramentas.executar(soEscala, 'equipe_do_dia', {});
      expect(s.dados.escala).toMatchObject({ escalados: 3 });
      expect((s.dados.ponto as any).aviso).toContain('não dá acesso');
      expect(s.dados).not.toHaveProperty('escaladosSemPontoAteAgora');
      const semNada = { ...e, nivel: 'gerente' as const, permissoes: { dashboard: true } as any };
      expect((await ferramentas.executar(semNada, 'equipe_do_dia', {})).dados.erro).toContain('não dá acesso');
    });

    it('o estoque abaixo do mínimo sai em páginas de 15 e dá para procurar pelo nome', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const itens = Array.from({ length: 32 }, (_, i) => ({ nome: i === 20 ? 'Açúcar refinado' : `Item ${String(i + 1).padStart(2, '0')}`, saldo: 0, estoqueMinimo: 5, unidadeMedida: 'kg', abaixoMinimo: true }));
      const comEstoque = new MisterFerramentasService(db, modulos, null as any, null as any, { listItens: async () => [...itens, { nome: 'Sobrando', abaixoMinimo: false }], validades: async () => [] } as any, null as any, null as any, null as any, null as any, null as any, null as any);
      const p1 = (await comEstoque.executar(e, 'estoque_em_alerta', {})).dados.abaixoDoMinimo as any;
      expect(p1).toMatchObject({ total: 32, pagina: 1, paginas: 3 });
      expect(p1.itens).toHaveLength(15);
      expect(p1.observacao).toContain('página 1 de 3');
      const p3 = (await comEstoque.executar(e, 'estoque_em_alerta', { pagina: 3 })).dados.abaixoDoMinimo as any;
      expect(p3.itens).toHaveLength(2);
      // Página além do fim vira a última; busca sem acento acha o item com acento.
      expect(((await comEstoque.executar(e, 'estoque_em_alerta', { pagina: 99 })).dados.abaixoDoMinimo as any).pagina).toBe(3);
      const busca = (await comEstoque.executar(e, 'estoque_em_alerta', { busca: 'ACUCAR' })).dados.abaixoDoMinimo as any;
      expect(busca).toMatchObject({ total: 32, comOQueFoiProcurado: 1, pagina: 1, paginas: 1, itens: [{ item: 'Açúcar refinado', saldo: 0, minimo: 5, unidade: 'kg' }] });
      expect(busca).not.toHaveProperty('observacao');
    });

    // ───────────────────────────── as perguntas, parte 3: a história do pedido e os atrasados ─────────────────────────────

    it('a história de um pedido do canal: a hora de cada etapa, as estações da cozinha, onde demorou e o atraso pela regra do KDS', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const [{ id: loja }] = await q(`select id from unidade where tenant_id = $1`, [A]);
      const [{ id: chapa }] = await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token) values ($1, $2, 'kds', 'Chapa', $3) returning id`, [A, loja, `kds-${MARCA}-chapa`]);
      const [{ id: montagem }] = await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token) values ($1, $2, 'kds', 'Montagem', $3) returning id`, [A, loja, `kds-${MARCA}-montagem`]);
      const [{ id: comanda }] = await q(`insert into comanda (tenant_id, unidade_id, status, total, forma, aberta_em) values ($1, $2, 'aberta', 50, 'online', now() - interval '40 minutes') returning id`, [A, loja]);
      try {
        // Chegou há 40 min, aceito 2 min depois, a chapa terminou há 10 min e a montagem está com ele há 12 min (vermelho = 10).
        await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, status, total, valor_bruto, taxa_entrega, taxa_entrega_dono, display_id, numero, comanda_id, criado_em, confirmado_em)
           values ($1, $2, 'ifood', 'confirmado', 50, 50, 0, 'marketplace', '4821', 284, $3, now() - interval '40 minutes', now() - interval '38 minutes')`,
          [A, loja, comanda],
        );
        await q(
          `insert into producao_pedido (tenant_id, unidade_id, comanda_id, destino_equipamento_id, destino_tipo, senha, senha_prefixo, origem, plataforma, status, criado_em, iniciado_em, estacoes)
           values ($1, $2, $3, $4, 'kds', 12, 'D', 'delivery', 'iFood', 'preparo', now() - interval '12 minutes 30 seconds', now() - interval '11 minutes 30 seconds',
                   jsonb_build_array(jsonb_build_object('kds', $5::text, 'pronto', to_char((now() - interval '12 minutes') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))))`,
          [A, loja, comanda, montagem, String(chapa)],
        );
        const r = await ferramentas.executar(e, 'historia_do_pedido', { numero: '#4821' });
        expect(r.ok).toBe(true);
        expect(r.dados.pedido).toEqual({ comoAparece: '#284 · iFood 4821', senhaNaCozinha: 'D12', canal: 'ifood', numero: '4821', tipo: 'entrega', situacao: 'em preparo' });
        const horarios = r.dados.horarios as any[];
        expect(horarios.map((h) => h.etapa)).toEqual(['chegou', 'aceito', 'entrou na cozinha', 'começou a ser feito', 'ficou pronto', 'saiu para entrega', 'entregue']);
        for (const h of horarios.slice(0, 4)) expect(h.hora).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
        expect(horarios.slice(4).map((h) => h.hora)).toEqual([null, null, null]);
        // Onde demorou: da entrada na cozinha (o cartão da montagem) para trás está o maior trecho — da aceitação até lá.
        expect(r.dados.tempoEntreAsEtapas).toEqual([
          { de: 'chegou', ate: 'aceito', minutos: 2 },
          { de: 'aceito', ate: 'entrou na cozinha', minutos: 26 },
          { de: 'entrou na cozinha', ate: 'começou a ser feito', minutos: 1 },
        ]);
        expect(r.dados.ondeDemorouMais).toEqual({ de: 'aceito', ate: 'entrou na cozinha', minutos: 26 });
        expect(r.dados.cozinha).toEqual([
          expect.objectContaining({
            estacao: 'Montagem',
            situacao: 'em preparo',
            passouAntesPor: [{ estacao: 'Chapa', prontoAs: expect.stringMatching(/^\d{2}\/\d{2} \d{2}:\d{2}$/) }],
            atrasadoAgora: { haMinutos: 12, porque: 'passou do vermelho do KDS (10 min)' },
          }),
        ]);
        expect(r.dados.limitesDoKds).toEqual({ verdeAteMin: 5, amareloAteMin: 10 });
        expect(r.dados.aindaNaCozinha).toBe(true);
        // Pelo número do dia e pela senha da cozinha, o mesmo pedido.
        expect(((await ferramentas.executar(e, 'historia_do_pedido', { numero: 'pedido 284' })).dados.pedido as any).numero).toBe('4821');
        // Número que não existe nos últimos 3 dias; número vazio.
        expect(await ferramentas.executar(e, 'historia_do_pedido', { numero: '9999' })).toEqual({ ok: false, dados: { erro: expect.stringContaining('Não achei pedido com o número 9999') } });
        expect((await ferramentas.executar(e, 'historia_do_pedido', {})).dados.erro).toContain('Diga o número do pedido');
        // O pedido do canal pede a permissão do Delivery; de outra empresa, nunca aparece.
        const semDelivery = { ...e, nivel: 'gerente' as const, permissoes: { dashboard: true } as any };
        expect((await ferramentas.executar(semDelivery, 'historia_do_pedido', { numero: '4821' })).dados.erro).toContain('não dá acesso');
        const telB = telefone();
        await ligar('anaB', telB, B);
        const deB = (await ferramentas.escopo(B, pessoa.anaB, telB))!;
        expect((await ferramentas.executar(deB, 'historia_do_pedido', { numero: '4821' })).ok).toBe(false);
        // Dois pedidos com o mesmo número nos últimos 3 dias: a pessoa escolhe pelo horário.
        await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, status, total, valor_bruto, taxa_entrega, taxa_entrega_dono, display_id, criado_em)
           values ($1, $2, '99food', 'concluido', 30, 30, 0, 'marketplace', '4821', now() - interval '1 day')`,
          [A, loja],
        );
        const dois = await ferramentas.executar(e, 'historia_do_pedido', { numero: '4821' });
        expect((dois.dados.maisDeUmPedido as any[]).map((p) => p.canal)).toEqual(['ifood', '99food']);
      } finally {
        await q(`delete from producao_pedido where tenant_id = $1`, [A]);
        await q(`delete from pedido_externo where tenant_id = $1`, [A]);
        await q(`delete from comanda where tenant_id = $1`, [A]);
        await q(`delete from equipamento where tenant_id = $1 and tipo = 'kds'`, [A]);
      }
    });

    it('a história de uma venda do balcão pela senha da cozinha, e "pedidos em andamento" conta os atrasados pela regra do KDS', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const [{ id: loja }] = await q(`select id from unidade where tenant_id = $1`, [A]);
      try {
        // Venda do balcão sem comanda ligada: o cartão pronto, com o tempo de preparo de 8 min.
        await q(
          `insert into producao_pedido (tenant_id, unidade_id, destino_tipo, senha, senha_prefixo, origem, status, tempo_preparo_min, criado_em, iniciado_em, pronto_em)
           values ($1, $2, 'kds', 7, 'B', 'balcao', 'pronto', 8, now() - interval '20 minutes', now() - interval '19 minutes', now() - interval '5 minutes')`,
          [A, loja],
        );
        const r = await ferramentas.executar(e, 'historia_do_pedido', { numero: 'b7' });
        expect(r.ok).toBe(true);
        expect(r.dados.pedido).toEqual({ comoAparece: 'venda do balcão, senha B7', origem: 'balcao', senha: 'B7' });
        expect((r.dados.horarios as any[]).map((h) => h.etapa)).toEqual(['chegou', 'entrou na cozinha', 'começou a ser feito', 'ficou pronto']);
        expect(r.dados.ondeDemorouMais).toEqual({ de: 'começou a ser feito', ate: 'ficou pronto', minutos: 14 });
        expect((r.dados.cozinha as any[])[0]).toMatchObject({ estacao: 'cozinha', situacao: 'pronto', tempoDePreparoPrevistoMin: 8 });
        expect((r.dados.cozinha as any[])[0]).not.toHaveProperty('atrasadoAgora');
        expect(r.dados).not.toHaveProperty('aindaNaCozinha');
      } finally {
        await q(`delete from producao_pedido where tenant_id = $1`, [A]);
      }
      // A fila de mentira: o pedido 1 está há 22 min (passou do vermelho de 10), o 2 há 3 min (verde). O pedido 1 é o iFood
      // 9001 (#5 do dia): é assim que ele sai, e não pela senha da cozinha (pedido do dono, 14/11).
      await q(
        `insert into pedido_externo (tenant_id, unidade_id, canal, status, total, valor_bruto, taxa_entrega, taxa_entrega_dono, display_id, numero, comanda_id)
         values ($1, $2, 'ifood', 'confirmado', 40, 40, 0, 'marketplace', '9001', 5, $3)`,
        [A, loja, COMANDA_1],
      );
      const agora = await ferramentas.executar(e, 'pedidos_em_andamento', {}).finally(() => q(`delete from pedido_externo where comanda_id = $1`, [COMANDA_1]));
      expect((agora.dados.cozinha as any).maisAntigoSemFicarPronto).toMatchObject({ comoAparece: '#5 · iFood 9001', senhaNaCozinha: 'D12' });
      expect((agora.dados.cozinha as any).atrasadosAgora).toEqual({
        total: 1,
        regra: expect.stringContaining('verde até 5 min, amarelo até 10 min'),
        pedidos: [{ comoAparece: '#5 · iFood 9001', origem: 'iFood', senhaNaCozinha: 'D12', situacao: 'em preparo', haMinutos: 22, porque: 'passou do vermelho do KDS (10 min)' }],
      });
    });

    it('caixa esquecido há meses aparece como aberto agora, com os dias e o aviso das 24 horas (ERR-462)', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const [{ id: loja }] = await q(`select id from unidade where tenant_id = $1`, [A]);
      try {
        await q(`insert into caixa_sessao (tenant_id, unidade_id, origem, status, valor_abertura, aberta_em, aberta_por_id) values ($1, $2, 'pdv', 'aberta', 10, now() - interval '90 days 2 hours', $3)`, [A, loja, pessoa.carlos]);
        await q(`insert into caixa_sessao (tenant_id, unidade_id, origem, status, valor_abertura, aberta_em, aberta_por_id) values ($1, $2, 'pdv', 'aberta', 20, now() - interval '2 hours', $3)`, [A, loja, pessoa.ana]);
        const r = await ferramentas.executar(e, 'caixas_e_sangrias', {});
        const abertos = r.dados.abertosAgora as any[];
        expect(abertos).toHaveLength(2);
        const velho = abertos.find((a) => a.abertoPor === 'Carlos Lima');
        expect(velho).toMatchObject({ abertoHaDias: 90, passouDe24Horas: true, abertura: 10 });
        const novo = abertos.find((a) => a.abertoPor === 'Ana Souza');
        expect(novo).toMatchObject({ passouDe24Horas: false, abertura: 20 });
        expect(novo).not.toHaveProperty('abertoHaDias');
        // Sem caixa aberto: lista vazia, sem consultar o relatório à toa.
        await q(`update caixa_sessao set status = 'fechada', fechada_em = now() where tenant_id = $1`, [A]);
        expect((await ferramentas.executar(e, 'caixas_e_sangrias', {})).dados.abertosAgora).toEqual([]);
      } finally {
        await q(`delete from caixa_sessao where tenant_id = $1`, [A]);
      }
    });

    // ───────────────────────────── mais dados para a conversa aberta ─────────────────────────────

    it('os tempos dos pedidos: aceite, pronto, saída e entrega por canal, e a fila e o preparo na cozinha — encomenda e cancelado fora', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const [{ id: loja }] = await q(`select id from unidade where tenant_id = $1`, [A]);
      const ped = (canal: string, tipo: string, status: string, mins: (number | null)[], agendado = false) =>
        q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, tipo, status, total, valor_bruto, taxa_entrega, taxa_entrega_dono,
                                       criado_em, confirmado_em, pronto_em, despachado_em, entregue_em, agendamento)
           values ($1, $2, $3, $4, $5, 30, 30, 0, 'marketplace',
                   now() - make_interval(mins => $6), case when $7::int is null then null else now() - make_interval(mins => $7::int) end,
                   case when $8::int is null then null else now() - make_interval(mins => $8::int) end,
                   case when $9::int is null then null else now() - make_interval(mins => $9::int) end,
                   case when $10::int is null then null else now() - make_interval(mins => $10::int) end,
                   case when $11 then now() + interval '2 hours' end)`,
          [A, loja, canal, tipo, status, ...mins, agendado],
        );
      const cartao = (origem: string, status: string, mins: number[]) =>
        q(
          `insert into producao_pedido (tenant_id, unidade_id, destino_tipo, origem, status, criado_em, iniciado_em, pronto_em)
           values ($1, $2, 'kds', $3, $4, now() - make_interval(mins => $5), now() - make_interval(mins => $6), now() - make_interval(mins => $7))`,
          [A, loja, origem, status, ...mins],
        );
      try {
        // Minutos ATRÁS de agora: criado, aceito, pronto, saiu, entregue.
        await ped('ifood', 'entrega', 'entregue', [60, 58, 40, 35, 10]);
        await ped('cardapio', 'entrega', 'despachado', [50, 49, 30, 28, 5]);
        await ped('ifood', 'retirada', 'pronto', [30, 29, 20, null, null]);
        await ped('ifood', 'entrega', 'confirmado', [40, 39, null, null, null], true); // encomenda: fora
        await ped('ifood', 'entrega', 'cancelado', [45, 44, 1, 1, 1]); // cancelado: fora
        await cartao('delivery', 'pronto', [40, 38, 30]);
        await cartao('balcao', 'entregue', [20, 15, 5]);
        await cartao('balcao', 'cancelado', [20, 19, 1]); // cancelado: fora
        const r = await ferramentas.executar(e, 'tempos_dos_pedidos', { de: somarDias(hojeISO(), -1), ate: hojeISO() });
        expect(r.ok).toBe(true);
        expect(r.dados.pedidosDosCanais).toEqual({
          pedidos: 3,
          doAceite: { mediaMin: 1.3, osMaisLentosMin: 1.8, pedidos: 3 },
          ateFicarPronto: { mediaMin: 16.7, osMaisLentosMin: 20, pedidos: 3 },
          ateSairParaEntrega: { mediaMin: 23.5, osMaisLentosMin: 24.7, pedidos: 2 },
          ateEntregar: { mediaMin: 47.5, osMaisLentosMin: 49.5, pedidos: 2 },
          porCanal: [
            { canal: 'Cardápio', pedidos: 1, ateFicarPronto: { mediaMin: 20, osMaisLentosMin: 20, pedidos: 1 }, ateEntregar: { mediaMin: 45, osMaisLentosMin: 45, pedidos: 1 } },
            { canal: 'iFood', pedidos: 2, ateFicarPronto: { mediaMin: 15, osMaisLentosMin: 19, pedidos: 2 }, ateEntregar: { mediaMin: 50, osMaisLentosMin: 50, pedidos: 1 } },
          ],
        });
        expect(r.dados.cozinha).toEqual({
          cartoes: 2,
          naFilaAteComecar: { mediaMin: 3.5, osMaisLentosMin: 4.7, pedidos: 2 },
          preparando: { mediaMin: 9, osMaisLentosMin: 9.8, pedidos: 2 },
          daEntradaAtePronto: { mediaMin: 12.5, osMaisLentosMin: 14.5, pedidos: 2 },
          porOrigem: [
            { origem: 'balcão e mesas', cartoes: 1, daEntradaAtePronto: { mediaMin: 15, osMaisLentosMin: 15, pedidos: 1 } },
            { origem: 'delivery', cartoes: 1, daEntradaAtePronto: { mediaMin: 10, osMaisLentosMin: 10, pedidos: 1 } },
          ],
        });
        // Sem a permissão do Delivery, os pedidos dos canais não vêm (a cozinha vem).
        const semDelivery = { ...e, nivel: 'gerente' as const, permissoes: { dashboard: true } as any };
        const s = await ferramentas.executar(semDelivery, 'tempos_dos_pedidos', {});
        expect((s.dados.pedidosDosCanais as any).aviso).toContain('não dá acesso');
        expect(s.dados.cozinha).toHaveProperty('cartoes');
        // A outra empresa não vê nada disto.
        const telB = telefone();
        await ligar('anaB', telB, B);
        const deB = (await ferramentas.escopo(B, pessoa.anaB, telB))!;
        expect(((await ferramentas.executar(deB, 'tempos_dos_pedidos', { de: somarDias(hojeISO(), -1), ate: hojeISO() })).dados.pedidosDosCanais as any).pedidos).toBe(0);
      } finally {
        await q(`delete from producao_pedido where tenant_id = $1`, [A]);
        await q(`delete from pedido_externo where tenant_id = $1`, [A]);
      }
    });

    it('vendas do período: o horário de pico e a comparação com o período anterior (variação nula sem base)', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const r = await ferramentas.executar(e, 'vendas_do_periodo', { periodo: 'esta_semana', comparar: true });
      expect(r.dados).toMatchObject({ porHora: [], horarioDePico: null });
      expect(r.dados.comparacao).toMatchObject({
        numeroDeVendas: 0,
        faturamento: 0,
        delivery: { pedidos: 0, faturamento: 0 },
        variacaoPct: { vendas: null, faturamento: null, ticketMedio: null, pedidosDoDelivery: null, faturamentoDoDelivery: null },
      });
      expect(String((r.dados.comparacao as any).periodo)).toMatch(/^(\d{2}\/\d{2}|de \d{2}\/\d{2} a \d{2}\/\d{2})$/);
      // Sem "comparar", não vem a comparação.
      expect((await ferramentas.executar(e, 'vendas_do_periodo', {})).dados).not.toHaveProperty('comparacao');
      // Com vendas de verdade: duas no período (ontem e hoje) e uma no anterior (os dois dias antes) — +100%.
      const [{ id: loja }] = await q(`select id from unidade where tenant_id = $1`, [A]);
      const venda = (horas: number, total: number) =>
        q(`insert into comanda (tenant_id, unidade_id, status, total, forma, aberta_em, fechada_em) values ($1, $2, 'fechada', $3, 'dinheiro', now() - make_interval(hours => $4) - interval '10 minutes', now() - make_interval(hours => $4))`, [A, loja, total, horas]);
      try {
        await venda(1, 40);
        await venda(1, 60);
        await venda(49, 50);
        const c = await ferramentas.executar(e, 'vendas_do_periodo', { de: somarDias(hojeISO(), -1), ate: hojeISO(), comparar: true });
        expect(c.dados).toMatchObject({ numeroDeVendas: 2, faturamento: 100 });
        expect(c.dados.comparacao).toMatchObject({ numeroDeVendas: 1, faturamento: 50, variacaoPct: { vendas: 100, faturamento: 100, ticketMedio: 0 } });
        expect(c.dados.horarioDePico).toMatch(/^\d{2}h$/);
        expect((c.dados.porHora as any[]).reduce((s, h) => s + h.vendas, 0)).toBe(2);
      } finally {
        await q(`delete from comanda where tenant_id = $1`, [A]);
      }
    });

    it('produtos por lucro: o que dá mais lucro primeiro, o sem custo no fim, com a margem e a classe da curva', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const curva = {
        itens: [
          { descricao: 'Burger', qtd: 10, faturamento: 300, custo: 240, lucro: 60, margemPct: 20, classe: 'A' },
          { descricao: 'Refri', qtd: 20, faturamento: 100, custo: null, lucro: null, margemPct: null, classe: 'B' },
          { descricao: 'Batata', qtd: 15, faturamento: 90, custo: 18, lucro: 72, margemPct: 80, classe: 'B' },
        ],
      };
      const comCurva = new MisterFerramentasService(db, modulos, null as any, { produtos: async () => curva } as any, null as any, null as any, null as any, null as any, null as any, null as any, null as any);
      const r = await comCurva.executar(e, 'produtos_mais_vendidos', { ordem: 'lucro', quantos: 3 });
      expect(r.dados).toMatchObject({ ordenadoPor: 'lucro', produtosVendidosNoPeriodo: 3 });
      expect((r.dados.produtos as any[]).map((p) => [p.produto, p.lucro, p.margemPct, p.classe])).toEqual([
        ['Batata', 72, 80, 'B'],
        ['Burger', 60, 20, 'A'],
        ['Refri', null, null, 'B'],
      ]);
      expect(r.dados.semCusto).toContain('1 produto(s) sem custo cadastrado');
      // Por faturamento, a ordem da curva, também com o lucro.
      const f = await comCurva.executar(e, 'produtos_mais_vendidos', { ordem: 'faturamento', quantos: 3 });
      expect((f.dados.produtos as any[]).map((p) => p.produto)).toEqual(['Burger', 'Refri', 'Batata']);
      expect((f.dados.produtos as any[])[0]).toMatchObject({ custo: 240, lucro: 60, margemPct: 20 });
      // Quem não vê valores em reais não ordena por lucro.
      const semValores = { ...e, nivel: 'gerente' as const, verValores: false, permissoes: { relatorios_vendas: true } as any };
      expect((await comCurva.executar(semValores, 'produtos_mais_vendidos', { ordem: 'lucro' })).dados.erro).toContain('não dá para ordenar por lucro');
    });

    it('o Atendimento agora: a fila da tela no escopo da pessoa, sem nome, telefone nem mensagem do cliente', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const chamadas: any[] = [];
      const haMin = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
      const daquiMin = (m: number) => new Date(Date.now() + m * 60_000 + 20_000).toISOString();
      const caso = (o: Record<string, unknown>) => ({ cliente: 'Maria Cliente', telefone: '5521988887777', mensagem: 'Rua das Flores, 10 — troquem o refri', prioridade: 'normal', ...o });
      let fila: any = {
        casos: [
          caso({ tipo: 'disputa', situacao: 'fila', prazoEm: daquiMin(7), criadoEm: haMin(3), pedidoId: 'p1', pedidoCanal: 'ifood', pedidoNaPlataforma: '4821' }),
          caso({ tipo: 'outro', situacao: 'com_alguem', prioridade: 'urgente', criadoEm: haMin(12), responsavelNome: 'Bruno Atendente Silva', pedidoNumero: '77' }),
          caso({ tipo: 'fornecedor', situacao: 'responsavel', criadoEm: haMin(40) }),
          caso({ tipo: 'tipo_novo', situacao: 'aguardando', criadoEm: haMin(5) }),
        ],
        contagens: { abertos: 3, naFila: 1, comPrazo: 1, comigo: 0, aguardando: 1, resolvidosHoje: 6, paraAbertura: 0, paraOResponsavel: 1 },
        equipe: { modo: 'loja', atendendo: false, voltaTexto: 'volta às 18:00' },
      };
      const comAtendimento = new MisterFerramentasService(
        db, modulos, null as any, null as any, null as any, null as any, null as any, null as any, null as any, null as any, null as any,
        undefined, undefined, undefined, undefined, undefined,
        { fila: async (quem: any, loja: any, opcoes: any) => (chamadas.push({ quem, loja, opcoes }), fila) } as any,
      );
      const r = await comAtendimento.executar(e, 'atendimento_agora', {});
      expect(r.ok).toBe(true);
      // A fila da tela, no escopo da pessoa (a régua do perfil é a da tela), com os recados.
      expect(chamadas).toEqual([{ quem: { tenantId: A, colaboradorId: pessoa.ana, categoria: 'presidente', unidadeId: null }, loja: null, opcoes: { comRecados: true } }]);
      expect(r.dados).toMatchObject({
        emAberto: 3, naFilaSemNinguem: 1, comPrazo: 1, aguardandoOCliente: 1, resolvidosHoje: 6, recadosParaOResponsavel: 1,
        equipeForaDoHorario: true, equipeVolta: 'volta às 18:00',
      });
      expect(r.dados).not.toHaveProperty('recadosParaAAbertura');
      expect(r.dados.casos).toEqual([
        { assunto: 'Disputa', situacao: 'na fila, sem ninguém', esperaHaMinutos: 3, prazoAs: expect.stringMatching(/^\d{2}:\d{2}$/), prazoEmMinutos: 7, pedido: 'iFood 4821' },
        { assunto: 'Atendimento', situacao: 'com alguém da equipe', urgente: true, esperaHaMinutos: 12, pedido: 'pedido 77', comQuem: 'Bruno' },
        { assunto: 'Fornecedor', situacao: 'recado para o responsável', esperaHaMinutos: 40 },
        { assunto: 'Atendimento', situacao: 'aguardando o cliente', esperaHaMinutos: 5 },
      ]);
      // Nada do cliente vai à IA: nem o nome, nem o telefone, nem a mensagem (que pode ter o endereço).
      const texto = JSON.stringify(r.dados);
      for (const dado of ['Maria', '5521988887777', 'Rua das Flores', 'refri']) expect(texto).not.toContain(dado);
      // Mais de 10: os 10 primeiros, e o aviso de quantos são.
      fila = { ...fila, casos: Array.from({ length: 14 }, (_, i) => caso({ tipo: 'chat', situacao: 'fila', criadoEm: haMin(i) })) };
      const muitos = await comAtendimento.executar(e, 'atendimento_agora', {});
      expect(muitos.dados.casos).toHaveLength(10);
      expect(muitos.dados.observacao).toBe('Os 10 primeiros de 14 na ordem da fila.');
      // O gerente preso à loja: a fila da loja dele; sem a permissão da tela, a recusa.
      const [{ id: lojaA }] = await q(`select id from unidade where tenant_id = $1`, [A]);
      const gerente = { ...e, nivel: 'gerente' as const, lojaUnica: false, presa: lojaA, lojas: [{ id: lojaA, nome: 'Loja Centro' }], permissoes: { pedidos: true } as any };
      chamadas.length = 0;
      expect((await comAtendimento.executar(gerente, 'atendimento_agora', {})).ok).toBe(true);
      expect(chamadas[0]).toMatchObject({ quem: { categoria: 'gerente', unidadeId: lojaA }, loja: lojaA });
      expect((await comAtendimento.executar({ ...gerente, permissoes: { delivery: true } as any }, 'atendimento_agora', {})).dados.erro).toContain('não dá acesso');
    });

    it('a conferência do cardápio com os apps: a leitura guardada da loja, em português, com a permissão da tela', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const [{ id: loja }] = await q(`select id from unidade where tenant_id = $1`, [A]);
      const pedidos: any[] = [];
      let resposta: any = {
        ligada: true,
        loja: { id: loja, nome: 'Loja Centro' },
        canais: {
          ifood: {
            ligado: true, motivo: null, lidoEm: '2026-11-14T12:05:00.000Z', ultimaLeituraFalhou: null, aResolver: 2,
            porSituacao: { soNoApp: 1, soNoRegem: 0, precoDiferente: 1, naoLigaPeloCodigo: 0 },
            exemplos: [
              { tipo: 'produto', nome: 'X-Salada', codigoPdv: '2052', situacao: 'preco', motivo: 'precoDiferente', precoNoApp: [29.9], precoNoRegem: 32.9 },
              { tipo: 'produto', nome: 'Combo', codigoPdv: null, situacao: 'soApp', motivo: 'semCodigo', precoNoApp: [59.9], precoNoRegem: null },
            ],
          },
          '99food': { ligado: false, motivo: 'Esta loja não está conectada à 99.', lidoEm: null, ultimaLeituraFalhou: null, aResolver: null, porSituacao: null, exemplos: [] },
        },
      };
      const comConferencia = new MisterFerramentasService(
        db, modulos, null as any, null as any, null as any, null as any, null as any, null as any, null as any, null as any, null as any,
        undefined, undefined, undefined, undefined,
        { resumoGuardado: async (t: string, l: string) => (pedidos.push([t, l]), resposta) } as any,
      );
      const r = await comConferencia.executar(e, 'conferencia_do_catalogo', {});
      expect(r.ok).toBe(true);
      // Empresa de uma loja: a loja vai ao serviço mesmo sem ser pedida.
      expect(pedidos).toEqual([[A, loja]]);
      expect(r.dados).toEqual({
        loja: 'Loja Centro',
        apps: [
          {
            app: 'iFood', lidoEm: '14/11 09:05', aResolver: 2,
            porSituacao: { soNoApp: 1, soNoRegem: 0, precoDiferente: 1, naoLigaPeloCodigo: 0 },
            exemplos: [
              { tipo: 'produto', nome: 'X-Salada', codigoPdv: '2052', situacao: 'preço diferente', porque: 'preço diferente', precoNoApp: [29.9], precoNoRegem: 32.9 },
              { tipo: 'produto', nome: 'Combo', codigoPdv: null, situacao: 'só no app', porque: 'sem código PDV no app', precoNoApp: [59.9], precoNoRegem: null },
            ],
          },
          { app: '99', ligado: false, motivo: 'Esta loja não está conectada à 99.', lidoEm: null, observacao: 'Nunca foi lido pela tela "Conferir com os apps".' },
        ],
      });
      // Quem não vê valores: sem os preços.
      const semValores = { ...e, nivel: 'gerente' as const, verValores: false, permissoes: { loja: true } as any };
      const sv = await comConferencia.executar(semValores, 'conferencia_do_catalogo', {});
      expect((sv.dados.apps as any[])[0].exemplos[0]).not.toHaveProperty('precoNoApp');
      expect(sv.dados.aviso).toContain('não mostra valores');
      // Sem a permissão da tela; desligada na empresa; várias lojas sem escolher.
      expect((await comConferencia.executar({ ...e, nivel: 'gerente' as const, permissoes: { delivery: true } as any }, 'conferencia_do_catalogo', {})).dados.erro).toContain('não dá acesso');
      resposta = { ligada: false };
      expect((await comConferencia.executar(e, 'conferencia_do_catalogo', {})).dados).toMatchObject({ ligada: false, observacao: expect.stringContaining('não está ligada') });
      const duas = { ...e, lojaUnica: false, lojas: [{ id: loja, nome: 'Centro' }, { id: randomUUID(), nome: 'Praia' }] };
      pedidos.length = 0;
      expect((await comConferencia.executar(duas, 'conferencia_do_catalogo', {})).dados.erro).toContain('é por loja. As lojas são: 1. Centro; 2. Praia');
      expect(pedidos).toEqual([]);
      expect(((await comConferencia.executar(duas, 'conferencia_do_catalogo', { loja: 'Praia' })).ok)).toBe(true);
      expect(pedidos).toEqual([[A, duas.lojas[1].id]]);
    });

    it('os canais e as integrações: a pausa e o último pedido de cada canal, o login da 99, o WhatsApp da loja e a nota fiscal', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const [{ id: loja }] = await q(`select id from unidade where tenant_id = $1`, [A]);
      let estadoDoWhatsapp = 'close';
      let loginDa99 = { conectado: true, autenticado: false };
      const comCanais = new MisterFerramentasService(
        db, modulos, null as any, null as any, null as any, null as any, null as any, null as any, null as any, null as any, null as any,
        new PausaDoCanalService(db, auditoria),
        { status: async () => loginDa99 } as any,
        { status: async () => ({ conectado: estadoDoWhatsapp === 'open', estado: estadoDoWhatsapp }) } as any,
        { estado: async () => ({ provedor: 'evolution', evolution: { vinculado: true }, cloud: { vinculado: false } }) } as any,
      );
      const pedido = (canal: string, quando: string, tenant = A, apagado = false) =>
        q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, status, total, valor_bruto, taxa_entrega, taxa_entrega_dono, criado_em, deleted_at)
           values ($1, $2, $3, 'concluido', 30, 30, 0, 'marketplace', ${quando}, ${apagado ? 'now()' : 'null'})`,
          [tenant, tenant === A ? loja : null, canal],
        );
      const nota = (numero: number, status: string, quando: string, simulada = false) =>
        q(`insert into nota_fiscal (tenant_id, unidade_id, serie, numero, status, simulada, motivo, created_at) values ($1, $2, 7, $3, $4, $5, $6, ${quando})`, [
          A, loja, numero, status, simulada, status === 'rejeitada' ? 'Rejeição: NCM inexistente' : null,
        ]);
      try {
        await pedido('cardapio', 'now()');
        await pedido('cardapio', 'now()');
        await pedido('ifood', "now() - interval '3 days'");
        await pedido('anotaai', 'now()');
        await pedido('cardapio', 'now()', A, true); // apagado: não conta
        await pedido('99food', 'now()', B); // de outra empresa: não conta
        await q(
          `insert into pausa_canal (id, tenant_id, unidade_id, canal, ate, motivo, pausado_em, pausado_por_nome)
           values (gen_random_uuid(), $1, null, 'cardapio', now() + interval '40 minutes', 'movimento', now(), 'Ana Gerente')`,
          [A],
        );
        await q(`insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente) values ($1, null, true, '2')`, [A]);
        await q(`insert into fiscal_credencial (tenant_id, unidade_id, cert_valido_ate) values ($1, null, now() + interval '10 days 1 hour')`, [A]);
        await nota(1, 'autorizada', 'now()');
        await nota(2, 'rejeitada', "now() - interval '1 hour'");
        await nota(3, 'pendente', "now() - interval '20 minutes'"); // sem resposta
        await nota(4, 'pendente', "now() - interval '2 minutes'"); // ainda é cedo
        await nota(5, 'contingencia', "now() - interval '3 hours'");
        await nota(6, 'rejeitada', 'now()', true); // simulada: fora
        await nota(7, 'rejeitada', "now() - interval '2 days'"); // antes das 24 h: fora

        const r = await comCanais.executar(e, 'canais_e_integracoes', {});
        expect(r.ok).toBe(true);
        const canais = r.dados.canais as any[];
        expect(canais.map((c) => c.canal)).toEqual(['Cardápio digital', 'iFood', '99']);
        // A pausa vai até daqui a 40 min: depois das 23:20 a volta é "amanhã às 00:xx" (ERR-467) — as duas formas valem.
        expect(canais[0]).toMatchObject({ pausa: { pausado: true, volta: expect.stringMatching(/^(amanhã )?às \d{2}:\d{2}$/), pausadoPor: 'Ana' }, pedidosHoje: 2, ultimoPedidoHaMinutos: 0 });
        expect(canais[0].pausa.motivo).toBeTruthy();
        expect(canais[1]).toMatchObject({ pausa: { pausado: false }, pedidosHoje: 0, ultimoPedido: expect.stringMatching(/^\d{2}\/\d{2} \d{2}:\d{2}$/) });
        expect(canais[1].ultimoPedidoHaMinutos).toBeGreaterThanOrEqual(3 * 24 * 60 - 2);
        expect(canais[2]).toEqual({ canal: '99', pausa: { pausado: false }, ultimoPedido: null, ultimoPedidoHaMinutos: null, pedidosHoje: 0 });
        expect(r.dados.outrosCanais).toEqual([{ canal: 'Anota Aí', pedidosHoje: 1, ultimoPedido: expect.any(String) }]);
        expect(r.dados.loginDa99).toEqual({ emDia: false, observacao: expect.stringContaining('venceu ou foi recusado') });
        expect(r.dados.whatsappDaLoja).toEqual({ conexao: 'WhatsApp pelo QR', ligado: true, conectadoAgora: false, observacao: expect.stringContaining('ler o QR de novo') });
        expect(r.dados.notaFiscal).toEqual({
          ligada: true,
          lojas: [{ loja: 'a empresa toda', ambiente: 'em teste (homologação)', certificado: { venceEm: expect.any(String), diasParaVencer: 10, situacao: 'vence em breve' } }],
          ultimas24h: { autorizadas: 1, recusadas: 1, semRespostaDaSefaz: 1, emContingencia: 1 },
          ultimasRecusadas: [{ numero: '7-2', motivo: 'Rejeição: NCM inexistente', quando: expect.any(String) }],
        });

        // Conectado e com o login em dia; a empresa sem a 99 não traz o login.
        estadoDoWhatsapp = 'open';
        loginDa99 = { conectado: true, autenticado: true };
        const ok = await comCanais.executar(e, 'canais_e_integracoes', {});
        expect(ok.dados.whatsappDaLoja).toEqual({ conexao: 'WhatsApp pelo QR', ligado: true, conectadoAgora: true });
        expect(ok.dados.loginDa99).toEqual({ emDia: true });
        loginDa99 = { conectado: false, autenticado: false };
        expect(await comCanais.executar(e, 'canais_e_integracoes', {})).not.toHaveProperty('dados.loginDa99');

        // Sem a permissão da nota fiscal, ela não vem; sem o Delivery, os canais não vêm; sem as duas, a recusa.
        const semFiscal = { ...e, nivel: 'gerente' as const, permissoes: { delivery: true } as any };
        const sf = await comCanais.executar(semFiscal, 'canais_e_integracoes', {});
        expect((sf.dados.notaFiscal as any).aviso).toContain('não dá acesso');
        expect(sf.dados.canais).toHaveLength(3);
        const soFiscal = { ...e, nivel: 'gerente' as const, permissoes: { fiscal: true } as any };
        const so = await comCanais.executar(soFiscal, 'canais_e_integracoes', {});
        expect((so.dados.canais as any).aviso).toContain('não dá acesso');
        expect(so.dados).not.toHaveProperty('whatsappDaLoja');
        expect((so.dados.notaFiscal as any).ligada).toBe(true);
        const nenhuma = { ...e, nivel: 'gerente' as const, permissoes: { dashboard: true } as any };
        expect((await comCanais.executar(nenhuma, 'canais_e_integracoes', {})).dados.erro).toContain('não dá acesso');

        // Várias lojas e nenhuma escolhida: cada loja com os seus canais (o pedido sem loja conta nas duas — V4).
        const [{ id: praia }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Praia ${MARCA}') returning id`, [A]);
        try {
          await q(`insert into pedido_externo (tenant_id, unidade_id, canal, status, total, valor_bruto, taxa_entrega, taxa_entrega_dono, criado_em) values ($1, $2, 'ifood', 'concluido', 30, 30, 0, 'marketplace', now())`, [A, praia]);
          const duas = { ...e, lojaUnica: false, lojas: [{ id: loja, nome: 'Centro' }, { id: praia, nome: 'Praia' }] };
          const pl = await comCanais.executar(duas, 'canais_e_integracoes', {});
          const porLoja = pl.dados.porLoja as any[];
          expect(porLoja.map((l) => [l.loja, l.canais[0].pedidosHoje, l.canais[1].pedidosHoje])).toEqual([
            ['Centro', 2, 0],
            ['Praia', 0, 1],
          ]);
          expect(pl.dados).not.toHaveProperty('canais');
        } finally {
          await q(`delete from pedido_externo where unidade_id = $1`, [praia]);
          await q(`delete from unidade where id = $1`, [praia]);
        }

        // A nota fiscal desligada; o certificado vencido.
        await q(`update fiscal_credencial set cert_valido_ate = now() - interval '2 days' where tenant_id = $1`, [A]);
        expect(((await comCanais.executar(e, 'canais_e_integracoes', {})).dados.notaFiscal as any).lojas[0].certificado).toMatchObject({ situacao: 'vencido' });
        await q(`update fiscal_config set ativo = false where tenant_id = $1`, [A]);
        expect((await comCanais.executar(e, 'canais_e_integracoes', {})).dados.notaFiscal).toEqual({ ligada: false, observacao: 'A nota fiscal não está ligada no Regem.' });

        // A outra empresa não vê nada desta.
        const telB = telefone();
        await ligar('anaB', telB, B);
        const deB = (await ferramentas.escopo(B, pessoa.anaB, telB))!;
        const rb = await comCanais.executar(deB, 'canais_e_integracoes', {});
        expect((rb.dados.canais as any[]).map((c) => c.pedidosHoje)).toEqual([0, 0, 1]);
        expect((rb.dados.canais as any[])[0].pausa).toEqual({ pausado: false });
        expect((rb.dados.notaFiscal as any).ligada).toBe(false);
      } finally {
        await q(`delete from pedido_externo where tenant_id = any($1::uuid[])`, [[A, B]]);
        await q(`delete from pausa_canal where tenant_id = $1`, [A]);
        await q(`delete from nota_fiscal where tenant_id = $1`, [A]);
        await q(`delete from fiscal_credencial where tenant_id = $1`, [A]);
        await q(`delete from fiscal_config where tenant_id = $1`, [A]);
      }
    });

    // F3, vigilância de dependências (parte 1): a 17ª consulta. A UF 'RO' não é usada por nenhuma outra spec (o banco do
    // CI é dividido — a do IBPT apaga 'AC', 'AP' e 'TO').
    it('o que vence ou está desatualizado: o certificado (mesmo com a nota desligada), a tabela do IBPT, a licença e a versão do servidor', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const naoLiga = { instalado: true, versao: '1.30.12', versaoDisponivel: null as string | null, soPeloInstalador: false, versaoRecolhida: false };
      let servidor: any = { ...naoLiga, validaAte: new Date(Date.now() + 7 * 86_400_000 + 3_600_000) };
      const lidosDoServidor: string[] = [];
      const comVencimentos = new MisterFerramentasService(
        db, modulos, null as any, null as any, null as any, null as any, null as any,
        { vencimentoDoServidor: async (t: string) => (lidosDoServidor.push(t), servidor) } as any,
        null as any, null as any, null as any,
        undefined, undefined, undefined, undefined, undefined, undefined,
        new IbptService(db, auditoria as AuditoriaService),
      );
      const chave = `MISTER-${MARCA}`;
      try {
        // A nota DESLIGADA (o caso da loja hoje), o certificado vencendo em 4 dias e a tabela própria de RO vencida em 31/10.
        await q(`insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente, uf) values ($1, null, false, '2', 'RO')`, [A]);
        await q(`insert into fiscal_credencial (tenant_id, unidade_id, cert_valido_ate) values ($1, null, now() + interval '4 days 1 hour')`, [A]);
        await q(
          `insert into ibpt_versao (tenant_id, uf, versao, chave, fonte, vigencia_inicio, vigencia_fim, linhas)
           values ($1, 'RO', '26.2.B', $2, 'IBPT', '2026-09-20', '2026-10-31', 10)`,
          [A, chave],
        );
        const r = await comVencimentos.executar(e, 'vencimentos_e_versoes', {});
        expect(r.ok).toBe(true);
        expect(r.dados.certificadoDigital).toEqual([
          expect.objectContaining({ loja: 'a empresa toda', diasParaVencer: 4, situacao: 'vence em breve', notaFiscal: 'desligada', observacao: expect.stringContaining('desligada') }),
        ]);
        expect(r.dados.tabelaDoIbpt).toMatchObject({ estado: 'RO', emUso: null, situacao: 'vencida desde 31/10/2026', observacao: expect.stringContaining('desligada') });
        expect(r.dados.servidorDaLoja).toMatchObject({ licenca: { diasParaVencer: 7, situacao: 'vence em breve' }, versao: { instalada: '1.30.12', disponivel: null, emDia: true } });
        // Com a nota desligada, só a licença pede atenção.
        expect(r.dados.pedeAtencao).toEqual([expect.stringContaining('A licença do servidor da loja vence em')]);
        expect(lidosDoServidor).toEqual([A]);

        // A nota LIGADA: o certificado e a tabela vencida passam a pedir atenção, com o caminho da tela.
        await q(`update fiscal_config set ativo = true where tenant_id = $1`, [A]);
        const ligada = await comVencimentos.executar(e, 'vencimentos_e_versoes', {});
        const atencao = ligada.dados.pedeAtencao as string[];
        expect(atencao).toHaveLength(3);
        expect(atencao[0]).toContain('O certificado digital vence em');
        expect(atencao[1]).toContain('A tabela do IBPT de RO venceu em 31/10/2026');
        expect(atencao.join(' ')).toContain('Financeiro › Configuração');

        // A tabela da DMS vigente em RO: vale a da DMS, sem atenção; a versão nova do servidor pede atenção.
        await q(
          `insert into ibpt_versao (tenant_id, uf, versao, chave, fonte, vigencia_inicio, vigencia_fim, linhas)
           values (null, 'RO', '26.3.A', $1, 'IBPT', (now() - interval '2 days')::date, (now() + interval '40 days')::date, 10)`,
          [chave],
        );
        servidor = { ...naoLiga, validaAte: new Date(Date.now() + 90 * 86_400_000), versaoDisponivel: '1.30.13' };
        const dms = await comVencimentos.executar(e, 'vencimentos_e_versoes', {});
        expect(dms.dados.tabelaDoIbpt).toMatchObject({ estado: 'RO', emUso: 'a da DMS (quem atualiza é a DMS)' });
        expect(dms.dados.pedeAtencao).toEqual([expect.stringContaining('O certificado digital vence em'), expect.stringContaining('Configurações › Servidor local')]);

        // Tudo em dia: a frase de "nada vencido".
        await q(`update fiscal_credencial set cert_valido_ate = now() + interval '300 days' where tenant_id = $1`, [A]);
        servidor = { ...naoLiga, validaAte: null };
        const emDia = await comVencimentos.executar(e, 'vencimentos_e_versoes', {});
        expect(emDia.dados.pedeAtencao).toEqual(expect.stringContaining('Nada vencido'));
        expect(emDia.dados.servidorDaLoja).toMatchObject({ licenca: { semPrazo: true } });

        // O gerente sem a nota fiscal: nem o certificado, nem a tabela, nem o servidor (só o presidente).
        const gerente = { ...e, nivel: 'gerente' as const, permissoes: { delivery: true } as any };
        const g = await comVencimentos.executar(gerente, 'vencimentos_e_versoes', {});
        expect((g.dados.certificadoDigital as any).aviso).toContain('não dá acesso');
        expect((g.dados.tabelaDoIbpt as any).aviso).toContain('não dá acesso');
        expect((g.dados.servidorDaLoja as any).aviso).toContain('só ao presidente');
        const gerenteFiscal = { ...e, nivel: 'gerente' as const, permissoes: { fiscal: true } as any };
        expect(((await comVencimentos.executar(gerenteFiscal, 'vencimentos_e_versoes', {})).dados.certificadoDigital as any[])[0].situacao).toBe('em dia');

        // A outra empresa não vê o certificado desta.
        const telB = telefone();
        await ligar('anaB', telB, B);
        const deB = (await ferramentas.escopo(B, pessoa.anaB, telB))!;
        const rb = await comVencimentos.executar(deB, 'vencimentos_e_versoes', {});
        expect(rb.dados.certificadoDigital).toEqual({ cadastrado: false, observacao: expect.any(String) });
        expect(lidosDoServidor.at(-1)).toBe(B);
      } finally {
        await q(`delete from ibpt_versao where uf = 'RO' and chave = $1`, [chave]);
        await q(`delete from fiscal_credencial where tenant_id = $1`, [A]);
        await q(`delete from fiscal_config where tenant_id = $1`, [A]);
      }
    });

    // M2a (mig 432): as decisões da Diretoria nos padrões do "O que melhorar". A tabela é da distribuição (sem empresa):
    // as chaves do teste levam a MARCA, e o teste apaga só as dele.
    it('M2a: "virou tarefa" e "não se aplica" num padrão — uma decisão valendo por vez, o motivo obrigatório, desfazer, e o vencido não bloqueia', async () => {
      const qualidade = new MisterQualidadeService(db);
      const chave = `falta:tema do teste ${MARCA}`;
      const outra = `consulta:consulta do teste ${MARCA}`;
      try {
        const t = await qualidade.decidir({ chave, decisao: 'tarefa', tarefa: 'DMS-412' }, 'Rita da DMS');
        expect(t).toMatchObject({ chave, decisao: 'tarefa', tarefa: 'DMS-412', quem: 'Rita da DMS', valeAte: null });
        // Duas vezes ao mesmo tempo (duas abas): uma entra, a outra é recusada com a frase.
        const r = await Promise.allSettled([
          qualidade.decidir({ chave: outra, decisao: 'nao_se_aplica', motivo: 'é da empresa' }, 'Rita'),
          qualidade.decidir({ chave: outra, decisao: 'tarefa' }, 'Bia'),
        ]);
        expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
        expect(r.find((x) => x.status === 'rejected')).toMatchObject({ reason: expect.objectContaining({ message: expect.stringContaining('Desfaça a decisão antes') }) });
        await expect(qualidade.decidir({ chave, decisao: 'nao_se_aplica', motivo: '' }, 'Rita')).rejects.toThrow('Escreva por que não se aplica.');
        await expect(qualidade.decidir({ chave: 'inventado:x', decisao: 'tarefa' }, 'Rita')).rejects.toThrow('Padrão desconhecido.');
        // O "não se aplica" vale 30 dias.
        await q(`delete from mister_melhoria_decisao where chave = $1`, [outra]);
        await qualidade.decidir({ chave: outra, decisao: 'nao_se_aplica', motivo: 'é da empresa' }, 'Rita');
        const [na] = await q(`select round(extract(epoch from (vale_ate - decidida_em)) / 86400)::int as dias from mister_melhoria_decisao where chave = $1 and desfeita_em is null`, [outra]);
        expect(Number(na.dias)).toBe(30);
        // As decisões valendo, e desfazer: a linha fica (histórico) e deixa de valer.
        expect((await qualidade.decisoesValendo()).map((d) => d.chave)).toEqual(expect.arrayContaining([chave, outra]));
        await qualidade.desfazer(chave);
        expect((await qualidade.decisoesValendo()).map((d) => d.chave)).not.toContain(chave);
        expect(Number((await q(`select count(*)::int as n from mister_melhoria_decisao where chave = $1`, [chave]))[0].n)).toBe(1);
        await expect(qualidade.desfazer(chave)).rejects.toThrow('não tem decisão valendo');
        // Desfeita, pode decidir de novo; o "não se aplica" vencido também não bloqueia (é desfeito na mesma transação).
        await qualidade.decidir({ chave, decisao: 'nao_se_aplica', motivo: 'já tem tarefa noutro lugar' }, 'Rita');
        await q(`update mister_melhoria_decisao set vale_ate = now() - interval '1 minute' where chave = $1 and desfeita_em is null`, [chave]);
        expect(await qualidade.decidir({ chave, decisao: 'tarefa' }, 'Rita')).toMatchObject({ decisao: 'tarefa' });
        // A leitura da Qualidade traz os padrões com a situação (os do período desta spec, se houver, sem decisão = aberto).
        const resumo: any = await qualidade.resumo(7);
        expect(resumo.melhorar.every((x: any) => ['aberto', 'tarefa', 'nao_se_aplica'].includes(x.situacao) && typeof x.chave === 'string')).toBe(true);
      } finally {
        await q(`delete from mister_melhoria_decisao where chave like $1`, [`%${MARCA}`]);
      }
    });

    // F5, parte 1: a qualidade do Mister no console da distribuição. Só números, de TODAS as empresas — por isso a conta é
    // pela diferença (outras partes desta spec também gravam perguntas).
    it('a qualidade do Mister no console: respondidas, motivos, consultas, tempo, custo e por empresa — nunca o texto', async () => {
      const qualidade = new MisterQualidadeService(db);
      const chaveDaLinha = `qual-${MARCA}`;
      const tel = telefone();
      const usoDe = async () => (await q(`select tokens_entrada, tokens_saida from ia_uso_dia where tenant_id = $1 and dia = $2::date and recurso = 'mister_perguntas' and provedor = 'anthropic' and modelo = 'claude-opus-5-5' and origem = 'distribuicao'`, [A, hojeISO()]))[0] ?? null;
      const usoAntes = await usoDe();
      const antes7 = await qualidade.resumo(7);
      const antes30 = await qualidade.resumo('30');
      const nomeDe = async (t: string) => (await q(`select nome from empresa where id = $1`, [t]))[0].nome as string;
      const [nomeA, nomeB] = [await nomeDe(A), await nomeDe(B)];
      const daEmpresa = (r: any, nome: string) => r.porEmpresa.find((x: any) => x.empresa === nome) ?? { perguntas: 0, semResposta: 0, custoUsd: 0, chave: null };
      const motivo = (r: any, texto: string) => r.motivos.find((m: any) => m.motivo === texto)?.quantas ?? 0;
      const consulta = (r: any, nome: string) => r.consultas.find((c: any) => c.nome === nome) ?? { vezes: 0, falhas: 0 };
      const tema = (r: any, texto: string) => r.temas.find((t: any) => t.tema === texto)?.quantas ?? 0;
      let n = 0;
      const pergunta = (tenant: string, colab: string, situacao: string, o: { motivo?: string; chamadas?: number; consultas?: Array<{ nome: string; ok: boolean; entrada?: Record<string, string> }>; segundos?: number; diasAtras?: number } = {}) =>
        q(
          `insert into mister_pergunta (tenant_id, colaborador_id, nivel, telefone, chave, pergunta, resposta, situacao, motivo, chamadas, ferramentas, criado_em, respondida_em)
           values ($1, $2, 'presidente', $3, $4, 'pergunta secreta da loja', 'resposta secreta da loja', $5, $6, $7, $8::jsonb,
                   now() - make_interval(days => $9::int, secs => $10::int), now() - make_interval(days => $9::int))`,
          [tenant, colab, tel, `${chaveDaLinha}-${++n}`, situacao, o.motivo ?? null, o.chamadas ?? 1, JSON.stringify((o.consultas ?? []).map((c) => ({ ...c, ms: 10, entrada: c.entrada ?? {} }))), o.diasAtras ?? 0, o.segundos ?? 4],
        );
      try {
        await pergunta(A, pessoa.ana, 'respondida', { consultas: [{ nome: 'resumo_do_dia', ok: true }], segundos: 4 });
        await pergunta(A, pessoa.ana, 'respondida', { consultas: [{ nome: 'vendas_do_periodo', ok: true }, { nome: 'resumo_do_dia', ok: true }], chamadas: 2, segundos: 10 });
        await pergunta(A, pessoa.ana, 'respondida', { segundos: 2 }); // respondeu sem consultar dado
        await pergunta(A, pessoa.ana, 'falhou', { motivo: 'chave_recusada', chamadas: 0 });
        await pergunta(A, pessoa.ana, 'falhou', { motivo: 'indisponivel', chamadas: 0 });
        await pergunta(B, pessoa.anaB, 'respondida', { consultas: [{ nome: 'historia_do_pedido', ok: false }], segundos: 6 });
        await pergunta(B, pessoa.anaB, 'falhou', { motivo: 'demorou' });
        await pergunta(A, pessoa.ana, 'respondida', { diasAtras: 10 }); // fora dos 7 dias, dentro dos 30
        // F5.2: só anotou o que falta (é "sem consultar dado"); anotou e também consultou.
        const anotou = (t: string) => ({ nome: 'anotar_o_que_falta', ok: true, entrada: { tema: t } });
        await pergunta(A, pessoa.ana, 'respondida', { consultas: [anotou('estoque')], chamadas: 2, segundos: 3 });
        await pergunta(A, pessoa.ana, 'respondida', { consultas: [anotou('financeiro'), { nome: 'resumo_do_dia', ok: true }], chamadas: 2, segundos: 5 });
        await q(
          `insert into ia_uso_dia (tenant_id, dia, recurso, provedor, modelo, origem, chamadas, tokens_entrada, tokens_saida)
           values ($1, $2::date, 'mister_perguntas', 'anthropic', 'claude-opus-5-5', 'distribuicao', 2, 1000000, 100000)
           on conflict (tenant_id, dia, recurso, provedor, modelo, origem)
           do update set tokens_entrada = ia_uso_dia.tokens_entrada + 1000000, tokens_saida = ia_uso_dia.tokens_saida + 100000`,
          [A, hojeISO()],
        );

        const r = await qualidade.resumo(7);
        expect(r.dias).toBe(7);
        expect(r.perguntas - antes7.perguntas).toBe(9);
        expect(r.respondidas - antes7.respondidas).toBe(6);
        expect(r.falhas - antes7.falhas).toBe(3);
        expect(r.semConsulta - antes7.semConsulta).toBe(2);
        // F5.2: "não tenho acesso" e o tema; a anotação não entra nas consultas.
        expect(r.naoTem.quantas - antes7.naoTem.quantas).toBe(2);
        expect(tema(r, 'estoque e compras') - tema(antes7, 'estoque e compras')).toBe(1);
        expect(tema(r, 'financeiro e contas') - tema(antes7, 'financeiro e contas')).toBe(1);
        expect(consulta(r, 'anotar o que falta').vezes).toBe(0);
        expect(motivo(r, 'a chave de IA da empresa foi recusada') - motivo(antes7, 'a chave de IA da empresa foi recusada')).toBe(1);
        expect(motivo(r, 'a IA não respondeu (passageiro)') - motivo(antes7, 'a IA não respondeu (passageiro)')).toBe(1);
        expect(motivo(r, 'passou do tempo') - motivo(antes7, 'passou do tempo')).toBe(1);
        expect(consulta(r, 'resumo do dia').vezes - consulta(antes7, 'resumo do dia').vezes).toBe(3);
        expect(consulta(r, 'vendas do periodo').vezes - consulta(antes7, 'vendas do periodo').vezes).toBe(1);
        expect(consulta(r, 'historia do pedido').falhas - consulta(antes7, 'historia do pedido').falhas).toBe(1);
        expect(r.tempo).toEqual({ medianaS: expect.any(Number), p90S: expect.any(Number) });
        expect(daEmpresa(r, nomeA).perguntas - daEmpresa(antes7, nomeA).perguntas).toBe(7);
        expect(daEmpresa(r, nomeA).semResposta - daEmpresa(antes7, nomeA).semResposta).toBe(2);
        expect(daEmpresa(r, nomeB).perguntas - daEmpresa(antes7, nomeB).perguntas).toBe(2);
        // O custo pela MESMA conta da tela "IA e uso": 1 milhão de entrada e 100 mil de saída no Opus = US$ 4 + US$ 2.
        expect(Math.round((daEmpresa(r, nomeA).custoUsd - daEmpresa(antes7, nomeA).custoUsd) * 1000) / 1000).toBe(6);
        expect(r.custo.precosLidosEm).toBe(PRECOS_LIDOS_EM);
        const [credA] = await q(`select situacao from ia_credencial where tenant_id = $1`, [A]);
        expect(daEmpresa(r, nomeA).chave).toBe(credA?.situacao ?? null);
        // 30 dias: a antiga entra.
        const r30 = await qualidade.resumo(30);
        expect(r30.dias).toBe(30);
        expect(r30.perguntas - antes30.perguntas).toBe(10);
        // Nunca o texto, o telefone ou a pessoa.
        const tudo = JSON.stringify(r30);
        expect(tudo).not.toContain('secreta');
        expect(tudo).not.toContain(tel);
        expect(tudo).not.toContain(pessoa.ana);
        expect(tudo).not.toContain(A);
        // Período torto vira 7.
        expect((await qualidade.resumo('lixo')).dias).toBe(7);
      } finally {
        await q(`delete from mister_pergunta where chave like $1`, [`${chaveDaLinha}-%`]);
        if (usoAntes) await q(`update ia_uso_dia set tokens_entrada = $3, tokens_saida = $4 where tenant_id = $1 and dia = $2::date and recurso = 'mister_perguntas' and provedor = 'anthropic' and modelo = 'claude-opus-5-5' and origem = 'distribuicao'`, [A, hojeISO(), usoAntes.tokens_entrada, usoAntes.tokens_saida]);
        else await q(`delete from ia_uso_dia where tenant_id = $1 and dia = $2::date and recurso = 'mister_perguntas' and modelo = 'claude-opus-5-5' and origem = 'distribuicao'`, [A, hojeISO()]);
      }
    });

    // ───────────────────────────── a segurança e o que melhorar (o Sentinela e o Mentor, parte 1) ─────────────────────────────
    // De todas as empresas: a conta é pela diferença (outras partes desta spec também gravam mensagens e perguntas).
    it('a segurança do Mister no console: o que as proteções barraram, só contagens — nunca o telefone ou o texto', async () => {
      const seguranca = new MisterSegurancaService(db);
      const antes = await seguranca.resumo(7);
      const antes30 = await seguranca.resumo(30);
      const tels = [telefone(), telefone(), telefone()];
      const [{ nome: nomeA }] = await q(`select nome from empresa where id = $1`, [A]);
      let n = 0;
      const msg = (tel: string, desfecho: string, tenant: string | null = null, diasAtras = 0) =>
        q(`insert into mister_mensagem (wamid, telefone, tenant_id, desfecho, recebida_em) values ($1, $2, $3, $4, now() - make_interval(days => $5::int))`, [`wamid.${MARCA}.seg${++n}`, tel, tenant, desfecho, diasAtras]);
      const pergunta = (conferencia: string[], ferramentas: unknown[], motivo: string | null = null, situacao = 'respondida') =>
        q(
          `insert into mister_pergunta (tenant_id, colaborador_id, nivel, telefone, chave, pergunta, resposta, situacao, motivo, chamadas, ferramentas, conferencia)
           values ($1, $2, 'presidente', $3, $4, 'pergunta secreta', 'resposta secreta', $5, $6, 1, $7::jsonb, $8::jsonb)`,
          [A, pessoa.ana, tels[0], `seg-${MARCA}-${++n}`, situacao, motivo, JSON.stringify(ferramentas), JSON.stringify(conferencia)],
        );
      try {
        // Na entrada: 3 códigos errados de 2 telefones (1 calado), outra pessoa, perdeu o acesso, resposta fixa; um de 10 dias.
        await msg(tels[0], 'codigo_nao_vale');
        await msg(tels[0], 'codigos_demais');
        await msg(tels[1], 'codigo_nao_vale');
        await msg(tels[2], 'numero_de_outra_pessoa', A);
        await msg(tels[2], 'sem_acesso', A);
        await msg(tels[1], 'sem_acesso', A);
        await msg(tels[2], 'fixa');
        await msg(tels[2], 'fixa_calada');
        await msg(tels[1], 'codigo_nao_vale', null, 10);
        await msg(tels[0], 'pergunta', A); // não é das proteções
        // Na saída: um segredo e um link tirados (a consulta que trouxe), um valor sem origem, um limite.
        await pergunta(['segredo', 'link_tirado'], [{ nome: 'canais_e_integracoes', ok: true, ms: 1 }, { nome: 'anotar_o_que_falta', ok: true, ms: 1 }]);
        await pergunta(['valor_sem_origem'], []);
        await pergunta([], [], 'limite', 'falhou');

        const r = await seguranca.resumo(7);
        const nota = (x: any, k: string) => x.saida.find((s: any) => s.nota === k).quantas;
        expect(r.dias).toBe(7);
        expect([nota(r, 'segredo') - nota(antes, 'segredo'), nota(r, 'link_tirado') - nota(antes, 'link_tirado'), nota(r, 'valor_sem_origem') - nota(antes, 'valor_sem_origem')]).toEqual([1, 1, 1]);
        expect(r.segredos - antes.segredos).toBe(1);
        expect(r.limite - antes.limite).toBe(1);
        expect(r.entrada.codigoErrado.quantas - antes.entrada.codigoErrado.quantas).toBe(3);
        expect(r.entrada.codigoErrado.telefones - antes.entrada.codigoErrado.telefones).toBe(2);
        expect(r.entrada.codigoErrado.calados - antes.entrada.codigoErrado.calados).toBe(1);
        expect(r.entrada.outraPessoa - antes.entrada.outraPessoa).toBe(1);
        expect(r.entrada.perdeuOAcesso - antes.entrada.perdeuOAcesso).toBe(2);
        expect(r.entrada.naoLigado.quantas - antes.entrada.naoLigado.quantas).toBe(2);
        expect(r.entrada.naoLigado.telefones - antes.entrada.naoLigado.telefones).toBe(1);
        // O "Pede atenção": o segredo com a consulta que trouxe (a anotação não é consulta), a empresa e a hora.
        const critico = r.atencao.find((a: any) => a.nivel === 'critico' && a.texto.includes(nomeA));
        expect(critico?.texto).toContain('Conferir qual consulta trouxe esse dado: canais e integracoes · ');
        expect(critico?.texto).not.toContain('anotar');
        expect(r.atencao.some((a: any) => a.nivel === 'atencao' && a.texto.includes('calado'))).toBe(true);
        // Por empresa: só o que se sabe de quem é.
        const daA = (x: any) => x.porEmpresa.find((e: any) => e.empresa === nomeA) ?? { filtro: 0, segredos: 0, perdeuOAcesso: 0, outraPessoa: 0, limite: 0 };
        expect({ filtro: daA(r).filtro - daA(antes).filtro, segredos: daA(r).segredos - daA(antes).segredos, perdeuOAcesso: daA(r).perdeuOAcesso - daA(antes).perdeuOAcesso, outraPessoa: daA(r).outraPessoa - daA(antes).outraPessoa, limite: daA(r).limite - daA(antes).limite }).toEqual({
          filtro: 2,
          segredos: 1,
          perdeuOAcesso: 2,
          outraPessoa: 1,
          limite: 1,
        });
        // 30 dias: o código errado de 10 dias entra.
        expect((await seguranca.resumo(30)).entrada.codigoErrado.quantas - antes30.entrada.codigoErrado.quantas).toBe(4);
        // Nunca o telefone, o texto ou a empresa pelo id.
        const tudo = JSON.stringify(r);
        for (const t of tels) expect(tudo).not.toContain(t);
        expect(tudo).not.toContain('secreta');
        expect(tudo).not.toContain(A);
        expect((await seguranca.resumo('lixo')).dias).toBe(7);
      } finally {
        await q(`delete from mister_mensagem where wamid like $1`, [`wamid.${MARCA}.seg%`]);
        await q(`delete from mister_pergunta where chave like $1`, [`seg-${MARCA}-%`]);
      }
    });

    it('S2: a análise com IA da Segurança — só metadados vão à IA (nunca texto, telefone inteiro ou id), uma rodada por vez, as propostas conferidas, a decisão uma vez, e as falhas com a frase', async () => {
      comIa();
      const sentinela = new MisterSentinelaService(db, ia, new MisterSegurancaService(db));
      const tels = [telefone(), telefone()];
      let n = 0;
      const msg = (tel: string, desfecho: string) =>
        q(`insert into mister_mensagem (wamid, telefone, tenant_id, desfecho, recebida_em) values ($1, $2, null, $3, now())`, [`wamid.${MARCA}.s2${++n}`, tel, desfecho]);
      const pergunta = (conferencia: string[], ferramentas: unknown[], motivo: string | null = null, situacao = 'respondida') =>
        q(
          `insert into mister_pergunta (tenant_id, colaborador_id, nivel, telefone, chave, pergunta, resposta, situacao, motivo, chamadas, ferramentas, conferencia)
           values ($1, $2, 'presidente', $3, $4, 'pergunta secreta', 'resposta secreta', $5, $6, 1, $7::jsonb, $8::jsonb)`,
          [A, pessoa.ana, tels[0], `s2-${MARCA}-${++n}`, situacao, motivo, JSON.stringify(ferramentas), JSON.stringify(conferencia)],
        );
      const esperarFim = async (id: string) => {
        for (let i = 0; i < 100; i++) {
          const [a] = await q(`select situacao from mister_analise where id = $1`, [id]);
          if (a && a.situacao !== 'rodando') return a.situacao;
          await new Promise((r) => setTimeout(r, 30));
        }
        throw new Error('a análise não terminou');
      };
      const proposta = (nivel: string, titulo: string) => ({ nivel, titulo, viu: `viu ${titulo}`, proposta: `proposta ${titulo}`, impacto: `impacto ${titulo}` });
      try {
        await q(`update mister_analise set situacao = 'interrompida' where situacao = 'rodando'`);
        for (let i = 0; i < 4; i++) await msg(tels[0], 'codigo_nao_vale');
        await msg(tels[1], 'codigo_nao_vale'); // um só: não entra na lista dos telefones (precisa de 3)
        await pergunta(['link_tirado'], [{ nome: 'canais_e_integracoes', ok: true, ms: 1 }]);
        await pergunta([], [], 'sem_consulta', 'falhou');

        // ── Os metadados: o final do telefone, as notas por consulta, os motivos — nunca o texto, o telefone ou o id.
        const m = await sentinela.metadados();
        expect(m.telefonesComCodigoErrado).toContainEqual(expect.objectContaining({ final: tels[0].slice(-4), vezes: 4 }));
        expect(m.telefonesComCodigoErrado.find((t) => t.final === tels[1].slice(-4))).toBeUndefined();
        expect(m.telefonesComCodigoErrado[0].de).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
        expect(m.notasPorConsulta).toContainEqual(expect.objectContaining({ nota: 'link_tirado', consulta: 'canais_e_integracoes' }));
        expect(m.motivosSemResposta).toContainEqual(expect.objectContaining({ motivo: 'sem_consulta' }));
        const tudo = JSON.stringify(m);
        for (const t of tels) expect(tudo).not.toContain(t);
        expect(tudo).not.toContain('secreta');
        expect(tudo).not.toContain(A);

        // ── O cartão antes de rodar: a chave, o modelo e o custo estimado; nenhuma rodada nova ainda.
        const antes = await sentinela.ultima();
        expect(antes).toMatchObject({ chaveDaDistribuicao: true, dias: 7, prazoMin: 5 });
        expect(antes.estimativaUsd).toBeGreaterThan(0);

        // ── A rodada: o pedido leva as instruções e só os metadados; a resposta conferida vira as propostas (o nível fora da
        //    lista e a proposta sem título caem).
        ia.pedidos.length = 0;
        ia.roteiro = [
          falar(
            `Segue: ${JSON.stringify({
              propostas: [proposta('atencao', 'Um telefone tentou 4 códigos errados'), proposta('inventado', 'Nível inventado'), { ...proposta('melhoria', ''), titulo: '' }, proposta('melhoria', 'O filtro tirou link da consulta de canais')],
            })}`,
          ),
        ];
        const { id } = await sentinela.analisar('Rita');
        expect(await esperarFim(id)).toBe('terminou');
        const pedido = ia.pedidos.at(-1);
        expect(JSON.stringify(pedido.system)).toContain('Você é o Sentinela do Mister');
        expect(pedido.system).toBe(INSTRUCOES_DO_SENTINELA);
        const aoModelo = JSON.stringify(pedido.messages);
        expect(aoModelo).toContain(tels[0].slice(-4));
        for (const t of tels) expect(aoModelo).not.toContain(t);
        expect(aoModelo).not.toContain('secreta');
        expect(aoModelo).not.toContain(A);
        const depois = await sentinela.ultima();
        expect(depois.analise).toMatchObject({ id, situacao: 'terminou', pedidaPor: 'Rita', dias: 7, motivo: null });
        expect(depois.analise!.eventos).toBeGreaterThanOrEqual(6);
        expect(depois.analise!.custoUsd).toBeGreaterThan(0);
        expect(depois.propostas.map((p: any) => [p.nivel, p.titulo, p.situacao])).toEqual([
          ['atencao', 'Um telefone tentou 4 códigos errados', 'aberta'],
          ['melhoria', 'O filtro tirou link da consulta de canais', 'aberta'],
        ]);

        // ── Uma rodada por vez.
        await q(`insert into mister_analise (pedida_por, situacao) values ('outra', 'rodando')`);
        await expect(sentinela.analisar('Rita')).rejects.toBeInstanceOf(ConflictException);
        // A que passou do prazo vira "interrompida" e não trava a próxima.
        await q(`update mister_analise set iniciada_em = now() - interval '6 minutes' where situacao = 'rodando'`);
        await sentinela.ultima(); // a leitura do cartão vence as paradas (a regra é uma, no serviço)
        expect((await q(`select situacao, motivo from mister_analise where pedida_por = 'outra' order by iniciada_em desc limit 1`))[0]).toEqual({
          situacao: 'interrompida',
          motivo: 'o servidor reiniciou no meio da análise',
        });

        // ── A decisão: uma vez só, com a tarefa opcional; o descarte não guarda tarefa.
        const [p1, p2] = depois.propostas as any[];
        expect(await sentinela.decidir({ id: p1.id, decisao: 'tarefa', tarefa: '  DMS-9  ' }, 'Rita')).toMatchObject({ situacao: 'tarefa', tarefa: 'DMS-9' });
        await expect(sentinela.decidir({ id: p1.id, decisao: 'descartada' }, 'Rita')).rejects.toBeInstanceOf(ConflictException);
        await expect(sentinela.decidir({ id: randomUUID(), decisao: 'tarefa' }, 'Rita')).rejects.toBeInstanceOf(NotFoundException);
        await expect(sentinela.decidir({ id: p2.id, decisao: 'apagar' }, 'Rita')).rejects.toBeInstanceOf(BadRequestException);
        expect(await sentinela.decidir({ id: p2.id, decisao: 'descartada', tarefa: 'não vale' }, null)).toMatchObject({ situacao: 'descartada', tarefa: null });
        expect((await q(`select decidida_por from mister_analise_proposta where id = $1`, [p1.id]))[0].decidida_por).toBe('Rita');

        // ── A IA sem crédito: "falhou" com a frase, nenhuma proposta.
        ia.roteiro = [{ erro: Object.assign(new Error('Your credit balance is too low'), { status: 402 }) }];
        const semCredito = await sentinela.analisar('Rita');
        expect(await esperarFim(semCredito.id)).toBe('falhou');
        expect((await sentinela.ultima())).toMatchObject({ analise: { id: semCredito.id, motivo: 'a conta de IA da distribuição está sem crédito' }, propostas: [] });
        // ── A resposta fora do formato: "falhou", nenhuma proposta; a lista vazia é uma análise sem proposta (terminou).
        ia.roteiro = [falar('Não achei nada de mais.')];
        const fora = await sentinela.analisar('Rita');
        expect(await esperarFim(fora.id)).toBe('falhou');
        expect((await sentinela.ultima()).analise).toMatchObject({ motivo: 'a IA respondeu fora do formato pedido; nenhuma proposta foi gravada' });
        ia.roteiro = [falar('{"propostas": []}')];
        const vazia = await sentinela.analisar('Rita');
        expect(await esperarFim(vazia.id)).toBe('terminou');
        expect((await sentinela.ultima()).propostas).toEqual([]);
      } finally {
        await q(`delete from mister_mensagem where wamid like $1`, [`wamid.${MARCA}.s2%`]);
        await q(`delete from mister_pergunta where chave like $1`, [`s2-${MARCA}-%`]);
        await q(`update mister_analise set situacao = 'interrompida' where situacao = 'rodando'`);
      }
    });

    it('o que melhorar no fim da Qualidade: o tema que mais faltou vira "falta consulta", e a avaliação com erradas vira "instrução"', async () => {
      const qualidade = new MisterQualidadeService(db);
      const tel = telefone();
      let n = 0;
      try {
        for (let i = 0; i < 9; i++)
          await q(
            `insert into mister_pergunta (tenant_id, colaborador_id, nivel, telefone, chave, situacao, chamadas, ferramentas)
             values ($1, $2, 'presidente', $3, $4, 'respondida', 2, $5::jsonb)`,
            [A, pessoa.ana, tel, `mel-${MARCA}-${++n}`, JSON.stringify([{ nome: 'anotar_o_que_falta', ok: true, ms: 1, entrada: { tema: 'canais' } }])],
          );
        await q(`delete from mister_avaliacao`);
        await q(
          `insert into mister_avaliacao (situacao, versao, consultas, modelo, total, feitas, acertos, casos, terminada_em)
           values ('terminou', 'abcd1234', 17, 'claude-haiku-5-5', 40, 40, 39, $1::jsonb, now())`,
          [JSON.stringify([{ id: 'c07', pergunta: 'Quanto vendi no iFood ontem?', ok: false, falhas: ['a resposta não traz 1.688,35'], consultas: [], ms: 1 }])],
        );
        const r = await qualidade.resumo(7);
        expect(r.melhorar.find((p: any) => p.causa === 'falta_consulta')).toMatchObject({ observacao: expect.stringMatching(/^"delivery e canais" faltou \d+ vezes/), proposta: 'Consulta nova de delivery e canais · abrir tarefa' });
        expect(r.melhorar.find((p: any) => p.causa === 'instrucao')).toMatchObject({ observacao: expect.stringContaining('errou 1 de 40: "Quanto vendi no iFood ontem?" — a resposta não traz 1.688,35') });
      } finally {
        await q(`delete from mister_pergunta where chave like $1`, [`mel-${MARCA}-%`]);
        await q(`delete from mister_avaliacao`);
      }
    });

    // ───────────────────────────── a avaliação de regressão (F5.3, mig 424) ─────────────────────────────
    // O modelo de mentira responde CERTO a cada pergunta (a consulta, a entrada e os números do caso): prova o caminho
    // inteiro — o laço de verdade, a loja de teste, a conferência, o andamento gravado e o custo. Só a distribuição: a
    // tabela não tem loja nenhuma.
    describe('a avaliação de regressão do Mister', () => {
      const ENTRADA: Record<string, Record<string, unknown>> = {
        c03: { dia: 'ontem' },
        c04: { periodo: 'esta_semana' },
        c05: { periodo: 'esta_semana', comparar: true },
        c06: { periodo: 'ontem' },
        c07: { periodo: 'ontem' },
        c08: { periodo: 'esta_semana', quantos: 3 },
        c09: { periodo: 'este_mes', ordem: 'lucro' },
        c15: { periodo: 'ontem' },
        c28: { periodo: 'esta_semana' },
        c37: { ordem: 'lucro' },
      };
      const EXTRAS: Record<string, string[]> = { c37: ['produtos_mais_vendidos'], c38: ['servidor_e_incidentes'] };
      const entradaDe = (c: CasoDaAvaliacao, nome: string): Record<string, unknown> =>
        nome === FERRAMENTA_DO_QUE_FALTA ? { tema: c.anotar![0] } : nome === 'historia_do_pedido' ? { numero: '284' } : nome === 'como_usar_o_regem' ? { assunto: 'pausar o iFood' } : (ENTRADA[c.id] ?? {});
      const textoCerto = (c: CasoDaAvaliacao) =>
        [
          'Resposta:',
          ...(c.numeros ?? []).map((n) => n.split('|')[0]).map((n) => (/,\d\d$/.test(n) && !c.semValores ? `R$ ${n}` : n)),
          ...(c.contem ?? []).map((t) => t.split('|')[0]),
          ...(c.semValores ? ['Seu perfil no Regem não mostra valores em reais.'] : []),
          ...(c.anotar ? ['Ainda não tenho acesso a essa informação.'] : []),
        ].join(' ');
      const USO = { entrada: 120, cacheEscrita: 0, cacheLeitura: 9000, saida: 60 };

      /** A IA da distribuição de mentira. `errar` = os ids que ela responde sem nada; `recusar` = a chave recusada. */
      const iaDeMentira = (o: { errar?: string[]; recusar?: boolean; semChave?: boolean } = {}) => {
        const pedidos: any[] = [];
        return {
          pedidos,
          iaIncluidaDisponivel: () => !o.semChave,
          pedirPelaDistribuicao: async (p: any) => {
            pedidos.push(p);
            if (o.recusar) throw new FalhaDaIa('chave_recusada', 'distribuicao', 401);
            const pergunta = String(p.messages[0].content);
            const gerente = String(p.system[1].text).includes('Gabriel');
            const c = CASOS_DA_AVALIACAO.find((x) => x.pergunta === pergunta && (x.perfil?.nivel === 'gerente') === gerente)!;
            const ultima = p.messages[p.messages.length - 1];
            const ferramentas = [...(c.consultas ?? []), ...(c.umaDasConsultas ? [c.umaDasConsultas[0]] : []), ...(c.anotar ? [FERRAMENTA_DO_QUE_FALTA] : []), ...(EXTRAS[c.id] ?? [])];
            if (typeof ultima.content === 'string' && ferramentas.length) {
              const conteudo = ferramentas.map((nome, i) => ({ type: 'tool_use', id: `tu${i}`, name: nome, input: entradaDe(c, nome) }));
              return { texto: '', recusou: false, origem: 'distribuicao', uso: USO, conteudo, parou: 'tool_use' };
            }
            const texto = (o.errar ?? []).includes(c.id) ? 'Não sei.' : c.semConsulta ? 'Bom dia! Em que posso ajudar?' : textoCerto(c);
            return { texto, recusou: false, origem: 'distribuicao', uso: USO, conteudo: [{ type: 'text', text: texto }], parou: 'end_turn' };
          },
        };
      };
      const terminar = async (id: string) => {
        for (let i = 0; i < 400; i++) {
          const [l] = await q(`select situacao, feitas, acertos, motivo from mister_avaliacao where id = $1`, [id]);
          if (l.situacao !== 'rodando') return l;
          await new Promise((r) => setTimeout(r, 50));
        }
        throw new Error('a rodada não terminou');
      };
      beforeEach(async () => {
        await q(`delete from mister_avaliacao`);
      });
      afterAll(async () => {
        await q(`delete from mister_avaliacao`);
      });

      it('a rodada inteira com as respostas certas: 40 de 40, o andamento, o custo, a lista e as perguntas na ordem', async () => {
        const ia = iaDeMentira();
        const servico = new MisterAvaliacaoService(db, ia as any);
        const r = await servico.rodar('Rita da DMS');
        expect(r.total).toBe(40);
        const fim = await terminar(r.id);
        expect(fim).toMatchObject({ situacao: 'terminou', feitas: 40, acertos: 40, motivo: null });
        // O mesmo laço do agente: as instruções e as ferramentas de verdade, e o recurso da avaliação.
        expect(ia.pedidos.every((p) => p.recurso === 'mister_avaliacao' && p.tools === FERRAMENTAS && p.system[0].text === INSTRUCOES_DO_MISTER)).toBe(true);
        const lista = await servico.lista();
        expect(lista).toMatchObject({ disponivel: true, total: 40, chaveDaDistribuicao: true });
        expect(lista.rodadas[0]).toMatchObject({ id: r.id, situacao: 'terminou', pedidaPor: 'Rita da DMS', versao: lista.versaoAtual.versao, consultas: lista.versaoAtual.consultas, total: 40, acertos: 40, falhas: 0, oQueFalhou: [] });
        // O custo pela tabela de preços do modelo, sobre os tokens somados de todas as chamadas.
        expect(lista.rodadas[0].custoUsd).toBeGreaterThan(0);
        const [tok] = await q(`select tokens_entrada, tokens_cache_leitura, tokens_saida from mister_avaliacao where id = $1`, [r.id]);
        expect(tok).toEqual({ tokens_entrada: USO.entrada * ia.pedidos.length, tokens_cache_leitura: USO.cacheLeitura * ia.pedidos.length, tokens_saida: USO.saida * ia.pedidos.length });
        const d = await servico.detalhe(r.id);
        expect(d.casos.map((c) => c.id)).toEqual(CASOS_DA_AVALIACAO.map((c) => c.id));
        expect(d.casos.every((c) => c.ok && c.falhas.length === 0)).toBe(true);
        // Nenhuma loja: a tabela não tem empresa e nada de loja nenhuma entra nela.
        expect(JSON.stringify(d)).not.toContain(A);
      });

      it('uma rodada de cada vez; a que parou vence pelo tempo; a pergunta errada aparece no "o que falhou"', async () => {
        const servico = new MisterAvaliacaoService(db, iaDeMentira({ errar: ['c02'] }) as any);
        const [{ id: parada }] = await q(`insert into mister_avaliacao (versao, consultas, modelo, total, iniciada_em) values ('00000000', 17, 'claude-haiku-5-5', 40, now() - interval '1 minute') returning id::text as id`);
        await expect(servico.rodar('Rita')).rejects.toThrow('Já tem uma avaliação rodando');
        // Passou do prazo: a tela já recebe "interrompida", e a próxima rodada não trava.
        await q(`update mister_avaliacao set iniciada_em = now() - interval '25 minutes' where id = $1`, [parada]);
        expect((await servico.lista()).rodadas.find((x: any) => x.id === parada)?.situacao).toBe('interrompida');
        const r = await servico.rodar('Rita');
        expect(await terminar(r.id)).toMatchObject({ situacao: 'terminou', acertos: 39 });
        const [velha] = await q(`select situacao, motivo from mister_avaliacao where id = $1`, [parada]);
        expect(velha).toEqual({ situacao: 'interrompida', motivo: 'o servidor reiniciou no meio da rodada' });
        const nova = (await servico.lista()).rodadas.find((x: any) => x.id === r.id);
        expect(nova).toMatchObject({ falhas: 1, oQueFalhou: [{ pergunta: 'Quanto eu vendi hoje?', falha: 'a resposta não traz 4.321,45' }] });
      });

      it('a chave da distribuição recusada para a rodada; sem a chave, nem começa; id torto não acha', async () => {
        const recusada = new MisterAvaliacaoService(db, iaDeMentira({ recusar: true }) as any);
        const r = await recusada.rodar(null);
        expect(await terminar(r.id)).toMatchObject({ situacao: 'falhou', feitas: 0, motivo: 'a chave de IA da distribuição foi recusada' });
        await expect(new MisterAvaliacaoService(db, iaDeMentira({ semChave: true }) as any).rodar('Rita')).rejects.toThrow('A chave de IA da distribuição não está configurada');
        await expect(recusada.detalhe('lixo')).rejects.toThrow('Avaliação não encontrada.');
        await expect(recusada.detalhe(randomUUID())).rejects.toThrow('Avaliação não encontrada.');
      });
    });
    // ───────────────────────────── os avisos (mig 419) ─────────────────────────────

    const incidente = (regra: string, chave: string, extra: Record<string, unknown> = {}) => ({
      tenantId: A,
      unidadeId: lojaDeA,
      regra,
      chave,
      evidencia: { impressora: 'Cozinha' },
      loja: 'Loja Centro',
      esperando: null,
      jaAberto: false,
      ...extra,
    });
    const avisosDe = (tenant = A) => q(`select * from mister_aviso where tenant_id = $1 order by aberto_em`, [tenant]);
    const janelaAberta = (nome: string) => q(`update mister_vinculo set ultima_entrada_em = now() where colaborador_id = $1`, [pessoa[nome]]);

    it('a configuração dos avisos: o padrão aprovado, o salvar com a auditoria do antes e do depois, e as recusas', async () => {
      const tela = await avisosConfig.daTela(A);
      expect(tela.avisos).toHaveLength(9);
      expect(tela.avisos[0]).toMatchObject({ tipo: 'impressora', padrao: true, jaFunciona: true, regra: { ligado: true, destinos: ['tela'], escalaMin: 5, escalaPara: ['gerente'] } });
      expect(tela.avisos.find((a) => a.tipo === 'pedido_parado')).toMatchObject({ jaFunciona: true, regra: { ligado: false, parametro: 20 } });
      expect(tela.destinos.map((d) => d.id)).toEqual(['presidente', 'gerente', 'tela', 'kds', 'atendimento', 'dms']);
      const salvo = await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'impressora', ligado: true, destinos: ['kds', 'atendimento'], escalaMin: null, escalaPara: [] }] });
      expect(salvo.avisos[0]).toMatchObject({ padrao: false, regra: { destinos: ['kds', 'atendimento'], escalaMin: null } });
      const [aud] = auditados.filter((a) => a.acao === 'mister_avisos_alterados');
      expect(aud).toMatchObject({ tenantId: A, atorId: pessoa.ana, detalhe: { mudou: [{ tipo: 'impressora', antes: { destinos: ['tela'] }, depois: { destinos: ['kds', 'atendimento'] } }] } });
      await expect(avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'caixa_24h', ligado: true, destinos: [], escalaMin: null, escalaPara: [] }] })).rejects.toThrow('Escolha pelo menos um destino');
      // A outra empresa segue no padrão.
      expect((await avisosConfig.daTela(B)).avisos[0]).toMatchObject({ padrao: true, regra: { destinos: ['tela'] } });
    });

    it('a volta: a impressora parada abre o aviso, escala ao gerente pelo WhatsApp depois de 5 min, uma vez, e resolvida manda o desfecho', async () => {
      const tel = telefone();
      await ligar('carlos', tel, A, 'gerente');
      await janelaAberta('carlos');
      numero.pedidos.length = 0;
      avisos.incidentes = [incidente('impressora_parada', 'srv:1:impressora:9')];
      expect(await avisos.volta([A])).toMatchObject({ situacoes: 1, abertos: 1, escalados: 0, resolvidos: 0 });
      const [aberto] = await avisosDe();
      expect(aberto).toMatchObject({ tipo: 'impressora', situacao: 'aberto', chave: 'vigia:impressora_parada:srv:1:impressora:9', titulo: 'Loja Centro · impressora Cozinha parada' });
      // O padrão vai à tela da loja (a faixa de quem está logado na loja, F1.4) — pelo WhatsApp, ninguém ainda.
      expect(aberto.entregas).toEqual([expect.objectContaining({ destino: 'tela', fase: 'abriu', ok: true })]);
      expect(aberto.entregas[0].motivo).toBeUndefined();
      expect(numero.enviadas).toEqual([]);
      expect(await avisos.volta([A])).toMatchObject({ abertos: 0, escalados: 0 });
      // Passaram 6 minutos: escala ao gerente da loja, uma vez.
      await q(`update mister_aviso set aberto_em = now() - interval '6 minutes 10 seconds' where id = $1`, [aberto.id]);
      expect(await avisos.volta([A])).toMatchObject({ escalados: 1 });
      expect(numero.enviadas).toEqual([{ para: tel, texto: '⏰ Sem solução há 6 min. ⚠️ Loja Centro · impressora Cozinha parada.\n\nConfira se ela está ligada, com papel e no cabo ou na rede.', botoes: [] }]);
      expect(await avisos.volta([A])).toMatchObject({ escalados: 0 });
      // A impressora voltou: o aviso fecha e o gerente recebe o desfecho.
      avisos.incidentes = [];
      expect(await avisos.volta([A])).toMatchObject({ resolvidos: 1, calados: 0 });
      expect(numero.enviadas.at(-1)).toEqual({ para: tel, texto: '✅ Resolvido: Loja Centro · impressora Cozinha parada. Durou 6 min.', botoes: [] });
      const [fechado] = await avisosDe();
      expect(fechado).toMatchObject({ situacao: 'resolvido' });
      expect(fechado.entregas.map((e: any) => [e.destino, e.fase, e.ok, e.final])).toEqual([
        ['tela', 'abriu', true, undefined],
        ['gerente', 'escalou', true, tel.slice(-4)],
        ['gerente', 'resolveu', true, tel.slice(-4)],
      ]);
      // A trilha nunca guarda o telefone inteiro.
      expect(JSON.stringify(fechado.entregas)).not.toContain(tel);
    });

    it('o histórico (F1.4 parte B): os abertos sempre, os resolvidos pelo período, a trilha com os 4 dígitos; e a lista do suporte só com o destino da DMS, de todas as empresas', async () => {
      const historico = new MisterAvisosHistoricoService(db);
      const aviso = (tenant: string, o: { tipo: string; chave: string; titulo: string; situacao?: string; abertoHa: string; resolvidoHa?: string; entregas: any[]; fechou?: string }) =>
        q(
          `insert into mister_aviso (tenant_id, unidade_id, tipo, chave, titulo, situacao, aberto_em, resolvido_em, escalado_em, entregas, dados)
           values ($1, $2, $3, $4, $5, $6, now() - $7::interval, now() - $8::interval, null, $9::jsonb, $10::jsonb) returning id`,
          [tenant, tenant === A ? lojaDeA : null, o.tipo, o.chave, o.titulo, o.situacao ?? 'aberto', o.abertoHa, o.resolvidoHa ?? null, JSON.stringify(o.entregas), JSON.stringify(o.fechou ? { fechou: o.fechou } : {})],
        );
      const em = new Date().toISOString();
      await aviso(A, {
        tipo: 'impressora', chave: `h1:${MARCA}`, titulo: 'Loja Centro · impressora Cozinha parada', abertoHa: '10 minutes',
        entregas: [
          { destino: 'tela', fase: 'abriu', em, ok: true },
          { destino: 'gerente', fase: 'escalou', em, ok: true, final: '4821', via: 'modelo' },
          { destino: 'presidente', fase: 'escalou', em, ok: false, final: '1234', motivo: 'fora_da_janela_e_sem_modelo' },
        ],
      });
      await aviso(A, { tipo: 'caixa_24h', chave: `h2:${MARCA}`, titulo: 'Loja Centro · caixa do delivery aberto há 26 horas', situacao: 'resolvido', abertoHa: '2 days', resolvidoHa: '1 day', entregas: [{ destino: 'gerente', fase: 'abriu', em, ok: true, final: '4821' }] });
      await aviso(A, { tipo: 'chave_ia', chave: `h3:${MARCA}`, titulo: 'A IA do Mister parou: sem crédito', situacao: 'resolvido', abertoHa: '40 days', resolvidoHa: '39 days', entregas: [] });
      await aviso(A, { tipo: 'pedido_parado', chave: `h4:${MARCA}`, titulo: 'Loja Centro · pedido #9 sem aceite há mais de 20 min', abertoHa: '40 days', entregas: [] });
      await aviso(A, { tipo: 'impressora', chave: `h5:${MARCA}`, titulo: 'Loja Centro · impressora Balcão parada', situacao: 'resolvido', abertoHa: '1 minute', resolvidoHa: '30 seconds', entregas: [], fechou: 'desligado' });
      await aviso(B, { tipo: 'impressora', chave: `h6:${MARCA}`, titulo: 'Matriz · impressora parada', abertoHa: '5 minutes', entregas: [] });
      // Os do suporte da DMS (servidor técnico, servidor sem sinal).
      await aviso(A, { tipo: 'servidor_tecnico', chave: `d1:${MARCA}`, titulo: 'Loja Centro · disco do servidor quase cheio', abertoHa: '2 hours', entregas: [{ destino: 'dms', fase: 'abriu', em, ok: true }] });
      await aviso(B, { tipo: 'servidor_sem_sinal', chave: `d2:${MARCA}`, titulo: 'Matriz · servidor sem sinal', situacao: 'resolvido', abertoHa: '3 hours', resolvidoHa: '2 hours', entregas: [{ destino: 'dms', fase: 'abriu', em, ok: true }] });
      await aviso(B, { tipo: 'servidor_tecnico', chave: `d3:${MARCA}`, titulo: 'Matriz · cópia de segurança atrasada', situacao: 'resolvido', abertoHa: '2 days', resolvidoHa: '30 hours', entregas: [{ destino: 'dms', fase: 'abriu', em, ok: true }] });

      // 7 dias: os abertos (mesmo o de 40 dias) primeiro, os resolvidos do período; o de 40 dias resolvido fica de fora.
      const h7 = await historico.historico(A, { dias: '7' });
      expect(h7.contagens).toEqual({ todos: 5, aberto: 3, resolvido: 2 });
      expect(h7.avisos.slice(0, 3).every((a) => a.situacao === 'aberto')).toBe(true);
      expect(h7.avisos.map((a) => a.titulo)).not.toContain('A IA do Mister parou: sem crédito');
      const imp = h7.avisos.find((a) => a.titulo === 'Loja Centro · impressora Cozinha parada')!;
      expect(imp).toMatchObject({ grupo: 'Na loja', situacao: 'aberto', foiPara: ['Tela do Regem na loja', 'WhatsApp do gerente da loja (••4821)'] });
      expect(imp.trilha).toEqual([
        { fase: 'Abriu', em, destino: 'Tela do Regem na loja', ok: true, nota: null },
        { fase: 'Sem solução', em, destino: 'WhatsApp do gerente da loja (••4821)', ok: true, nota: 'pelo modelo da Meta, fora das 24 horas' },
        { fase: 'Sem solução', em, destino: 'WhatsApp do presidente (••1234)', ok: false, nota: 'fora das 24 horas, e o modelo da Meta ainda não aprovado' },
      ]);
      expect(h7.avisos.find((a) => a.titulo.includes('Balcão'))).toMatchObject({ situacao: 'resolvido', fechouDesligado: true });
      // 30 dias: o resolvido de 40 dias continua de fora; hoje: o de 2 dias sai.
      expect((await historico.historico(A, { dias: '30' })).contagens).toEqual({ todos: 5, aberto: 3, resolvido: 2 });
      expect((await historico.historico(A, { dias: '1' })).contagens).toEqual({ todos: 4, aberto: 3, resolvido: 1 });
      // O grupo, a busca e a situação filtram no servidor também; as recusas.
      expect((await historico.historico(A, { dias: '7', grupo: 'Servidor da loja' })).avisos.map((a) => a.titulo)).toEqual(['Loja Centro · disco do servidor quase cheio']);
      expect((await historico.historico(A, { dias: '7', busca: 'cozinha' })).avisos).toHaveLength(1);
      expect((await historico.historico(A, { dias: '7', situacao: 'resolvido' })).avisos.every((a) => a.situacao === 'resolvido')).toBe(true);
      await expect(historico.historico(A, { dias: '5' })).rejects.toThrow('O período é hoje, 7 ou 30 dias.');
      await expect(historico.historico(A, { dias: '7', grupo: 'Outro' })).rejects.toThrow('Grupo de aviso desconhecido.');
      // A outra empresa não vê nada desta.
      expect((await historico.historico(B, { dias: '7' })).avisos.map((a) => a.titulo)).not.toContain('Loja Centro · impressora Cozinha parada');

      // O suporte da DMS: só os de destino "dms", de todas as empresas, com a empresa e a loja; resolvidos só das 24 h.
      const abertos = await historico.paraOSuporte({ situacao: 'abertos', busca: MARCA });
      expect(abertos.avisos).toEqual([
        { id: expect.any(String), empresa: NOME_A, loja: 'Loja Centro', aviso: 'disco do servidor quase cheio', situacao: 'aberto', escalado: false, abertoEm: expect.any(String), resolvidoEm: null },
      ]);
      expect(abertos.contagens).toEqual({ abertos: 1, resolvidos: 1 });
      const resolvidos = await historico.paraOSuporte({ situacao: 'resolvidos', busca: MARCA });
      expect(resolvidos.avisos.map((a) => [a.empresa, a.loja, a.aviso])).toEqual([[NOME_B, null, 'servidor sem sinal']]);
      // A busca pela empresa; o curinga do usuário não vira curinga.
      expect((await historico.paraOSuporte({ situacao: 'abertos', busca: `Pizzaria do Porto ${MARCA}` })).avisos).toEqual([]);
      expect((await historico.paraOSuporte({ situacao: 'abertos', busca: '%' })).avisos).toEqual([]);
    });

    it('a tela da loja (F1.4): o aviso aparece só na loja dele, o "Ciente" é por pessoa e sobrevive à renovação, a escala traz a faixa de volta, resolvido some; o servidor da loja pede à nuvem', async () => {
      const tel = telefone();
      await ligar('carlos', tel, A, 'gerente');
      await janelaAberta('carlos');
      const [{ id: outraLoja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja Norte') returning id`, [A]);
      const tela = new AvisosNaTelaService(db);
      try {
        emitidos.length = 0;
        avisos.incidentes = [incidente('impressora_parada', 'srv:1:impressora:9')];
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1 });
        const [aberto] = await avisosDe();
        // As telas abertas relêem na hora (tempo real).
        expect(emitidos.filter(([n]) => n === 'mister.avisos.mudou')).toEqual([['mister.avisos.mudou', { tenantId: A }]]);
        // Na loja do aviso: aparece, com o grupo, o "o que fazer" e sem "Ciente" de ninguém. Na outra loja e na outra
        // empresa: nada.
        const doEdu = await tela.daLoja(A, lojaDeA, pessoa.edu);
        expect(doEdu).toEqual({
          avisos: [
            {
              id: aberto.id,
              grupo: 'Na loja',
              titulo: 'Loja Centro · impressora Cozinha parada',
              detalhe: 'Confira se ela está ligada, com papel e no cabo ou na rede.',
              abertoEm: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
              escalado: false,
              tambem: [],
              ciente: false,
            },
          ],
        });
        expect((await tela.daLoja(A, outraLoja, pessoa.edu)).avisos).toEqual([]);
        expect((await tela.daLoja(B, null, pessoa.anaB)).avisos).toEqual([]);
        // O presidente na rede toda (sem loja escolhida) vê.
        expect((await tela.daLoja(A, null, pessoa.ana)).avisos).toHaveLength(1);

        // "Ciente" do Edu: some da faixa só dele (duas vezes não duplica); a Ana segue vendo.
        await tela.ciente(A, lojaDeA, pessoa.edu, aberto.id);
        await tela.ciente(A, lojaDeA, pessoa.edu, aberto.id);
        expect((await tela.daLoja(A, lojaDeA, pessoa.edu)).avisos[0].ciente).toBe(true);
        expect((await tela.daLoja(A, null, pessoa.ana)).avisos[0].ciente).toBe(false);
        expect((await q(`select dados -> 'cientes' as c from mister_aviso where id = $1`, [aberto.id]))[0].c).toEqual([pessoa.edu]);
        // A volta seguinte renova o aviso e guarda o "Ciente".
        await avisos.volta([A]);
        expect((await tela.daLoja(A, lojaDeA, pessoa.edu)).avisos[0].ciente).toBe(true);
        // Aviso de outra loja, id inválido: recusa.
        await expect(tela.ciente(A, outraLoja, pessoa.edu, aberto.id)).rejects.toThrow('não está mais aberto nesta loja');
        await expect(tela.ciente(A, lojaDeA, pessoa.edu, 'x')).rejects.toThrow('Aviso inválido');

        // Sem solução em 5 min: escala (ao gerente) e a faixa volta para todos.
        emitidos.length = 0;
        await q(`update mister_aviso set aberto_em = now() - interval '6 minutes 10 seconds' where id = $1`, [aberto.id]);
        expect(await avisos.volta([A])).toMatchObject({ escalados: 1 });
        const escalado = (await tela.daLoja(A, lojaDeA, pessoa.edu)).avisos[0];
        expect(escalado).toMatchObject({ ciente: false, escalado: true, tambem: ['WhatsApp do gerente da loja'] });
        expect(emitidos.some(([n]) => n === 'mister.avisos.mudou')).toBe(true);

        // O servidor da loja: pede à nuvem (o "Ciente" de quem pediu é calculado lá, com a lista que a nuvem manda).
        const daNuvem = await tela.paraOServidorDaLoja(A, lojaDeA);
        expect(daNuvem).toMatchObject({ tenantId: A, avisos: [{ id: aberto.id, cientes: [] }] });
        const chamadas: any[] = [];
        let resposta: any = { j: daNuvem };
        class TelaDoServidorDaLoja extends AvisosNaTelaService {
          protected async naNuvem(caminho: string, init: { method?: string; body?: string } = {}) {
            chamadas.push([caminho, init.method ?? 'GET', init.body ?? null]);
            return resposta;
          }
        }
        const naLoja = new TelaDoServidorDaLoja(db);
        const antes = process.env.EDGE_MODE;
        process.env.EDGE_MODE = 'true';
        try {
          expect((await naLoja.daLoja(A, lojaDeA, pessoa.edu)).avisos.map((a) => [a.id, a.ciente])).toEqual([[aberto.id, false]]);
          // Muitas telas na loja: uma leitura na nuvem (o cache curto).
          await naLoja.daLoja(A, lojaDeA, pessoa.ana);
          expect(chamadas).toEqual([['/mister/avisos/loja', 'GET', null]]);
          // O "Ciente" vai à nuvem com a pessoa, e o cache cai.
          resposta = { j: { ok: true } };
          await naLoja.ciente(A, lojaDeA, pessoa.edu, aberto.id);
          expect(chamadas[1]).toEqual([`/mister/avisos/${aberto.id}/ciente/loja`, 'POST', JSON.stringify({ colaboradorId: pessoa.edu })]);
          // Sem internet: "sem conexão" (a tela não mostra nada, e não diz "nenhum aviso").
          resposta = { motivo: 'ECONNREFUSED' };
          expect(await naLoja.daLoja(A, lojaDeA, pessoa.edu)).toEqual({ avisos: [], semConexao: true });
          // A nuvem respondeu por outra empresa: também não vale.
          const outra = new TelaDoServidorDaLoja(db);
          resposta = { j: { tenantId: B, avisos: daNuvem.avisos } };
          expect(await outra.daLoja(A, lojaDeA, pessoa.edu)).toEqual({ avisos: [], semConexao: true });
        } finally {
          if (antes === undefined) delete process.env.EDGE_MODE;
          else process.env.EDGE_MODE = antes;
        }
        // A rota da nuvem para o servidor da loja só aceita pessoa da empresa.
        await expect(tela.cienteDoServidorDaLoja(A, lojaDeA, aberto.id, pessoa.anaB)).rejects.toThrow('não é desta empresa');
        await tela.cienteDoServidorDaLoja(A, lojaDeA, aberto.id, pessoa.ana);
        expect((await tela.daLoja(A, null, pessoa.ana)).avisos[0].ciente).toBe(true);

        // A impressora voltou: resolve, some da tela e as telas relêem.
        emitidos.length = 0;
        avisos.incidentes = [];
        expect(await avisos.volta([A])).toMatchObject({ resolvidos: 1 });
        expect((await tela.daLoja(A, lojaDeA, pessoa.edu)).avisos).toEqual([]);
        expect(emitidos.some(([n]) => n === 'mister.avisos.mudou')).toBe(true);
      } finally {
        await q(`delete from unidade where id = $1`, [outraLoja]);
      }
    });

    it('o servidor sem sinal só avisa com pedido esperando e segue aberto até voltar; sem gerente ligado vai ao presidente; fora da janela de 24 h vai pelo modelo da Meta', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      await janelaAberta('ana');
      numero.pedidos.length = 0;
      avisos.incidentes = [incidente('servidor_sem_sinal', 'srv:1', { esperando: 0 })];
      expect(await avisos.volta([A])).toMatchObject({ situacoes: 0, abertos: 0 });
      avisos.incidentes = [incidente('servidor_sem_sinal', 'srv:1', { esperando: 2 })];
      expect(await avisos.volta([A])).toMatchObject({ abertos: 1 });
      const [semSinal] = await avisosDe();
      expect(semSinal.entregas.map((e: any) => [e.destino, e.ok, e.motivo ?? null])).toEqual([
        ['gerente', true, 'sem_gerente_ligado_foi_ao_presidente'],
        ['dms', true, null],
      ]);
      expect(numero.enviadas).toEqual([{ para: tel, texto: '⚠️ Loja Centro · servidor sem sinal.\n\nConfira se o computador do servidor está ligado e com internet.', botoes: [] }]);
      // Os pedidos acabaram, mas o servidor segue sem sinal: o aviso continua aberto (não "resolve" à toa).
      avisos.incidentes = [incidente('servidor_sem_sinal', 'srv:1', { esperando: 0, jaAberto: true })];
      expect(await avisos.volta([A])).toMatchObject({ resolvidos: 0 });
      // O caixa aberto há 30 horas, com o presidente fora da janela de 24 h: o aviso sai pelo MODELO da Meta, com o botão.
      avisos.incidentes = [incidente('servidor_sem_sinal', 'srv:1', { esperando: 0, jaAberto: true })];
      await q(`update mister_vinculo set ultima_entrada_em = now() - interval '25 hours' where colaborador_id = $1`, [pessoa.ana]);
      await q(`insert into caixa_sessao (tenant_id, unidade_id, origem, status, valor_abertura, aberta_em, aberta_por_id) values ($1, $2, 'pdv', 'aberta', 0, now() - interval '30 hours', $3)`, [A, lojaDeA, pessoa.carlos]);
      numero.pedidos.length = 0;
      try {
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1 });
        const caixa = (await avisosDe()).find((a) => a.tipo === 'caixa_24h');
        expect(caixa.titulo).toBe('Loja Centro · caixa do balcão aberto há 30 horas (aberto por Carlos Lima)');
        expect(caixa.entregas).toEqual([expect.objectContaining({ destino: 'gerente', ok: true, via: 'modelo', final: tel.slice(-4) })]);
        expect(numero.enviadas).toEqual([
          { para: tel, texto: 'modelo:mister_aviso:Loja Centro|caixa do balcão aberto há 30 horas (aberto por Carlos Lima)', botoes: [{ id: `mister:aviso:${caixa.id}`, titulo: 'modelo' }] },
        ]);
      } finally {
        await q(`delete from caixa_sessao where tenant_id = $1`, [A]);
      }
    });

    it('fora da janela de 24 h: o aviso sai pelo modelo; o toque em "Ver o que fazer" traz o texto inteiro, só a quem recebeu; sem o modelo aprovado, fica anotado', async () => {
      await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'impressora', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [] }] });
      const telAna = telefone();
      const telCarlos = telefone();
      const telAnaB = telefone();
      await ligar('ana', telAna);
      await ligar('carlos', telCarlos, A, 'gerente');
      await ligar('anaB', telAnaB, B);
      await q(`update mister_vinculo set ultima_entrada_em = now() - interval '25 hours' where colaborador_id = $1`, [pessoa.ana]);
      numero.pedidos.length = 0;
      avisos.incidentes = [incidente('impressora_parada', 'srv:1:impressora:9')];
      expect(await avisos.volta([A])).toMatchObject({ abertos: 1, entregas: 1 });
      const [aberto] = await avisosDe();
      expect(aberto.entregas).toEqual([expect.objectContaining({ destino: 'presidente', fase: 'abriu', ok: true, via: 'modelo', final: telAna.slice(-4) })]);
      const codigo = `mister:aviso:${aberto.id}`;
      expect(numero.enviadas).toEqual([{ para: telAna, texto: 'modelo:mister_aviso:Loja Centro|impressora Cozinha parada', botoes: [{ id: codigo, titulo: 'modelo' }] }]);
      // O pedido à Meta: o modelo, o idioma e o código no botão de resposta rápida.
      const pedido = numero.pedidos.find((p) => p.corpo?.type === 'template')!;
      expect(pedido.corpo.template).toMatchObject({ name: 'mister_aviso', language: { code: 'pt_BR' } });
      expect(pedido.corpo.template.components[1]).toEqual({ type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: codigo }] });

      // Quem não recebeu não vê: o gerente da mesma empresa (o aviso foi só ao presidente) e a presidente de outra empresa.
      numero.pedidos.length = 0;
      expect(await mandar(telCarlos, 'Ver o que fazer', { codigoDoModelo: codigo })).toBe('modelo_nao_achado');
      expect(await mandar(telAnaB, 'Ver o que fazer', { codigoDoModelo: codigo })).toBe('modelo_nao_achado');
      expect(numero.enviadas.map((m) => [m.para, m.texto])).toEqual([
        [telCarlos, TEXTOS.modeloNaoAchado],
        [telAnaB, TEXTOS.modeloNaoAchado],
      ]);
      // O toque não virou pergunta para a IA.
      expect(await q(`select count(*)::int as n from mister_pergunta where tenant_id = any($1::uuid[])`, [[A, B]])).toEqual([{ n: 0 }]);

      // A Ana toca: a janela abre (a hora vale para os vínculos do telefone) e chega o texto inteiro, com o que fazer. O
      // toque chega pelo webhook como a Meta manda: `type: button`, com o código em `button.payload`.
      numero.pedidos.length = 0;
      const toque = wamid();
      expect(await entrada.receberDaMeta(PHONE_ID, { messages: [{ from: telAna, id: toque, type: 'button', button: { payload: codigo, text: 'Ver o que fazer' } }] })).toBe(true);
      expect((await q(`select desfecho from mister_mensagem where wamid = $1`, [toque]))[0]).toEqual({ desfecho: 'tocou_modelo' });
      // A presidente recebe também a proposta da via de teste (F4.1), com os botões.
      const [prop] = await q(`select id from mister_proposta where aviso_id = $1 and situacao = 'proposta'`, [aberto.id]);
      expect(numero.enviadas).toEqual([
        {
          para: telAna,
          texto:
            '⚠️ Loja Centro · impressora Cozinha parada.\n\nConfira se ela está ligada, com papel e no cabo ou na rede.\n\n' +
            'Posso mandar uma via de teste para esta impressora? Se ela imprimir, voltou a responder. A pergunta vale por 10 minutos.',
          botoes: [
            { id: `prop:${prop.id}:sim`, titulo: 'Autorizar' },
            { id: `prop:${prop.id}:nao`, titulo: 'Não agora' },
          ],
        },
      ]);
      const [vAna] = await q(`select ultima_entrada_em > now() - interval '1 minute' as agora from mister_vinculo where colaborador_id = $1`, [pessoa.ana]);
      expect(vAna.agora).toBe(true);
      // A Meta reenvia o mesmo toque: nada de novo.
      expect(await mandar(telAna, 'Ver o que fazer', { codigoDoModelo: codigo, wamid: toque })).toBe('repetida');

      // A impressora voltou: com a janela aberta, o desfecho chega pelo texto livre. Um toque depois traz o desfecho.
      avisos.incidentes = [];
      expect(await avisos.volta([A])).toMatchObject({ resolvidos: 1 });
      numero.pedidos.length = 0;
      expect(await mandar(telAna, 'Ver o que fazer', { codigoDoModelo: codigo })).toBe('tocou_modelo');
      expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringMatching(/^✅ Resolvido: Loja Centro · impressora Cozinha parada\. Durou \d+ min\.$/)]);

      // Sem o modelo aprovado na Meta (#132001): o aviso abre e fica anotado, sem mensagem.
      await q(`update mister_vinculo set ultima_entrada_em = now() - interval '25 hours' where colaborador_id = $1`, [pessoa.ana]);
      numero.responder = (p) => (p.corpo?.type === 'template' ? { status: 404, corpo: { error: { code: 132001, message: 'Template name does not exist in the translation' } } } : undefined);
      avisos.incidentes = [incidente('impressora_parada', 'srv:1:impressora:10')];
      expect(await avisos.volta([A])).toMatchObject({ abertos: 1, entregas: 0 });
      const novo = (await avisosDe()).find((a) => a.situacao === 'aberto');
      expect(novo.entregas).toEqual([expect.objectContaining({ destino: 'presidente', ok: false, motivo: 'fora_da_janela_e_sem_modelo', final: telAna.slice(-4) })]);
    });

    it('KDS e Atendimento: o aviso vai ao KDS (desce à loja, com id fixo) e abre um caso urgente que fecha sozinho quando resolve', async () => {
      await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'impressora', ligado: true, destinos: ['kds', 'atendimento'], escalaMin: null, escalaPara: [] }] });
      avisos.incidentes = [incidente('impressora_parada', 'srv:1:impressora:9')];
      try {
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1, entregas: 2 });
        const [aberto] = await avisosDe();
        expect(kdsAvisos).toEqual([
          expect.objectContaining({ tenantId: A, unidadeId: lojaDeA, id: uuidDeChave('mister-aviso', aberto.id, 'abriu'), titulo: 'Loja Centro · impressora Cozinha parada', tipo: 'gestao', fica: true, naLoja: true, origem: 'Mister', ref: aberto.id }),
        ]);
        const [caso] = await q(`select * from atendimento_chamado where tenant_id = $1 and mensagem like 'Aviso do Mister:%'`, [A]);
        expect(caso).toMatchObject({ prioridade: 'urgente', status: 'aberto', unidade_id: lojaDeA });
        expect(caso.mensagem).toBe('Aviso do Mister: Loja Centro · impressora Cozinha parada. Confira se ela está ligada, com papel e no cabo ou na rede.');
        expect(emitidos.map((e) => e[0])).toEqual(['atendimento.novo']);
        // Resolvido: o caso fecha sozinho.
        avisos.incidentes = [];
        await avisos.volta([A]);
        expect((await q(`select status from atendimento_chamado where id = $1`, [caso.id]))[0].status).toBe('resolvido');
        expect(emitidos.map((e) => e[0])).toEqual(['atendimento.novo', 'atendimento.mudou']);
      } finally {
        await q(`delete from atendimento_chamado where tenant_id = $1`, [A]);
      }
    });

    it('a chave de IA parada vai ao presidente; duas voltas ao mesmo tempo entregam uma vez; desligar o tipo fecha o aviso calado; módulo desligado não avisa', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      await janelaAberta('ana');
      numero.pedidos.length = 0;
      avisos.incidentes = [];
      await q(`insert into ia_credencial (tenant_id, provedor, chave_cifrada, final, situacao) values ($1, 'anthropic', 'cifrada-de-teste', 'abcd', 'sem_credito')`, [A]);
      const [r1, r2] = await Promise.all([avisos.volta([A]), avisos.volta([A])]);
      expect(r1.abertos + r2.abertos).toBe(1);
      expect(numero.enviadas).toEqual([{ para: tel, texto: expect.stringMatching(/^⚠️ A IA do Mister parou: a chave de IA está sem crédito\./), botoes: [] }]);
      // O presidente desliga o aviso: ele fecha calado (sem "resolvido" mentiroso).
      await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'chave_ia', ligado: false, destinos: ['presidente'], escalaMin: null, escalaPara: [] }] });
      expect(await avisos.volta([A])).toMatchObject({ calados: 1, resolvidos: 0 });
      expect(numero.enviadas).toHaveLength(1);
      // Módulo desligado: nada abre.
      await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'chave_ia', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [] }] });
      await modulo(A, false);
      expect(await avisos.volta([A])).toMatchObject({ abertos: 0 });
      await modulo(A, true);
    });

    it('a leitura de verdade do vigia (quando a tabela existe neste banco) vira aviso pela mesma volta', async () => {
      const [{ tem }] = await q(`select to_regclass('vigia_incidente') is not null as tem`);
      if (!tem) return; // a tabela só-nuvem nasce na spec do vigia (ERR-451: não reaplicar a 414 aqui)
      avisos.incidentes = null;
      await q(`insert into vigia_incidente (tenant_id, unidade_id, regra, chave, gravidade, publico, evidencia) values ($1, $2, 'impressora_parada', $3, 'atencao', 'loja', '{"impressora":"Bar"}')`, [A, lojaDeA, `srv:${MARCA}:imp`]);
      try {
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1 });
        expect((await avisosDe())[0]).toMatchObject({ tipo: 'impressora', titulo: 'Loja Centro · impressora Bar parada' });
      } finally {
        await q(`delete from vigia_incidente where tenant_id = $1`, [A]);
      }
    });

    it('a trava da escala: duas réplicas marcando o mesmo aviso ao mesmo tempo, só uma ganha (e só ela entrega)', async () => {
      const [{ id }] = await q(`insert into mister_aviso (tenant_id, tipo, chave, titulo) values ($1, 'impressora', $2, 'Teste') returning id`, [A, `trava:${MARCA}`]);
      const ganhou = await Promise.all(Array.from({ length: 5 }, () => avisos.marcarEscala(id)));
      expect(ganhou.filter(Boolean)).toHaveLength(1);
      expect(await avisos.marcarEscala(id)).toBe(false);
    });

    it('quem respondeu PARAR AVISOS não recebe o aviso pelo WhatsApp (e, sem mais ninguém, fica anotado)', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      await q(`update mister_vinculo set ultima_entrada_em = now(), pausado_em = now() where colaborador_id = $1`, [pessoa.ana]);
      numero.pedidos.length = 0;
      avisos.incidentes = [];
      await q(`insert into ia_credencial (tenant_id, provedor, chave_cifrada, final, situacao) values ($1, 'anthropic', 'cifrada-de-teste', 'abcd', 'teto_atingido')`, [A]);
      expect(await avisos.volta([A])).toMatchObject({ abertos: 1, entregas: 0 });
      expect(numero.enviadas).toEqual([]);
      expect((await avisosDe())[0].entregas).toEqual([expect.objectContaining({ destino: 'presidente', ok: false, motivo: 'ninguem_ligado' })]);
    });

    // ───────────────────────────── os avisos, parte 2: fiscal ─────────────────────────────

    it('o certificado da nota: só com a emissão ligada; abre no marco, lembra no marco seguinte (uma vez), e renovado resolve', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      await janelaAberta('ana');
      numero.pedidos.length = 0;
      avisos.incidentes = [];
      try {
        // Emissão desligada: o certificado perto de vencer não incomoda ninguém.
        await q(`insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente) values ($1, null, false, '2')`, [A]);
        await q(`insert into fiscal_credencial (tenant_id, unidade_id, cert_valido_ate) values ($1, null, now() + interval '10 days 1 hour')`, [A]);
        expect(await avisos.volta([A])).toMatchObject({ abertos: 0 });
        // Ligada: abre no marco de 15 dias, ao presidente.
        await q(`update fiscal_config set ativo = true where tenant_id = $1`, [A]);
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1, lembrados: 0 });
        const [aviso] = await avisosDe();
        expect(aviso).toMatchObject({ tipo: 'certificado', titulo: expect.stringMatching(/ · certificado digital da nota vence em \d{2}\/\d{2}$/) });
        expect(aviso.dados).toMatchObject({ marco: '15', dias: 10 });
        expect(numero.enviadas).toEqual([{ para: tel, texto: expect.stringContaining('Faltam 10 dias.'), botoes: [] }]);
        expect(numero.enviadas[0].texto).toContain('em Financeiro › Configuração, em "Certificado A1 (.pfx)"');
        // A volta seguinte, no mesmo marco: nada de novo.
        expect(await avisos.volta([A])).toMatchObject({ abertos: 0, lembrados: 0 });
        // Chegou aos 7 dias: o MESMO aviso lembra, uma vez (duas voltas juntas), só pelo WhatsApp.
        await q(`update fiscal_credencial set cert_valido_ate = now() + interval '5 days 1 hour' where tenant_id = $1`, [A]);
        const [r1, r2] = await Promise.all([avisos.volta([A]), avisos.volta([A])]);
        expect(r1.lembrados + r2.lembrados).toBe(1);
        expect(numero.enviadas).toHaveLength(2);
        expect(numero.enviadas[1].texto).toMatch(/^🔔 Lembrete: .* certificado digital da nota vence em/);
        expect(numero.enviadas[1].texto).toContain('Faltam 5 dias.');
        expect(await avisosDe()).toHaveLength(1);
        // Venceu: outro lembrete, com o texto de vencido.
        await q(`update fiscal_credencial set cert_valido_ate = now() - interval '1 hour' where tenant_id = $1`, [A]);
        expect(await avisos.volta([A])).toMatchObject({ lembrados: 1 });
        expect(numero.enviadas[2].texto).toMatch(/^🔔 Lembrete: .* certificado digital da nota venceu em/);
        // Renovado (fora dos 60 dias): resolve, com o desfecho a quem recebeu.
        await q(`update fiscal_credencial set cert_valido_ate = now() + interval '400 days' where tenant_id = $1`, [A]);
        expect(await avisos.volta([A])).toMatchObject({ resolvidos: 1 });
        expect(numero.enviadas[3].texto).toMatch(/^✅ Resolvido: .* certificado digital da nota venceu em/);
        expect((await avisosDe())[0].entregas.map((e: any) => [e.fase, e.ok])).toEqual([
          ['abriu', true],
          ['lembrou', true],
          ['lembrou', true],
          ['resolveu', true],
        ]);
      } finally {
        await q(`delete from fiscal_credencial where tenant_id = $1`, [A]);
        await q(`delete from fiscal_config where tenant_id = $1`, [A]);
      }
    });

    it('o certificado: o da loja vale antes do da empresa, e o da empresa em várias lojas vira um aviso só', async () => {
      avisos.incidentes = [];
      const [{ id: outra }] = await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [A, `Loja Norte ${MARCA}`]);
      try {
        // A empresa emite (a configuração da empresa vale para as duas lojas) com o certificado da empresa: UM aviso.
        await q(`insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente) values ($1, null, true, '2')`, [A]);
        await q(`insert into fiscal_credencial (tenant_id, unidade_id, cert_valido_ate) values ($1, null, now() + interval '20 days 1 hour')`, [A]);
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1 });
        expect((await avisosDe()).map((a: any) => [a.tipo, a.unidade_id, a.dados.marco])).toEqual([['certificado', null, '30']]);
        // A Loja Centro ganha certificado próprio, em dia: o dela vale lá; o da empresa segue valendo na Loja Norte (e na empresa).
        await q(`insert into fiscal_credencial (tenant_id, unidade_id, cert_valido_ate) values ($1, $2, now() + interval '300 days')`, [A, lojaDeA]);
        expect(await avisos.volta([A])).toMatchObject({ abertos: 0, resolvidos: 0 });
        // O da empresa renovado e o da Loja Centro perto de vencer: o da empresa resolve e o da loja abre, com o nome dela.
        await q(`update fiscal_credencial set cert_valido_ate = now() + interval '400 days' where tenant_id = $1 and unidade_id is null`, [A]);
        await q(`update fiscal_credencial set cert_valido_ate = now() + interval '3 days 1 hour' where tenant_id = $1 and unidade_id = $2`, [A, lojaDeA]);
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1, resolvidos: 1 });
        const abertos = (await avisosDe()).filter((a: any) => a.situacao === 'aberto');
        expect(abertos.map((a: any) => [a.unidade_id, a.dados.marco, a.titulo.startsWith('Loja Centro · ')])).toEqual([[lojaDeA, '7', true]]);
      } finally {
        await q(`delete from fiscal_credencial where tenant_id = $1`, [A]);
        await q(`delete from fiscal_config where tenant_id = $1`, [A]);
        await q(`delete from unidade where id = $1`, [outra]);
      }
    });

    it('a nota sem resposta: só a que gastou TODAS as reconsultas (o número do fiscal), nunca a simulada; respondida, resolve', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      await janelaAberta('ana');
      numero.pedidos.length = 0;
      avisos.incidentes = [];
      const nota = (numeroDaNota: number, tentativas: number, simulada = false) =>
        q(
          `insert into nota_fiscal (tenant_id, unidade_id, serie, numero, status, simulada, chave, tentativas_consulta, emitida_em)
           values ($1, $2, 9, $3, 'pendente', $4, $5, $6, now() - interval '3 days') returning id`,
          [A, lojaDeA, numeroDaNota, simulada, `3326${MARCA}${numeroDaNota}`.padEnd(44, '0'), tentativas],
        );
      try {
        await nota(901, MAX_TENTATIVAS_CONSULTA_DA_NOTA - 1); // ainda vai ser reconsultada
        await nota(902, MAX_TENTATIVAS_CONSULTA_DA_NOTA, true); // simulada não é documento fiscal
        const [{ id }] = await nota(903, MAX_TENTATIVAS_CONSULTA_DA_NOTA);
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1 });
        const [aviso] = await avisosDe();
        expect(aviso).toMatchObject({ tipo: 'nota_sem_resposta', unidade_id: lojaDeA, titulo: 'Loja Centro · nota fiscal nº 903 (série 9) sem resposta da SEFAZ' });
        expect(aviso.detalhe).toContain(`consultou ${MAX_TENTATIVAS_CONSULTA_DA_NOTA} vezes e parou`);
        expect(aviso.detalhe).toContain('em Financeiro › Notas fiscais, em "Consultar na SEFAZ"');
        // O padrão: caso urgente no Atendimento e o presidente pelo WhatsApp.
        expect(aviso.entregas.map((e: any) => [e.destino, e.ok])).toEqual(
          expect.arrayContaining([
            ['atendimento', true],
            ['presidente', true],
          ]),
        );
        expect(numero.enviadas).toHaveLength(1);
        // A SEFAZ respondeu (autorizada): resolve e fecha o caso.
        await q(`update nota_fiscal set status = 'autorizada' where id = $1`, [id]);
        expect(await avisos.volta([A])).toMatchObject({ resolvidos: 1 });
        const caso = aviso.entregas.find((e: any) => e.destino === 'atendimento');
        const [{ status }] = await q(`select status from atendimento_chamado where id = $1`, [caso.casoId]);
        expect(status).toBe('resolvido');
      } finally {
        await q(`delete from nota_fiscal where tenant_id = $1`, [A]);
      }
    });

    // Decisão 4 do protótipo Sentinela e Mentor: o segredo tirado da resposta vira aviso SÓ da distribuição.
    it('o segredo tirado da resposta vira aviso ao suporte da DMS (só o destino dms, nunca o segredo); a loja não vê; fecha sozinho depois de 24 horas', async () => {
      const historico = new MisterAvisosHistoricoService(db);
      const [p] = await q(
        `insert into mister_pergunta (tenant_id, colaborador_id, nivel, telefone, chave, situacao, ferramentas, conferencia)
         values ($1, $2, 'presidente', $3, $4, 'respondida', $5::jsonb, '["segredo"]'::jsonb) returning id::text as id`,
        [A, pessoa.ana, telefone(), `segredo:${MARCA}:${randomUUID()}`, JSON.stringify([{ nome: 'canais_e_integracoes', ok: true, ms: 40 }, { nome: 'resumo_do_dia', ok: false, ms: 9 }])],
      );
      try {
        avisos.incidentes = [];
        numero.pedidos.length = 0;
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1 });
        const [a] = await q(`select * from mister_aviso where tenant_id = $1 and tipo = 'segredo_na_resposta'`, [A]);
        expect(a).toMatchObject({ situacao: 'aberto', chave: `segredo:${p.id}`, titulo: 'Segredo tirado da resposta do Mister', unidade_id: null });
        expect(a.detalhe).toContain('(consultas: canais_e_integracoes)');
        expect(a.entregas.map((e: any) => e.destino)).toEqual(['dms']);
        // Nada sai por WhatsApp (o destino é só o suporte) e nada aparece na tela da loja.
        expect(numero.enviadas).toEqual([]);
        // O Console › Avisos mostra; o Histórico da loja (o presidente), não.
        const suporte = await historico.paraOSuporte({});
        expect(suporte.avisos.map((x: any) => x.aviso)).toContain('Segredo tirado da resposta do Mister');
        const daLoja = await historico.historico(A, { dias: 30 });
        expect(daLoja.avisos.map((x: any) => x.titulo)).not.toContain('Segredo tirado da resposta do Mister');
        // A volta seguinte não duplica; depois de 24 horas, fecha sozinho.
        expect(await avisos.volta([A])).toMatchObject({ abertos: 0 });
        await q(`update mister_pergunta set criado_em = now() - interval '25 hours' where id = $1`, [p.id]);
        expect(await avisos.volta([A])).toMatchObject({ resolvidos: 1 });
        expect((await q(`select situacao from mister_aviso where id = $1`, [a.id]))[0].situacao).toBe('resolvido');
        // A empresa não desliga: a regra é fixa (a configuração da loja nem tem esse tipo).
        await expect(avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'segredo_na_resposta', ligado: false, destinos: [], escalaMin: null, escalaPara: [] }] })).rejects.toThrow();
      } finally {
        await q(`delete from mister_pergunta where id = $1`, [p.id]);
      }
    });

    // ───────────────────────────── as propostas (F4.1, mig 428) ─────────────────────────────

    const notaSemResposta = (numeroDaNota: number) =>
      q(
        `insert into nota_fiscal (tenant_id, unidade_id, serie, numero, status, simulada, chave, tentativas_consulta, emitida_em)
         values ($1, $2, 9, $3, 'pendente', false, $4, $5, now() - interval '3 days') returning id`,
        [A, lojaDeA, numeroDaNota, `3326${MARCA}${numeroDaNota}`.padEnd(44, '0'), MAX_TENTATIVAS_CONSULTA_DA_NOTA],
      ).then((r) => r[0].id as string);
    const propostaDe = async (avisoId: string) => (await q(`select * from mister_proposta where aviso_id = $1`, [avisoId]))[0];
    /** A execução logo depois do toque segue sozinha (não segura a resposta ao WhatsApp): espera ela fechar. */
    const esperarFechar = async (id: string) => {
      for (let i = 0; i < 100; i++) {
        const [p] = await q(`select situacao from mister_proposta where id = $1`, [id]);
        if (['feita', 'nao_deu'].includes(p?.situacao)) return p.situacao;
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error('a proposta não fechou');
    };
    /** O desfecho a quem autorizou sai depois de a proposta fechar no banco: espera a mensagem chegar. */
    const esperarMensagens = async (n: number) => {
      for (let i = 0; i < 100 && numero.enviadas.length < n; i++) await new Promise((r) => setTimeout(r, 30));
    };

    it('a proposta: a nota sem resposta vai ao presidente com "Autorizar"; o toque consulta pela porta da tela UMA vez e diz o que a SEFAZ respondeu', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      await janelaAberta('ana');
      numero.pedidos.length = 0;
      avisos.incidentes = [];
      consultas.length = 0;
      auditados.length = 0;
      respostaDaConsulta = async () => ({ status: 'autorizada', numero: 904 });
      try {
        const notaId = await notaSemResposta(904);
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1 });
        const [aviso] = await avisosDe();
        const prop = await propostaDe(aviso.id);
        expect(prop).toMatchObject({ tenant_id: A, unidade_id: lojaDeA, procedimento: 'consultar_nota', nivel: 'botao', situacao: 'proposta', parametros: { notaId } });
        // Vale 10 minutos.
        expect(Math.round((new Date(prop.vence_em).getTime() - new Date(prop.criada_em).getTime()) / 60_000)).toBe(10);
        // O aviso e a pergunta numa mensagem só, com os dois botões.
        expect(numero.enviadas).toHaveLength(1);
        expect(numero.enviadas[0].texto).toContain('nota fiscal nº 904');
        expect(numero.enviadas[0].texto).toMatch(/\n\nPosso consultar esta nota de novo na SEFAZ\? Leva alguns segundos\. A pergunta vale por 10 minutos\.$/);
        expect(numero.enviadas[0].botoes).toEqual([
          { id: `prop:${prop.id}:sim`, titulo: 'Autorizar' },
          { id: `prop:${prop.id}:nao`, titulo: 'Não agora' },
        ]);
        // A volta repetida não cria outra proposta nem manda de novo.
        numero.pedidos.length = 0;
        await avisos.volta([A]);
        expect(await q(`select id from mister_proposta where aviso_id = $1`, [aviso.id])).toHaveLength(1);
        expect(numero.enviadas).toEqual([]);

        // "Autorizar": responde na hora, consulta pela porta da tela e confere pela resposta da SEFAZ.
        expect(await mandar(tel, 'Autorizar', { botaoId: `prop:${prop.id}:sim` })).toBe('respondeu_proposta');
        expect(await esperarFechar(prop.id)).toBe('feita');
        await esperarMensagens(2);
        expect(consultas).toEqual([[A, notaId, pessoa.ana]]);
        expect(await propostaDe(aviso.id)).toMatchObject({ situacao: 'feita', resultado: 'A SEFAZ autorizou a nota nº 904.', autorizada_por: pessoa.ana, telefone_final: tel.slice(-4) });
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Autorizado. Consultando a SEFAZ…', expect.stringMatching(/^✅ Feito às \d{2}:\d{2}\. A SEFAZ autorizou a nota nº 904\.$/)]);
        expect(auditados.filter((x) => x.entidadeTipo === 'mister_proposta').map((x) => [x.acao, x.tenantId, x.atorId])).toEqual([
          ['mister_proposta_autorizada', A, pessoa.ana],
          ['mister_proposta_executada', A, pessoa.ana],
          ['mister_proposta_feita', A, pessoa.ana],
        ]);
        // O segundo toque (ou o de outro aparelho) não executa de novo.
        numero.pedidos.length = 0;
        expect(await mandar(tel, 'Autorizar', { botaoId: `prop:${prop.id}:sim` })).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Essa pergunta já foi respondida.']);
        expect(consultas).toHaveLength(1);
        // A rotina não executa a que já fechou.
        await propostas.rotina();
        expect(consultas).toHaveLength(1);
      } finally {
        await q(`delete from nota_fiscal where tenant_id = $1`, [A]);
      }
    });

    it('a proposta: "Não agora" recusa; gerente não autoriza; telefone de outra empresa não acha; a vencida não executa; a recusa da SEFAZ vira "Não deu"', async () => {
      const telAna = telefone();
      const telCarlos = telefone();
      const telBia = telefone();
      await ligar('ana', telAna);
      await ligar('carlos', telCarlos, A, 'gerente');
      await ligar('anaB', telBia, B);
      await janelaAberta('ana');
      numero.pedidos.length = 0;
      avisos.incidentes = [];
      consultas.length = 0;
      try {
        await notaSemResposta(905);
        await notaSemResposta(906);
        await notaSemResposta(907);
        await notaSemResposta(908);
        await avisos.volta([A]);
        const porNota = async (n: number) => {
          const [a] = (await avisosDe()).filter((x: any) => String(x.titulo).includes(`nº ${n} `));
          return propostaDe(a.id);
        };
        const p905 = await porNota(905);
        const p906 = await porNota(906);
        const p907 = await porNota(907);
        const p908 = await porNota(908);

        // "Não agora": recusa, sem executar.
        numero.pedidos.length = 0;
        expect(await mandar(telAna, 'Não agora', { botaoId: `prop:${p905.id}:nao` })).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Certo, não faço nada. O aviso continua aberto no Regem.']);
        expect((await propostaDe(p905.aviso_id)).situacao).toBe('recusada');

        // O gerente não autoriza (até o perfil de permissões): a proposta segue esperando o presidente.
        numero.pedidos.length = 0;
        expect(await mandar(telCarlos, 'Autorizar', { botaoId: `prop:${p906.id}:sim` })).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Por enquanto, só o presidente da empresa autoriza por aqui. O aviso continua aberto no Regem.']);
        expect((await propostaDe(p906.aviso_id)).situacao).toBe('proposta');

        // O telefone de outra empresa não acha a proposta (nem sabe que ela existe).
        numero.pedidos.length = 0;
        expect(await mandar(telBia, 'Autorizar', { botaoId: `prop:${p906.id}:sim` })).toBe('proposta_nao_achada');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Não achei essa pergunta. Ela pode ter vencido.']);
        expect((await propostaDe(p906.aviso_id)).situacao).toBe('proposta');

        // Passou do prazo: o toque não executa, e a rotina a vence.
        await q(`update mister_proposta set vence_em = now() - interval '1 minute' where id = $1`, [p907.id]);
        numero.pedidos.length = 0;
        expect(await mandar(telAna, 'Autorizar', { botaoId: `prop:${p907.id}:sim` })).toBe('respondeu_proposta');
        expect(numero.enviadas[0].texto).toMatch(/^Essa pergunta valeu até as \d{2}:\d{2}\. Se o aviso continuar, a próxima vez traz outra\.$/);
        expect(await propostas.vencer()).toBeGreaterThanOrEqual(1);
        expect((await propostaDe(p907.aviso_id)).situacao).toBe('vencida');
        expect(consultas).toEqual([]);

        // A SEFAZ pede o intervalo entre consultas (a recusa vem com a frase pronta): "Não deu".
        respostaDaConsulta = async () => {
          throw new BadRequestException('Esta nota foi consultada há pouco. A SEFAZ limita consultas da mesma nota (rejeição 656), então a próxima pode ser feita em 3 minuto(s).');
        };
        numero.pedidos.length = 0;
        expect(await mandar(telAna, 'Autorizar', { botaoId: `prop:${p908.id}:sim` })).toBe('respondeu_proposta');
        expect(await esperarFechar(p908.id)).toBe('nao_deu');
        await esperarMensagens(2);
        expect(numero.enviadas.map((m) => m.texto)).toEqual([
          'Autorizado. Consultando a SEFAZ…',
          'Não deu: esta nota foi consultada há pouco. A SEFAZ limita consultas da mesma nota (rejeição 656), então a próxima pode ser feita em 3 minuto(s).',
        ]);
        // A SEFAZ sem resposta também é "Não deu".
        expect(consultas).toHaveLength(1);
      } finally {
        respostaDaConsulta = async () => ({ status: 'autorizada', numero: 904 });
        await q(`delete from nota_fiscal where tenant_id = $1`, [A]);
      }
    });

    it('a proposta: a impressora parada (quando vai ao presidente) pede a via de teste pelo servidor da loja; "feito" só com o servidor e a impressora respondendo', async () => {
      const tel = telefone();
      const telCarlos = telefone();
      await ligar('ana', tel);
      await ligar('carlos', telCarlos, A, 'gerente');
      await janelaAberta('ana');
      await janelaAberta('carlos');
      // A empresa manda a impressora parada ao presidente e ao gerente (o padrão é a tela da loja).
      await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'impressora', ligado: true, destinos: ['presidente', 'gerente'], escalaMin: null, escalaPara: [] }] });
      numero.pedidos.length = 0;
      try {
        avisos.incidentes = [incidente('impressora_parada', 'srv:1:impressora:9'), incidente('impressora_parada', 'srv:1:impressora:10')];
        expect(await avisos.volta([A])).toMatchObject({ abertos: 2 });
        const todos = await avisosDe();
        const do9 = await propostaDe(todos.find((a: any) => a.chave.endsWith(':impressora:9')).id);
        const do10 = await propostaDe(todos.find((a: any) => a.chave.endsWith(':impressora:10')).id);
        expect(do9).toMatchObject({ procedimento: 'imprimir_teste', situacao: 'proposta', parametros: { servidorId: '1', impressoraId: '9' } });
        // Só a presidente recebe a pergunta e os botões; o gerente recebe o aviso como sempre.
        expect(numero.enviadas.filter((m) => m.para === tel).map((m) => m.botoes.map((b) => b.titulo))).toEqual([
          ['Autorizar', 'Não agora'],
          ['Autorizar', 'Não agora'],
        ]);
        expect(numero.enviadas.filter((m) => m.para === telCarlos).map((m) => [m.botoes, m.texto.includes('Posso mandar')])).toEqual([
          [[], false],
          [[], false],
        ]);

        // Autorizada: o comando vai para o servidor da loja, como o "Imprimir teste" da tela.
        numero.pedidos.length = 0;
        expect(await mandar(tel, 'Autorizar', { botaoId: `prop:${do9.id}:sim` })).toBe('respondeu_proposta');
        for (let i = 0; i < 50 && !(await q(`select 1 from edge_comando where dados ->> 'propostaId' = $1`, [do9.id])).length; i++) await new Promise((r) => setTimeout(r, 30));
        const [cmd] = await q(`select comando, solicitado_por, unidade_id, dados, status from edge_comando where dados ->> 'propostaId' = $1`, [do9.id]);
        expect(cmd).toMatchObject({ comando: 'testar_impressora', solicitado_por: 'mister', unidade_id: lojaDeA, status: 'pendente', dados: { equipamentoId: '9', propostaId: do9.id } });
        expect((await propostaDe(do9.aviso_id)).situacao).toBe('executando');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Autorizado. Mandei a via de teste; confiro em alguns minutos.']);
        // O servidor pegou, mas a impressora ainda não respondeu: segue esperando.
        await q(`update edge_comando set status = 'executado', resultado = 'teste enfileirado em 1 impressora(s)' where dados ->> 'propostaId' = $1`, [do9.id]);
        expect(await propostas.conferir()).toBe(0);
        // A impressora 9 voltou: o aviso fecha e a conferência diz "feito".
        avisos.incidentes = [incidente('impressora_parada', 'srv:1:impressora:10')];
        expect(await avisos.volta([A])).toMatchObject({ resolvidos: 1 });
        numero.pedidos.length = 0;
        expect(await propostas.conferir()).toBe(1);
        expect(await propostaDe(do9.aviso_id)).toMatchObject({ situacao: 'feita', resultado: 'A impressora recebeu a via de teste e voltou a responder.' });
        expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringMatching(/^✅ Feito às \d{2}:\d{2}\. A impressora recebeu a via de teste e voltou a responder\.$/)]);

        // A 10: autorizada, mas o servidor da loja não pega no prazo — "Não deu", com o que conferir.
        expect(await mandar(tel, 'Autorizar', { botaoId: `prop:${do10.id}:sim` })).toBe('respondeu_proposta');
        for (let i = 0; i < 50 && (await propostaDe(do10.aviso_id)).situacao !== 'executando'; i++) await new Promise((r) => setTimeout(r, 30));
        await q(`update mister_proposta set conferir_ate = now() - interval '1 second' where id = $1`, [do10.id]);
        numero.pedidos.length = 0;
        expect(await propostas.conferir()).toBe(1);
        expect(await propostaDe(do10.aviso_id)).toMatchObject({ situacao: 'nao_deu' });
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Não deu: o servidor da loja não pegou o pedido. Confira se o computador do servidor está ligado e com internet.']);
      } finally {
        avisos.incidentes = [];
        await q(`delete from mister_aviso_regra where tenant_id = $1`, [A]);
        await q(`delete from edge_comando where tenant_id = $1 and solicitado_por = 'mister'`, [A]);
      }
    });

    it('F4.4: a impressora que parou de responder, com o servidor na versão nova, pede o reinício do serviço SÓ àquele servidor; "feito" só com o reinício e a impressora respondendo; a recusa, a versão velha e o prazo viram "Não deu"', async () => {
      const SRV = randomUUID();
      const tel = telefone();
      await ligar('ana', tel);
      await janelaAberta('ana');
      await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'impressora', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [] }] });
      // O servidor da loja (o do aviso) e a versão que ele informou — `edge_status` é da nuvem: no CI outras specs a criam com o mínimo.
      // Dois servidores na mesma loja (o principal e a reserva): o reinício vai só ao do aviso.
      const SRV2 = randomUUID();
      await q(`insert into equipamento (id, tenant_id, unidade_id, tipo, nome, token) values ($1, $2, $3, 'servidor_local', 'Servidor', $4)`, [SRV, A, lojaDeA, `srv-${MARCA}`]);
      await q(`insert into equipamento (id, tenant_id, unidade_id, tipo, nome, token) values ($1, $2, $3, 'servidor_local', 'Reserva', $4)`, [SRV2, A, lojaDeA, `srv2-${MARCA}`]);
      await pool
        .query(`create table if not exists edge_status (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
      await q(`alter table edge_status add column if not exists equipamento_id uuid`);
      await q(`alter table edge_status add column if not exists versao text`);
      await q(`delete from edge_status where tenant_id = $1`, [A]);
      await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, recebido_em) values ($1, $2, $3, '1.30.14', now())`, [SRV, A, lojaDeA]);
      const parada = (n: number, motivo: string) => incidente('impressora_parada', `srv:${SRV}:impressora:${n}`, { evidencia: { impressora: `Imp ${n}`, motivo } });
      const daImpressora = async (n: number) => propostaDe((await avisosDe()).find((a: any) => a.chave.endsWith(`:impressora:${n}`)).id);
      const comandoDe = async (id: string) => (await q(`select comando, equipamento_id, unidade_id, dados, status from edge_comando where dados ->> 'propostaId' = $1`, [id]))[0];
      const esperarComando = async (id: string) => {
        for (let i = 0; i < 100 && !(await comandoDe(id)); i++) await new Promise((r) => setTimeout(r, 30));
      };
      numero.pedidos.length = 0;
      try {
        avisos.incidentes = [parada(9, 'sem_responder'), parada(10, 'aviso'), parada(11, 'sem_responder'), parada(12, 'sem_responder'), parada(14, 'sem_responder')];
        expect(await avisos.volta([A])).toMatchObject({ abertos: 5 });
        // O motivo do vigia ficou no aviso; sem responder + versão nova = o reinício; com aviso (sem papel) = a via de teste.
        expect((await avisosDe()).find((a: any) => a.chave.endsWith(':impressora:10')).dados).toMatchObject({ motivo: 'aviso' });
        const p9 = await daImpressora(9);
        expect(p9).toMatchObject({ procedimento: 'reiniciar_impressao', situacao: 'proposta', nivel: 'botao', parametros: { servidorId: SRV, impressoraId: '9' } });
        expect((await daImpressora(10)).procedimento).toBe('imprimir_teste');
        expect(numero.enviadas.filter((m) => m.texto.includes('Posso reiniciar o serviço de impressão do servidor da loja?'))).toHaveLength(4);
        expect(numero.enviadas.filter((m) => m.texto.includes('Posso mandar uma via de teste'))).toHaveLength(1);
        // Com o servidor na versão velha, a impressora que parar agora pede a via de teste.
        await q(`update edge_status set versao = '1.30.13' where equipamento_id = $1`, [SRV]);
        avisos.incidentes = [...avisos.incidentes, parada(13, 'sem_responder')];
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1 });
        expect((await daImpressora(13)).procedimento).toBe('imprimir_teste');

        // Autorizada: o comando vai SÓ ao servidor do aviso.
        numero.pedidos.length = 0;
        expect(await mandar(tel, 'Autorizar', { botaoId: `prop:${p9.id}:sim` })).toBe('respondeu_proposta');
        await esperarComando(p9.id);
        expect(await comandoDe(p9.id)).toMatchObject({ comando: 'reiniciar_impressao', equipamento_id: SRV, unidade_id: lojaDeA, status: 'pendente', dados: { propostaId: p9.id } });
        expect(await q(`select equipamento_id from edge_comando where dados ->> 'propostaId' = $1`, [p9.id])).toHaveLength(1);
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Autorizado. Pedi ao servidor da loja para reiniciar o serviço de impressão; confiro em alguns minutos.']);
        // O servidor reiniciou, mas a impressora ainda não respondeu: segue esperando.
        await q(`update edge_comando set status = 'executado', resultado = 'serviço de impressão reiniciado', executado_em = now() where dados ->> 'propostaId' = $1`, [p9.id]);
        expect(await propostas.conferir()).toBe(0);
        // A 9 voltou: "feito".
        avisos.incidentes = avisos.incidentes.filter((i: any) => !i.chave.endsWith(':impressora:9'));
        expect(await avisos.volta([A])).toMatchObject({ resolvidos: 1 });
        numero.pedidos.length = 0;
        expect(await propostas.conferir()).toBe(1);
        expect(await daImpressora(9)).toMatchObject({ situacao: 'feita', resultado: 'O serviço de impressão reiniciou e a impressora voltou a responder.' });
        expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringMatching(/^✅ Feito às \d{2}:\d{2}\. O serviço de impressão reiniciou e a impressora voltou a responder\.$/)]);

        // A 11: o Windows recusou — "Não deu" na hora, com o que o servidor disse.
        const p11 = await daImpressora(11);
        await mandar(tel, 'Autorizar', { botaoId: `prop:${p11.id}:sim` });
        await esperarComando(p11.id);
        await q(`update edge_comando set status = 'erro', resultado = 'o Windows recusou o reinício (Acesso negado)', executado_em = now() where dados ->> 'propostaId' = $1`, [p11.id]);
        numero.pedidos.length = 0;
        expect(await propostas.conferir()).toBe(1);
        expect(numero.enviadas.map((m) => m.texto)).toEqual([
          'Não deu: o servidor da loja não conseguiu reiniciar o serviço de impressão — o Windows recusou o reinício (Acesso negado). Reinicie o computador do servidor; se continuar, fale com o suporte.',
        ]);
        // A 12: o servidor ainda não conhecia o comando ("ignorado") — "Não deu" na hora.
        const p12 = await daImpressora(12);
        await mandar(tel, 'Autorizar', { botaoId: `prop:${p12.id}:sim` });
        await esperarComando(p12.id);
        await q(`update edge_comando set status = 'executado', resultado = 'ignorado', executado_em = now() where dados ->> 'propostaId' = $1`, [p12.id]);
        expect(await propostas.conferir()).toBe(1);
        expect(await daImpressora(12)).toMatchObject({ situacao: 'nao_deu', resultado: expect.stringContaining('ainda não sabe reiniciar a impressão por aqui') });
        // A 14: o servidor não pegou no prazo.
        const p14 = await daImpressora(14);
        await mandar(tel, 'Autorizar', { botaoId: `prop:${p14.id}:sim` });
        await esperarComando(p14.id);
        expect(await propostas.conferir()).toBe(0);
        await q(`update mister_proposta set conferir_ate = now() - interval '1 second' where id = $1`, [p14.id]);
        expect(await propostas.conferir()).toBe(1);
        expect(await daImpressora(14)).toMatchObject({ situacao: 'nao_deu', resultado: expect.stringContaining('não pegou o pedido') });
      } finally {
        avisos.incidentes = [];
        await q(`delete from mister_aviso_regra where tenant_id = $1`, [A]);
        await q(`delete from edge_comando where tenant_id = $1 and solicitado_por = 'mister'`, [A]);
        await q(`delete from edge_status where tenant_id = $1`, [A]);
        await q(`delete from equipamento where id = any($1::uuid[])`, [[SRV, SRV2]]);
      }
    });

    // ───────────────────────────── os avisos, parte 2: o canal desconectado ─────────────────────────────

    it('a saúde do iFood no banco: marca uma vez (o "desde" fica), limpa, e nunca mexe nas outras chaves do config (V82)', async () => {
      const [{ id }] = await q(
        `insert into integracao (tenant_id, canal, ativo, merchant_id, config) values ($1, 'ifood', true, 'm-1', '{"tokenExp": 123, "avaliacoes": true}')
         on conflict (tenant_id, canal) do update set ativo = true, config = excluded.config returning id`,
        [A],
      );
      const config = async () => (await q(`select config from integracao where id = $1`, [id]))[0].config;
      try {
        const t0 = Date.parse('2026-11-14T15:00:00Z');
        await new IfoodService(db).anotarSaude(id, true, 'http_401', t0);
        // Outro processo (outra réplica, ou depois de reiniciar) marca de novo: o "desde" de antes fica.
        await new IfoodService(db).anotarSaude(id, true, 'sem_resposta', t0 + 120_000);
        expect(await config()).toEqual({ tokenExp: 123, avaliacoes: true, semRespostaDesde: new Date(t0).toISOString(), semRespostaMotivo: 'http_401' });
        // Enquanto isso, outra rotina grava a SUA chave: a marca não apaga a dela, nem ela a marca.
        await q(`update integracao set config = config || '{"tokenExp": 456}' where id = $1`, [id]);
        await new IfoodService(db).anotarSaude(id, false, null, t0 + 240_000);
        expect(await config()).toEqual({ tokenExp: 456, avaliacoes: true });
      } finally {
        await q(`delete from integracao where tenant_id = $1 and canal = 'ifood'`, [A]);
      }
    });

    it('o canal desconectado: o iFood sem responder há mais de 5 min e a 99 com o login recusado avisam; voltou, resolve', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      await janelaAberta('ana');
      numero.pedidos.length = 0;
      avisos.incidentes = [];
      const agora = new Date();
      const [{ id: ifood }] = await q(
        `insert into integracao (tenant_id, unidade_id, canal, ativo, merchant_id, config) values ($1, $2, 'ifood', true, 'm-1', jsonb_build_object('semRespostaDesde', $3::text, 'semRespostaMotivo', 'http_401'))
         on conflict (tenant_id, canal) do update set ativo = true, unidade_id = excluded.unidade_id, config = excluded.config returning id`,
        [A, lojaDeA, new Date(agora.getTime() - 3 * 60_000).toISOString()],
      );
      try {
        // Há 3 minutos: falha passageira, nada ainda.
        expect(await avisos.volta([A], agora)).toMatchObject({ abertos: 0 });
        // Há 6 minutos: abre (o padrão: o gerente — sem gerente ligado, vai ao presidente — e a tela da loja).
        await q(`update integracao set config = config || jsonb_build_object('semRespostaDesde', $2::text) where id = $1`, [ifood, new Date(agora.getTime() - 6 * 60_000).toISOString()]);
        expect(await avisos.volta([A], agora)).toMatchObject({ abertos: 1 });
        const [aviso] = await avisosDe();
        expect(aviso).toMatchObject({ tipo: 'canal_desconectado', unidade_id: lojaDeA, chave: `canal:ifood:${ifood}` });
        expect(aviso.titulo).toMatch(/^Loja Centro · pedidos do iFood sem chegar ao Regem desde \d{2}\/\d{2} às \d{2}:\d{2}$/);
        expect(aviso.detalhe).toMatch(/^Há 6 min o iFood recusou o acesso do Regem\./);
        expect(numero.enviadas).toEqual([{ para: tel, texto: expect.stringContaining('pedidos do iFood sem chegar ao Regem'), botoes: [] }]);
        expect(aviso.entregas.map((e: any) => [e.destino, e.ok, e.motivo ?? null])).toEqual(
          expect.arrayContaining([
            ['gerente', true, 'sem_gerente_ligado_foi_ao_presidente'],
            ['tela', true, null],
          ]),
        );
        // A 99: o -1 (rede) não é recusa; o código de recusa avisa.
        await q(
          `insert into integracao (tenant_id, canal, ativo, config) values ($1, '99food', true, '{"lastAuthErrno": -1}')
           on conflict (tenant_id, canal) do update set ativo = true, config = excluded.config`,
          [A],
        );
        expect(await avisos.volta([A], agora)).toMatchObject({ abertos: 0 });
        await q(`update integracao set config = config || '{"lastAuthErrno": 10101}' where tenant_id = $1 and canal = '99food'`, [A]);
        expect(await avisos.volta([A], agora)).toMatchObject({ abertos: 1 });
        expect((await avisosDe()).map((a: any) => a.titulo)).toContain(`${NOME_A} · a 99 recusou o login do Regem`);
        // Voltaram: o iFood respondeu (a marca sai) e a 99 logou (o código volta a nulo). Os dois resolvem.
        await new IfoodService(db).anotarSaude(ifood, false);
        await q(`update integracao set config = config || '{"lastAuthErrno": null}' where tenant_id = $1 and canal = '99food'`, [A]);
        expect(await avisos.volta([A], agora)).toMatchObject({ resolvidos: 2 });
        // Integração desligada pela loja não avisa.
        await q(`update integracao set ativo = false, config = config || '{"lastAuthErrno": 10101}' where tenant_id = $1 and canal = '99food'`, [A]);
        expect(await avisos.volta([A], agora)).toMatchObject({ abertos: 0 });
      } finally {
        await q(`delete from integracao where tenant_id = $1 and canal in ('ifood', '99food')`, [A]);
      }
    });

    it('o chat do iFood sem resposta (a ponte sem login): só abre com pedido em andamento; aberto, segue até alguém responder; diz onde clicar', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      await janelaAberta('ana');
      numero.pedidos.length = 0;
      numero.enviadas.length = 0;
      avisos.incidentes = [];
      const chat = { tenantId: A, unidadeId: lojaDeA, loja: 'Loja Centro', motivo: 'sem_login' as const, ponte: 'Servidor com ponte', maquina: 'DESKTOP-SERVIDOR', pedidos: 0 };
      try {
        // Sem pedido do iFood em andamento (a loja fechada, a ponte desligada de madrugada): não incomoda ninguém.
        avisos.chats = [chat];
        expect(await avisos.volta([A])).toMatchObject({ situacoes: 0, abertos: 0 });
        // Com pedido em andamento: abre, no tipo do canal desconectado (o padrão: o gerente e a tela da loja).
        avisos.chats = [{ ...chat, pedidos: 3 }];
        expect(await avisos.volta([A])).toMatchObject({ situacoes: 1, abertos: 1 });
        const aviso = (await avisosDe()).find((a: any) => a.chave === `chat:ifood:${lojaDeA}`);
        expect(aviso).toMatchObject({
          tipo: 'canal_desconectado',
          unidade_id: lojaDeA,
          titulo: 'Loja Centro · chat do iFood sem resposta: a ponte do chat "Servidor com ponte" está sem login no iFood',
        });
        expect(aviso.detalhe).toBe(
          'No computador da ponte (DESKTOP-SERVIDOR), clique no ícone "Regem · Ponte do chat", perto do relógio, depois em "Abrir o Gestor do iFood", ' +
            'e entre com o login da loja nessa janela (o login feito em outro navegador não vale). Até lá, responda os clientes pelo Gestor de Pedidos do iFood. ' +
            'Há 3 pedidos do iFood em andamento.',
        );
        expect(numero.enviadas).toEqual([{ para: tel, texto: expect.stringContaining('chat do iFood sem resposta'), botoes: [] }]);
        expect(aviso.entregas.map((e: any) => [e.destino, e.ok])).toEqual(expect.arrayContaining([['gerente', true], ['tela', true]]));
        // Os pedidos acabaram e o chat segue sem resposta: o aviso continua aberto (não "resolve" sozinho), sem abrir outro.
        avisos.chats = [chat];
        expect(await avisos.volta([A])).toMatchObject({ situacoes: 1, abertos: 0, resolvidos: 0 });
        // Alguém entrou com o login na ponte: a loja some da leitura e o aviso resolve.
        avisos.chats = [];
        expect(await avisos.volta([A])).toMatchObject({ resolvidos: 1 });
        // No banco de verdade deste teste as tabelas da ponte (mig 366) podem não existir: a leitura devolve nada, sem erro.
        avisos.chats = null;
        expect((await avisos.situacoes([A])).filter((s) => s.chave.startsWith('chat:ifood:'))).toEqual([]);
      } finally {
        avisos.chats = [];
        await q(`delete from mister_aviso where tenant_id = $1 and chave like 'chat:ifood:%'`, [A]);
      }
    });

    it('a conciliação: o cancelado com a venda de pé, o concluído sem pagamento, a venda desfeita com nota e a nota recusada; cada parte com a permissão da tela, os valores só para quem vê, e nada de outra empresa', async () => {
      const telAna = telefone();
      const telCarlos = telefone();
      await ligar('ana', telAna);
      await ligar('carlos', telCarlos, A, 'gerente');
      const numeroDaNota = () => randomInt(100000, 999999);
      const comanda = async (status: string, total: number, tenant = A) => {
        const [{ id }] = await q(
          `insert into comanda (tenant_id, unidade_id, status, total, forma, aberta_em, fechada_em, cancelada_em)
           values ($1, $2, $3, $4, 'dinheiro', now() - interval '1 hour',
                   case when $3 in ('fechada', 'cancelada') then now() - interval '30 minutes' end,
                   case when $3 = 'cancelada' then now() - interval '20 minutes' end) returning id`,
          [tenant, tenant === A ? lojaDeA : null, status, total],
        );
        return id as string;
      };
      const pedido = async (o: { status: string; numero: number; comanda?: string | null; pago?: boolean; tenant?: string; valor?: number }) =>
        q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, status, tipo, total, valor_bruto, taxa_entrega, taxa_entrega_dono, display_id, numero,
                                       comanda_id, pago, status_pagamento, forma_pagamento, criado_em, cancelado_em, concluido_em)
           values ($1, $2, 'anotaai', $3, 'entrega', $4, $4, 0, 'loja', $5, $6, $7, $8, 'na_entrega', 'Dinheiro', now() - interval '2 hours',
                   case when $3 = 'cancelado' then now() - interval '20 minutes' end, case when $3 = 'concluido' then now() - interval '15 minutes' end)`,
          [o.tenant ?? A, (o.tenant ?? A) === A ? lojaDeA : null, o.status, o.valor ?? 40, String(7000 + o.numero), o.numero, o.comanda ?? null, o.pago ?? false],
        );
      const nota = async (comandaId: string, status: string, o: { simulada?: boolean; haMin?: number; tenant?: string } = {}) =>
        q(
          `insert into nota_fiscal (tenant_id, unidade_id, comanda_id, modelo, serie, numero, ambiente, status, simulada, motivo, valor_total, created_at)
           values ($1, $2, $3, '65', 7, $4, '2', $5, $6, $7, 40, now() - make_interval(mins => $8))`,
          [o.tenant ?? A, (o.tenant ?? A) === A ? lojaDeA : null, comandaId, numeroDaNota(), status, o.simulada ?? false, status === 'rejeitada' ? 'Rejeição: CNPJ do emitente inválido' : null, o.haMin ?? 30],
        );
      try {
        // 2) O cancelado com a venda de pé (e o cancelado com a venda desfeita, que fecha).
        await pedido({ status: 'cancelado', numero: 201, comanda: await comanda('fechada', 40), valor: 40 });
        await pedido({ status: 'cancelado', numero: 202, comanda: await comanda('cancelada', 40) });
        // 3) O concluído sem pagamento registrado (e o concluído pago, que fecha).
        await pedido({ status: 'concluido', numero: 203, valor: 55.5 });
        await pedido({ status: 'concluido', numero: 204, pago: true });
        // 4) A venda desfeita com a nota autorizada (a simulada não conta).
        await nota(await comanda('cancelada', 30), 'autorizada');
        await nota(await comanda('cancelada', 30), 'autorizada', { simulada: true });
        // 5) A nota recusada sem nota válida; a recusada com outra autorizada depois e a pendente de agora não contam.
        await nota(await comanda('fechada', 25), 'rejeitada');
        const corrigida = await comanda('fechada', 25);
        await nota(corrigida, 'rejeitada', { haMin: 40 });
        await nota(corrigida, 'autorizada', { haMin: 35 });
        // A autorizada com uma tentativa recusada DEPOIS também não conta: a venda tem nota válida.
        const jaTinha = await comanda('fechada', 25);
        await nota(jaTinha, 'autorizada', { haMin: 40 });
        await nota(jaTinha, 'rejeitada', { haMin: 35 });
        await nota(await comanda('fechada', 25), 'pendente', { haMin: 2 });
        await nota(await comanda('fechada', 25), 'pendente', { haMin: 30 });
        // A outra empresa tem os mesmos casos: nada dela entra.
        await pedido({ tenant: B, status: 'concluido', numero: 205 });
        await nota(await comanda('cancelada', 30, B), 'autorizada', { tenant: B });

        const daAna = (await ferramentas.escopo(A, pessoa.ana, telAna))!;
        // De ontem a hoje: os casos de 15 a 30 min atrás ficam dentro mesmo perto da meia-noite.
        const hoje = hojeISO();
        const periodo = { de: somarDias(hoje, -1), ate: hoje };
        const r = await ferramentas.executar(daAna, 'conciliacao_do_periodo', periodo);
        expect(r.ok).toBe(true);
        expect(r.dados).toMatchObject({
          periodo: expect.any(String),
          pedidoCanceladoComAVendaDePe: { quantos: 1, valor: 40, casos: [{ comoAparece: '#201 · Anota Aí 7201', valor: 40 }] },
          pedidoConcluidoSemPagamentoRegistrado: { quantos: 1, valor: 55.5, porCanal: { 'Anota Aí': 1 }, casos: [{ comoAparece: '#203 · Anota Aí 7203', forma: 'Dinheiro' }] },
          vendaDesfeitaComNotaAutorizada: { quantos: 1, valor: 40, casos: [{ ambiente: 'homologação (teste)', pedido: null }] },
          vendaComNotaComProblema: { quantos: 2 },
        });
        expect((r.dados.pedidoConcluidoSemPagamentoRegistrado as any).comoLer).toContain('não diga que o cliente não pagou');
        const situacoes = ((r.dados.vendaComNotaComProblema as any).casos as any[]).map((c) => [c.situacao, c.motivoDaSefaz]).sort();
        expect(situacoes).toEqual([
          ['recusada pela SEFAZ', 'Rejeição: CNPJ do emitente inválido'],
          ['sem resposta da SEFAZ', null],
        ]);
        // O Pix: a tabela do estorno é só da nuvem — com ela, nada aqui; sem ela, "não li" (nunca zero inventado).
        const temEstorno = (await q(`select to_regclass(current_schema() || '.pedido_estorno') is not null as tem`))[0].tem;
        expect(r.dados.pixPagoEmPedidoCanceladoSemEstorno).toEqual(temEstorno ? expect.objectContaining({ quantos: 0 }) : { erro: 'Não consegui ler esta parte agora.' });

        // O gerente no perfil padrão: vê os pedidos (Delivery), sem valores; as notas (Notas fiscais) não.
        const doCarlos = (await ferramentas.escopo(A, pessoa.carlos, telCarlos))!;
        const g = await ferramentas.executar(doCarlos, 'conciliacao_do_periodo', periodo);
        expect(g.dados).toMatchObject({
          pedidoConcluidoSemPagamentoRegistrado: { quantos: 1, valor: null, casos: [{ valor: null }] },
          vendaDesfeitaComNotaAutorizada: { aviso: expect.stringContaining('não dá acesso') },
          vendaComNotaComProblema: { aviso: expect.stringContaining('não dá acesso') },
        });
        // Outro período: nada (o período é pelo momento de cada fato).
        const antigo = await ferramentas.executar(daAna, 'conciliacao_do_periodo', { de: somarDias(hoje, -30), ate: somarDias(hoje, -20) });
        expect(antigo.dados).toMatchObject({ pedidoConcluidoSemPagamentoRegistrado: { quantos: 0 }, vendaComNotaComProblema: { quantos: 0 }, pedidoCanceladoComAVendaDePe: { quantos: 0 } });
      } finally {
        await q(`delete from nota_fiscal where tenant_id = any($1::uuid[])`, [[A, B]]);
        await q(`delete from pedido_externo where tenant_id = any($1::uuid[])`, [[A, B]]);
        await q(`delete from comanda where tenant_id = any($1::uuid[])`, [[A, B]]);
      }
    });

    it('o pedido parado: desligado não avisa; ligado, as três etapas pelo tempo escolhido; a encomenda, a retirada pronta, o pedido velho e a loja com o servidor sem sinal não abrem; o aberto só resolve quando o pedido anda', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      await janelaAberta('ana');
      avisos.incidentes = [];
      const pedido = async (o: { numero: number; status: string; tipo?: string; criado: string; confirmado?: string; pronto?: string; agendamento?: string }) => {
        const [{ id }] = await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, status, tipo, total, valor_bruto, taxa_entrega, taxa_entrega_dono, display_id, numero,
                                       criado_em, confirmado_em, pronto_em, agendamento)
           values ($1, $2, 'ifood', $3, $4, 30, 30, 0, 'marketplace', $5, $6,
                   now() - $7::interval, now() - $8::interval, now() - $9::interval, now() + $10::interval) returning id`,
          [A, lojaDeA, o.status, o.tipo ?? 'entrega', String(9000 + o.numero), o.numero, o.criado, o.confirmado ?? null, o.pronto ?? null, o.agendamento ?? null],
        );
        return id as string;
      };
      try {
        const p1 = await pedido({ numero: 101, status: 'novo', criado: '25 minutes' });
        await pedido({ numero: 102, status: 'novo', criado: '10 minutes' });
        const p3 = await pedido({ numero: 103, status: 'confirmado', criado: '40 minutes', confirmado: '25 minutes' });
        await pedido({ numero: 104, status: 'confirmado', criado: '40 minutes', confirmado: '10 minutes' });
        const p5 = await pedido({ numero: 105, status: 'pronto', criado: '60 minutes', confirmado: '50 minutes', pronto: '25 minutes' });
        await pedido({ numero: 106, status: 'pronto', tipo: 'retirada', criado: '60 minutes', confirmado: '50 minutes', pronto: '25 minutes' });
        await pedido({ numero: 107, status: 'novo', criado: '7 hours' });
        // A encomenda aceita há 2 horas, para daqui a 40 min: começa a contar 30 min antes do horário (daqui a 10 min).
        await pedido({ numero: 108, status: 'confirmado', criado: '2 hours', confirmado: '2 hours', agendamento: '40 minutes' });
        await pedido({ numero: 109, status: 'despachado', criado: '90 minutes', confirmado: '80 minutes', pronto: '70 minutes' });

        // Desligado (o padrão): nada.
        numero.pedidos.length = 0;
        expect(await avisos.volta([A])).toMatchObject({ abertos: 0 });
        expect(await avisosDe()).toEqual([]);

        // Ligado, 20 min, para o presidente: as três etapas abrem, uma por pedido.
        await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'pedido_parado', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: 20 }] });
        expect(await avisos.volta([A])).toMatchObject({ abertos: 3 });
        const titulos = (await avisosDe()).map((a: any) => a.titulo).sort();
        expect(titulos).toEqual([
          'Loja Centro · pedido #101 · iFood 9101 sem aceite há mais de 20 min',
          'Loja Centro · pedido #103 · iFood 9103 aceito há mais de 20 min e ainda não ficou pronto',
          'Loja Centro · pedido #105 · iFood 9105 pronto há mais de 20 min sem sair para a entrega',
        ]);
        expect(numero.enviadas.map((m) => m.texto)).toEqual(expect.arrayContaining([expect.stringContaining('#101 · iFood 9101 sem aceite')]));
        expect(numero.enviadas).toHaveLength(3);
        // Com 30 min, o de 25 min não abriria; os já abertos seguem (o pedido não andou).
        await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'pedido_parado', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: 30 }] });
        expect(await avisos.volta([A])).toMatchObject({ abertos: 0, resolvidos: 0 });
        // O título fica com o tempo com que o aviso abriu.
        expect((await avisosDe()).map((a: any) => a.titulo).sort()).toEqual(titulos);
        await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'pedido_parado', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: 20 }] });

        // O #101 foi aceito agora: o aviso de "sem aceite" resolve (com o desfecho) e nenhum outro abre (aceito há 0 min).
        numero.pedidos.length = 0;
        await q(`update pedido_externo set status = 'confirmado', confirmado_em = now() where id = $1`, [p1]);
        expect(await avisos.volta([A])).toMatchObject({ abertos: 0, resolvidos: 1 });
        expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringMatching(/^✅ Resolvido: Loja Centro · pedido #101 · iFood 9101 sem aceite há mais de 20 min\. Durou \d+ min\.$/)]);

        // O servidor da loja ficou sem sinal: os abertos NÃO resolvem (a situação na nuvem está velha) e nada novo abre.
        await pool
          .query(`create table if not exists edge_status (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
          .catch((e: any) => {
            if (!['23505', '42P07'].includes(e?.code)) throw e;
          });
        // `edge_status` é só da nuvem: no banco do CI outras specs a criam com o mínimo (e a da nuvem tem o servidor como chave).
        await q(`alter table edge_status add column if not exists equipamento_id uuid`);
        await q(`delete from edge_status where tenant_id = $1`, [A]);
        await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, recebido_em) values (gen_random_uuid(), $1, $2, now() - interval '10 minutes')`, [A, lojaDeA]);
        const p10 = await pedido({ numero: 110, status: 'novo', criado: '25 minutes' });
        expect(await avisos.volta([A])).toMatchObject({ abertos: 0, resolvidos: 0 });
        // O servidor voltou: o #110 abre.
        await q(`update edge_status set recebido_em = now() where tenant_id = $1`, [A]);
        expect(await avisos.volta([A])).toMatchObject({ abertos: 1 });
        expect((await avisosDe()).find((a: any) => a.situacao === 'aberto' && a.titulo.includes('#110'))).toBeTruthy();

        // Passou das 6 horas sem andar: o aviso aberto continua (não manda "resolvido" de um pedido parado).
        await q(`update pedido_externo set criado_em = now() - interval '7 hours', confirmado_em = now() - interval '7 hours' where id = $1`, [p3]);
        expect(await avisos.volta([A])).toMatchObject({ resolvidos: 0 });
        // O #105 saiu para a entrega e o #103 foi cancelado: os dois resolvem; o #110 segue aberto.
        await q(`update pedido_externo set status = 'despachado', despachado_em = now() where id = $1`, [p5]);
        await q(`update pedido_externo set status = 'cancelado', cancelado_em = now() where id = $1`, [p3]);
        expect(await avisos.volta([A])).toMatchObject({ resolvidos: 2 });
        // Desligar com o #110 parado: fecha calado, sem desfecho.
        numero.pedidos.length = 0;
        await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'pedido_parado', ligado: false, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: 20 }] });
        expect(await avisos.volta([A])).toMatchObject({ calados: 1, resolvidos: 0 });
        expect(numero.enviadas).toEqual([]);
        expect(p10).toBeTruthy();
      } finally {
        await q(`delete from pedido_externo where tenant_id = $1`, [A]);
        await q(`delete from edge_status where tenant_id = $1`, [A]).catch(() => undefined);
      }
    });

    // ───────────────────────────── F4.3: a pergunta que vira proposta ─────────────────────────────

    it('F4.3: a IA pede o procedimento, o servidor acha o aviso aberto; sai a resposta e DEPOIS a proposta com os botões; o gerente não autoriza; sem aviso, nada', async () => {
      comIa();
      // As ferramentas com o serviço das propostas (o mesmo da F4.1) — as de cima não o montam.
      const ferramentasComPropostas = new MisterFerramentasService(
        db,
        modulos,
        new DashboardService(db),
        new RelatoriosService(db, { custoEfetivoMapa: async () => ({}) } as any),
        new EstoqueService(db, auditoria as AuditoriaService),
        deliveryDeMentira as any,
        cozinhaDeMentira as any,
        servidorDeMentira as any,
        vendasDeMentira as any,
        escalaDeMentira as any,
        pontoDeMentira as any,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        propostas,
      );
      const agenteComPropostas = new MisterAgenteService(fila, ferramentasComPropostas, ia, numero);
      const tel = telefone();
      const telCarlos = telefone();
      await ligar('ana', tel);
      await ligar('carlos', telCarlos, A, 'gerente');
      await janelaAberta('ana');
      await janelaAberta('carlos');
      const contarPropostas = async () => Number((await q(`select count(*)::int as n from mister_proposta where tenant_id = $1`, [A]))[0].n);

      // Sem aviso aberto: a ferramenta diz que não há o que propor; nenhuma proposta nasce; só a resposta sai.
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'testa a impressora da cozinha?')).toBe('pergunta');
      ia.roteiro = [usar('propor_procedimento', { procedimento: 'imprimir_teste' }, 'toolu_p0'), falar('Não há aviso aberto de impressora agora.')];
      expect(await agenteComPropostas.esvaziar()).toBe(1);
      expect(JSON.stringify(ia.pedidos.at(-1))).toContain('Não há aviso aberto que este procedimento resolva nesta loja.');
      expect(await contarPropostas()).toBe(0);
      expect(numero.enviadas.map((m) => [m.para, m.texto, m.botoes.length])).toEqual([[tel, 'Não há aviso aberto de impressora agora.', 0]]);

      // Com o aviso da impressora aberto: a proposta nasce presa a ele; a resposta sai e, depois, a pergunta com os botões.
      const [aviso] = await q(
        `insert into mister_aviso (tenant_id, unidade_id, tipo, chave, titulo) values ($1, null, 'impressora', 'vigia:impressora_parada:srv:1:impressora:9', 'Loja Centro · impressora Cozinha parada') returning id::text as id`,
        [A],
      );
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'manda uma via de teste nela')).toBe('pergunta');
      ia.roteiro = [usar('propor_procedimento', { procedimento: 'imprimir_teste' }, 'toolu_p1'), falar('A proposta vai logo abaixo, com os botões.')];
      expect(await agenteComPropostas.esvaziar()).toBe(1);
      const p = await propostaDe(aviso.id);
      expect(p).toMatchObject({ procedimento: 'imprimir_teste', situacao: 'proposta', nivel: 'botao', parametros: { servidorId: '1', impressoraId: '9' } });
      // O que foi ao modelo NÃO leva o id da proposta (só "vai em seguida" e o título do aviso).
      const aoModelo = JSON.stringify(ia.pedidos.at(-1));
      expect(aoModelo).toContain('vai em seguida, com os botões Autorizar e Não agora');
      expect(aoModelo).not.toContain(p.id);
      expect(numero.enviadas.map((m) => [m.para, m.botoes.map((b) => b.titulo)])).toEqual([
        [tel, []],
        [tel, ['Autorizar', 'Não agora']],
      ]);
      expect(numero.enviadas[0].texto).toBe('A proposta vai logo abaixo, com os botões.');
      expect(numero.enviadas[1].botoes.every((b) => b.id.startsWith('prop:') && b.id.includes(p.id))).toBe(true);

      // Pedida de novo enquanto pendente: a MESMA proposta (não duplica), os botões vão de novo.
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'manda de novo a proposta')).toBe('pergunta');
      ia.roteiro = [usar('propor_procedimento', { procedimento: 'imprimir_teste' }), falar('Vai abaixo de novo.')];
      expect(await agenteComPropostas.esvaziar()).toBe(1);
      expect(await contarPropostas()).toBe(1);
      expect(numero.enviadas.map((m) => m.botoes.length)).toEqual([0, 2]);

      // O gerente pede: a ferramenta recusa (só o presidente autoriza); nada de botão para ele; nenhuma proposta nova.
      numero.pedidos.length = 0;
      expect(await mandar(telCarlos, 'testa a impressora?')).toBe('pergunta');
      ia.roteiro = [usar('propor_procedimento', { procedimento: 'imprimir_teste' }), falar('Só o presidente autoriza.')];
      expect(await agenteComPropostas.esvaziar()).toBe(1);
      expect(JSON.stringify(ia.pedidos.at(-1))).toContain('Só o presidente autoriza um procedimento do Mister');
      expect(numero.enviadas.map((m) => [m.para, m.botoes.length])).toEqual([[telCarlos, 0]]);
      expect(await contarPropostas()).toBe(1);

      // A proposta já respondida ("Não agora"): pedir de novo não cria outra nem manda botão.
      await q(`update mister_proposta set situacao = 'recusada', respondida_em = now(), concluida_em = now() where id = $1`, [p.id]);
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'testa a impressora de novo')).toBe('pergunta');
      ia.roteiro = [usar('propor_procedimento', { procedimento: 'imprimir_teste' }), falar('Essa proposta já foi respondida.')];
      expect(await agenteComPropostas.esvaziar()).toBe(1);
      expect(JSON.stringify(ia.pedidos.at(-1))).toContain('já foi respondida');
      expect(numero.enviadas.map((m) => m.botoes.length)).toEqual([0]);
      expect(await contarPropostas()).toBe(1);
      // Procedimento fora do catálogo: recusa.
      const escopo = await ferramentasComPropostas.escopo(A, pessoa.ana, tel);
      expect(await ferramentasComPropostas.executar(escopo!, 'propor_procedimento', { procedimento: 'apagar_tudo' })).toEqual({ ok: false, dados: { erro: 'Esse procedimento não está no catálogo.' } });
      // F4.2b: o cancelamento está no catálogo, mas sem o número do pedido não propõe.
      expect(await ferramentasComPropostas.executar(escopo!, 'propor_procedimento', { procedimento: 'cancelar_pedido' })).toEqual({ ok: false, dados: { erro: 'Diga o número do pedido como aparece no painel do Delivery.' } });
    });

    // ───────────────────────────── o link com PIN (F4.2a, mig 433) ─────────────────────────────

    it('F4.2a: o link com PIN — vale uma vez, só o resumo fica no banco, 5 PIN errados bloqueiam (nem em paralelo passa de 5), o novo envio derruba o anterior, a régua de acesso da conversa e o botão não autoriza', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      await modulo(A, true);
      const PIN = '2580';
      await q(`update colaborador set pin_hash = $2 where id = $1`, [pessoa.ana, bcrypt.hashSync(PIN, 4)]);
      // O serviço com o módulo (o da montagem não o recebe): é o que a página usa.
      const links = new MisterPropostasService(db, numero, entrada, fiscalDeMentira as any, auditoria, modulos);
      const seguranca = new MisterSegurancaService(db);
      const bloqueadosAntes = (await seguranca.resumo(7)).linksComPin.bloqueados;
      const novaProposta = async (nivel = 'pin', prazo = "interval '15 minutes'") =>
        (
          await q(
            `insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, vence_em)
             values ($1, null, $2, 'cancelar_pedido', '{}'::jsonb, $3, now() + ${prazo}) returning id`,
            [A, randomUUID(), nivel],
          )
        )[0].id as string;
      const codigoDe = (url: string | null) => /\/m\/([A-Za-z0-9_-]{32})$/.exec(String(url))?.[1] ?? '';
      const linhaDe = async (id: string) => (await q(`select * from mister_proposta where id = $1`, [id]))[0];
      const acoes = (id: string) => auditados.filter((a) => a.entidadeId === id).map((a) => [a.acao, a.origem]);
      const naoVale = async (p: Promise<unknown>) => {
        await expect(p).rejects.toBeInstanceOf(NotFoundException);
        await expect(p).rejects.toThrow('Este link não vale. Peça de novo ao Mister.');
      };
      auditados.length = 0;
      numero.pedidos.length = 0;

      // ── O envio: o código novo vai no botão "Abrir no Regem", no formato da documentação da Meta; o banco guarda só o resumo.
      const p1 = await novaProposta();
      expect(await links.enviarLink(await novaProposta('botao'), pessoa.ana, tel, 'x')).toBeNull(); // proposta de botão não leva link
      const url1 = await links.enviarLink(p1, pessoa.ana, tel, 'O cliente pediu o cancelamento. A autorização é no Regem, com o seu PIN.');
      const c1 = codigoDe(url1);
      expect(c1).toHaveLength(32);
      const corpo = numero.pedidos.filter((p) => p.url.endsWith('/messages')).at(-1)!.corpo;
      expect(corpo).toEqual({
        messaging_product: 'whatsapp',
        to: tel,
        type: 'interactive',
        interactive: {
          type: 'cta_url',
          body: { text: 'O cliente pediu o cancelamento. A autorização é no Regem, com o seu PIN.' },
          action: { name: 'cta_url', parameters: { display_text: 'Abrir no Regem', url: url1 } },
        },
      });
      const l1 = await linhaDe(p1);
      expect(l1).toMatchObject({ link_hash: createHash('sha256').update(c1).digest('hex'), link_para: pessoa.ana, pin_erros: 0, link_aberto_em: null });
      expect(JSON.stringify(l1)).not.toContain(c1);
      expect(JSON.stringify(auditados)).not.toContain(c1);
      expect(acoes(p1)).toEqual([['mister_proposta_link_enviado', 'whatsapp']]);

      // ── A página abre: a proposta, as 5 tentativas; a primeira abertura fica na auditoria (uma vez só).
      const v1 = await links.verPeloLink(c1);
      expect(v1).toMatchObject({ estado: 'proposta', empresa: NOME_A, restam: 5, erro: null, respondida: null, botao: 'Autorizar', concluidaHora: null });
      expect(v1.pedidoPor).toMatch(/^Pedido pelo Mister às \d{2}:\d{2}, para Ana \(presidente\)\.$/);
      expect(v1.valeAte).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      await links.verPeloLink(c1);
      expect(acoes(p1).filter(([a]) => a === 'mister_proposta_link_aberto')).toHaveLength(1);
      // Código fora do formato, ou de formato certo mas de nenhum link: a mesma frase.
      await naoVale(links.verPeloLink('../../etc'));
      await naoVale(links.verPeloLink('A'.repeat(32)));

      // ── O PIN fora do formato nem gasta tentativa; o errado gasta e diz quantas restam (sem o PIN na trilha).
      await expect(links.autorizarPeloLink(c1, '12')).rejects.toBeInstanceOf(BadRequestException);
      expect((await linhaDe(p1)).pin_erros).toBe(0);
      expect((await links.autorizarPeloLink(c1, '0000')).erro).toBe('O PIN não confere. Restam 4 tentativas.');
      const errado2 = await links.autorizarPeloLink(c1, '9999');
      expect(errado2).toMatchObject({ estado: 'proposta', restam: 3, erro: 'O PIN não confere. Restam 3 tentativas.' });
      expect(JSON.stringify(auditados)).not.toMatch(/0000|9999|2580/);

      // ── O PIN certo: autoriza UMA vez (a tentativa reservada volta), avisa na conversa e executa sozinho.
      numero.pedidos.length = 0;
      const certo = await links.autorizarPeloLink(c1, PIN);
      expect(['fazendo', 'naodeu']).toContain(certo.estado);
      // A proposta deste teste não tem pedido nos parâmetros: o cancelamento (F4.2b) não acha o alvo e não faz nada.
      expect(await esperarFechar(p1)).toBe('nao_deu');
      expect(await linhaDe(p1)).toMatchObject({ autorizada_por: pessoa.ana, telefone_final: tel.slice(-4), pin_erros: 2 });
      await esperarMensagens(2);
      expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DO_LINK.autorizada, 'Não deu: o pedido não foi encontrado. Nada foi feito.']);
      expect(acoes(p1).filter(([a]) => a === 'mister_proposta_autorizada')).toEqual([['mister_proposta_autorizada', 'link']]);
      // Depois de respondida, o link só mostra o estado: o segundo "Autorizar" não muda nada.
      const depois = await links.autorizarPeloLink(c1, PIN);
      expect(depois).toMatchObject({ estado: 'naodeu', resultado: 'o pedido não foi encontrado. Nada foi feito.', respondida: { nome: 'Ana', final: tel.slice(-4) } });
      expect(depois.concluidaHora).toMatch(/^\d{2}:\d{2}$/);
      expect((await linhaDe(p1)).pin_erros).toBe(2);

      // ── Cinco errados bloqueiam: 8 toques em paralelo conferem no máximo 5 PIN; o certo depois não passa.
      const p2 = await novaProposta();
      const c2 = codigoDe(await links.enviarLink(p2, pessoa.ana, tel, 'outro'));
      numero.pedidos.length = 0;
      await Promise.all(Array.from({ length: 8 }, (_, i) => links.autorizarPeloLink(c2, String(1000 + i))));
      expect(await linhaDe(p2)).toMatchObject({ situacao: 'recusada', pin_erros: 5, resultado: 'link bloqueado: o PIN errado 5 vezes' });
      expect((await linhaDe(p2)).bloqueada_em).not.toBeNull();
      expect(acoes(p2).filter(([a]) => a === 'mister_proposta_pin_errado')).toHaveLength(5);
      expect(acoes(p2).filter(([a]) => a === 'mister_proposta_bloqueada')).toHaveLength(1);
      expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DO_LINK.bloqueada]);
      expect(await links.autorizarPeloLink(c2, PIN)).toMatchObject({ estado: 'bloqueado', restam: 0 });
      expect((await linhaDe(p2)).autorizada_por).toBeNull();
      expect((await seguranca.resumo(7)).linksComPin.bloqueados - bloqueadosAntes).toBe(1);

      // ── O novo envio derruba o link anterior (e as tentativas recomeçam); "Não autorizar" fecha sem PIN.
      const p3 = await novaProposta();
      const c3a = codigoDe(await links.enviarLink(p3, pessoa.ana, tel, 'um'));
      await links.autorizarPeloLink(c3a, '1111');
      const c3b = codigoDe(await links.enviarLink(p3, pessoa.ana, tel, 'dois'));
      expect(c3b).not.toBe(c3a);
      await naoVale(links.verPeloLink(c3a));
      expect(await links.verPeloLink(c3b)).toMatchObject({ estado: 'proposta', restam: 5 });
      numero.pedidos.length = 0;
      expect(await links.naoAutorizarPeloLink(c3b)).toMatchObject({ estado: 'recusou', respondida: { nome: 'Ana' } });
      expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DO_LINK.recusada]);
      expect(await links.autorizarPeloLink(c3b, PIN)).toMatchObject({ estado: 'recusou' });
      expect((await linhaDe(p3)).situacao).toBe('recusada');

      // ── Vencida: o link mostra "venceu" e não gasta tentativa.
      const p4 = await novaProposta();
      const c4 = codigoDe(await links.enviarLink(p4, pessoa.ana, tel, 'quatro'));
      await q(`update mister_proposta set vence_em = now() - interval '1 second' where id = $1`, [p4]);
      expect(await links.verPeloLink(c4)).toMatchObject({ estado: 'venceu' });
      expect(await links.autorizarPeloLink(c4, PIN)).toMatchObject({ estado: 'venceu' });
      expect((await linhaDe(p4)).pin_erros).toBe(0);

      // ── A régua de acesso da conversa (V75): módulo desligado, pessoa bloqueada ou telefone desligado do Mister = não vale.
      const p5 = await novaProposta();
      const c5 = codigoDe(await links.enviarLink(p5, pessoa.ana, tel, 'cinco'));
      await modulo(A, false);
      await naoVale(links.verPeloLink(c5));
      await naoVale(links.autorizarPeloLink(c5, PIN));
      await modulo(A, true);
      await q(`update colaborador set status = 'bloqueado' where id = $1`, [pessoa.ana]);
      await naoVale(links.verPeloLink(c5));
      await q(`update colaborador set status = 'ativo' where id = $1`, [pessoa.ana]);
      const ligacao = await linha('ana');
      await q(`update mister_vinculo set ligado_em = null where id = $1`, [ligacao.id]);
      await naoVale(links.autorizarPeloLink(c5, PIN));
      await q(`update mister_vinculo set ligado_em = $2 where id = $1`, [ligacao.id, ligacao.ligado_em]);
      expect((await linhaDe(p5)).pin_erros).toBe(0);
      // O gerente não recebe link que valha: a página só vale para o presidente.
      const p6 = await novaProposta();
      const c6 = codigoDe(await links.enviarLink(p6, pessoa.carlos, tel, 'seis'));
      await naoVale(links.verPeloLink(c6));

      // ── O botão da conversa não autoriza proposta de PIN (nem com o id montado à mão): a resposta aponta o link.
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'Autorizar', { botaoId: `prop:${p5}:sim` })).toBe('respondeu_proposta');
      expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DO_LINK.soPeloLink('Ana')]);
      expect((await linhaDe(p5)).situacao).toBe('proposta');
      expect(await links.verPeloLink(c5)).toMatchObject({ estado: 'proposta' });
    });

    // ───────────────────────────── cancelar com o estorno (F4.2b, sem migration) ─────────────────────────────

    it('F4.2b: cancelar com o estorno — a IA propõe pelo número, o link sai DEPOIS da resposta, o PIN autoriza e o cancelamento é o do painel; "feito" só com o pedido cancelado e o estorno feito; o estorno que falhou ou ficou na fila, sem Pix, a recusa do serviço, o pedido que não se acha, o vencido que avisa e renova', async () => {
      comIa();
      const tel = telefone();
      await ligar('ana', tel);
      await janelaAberta('ana');
      await modulo(A, true);
      const PIN = '2580';
      await q(`update colaborador set pin_hash = $2 where id = $1`, [pessoa.ana, bcrypt.hashSync(PIN, 4)]);
      // O cancelamento do painel é um dublê que ANOTA a chamada e cancela o pedido como o serviço de verdade.
      const cancelamentos: any[][] = [];
      let aoCancelar: (pedidoId: string) => Promise<void> = async (id) => {
        await q(`update pedido_externo set status = 'cancelado', cancelado_em = now() where id = $1`, [id]);
      };
      // Cancela PRIMEIRO e só então anota: quem espera a anotação já encontra o pedido cancelado.
      const painel = {
        cancelar: async (...a: any[]) => {
          await aoCancelar(a[3]);
          cancelamentos.push(a);
          return {};
        },
      };
      const esperarCancelados = async (n: number) => {
        for (let i = 0; i < 100 && cancelamentos.length < n; i++) await new Promise((r) => setTimeout(r, 30));
        expect(cancelamentos).toHaveLength(n);
      };
      const comCancelar = new MisterPropostasService(db, numero, entrada, fiscalDeMentira as any, auditoria, modulos, painel as any);
      const ferramentasComCancelar = new MisterFerramentasService(
        db,
        modulos,
        new DashboardService(db),
        new RelatoriosService(db, { custoEfetivoMapa: async () => ({}) } as any),
        new EstoqueService(db, auditoria as AuditoriaService),
        deliveryDeMentira as any,
        cozinhaDeMentira as any,
        servidorDeMentira as any,
        vendasDeMentira as any,
        escalaDeMentira as any,
        pontoDeMentira as any,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        comCancelar,
      );
      const agenteComCancelar = new MisterAgenteService(fila, ferramentasComCancelar, ia, numero);
      const escopo = (await ferramentasComCancelar.escopo(A, pessoa.ana, tel))!;
      const base = randomInt(50_000, 60_000);
      const pedido = async (o: { n: number; canal?: string; pix?: boolean; horas?: number; display?: string }) =>
        (
          await q(
            `insert into pedido_externo (tenant_id, unidade_id, canal, status, total, valor_bruto, taxa_entrega, taxa_entrega_dono, display_id, numero,
                                         cliente_nome, pago, status_pagamento, gateway_payment_id, gateway_provider, criado_em)
             values ($1, $2, $3, 'confirmado', 132.9, 132.9, 0, 'marketplace', $4, $5, 'Mariana Souza Lima', $6, $7, $8, $9, now() - make_interval(hours => $10::int))
             returning id::text as id`,
            [A, lojaDeA, o.canal ?? 'ifood', o.display ?? `${MARCA}${o.n}`, o.n, !!o.pix, o.pix ? 'aprovado' : 'na_entrega', o.pix ? `mp-${MARCA}-${o.n}` : null, o.pix ? 'mercadopago' : null, o.horas ?? 0],
          )
        )[0].id as string;
      const propostaDoPedido = async (pedidoId: string) => (await q(`select * from mister_proposta where procedimento = 'cancelar_pedido' and parametros ->> 'pedidoId' = $1`, [pedidoId]))[0];
      const esperar = async (id: string, situacao: string) => {
        for (let i = 0; i < 100; i++) {
          if ((await q(`select situacao from mister_proposta where id = $1`, [id]))[0]?.situacao === situacao) return;
          await new Promise((r) => setTimeout(r, 30));
        }
        throw new Error(`a proposta não chegou a ${situacao}`);
      };
      const codigoDaUltima = () => /\/m\/([A-Za-z0-9_-]{32})$/.exec(String(numero.enviadas.filter((m) => m.link).at(-1)?.link?.url))?.[1] ?? '';
      /** Propõe pela ferramenta e manda o link, como o agente faz depois da resposta. */
      const proporEMandar = async (n: number) => {
        const r = await ferramentasComCancelar.executar(escopo, 'propor_procedimento', { procedimento: 'cancelar_pedido', pedido: String(n) });
        expect(r.proposta).toMatchObject({ procedimento: 'cancelar_pedido', nivel: 'pin', botoes: [] });
        await ferramentasComCancelar.enviarLinkDaProposta(escopo, r.proposta!, tel);
        return codigoDaUltima();
      };
      const estorno = (pedidoId: string, situacao: string, erro: string | null = null) =>
        q(`insert into pedido_estorno (tenant_id, pedido_id, provedor, valor, situacao, erro) values ($1, $2, 'mercadopago', 132.9, $3, $4)`, [A, pedidoId, situacao, erro]);
      const acoesDa = (id: string) => auditados.filter((a) => a.entidadeId === id).map((a) => a.acao);
      auditados.length = 0;

      // ── 1. A IA propõe pelo número: o modelo não vê id nem valor; a resposta sai e DEPOIS o link "Abrir no Regem".
      const p1 = await pedido({ n: base + 1, pix: true });
      const nome1 = `#${base + 1} · iFood ${MARCA}${base + 1}`;
      numero.pedidos.length = 0;
      expect(await mandar(tel, `cancela o pedido ${base + 1}`)).toBe('pergunta');
      ia.roteiro = [usar('propor_procedimento', { procedimento: 'cancelar_pedido', pedido: `#${base + 1}` }, 'toolu_c1'), falar('O link para autorizar chega logo abaixo.')];
      expect(await agenteComCancelar.esvaziar()).toBe(1);
      const prop1 = await propostaDoPedido(p1);
      expect(prop1).toMatchObject({ tenant_id: A, unidade_id: lojaDeA, nivel: 'pin', situacao: 'proposta', aviso_id: uuidDeChave('mister:cancelar_pedido:', A, ':', p1) });
      expect(Math.round((new Date(prop1.vence_em).getTime() - new Date(prop1.criada_em).getTime()) / 60_000)).toBe(15);
      const aoModelo = JSON.stringify(ia.pedidos.at(-1));
      expect(aoModelo).toContain('vai em seguida, com o link');
      expect(aoModelo).toContain('Abrir no Regem');
      expect(aoModelo).toContain('que pede o PIN');
      expect(aoModelo).toContain(nome1);
      expect(aoModelo).not.toContain(prop1.id);
      expect(aoModelo).not.toMatch(/132[,.]9/);
      expect(numero.enviadas.map((m) => [m.para, m.texto, m.link?.titulo ?? null])).toEqual([
        [tel, 'O link para autorizar chega logo abaixo.', null],
        [tel, `Para cancelar o pedido ${nome1} (R$ 132,90, Pix já pago), a autorização é no Regem, com o seu PIN. O pedido vale até ${horaNoFuso(new Date(prop1.vence_em))}.`, 'Abrir no Regem'],
      ]);
      const c1 = codigoDaUltima();

      // ── 2. A página mostra o pedido como o banco o tem (o cliente só pelo nome curto).
      expect(await comCancelar.verPeloLink(c1)).toMatchObject({
        estado: 'proposta',
        titulo: `Cancelar o pedido ${nome1}?`,
        detalhe: 'iFood · cliente Mariana L. · pago por Pix',
        valor: 132.9,
        itens: ['O pedido é cancelado no Regem e no iFood.', 'O estorno do Pix é pedido ao Mercado Pago.'],
        botao: 'Autorizar o cancelamento',
      });

      // ── 3. O PIN autoriza: o cancelamento do PAINEL, com o presidente conferido no lugar da senha; o "feito" espera o estorno.
      numero.pedidos.length = 0;
      expect((await comCancelar.autorizarPeloLink(c1, PIN)).estado).toBe('fazendo');
      await esperar(prop1.id, 'executando');
      await esperarCancelados(1);
      expect(cancelamentos).toEqual([[A, pessoa.ana, 'presidente', p1, 'Cancelado pelo Mister, autorizado com o PIN', undefined, true, null, null, { id: pessoa.ana, nome: 'Ana Souza' }]]);
      expect(await comCancelar.conferir()).toBe(0); // cancelado, mas o estorno ainda não saiu: espera
      await estorno(p1, 'feito');
      expect(await comCancelar.conferir()).toBe(1);
      expect(await propostaDoPedido(p1)).toMatchObject({ situacao: 'feita', resultado: `O pedido ${nome1} foi cancelado no Regem e no iFood, e o estorno do Pix foi pedido ao Mercado Pago. Autorizado por você, com o PIN.` });
      await esperarMensagens(2);
      expect(numero.enviadas.map((m) => m.texto)).toEqual([
        TEXTOS_DO_LINK.autorizada,
        expect.stringMatching(new RegExp(`^✅ Feito às \\d{2}:\\d{2}\\. O pedido #${base + 1} · iFood .* foi cancelado no Regem e no iFood, e o estorno do Pix foi pedido ao Mercado Pago\\. Autorizado por você, com o PIN\\.$`)),
      ]);
      expect(await comCancelar.verPeloLink(c1)).toMatchObject({ estado: 'feito' });
      expect(acoesDa(prop1.id)).toEqual(expect.arrayContaining(['mister_proposta_link_enviado', 'mister_proposta_autorizada', 'mister_proposta_executada', 'mister_proposta_feita']));
      // O pedido cancelado não é mais achado; e a proposta feita nunca renova, nem chamada direto.
      expect((await ferramentasComCancelar.executar(escopo, 'propor_procedimento', { procedimento: 'cancelar_pedido', pedido: String(base + 1) })).dados).toEqual({
        proposta: null,
        motivo: 'Não achei pedido aberto com esse número nas últimas 24 horas nesta loja.',
      });
      expect(await comCancelar.proporCancelamento({ tenantId: A, unidadeId: lojaDeA, pedidoId: p1 }, (await comCancelar.lerPedido(A, p1))!)).toBeNull();
      expect(await propostaDoPedido(p1)).toMatchObject({ id: prop1.id, situacao: 'feita' });

      // ── 4. O estorno que falhou na 3ª tentativa: "não deu", dizendo que um caso urgente entrou em Atendimento.
      const p2 = await pedido({ n: base + 2, pix: true });
      const c2 = await proporEMandar(base + 2);
      await comCancelar.autorizarPeloLink(c2, PIN);
      const prop2 = await propostaDoPedido(p2);
      await esperar(prop2.id, 'executando');
      await esperarCancelados(2);
      await estorno(p2, 'falhou', 'saldo insuficiente na conta do gateway');
      await comCancelar.conferir();
      expect((await propostaDoPedido(p2)).situacao).toBe('nao_deu');
      expect((await propostaDoPedido(p2)).resultado).toContain('foi cancelado, mas o estorno do Pix não saiu (saldo insuficiente na conta do gateway). Um caso urgente entrou em Atendimento');

      // ── 5. O estorno que não sai no prazo da conferência: "não deu", dizendo que o Regem tenta de novo.
      const p3 = await pedido({ n: base + 3, pix: true });
      const c3 = await proporEMandar(base + 3);
      await comCancelar.autorizarPeloLink(c3, PIN);
      const prop3 = await propostaDoPedido(p3);
      await esperar(prop3.id, 'executando');
      await esperarCancelados(3);
      // Espera o estorno por 10 minutos depois de cancelar.
      expect(Math.round((new Date((await propostaDoPedido(p3)).conferir_ate).getTime() - Date.now()) / 60_000)).toBeGreaterThanOrEqual(9);
      await q(`update mister_proposta set conferir_ate = now() - interval '1 second' where id = $1`, [prop3.id]);
      await comCancelar.conferir();
      expect(await propostaDoPedido(p3)).toMatchObject({ situacao: 'nao_deu', resultado: expect.stringContaining('ainda não saiu no Mercado Pago. O Regem tenta de novo sozinho') });

      // ── 6. Sem Pix pelo Regem (o cardápio pago na entrega): "feito" logo depois de cancelar.
      const p4 = await pedido({ n: base + 4, canal: 'cardapio' });
      const c4 = await proporEMandar(base + 4);
      expect((await comCancelar.verPeloLink(c4)).itens).toEqual(['O pedido é cancelado no Regem.', 'Não houve Pix pago pelo Regem: nenhum estorno é pedido por aqui.']);
      await comCancelar.autorizarPeloLink(c4, PIN);
      expect(await esperarFechar((await propostaDoPedido(p4)).id)).toBe('feita');
      expect((await propostaDoPedido(p4)).resultado).toBe(`O pedido #${base + 4} · Cardápio ${MARCA}${base + 4} foi cancelado no Regem. Autorizado por você, com o PIN.`);

      // ── 7. A recusa do serviço do painel (o pedido foi concluído entre a proposta e o PIN): "não deu", nada feito.
      const p5 = await pedido({ n: base + 5, pix: true });
      const c5 = await proporEMandar(base + 5);
      aoCancelar = async () => {
        throw new BadRequestException('Pedido concluído não pode ser cancelado.');
      };
      await comCancelar.autorizarPeloLink(c5, PIN);
      expect(await esperarFechar((await propostaDoPedido(p5)).id)).toBe('nao_deu');
      expect((await propostaDoPedido(p5)).resultado).toBe('pedido concluído não pode ser cancelado. Nada foi feito.');
      aoCancelar = async (id) => {
        await q(`update pedido_externo set status = 'cancelado', cancelado_em = now() where id = $1`, [id]);
      };

      // ── 8. O pedido que não se acha: o número sem pedido, o de mais de 24 horas, o mesmo número em dois pedidos.
      const nada = async (pedidoDito: string) => (await ferramentasComCancelar.executar(escopo, 'propor_procedimento', { procedimento: 'cancelar_pedido', pedido: pedidoDito })).dados;
      expect(await nada(String(base + 900))).toMatchObject({ proposta: null, motivo: expect.stringContaining('Não achei pedido aberto') });
      await pedido({ n: base + 6, horas: 30 });
      expect(await nada(String(base + 6))).toMatchObject({ proposta: null, motivo: expect.stringContaining('Não achei pedido aberto') });
      await pedido({ n: base + 7, display: `D${MARCA}` });
      await pedido({ n: base + 8, display: `D${MARCA}` });
      const dois = await nada(`D${MARCA}`);
      expect(dois).toMatchObject({ proposta: null, motivo: 'Achei mais de um pedido aberto com esse número.' });
      expect((dois as any).pedidos).toEqual(expect.arrayContaining([expect.stringContaining(`#${base + 8}`), expect.stringContaining(`#${base + 7}`)]));
      // O gerente não propõe (só o presidente autoriza).
      const telCarlos = telefone();
      await ligar('carlos', telCarlos, A, 'gerente');
      const doCarlos = (await ferramentasComCancelar.escopo(A, pessoa.carlos, telCarlos))!;
      expect((await ferramentasComCancelar.executar(doCarlos, 'propor_procedimento', { procedimento: 'cancelar_pedido', pedido: String(base + 9) })).ok).toBe(false);

      // ── 9. O vencido: quem recebeu o link fica sabendo; pedir de novo renova a MESMA proposta, zerada.
      const p9 = await pedido({ n: base + 9, pix: true });
      const c9 = await proporEMandar(base + 9);
      await comCancelar.autorizarPeloLink(c9, '0000');
      const prop9 = await propostaDoPedido(p9);
      await q(`update mister_proposta set vence_em = now() - interval '1 second' where id = $1`, [prop9.id]);
      // As que outros testes deixaram vencidas (o link da F4.2a) já saem como vencidas: este passo confere só a do pedido.
      await q(`update mister_proposta set situacao = 'vencida' where tenant_id = $1 and situacao = 'proposta' and vence_em <= now() and id <> $2`, [A, prop9.id]);
      numero.pedidos.length = 0;
      expect(await comCancelar.vencer()).toBeGreaterThanOrEqual(1);
      expect(numero.enviadas.map((m) => m.texto)).toEqual([
        `O pedido de autorização do cancelamento do pedido #${base + 9} · iFood ${MARCA}${base + 9} venceu às ${horaNoFuso(new Date((await propostaDoPedido(p9)).vence_em))} sem resposta. Nada foi feito. Se ainda precisar, é só me pedir de novo.`,
      ]);
      await proporEMandar(base + 9);
      expect(await propostaDoPedido(p9)).toMatchObject({ id: prop9.id, situacao: 'proposta', pin_erros: 0, bloqueada_em: null, respondida_em: null });
      expect((await q(`select count(*)::int as n from mister_proposta where procedimento = 'cancelar_pedido' and parametros ->> 'pedidoId' = $1`, [p9]))[0].n).toBe(1);
    });

    // ───────────────────────────── as instruções candidatas (M2b, mig 435) ─────────────────────────────

    it('M2b: as instruções candidatas — a troca de uma linha sobre o código, o Mentor pela chave da DMS, publicar só sem errada nova, a volta, a troca quebrada e o agente com o texto no ar', async () => {
      comIa();
      const QUEM = `Rita-${MARCA}`;
      const instrucoes = new MisterInstrucoesService(db, ia);
      const avaliacao = new MisterAvaliacaoService(db, ia, instrucoes);
      const linhaQueSai = INSTRUCOES_DO_MISTER.split('\n').find((l) => l.startsWith('- ') && l.length > 40)!;
      const linhaQueEntra = `${linhaQueSai} Diga também o número de cada canal.`;
      const versaoCand = versaoDoTexto(INSTRUCOES_DO_MISTER.split('\n').map((l, i, todas) => (i === todas.indexOf(linhaQueSai) ? linhaQueEntra : l)).join('\n'));
      const rodadaGravada = async (versao: string, oks: boolean[]) =>
        (
          await q(
            `insert into mister_avaliacao (pedida_por, versao, consultas, modelo, total, feitas, acertos, casos, situacao, terminada_em)
             values ($1, $2, 10, 'claude-haiku-5-5', $3, $3, $4, $5::jsonb, 'terminou', now()) returning id::text as id`,
            [QUEM, versao, oks.length, oks.filter(Boolean).length, JSON.stringify(oks.map((ok, i) => ({ id: `c${i}`, pergunta: `Pergunta ${i}`, ok, falhas: ok ? [] : ['não consultou'], consultas: [], ms: 1 })))],
          )
        )[0].id as string;
      const situacaoDa = async (id: string) => (await q(`select situacao from mister_instrucao_troca where id = $1`, [id]))[0]?.situacao;
      try {
        await q(`update mister_instrucao_troca set situacao = 'descartada' where situacao in ('candidata', 'no_ar')`);
        // ── Sem troca: o no ar é o código, com a versão da avaliação.
        const zero = await instrucoes.noAr();
        expect(zero).toMatchObject({ texto: INSTRUCOES_DO_MISTER, versao: versaoDasInstrucoes().versao, aplicadas: [], quebradas: [] });
        // ── Sem avaliação inteira da versão no ar: o Mentor nem é chamado.
        ia.pedidos.length = 0;
        await expect(instrucoes.proporCandidata(QUEM)).rejects.toThrow('A versão no ar ainda não tem uma avaliação inteira');
        expect(ia.pedidos).toHaveLength(0);
        await rodadaGravada(zero.versao, [true, false, true]);

        // ── O Mentor que devolve uma linha que não existe: nada é gravado. O pedido leva as erradas e as instruções.
        ia.roteiro = [falar('{"sai":"- linha inventada pelo modelo","entra":"- outra linha qualquer, comprida","porque":"x"}')];
        await expect(instrucoes.proporCandidata(QUEM)).rejects.toBeInstanceOf(BadRequestException);
        expect((await q(`select count(*)::int as n from mister_instrucao_troca where situacao = 'candidata'`))[0].n).toBe(0);
        const aoMentor = ia.pedidos.at(-1);
        expect(aoMentor.model).toBe('claude-sonnet-5-5');
        expect(aoMentor.system).toBe(INSTRUCOES_DO_MENTOR);
        const pedidoAoMentor = JSON.stringify(aoMentor.messages);
        expect(pedidoAoMentor).toContain('Pergunta 1');
        expect(pedidoAoMentor).toContain('não consultou');
        expect(pedidoAoMentor).not.toContain('Pergunta 0'); // só as erradas

        // ── A candidata boa: a troca da linha EXATA; uma por vez; o no ar não muda até publicar.
        ia.roteiro = [falar(JSON.stringify({ sai: linhaQueSai, entra: linhaQueEntra, porque: 'faltava o número de cada canal' }))];
        const cand = await instrucoes.proporCandidata(QUEM);
        expect(cand.versao).toBe(versaoCand);
        await expect(instrucoes.proporCandidata(QUEM)).rejects.toBeInstanceOf(ConflictException);
        const comCandidata = (await instrucoes.textoDaCandidata()).texto.split('\n');
        expect(comCandidata).toContain(linhaQueEntra);
        expect(comCandidata).not.toContain(linhaQueSai);
        expect((await instrucoes.noAr()).versao).toBe(zero.versao);

        // ── Publicar sem a avaliação da candidata, e com uma errada nova: recusa com o motivo.
        await expect(instrucoes.publicar(QUEM)).rejects.toThrow('Rode a avaliação com a candidata antes de publicar.');
        await instrucoes.marcarAvaliacao(cand.id, await rodadaGravada(versaoCand, [false, true, true]));
        expect((await instrucoes.estado()).candidata).toMatchObject({ pode: false, novas: ['Pergunta 0'], melhoraram: ['Pergunta 1'] });
        await expect(instrucoes.publicar(QUEM)).rejects.toThrow('1 pergunta passou a errar com a candidata.');
        expect(await situacaoDa(cand.id)).toBe('candidata');

        // ── A avaliação boa: publica; o no ar passa a ser o código com a troca; a avaliação mostra a versão nova.
        await instrucoes.marcarAvaliacao(cand.id, await rodadaGravada(versaoCand, [true, true, true]));
        expect((await instrucoes.estado()).candidata).toMatchObject({ pode: true, novas: [], melhoraram: ['Pergunta 1'] });
        expect(await instrucoes.publicar(QUEM)).toMatchObject({ id: cand.id, tipo: 'troca', versao: versaoCand });
        const noAr = await instrucoes.noAr();
        expect(noAr).toMatchObject({ versao: versaoCand, aplicadas: [cand.id], quebradas: [] });
        expect(noAr.texto.split('\n')).toContain(linhaQueEntra);
        expect((await avaliacao.lista()).versaoAtual.versao).toBe(versaoCand);
        expect((await instrucoes.estado()).publicadas).toEqual([expect.objectContaining({ id: cand.id, sai: linhaQueSai, entra: linhaQueEntra, publicadaPor: QUEM, ultima: true })]);

        // ── O agente responde com o texto no ar (o mesmo que a avaliação acabou de testar).
        const agenteComInstrucoes = new MisterAgenteService(fila, ferramentas, ia, numero, instrucoes);
        const tel = telefone();
        await ligar('ana', tel);
        ia.pedidos.length = 0;
        expect(await mandar(tel, 'oi, como estão as coisas?')).toBe('pergunta');
        ia.roteiro = [falar('Tudo certo por aqui.')];
        expect(await agenteComInstrucoes.esvaziar()).toBe(1);
        expect(ia.pedidos.at(-1).system[0].text).toBe(noAr.texto);

        // ── A volta: vira candidata com o texto do código, passa pela avaliação e, publicada, tira a troca.
        const volta = await instrucoes.proporVolta(QUEM);
        expect(volta.versao).toBe(zero.versao);
        await instrucoes.marcarAvaliacao(volta.id, await rodadaGravada(zero.versao, [true, true, true]));
        expect(await instrucoes.publicar(QUEM)).toMatchObject({ id: volta.id, tipo: 'volta' });
        expect(await instrucoes.noAr()).toMatchObject({ texto: INSTRUCOES_DO_MISTER, versao: zero.versao, aplicadas: [] });
        expect([await situacaoDa(cand.id), await situacaoDa(volta.id)]).toEqual(['retirada', 'feita']);
        await expect(instrucoes.proporVolta(QUEM)).rejects.toThrow('Não há troca publicada para tirar');

        // ── A troca cuja linha sumiu do código fica de fora (e o console avisa); descartar fecha a candidata.
        await q(
          `insert into mister_instrucao_troca (tipo, sai, entra, situacao, versao_base, versao, publicada_em, criada_por)
           values ('troca', '- uma linha que saiu do código', '- a nova', 'no_ar', 'x', 'y', now(), $1)`,
          [QUEM],
        );
        const outraReplica = new MisterInstrucoesService(db, ia); // sem o cache da de cima
        expect(await outraReplica.noAr()).toMatchObject({ texto: INSTRUCOES_DO_MISTER, aplicadas: [], quebradas: [expect.any(String)] });
        expect((await outraReplica.estado()).noAr.quebradas).toEqual([expect.objectContaining({ sai: '- uma linha que saiu do código' })]);
        const v2 = await outraReplica.proporVolta(QUEM);
        expect((await outraReplica.descartar(QUEM)).id).toBe(v2.id);
        await expect(outraReplica.descartar(QUEM)).rejects.toBeInstanceOf(NotFoundException);
      } finally {
        await q(`delete from mister_instrucao_troca where criada_por = $1`, [QUEM]);
        await q(`delete from mister_avaliacao where pedida_por = $1`, [QUEM]);
      }
    });

    // ───────────────────────────── a porta do provedor: o Evolution (Q1, mig 436) ─────────────────────────────

    it('Q1: o Evolution — o envio (texto, botões numerados, link escrito, ritmo de 20/min, sem modelo), o número que se salva, a entrada só da instância do Mister (o eco não conta), o "2" na autorização aberta e o aviso sem janela', async () => {
      const INSTANCIA = `mister-${MARCA}`;
      const NUMERO_DO_QR = '5521977776666';
      const antesEvolution = { url: process.env.EVOLUTION_API_URL, chave: process.env.EVOLUTION_API_KEY };
      process.env.EVOLUTION_API_URL = 'https://evolution.teste/';
      process.env.EVOLUTION_API_KEY = 'chave-do-evolution-de-teste';
      class NumeroQueAnota extends NumeroDeMentira {
        esperas: number[] = [];
        protected esperar(ms: number) {
          this.esperas.push(ms);
          return Promise.resolve();
        }
      }
      const doEvolution = new NumeroQueAnota(db);
      const pedidosAoEvolution = (n: NumeroDeMentira) => n.pedidos.filter((p) => p.url.startsWith('https://evolution.teste/'));
      let notaDoQ1: string | null = null;
      const tel = telefone();
      await ligar('ana', tel);
      try {
        // ── Nasce na API oficial: nada muda até trocar.
        expect(await doEvolution.ler()).toMatchObject({ provedor: 'oficial', instancia: null, instanciaNumero: null });
        expect(await doEvolution.semJanela()).toBe(false);
        // Q2 (mig 437): o envio pelo Evolution pede o celular conectado — sem ele, nada sai pelo QR.
        await q(`update mister_numero set provedor = 'evolution', instancia = $1, instancia_numero = $2, instancia_situacao = 'caiu' where id = 1`, [INSTANCIA, NUMERO_DO_QR]);
        await expect(doEvolution.enviar(tel, { texto: 'antes de conectar' })).rejects.toMatchObject({ motivo: 'sem_numero' });
        expect(pedidosAoEvolution(doEvolution)).toHaveLength(0);
        await q(`update mister_numero set instancia_situacao = 'conectado' where id = 1`);
        expect(await doEvolution.semJanela()).toBe(true);
        expect(await doEvolution.daInstancia(INSTANCIA)).toMatchObject({ provedor: 'evolution', instanciaNumero: NUMERO_DO_QR });
        expect(await doEvolution.daInstancia('instancia-de-uma-loja')).toBeNull();

        // ── O envio: texto pelo Evolution da distribuição (nada pela Meta); os botões numerados; o link escrito.
        await doEvolution.enviar(tel, { texto: 'Bom dia.' });
        await doEvolution.enviar(tel, { texto: 'Posso consultar a nota?', botoes: [{ id: 'prop:x:sim', titulo: 'Autorizar' }, { id: 'prop:x:nao', titulo: 'Não agora' }] });
        await doEvolution.enviar(tel, { texto: 'A autorização é no Regem.', link: { titulo: 'Abrir no Regem', url: 'https://app.dmsregem.com/m/abc' } });
        const saidas = pedidosAoEvolution(doEvolution);
        expect(saidas.map((p) => p.url)).toEqual(Array(3).fill(`https://evolution.teste/message/sendText/${INSTANCIA}`));
        expect(saidas.map((p) => p.corpo)).toEqual([
          { number: tel, text: 'Bom dia.' },
          { number: tel, text: 'Posso consultar a nota?\n\n1. Autorizar\n2. Não agora\n\nResponda com o número.' },
          { number: tel, text: 'A autorização é no Regem.\n\nAbrir no Regem: https://app.dmsregem.com/m/abc' },
        ]);
        expect(doEvolution.pedidos.some((p) => p.url.startsWith(GRAPH))).toBe(false);
        // Sem modelo no Evolution: quem chama manda o texto (o modelo recusa com o motivo).
        await expect(doEvolution.enviarModelo(tel, MODELO_DO_AVISO, ['a', 'b'], { tipo: 'aviso', id: randomUUID() })).rejects.toMatchObject({ motivo: 'evolution' });

        // ── O ritmo: 20 por minuto; o 21º espera o mais antigo sair da conta.
        for (let i = 0; i < 17; i++) await doEvolution.enviar(tel, { texto: `envio ${i}` });
        expect(doEvolution.esperas).toEqual([]);
        await doEvolution.enviar(tel, { texto: 'o 21º' });
        expect(doEvolution.esperas).toHaveLength(1);
        expect(doEvolution.esperas[0]).toBeGreaterThan(50_000);
        expect(doEvolution.esperas[0]).toBeLessThanOrEqual(60_050);

        // ── O Evolution que recusa, e a chave geral desligada (nada sai).
        doEvolution.responder = (p) => (p.url.startsWith('https://evolution.teste/') ? { status: 500, corpo: { erro: 'instância desconectada' } } : undefined);
        await expect(doEvolution.enviar(tel, { texto: 'x' })).rejects.toMatchObject({ motivo: 'evolution', status: 500 });
        doEvolution.responder = () => undefined;
        await q(`update mister_numero set ligado = false where id = 1`);
        await expect(doEvolution.enviar(tel, { texto: 'x' })).rejects.toMatchObject({ motivo: 'desligado' });
        await q(`update mister_numero set ligado = true where id = 1`);

        // ── O número que as pessoas salvam é o do QR.
        expect(await vinculo.meu(usuario('ana'))).toMatchObject({ disponivel: true, numeroDoMister: NUMERO_DO_QR });

        // ── A entrada: só a instância do Mister; o eco do próprio número não vira pergunta; a loja segue o caminho dela.
        expect(await entrada.receberDoEvolution('instancia-de-uma-loja', { telefone: tel, texto: 'oi', wamid: `${MARCA}-1`, deMim: false })).toBe(false);
        expect(await entrada.receberDoEvolution(INSTANCIA, { telefone: tel, texto: 'eco', wamid: `${MARCA}-2`, deMim: true })).toBe(true);
        expect(await q(`select 1 from mister_mensagem where wamid = $1`, [`evo:${MARCA}-2`])).toHaveLength(0);
        // Pela porta do Evolution (a mesma das lojas): o aviso da instância do Mister é dele, com o id num espaço próprio.
        // (De um telefone que não está ligado: a resposta fixa, sem pôr pergunta na fila dos outros testes.)
        const portaDoEvolution = new EvolutionEntradaService(db, {} as any, undefined, undefined, entrada);
        const desconhecido = telefone();
        await portaDoEvolution.processar({ event: 'MESSAGES_UPSERT', data: { key: { id: `${MARCA}-3`, remoteJid: `${desconhecido}@s.whatsapp.net`, fromMe: false }, message: { conversation: 'oi, Mister' } } }, INSTANCIA);
        expect((await q(`select desfecho from mister_mensagem where wamid = $1`, [`evo:${MARCA}-3`]))[0]?.desfecho).toBe('fixa');

        // ── "2" com uma autorização de botão aberta: recusa ESSA autorização, e a resposta sai pelo Evolution.
        const [prop] = await q(
          `insert into mister_proposta (tenant_id, unidade_id, aviso_id, procedimento, parametros, nivel, vence_em)
           values ($1, null, $2, 'consultar_nota', '{}'::jsonb, 'botao', now() + interval '10 minutes') returning id::text as id`,
          [A, randomUUID()],
        );
        numero.pedidos.length = 0;
        expect(await entrada.receberDoEvolution(INSTANCIA, { telefone: tel, texto: ' 2 ', wamid: `${MARCA}-4`, deMim: false })).toBe(true);
        expect((await q(`select situacao from mister_proposta where id = $1`, [prop.id]))[0].situacao).toBe('recusada');
        expect((await q(`select desfecho from mister_mensagem where wamid = $1`, [`evo:${MARCA}-4`]))[0].desfecho).toBe('respondeu_proposta');
        expect(pedidosAoEvolution(numero).map((p) => p.corpo.text)).toEqual([TEXTOS_DA_PROPOSTA.recusada]);

        // ── Sem janela: o aviso de quem não escreve há dias vai com o TEXTO (não o modelo), pelo Evolution.
        await q(`update mister_vinculo set ultima_entrada_em = now() - interval '3 days' where colaborador_id = $1`, [pessoa.ana]);
        numero.pedidos.length = 0;
        avisos.incidentes = [];
        notaDoQ1 = await notaSemResposta(9701);
        await avisos.volta([A]);
        const aoEvolution = pedidosAoEvolution(numero).map((p) => p.corpo.text);
        expect(aoEvolution.some((t) => t.includes('nº 9701'))).toBe(true);
        expect(numero.pedidos.some((p) => p.url.startsWith(GRAPH) && p.corpo?.type === 'template')).toBe(false);
      } finally {
        await q(`update mister_numero set provedor = 'oficial', instancia = null, instancia_numero = null, instancia_situacao = 'sem', ligado = true where id = 1`);
        await q(`delete from mister_mensagem where wamid like $1`, [`evo:${MARCA}-%`]);
        await janelaAberta('ana');
        if (notaDoQ1) {
          await q(`delete from mister_proposta where aviso_id in (select id from mister_aviso where tenant_id = $1 and chave = $2)`, [A, `nota:${notaDoQ1}`]);
          await q(`delete from mister_aviso where tenant_id = $1 and chave = $2`, [A, `nota:${notaDoQ1}`]);
          await q(`update nota_fiscal set status = 'autorizada' where id = $1`, [notaDoQ1]);
        }
        if (antesEvolution.url === undefined) delete process.env.EVOLUTION_API_URL;
        else process.env.EVOLUTION_API_URL = antesEvolution.url;
        if (antesEvolution.chave === undefined) delete process.env.EVOLUTION_API_KEY;
        else process.env.EVOLUTION_API_KEY = antesEvolution.chave;
      }
    });

    // ──────────────────────── a conexão por QR Code no console e o número novo (Q2 e Q3, mig 437) ────────────────────────

    it('Q2/Q3: o aceite antes do QR, a instância só do Mister com a porta assinada, a forma que vira o QR ao conectar, caiu × bloqueado × QR vencido, outro número, a troca, o desconectar e o número novo anunciado uma vez', async () => {
      const antes = { url: process.env.EVOLUTION_API_URL, chave: process.env.EVOLUTION_API_KEY, segredo: process.env.BOT_RESOLVER_SECRET, base: process.env.PUBLIC_API_BASE };
      process.env.EVOLUTION_API_URL = 'https://evolution.teste';
      process.env.EVOLUTION_API_KEY = 'chave-do-evolution-de-teste';
      process.env.BOT_RESOLVER_SECRET = 'segredo-do-robo-de-teste';
      process.env.PUBLIC_API_BASE = 'https://api.teste/api/v1/';
      class NumeroQueAnota extends NumeroDeMentira {
        protected esperar() {
          return Promise.resolve();
        }
      }
      const doEvolution = new NumeroQueAnota(db);
      let estado = 'connecting';
      let dono: string | null = null;
      doEvolution.responder = (p) => {
        if (!p.url.startsWith('https://evolution.teste/')) return undefined;
        if (p.url.includes('/instance/connect/')) return { status: 200, corpo: estado === 'open' ? { instance: { state: 'open' } } : { base64: 'QRBASE64', pairingCode: 'ABCD1234' } };
        if (p.url.includes('/instance/connectionState/')) return { status: 200, corpo: { instance: { state: estado } } };
        if (p.url.includes('/instance/fetchInstances')) return { status: 200, corpo: [{ name: decodeURIComponent(/instanceName=([^&]+)/.exec(p.url)![1]), ownerJid: dono }] };
        if (p.url.includes('/message/sendText/')) return { status: 201, corpo: { key: { id: `evo-${randomUUID()}` } } };
        return { status: 201, corpo: {} };
      };
      const aoEvolution = (trecho: string) => doEvolution.pedidos.filter((p) => p.url.startsWith('https://evolution.teste/') && p.url.includes(trecho));
      const qr = new MisterQrService(db, doEvolution);
      const portaDoEvolution = new EvolutionEntradaService(db, {} as any, undefined, undefined, entrada, qr);
      const conexao = (inst: string, data: any) => portaDoEvolution.processar({ event: 'CONNECTION_UPDATE', instance: inst, data }, inst);
      const telAna = telefone();
      const telCarlos = telefone();
      const telPausado = telefone();
      await numeroConectado(true);
      await ligar('ana', telAna);
      await ligar('carlos', telCarlos, A, 'gerente');
      await ligar('anaB', telPausado, B); // outra empresa, e pediu PARAR AVISOS
      await q(`update mister_vinculo set pausado_em = now() where telefone = $1`, [telPausado]);
      /** O aviso do número novo sai sem esperar (`void`): a conta é das mensagens com o texto dele, por telefone. */
      const anuncios = () => aoEvolution('/message/sendText/').filter((p) => /novo número do Mister/.test(p.corpo.text) && [telAna, telCarlos, telPausado].includes(p.corpo.number));
      const esperarAnuncios = async (n: number) => {
        for (let i = 0; i < 100 && anuncios().length < n; i++) await new Promise((r) => setTimeout(r, 30));
        await new Promise((r) => setTimeout(r, 60)); // e nenhum a mais
        return anuncios();
      };
      try {
        expect(qr.pronto()).toBe(true);
        // ── O aceite: só o texto de AGORA; sem ele, nada de QR (nem pedido ao Evolution).
        await expect(qr.gerarQr({}, { nome: 'Rodrigo' })).rejects.toBeInstanceOf(ConflictException);
        await expect(qr.aceitar({ aceito: true, versao: 'v0' }, { nome: 'Rodrigo' })).rejects.toBeInstanceOf(BadRequestException);
        await expect(qr.aceitar({ aceito: false, versao: 'v1' }, { nome: 'Rodrigo' })).rejects.toBeInstanceOf(BadRequestException);
        expect(aoEvolution('')).toHaveLength(0);
        expect((await qr.aceitar({ aceito: true, versao: 'v1' }, { nome: 'Rodrigo' })).aceite).toMatchObject({ por: 'Rodrigo', versao: 'v1', em: expect.any(String) });

        // ── O QR: uma instância SÓ do Mister, com o webhook na porta assinada do Regem (mensagens e conexão).
        const r1 = await qr.gerarQr({}, { nome: 'Rodrigo' });
        expect(r1.qr).toEqual({ imagem: 'data:image/png;base64,QRBASE64', codigo: 'ABCD1234' });
        const inst = r1.instancia!;
        expect(inst).toMatch(/^regem-mister-[0-9a-f]{8}$/);
        expect(r1).toMatchObject({ provedor: 'oficial', instanciaSituacao: 'conectando', instanciaNumero: null });
        const [gancho] = aoEvolution('/webhook/set/');
        expect(gancho.url).toBe(`https://evolution.teste/webhook/set/${inst}`);
        expect(gancho.corpo.webhook).toMatchObject({
          enabled: true,
          url: 'https://api.teste/api/v1/publico/whatsapp/evolution/webhook',
          headers: { 'x-regem-evolution': assinaturaDaInstancia(inst) },
          events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'],
        });
        expect(aoEvolution('/instance/create')[0].corpo).toMatchObject({ instanceName: inst, qrcode: true, integration: 'WHATSAPP-BAILEYS' });
        // Com o QR na tela, a oficial segue falando.
        await doEvolution.enviar(telAna, { texto: 'pela oficial' });
        expect(doEvolution.enviadas.map((m) => m.texto)).toContain('pela oficial');
        expect(aoEvolution('/message/sendText/')).toHaveLength(0);
        // A troca do QR a cada 20 s: só o QR novo, sem refazer a instância nem o webhook.
        const criadas = aoEvolution('/instance/create').length;
        await qr.gerarQr({ renovar: true }, { nome: 'Rodrigo' });
        expect([aoEvolution('/instance/create').length, aoEvolution('/webhook/set/').length, aoEvolution('/instance/connect/').length]).toEqual([criadas, 1, 2]);

        // ── O QR que venceu sem ninguém ler: volta a "não conectado" (não "caiu"); o aviso de OUTRA instância não mexe.
        await conexao('instancia-de-uma-loja', { state: 'open', wuid: '5521900000000@s.whatsapp.net' });
        await conexao(inst, { state: 'close', statusReason: 408 });
        expect((await doEvolution.ler()).instanciaSituacao).toBe('sem');
        await qr.gerarQr({}, { nome: 'Rodrigo' });

        // ── Conectou (pela conferência da tela): o número do celular, a forma vira o QR, e o número novo é anunciado a
        //    quem está ligado — menos quem pediu PARAR AVISOS —, pelo número novo.
        estado = 'open';
        dono = '5521988887777:12@s.whatsapp.net';
        const c1 = await qr.conferir();
        expect(c1).toMatchObject({ provedor: 'evolution', instanciaSituacao: 'conectado', instanciaNumero: '5521988887777', instanciaConectadaEm: expect.any(String) });
        const primeiros = await esperarAnuncios(2);
        expect(primeiros.map((p) => p.corpo.number).sort()).toEqual([telAna, telCarlos].sort());
        expect(primeiros.every((p) => p.url === `https://evolution.teste/message/sendText/${inst}`)).toBe(true);
        expect(primeiros.find((p) => p.corpo.number === telAna)!.corpo.text).toMatch(/^Oi, Ana! Este é o novo número do Mister/);
        expect((await q(`select numero_anunciado from mister_numero where id = 1`))[0].numero_anunciado).toBe('5521988887777');
        // Duas conferências e o aviso do Evolution juntos: ninguém recebe de novo.
        await Promise.all([qr.conferir(), qr.conferir(), conexao(inst, { state: 'open', wuid: '5521988887777@s.whatsapp.net' })]);
        expect(await esperarAnuncios(3)).toHaveLength(2);
        // O número que as pessoas salvam é o do celular.
        expect(await vinculo.meu(usuario('ana'))).toMatchObject({ numeroDoMister: '5521988887777' });
        // O "bloqueado" de uma instância de loja não mexe no celular do Mister.
        await conexao('instancia-de-uma-loja', { state: 'close', statusReason: 403 });
        expect((await doEvolution.ler()).instanciaSituacao).toBe('conectado');

        // ── Caiu (o celular saiu): nada sai pelo WhatsApp; reconectar o MESMO número não anuncia de novo.
        await conexao(inst, { state: 'close', statusReason: 401 });
        expect(await doEvolution.ler()).toMatchObject({ instanciaSituacao: 'caiu', instanciaMotivo: expect.stringContaining('O celular saiu da conta') });
        await expect(doEvolution.enviar(telAna, { texto: 'x' })).rejects.toMatchObject({ motivo: 'sem_numero' });
        await conexao(inst, { state: 'open', wuid: '5521988887777@s.whatsapp.net' });
        expect((await doEvolution.ler()).instanciaSituacao).toBe('conectado');
        expect(await esperarAnuncios(3)).toHaveLength(2);

        // ── A troca: a volta para a oficial pede a oficial conectada; a ida para o QR, o celular conectado.
        await qr.trocar({ para: 'oficial' });
        expect((await doEvolution.ler()).provedor).toBe('oficial');
        await expect(qr.trocar({ para: 'outra' })).rejects.toBeInstanceOf(BadRequestException);
        expect((await qr.trocar({ para: 'qr' })).provedor).toBe('evolution');
        expect(await esperarAnuncios(3)).toHaveLength(2); // o mesmo número: nada de anúncio
        await numeroZerado();
        await expect(qr.trocar({ para: 'oficial' })).rejects.toBeInstanceOf(ConflictException);
        expect((await doEvolution.ler()).provedor).toBe('evolution');

        // ── Bloqueado pelo WhatsApp (403): "conectar outro número" sai da instância antiga e abre uma NOVA.
        await conexao(inst, { state: 'close', statusReason: 403 });
        expect(await doEvolution.ler()).toMatchObject({ instanciaSituacao: 'bloqueado', instanciaMotivo: expect.stringContaining('bloqueou') });
        estado = 'connecting';
        const r2 = await qr.gerarQr({ outroNumero: true }, { nome: 'Rodrigo' });
        expect(aoEvolution(`/instance/logout/${inst}`)).toHaveLength(1);
        expect(r2.instancia).not.toBe(inst);
        expect(r2).toMatchObject({ instanciaSituacao: 'conectando', instanciaNumero: null, provedor: 'evolution' });
        // O aviso de conexão da instância NOVA (pela porta do Evolution) conecta. Com a chave geral desligada (o
        // `numeroZerado` desliga), o número novo NÃO é anunciado nem marcado: espera o "Ligar o Mister".
        await conexao(r2.instancia!, { state: 'open', wuid: '5521966665555@s.whatsapp.net' });
        expect(await doEvolution.ler()).toMatchObject({ instanciaSituacao: 'conectado', instanciaNumero: '5521966665555', ligado: false });
        expect(await esperarAnuncios(3)).toHaveLength(2);
        expect((await q(`select numero_anunciado from mister_numero where id = 1`))[0].numero_anunciado).toBe('5521988887777');
        await q(`update mister_numero set ligado = true where id = 1`);
        // O Evolution fora na hora do anúncio: nenhum sai, e o número volta a "não anunciado" para a próxima tentar.
        const evolutionNormal = doEvolution.responder;
        doEvolution.responder = (p) => (p.url.includes('/message/sendText/') ? { status: 500, corpo: { erro: 'fora' } } : evolutionNormal(p));
        const antesDaFalha = doEvolution.pedidos.length;
        expect(await qr.anunciarNumeroNovo()).toBe(0);
        expect(anuncios()).toHaveLength(4); // tentou os dois
        doEvolution.pedidos.splice(antesDaFalha); // as tentativas que falharam saem da conta
        expect((await q(`select numero_anunciado from mister_numero where id = 1`))[0].numero_anunciado).toBe('5521988887777');
        doEvolution.responder = evolutionNormal;
        expect(await qr.anunciarNumeroNovo()).toBe(2);
        const segundos = (await esperarAnuncios(4)).slice(2);
        expect(segundos.map((p) => p.corpo.number).sort()).toEqual([telAna, telCarlos].sort());
        expect(segundos.every((p) => p.url === `https://evolution.teste/message/sendText/${r2.instancia}`)).toBe(true);
        expect(await qr.anunciarNumeroNovo()).toBe(0); // uma vez só

        // ── Desconectar: sai do Evolution; com o QR em uso, nada sai pelo WhatsApp até conectar de novo ou trocar.
        const d = await qr.desconectar();
        expect(aoEvolution(`/instance/logout/${r2.instancia}`)).toHaveLength(1);
        expect(d).toMatchObject({ instanciaSituacao: 'sem', instanciaNumero: null, provedor: 'evolution' });
        await expect(doEvolution.enviar(telAna, { texto: 'x' })).rejects.toMatchObject({ motivo: 'sem_numero' });
        // O "fechou" que o próprio logout dispara não muda o "não conectado".
        await conexao(r2.instancia!, { state: 'close', statusReason: 401 });
        expect((await doEvolution.ler()).instanciaSituacao).toBe('sem');

        // ── No servidor da loja, nada disso muda.
        process.env.EDGE_MODE = 'true';
        await expect(qr.aceitar({ aceito: true, versao: 'v1' }, { nome: 'Rodrigo' })).rejects.toThrow('só muda na nuvem');
        await expect(qr.gerarQr({}, { nome: 'Rodrigo' })).rejects.toThrow('só muda na nuvem');
        delete process.env.EDGE_MODE;
      } finally {
        delete process.env.EDGE_MODE;
        await q(
          `update mister_numero set provedor = 'oficial', instancia = null, instancia_numero = null, instancia_situacao = 'sem', instancia_motivo = null,
                  instancia_situacao_em = null, instancia_conectada_em = null, aceite_por = null, aceite_em = null, aceite_versao = null,
                  numero_anunciado = null, ligado = true where id = 1`,
        );
        await numeroConectado(true);
        for (const [k, v] of [['EVOLUTION_API_URL', antes.url], ['EVOLUTION_API_KEY', antes.chave], ['BOT_RESOLVER_SECRET', antes.segredo], ['PUBLIC_API_BASE', antes.base]] as const) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
      }
    });

    // ───────────────────────────── os relatórios (mig 420) ─────────────────────────────

    it('a configuração dos relatórios: o padrão desligado, o salvar com a auditoria e as recusas antes de gravar', async () => {
      const relatoriosConfig = new MisterRelatoriosConfigService(db, auditoria);
      const tela = await relatoriosConfig.daTela(A);
      expect(tela.relatorios.map((r) => [r.tipo, r.regra, r.ultimo])).toEqual([
        ['resumo_dia', { ligado: false, hora: '23:30', diaSemana: null }, null],
        ['resumo_semana', { ligado: false, hora: '09:00', diaSemana: 1 }, null],
        ['fichas_novas', { ligado: false, hora: '09:00', diaSemana: null }, null],
      ]);
      // F4c: o das fichas novas diz para quem vai e que não usa a IA.
      expect(tela.relatorios.map((r) => [r.tipo, r.usaIa, !!r.vaiPara])).toEqual([
        ['resumo_dia', true, false],
        ['resumo_semana', true, false],
        ['fichas_novas', false, true],
      ]);
      const salvo = await relatoriosConfig.salvar(usuario('ana'), { relatorios: [{ tipo: 'resumo_dia', ligado: true, hora: '22:00' }] });
      expect(salvo.relatorios[0].regra).toEqual({ ligado: true, hora: '22:00', diaSemana: null });
      const [aud] = auditados.filter((a) => a.acao === 'mister_relatorios_alterados');
      expect(aud).toMatchObject({ tenantId: A, atorId: pessoa.ana, detalhe: { mudou: [{ tipo: 'resumo_dia', antes: { ligado: false, hora: '23:30' }, depois: { ligado: true, hora: '22:00' } }] } });
      // A recusa vem antes de gravar: nada muda.
      await expect(relatoriosConfig.salvar(usuario('ana'), { relatorios: [{ tipo: 'resumo_semana', ligado: true, hora: '09:00' }] })).rejects.toThrow('escolha o dia da semana');
      expect((await relatoriosConfig.daTela(A)).relatorios[1].regra.ligado).toBe(false);
      // A rotina vê só o que está ligado; a outra empresa segue no padrão.
      expect((await relatoriosConfig.ligadas()).filter((l) => [A, B].includes(l.tenantId))).toEqual([{ tenantId: A, tipo: 'resumo_dia', regra: { ligado: true, hora: '22:00', diaSemana: null } }]);
      expect((await relatoriosConfig.daTela(B)).relatorios[0].regra.ligado).toBe(false);
    });

    it('a volta dos relatórios: um resumo por pessoa no escopo dela, uma vez, fora da janela o convite pelo modelo (a IA só no toque), e os motivos', async () => {
      const relatoriosConfig = new MisterRelatoriosConfigService(db, auditoria);
      const pedidos: any[] = [];
      const trilha = { modelo: 'claude-haiku-5-5', chamadas: 1, tokensEntrada: 10, tokensSaida: 5, ferramentas: [] };
      let resposta: any = { texto: '**Resumo de sábado, 14/11**\n12 pedidos', motivo: null, trilha, resultados: [] };
      const agenteDeTeste = {
        responder: async (escopo: any, memoria: any, pergunta: string, opcoes: any) => {
          pedidos.push({ quem: escopo.colaboradorId, nivel: escopo.nivel, presa: escopo.presa, memoria, pergunta, opcoes });
          return resposta;
        },
      } as any;
      const relatorios = new MisterRelatoriosService(db, relatoriosConfig, agenteDeTeste, ferramentas, numero, entrada);
      // O toque em "Ver resumo" chega pela entrada: o serviço dos relatórios se apresenta a ela, como ao subir o app.
      relatorios.onModuleInit();
      await modulo(A, true);
      await numeroConectado(true);
      const telAna = telefone();
      const telCarlos = telefone();
      await ligar('ana', telAna);
      await ligar('carlos', telCarlos, A, 'gerente');
      const agora = new Date();
      // O horário foi 10 minutos atrás (depois da meia-noite, foi ontem — a regra trata a virada).
      await relatoriosConfig.salvar(usuario('ana'), { relatorios: [{ tipo: 'resumo_dia', ligado: true, hora: horaNoFuso(new Date(agora.getTime() - 10 * 60_000)) }] });
      // Carlos falou com o Mister há 25 horas: fora da janela da Meta.
      await q(`update mister_vinculo set ultima_entrada_em = now() - interval '25 hours' where colaborador_id = $1`, [pessoa.carlos]);
      numero.pedidos.length = 0;
      expect(await relatorios.volta(agora, [A])).toEqual({ devidos: 1, feitos: 2, enviados: 1, naoEnviados: 0, convites: 1 });
      // Só a Ana chamou a IA (o Carlos, fora da janela, recebe o convite e não gasta), no escopo dela, sem memória e com o
      // recurso do relatório.
      expect(pedidos).toHaveLength(1);
      expect(pedidos[0]).toMatchObject({ quem: pessoa.ana, nivel: 'presidente', memoria: [], opcoes: { recurso: 'mister_resumo_dia' } });
      expect(pedidos[0].pergunta).toContain('Comece com "*Resumo de');
      // O texto passa pelo filtro de saída (o negrito de dois asteriscos vira o do WhatsApp); o Carlos recebe o modelo.
      const linhasDe = () => q(`select colaborador_id, situacao, motivo, texto, final_do_telefone from mister_relatorio where tenant_id = $1 order by situacao, colaborador_id`, [A]);
      const [convite] = await q(`select id::text as id, trilha from mister_relatorio where colaborador_id = $1`, [pessoa.carlos]);
      expect(numero.enviadas).toEqual([
        { para: telAna, texto: '*Resumo de sábado, 14/11*\n12 pedidos', botoes: [] },
        { para: telCarlos, texto: expect.stringMatching(new RegExp(`^modelo:mister_resumo_pronto:resumo de [^,]+, \\d\\d/\\d\\d\\|${NOME_A}$`)), botoes: [{ id: `mister:resumo:${convite.id}`, titulo: 'modelo' }] },
      ]);
      expect(await linhasDe()).toEqual([
        { colaborador_id: pessoa.ana, situacao: 'enviado', motivo: null, texto: '*Resumo de sábado, 14/11*\n12 pedidos', final_do_telefone: telAna.slice(-4) },
        { colaborador_id: pessoa.carlos, situacao: 'nao_enviado', motivo: 'convite_enviado', texto: null, final_do_telefone: telCarlos.slice(-4) },
      ]);
      // O período do convite fica na trilha: o toque faz o resumo do MESMO período.
      expect(convite.trilha.convite).toEqual({ referencia: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), ate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
      // A volta seguinte não faz de novo; duas voltas juntas, também não.
      expect(await relatorios.volta(agora, [A])).toMatchObject({ devidos: 1, feitos: 0 });
      await Promise.all([relatorios.volta(agora, [A]), relatorios.volta(agora, [A])]);
      expect(pedidos).toHaveLength(1);

      // O toque em "Ver resumo". A Ana não pega o resumo do Carlos.
      numero.pedidos.length = 0;
      expect(await mandar(telAna, 'Ver resumo', { codigoDoModelo: `mister:resumo:${convite.id}` })).toBe('modelo_nao_achado');
      // A IA não respondeu (sem a chave): o Carlos recebe a frase do motivo e o convite continua valendo.
      resposta = { texto: null, motivo: 'sem_chave', trilha };
      expect(await mandar(telCarlos, 'Ver resumo', { codigoDoModelo: `mister:resumo:${convite.id}` })).toBe('tocou_modelo');
      expect((await linhasDe()).find((l: any) => l.colaborador_id === pessoa.carlos)).toMatchObject({ situacao: 'nao_enviado', motivo: 'convite_enviado' });
      // Agora com a IA: o resumo é feito no escopo DELE (gerente), do mesmo período, e sai.
      resposta = { texto: '**Resumo da loja**\n5 pedidos', motivo: null, trilha, resultados: [] };
      expect(await mandar(telCarlos, 'Ver resumo', { codigoDoModelo: `mister:resumo:${convite.id}` })).toBe('tocou_modelo');
      expect(pedidos).toHaveLength(3);
      expect(pedidos[2]).toMatchObject({ quem: pessoa.carlos, nivel: 'gerente', memoria: [], opcoes: { recurso: 'mister_resumo_dia' } });
      expect(pedidos[2].pergunta).toBe(pedidos[0].pergunta);
      expect(numero.enviadas.map((m) => [m.para, m.texto])).toEqual([
        [telAna, TEXTOS.modeloNaoAchado],
        [telCarlos, TEXTOS_DO_AGENTE.semChave('gerente')],
        [telCarlos, '*Resumo da loja*\n5 pedidos'],
      ]);
      expect((await linhasDe()).find((l: any) => l.colaborador_id === pessoa.carlos)).toMatchObject({ situacao: 'enviado', motivo: null, texto: '*Resumo da loja*\n5 pedidos' });
      // Tocou de novo: o mesmo resumo vai de novo, sem chamar a IA.
      numero.pedidos.length = 0;
      expect(await mandar(telCarlos, 'Ver resumo', { codigoDoModelo: `mister:resumo:${convite.id}` })).toBe('tocou_modelo');
      expect(pedidos).toHaveLength(3);
      expect(numero.enviadas.map((m) => m.texto)).toEqual(['*Resumo da loja*\n5 pedidos']);

      // Sem o modelo aprovado na Meta: fica "fora da janela e sem modelo".
      await q(`delete from mister_relatorio where tenant_id = $1`, [A]);
      await q(`update mister_vinculo set ultima_entrada_em = now() - interval '25 hours' where colaborador_id = $1`, [pessoa.carlos]);
      numero.responder = (p) => (p.corpo?.type === 'template' ? { status: 404, corpo: { error: { code: 132001, message: 'Template name does not exist in the translation' } } } : undefined);
      try {
        expect(await relatorios.volta(agora, [A])).toMatchObject({ feitos: 2, enviados: 1, convites: 0, naoEnviados: 1 });
      } finally {
        numero.responder = () => undefined;
      }
      expect((await linhasDe()).find((l: any) => l.colaborador_id === pessoa.carlos)).toMatchObject({ situacao: 'nao_enviado', motivo: 'fora_da_janela_e_sem_modelo' });
      expect(pedidos).toHaveLength(4);
      // A tela mostra o último envio.
      expect((await relatoriosConfig.daTela(A)).relatorios[0].ultimo).toMatchObject({ situacao: expect.stringMatching(/^(enviado|nao_enviado)$/) });

      // Outro dia (a linha de hoje some): sem a chave de IA, não sai e fica o motivo; ninguém recebe mensagem.
      await q(`delete from mister_relatorio where tenant_id = $1`, [A]);
      await q(`update mister_vinculo set ultima_entrada_em = now() where tenant_id = $1`, [A]);
      resposta = { texto: null, motivo: 'sem_chave', trilha };
      numero.pedidos.length = 0;
      expect(await relatorios.volta(agora, [A])).toMatchObject({ feitos: 2, enviados: 0, naoEnviados: 2 });
      expect(numero.enviadas).toEqual([]);
      expect((await linhasDe()).map((l: any) => l.motivo)).toEqual(['sem_chave', 'sem_chave']);

      // O WhatsApp recusou: o texto fica guardado com o motivo do envio.
      await q(`delete from mister_relatorio where tenant_id = $1`, [A]);
      resposta = { texto: 'Resumo sem vendas.', motivo: null, trilha, resultados: [] };
      numero.responder = () => ({ status: 400, corpo: { error: { code: 131047, message: 'Re-engagement message' } } });
      try {
        expect(await relatorios.volta(agora, [A])).toMatchObject({ feitos: 2, enviados: 0, naoEnviados: 2 });
      } finally {
        numero.responder = () => undefined;
      }
      const recusadas = await linhasDe();
      expect(recusadas.every((l: any) => String(l.motivo).startsWith('envio') && l.texto === 'Resumo sem vendas.')).toBe(true);

      // Quem respondeu PARAR AVISOS não recebe; a chave geral desligada não faz nada (e não gasta).
      await q(`delete from mister_relatorio where tenant_id = $1`, [A]);
      await q(`update mister_vinculo set pausado_em = now() where colaborador_id = $1`, [pessoa.carlos]);
      resposta = { texto: 'Resumo.', motivo: null, trilha, resultados: [] };
      const antes = pedidos.length;
      expect(await relatorios.volta(agora, [A])).toMatchObject({ feitos: 1, enviados: 1 });
      expect(pedidos.slice(antes).map((p) => p.quem)).toEqual([pessoa.ana]);
      await q(`delete from mister_relatorio where tenant_id = $1`, [A]);
      await numeroConectado(false);
      expect(await relatorios.volta(agora, [A])).toEqual({ devidos: 0, feitos: 0, enviados: 0, naoEnviados: 0, convites: 0 });
      expect(await linhasDe()).toEqual([]);
      await numeroConectado(true);

      // O relatório desligado não vence; a linha "fazendo" de 40 minutos atrás foi interrompida.
      await relatoriosConfig.salvar(usuario('ana'), { relatorios: [{ tipo: 'resumo_dia', ligado: false, hora: '22:00' }] });
      await q(
        `insert into mister_relatorio (tenant_id, tipo, referencia, colaborador_id, criado_em) values ($1, 'resumo_dia', '2026-01-01', $2, clock_timestamp() - interval '40 minutes')`,
        [A, pessoa.ana],
      );
      expect(await relatorios.volta(agora, [A])).toMatchObject({ devidos: 0 });
      expect(await linhasDe()).toEqual([expect.objectContaining({ situacao: 'nao_enviado', motivo: 'interrompido' })]);
    });

    // F4c das vagas: o resumo das fichas novas. A leitura das fichas (o banco das vagas, a permissão, as lojas) é testada na
    // `vagas-pg.spec.ts`, que já aplica a cadeia das vagas (ERR-451); aqui ela é um dublê, e o que se prova é o fluxo.
    it('F4c: as fichas novas saem sem a IA, só com ficha; fora da janela o convite e, no toque, a lista da MESMA janela', async () => {
      const relatoriosConfig = new MisterRelatoriosConfigService(db, auditoria);
      const pedidosAIa: any[] = [];
      const agenteDeTeste = { responder: async (...a: any[]) => (pedidosAIa.push(a), { texto: 'x', motivo: null, trilha: {}, resultados: [] }) } as any;
      const relatorios = new MisterRelatoriosService(db, relatoriosConfig, agenteDeTeste, ferramentas, numero, entrada);
      relatorios.onModuleInit();
      const lidas: any[] = [];
      let resposta: { texto: string; total: number } | null = null;
      (relatorios as any).fichasDaPessoa = async (t: string, c: string, tel: string, d: any) => {
        lidas.push({ t, c, tel, d });
        return resposta;
      };
      await modulo(A, true);
      await numeroConectado(true);
      const telAna = telefone();
      const telCarlos = telefone();
      await ligar('ana', telAna);
      await ligar('carlos', telCarlos, A, 'gerente');
      const agora = new Date();
      const hora = horaNoFuso(new Date(agora.getTime() - 10 * 60_000));
      await relatoriosConfig.salvar(usuario('ana'), { relatorios: [{ tipo: 'fichas_novas', ligado: true, hora }] });
      const linhasDe = () => q(`select colaborador_id, tipo, situacao, motivo, texto from mister_relatorio where tenant_id = $1 order by situacao, colaborador_id`, [A]);

      // Nenhuma ficha na janela: nada sai e nenhuma linha fica (a volta seguinte pergunta de novo, sem gastar nada).
      numero.pedidos.length = 0;
      expect(await relatorios.volta(agora, [A])).toEqual({ devidos: 1, feitos: 0, enviados: 0, naoEnviados: 0, convites: 0 });
      expect(numero.enviadas).toEqual([]);
      expect(await linhasDe()).toEqual([]);
      expect(lidas.map((l) => l.c).sort()).toEqual([pessoa.ana, pessoa.carlos].sort());
      expect(lidas[0].d).toEqual({ referencia: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), ate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), hora });

      // Com ficha: a Ana (dentro das 24 horas) recebe o texto; o Carlos (fora) recebe o convite pelo modelo. A IA não é chamada.
      await q(`update mister_vinculo set ultima_entrada_em = now() - interval '25 hours' where colaborador_id = $1`, [pessoa.carlos]);
      resposta = { texto: 'Bom dia, Ana! Chegou *1 ficha nova* na Página de vagas da Loja Centro desde ontem às 9h:', total: 1 };
      expect(await relatorios.volta(agora, [A])).toEqual({ devidos: 1, feitos: 2, enviados: 1, naoEnviados: 0, convites: 1 });
      expect(pedidosAIa).toEqual([]);
      const [convite] = await q(`select id::text as id, trilha from mister_relatorio where colaborador_id = $1 and tipo = 'fichas_novas'`, [pessoa.carlos]);
      expect(convite.trilha).toEqual({ convite: { referencia: lidas[0].d.referencia, ate: lidas[0].d.ate, hora }, fichas: 1 });
      expect(numero.enviadas).toEqual([
        { para: telAna, texto: resposta.texto, botoes: [] },
        {
          para: telCarlos,
          texto: expect.stringMatching(new RegExp(`^modelo:mister_resumo_pronto:resumo das fichas novas de candidatos de \\d\\d/\\d\\d\\|${NOME_A}$`)),
          botoes: [{ id: `mister:resumo:${convite.id}`, titulo: 'modelo' }],
        },
      ]);
      expect((await linhasDe()).map((l: any) => [l.colaborador_id, l.tipo, l.situacao, l.motivo])).toEqual([
        [pessoa.ana, 'fichas_novas', 'enviado', null],
        [pessoa.carlos, 'fichas_novas', 'nao_enviado', 'convite_enviado'],
      ]);
      // A volta seguinte não repete.
      expect(await relatorios.volta(agora, [A])).toMatchObject({ devidos: 1, feitos: 0 });

      // O toque em "Ver resumo": a lista é lida de novo, para a MESMA janela, no nome de quem tocou; sai sem a IA.
      numero.pedidos.length = 0;
      lidas.length = 0;
      resposta = { texto: 'Bom dia, Carlos! Chegou *1 ficha nova*', total: 1 };
      expect(await mandar(telCarlos, 'Ver resumo', { codigoDoModelo: `mister:resumo:${convite.id}` })).toBe('tocou_modelo');
      expect(lidas).toEqual([{ t: A, c: pessoa.carlos, tel: telCarlos, d: convite.trilha.convite }]);
      expect(numero.enviadas.map((m) => [m.para, m.texto])).toEqual([[telCarlos, 'Bom dia, Carlos! Chegou *1 ficha nova*']]);
      expect((await linhasDe()).find((l: any) => l.colaborador_id === pessoa.carlos)).toMatchObject({ situacao: 'enviado', motivo: null, texto: 'Bom dia, Carlos! Chegou *1 ficha nova*' });
      expect(pedidosAIa).toEqual([]);

      // As fichas sumiram antes do toque (apagadas, ou a pessoa perdeu a permissão): a pessoa fica sabendo; a linha, o motivo.
      await q(`update mister_relatorio set situacao = 'nao_enviado', motivo = 'convite_enviado', texto = null where id = $1`, [convite.id]);
      resposta = null;
      numero.pedidos.length = 0;
      expect(await mandar(telCarlos, 'Ver resumo', { codigoDoModelo: `mister:resumo:${convite.id}` })).toBe('tocou_modelo');
      expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringContaining('não estão mais na Página de vagas')]);
      expect((await linhasDe()).find((l: any) => l.colaborador_id === pessoa.carlos)).toMatchObject({ situacao: 'nao_enviado', motivo: 'sem_fichas', texto: null });
      // A Ana não pega o resumo do Carlos.
      numero.pedidos.length = 0;
      expect(await mandar(telAna, 'Ver resumo', { codigoDoModelo: `mister:resumo:${convite.id}` })).toBe('modelo_nao_achado');
    });

    // ─────────────── M3a (mig 439): o boleto e a conta por foto ───────────────
    // A IA de mentira devolve a LEITURA (o JSON das instruções); quem decide é o código (os dígitos da linha conferem ou
    // não) e o cadastro (o fornecedor existe ou não). A conta a pagar sai pelo serviço DE VERDADE do Financeiro.
    describe('os documentos por foto (M3a)', () => {
      const financeiro = new FinanceiroService(db, auditoria, {} as any);
      const documentos = new DocumentosDeTeste(db, numero, ia, financeiro, entrada, auditoria);
      /** R$ 1.284,90, vence 25/11/2026 (boleto bancário feito à mão, os mesmos vetores do `common/boleto.spec.ts`). */
      const LINHA_DO_BOLETO = '00191234546789012345767890123457716410000128490';
      const CODIGO_DO_BOLETO = '00197164100001284901234567890123456789012345';
      /** R$ 480,00 (arrecadação, segmento 3): o vencimento não está no código. */
      const LINHA_DA_CONTA = '836400000045800001234569789012345672890123456786';
      const CNPJ = '12345678000195';
      let fornecedorDeA: string;
      let telAna: string;
      let telCarlos: string;
      const leitura = (l: Record<string, unknown>) =>
        falar(JSON.stringify({ tipo: 'boleto', linhaDigitavel: null, beneficiario: null, cnpj: null, valor: null, vencimento: null, legivel: true, ...l }));
      const novaMidia = (mime = 'image/jpeg') => {
        const id = String(randomInt(1e9, 1e10));
        numero.midias.set(id, { mime, bytes: Buffer.from(`foto-${id}`) });
        return id;
      };
      const foto = (tel: string, mediaId: string, mime = 'image/jpeg') =>
        entrada.receber({ telefone: tel, texto: '', wamid: wamid(), midia: { tipo: mime.startsWith('image/') ? 'imagem' : 'documento', id: mediaId, mime } });
      const docs = () => q(`select * from mister_documento where tenant_id = any($1::uuid[]) order by criado_em`, [[A, B]]);
      const titulos = () =>
        q(
          `select id, tipo, origem, valor::text as valor, status, fornecedor_id, criado_por_id, vencimento::text as vencimento, descricao
             from titulo_financeiro where tenant_id = $1 order by created_at`,
          [A],
        );
      const tocar = (tel: string, botaoId: string) => mandar(tel, 'botão', { botaoId });
      const baixou = () => numero.pedidos.filter((p) => p.metodo === 'GET').map((p) => p.url);

      beforeAll(async () => {
        // O toque em "Desfazer"/"Lançar" e a foto chegam pela entrada: o serviço se apresenta a ela, como ao subir o app.
        documentos.onModuleInit();
        [{ id: fornecedorDeA }] = await q(`insert into fornecedor (tenant_id, nome, cnpj) values ($1, 'Distribuidora Carne Boa', '12.345.678/0001-95') returning id`, [A]);
      });
      beforeEach(async () => {
        process.env.MISTER_DOCUMENTOS = '1';
        comIa();
        await q(`delete from titulo_financeiro where tenant_id = any($1::uuid[])`, [[A, B]]);
        telAna = telefone();
        await ligar('ana', telAna);
        telCarlos = telefone();
        await ligar('carlos', telCarlos, A, 'gerente');
        numero.pedidos.length = 0;
      });
      afterEach(() => {
        delete process.env.MISTER_DOCUMENTOS;
      });

      it('o boleto bancário que confere, de fornecedor cadastrado, entra sozinho nas contas a pagar — e o "Desfazer" tira', async () => {
        const id = novaMidia();
        // O nome no boleto é o da razão social (diferente do cadastro): o fornecedor é achado pelo CNPJ.
        ia.roteiro = [leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: 'DISTRIBUIDORA CARNE BOA LTDA', cnpj: CNPJ, valor: '1.284,90', vencimento: '2026-11-25' })];
        expect(await foto(telAna, id)).toBe('documento');

        // Baixou com a credencial da distribuição; a imagem foi só na chamada da IA (o modelo mais forte, o recurso próprio no medidor).
        expect(baixou()).toEqual([`${GRAPH}/${id}`, `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${id}`]);
        expect(ia.pedidos).toHaveLength(1);
        expect(ia.pedidos[0].model).toBe('claude-sonnet-5-5');
        expect(ia.pedidos[0].messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: Buffer.from(`foto-${id}`).toString('base64') } });
        expect(await q(`select recurso, origem from ia_uso_dia where tenant_id = $1`, [A])).toEqual([{ recurso: 'mister_documento', origem: 'distribuicao' }]);

        // A conta a pagar: pelo serviço da tela, com a origem "mister", o fornecedor achado pelo CNPJ e quem mandou a foto.
        const [t] = await titulos();
        expect(t).toMatchObject({ tipo: 'pagar', origem: 'mister', status: 'aberto', fornecedor_id: fornecedorDeA, criado_por_id: pessoa.ana, vencimento: '2026-11-25', descricao: 'Boleto · DISTRIBUIDORA CARNE BOA LTDA' });
        expect(Number(t.valor)).toBe(1284.9);
        const [d] = await docs();
        expect(d).toMatchObject({ situacao: 'lancado', tipo: 'boleto', titulo_id: t.id, valor_centavos: '128490', colaborador_id: pessoa.ana, fornecedor_id: fornecedorDeA, codigo_barras: CODIGO_DO_BOLETO, telefone_final: telAna.slice(-4) });
        expect(d.dados).toEqual({ origem: { valor: 'codigo', vencimento: 'codigo' }, vencimento: '2026-11-25', cnpj: CNPJ });
        expect(numero.enviadas).toHaveLength(1);
        expect(numero.enviadas[0]).toMatchObject({ para: telAna, botoes: [{ id: `doc:desfazer:${d.id}`, titulo: 'Desfazer' }] });
        expect(numero.enviadas[0].texto).toContain('R$ 1.284,90 · vence 25/11 (quarta)');
        expect(numero.enviadas[0].texto).toContain('Lancei nas contas a pagar');
        expect(auditados.map((a) => a.acao)).toEqual(expect.arrayContaining(['criou_titulo', 'mister_documento_lancado']));

        // "Desfazer": o MESMO cancelamento da tela; o segundo toque não faz nada.
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:desfazer:${d.id}`)).toBe('respondeu_proposta');
        expect((await titulos())[0].status).toBe('cancelado');
        expect((await docs())[0].situacao).toBe('desfeito');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.desfeito]);
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:desfazer:${d.id}`)).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.naoDaParaDesfazer]);
        expect(await titulos()).toHaveLength(1);
      });

      it('a conta de consumo pergunta antes; o gerente e a outra empresa não lançam; o toque repetido não lança duas vezes; paga, não desfaz', async () => {
        ia.roteiro = [leitura({ tipo: 'conta', linhaDigitavel: LINHA_DA_CONTA, beneficiario: 'Light', valor: '480,00', vencimento: '2026-11-28' })];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(await titulos()).toEqual([]);
        const [d] = await docs();
        expect(d).toMatchObject({ situacao: 'confirmar', motivo: 'conta', tipo: 'conta', valor_centavos: '48000', fornecedor_id: null });
        expect(numero.enviadas[0].texto).toContain('o vencimento eu li da foto');
        expect(numero.enviadas[0].botoes).toEqual([
          { id: `doc:lancar:${d.id}`, titulo: 'Lançar' },
          { id: `doc:outra:${d.id}`, titulo: 'Mandar outra foto' },
        ]);

        // O gerente da mesma empresa toca: não lança.
        numero.pedidos.length = 0;
        expect(await tocar(telCarlos, `doc:lancar:${d.id}`)).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => [m.para, m.texto])).toEqual([[telCarlos, FRASES_DO_DOCUMENTO.soPresidente]]);
        // A presidente da OUTRA empresa: o documento não é dela (nem se confirma que existe).
        const telAnaB = telefone();
        await ligar('anaB', telAnaB, B);
        expect(await tocar(telAnaB, `doc:lancar:${d.id}`)).toBe('proposta_nao_achada');
        expect(await titulos()).toEqual([]);

        // A Ana lança — dois toques AO MESMO TEMPO (dois aparelhos, ou o toque repetido): uma conta só.
        numero.pedidos.length = 0;
        documentos.juntar = 2;
        expect(await Promise.all([tocar(telAna, `doc:lancar:${d.id}`), tocar(telAna, `doc:lancar:${d.id}`)])).toEqual(['respondeu_proposta', 'respondeu_proposta']);
        const ts = await titulos();
        expect(ts).toHaveLength(1);
        expect(ts[0]).toMatchObject({ origem: 'mister', vencimento: '2026-11-28', fornecedor_id: null, descricao: 'Conta · Light' });
        expect(Number(ts[0].valor)).toBe(480);
        expect(numero.enviadas.map((m) => m.texto).sort()).toEqual([FRASES_DO_DOCUMENTO.jaRespondido, 'Lancei nas contas a pagar, para 28/11.']);
        expect(numero.enviadas.find((m) => m.texto.startsWith('Lancei'))!.botoes).toEqual([{ id: `doc:desfazer:${d.id}`, titulo: 'Desfazer' }]);
        // E o toque depois, sozinho, também não.
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:lancar:${d.id}`)).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.jaRespondido]);
        expect(await titulos()).toHaveLength(1);

        // Paga na tela: o "Desfazer" já não tira, e o documento continua lançado.
        await q(`update titulo_financeiro set status = 'pago' where id = $1`, [ts[0].id]);
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:desfazer:${d.id}`)).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.naoDaParaDesfazer]);
        expect((await docs())[0].situacao).toBe('lancado');
        expect((await titulos())[0].status).toBe('pago');
      });

      it('a linha que não confere pede outra foto; o fornecedor novo pergunta e "Mandar outra foto" fecha; sem o valor, diz o que faltou', async () => {
        // Um dígito trocado na linha: os verificadores não fecham — nada é lançado, nem com o valor que a IA leu.
        const errada = LINHA_DO_BOLETO.slice(0, 15) + ((Number(LINHA_DO_BOLETO[15]) + 1) % 10) + LINHA_DO_BOLETO.slice(16);
        ia.roteiro = [leitura({ linhaDigitavel: errada, beneficiario: 'Distribuidora Carne Boa', cnpj: CNPJ, valor: '1.284,90', vencimento: '2026-11-25' })];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.outraFoto('codigo_nao_confere')]);
        expect((await docs())[0]).toMatchObject({ situacao: 'recusado', motivo: 'codigo_nao_confere' });

        // A linha confere, mas o beneficiário não é fornecedor: pergunta.
        ia.roteiro = [leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: 'Atacadão Novo', cnpj: '98765432000110', valor: '1.284,90', vencimento: '2026-11-25' })];
        numero.pedidos.length = 0;
        expect(await foto(telAna, novaMidia())).toBe('documento');
        const d = (await docs())[1];
        expect(d).toMatchObject({ situacao: 'confirmar', motivo: 'fornecedor_novo', fornecedor_id: null });
        expect(numero.enviadas[0].texto).toContain('Atacadão Novo ainda não está nos seus fornecedores');
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:outra:${d.id}`)).toBe('respondeu_proposta');
        expect((await docs())[1]).toMatchObject({ situacao: 'recusado', motivo: 'outra_foto' });
        expect(numero.enviadas[0].texto).toContain('manda a outra foto');
        // Depois de "Mandar outra foto", o "Lançar" da mesma mensagem não lança.
        expect(await tocar(telAna, `doc:lancar:${d.id}`)).toBe('respondeu_proposta');

        // Sem código e sem o valor: diz o que faltou.
        ia.roteiro = [leitura({ beneficiario: 'Gráfica Rápida', vencimento: '2026-11-30' })];
        numero.pedidos.length = 0;
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.perguntar(['valor'])]);
        expect((await docs())[2]).toMatchObject({ situacao: 'falta', motivo: 'valor' });
        expect(await titulos()).toEqual([]);

        // Sem o CNPJ, o fornecedor é achado pelo nome igual (sem caixa e sem os espaços a mais): lança sozinho.
        ia.roteiro = [leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: '  distribuidora   CARNE boa ', valor: '1.284,90', vencimento: '2026-11-25' })];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect((await docs())[3]).toMatchObject({ situacao: 'lancado', fornecedor_id: fornecedorDeA });
        expect(await titulos()).toMatchObject([{ fornecedor_id: fornecedorDeA, status: 'aberto' }]);
      });

      it('o PDF que chega pelo webhook vai à IA como documento; a leitura fora do formato pede outra foto; o reenvio da Meta não lê de novo', async () => {
        const id = novaMidia('application/pdf');
        ia.roteiro = [falar('Não consegui ler esse arquivo.')];
        const w = wamid();
        const mensagem = { from: telAna, id: w, type: 'document', document: { id, mime_type: 'application/pdf', filename: 'boleto.pdf' } };
        expect(await entrada.receberDaMeta(PHONE_ID, { messages: [mensagem] })).toBe(true);
        expect(await q(`select desfecho, tenant_id from mister_mensagem where wamid = $1`, [w])).toEqual([{ desfecho: 'documento', tenant_id: A }]);
        expect(ia.pedidos[0].messages[0].content[0]).toEqual({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from(`foto-${id}`).toString('base64') } });
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.outraFoto('ilegivel')]);
        expect(await docs()).toMatchObject([{ situacao: 'recusado', motivo: 'leitura_fora_do_formato', wamid: w }]);
        expect(await entrada.receberDaMeta(PHONE_ID, { messages: [mensagem] })).toBe(true);
        expect(ia.pedidos).toHaveLength(1);
        expect(await docs()).toHaveLength(1);
      });

      it('o gerente: "só com o presidente", sem baixar nem chamar a IA; sem IA ou com a IA falhando, a frase; a chave desligada segue como antes', async () => {
        expect(await foto(telCarlos, novaMidia())).toBe('documento');
        expect(numero.enviadas.map((m) => [m.para, m.texto])).toEqual([[telCarlos, FRASES_DO_DOCUMENTO.soPresidente]]);
        expect(baixou()).toEqual([]);
        expect(ia.pedidos).toEqual([]);

        // Sem IA (nem a chave da empresa, nem a da distribuição): não baixa.
        delete process.env.ANTHROPIC_API_KEY;
        numero.pedidos.length = 0;
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.semIa]);
        expect(baixou()).toEqual([]);

        // A IA falha no meio.
        comIa();
        ia.roteiro = [{ erro: Object.assign(new Error('Your credit balance is too low'), { status: 402 }) }];
        numero.pedidos.length = 0;
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.semIa]);

        // A mídia que a Meta não entrega (o id não existe): pede outra foto, sem chamar a IA.
        ia.pedidos.length = 0;
        numero.pedidos.length = 0;
        expect(await foto(telAna, '123456789')).toBe('documento');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.outraFoto('ilegivel')]);
        expect(ia.pedidos).toEqual([]);

        // Os metadados apontam para fora dos domínios da Meta: não baixa de lá (o token não sai para outro endereço).
        numero.responder = (p) => (p.url === `${GRAPH}/555666777` ? { status: 200, corpo: { url: 'https://arquivos.exemplo.com/boleto.jpg', mime_type: 'image/jpeg', file_size: 10 } } : undefined);
        numero.pedidos.length = 0;
        expect(await foto(telAna, '555666777')).toBe('documento');
        expect(baixou()).toEqual([`${GRAPH}/555666777`]);
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.outraFoto('ilegivel')]);
        numero.responder = () => undefined;

        // Figurinha e áudio não são com os documentos.
        numero.pedidos.length = 0;
        const figurinha = await entrada.receber({ telefone: telAna, texto: '', wamid: wamid(), midia: { tipo: 'imagem', id: novaMidia('image/x-icon'), mime: 'image/x-icon' } });
        expect(figurinha).toBe('so_texto');

        // A chave dos documentos desligada: a foto segue o caminho de antes ("só leio texto"), sem baixar.
        delete process.env.MISTER_DOCUMENTOS;
        const telOutro = telefone();
        await ligar('ana', telOutro);
        numero.pedidos.length = 0;
        expect(await foto(telOutro, novaMidia())).toBe('so_texto');
        expect(baixou()).toEqual([]);
        expect(await docs()).toEqual([]);
        expect(await titulos()).toEqual([]);
      });
    });
  });
}
