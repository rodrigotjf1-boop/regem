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
import { dataNoFuso, hojeISO, horaNoFuso, somarDias } from '../../common/data';
import { uuidDeChave } from '../../common/id-deterministico';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PausaDoCanalService } from '../delivery/pausa-do-canal.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { EstoqueService } from '../estoque/estoque.service';
import { RecebimentoService } from '../recebimento/recebimento.service';
import { montarChave } from '../fiscal/chave';
import { MisterNotasService } from './mister-notas.service';
import { FalhaDaIa, IaEmpresaService } from '../ia/ia-empresa.service';
import { RelatoriosService } from '../relatorios/relatorios.service';
import { ModuloService } from '../modulo/modulo.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { WhatsappGastoService } from '../whatsapp/whatsapp-gasto.service';
import { MisterConsoleService } from './mister-console.service';
import { FERRAMENTAS, FERRAMENTA_DO_QUE_FALTA, INSTRUCOES_DO_MISTER, TETOS, TEXTOS_DO_AGENTE, filtrarSaida } from './mister-agente.regras';
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
import { MisterConversaConfigService } from './mister-conversa-config.service';
import { MisterMemoriaService } from './mister-memoria.service';
import { RECUSAS_DA_MEMORIA } from './mister-memoria';
import { MisterVigiaService } from './mister-vigia.service';
import { fimDaNoite } from './mister-vigia';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { FRASES_DO_DOCUMENTO } from '../../common/documento-por-foto';
import { crc16Pix } from '../../common/boleto';
import { custosMediosNaLoja } from '../../common/custo-loja';
import { VendasService } from '../vendas/vendas.service';
import { MisterAnexosService } from './mister-anexos.service';
import { MisterLinkPublicoService } from './mister-link-publico.service';
import { MisterRecadosService } from './mister-recados.service';
import { TEXTOS_DO_RECADO } from './mister-recado';
import { MisterPontoDoMesService } from './mister-ponto-do-mes.service';
import { TEXTOS_DO_PONTO_DO_MES } from './mister-ponto-do-mes';
import { PontoService } from '../ponto/ponto.service';
import { MuralService } from '../mural/mural.service';
import { TETO_DE_LINKS_VIVOS, TEXTOS_DO_LINK_PUBLICO } from './mister-link-publico';
import { MisterPropostasService } from './mister-propostas.service';
import { TEXTOS_DA_PROPOSTA, TEXTOS_DO_LINK } from './mister-procedimentos';
import { MODELO_DO_AVISO } from './mister-modelos';
import { EvolutionEntradaService } from '../whatsapp/evolution-entrada.service';
import { MisterFerramentasService } from './mister-ferramentas.service';
import { GraphFotoService } from '../graph/graph-foto.service';
import { MisterMidiaService } from './mister-midia.service';
import { TEXTOS_DA_MIDIA, primeiroDoMesQueVem } from './mister-midia.regras';
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
  protected async buscar(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string | FormData }) {
    // M3a parte 4b: o arquivo sobe à Meta como formulário (`/media`); o corpo anotado é o que o formulário levou.
    const formulario = init?.body instanceof FormData ? init.body : null;
    const corpo = formulario
      ? { formulario: true, type: formulario.get('type'), arquivo: (formulario.get('file') as any)?.name ?? null, bytes: (formulario.get('file') as any)?.size ?? 0 }
      : init?.body
        ? JSON.parse(init.body as string)
        : null;
    const p: Pedido = { url, metodo: init?.method ?? 'GET', corpo };
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
    if (p.url.endsWith('/media') && p.metodo === 'POST') return { id: `${randomInt(1e9, 1e10)}` };
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
        // O documento (M3a parte 4b): "documento:<arquivo>|<legenda>", pelo id que a Meta devolveu no `/media`.
        if (p.corpo.type === 'document')
          return { para: p.corpo.to, texto: `documento:${p.corpo.document.filename}|${p.corpo.document.caption ?? ''}|${p.corpo.document.id}`, botoes: [] };
        // A imagem (M3c.3, o gráfico): "imagem:<id da mídia>".
        // M3d: a imagem pelo endereço público: "imagem:<link>".
        if (p.corpo.type === 'image') return { para: p.corpo.to, texto: `imagem:${p.corpo.image.id ?? p.corpo.image.link}`, botoes: [] };
        // Versão 4: a reação à mensagem da pessoa — "reacao:<emoji>|<id da mensagem>".
        if (p.corpo.type === 'reaction') return { para: p.corpo.to, texto: `reacao:${p.corpo.reaction.emoji}|${p.corpo.reaction.message_id}`, botoes: [] };
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
      await q(`delete from mister_link_publico where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from mister_recado where tenant_id = any($1::uuid[])`, [[A, B]]);
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
        for (const arq of ['415_ia_por_empresa.sql', '417_mister_numero_e_entrada.sql', '418_mister_perguntas.sql', '419_mister_avisos.sql', '420_mister_relatorios.sql', '424_mister_avaliacao.sql', '428_mister_proposta.sql', '432_mister_melhoria_decisao.sql', '433_mister_proposta_link.sql', '372_pedido_estorno.sql', '434_mister_analise.sql', '435_mister_instrucao_troca.sql', '436_mister_numero_provedor.sql', '437_mister_numero_qr.sql', '439_mister_documento.sql', '440_mister_conversa_config.sql', '441_mister_nota.sql', '443_mister_link_publico.sql', '444_mister_recado.sql', '445_whatsapp_gasto.sql', '446_mister_aviso_valores.sql', '447_mister_jeito.sql', '448_whatsapp_gasto_fonte.sql', '449_mister_memoria.sql', '451_whatsapp_gasto_modelos_erro.sql', '452_mister_vigia.sql'])
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

    it('versão 4, a reação: o "valeu" ganha a reação na mensagem da pessoa, sem texto; a reação recusada vira o emoji em texto; frase e reação saem as duas; na memória fica o emoji', async () => {
      comIa();
      const tel = telefone();
      await ligar('ana', tel);
      // Só a reação, com o id da mensagem: reage e não escreve nada (o corpo é o da doc da Meta).
      numero.pedidos.length = 0;
      const id1 = wamid();
      expect(await mandar(tel, 'valeu!', { wamid: id1 })).toBe('pergunta');
      ia.roteiro = [falar('REACAO: 👍')];
      await agente.esvaziar();
      expect(numero.pedidos.filter((p) => p.corpo?.type === 'reaction').map((p) => p.corpo)).toEqual([
        { messaging_product: 'whatsapp', recipient_type: 'individual', to: tel, type: 'reaction', reaction: { message_id: id1, emoji: '👍' } },
      ]);
      expect(numero.enviadas).toEqual([{ para: tel, texto: `reacao:👍|${id1}`, botoes: [] }]);
      // A Meta recusou a reação: o emoji vai como texto — nunca silêncio.
      numero.pedidos.length = 0;
      numero.responder = (p) => (p.corpo?.type === 'reaction' ? { status: 400, corpo: { error: { message: 'recusada' } } } : undefined);
      const id2 = wamid();
      await mandar(tel, 'obrigado', { wamid: id2 });
      ia.roteiro = [falar('REACAO: 🙏')];
      await agente.esvaziar();
      numero.responder = () => undefined;
      expect(numero.enviadas).toEqual([
        { para: tel, texto: `reacao:🙏|${id2}`, botoes: [] },
        { para: tel, texto: '🙏', botoes: [] },
      ]);
      // Frase e reação: reage e manda a frase, sem a linha REACAO.
      numero.pedidos.length = 0;
      const id3 = wamid();
      await mandar(tel, 'show, era isso', { wamid: id3 });
      ia.roteiro = [falar('Disponha! Qualquer coisa é só chamar.\nREACAO: 👏')];
      await agente.esvaziar();
      expect(numero.enviadas).toEqual([
        { para: tel, texto: `reacao:👏|${id3}`, botoes: [] },
        { para: tel, texto: 'Disponha! Qualquer coisa é só chamar.', botoes: [] },
      ]);
      // As três respondidas; na memória, o emoji no lugar da resposta vazia (o modelo não aceita resposta vazia).
      const respondidas = (await perguntasDe('ana')).filter((p) => p.situacao === 'respondida' && p.resposta);
      expect(respondidas.map((p) => p.resposta)).toEqual(['👍', '🙏', 'Disponha! Qualquer coisa é só chamar.']);
      expect((await fila.memoria(A, pessoa.ana)).map((m) => m.resposta)).toEqual(['👍', '🙏', 'Disponha! Qualquer coisa é só chamar.']);
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
        // As consultas da mesma vez rodam juntas (versão 4 do Mister): a ordem ENTRE elas não é fixa. Confere-se o conjunto
        // — cada leitura com a empresa e a loja dela, `null` (todas as lojas) diferente de `undefined`.
        const emOrdem = (l: unknown[][]) => [...l].sort((a, b) => a.map(String).join('|').localeCompare(b.map(String).join('|')));
        expect(emOrdem(lidos)).toEqual(
          emOrdem([
            ['delivery', A, null],
            ['cozinha', A, undefined],
            ['delivery', A, praia],
            ['cozinha', A, praia],
            ['delivery', A, centro],
            ['cozinha', A, centro],
            ['servidor', A],
          ]),
        );
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
      // Versão 4: o mesmo formatador do atendente — o título vira negrito.
      expect(numero.enviadas.at(-1)!.texto).toBe('*Resumo*\n*Hoje*: R$ 0,00 no balcão.\nA meta era R$ 9.999,90. Veja em agora.');
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

    it('versão 4, as conversas anteriores: só as desta pessoa nesta empresa, dos dias pedidos, as que acertam mais palavras primeiro; quem não vê valores recebe sem eles', async () => {
      const chave = () => `conversas-${MARCA}-${randomUUID()}`;
      const guardar = (tenant: string, quem: string, pergunta: string, resposta: string | null, ha: string, situacao = 'respondida', ferramentas: unknown[] = []) =>
        q(
          `insert into mister_pergunta (tenant_id, colaborador_id, nivel, telefone, chave, pergunta, resposta, situacao, ferramentas, criado_em)
           values ($1, $2, 'presidente', '5521900000000', $3, $4, $5, $6, $7::jsonb, now() - $8::interval)`,
          [tenant, quem, chave(), pergunta, resposta, situacao, JSON.stringify(ferramentas), ha],
        );
      try {
        const vendas = [{ nome: 'vendas_do_periodo', ok: true, ms: 1, entrada: {} }, { nome: 'anotar_o_que_falta', ok: true, ms: 1, entrada: { tema: 'outro' } }];
        await guardar(A, pessoa.ana, 'como foi o iFood ontem?', 'Ontem o iFood teve 23 pedidos e R$ 1.874,20.', '2 days', 'respondida', vendas);
        await guardar(A, pessoa.ana, 'e o cancelamento do iFood?', 'O cancelado foi o #188, por falta de entregador.', '1 day');
        await guardar(A, pessoa.ana, 'quanto vendi no balcão?', 'Foram R$ 500,00 no balcão.', '3 hours');
        await guardar(A, pessoa.ana, 'o iFood há dez dias', 'Dez dias atrás o iFood estava pausado.', '10 days');
        // Nada disto aparece: velho demais, ainda em resposta, respondida sem texto (parte de uma junta), outra pessoa, outra empresa.
        await guardar(A, pessoa.ana, 'o iFood há quarenta dias', 'Quarenta dias atrás.', '40 days');
        await guardar(A, pessoa.ana, 'iFood agora?', null, '1 minute', 'respondendo');
        await guardar(A, pessoa.ana, 'iFood (parte de uma junta)', null, '2 days');
        await guardar(A, pessoa.carlos, 'o iFood do Carlos', 'Conversa do Carlos sobre o iFood: R$ 99,90.', '1 day');
        await guardar(B, pessoa.anaB, 'o iFood da outra empresa', 'Conversa da Pizzaria do Porto sobre o iFood.', '1 day');

        const tel = telefone();
        await ligar('ana', tel);
        const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
        const r = await ferramentas.executar(e, 'conversas_anteriores', { busca: 'O que você me disse do iFood e do cancelamento?' });
        expect(r.ok).toBe(true);
        expect(r.dados).toMatchObject({ busca: 'ifood cancelamento', dias: 30, achadas: 3 });
        const conversas = r.dados.conversas as any[];
        // As duas palavras primeiro; depois, só "ifood", da mais nova para a mais velha.
        expect(conversas.map((c) => c.pergunta)).toEqual(['e o cancelamento do iFood?', 'como foi o iFood ontem?', 'o iFood há dez dias']);
        expect(conversas[1]).toEqual({
          quando: expect.stringMatching(/^\d{2}\/\d{2} às \d{2}:\d{2}$/),
          pergunta: 'como foi o iFood ontem?',
          resposta: 'Ontem o iFood teve 23 pedidos e R$ 1.874,20.',
          // Só as consultas (a anotação do que falta não é consulta), como se diz numa frase.
          consultasNaquelaHora: ['vendas do periodo'],
          valoresDitos: [1874.2],
        });
        expect(JSON.stringify(r.dados)).not.toMatch(/Carlos|Pizzaria|quarenta|agora\?|parte de uma junta/);
        // Os dias pedidos: com 5, a de dez dias fica de fora.
        const cinco = await ferramentas.executar(e, 'conversas_anteriores', { busca: 'ifood', dias: 5 });
        expect((cinco.dados.conversas as any[]).map((c) => c.pergunta)).toEqual(['e o cancelamento do iFood?', 'como foi o iFood ontem?']);
        // Sem palavra de assunto: pede as palavras (não varre tudo).
        expect(await ferramentas.executar(e, 'conversas_anteriores', { busca: 'o que você me disse ontem?' })).toEqual({ ok: false, dados: { erro: 'Diga as palavras do assunto (por exemplo: iFood, caixa, carne).' } });
        // Nada achado: diz que não achou e que não se inventa lembrança.
        const nada = await ferramentas.executar(e, 'conversas_anteriores', { busca: 'sobremesa' });
        expect(nada.dados).toMatchObject({ achadas: 0, conversas: [] });
        expect(String(nada.dados.comoUsar)).toContain('não invente lembrança');

        // O gerente (perfil padrão, sem valores em reais) vê só a conversa DELE, sem os valores.
        const telC = telefone();
        await ligar('carlos', telC, A, 'gerente');
        const doCarlos = await ferramentas.executar((await ferramentas.escopo(A, pessoa.carlos, telC))!, 'conversas_anteriores', { busca: 'iFood' });
        expect(doCarlos.dados.conversas).toEqual([
          { quando: expect.any(String), pergunta: 'o iFood do Carlos', resposta: 'Conversa do Carlos sobre o iFood: R$ (oculto).' },
        ]);
      } finally {
        await q(`delete from mister_pergunta where chave like $1`, [`conversas-${MARCA}-%`]);
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

    // ───────────────────────────── o relatório por insumo (M3c) ─────────────────────────────
    // A baixa é a de VERDADE (`VendasService.baixarEstoqueExterno`, a mesma da conclusão do pedido), sobre fichas reais: o
    // total é o que a venda baixou; "de onde saiu" é a ficha de cada produto; o adicional fica em "outros"; a venda
    // cancelada (com o estorno) não conta; a outra empresa não vê nada.
    it('o insumo que a venda baixou pela ficha (M3c): o total, os quilos, por hora, de onde saiu, "outros", a comparação e a escolha', async () => {
      const tel = telefone();
      await ligar('ana', tel);
      const vendasDeVerdade = new VendasService(db, auditoria as any, { emit: () => true } as any, null as any, null as any, {} as any);
      const comInsumo = new MisterFerramentasService(db, modulos, null as any, null as any, null as any, null as any, null as any, null as any, vendasDeVerdade, null as any, null as any);
      const criados: { comandas: string[]; produtos: string[]; fichas: string[]; itens: string[] } = { comandas: [], produtos: [], fichas: [], itens: [] };
      try {
        const insumo = async (nome: string, unidade: string) => {
          const [{ id }] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, $2, $3) returning id::text as id`, [A, nome, unidade]);
          criados.itens.push(id);
          return id as string;
        };
        const c56 = await insumo('Carne 56 g', 'unidade');
        const c120 = await insumo('Carne 120 g', 'unidade');
        const bacon = await insumo('Bacon em tiras', 'kg');
        await q(`insert into item_conversao (tenant_id, item_id, unidade_de, fator, unidade_para) values ($1, $2, 'unidade', 56, 'grama')`, [A, c56]);
        const ficha = async (nome: string, linhas: Array<[string, number]>) => {
          const [{ id }] = await q(`insert into ficha_tecnica (tenant_id, nome) values ($1, $2) returning id::text as id`, [A, nome]);
          criados.fichas.push(id);
          for (const [item, qtd] of linhas) await q(`insert into ficha_ingrediente (tenant_id, ficha_id, item_id, insumo_nome, quantidade) values ($1, $2, $3, 'x', $4)`, [A, id, item, qtd]);
          return id as string;
        };
        const produtoCom = async (nome: string, fichaId: string | null) => {
          const [{ id }] = await q(`insert into produto (tenant_id, nome, ficha_id) values ($1, $2, $3) returning id::text as id`, [A, nome, fichaId]);
          criados.produtos.push(id);
          return id as string;
        };
        const xBurger = await produtoCom('X-Burger', await ficha('X-Burger', [[c56, 1]]));
        const duplo = await produtoCom('Combo Duplo', await ficha('Duplo', [[c56, 2], [bacon, 0.03]]));
        const coca = await produtoCom('Coca-Cola', null);
        const [{ id: grande }] = await q(`insert into produto_variacao (tenant_id, produto_id, nome, fator_ficha) values ($1, $2, 'Grande', 2) returning id::text as id`, [A, xBurger]);
        // Uma venda fechada (há `atras`) com os itens; a baixa pela venda de verdade.
        const venda = async (itens: Array<{ produto: string; qtd: number; variacao?: string; extraCarne?: number }>, atras = "5 seconds", tenant = A) => {
          const [{ id: comanda }] = await q(
            `insert into comanda (tenant_id, unidade_id, status, total, forma, aberta_em, fechada_em) values ($1, $2, 'fechada', 10, 'dinheiro', now() - interval '${atras}' - interval '10 minutes', now() - interval '${atras}') returning id::text as id`,
            [tenant, tenant === A ? lojaDeA : null],
          );
          criados.comandas.push(comanda);
          for (const it of itens) {
            const [{ id: ci }] = await q(`insert into comanda_item (tenant_id, comanda_id, produto_id, variacao_id, descricao, quantidade, preco_unitario) values ($1, $2, $3, $4, 'item', $5, 10) returning id::text as id`, [tenant, comanda, it.produto, it.variacao ?? null, it.qtd]);
            if (it.extraCarne) await q(`insert into comanda_item_complemento (tenant_id, comanda_item_id, tipo, nome, item_id, quantidade) values ($1, $2, 'adicionar', 'Carne extra', $3, $4)`, [tenant, ci, c56, it.extraCarne]);
          }
          await vendasDeVerdade.baixarEstoqueExterno(tenant, comanda, false);
          return comanda;
        };
        await venda([{ produto: xBurger, qtd: 2 }, { produto: coca, qtd: 1 }]); // 2 carnes
        await venda([{ produto: duplo, qtd: 1 }]); // 2 carnes (2 por combo)
        await venda([{ produto: xBurger, qtd: 1, extraCarne: 1 }]); // 1 da ficha + 1 do adicional ("outros")
        await venda([{ produto: xBurger, qtd: 1, variacao: grande }]); // a variação Grande: 2 carnes pela ficha
        // A venda cancelada: a baixa volta pelo estorno (como o cancelamento da tela) e não conta.
        const cancelada = await venda([{ produto: xBurger, qtd: 3 }]);
        await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade, motivo, ref_tipo, ref_id, data) select tenant_id, item_id, 'entrada', quantidade, 'estorno', 'estorno', ref_id, data from movimento_estoque where ref_tipo = 'venda' and ref_id = $1`, [cancelada]);
        await q(`update comanda set status = 'cancelada' where id = $1`, [cancelada]);
        // O mesmo dia da semana passada, até a mesma hora: 1 carne.
        await venda([{ produto: xBurger, qtd: 1 }], '7 days 5 seconds');

        const e = (await comInsumo.escopo(A, pessoa.ana, tel))!;
        const r: any = await comInsumo.executar(e, 'insumo_vendido', { insumo: 'carnes de 56g' });
        expect(r.ok).toBe(true);
        expect(r.dados).toMatchObject({
          loja: 'Loja Centro',
          insumo: 'Carne 56 g',
          unidadeDoEstoque: 'unidade',
          total: 8,
          totalEmQuilos: 0.448, // 8 × 56 g, pela conversão do cadastro
          comparacao: { mediaDasUltimas4: 1, diferencaPct: 700 },
        });
        expect(r.dados.periodo).toMatch(/^hoje \(\d\d\/\d\d\), até \d\d:\d\d$/);
        expect(r.dados.porHora.reduce((a: number, x: any) => a + x.quantidade, 0)).toBe(8);
        expect(r.dados.deOndeSaiu).toEqual([
          { produto: 'X-Burger', quantidade: 3, porUnidadeVendida: 1, unidadesVendidas: 3 },
          { produto: 'Combo Duplo', quantidade: 2, porUnidadeVendida: 2, unidadesVendidas: 1 },
          { produto: 'X-Burger · Grande', quantidade: 2, porUnidadeVendida: 2, unidadesVendidas: 1 },
        ]);
        expect(r.dados.outros).toBe(1); // a carne extra do adicional
        // A medida decide: a de 120 g não vendeu nada hoje (e não puxa a de 56 g).
        expect((await comInsumo.executar(e, 'insumo_vendido', { insumo: 'carne 120g' })).dados).toMatchObject({ insumo: 'Carne 120 g', total: 0, deOndeSaiu: [] });
        // "carne" sozinha: pergunta qual; o que não existe, recusa; o bacon em kg, sem "totalEmQuilos" repetido.
        expect((await comInsumo.executar(e, 'insumo_vendido', { insumo: 'carne' })).dados).toMatchObject({ precisaEscolher: ['Carne 120 g', 'Carne 56 g'] });
        expect(await comInsumo.executar(e, 'insumo_vendido', { insumo: 'detergente' })).toMatchObject({ ok: false });
        const b: any = await comInsumo.executar(e, 'insumo_vendido', { insumo: 'bacon' });
        expect(b.dados).toMatchObject({ insumo: 'Bacon em tiras', total: 0.03 });
        expect(b.dados.totalEmQuilos).toBeUndefined();
        // Vários dias: por dia, com zero onde não vendeu, e sem a comparação.
        const semana: any = await comInsumo.executar(e, 'insumo_vendido', { insumo: 'carne 56 g', periodo: 'ultimos_7_dias' });
        expect(semana.dados.porDia).toHaveLength(7);
        expect(semana.dados.porDia.at(-1).quantidade).toBe(8);
        expect(semana.dados.comparacao).toBeUndefined();
        // A outra empresa não vê a venda desta (o insumo nem existe lá).
        const telB = telefone();
        await ligar('anaB', telB, B);
        const deB = (await comInsumo.escopo(B, pessoa.anaB, telB))!;
        expect(await comInsumo.executar(deB, 'insumo_vendido', { insumo: 'carne 56 g' })).toMatchObject({ ok: false });

        // ── M3c.2: "compara com a semana passada", o PDF e o botão "PDF" ──
        const hoje = hojeISO();
        const d7 = somarDias(hoje, -7);
        const cmp: any = await comInsumo.executar(e, 'insumo_vendido', { insumo: 'carne 56 g', compararDe: d7, compararAte: d7, pdf: true });
        expect(cmp.dados.comparadoCom).toEqual({ periodo: expect.any(String), total: 1, diferencaPct: 700 });
        expect(cmp.dados.pdf).toContain('logo depois da sua resposta');
        // O anexo não vai ao modelo: é o pedido para refazer o relatório (na loja única, sem filtro de loja).
        expect(cmp.anexo).toEqual({ pedido: { insumoId: c56, de: hoje, ate: hoje, loja: null, compararDe: d7, compararAte: d7 }, enviarPdf: true });
        expect(JSON.stringify(cmp.dados)).not.toContain(c56);
        // O PDF, refeito no escopo de quem pede; de outra empresa, o insumo não existe; a data torta é recusada.
        const pdf: any = await comInsumo.pdfDoInsumo(e, cmp.anexo.pedido);
        expect(pdf.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
        expect(pdf.nome).toBe(`carne-56-g-${hoje}.pdf`);
        expect(pdf.legenda).toMatch(/^Carne 56 g · \d\d\/\d\d, até \d\d:\d\d contra \d\d\/\d\d$/);
        expect(await comInsumo.pdfDoInsumo(deB, cmp.anexo.pedido)).toEqual({ erro: 'Este insumo não está mais no estoque.' });
        expect(await comInsumo.pdfDoInsumo(e, { ...cmp.anexo.pedido, de: '2026-02-30', ate: '2026-02-30' })).toMatchObject({ erro: expect.stringContaining('formato') });
        // A loja do botão tem de ser uma que a pessoa consulta: a presa a uma loja e a de uma empresa de várias lojas.
        const outraLoja = randomUUID();
        const fora = { erro: 'Este relatório é de uma loja que você não consulta.' };
        expect(await comInsumo.pdfDoInsumo({ ...e, lojaUnica: false, presa: lojaDeA, lojas: [{ id: lojaDeA, nome: 'Loja Centro' }] }, { ...cmp.anexo.pedido, loja: outraLoja })).toEqual(fora);
        expect(await comInsumo.pdfDoInsumo({ ...e, lojaUnica: false, presa: null, lojas: [{ id: lojaDeA, nome: 'Loja Centro' }] }, { ...cmp.anexo.pedido, loja: outraLoja })).toEqual(fora);
        expect(await comInsumo.pdfDoInsumo({ ...e, lojaUnica: false, presa: null, lojas: [{ id: lojaDeA, nome: 'Loja Centro' }] }, { ...cmp.anexo.pedido, loja: lojaDeA })).toMatchObject({ nome: `carne-56-g-${hoje}.pdf` });

        // ── M3c.4: a página do relatório no Regem, no escopo de quem está logado (sem telefone) ──
        const daTela = (await comInsumo.escopoDaTela(A, pessoa.ana))!;
        expect(daTela).toMatchObject({ nivel: 'presidente', lojaUnica: true, tenantId: A });
        const pagina: any = await comInsumo.relatorioDoPedido(daTela, cmp.anexo.pedido);
        expect(pagina.plano.titulo).toMatch(/^Carne 56 g · \d\d\/\d\d, até \d\d:\d\d contra \d\d\/\d\d$/);
        expect(pagina.plano.numeros[0]).toEqual({ valor: '8 unidades', rotulo: 'Loja Centro' });
        expect(pagina.relatorio.total).toBe(8);
        // Quem não é presidente nem gerente (ou não está mais ativo) não abre; a empresa B não vê o insumo de A.
        expect(await comInsumo.escopoDaTela(A, randomUUID())).toBeNull();
        expect(await comInsumo.escopoDaTela(A, pessoa.carlos)).toMatchObject({ nivel: 'gerente' });
        await q(`update colaborador set status = 'bloqueado' where id = $1`, [pessoa.carlos]);
        expect(await comInsumo.escopoDaTela(A, pessoa.carlos)).toBeNull();
        await q(`update colaborador set status = 'ativo', funcao_id = $2 where id = $1`, [pessoa.carlos, funcao['execucao-a']]);
        expect(await comInsumo.escopoDaTela(A, pessoa.carlos)).toBeNull();
        await q(`update colaborador set funcao_id = $2 where id = $1`, [pessoa.carlos, funcao['gerente-a']]);
        expect(await comInsumo.relatorioDoPedido((await comInsumo.escopoDaTela(B, pessoa.anaB))!, cmp.anexo.pedido)).toEqual({ erro: 'Este insumo não está mais no estoque.' });
        // O link da resposta: a página do Regem com o pedido (abre com o usuário de quem toca).
        const base = String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
        const comLink = (texto: string, de: string, ate: string) => `${texto}\n\nVer no Regem: ${base}/mister/relatorio?insumo=${c56}&de=${de}&ate=${ate}`;

        // O agente: "manda em PDF" → a resposta e logo depois o documento (sem botão).
        comIa();
        const agenteComInsumo = new MisterAgenteService(fila, comInsumo, ia, numero);
        numero.pedidos.length = 0;
        await perguntar(tel, 'quantas carnes de 56g hoje? manda em PDF');
        ia.roteiro = [usar('insumo_vendido', { insumo: 'carne 56 g', pdf: true }), falar('Hoje, 8 carnes de 56 g. O PDF vai em seguida.')];
        await agenteComInsumo.esvaziar();
        expect(numero.enviadas.map((m) => m.texto)).toEqual([
          comLink('Hoje, 8 carnes de 56 g. O PDF vai em seguida.', hoje, hoje),
          expect.stringMatching(new RegExp(`^documento:carne-56-g-${hoje}\\.pdf\\|Carne 56 g · `)),
        ]);
        expect(numero.enviadas[0].botoes).toEqual([]);
        // Sem pedir o PDF: o botão "PDF" no balão da resposta.
        numero.pedidos.length = 0;
        await perguntar(tel, 'e quantas hoje?');
        ia.roteiro = [usar('insumo_vendido', { insumo: 'carne 56 g' }), falar('Hoje, 8 carnes de 56 g.')];
        await agenteComInsumo.esvaziar();
        expect(numero.enviadas).toHaveLength(1);
        const [resposta] = numero.enviadas;
        expect(resposta).toMatchObject({ texto: comLink('Hoje, 8 carnes de 56 g.', hoje, hoje), botoes: [{ id: `rel:pdf:${c56}:${hoje}:${hoje}:-:-:-`, titulo: 'PDF' }] });
        // O toque em "PDF": o relatório refeito no escopo de quem tocou, e o documento.
        const anexos = new MisterAnexosService(db, comInsumo, numero, entrada);
        anexos.onModuleInit();
        numero.pedidos.length = 0;
        expect(await mandar(tel, 'PDF', { botaoId: resposta.botoes[0].id })).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringMatching(new RegExp(`^documento:carne-56-g-${hoje}\\.pdf\\|`))]);
        // O mesmo botão tocado por quem é de outra empresa: não está disponível (nada da empresa A sai).
        numero.pedidos.length = 0;
        expect(await mandar(telB, 'PDF', { botaoId: resposta.botoes[0].id })).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Este relatório não está mais disponível para você.']);
        // O botão torto não é deste serviço.
        expect(await anexos.tocou('rel:pdf:nada', { telefone: tel, vinculos: [], wamid: null })).toBe(false);

        // ── M3c.3: a imagem do gráfico, antes do texto ──
        // Hoje tudo caiu numa hora só (uma barra não é gráfico): nenhuma imagem acima. A semana tem 7 barras: vai a imagem.
        numero.pedidos.length = 0;
        await perguntar(tel, 'e na semana?');
        ia.roteiro = [usar('insumo_vendido', { insumo: 'carne 56 g', periodo: 'ultimos_7_dias' }), falar('Nos últimos 7 dias, 8 carnes de 56 g.')];
        await agenteComInsumo.esvaziar();
        expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringMatching(/^imagem:\d+$/), comLink('Nos últimos 7 dias, 8 carnes de 56 g.', somarDias(hoje, -6), hoje)]);
        expect(numero.enviadas[1].botoes.map((b) => b.titulo)).toEqual(['PDF']);
        // A imagem subiu à Meta como PNG (o formulário do /media).
        expect(numero.pedidos.filter((p) => p.corpo?.formulario)).toEqual([expect.objectContaining({ corpo: expect.objectContaining({ type: 'image/png', arquivo: 'grafico.png' }) })]);
        // A imagem que falha (a Meta recusa a mídia) não segura a resposta: o texto sai do mesmo jeito.
        numero.pedidos.length = 0;
        numero.responder = (p) => (p.url.endsWith('/media') ? { status: 500, corpo: { error: { message: 'falhou' } } } : undefined);
        try {
          await perguntar(tel, 'e na semana, de novo?');
          ia.roteiro = [usar('insumo_vendido', { insumo: 'carne 56 g', periodo: 'ultimos_7_dias' }), falar('Os mesmos 8.')];
          await agenteComInsumo.esvaziar();
          expect(numero.enviadas.map((m) => m.texto)).toEqual([comLink('Os mesmos 8.', somarDias(hoje, -6), hoje)]);
        } finally {
          numero.responder = () => undefined;
        }

        // ── M3c (mig 443): o link para encaminhar a quem NÃO tem usuário (a contabilidade, um sócio) ──
        const links = new MisterLinkPublicoService(db, auditoria, modulos);
        const sem = undefined as any;
        const comLinks = new MisterFerramentasService(db, modulos, null as any, null as any, null as any, null as any, null as any, null as any, vendasDeVerdade, null as any, null as any, sem, sem, sem, sem, sem, sem, sem, sem, sem, sem, links);
        const chaveAntes = process.env.MISTER_LINK_PUBLICO;
        const naoAbre = async (codigo: unknown) => {
          await expect(links.ver(codigo)).rejects.toMatchObject({ status: 404, message: TEXTOS_DO_LINK_PUBLICO.naoVale });
          await expect(links.pdf(codigo)).rejects.toMatchObject({ status: 404, message: TEXTOS_DO_LINK_PUBLICO.naoVale });
        };
        const doBanco = () => q(`select * from mister_link_publico where tenant_id = $1 order by criado_em`, [A]);
        const pedirLink = (quem: any = e, en: any = { insumo: 'carne 56 g' }) => comLinks.executar(quem, 'link_para_encaminhar', en) as Promise<any>;
        try {
          // Nasce DESLIGADO: sem a variável, nenhum link nasce (o Mister oferece o PDF) e nenhum código abre.
          delete process.env.MISTER_LINK_PUBLICO;
          expect(await pedirLink()).toEqual({ ok: false, dados: { erro: TEXTOS_DO_LINK_PUBLICO.desligado } });
          await naoAbre('a'.repeat(32));
          expect(await doBanco()).toEqual([]);

          process.env.MISTER_LINK_PUBLICO = '1';
          // Só o presidente: o gerente é recusado antes de qualquer leitura; sem venda, não há o que mandar; "carne" pergunta qual.
          expect(await pedirLink({ ...e, nivel: 'gerente' })).toEqual({ ok: false, dados: { erro: TEXTOS_DO_LINK_PUBLICO.soPresidente } });
          expect(await comLinks.executar({ ...e, nivel: 'gerente' }, 'cancelar_links', {})).toEqual({ ok: false, dados: { erro: TEXTOS_DO_LINK_PUBLICO.soPresidente } });
          expect(await pedirLink(e, { insumo: 'carne 120g' })).toEqual({ ok: false, dados: { erro: TEXTOS_DO_LINK_PUBLICO.semVenda } });
          expect((await pedirLink(e, { insumo: 'carne' })).dados).toMatchObject({ precisaEscolher: ['Carne 120 g', 'Carne 56 g'] });
          expect(await pedirLink(e, { insumo: 'detergente' })).toMatchObject({ ok: false });
          expect(await doBanco()).toEqual([]);

          // O link: o que vai ao modelo NÃO traz o endereço; o endereço volta à parte, uma vez, e só o resumo dele fica no banco.
          auditados.length = 0;
          const feito = await pedirLink();
          expect(feito.ok).toBe(true);
          expect(feito.dados).toEqual({ relatorio: expect.stringMatching(/^Carne 56 g · hoje \(\d\d\/\d\d\), até \d\d:\d\d$/), loja: 'Loja Centro', valeAte: expect.stringMatching(/^\d\d\/\d\d$/), siga: expect.stringContaining('não escreva link') });
          expect(JSON.stringify(feito.dados)).not.toContain('/m/r/');
          expect(feito.linkPublico.url).toMatch(new RegExp(`^${base.replace(/[.]/g, '\\.')}/m/r/[A-Za-z0-9_-]{32}$`));
          const codigo = feito.linkPublico.url.split('/m/r/')[1] as string;
          const [guardado] = await doBanco();
          expect(guardado).toMatchObject({ tenant_id: A, unidade_id: null, criado_por: pessoa.ana, tipo: 'insumo', nome_do_pdf: `carne-56-g-${hoje}.pdf`, link_hash: createHash('sha256').update(codigo).digest('hex'), revogado_em: null, aberto_em: null, acessos: 0 });
          expect(JSON.stringify(guardado)).not.toContain(codigo);
          // Vale 7 dias a contar de quando nasceu.
          expect(Math.round((new Date(guardado.vence_em).getTime() - new Date(guardado.criado_em).getTime()) / 3_600_000)).toBe(7 * 24);
          expect(feito.linkPublico.vence).toEqual(new Date(guardado.vence_em));
          // Na auditoria: quem pediu, pela conversa — e nunca o código.
          expect(auditados).toEqual([expect.objectContaining({ tenantId: A, atorId: pessoa.ana, acao: 'mister_link_publico_criado', entidadeTipo: 'mister_link_publico', entidadeId: guardado.id, origem: 'whatsapp', detalhe: { relatorio: feito.dados.relatorio, valeAte: new Date(guardado.vence_em).toISOString() } })]);
          expect(JSON.stringify(auditados)).not.toContain(codigo);

          // A página abre SEM login: a foto do relatório, o nome da empresa e até quando vale — nada de id, telefone ou quem pediu fora do plano.
          auditados.length = 0;
          const vista = await links.ver(codigo);
          expect(vista).toEqual({ empresa: NOME_A, plano: guardado.plano, nomeDoPdf: `carne-56-g-${hoje}.pdf`, comVenda: true, valeAte: new Date(guardado.vence_em).toISOString(), valeAteDia: feito.dados.valeAte });
          expect(vista.plano.numeros[0]).toEqual({ valor: '8 unidades', rotulo: 'Loja Centro' });
          expect(JSON.stringify(vista)).not.toContain(A);
          expect(JSON.stringify(vista)).not.toContain(pessoa.ana);
          // A primeira abertura fica na auditoria (sem ator: quem abre não tem usuário); as seguintes só contam.
          expect(auditados).toEqual([expect.objectContaining({ tenantId: A, atorId: null, acao: 'mister_link_publico_aberto', entidadeId: guardado.id, origem: 'link', detalhe: { relatorio: feito.dados.relatorio, por: 'pagina' } })]);
          const oPdf = await links.pdf(codigo);
          expect(oPdf.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
          expect(oPdf.nome).toBe(`carne-56-g-${hoje}.pdf`);
          expect(auditados).toHaveLength(1);
          expect((await doBanco())[0]).toMatchObject({ acessos: 2, aberto_em: expect.anything(), ultimo_acesso_em: expect.anything() });
          // É uma FOTO: a venda que entra depois não muda o que o link mostra (quem tem o link nunca lê dado vivo da loja).
          await venda([{ produto: xBurger, qtd: 4 }]);
          expect((await comLinks.executar(e, 'insumo_vendido', { insumo: 'carne 56 g' }) as any).dados.total).toBe(12);
          expect((await links.ver(codigo)).plano.numeros[0]).toEqual({ valor: '8 unidades', rotulo: 'Loja Centro' });

          // O código que não é de link, o que não existe e o plano com outra forma: a mesma frase.
          await naoAbre('b'.repeat(32));
          await naoAbre(codigo.slice(0, 31));
          await naoAbre(`${codigo}x`);
          await naoAbre(null);
          await naoAbre({ $ne: '' });
          // A régua do acesso a cada abertura (V75): quem pediu deixou de ser presidente, foi bloqueado ou apagado; o módulo
          // desligado; a empresa apagada; a função desligada na instalação. Voltou a valer, volta a abrir.
          await q(`update colaborador set funcao_id = $2 where id = $1`, [pessoa.ana, funcao['gerente-a']]);
          await naoAbre(codigo);
          await q(`update colaborador set funcao_id = $2, status = 'bloqueado' where id = $1`, [pessoa.ana, funcao['presidente-a']]);
          await naoAbre(codigo);
          await q(`update colaborador set status = 'ativo', deleted_at = now() where id = $1`, [pessoa.ana]);
          await naoAbre(codigo);
          await q(`update colaborador set deleted_at = null where id = $1`, [pessoa.ana]);
          await modulo(A, false);
          await naoAbre(codigo);
          await modulo(A, true);
          await q(`update empresa set deleted_at = now() where id = $1`, [A]);
          await naoAbre(codigo);
          await q(`update empresa set deleted_at = null where id = $1`, [A]);
          delete process.env.MISTER_LINK_PUBLICO;
          await naoAbre(codigo);
          process.env.MISTER_LINK_PUBLICO = '1';
          expect((await links.ver(codigo)).empresa).toBe(NOME_A);
          // O plano guardado com outra forma (um formato antigo) não sai pela porta.
          await q(`update mister_link_publico set plano = '{"titulo":"x"}'::jsonb where id = $1`, [guardado.id]);
          await naoAbre(codigo);
          await q(`update mister_link_publico set plano = $2::jsonb where id = $1`, [guardado.id, JSON.stringify(guardado.plano)]);
          // Vencido: não abre (e não conta mais como link vivo).
          await q(`update mister_link_publico set criado_em = now() - interval '8 days', vence_em = now() - interval '1 day' where id = $1`, [guardado.id]);
          await naoAbre(codigo);
          expect(await comLinks.executar(e, 'cancelar_links', {})).toEqual({ ok: true, dados: { cancelados: 0, siga: expect.stringContaining('não havia link') } });
          await q(`update mister_link_publico set criado_em = now(), vence_em = now() + interval '7 days' where id = $1`, [guardado.id]);
          expect((await links.ver(codigo)).empresa).toBe(NOME_A);
          // Nenhuma dessas recusas contou acesso: só as aberturas de verdade.
          expect((await doBanco())[0].acessos).toBe(5);

          // Cancelar pela conversa: a presidente da OUTRA empresa não cancela os desta; a desta cancela e o link para de abrir na hora.
          expect((await comLinks.executar(deB, 'cancelar_links', {}) as any).dados.cancelados).toBe(0);
          expect((await links.ver(codigo)).empresa).toBe(NOME_A);
          auditados.length = 0;
          expect(await comLinks.executar(e, 'cancelar_links', {})).toEqual({ ok: true, dados: { cancelados: 1, siga: expect.stringContaining('já não abrem') } });
          expect(auditados).toEqual([expect.objectContaining({ tenantId: A, atorId: pessoa.ana, acao: 'mister_link_publico_cancelado', entidadeId: guardado.id, origem: 'whatsapp', detalhe: { quantos: 1 } })]);
          await naoAbre(codigo);
          expect((await doBanco())[0].revogado_em).not.toBeNull();

          // O agente: o endereço sai do código, no fim da resposta — não passa pela IA (nem na ida nem na memória) e o que
          // a IA escrever de link continua sendo tirado pelo filtro de saída.
          const agenteComLinks = new MisterAgenteService(fila, comLinks, ia, numero);
          numero.pedidos.length = 0;
          ia.pedidos.length = 0;
          await perguntar(tel, 'manda um link da carne de 56g de hoje pra contabilidade');
          ia.roteiro = [usar('link_para_encaminhar', { insumo: 'carne 56 g' }), falar('Pronto: o relatório da carne de 56 g de hoje. O link é só para ler e vale 7 dias.')];
          await agenteComLinks.esvaziar();
          expect(numero.enviadas).toHaveLength(1);
          expect(numero.enviadas[0].texto).toMatch(
            new RegExp(`^Pronto: o relatório da carne de 56 g de hoje\\. O link é só para ler e vale 7 dias\\.\\n\\nLink para encaminhar \\(só leitura, vale até \\d\\d/\\d\\d\\): ${base.replace(/[.]/g, '\\.')}/m/r/[A-Za-z0-9_-]{32}$`),
          );
          expect(numero.enviadas[0].botoes).toEqual([]);
          const doAgente = numero.enviadas[0].texto.split('/m/r/')[1];
          expect(JSON.stringify(ia.pedidos)).not.toContain('/m/r/');
          expect(JSON.stringify(ia.pedidos)).not.toContain(doAgente);
          const [aPergunta] = (await perguntasDe('ana')).slice(-1);
          expect(aPergunta.resposta).toBe('Pronto: o relatório da carne de 56 g de hoje. O link é só para ler e vale 7 dias.');
          expect(JSON.stringify(aPergunta)).not.toContain(doAgente);
          // O link do agente abre, com a venda de agora (12): cada link é a foto de quando foi pedido.
          expect((await links.ver(doAgente)).plano.numeros[0]).toEqual({ valor: '12 unidades', rotulo: 'Loja Centro' });

          // O teto de links vivos por empresa: com 20 valendo, o 21º é recusado com a frase; os da outra empresa não contam.
          await q(`delete from mister_link_publico where tenant_id = $1`, [A]);
          const encher = (n: number, tenant = A, quem = pessoa.ana) =>
            q(
              `insert into mister_link_publico (tenant_id, criado_por, tipo, titulo, nome_do_pdf, plano, link_hash, vence_em)
               select $1, $2, 'insumo', 'x', 'x.pdf', '{}'::jsonb, md5(random()::text || g::text) || md5(g::text), now() + interval '7 days' from generate_series(1, $3::int) g`,
              [tenant, quem, n],
            );
          await encher(TETO_DE_LINKS_VIVOS, B, pessoa.anaB);
          await encher(TETO_DE_LINKS_VIVOS - 2);
          // O cruzamento (V98): o 19º gravado por uma transação AINDA ABERTA, que segura a trava da empresa; dois pedidos
          // chegam, esperam a trava e, soltos, só UM cabe.
          const outra = await pool.connect();
          let doisPedidos: any[] = [];
          try {
            const [{ pid: pidDaAberta }] = (await outra.query('select pg_backend_pid() as pid')).rows;
            // Só as sessões presas ATRÁS desta transação (V72): o banco do CI é dividido com outros arquivos.
            const presasAtras = async () => (await q(`select count(*)::int as n from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))`, [pidDaAberta]))[0].n as number;
            await outra.query('begin');
            await outra.query(`select pg_advisory_xact_lock(hashtext($1::text), 443)`, [A]);
            await outra.query(
              `insert into mister_link_publico (tenant_id, criado_por, tipo, titulo, nome_do_pdf, plano, link_hash, vence_em) values ($1, $2, 'insumo', 'x', 'x.pdf', '{}'::jsonb, $3, now() + interval '7 days')`,
              [A, pessoa.ana, createHash('sha256').update(randomUUID()).digest('hex')],
            );
            const um = pedirLink();
            const dois = pedirLink();
            // Os dois chegaram à trava (esperam por ela) antes de a transação aberta fechar.
            for (let i = 0; i < 200 && (await presasAtras()) < 2; i++) await new Promise((r) => setTimeout(r, 50));
            expect(await presasAtras()).toBe(2);
            await outra.query('commit');
            doisPedidos = await Promise.all([um, dois]);
          } finally {
            await outra.query('rollback').catch(() => {});
            outra.release();
          }
          expect(doisPedidos.filter((x) => x.ok)).toHaveLength(1);
          expect(doisPedidos.filter((x) => !x.ok)).toEqual([{ ok: false, dados: { erro: TEXTOS_DO_LINK_PUBLICO.teto } }]);
          expect((await q(`select count(*)::int as n from mister_link_publico where tenant_id = $1 and revogado_em is null and vence_em > now()`, [A]))[0].n).toBe(TETO_DE_LINKS_VIVOS);
          expect(await pedirLink()).toEqual({ ok: false, dados: { erro: TEXTOS_DO_LINK_PUBLICO.teto } });
          // Cancelar libera: os 20 param de valer (os da outra empresa seguem) e o pedido seguinte cabe.
          expect((await comLinks.executar(e, 'cancelar_links', {}) as any).dados.cancelados).toBe(TETO_DE_LINKS_VIVOS);
          expect((await q(`select count(*)::int as n from mister_link_publico where tenant_id = $1 and revogado_em is null`, [B]))[0].n).toBe(TETO_DE_LINKS_VIVOS);
          expect((await pedirLink()).ok).toBe(true);
        } finally {
          if (chaveAntes === undefined) delete process.env.MISTER_LINK_PUBLICO;
          else process.env.MISTER_LINK_PUBLICO = chaveAntes;
          await q(`update colaborador set status = 'ativo', deleted_at = null, funcao_id = $2 where id = $1`, [pessoa.ana, funcao['presidente-a']]);
          await q(`update empresa set deleted_at = null where id = $1`, [A]);
          await modulo(A, true);
          await q(`delete from mister_link_publico where tenant_id = any($1::uuid[])`, [[A, B]]);
        }
      } finally {
        if (criados.comandas.length) {
          await q(`delete from movimento_estoque where ref_id = any($1::uuid[])`, [criados.comandas]);
          await q(`delete from comanda where id = any($1::uuid[])`, [criados.comandas]);
        }
        await q(`delete from produto where id = any($1::uuid[])`, [criados.produtos]);
        await q(`delete from ficha_tecnica where id = any($1::uuid[])`, [criados.fichas]);
        await q(`delete from item_estoque where id = any($1::uuid[])`, [criados.itens]);
      }
    });

    // ───────────────────────────── o link de conferência (M3c.5) ─────────────────────────────
    // O presidente pede "manda pro Carlos o link da contagem de hoje": o Mister manda ao Carlos (ligado, gerente) o resumo e
    // o botão "Abrir no Regem". Só o presidente; só a quem está ligado, não pausou e escreveu nas últimas 24 horas.
    it('o link de conferência (M3c.5): o resumo da contagem de hoje ao Carlos, com o botão; as recusas', async () => {
      const telAna = telefone();
      const telCarlos = telefone();
      await ligar('ana', telAna);
      await ligar('carlos', telCarlos, A, 'gerente');
      const comLink = new MisterFerramentasService(
        db,
        modulos,
        null as any,
        null as any,
        null as any,
        null as any,
        null as any,
        null as any,
        null as any,
        null as any,
        null as any,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        numero,
      );
      const hoje = hojeISO();
      const itens: string[] = [];
      let lista: string | null = null;
      try {
        // A contagem de hoje na Loja Centro: 3 itens, 2 contados, 1 com diferença.
        for (const nome of ['Carne 56 g (contagem)', 'Pão (contagem)', 'Queijo (contagem)'])
          itens.push((await q(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, $2, 'unidade') returning id::text as id`, [A, nome]))[0].id);
        [{ id: lista }] = await q(`insert into contagem_lista (tenant_id, unidade_id, nome, recorrencia) values ($1, $2, 'Câmara fria', 'diaria') returning id::text as id`, [A, lojaDeA]);
        const [{ id: exec }] = await q(`insert into contagem_execucao (tenant_id, lista_id, data, status) values ($1, $2, $3::date, 'aberta') returning id::text as id`, [A, lista, hoje]);
        await q(
          `insert into contagem_item (tenant_id, execucao_id, item_id, saldo_sistema, contado) values ($1, $2, $3, 10, 10), ($1, $2, $4, 5, 4), ($1, $2, $5, 8, null)`,
          [A, exec, itens[0], itens[1], itens[2]],
        );
        const e = (await comLink.escopo(A, pessoa.ana, telAna))!;
        numero.pedidos.length = 0;
        const r: any = await comLink.executar(e, 'mandar_link', { para: 'o Carlos', assunto: 'contagem_de_hoje' });
        expect(r).toMatchObject({ ok: true, dados: { enviadoPara: 'Carlos', loja: 'Loja Centro', resumo: '3 itens (2 contados), 1 com diferença' } });
        const [m] = numero.enviadas;
        expect(numero.enviadas).toHaveLength(1);
        expect(m.para).toBe(telCarlos);
        expect(m.texto).toBe(`📋 Ana pediu para você conferir a contagem de estoque de hoje, ${hoje.slice(8, 10)}/${hoje.slice(5, 7)}, na Loja Centro: 3 itens (2 contados), 1 com diferença. Abre em Estoque › Contagem, com o seu usuário.`);
        expect(m.link).toEqual({ titulo: 'Abrir no Regem', url: `${String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '')}/operacao?aba=contagem` });

        // O gerente não manda; o assunto fora do catálogo não vai; a pessoa que não está ligada: os nomes de quem está.
        const doCarlos = (await comLink.escopo(A, pessoa.carlos, telCarlos))!;
        expect(await comLink.executar(doCarlos, 'mandar_link', { para: 'Ana', assunto: 'contagem_de_hoje' })).toEqual({ ok: false, dados: { erro: 'Só o presidente manda link de conferência pelo Mister.' } });
        expect(await comLink.executar(e, 'mandar_link', { para: 'Carlos', assunto: 'caixa' })).toMatchObject({ ok: false });
        const ninguem: any = await comLink.executar(e, 'mandar_link', { para: 'Zé', assunto: 'contagem_de_hoje' });
        expect(ninguem.dados.erro).toContain('Não achei essa pessoa');
        expect(ninguem.dados.erro).toContain('Carlos');
        // Fora da janela de 24 horas: não manda e diz por quê.
        numero.pedidos.length = 0;
        await q(`update mister_vinculo set ultima_entrada_em = now() - interval '25 hours' where colaborador_id = $1`, [pessoa.carlos]);
        const fora: any = await comLink.executar(e, 'mandar_link', { para: 'Carlos', assunto: 'contagem_de_hoje' });
        expect(fora.dados.erro).toContain('há mais de 24 horas');
        expect(numero.enviadas).toEqual([]);
        // Pausou as mensagens (PARAR AVISOS): não manda.
        await q(`update mister_vinculo set ultima_entrada_em = now(), pausado_em = now() where colaborador_id = $1`, [pessoa.carlos]);
        expect(((await comLink.executar(e, 'mandar_link', { para: 'Carlos', assunto: 'contagem_de_hoje' })) as any).dados.erro).toContain('pausou');
        await q(`update mister_vinculo set pausado_em = null where colaborador_id = $1`, [pessoa.carlos]);
        // Sem contagem hoje (a de ontem não conta): diz que ainda não tem.
        await q(`update contagem_execucao set data = $2::date where lista_id = $1`, [lista, somarDias(hoje, -1)]);
        expect(((await comLink.executar(e, 'mandar_link', { para: 'Carlos', assunto: 'contagem_de_hoje' })) as any).dados.erro).toBe(
          'Ainda não tem contagem de estoque de hoje na Loja Centro. O link vai quando a contagem começar.',
        );
        expect(numero.enviadas).toEqual([]);
      } finally {
        if (lista) await q(`delete from contagem_lista where id = $1`, [lista]);
        await q(`delete from item_estoque where id = any($1::uuid[])`, [itens]);
      }
    });

    // ───────────────────────────── o recado no mural (M3g parte 2, mig 444) ─────────────────────────────
    // "escreve um recado pro mural: amanhã a loja abre às 18h": o Mister mostra o texto e pergunta; "Publicar" publica pelo
    // MESMO serviço da tela do Mural & clima, uma vez só, em nome de quem pediu; "Mudar o texto" descarta.
    it('o recado no mural (M3g parte 2): o rascunho com "Publicar" e "Mudar o texto", publicado pelo serviço do mural uma vez só; as recusas', async () => {
      const telAna = telefone();
      const telCarlos = telefone();
      const telB = telefone();
      await ligar('ana', telAna);
      await ligar('carlos', telCarlos, A, 'gerente');
      await ligar('anaB', telB, B);
      const mural = new MuralService(db);
      const recados = new MisterRecadosService(db, mural, entrada, numero, auditoria);
      recados.onModuleInit();
      const sem = undefined as any;
      const f = new MisterFerramentasService(db, modulos, null as any, null as any, null as any, null as any, null as any, null as any, null as any, null as any, null as any, sem, sem, sem, sem, sem, sem, sem, sem, numero, sem, sem, recados);
      const comunicados = () =>
        q(`select id::text as id, titulo, corpo, audiencia, unidade_id::text as "unidadeId", autor_colaborador_id::text as autor from comunicado where tenant_id = any($1::uuid[]) and deleted_at is null order by created_at`, [[A, B]]);
      const recado = async (id: string) => (await q(`select * from mister_recado where id = $1`, [id]))[0];
      const idDe = (r: any) => String(r.botoes[0].id).slice('rec:pub:'.length);
      const tocar = async (tel: string, botaoId: string) => {
        numero.pedidos.length = 0;
        expect(await mandar(tel, botaoId.startsWith('rec:pub:') ? 'Publicar' : 'Mudar o texto', { botaoId })).toBe('respondeu_proposta');
        return numero.enviadas.map((m) => m.texto);
      };
      const lojaBarra: string[] = [];
      await q(`delete from comunicado where tenant_id = any($1::uuid[])`, [[A, B]]);
      try {
        const eAna = (await f.escopo(A, pessoa.ana, telAna))!;
        const TEXTO = '📢 Amanhã, terça (17/11), a loja abre às 18h.';
        // O rascunho: o texto como ficou, onde vai e os dois botões (fora do que vai ao modelo). Nada publicado ainda.
        const r: any = await f.executar(eAna, 'escrever_recado', { texto: `  ${TEXTO}  ` });
        expect(r).toEqual({
          ok: true,
          dados: { comoFicou: TEXTO, ondeVai: 'Mural & clima da Loja Centro', siga: expect.stringContaining('Não diga que publicou') },
          botoes: [
            { id: expect.stringMatching(/^rec:pub:[0-9a-f-]{36}$/), titulo: 'Publicar' },
            { id: expect.stringMatching(/^rec:mudar:[0-9a-f-]{36}$/), titulo: 'Mudar o texto' },
          ],
        });
        expect(JSON.stringify(r.dados)).not.toContain('rec:');
        const r1 = await recado(idDe(r));
        expect(r1).toMatchObject({ tenant_id: A, unidade_id: lojaDeA, colaborador_id: pessoa.ana, texto: TEXTO, loja_nome: 'Loja Centro', situacao: 'rascunho', comunicado_id: null });
        expect(Math.round((new Date(r1.vence_em).getTime() - new Date(r1.criado_em).getTime()) / 60000)).toBe(30);
        expect(await comunicados()).toEqual([]);

        // O botão tocado por outra pessoa da empresa, ou de outra empresa: não está disponível — e nada se publica.
        expect(await tocar(telCarlos, r.botoes[0].id)).toEqual([TEXTOS_DO_RECADO.naoDisponivel]);
        expect(await tocar(telB, r.botoes[0].id)).toEqual([TEXTOS_DO_RECADO.naoDisponivel]);
        expect(await comunicados()).toEqual([]);

        // "Publicar" de quem pediu: o comunicado pelo serviço do mural, na loja, com a Ana como autora; a hora na resposta.
        auditados.length = 0;
        const [publicado] = await tocar(telAna, r.botoes[0].id);
        expect(publicado).toMatch(/^Publicado no Mural & clima da Loja Centro, às \d\d:\d\d\.$/);
        const [c] = await comunicados();
        expect(c).toEqual({ id: expect.any(String), titulo: TEXTO, corpo: null, audiencia: 'loja', unidadeId: lojaDeA, autor: pessoa.ana });
        expect(await recado(idDe(r))).toMatchObject({ situacao: 'publicado', comunicado_id: c.id });
        expect(auditados).toEqual([expect.objectContaining({ tenantId: A, atorId: pessoa.ana, acao: 'mister_recado_publicado', entidadeTipo: 'comunicado', entidadeId: c.id, origem: 'whatsapp', detalhe: { recado: idDe(r), loja: 'Loja Centro' } })]);
        // O mural da tela mostra o recado (o MESMO serviço da tela lê).
        const doFeed = await mural.feed({ tenantId: A, colaboradorId: pessoa.carlos, unidadeId: lojaDeA } as any);
        expect(doFeed.comunicados.map((x: any) => [x.titulo, x.autorNome])).toEqual([[TEXTO, 'Ana Souza']]);
        // O toque de novo (e o "Mudar o texto" depois de publicado): já foi, às tantas — nada se publica outra vez.
        expect(await tocar(telAna, r.botoes[0].id)).toEqual([expect.stringMatching(/^Este recado já foi publicado, às \d\d:\d\d\.$/)]);
        expect(await tocar(telAna, r.botoes[1].id)).toEqual([expect.stringMatching(/^Este recado já foi publicado/)]);
        expect(await comunicados()).toHaveLength(1);

        // "Mudar o texto": descarta, e o "Publicar" daquele rascunho já não publica.
        const r2: any = await f.executar(eAna, 'escrever_recado', { texto: 'Reunião de equipe\n\nSexta, 20/11, às 15h.' });
        expect(await tocar(telAna, r2.botoes[1].id)).toEqual([TEXTOS_DO_RECADO.mudar]);
        expect(await recado(idDe(r2))).toMatchObject({ situacao: 'descartado' });
        expect(await tocar(telAna, r2.botoes[0].id)).toEqual([TEXTOS_DO_RECADO.trocado]);
        // O rascunho novo descarta o anterior da mesma pessoa: o botão velho não publica um texto que ela já trocou.
        const r3: any = await f.executar(eAna, 'escrever_recado', { texto: 'Reunião de equipe\n\nSexta, 20/11, às 15h.' });
        const r4: any = await f.executar(eAna, 'escrever_recado', { texto: 'Reunião de equipe\n\nSexta, 20/11, às 16h, na Loja Centro.' });
        expect(await tocar(telAna, r3.botoes[0].id)).toEqual([TEXTOS_DO_RECADO.trocado]);
        expect(await tocar(telAna, r4.botoes[0].id)).toEqual([expect.stringMatching(/^Publicado no Mural & clima da Loja Centro/)]);
        expect((await comunicados()).at(-1)).toMatchObject({ titulo: 'Reunião de equipe', corpo: 'Sexta, 20/11, às 16h, na Loja Centro.' });
        expect(await comunicados()).toHaveLength(2);

        // Vencido (30 minutos): não publica.
        const r5: any = await f.executar(eAna, 'escrever_recado', { texto: 'Inventário no domingo.' });
        await q(`update mister_recado set criado_em = now() - interval '31 minutes', vence_em = now() - interval '1 minute' where id = $1`, [idDe(r5)]);
        expect(await tocar(telAna, r5.botoes[0].id)).toEqual([TEXTOS_DO_RECADO.venceu]);
        expect(await recado(idDe(r5))).toMatchObject({ situacao: 'rascunho', comunicado_id: null });
        expect(await comunicados()).toHaveLength(2);

        // O mural falha: o rascunho volta a esperar e o toque seguinte publica.
        const quemAna = { telefone: telAna, vinculos: [{ tenantId: A, colaboradorId: pessoa.ana, unidadeId: null, nivel: 'presidente' as const, empresa: NOME_A }], wamid: null };
        const quebrado = new MisterRecadosService(db, { publicar: async () => Promise.reject(new Error('o banco caiu')) } as any, undefined, numero, auditoria);
        const r6: any = await f.executar(eAna, 'escrever_recado', { texto: 'Uniforme novo chega na quinta.' });
        numero.pedidos.length = 0;
        expect(await quebrado.tocou(r6.botoes[0].id, quemAna)).toBe(true);
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DO_RECADO.falhou]);
        expect(await recado(idDe(r6))).toMatchObject({ situacao: 'rascunho', respondido_em: null, comunicado_id: null });
        expect(await tocar(telAna, r6.botoes[0].id)).toEqual([expect.stringMatching(/^Publicado no Mural/)]);
        // Dois toques ao mesmo tempo: um comunicado só.
        const r7: any = await f.executar(eAna, 'escrever_recado', { texto: 'Treinamento do caixa no sábado.' });
        numero.pedidos.length = 0;
        expect(await Promise.all([recados.tocou(r7.botoes[0].id, quemAna), recados.tocou(r7.botoes[0].id, quemAna)])).toEqual([true, true]);
        expect((await comunicados()).filter((x) => x.titulo === 'Treinamento do caixa no sábado.')).toHaveLength(1);
        // O botão que não é do recado (ou de um recado que não existe) não é deste serviço.
        expect(await recados.tocou('rec:pub:nada', quemAna)).toBe(false);
        expect(await recados.tocou(`rec:pub:${randomUUID()}`, quemAna)).toBe(false);

        // As recusas da ferramenta: quem não é presidente nem gerente, o perfil sem o Mural & clima, o texto vazio, comprido
        // ou com link, e a conexão por QR Code (que não tem botão). Nenhuma guarda rascunho.
        const antes = (await q(`select count(*)::int as n from mister_recado where tenant_id = $1`, [A]))[0].n;
        expect(await f.executar({ ...eAna, nivel: 'execucao' as any }, 'escrever_recado', { texto: 'Oi' })).toEqual({ ok: false, dados: { erro: TEXTOS_DO_RECADO.soGestor } });
        // A permissão do perfil vale para o gerente (o presidente abre tudo, como nas consultas).
        const eGerente = (await f.escopo(A, pessoa.carlos, telCarlos))!;
        expect(await f.executar({ ...eGerente, permissoes: { ...eGerente.permissoes, mural: false } as any }, 'escrever_recado', { texto: 'Oi' })).toEqual({ ok: false, dados: { erro: TEXTOS_DO_RECADO.semPermissao } });
        expect(await f.executar(eAna, 'escrever_recado', { texto: ' ' })).toEqual({ ok: false, dados: { erro: TEXTOS_DO_RECADO.vazio } });
        expect(await f.executar(eAna, 'escrever_recado', { texto: 'x'.repeat(501) })).toEqual({ ok: false, dados: { erro: TEXTOS_DO_RECADO.longo } });
        expect(await f.executar(eAna, 'escrever_recado', { texto: 'O treino está em https://exemplo.com' })).toEqual({ ok: false, dados: { erro: TEXTOS_DO_RECADO.comLink } });
        await q(`update mister_numero set provedor = 'evolution' where id = 1`);
        try {
          expect(await f.executar(eAna, 'escrever_recado', { texto: 'Oi, equipe' })).toEqual({ ok: false, dados: { erro: TEXTOS_DO_RECADO.semBotao } });
        } finally {
          await q(`update mister_numero set provedor = 'oficial' where id = 1`);
        }
        expect((await q(`select count(*)::int as n from mister_recado where tenant_id = $1`, [A]))[0].n).toBe(antes);

        // O gerente: escreve e publica na loja dele; se muda de loja antes do toque, o botão deixa de valer para ele.
        const eCarlos = (await f.escopo(A, pessoa.carlos, telCarlos))!;
        const g1: any = await f.executar(eCarlos, 'escrever_recado', { texto: 'Escala da semana que vem já está no Regem.' });
        expect(g1.dados.ondeVai).toBe('Mural & clima da Loja Centro');
        expect(await tocar(telCarlos, g1.botoes[0].id)).toEqual([expect.stringMatching(/^Publicado no Mural & clima da Loja Centro/)]);
        expect((await comunicados()).at(-1)).toMatchObject({ autor: pessoa.carlos, unidadeId: lojaDeA, audiencia: 'loja' });
        const [{ id: barra }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja Barra') returning id::text as id`, [A]);
        lojaBarra.push(barra);
        const g2: any = await f.executar((await f.escopo(A, pessoa.carlos, telCarlos))!, 'escrever_recado', { texto: 'Contagem de estoque amanhã cedo.' });
        await q(`update colaborador set unidade_id = $2 where id = $1`, [pessoa.carlos, barra]);
        expect(await tocar(telCarlos, g2.botoes[0].id)).toEqual([TEXTOS_DO_RECADO.naoDisponivel]);
        await q(`update colaborador set unidade_id = $2 where id = $1`, [pessoa.carlos, lojaDeA]);
        // Rebaixado depois do rascunho: o vínculo deixa de valer e o botão não publica.
        const g3: any = await f.executar((await f.escopo(A, pessoa.carlos, telCarlos))!, 'escrever_recado', { texto: 'Reunião rápida às 17h.' });
        await q(`update colaborador set funcao_id = $2 where id = $1`, [pessoa.carlos, funcao['execucao-a']]);
        numero.pedidos.length = 0;
        await mandar(telCarlos, 'Publicar', { botaoId: g3.botoes[0].id });
        expect((await recado(idDe(g3))).situacao).toBe('rascunho');
        await q(`update colaborador set funcao_id = $2 where id = $1`, [pessoa.carlos, funcao['gerente-a']]);

        // O presidente na empresa de várias lojas, sem dizer a loja: o recado vai para todas (o mural da rede).
        const eAnaDuas = (await f.escopo(A, pessoa.ana, telAna))!;
        expect(eAnaDuas.lojaUnica).toBe(false);
        const p1: any = await f.executar(eAnaDuas, 'escrever_recado', { texto: 'Feliz Natal, equipe!' });
        expect(p1.dados.ondeVai).toBe('Mural & clima de todas as lojas');
        expect(await tocar(telAna, p1.botoes[0].id)).toEqual([expect.stringMatching(/^Publicado no Mural & clima de todas as lojas, às /)]);
        expect((await comunicados()).at(-1)).toMatchObject({ titulo: 'Feliz Natal, equipe!', audiencia: 'rede', unidadeId: null });
        const p2: any = await f.executar(eAnaDuas, 'escrever_recado', { texto: 'Na Barra, o caixa abre às 17h.', loja: 'Loja Barra' });
        expect(p2.dados.ondeVai).toBe('Mural & clima da Loja Barra');
        expect((await recado(idDe(p2))).unidade_id).toBe(barra);
        await q(`delete from unidade where id = $1`, [barra]);
        lojaBarra.length = 0;

        // O agente: o texto na resposta, com "Publicar" e "Mudar o texto" no balão (fora do que a IA vê).
        comIa();
        const agente = new MisterAgenteService(fila, f, ia, numero);
        numero.pedidos.length = 0;
        ia.pedidos.length = 0;
        await perguntar(telAna, 'escreve um recado pro mural: amanhã a loja abre às 18h');
        ia.roteiro = [usar('escrever_recado', { texto: TEXTO }), falar(`Ficou assim: "${TEXTO}" Publico no Mural & clima da Loja Centro?`)];
        await agente.esvaziar();
        expect(numero.enviadas).toEqual([
          {
            para: telAna,
            texto: `Ficou assim: "${TEXTO}" Publico no Mural & clima da Loja Centro?`,
            botoes: [
              { id: expect.stringMatching(/^rec:pub:/), titulo: 'Publicar' },
              { id: expect.stringMatching(/^rec:mudar:/), titulo: 'Mudar o texto' },
            ],
          },
        ]);
        expect(JSON.stringify(ia.pedidos)).not.toContain('rec:pub:');
        // E o toque no botão dessa resposta publica.
        expect(await tocar(telAna, numero.enviadas[0].botoes[0].id)).toEqual([expect.stringMatching(/^Publicado no Mural & clima da Loja Centro/)]);
      } finally {
        await q(`update colaborador set unidade_id = $2, funcao_id = $3 where id = $1`, [pessoa.carlos, lojaDeA, funcao['gerente-a']]);
        if (lojaBarra.length) await q(`delete from unidade where id = any($1::uuid[])`, [lojaBarra]);
        await q(`delete from comunicado where tenant_id = any($1::uuid[])`, [[A, B]]);
        await q(`delete from mister_recado where tenant_id = any($1::uuid[])`, [[A, B]]);
      }
    });

    // ───────────────────────────── o arquivo do ponto do mês (M3e parte 2) ─────────────────────────────
    // A rotina do dia 1 grava o fechamento; o aviso o lê às 06:00 da loja e vai ao presidente com o PDF e os botões. O
    // "Enviar ao contador" usa o MESMO envio da tela (o WhatsApp da loja), uma vez só.
    it('o arquivo do ponto do mês (M3e parte 2): no dia 1 às 6h ao presidente, com o PDF e os botões; "Enviar ao contador" pelo envio da tela, uma vez só', async () => {
      const telAna = telefone();
      const telCarlos = telefone();
      const telB = telefone();
      await ligar('ana', telAna);
      await ligar('carlos', telCarlos, A, 'gerente');
      await ligar('anaB', telB, B);
      // O ponto de verdade, com o WhatsApp da loja de mentira (o envio ao contador sai por ele, como na tela).
      const docsDaLoja: any[] = [];
      const whatsDaLoja = {
        enviarDocumento: async (tenantId: string, tel: string, base64: string, nome: string, legenda: string) =>
          void docsDaLoja.push({ tenantId, tel, nome, legenda, inicio: Buffer.from(base64, 'base64').subarray(0, 5).toString('latin1') }),
      };
      const ponto = new PontoService(db, auditoria, null as any, { emit: () => true } as any, modulos, whatsDaLoja as any);
      const comPonto = new AvisosDeTeste(db, avisosConfig, numero, modulos, { guardarEMostrar: async () => ({ aviso: {}, situacao: 'novo' }) } as any, { emit: () => true } as any, entrada, propostas, ponto);
      comPonto.onModuleInit();
      const botoesDoPonto = new MisterPontoDoMesService(db, ponto, entrada, numero);
      botoesDoPonto.onModuleInit();
      const COMP = '2026-10-01';
      const ANTES = new Date('2026-11-01T08:59:00Z'); // 05:59 da loja
      const DIA1 = new Date('2026-11-01T09:30:00Z'); // 06:30 da loja
      const DIA6 = new Date('2026-11-06T12:00:00Z');
      const doPonto = (s: any[]) => s.filter((x) => x.tipo === 'ponto_do_mes');
      const avisoDoPonto = async () => (await q(`select id::text as id, situacao, dados from mister_aviso where tenant_id = $1 and tipo = 'ponto_do_mes' order by aberto_em desc`, [A]))[0];
      const fechamento = async () => (await q(`select status, enviado_contador_id::text as contador, enviado_por_id::text as por from ponto_fechamento where tenant_id = $1 and competencia = $2::date`, [A, COMP]))[0];
      const tocar = async (tel: string, botaoId: string) => {
        numero.pedidos.length = 0;
        await mandar(tel, 'botão', { botaoId });
        return numero.enviadas.map((m) => m.texto);
      };
      const quemAna = { telefone: telAna, vinculos: [{ tenantId: A, colaboradorId: pessoa.ana, unidadeId: null, nivel: 'presidente' as const, empresa: NOME_A }], wamid: null };
      const marcacoes: string[] = [];
      try {
        await q(`delete from ponto_fechamento where tenant_id = any($1::uuid[])`, [[A, B]]);
        await q(`delete from contador where tenant_id = any($1::uuid[])`, [[A, B]]);
        // O fechamento que a rotina do dia 1 gravou (A usou o ponto em outubro; B tem fechamento, mas não marcou ponto).
        await q(`insert into ponto_fechamento (tenant_id, competencia, status, total_colaboradores, total_pendencias, pendencias) values ($1, $2::date, 'pendente', 14, 1, $3::jsonb)`, [
          A,
          COMP,
          JSON.stringify([{ colaboradorId: pessoa.edu, nome: 'Edu Balcão', dias: [{ data: '2026-10-28', motivo: 'batida incompleta' }] }]),
        ]);
        await q(`insert into ponto_fechamento (tenant_id, competencia, status, total_colaboradores, total_pendencias, pendencias) values ($1, $2::date, 'ok', 3, 0, '[]'::jsonb)`, [B, COMP]);
        const [{ id: m1 }] = await q(`insert into ponto_marcacao (tenant_id, unidade_id, colaborador_id, nsr, tipo, marcado_em) values ($1, $2, $3, $4, 'entrada', '2026-10-15T21:00:00Z') returning id::text as id`, [
          A,
          lojaDeA,
          pessoa.edu,
          randomInt(1e9, 9e9),
        ]);
        marcacoes.push(m1);

        // Antes das 06:00 do dia 1 da loja, e depois do dia 5: nada. B (sem marcação no mês) nunca.
        expect(doPonto(await comPonto.situacoes([A, B], ANTES))).toEqual([]);
        expect(doPonto(await comPonto.situacoes([A, B], DIA6))).toEqual([]);
        // Sem o responsável cadastrado: o aviso diz onde cadastrar.
        const [semContador, ...outros] = doPonto(await comPonto.situacoes([A, B], DIA1));
        expect(outros).toEqual([]);
        expect(semContador).toEqual({
          tenantId: A,
          unidadeId: null,
          tipo: 'ponto_do_mes',
          chave: 'ponto-mes:2026-10-01',
          titulo: `Ponto de outubro · ${NOME_A} (1 a 31/10)`,
          detalhe: '14 colaboradores · 1 pendente (Edu Balcão, 28/10).\n\nPara mandar à contabilidade com um toque, cadastre o responsável em Pessoas › Gerenciamento de ponto.',
          dados: { competencia: COMP, empresa: NOME_A, contadorId: null },
        });

        // Com o responsável: abre às 06:30 e vai SÓ ao presidente — a mensagem com a pasta e os botões, e o PDF logo depois.
        const [{ id: contadorId }] = await q(`insert into contador (tenant_id, nome, whatsapp, cadastrado_por_id) values ($1, 'Juliana Prado', '5521998767788', $2) returning id::text as id`, [
          A,
          pessoa.ana,
        ]);
        numero.pedidos.length = 0;
        await comPonto.volta([A, B], DIA1);
        const aviso = await avisoDoPonto();
        expect(aviso).toMatchObject({ situacao: 'aberto', dados: { competencia: COMP, contadorId } });
        expect(JSON.stringify(aviso.dados)).not.toContain('99876');
        const paraAna = numero.enviadas.filter((m) => m.para === telAna);
        expect(paraAna.map((m) => m.texto)).toEqual([
          `📁 Ponto de outubro · ${NOME_A} (1 a 31/10).\n\n14 colaboradores · 1 pendente (Edu Balcão, 28/10).\n\nEnvio à contabilidade? Juliana Prado (WhatsApp final 7788).`,
          expect.stringMatching(new RegExp(`^documento:Espelho de ponto · outubro 2026 · ${NOME_A}\\.pdf\\|Espelho de ponto de outubro\\|\\d+$`)),
        ]);
        expect(paraAna[0].botoes).toEqual([
          { id: `pmes:enviar:${aviso.id}`, titulo: 'Enviar ao contador' },
          { id: `pmes:ver:${aviso.id}`, titulo: 'Ver antes' },
        ]);
        expect(numero.enviadas.filter((m) => m.para !== telAna)).toEqual([]);

        // "Ver antes": onde conferir, com o link para o Regem. O gerente não manda; o telefone de outra empresa não acha o aviso.
        numero.pedidos.length = 0;
        await mandar(telAna, 'Ver antes', { botaoId: `pmes:ver:${aviso.id}` });
        expect(numero.enviadas).toEqual([
          expect.objectContaining({ para: telAna, texto: TEXTOS_DO_PONTO_DO_MES.verAntes(COMP), link: expect.objectContaining({ titulo: 'Abrir no Regem', url: expect.stringMatching(/\/pessoas$/) }) }),
        ]);
        expect(await tocar(telCarlos, `pmes:enviar:${aviso.id}`)).toEqual([TEXTOS_DO_PONTO_DO_MES.soPresidente]);
        expect(await tocar(telB, `pmes:enviar:${aviso.id}`)).toEqual([TEXTOS_DA_PROPOSTA.naoAchada]);
        expect(docsDaLoja).toEqual([]);

        // A renovação do aviso a cada volta preserva a reserva do envio (senão o toque duplo, no meio da volta, mandaria duas vezes).
        await q(`update mister_aviso set dados = dados || jsonb_build_object('envioEm', now()) where id = $1`, [aviso.id]);
        await comPonto.volta([A, B], DIA1);
        expect((await avisoDoPonto()).dados).toHaveProperty('envioEm');
        // A reserva fresca segura o toque: "já está em andamento", nada sai.
        expect(await tocar(telAna, `pmes:enviar:${aviso.id}`)).toEqual([TEXTOS_DO_PONTO_DO_MES.enviando]);
        expect(docsDaLoja).toEqual([]);
        // A reserva velha (o envio que morreu no meio) não segura; a falha do envio solta a reserva e diz a frase.
        await q(`update mister_aviso set dados = dados || jsonb_build_object('envioEm', now() - interval '10 minutes') where id = $1`, [aviso.id]);
        const quebrado = new MisterPontoDoMesService(db, { enviarEspelhoContador: async () => Promise.reject(new Error('o WhatsApp da loja caiu')) } as any, undefined, numero);
        numero.pedidos.length = 0;
        expect(await quebrado.tocou(`pmes:enviar:${aviso.id}`, quemAna)).toBe(true);
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DO_PONTO_DO_MES.falhou]);
        expect((await avisoDoPonto()).dados).not.toHaveProperty('envioEm');
        const semResponsavel = new MisterPontoDoMesService(db, { enviarEspelhoContador: async () => ({ precisaResponsavel: true }) } as any, undefined, numero);
        numero.pedidos.length = 0;
        expect(await semResponsavel.tocou(`pmes:enviar:${aviso.id}`, quemAna)).toBe(true);
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DO_PONTO_DO_MES.semContador]);
        expect((await avisoDoPonto()).dados).not.toHaveProperty('envioEm');

        // "Enviar ao contador": o MESMO envio da tela — o PDF pelo WhatsApp da loja ao responsável, o fechamento marcado e a
        // auditoria em nome do presidente. Dois toques ao mesmo tempo mandam uma vez só.
        auditados.length = 0;
        numero.pedidos.length = 0;
        expect(await Promise.all([botoesDoPonto.tocou(`pmes:enviar:${aviso.id}`, quemAna), botoesDoPonto.tocou(`pmes:enviar:${aviso.id}`, quemAna)])).toEqual([true, true]);
        expect(docsDaLoja).toEqual([{ tenantId: A, tel: '5521998767788', nome: 'espelho-ponto-2026-10.pdf', legenda: 'Espelho de ponto 10/2026', inicio: '%PDF-' }]);
        const respostas = numero.enviadas.map((m) => m.texto);
        expect(respostas).toHaveLength(2);
        expect(respostas.filter((t) => /^Enviado às \d\d:\d\d para Juliana Prado\. Fica no fechamento de outubro, em Pessoas › Gerenciamento de ponto\.$/.test(t))).toHaveLength(1);
        expect(respostas.filter((t) => t === TEXTOS_DO_PONTO_DO_MES.enviando || /^O ponto de outubro já foi enviado/.test(t))).toHaveLength(1);
        expect(await fechamento()).toEqual({ status: 'enviado', contador: contadorId, por: pessoa.ana });
        expect(auditados.find((x) => x.acao === 'enviou_espelho_rh')).toMatchObject({ tenantId: A, atorId: pessoa.ana, detalhe: { competencia: COMP, contadorId } });
        // O toque de novo: já foi, às tantas — nada sai outra vez.
        await q(`update mister_aviso set dados = dados - 'envioEm' where id = $1`, [aviso.id]);
        expect(await tocar(telAna, `pmes:enviar:${aviso.id}`)).toEqual([expect.stringMatching(/^O ponto de outubro já foi enviado à contabilidade, às \d\d:\d\d\.$/)]);
        expect(docsDaLoja).toHaveLength(1);
        // A volta seguinte fecha o aviso PORQUE o fechamento foi mandado, sem mandar "resolvido". (O envio da tela recalcula o
        // fechamento, e aqui a empresa de teste não tem escala em outubro: o total volta a 14 para o "enviado" ser o motivo.)
        await q(`update ponto_fechamento set total_colaboradores = 14 where tenant_id = $1 and competencia = $2::date`, [A, COMP]);
        expect(doPonto(await comPonto.situacoes([A, B], DIA1))).toEqual([]);
        numero.pedidos.length = 0;
        await comPonto.volta([A, B], DIA1);
        expect((await avisoDoPonto()).situacao).not.toBe('aberto');
        expect(numero.enviadas).toEqual([]);
        expect(await tocar(telAna, `pmes:enviar:${aviso.id}`)).toEqual([expect.stringMatching(/^O ponto de outubro já foi enviado/)]);
        expect(docsDaLoja).toHaveLength(1);
      } finally {
        // O serviço dos avisos de sempre volta a ser o que se apresenta à entrada (os testes seguintes usam ele).
        avisos.onModuleInit();
        if (marcacoes.length) await q(`delete from ponto_marcacao where id = any($1::uuid[])`, [marcacoes]);
        await q(`delete from ponto_fechamento where tenant_id = any($1::uuid[])`, [[A, B]]);
        await q(`delete from contador where tenant_id = any($1::uuid[])`, [[A, B]]);
        await q(`update colaborador set ponto_enviado_em = null, ponto_enviado_contador_id = null where tenant_id = $1`, [A]).catch(() => {});
      }
    });

    // ───────────────────────────── o "como faço" com a imagem da tela (M3d) ─────────────────────────────
    it('o "como faço" com a imagem da tela (M3d): a imagem pelo endereço público antes do texto; quem não abre a tela, sem imagem', async () => {
      comIa();
      const tel = telefone();
      await ligar('ana', tel);
      numero.pedidos.length = 0;
      await perguntar(tel, 'como eu pauso o iFood?');
      ia.roteiro = [usar('como_usar_o_regem', { assunto: 'pausar o iFood' }), falar('Em Delivery › Painel (1), toque em "⏸ Pausar" (2).')];
      await agente.esvaziar();
      const base = String(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '');
      expect(numero.enviadas.map((m) => m.texto)).toEqual([`imagem:${base}/como-faco/pausar-canal.png`, 'Em Delivery › Painel (1), toque em "⏸ Pausar" (2).']);
      // O modelo soube o que cada número marca (e não recebeu o endereço da imagem).
      const resultado = JSON.parse(ia.pedidos[1].messages.at(-1).content[0].content);
      expect(resultado.imagem).toBe('A imagem da tela vai junto da sua resposta, com os lugares numerados: 1 = Delivery › Painel, no menu; 2 = o botão "⏸ Pausar". Cite os números nos passos.');
      expect(JSON.stringify(resultado)).not.toContain('como-faco');
      // O endereço de fora do padrão não sai (só o PNG estático do próprio Regem).
      await expect(numero.enviarImagemPorLink(tel, 'https://exemplo.com/foto.jpg')).rejects.toThrow();
      // Quem não abre a tela (o perfil sem o Delivery) recebe o caminho, mas não a imagem.
      const e = (await ferramentas.escopo(A, pessoa.ana, tel))!;
      const semDelivery = await ferramentas.executar({ ...e, nivel: 'gerente', permissoes: { ...(e.permissoes as any), delivery: false } as any }, 'como_usar_o_regem', { assunto: 'pausar o iFood' });
      expect(semDelivery.imagens).toBeUndefined();
      expect((semDelivery.dados as any).imagem).toBeUndefined();
    });

    // ───────────────────────────── o ponto esquecido (M3e) ─────────────────────────────
    // A fonte 9 lê a escala e o ponto de verdade: o turno das 18:00 às 02:00 de ontem (vira a meia-noite), o Carlos que
    // entrou e não saiu, o Edu que não marcou nada, a Ana com a falta lançada (fica de fora); o módulo do ponto desligado
    // não avisa; a saída que entra tira o Carlos da lista; a volta abre SÓ o resumo (o padrão), ao gerente.
    it('o ponto esquecido (M3e): a escala contra o ponto, o resumo do dia seguinte e o módulo do ponto', async () => {
      // Segunda, 16/11/2026, 10:30 de Brasília: o resumo de domingo (15/11) já vale.
      const AGORA = new Date('2026-11-16T13:30:00Z');
      const ONTEM = '2026-11-15';
      const nsr = () => randomInt(1e9, 9e9);
      const [{ id: turnoId }] = await q(`insert into turno (tenant_id, unidade_id, nome, hora_inicio, hora_fim) values ($1, $2, 'Noite (ponto)', '18:00', '02:00') returning id`, [A, lojaDeA]);
      const [{ id: setorId }] = await q(`insert into setor (tenant_id, unidade_id, nome) values ($1, $2, 'Salão (ponto)') returning id`, [A, lojaDeA]);
      // Uma etiqueta por alocação (a escala aceita uma alocação por etiqueta e por dia). A sigla em SEQUÊNCIA: sorteada, duas
      // iguais na mesma loja batiam no índice único (unidade, sigla, contador) — ERR-519.
      let siglas = 0;
      const alocar = async (colab: string, presenca = 'prevista') => {
        const [{ id: etiquetaId }] = await q(`insert into etiqueta (tenant_id, unidade_id, setor_id, funcao_id, sigla) values ($1, $2, $3, $4, $5) returning id`, [
          A,
          lojaDeA,
          setorId,
          funcao['execucao-a'],
          `P${++siglas}`,
        ]);
        await q(`insert into escala_alocacao (tenant_id, unidade_id, data, turno_id, etiqueta_id, colaborador_id, presenca) values ($1, $2, $3::date, $4, $5, $6, $7)`, [
          A,
          lojaDeA,
          ONTEM,
          turnoId,
          etiquetaId,
          colab,
          presenca,
        ]);
      };
      const marcar = (colab: string, tipo: string, em: string) =>
        q(`insert into ponto_marcacao (tenant_id, unidade_id, colaborador_id, nsr, tipo, marcado_em) values ($1, $2, $3, $4, $5, $6::timestamptz)`, [A, lojaDeA, colab, nsr(), tipo, em]);
      const ponto = (ativo: boolean) =>
        q(`delete from modulo_ativacao where tenant_id = $1 and modulo = 'terminal_ponto'`, [A]).then(() =>
          q(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1, null, 'terminal_ponto', $2)`, [A, ativo]),
        );
      const nomes = Object.fromEntries((await q(`select id::text as id, nome from colaborador where id = any($1::uuid[])`, [[pessoa.carlos, pessoa.edu]])).map((r) => [r.id, r.nome]));
      try {
        await alocar(pessoa.carlos);
        await alocar(pessoa.edu);
        await alocar(pessoa.ana, 'falta_injustificada');
        await marcar(pessoa.carlos, 'entrada', '2026-11-15T21:05:00Z'); // 18:05
        await ponto(true);
        const doPonto = async () => (await avisos.situacoes([A], AGORA)).filter((s) => s.tipo === 'ponto_esquecido');
        let s = await doPonto();
        const resumo = s.find((x) => (x.dados as any).modo === 'resumo')!;
        expect(resumo).toMatchObject({ unidadeId: lojaDeA, chave: `ponto:${lojaDeA}:${ONTEM}`, titulo: 'Loja Centro · ponto esquecido ontem, 15/11', dados: { faltas: 2 } });
        expect(resumo.detalhe.split('\n').slice(0, 2).sort()).toEqual(
          [`• ${nomes[pessoa.carlos]}, sem a saída (turno até 02:00)`, `• ${nomes[pessoa.edu]}, sem a entrada (turno das 18:00)`].sort(),
        );
        expect(resumo.detalhe).not.toContain('Ana');
        // O turno a turno também aparece (até 12 h depois do fim); a regra da empresa escolhe qual vale.
        expect(s.filter((x) => (x.dados as any).modo === 'turno').map((x) => x.chave).sort()).toHaveLength(2);
        // A volta, com a regra padrão (o resumo do dia seguinte): abre só o resumo.
        await modulo(A, true);
        await avisos.volta([A], AGORA);
        expect((await q(`select chave from mister_aviso where tenant_id = $1 and tipo = 'ponto_esquecido' and situacao = 'aberto'`, [A])).map((r) => r.chave)).toEqual([
          `ponto:${lojaDeA}:${ONTEM}`,
        ]);
        // A saída do Carlos entra (ajustaram o ponto): sai da lista.
        await marcar(pessoa.carlos, 'saida', '2026-11-16T05:10:00Z'); // 02:10
        s = await doPonto();
        expect(s.find((x) => (x.dados as any).modo === 'resumo')!.dados).toMatchObject({ faltas: 1 });
        // A loja sem o terminal de ponto ligado não avisa ninguém.
        await ponto(false);
        expect(await doPonto()).toEqual([]);
      } finally {
        await q(`delete from mister_aviso where tenant_id = $1 and tipo = 'ponto_esquecido'`, [A]);
        await q(`delete from ponto_marcacao where tenant_id = $1 and unidade_id = $2 and marcado_em between '2026-11-15' and '2026-11-17'`, [A, lojaDeA]);
        await q(`delete from escala_alocacao where turno_id = $1`, [turnoId]);
        await q(`delete from turno where id = $1`, [turnoId]);
        await q(`delete from etiqueta where setor_id = $1`, [setorId]);
        await q(`delete from setor where id = $1`, [setorId]);
        await q(`delete from modulo_ativacao where tenant_id = $1 and modulo = 'terminal_ponto'`, [A]);
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
        c41: { insumo: 'carne 56 g', periodo: 'hoje' },
        c42: { busca: 'iFood cancelamento' },
        c44: { acao: 'anotar', sobre: 'empresa', texto: '"Smash" é o X-Burger Smash.' },
        c45: { acao: 'comecar', numero: '284' },
        c46: { acao: 'criar', texto: 'pagar o gás', quando: '2026-11-14T10:00' },
        c47: { acao: 'comecar', alvo: 'canal', qual: 'iFood' },
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

      it('a rodada inteira com as respostas certas: 47 de 47, o andamento, o custo, a lista e as perguntas na ordem', async () => {
        const ia = iaDeMentira();
        const servico = new MisterAvaliacaoService(db, ia as any);
        const r = await servico.rodar('Rita da DMS');
        expect(r.total).toBe(47);
        const fim = await terminar(r.id);
        expect(fim).toMatchObject({ situacao: 'terminou', feitas: 47, acertos: 47, motivo: null });
        // O mesmo laço do agente: as instruções e as ferramentas de verdade, e o recurso da avaliação.
        expect(ia.pedidos.every((p) => p.recurso === 'mister_avaliacao' && p.tools === FERRAMENTAS && p.system[0].text === INSTRUCOES_DO_MISTER)).toBe(true);
        const lista = await servico.lista();
        expect(lista).toMatchObject({ disponivel: true, total: 47, chaveDaDistribuicao: true });
        expect(lista.rodadas[0]).toMatchObject({ id: r.id, situacao: 'terminou', pedidaPor: 'Rita da DMS', versao: lista.versaoAtual.versao, consultas: lista.versaoAtual.consultas, total: 47, acertos: 47, falhas: 0, oQueFalhou: [] });
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
        expect(await terminar(r.id)).toMatchObject({ situacao: 'terminou', acertos: 46 });
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
      // Os nove do protótipo aprovado em 14/11, o do boleto perto de vencer (versão 3, M3a parte 4), o do ponto esquecido (M3e)
      // e o do arquivo do ponto do mês (M3e parte 2) e os dois do gasto do WhatsApp oficial (G2, 18/11 — no fim; a tela os
      // põe em "Documentos e dinheiro").
      expect(tela.avisos).toHaveLength(14);
      expect(tela.avisos[11]).toMatchObject({ tipo: 'ponto_do_mes', grupo: 'Pessoas e ponto', regra: { ligado: true, destinos: ['presidente'], parametro: null } });
      expect(tela.avisos[12]).toMatchObject({ tipo: 'gasto_whatsapp', grupo: 'Documentos e dinheiro', padrao: true, regra: { ligado: false, destinos: ['presidente'], valores: [] } });
      expect(tela.avisos[13]).toMatchObject({ tipo: 'franquia_atendimento', grupo: 'Documentos e dinheiro', regra: { ligado: true, destinos: ['presidente'] } });
      expect(tela.avisos[9]).toMatchObject({ tipo: 'boleto_vencendo', grupo: 'Documentos e dinheiro', regra: { ligado: true, destinos: ['presidente'], parametro: 3 } });
      expect(tela.avisos[10]).toMatchObject({ tipo: 'ponto_esquecido', grupo: 'Pessoas e ponto', regra: { ligado: true, destinos: ['gerente'], parametro: 0 } });
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

    it('versão 4, M4c: o aviso escrito pelo Mister — só com o grupo ligado; o texto conferido no perfil da empresa; o fixo quando a IA inventa número ou falha; fora das 24 h, o modelo sem chamar a IA', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-api03-da-distribuicao';
      const conversaCfg = new MisterConversaConfigService(db, auditoria);
      const escritor = new AvisosDeTeste(db, avisosConfig, numero, modulos, { guardarEMostrar: async () => ({ aviso: {}, situacao: 'novo' }) } as any, { emit: () => true } as any, entrada, propostas, undefined, ia, conversaCfg);
      const tel = telefone();
      await ligar('carlos', tel, A, 'gerente');
      await janelaAberta('carlos');
      const FIXO = '⏰ Sem solução há 6 min. ⚠️ Loja Centro · impressora Cozinha parada.\n\nConfira se ela está ligada, com papel e no cabo ou na rede.';
      /** Abre o aviso da impressora (vai à tela), passa 6 min e escala ao gerente pelo WhatsApp: devolve as entregas da escalada. */
      const escalar = async (chave: string) => {
        escritor.incidentes = [incidente('impressora_parada', chave)];
        await escritor.volta([A]);
        await q(`update mister_aviso set aberto_em = now() - interval '6 minutes 10 seconds' where tenant_id = $1 and situacao = 'aberto' and chave = $2`, [A, `vigia:impressora_parada:${chave}`]);
        numero.pedidos.length = 0;
        expect(await escritor.volta([A])).toMatchObject({ escalados: 1 });
        const [a] = await q(`select entregas from mister_aviso where tenant_id = $1 and situacao = 'aberto' and chave = $2`, [A, `vigia:impressora_parada:${chave}`]);
        return a.entregas.filter((e: any) => e.fase === 'escalou');
      };
      try {
        // Nasce desligado: o texto fixo de sempre, sem chamar a IA.
        let e = await escalar(`m4c-1:${MARCA}`);
        expect(numero.enviadas).toEqual([{ para: tel, texto: FIXO, botoes: [] }]);
        expect(e).toEqual([expect.objectContaining({ destino: 'gerente', ok: true, final: tel.slice(-4) })]);
        expect(e[0].escrito).toBeUndefined();
        expect(e[0].reserva).toBeUndefined();
        expect(ia.pedidos).toHaveLength(0);

        // Ligado o grupo "Na loja" (com o perfil Objetivo): a IA escreve com os fatos do aviso e o texto conferido vai.
        await conversaCfg.salvar(usuario('ana'), { avisosEscritos: ['loja'], perfil: 'objetivo' });
        const ESCRITO = '⏰ *Loja Centro*: a impressora Cozinha continua parada há 6 min, sem solução. Confira se ela está ligada, com papel e no cabo ou na rede.';
        ia.roteiro = [falar(ESCRITO)];
        e = await escalar(`m4c-2:${MARCA}`);
        expect(numero.enviadas).toEqual([{ para: tel, texto: ESCRITO, botoes: [] }]);
        expect(e).toEqual([expect.objectContaining({ destino: 'gerente', ok: true, escrito: true })]);
        expect(ia.pedidos).toHaveLength(1);
        expect(ia.pedidos[0].system).toContain('Escreva UM aviso');
        expect(ia.pedidos[0].system).toContain('OBJETIVO');
        const ctx = JSON.parse(ia.pedidos[0].messages[0].content);
        expect(ctx).toMatchObject({ tipo: 'impressora', titulo: 'Loja Centro · impressora Cozinha parada', fase: 'escalou', minutosAberto: 6, detalhe: 'Confira se ela está ligada, com papel e no cabo ou na rede.' });
        // Nada de telefone nem de id no que vai à IA; o gasto fica no medidor com o recurso próprio.
        expect(JSON.stringify(ia.pedidos[0])).not.toContain(tel);
        expect(JSON.stringify(ia.pedidos[0])).not.toContain(A);
        expect((await q(`select recurso from ia_uso_dia where tenant_id = $1`, [A])).map((l) => l.recurso)).toContain('mister_aviso_escrito');

        // A IA pôs um número que o aviso não trouxe: vai o texto fixo, com o motivo na trilha.
        ia.pedidos.length = 0;
        ia.roteiro = [falar('⏰ Loja Centro: a impressora Cozinha parou há 6 min e 3 pedidos estão esperando.')];
        e = await escalar(`m4c-3:${MARCA}`);
        expect(numero.enviadas).toEqual([{ para: tel, texto: FIXO, botoes: [] }]);
        expect(e).toEqual([expect.objectContaining({ ok: true, reserva: 'numero' })]);

        // O provedor caiu: o texto fixo, e o aviso não deixa de sair.
        ia.roteiro = [{ erro: Object.assign(new Error('fora do ar'), { status: 529 }) }];
        e = await escalar(`m4c-4:${MARCA}`);
        expect(numero.enviadas).toEqual([{ para: tel, texto: FIXO, botoes: [] }]);
        expect(e).toEqual([expect.objectContaining({ ok: true, reserva: 'falhou' })]);

        // Fora das 24 horas: o modelo aprovado, como sempre — a IA nem é chamada.
        await q(`update mister_vinculo set ultima_entrada_em = now() - interval '2 days' where colaborador_id = $1`, [pessoa.carlos]);
        ia.pedidos.length = 0;
        ia.roteiro = [falar(ESCRITO)];
        e = await escalar(`m4c-5:${MARCA}`);
        expect(numero.enviadas).toHaveLength(1);
        expect(numero.enviadas[0].texto).toMatch(/^modelo:/);
        expect(e).toEqual([expect.objectContaining({ ok: true, via: 'modelo' })]);
        expect(ia.pedidos).toHaveLength(0);
      } finally {
        await conversaCfg.salvar(usuario('ana'), { avisosEscritos: [], perfil: 'hoje' });
        escritor.incidentes = [];
        await escritor.volta([A]);
        ia.roteiro = [];
      }
    });

    it('versão 4, M4d: o "fica de olho" num pedido e o lembrete — o ajuste desligado, o teto com a trava, a volta que fala só quando muda, o lembrete uma vez só, fora das 24 h pelo modelo e o toque, o desligar e o vencer', async () => {
      const conversaCfg = new MisterConversaConfigService(db, auditoria);
      const vigia = new MisterVigiaService(db, numero, modulos, conversaCfg, entrada);
      vigia.onModuleInit();
      const ferr = new (MisterFerramentasService as any)(db, modulos, ...Array(9).fill(null), ...Array(12).fill(undefined), undefined, vigia) as MisterFerramentasService;
      const tel = telefone();
      await ligar('carlos', tel, A, 'gerente');
      await janelaAberta('carlos');
      const e = (await ferr.escopo(A, pessoa.carlos, tel))!;
      await q(`delete from mister_vigia where tenant_id = any($1::uuid[])`, [[A, B]]);
      const pedidos: string[] = [];
      const novoPedido = async (status = 'confirmado') => {
        const display = String(randomInt(100000, 999999));
        const [p] = await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, status, total, valor_bruto, taxa_entrega, taxa_entrega_dono, display_id, criado_em, confirmado_em)
           values ($1, $2, 'ifood', $3, 50, 50, 0, 0, $4, now() - interval '20 minutes', now() - interval '18 minutes') returning id::text as id`,
          [A, lojaDeA, status, display],
        );
        pedidos.push(p.id);
        return { id: p.id as string, display };
      };
      const olhar = (numeroDito: string) => ferr.executar(e, 'ficar_de_olho', { acao: 'comecar', numero: numeroDito });
      const vigiasDe = () => q(`select * from mister_vigia where tenant_id = $1 order by criado_em`, [A]);
      const textos = () => numero.enviadas.map((m) => m.texto);
      try {
        // Nasce desligado: nada se marca, e a frase diz onde o presidente liga.
        const p1 = await novoPedido();
        expect(await olhar(p1.display)).toEqual({ ok: false, dados: { erro: expect.stringContaining('Mister › Jeito e memória') } });
        expect(await ferr.executar(e, 'lembrete', { acao: 'criar', texto: 'pagar o gás', quando: '2030-01-01T10:00' })).toMatchObject({ ok: false });
        expect(await vigiasDe()).toEqual([]);

        // Ligado: fica de olho no pedido (o mesmo pedido duas vezes = uma linha), até as 06:00 da loja.
        await conversaCfg.salvar(usuario('ana'), { ficaDeOlho: true });
        const r1 = await olhar(`#${p1.display}`);
        expect(r1).toMatchObject({ ok: true, dados: { combinado: true, pedido: expect.stringContaining(p1.display), situacaoAgora: 'em preparo', ate: 'as 06:00' } });
        expect((await olhar(p1.display)).dados).toMatchObject({ observacao: 'Já estava de olho neste pedido.' });
        const [v1] = await vigiasDe();
        expect(v1).toMatchObject({ tipo: 'olho', alvo: 'pedido', referencia: `pe:${p1.id}`, estado: 'confirmado', situacao: 'ativo', colaborador_id: pessoa.carlos });
        expect(new Date(v1.quando).toISOString()).toBe(fimDaNoite(new Date()).toISOString());
        // Pedido que já acabou não se olha.
        const acabado = await novoPedido('entregue');
        expect((await olhar(acabado.display)).dados.erro).toContain('já está entregue');

        // O teto (3 por pessoa), com dois pedidos AO MESMO TEMPO quando só cabe um: a trava da empresa deixa passar só um.
        const p2 = await novoPedido();
        expect((await olhar(p2.display)).ok).toBe(true);
        const [p3, p4] = [await novoPedido(), await novoPedido()];
        const juntos = await Promise.all([olhar(p3.display), olhar(p4.display)]);
        expect(juntos.map((x) => x.ok).sort()).toEqual([false, true]);
        expect(String((juntos.find((x) => !x.ok) as any).dados.erro)).toContain('Você já tem 3 "fica de olho" ativos');
        expect((await vigiasDe()).filter((v: any) => v.situacao === 'ativo')).toHaveLength(3);

        // A volta: sem mudança, calada; o pedido saiu → UMA mensagem (duas voltas juntas não repetem); entregue → a última.
        numero.pedidos.length = 0;
        expect(await vigia.volta(new Date(), [A])).toMatchObject({ mudancas: 0, lembretes: 0 });
        expect(numero.enviadas).toEqual([]);
        await q(`update pedido_externo set status = 'despachado', despachado_em = now() where id = $1`, [p1.id]);
        const [va, vb] = await Promise.all([vigia.volta(new Date(), [A]), vigia.volta(new Date(), [A])]);
        expect(va.mudancas + vb.mudancas).toBe(1);
        expect(textos()).toEqual([expect.stringMatching(new RegExp(`^✅ O .*${p1.display} saiu para entrega às \\d\\d:\\d\\d\\.$`))]);
        expect(numero.enviadas[0].para).toBe(tel);
        await q(`update pedido_externo set status = 'entregue', entregue_em = now() where id = $1`, [p1.id]);
        expect(await vigia.volta(new Date(), [A])).toMatchObject({ mudancas: 1 });
        expect(textos().at(-1)).toMatch(/foi entregue às \d\d:\d\d\. Deixo de olhar este pedido\.$/);
        expect((await vigiasDe()).find((v: any) => v.referencia === `pe:${p1.id}`)).toMatchObject({ situacao: 'feito', estado: 'entregue', resultado: 'enviado' });

        // "Para de olhar" pela conversa, e a lista.
        expect(await ferr.executar(e, 'ficar_de_olho', { acao: 'parar', trecho: p2.display })).toMatchObject({ ok: true, dados: { parou: true } });
        expect((await ferr.executar(e, 'ficar_de_olho', { acao: 'listar' })).dados.marcados).toHaveLength(1);

        // O lembrete: marcado para amanhã às 10:00 da loja; na hora, duas voltas juntas mandam UMA vez.
        const amanha = somarDias(dataNoFuso(new Date()), 1);
        const rl = await ferr.executar(e, 'lembrete', { acao: 'criar', texto: 'pagar o gás', quando: `${amanha}T10:00` });
        expect(rl).toMatchObject({ ok: true, dados: { marcado: true, lembrete: 'pagar o gás', quando: `amanhã, ${amanha.slice(8, 10)}/${amanha.slice(5, 7)}, às 10:00` } });
        expect((await ferr.executar(e, 'lembrete', { acao: 'criar', texto: 'a senha do cofre é 1234', quando: `${amanha}T11:00` })).dados.erro).toContain('não guarda senha');
        await q(`update mister_vigia set quando = now() - interval '1 minute' where tenant_id = $1 and tipo = 'lembrete'`, [A]);
        numero.pedidos.length = 0;
        const [la, lb] = await Promise.all([vigia.volta(new Date(), [A]), vigia.volta(new Date(), [A])]);
        expect(la.lembretes + lb.lembretes).toBe(1);
        expect(numero.enviadas).toEqual([{ para: tel, texto: '🔔 Lembrete que você pediu: pagar o gás.', botoes: [] }]);
        expect((await vigiasDe()).find((v: any) => v.tipo === 'lembrete')).toMatchObject({ situacao: 'feito', resultado: 'enviado' });

        // Fora das 24 horas: o modelo aprovado; o toque em "Ver o que fazer" traz o texto (só a quem é).
        await ferr.executar(e, 'lembrete', { acao: 'criar', texto: 'ligar para o contador', quando: `${amanha}T09:00` });
        await q(`update mister_vigia set quando = now() - interval '1 minute' where tenant_id = $1 and tipo = 'lembrete' and situacao = 'ativo'`, [A]);
        await q(`update mister_vinculo set ultima_entrada_em = now() - interval '2 days' where colaborador_id = $1`, [pessoa.carlos]);
        numero.pedidos.length = 0;
        expect(await vigia.volta(new Date(), [A])).toMatchObject({ lembretes: 1 });
        expect(numero.enviadas).toHaveLength(1);
        expect(numero.enviadas[0].texto).toMatch(/^modelo:mister_aviso:/);
        const modelo = (await vigiasDe()).find((v: any) => v.rotulo === 'ligar para o contador');
        expect(modelo).toMatchObject({ situacao: 'feito', resultado: 'modelo' });
        expect(numero.enviadas[0].botoes[0].id).toBe(`mister:vigia:${modelo.id}`);
        numero.pedidos.length = 0;
        expect(await mandar(tel, 'Ver o que fazer', { codigoDoModelo: `mister:vigia:${modelo.id}` })).toBe('tocou_modelo');
        expect(textos()).toEqual(['🔔 Lembrete que você pediu: ligar para o contador.']);
        await janelaAberta('carlos');

        // O "fica de olho" que passou das 06:00 sai calado.
        await q(`update mister_vigia set quando = now() - interval '1 minute' where tenant_id = $1 and tipo = 'olho' and situacao = 'ativo'`, [A]);
        numero.pedidos.length = 0;
        expect((await vigia.volta(new Date(), [A])).vencidos).toBe(1);
        expect(numero.enviadas).toEqual([]);

        // O presidente desligou o ajuste: o que estava marcado é cancelado na volta, sem mandar nada.
        await ferr.executar(e, 'lembrete', { acao: 'criar', texto: 'conferir o estoque', quando: `${amanha}T08:00` });
        await conversaCfg.salvar(usuario('ana'), { ficaDeOlho: false });
        await q(`update mister_vigia set quando = now() - interval '1 minute' where tenant_id = $1 and tipo = 'lembrete' and situacao = 'ativo'`, [A]);
        expect(await vigia.volta(new Date(), [A])).toMatchObject({ lembretes: 0, cancelados: 1 });
        expect(numero.enviadas).toEqual([]);
        expect((await vigiasDe()).find((v: any) => v.rotulo === 'conferir o estoque')).toMatchObject({ situacao: 'cancelado', resultado: 'desligado' });
        // A trilha nunca guarda o telefone.
        expect(JSON.stringify(await vigiasDe())).not.toContain(tel);
      } finally {
        await conversaCfg.salvar(usuario('ana'), { ficaDeOlho: false });
        await q(`delete from mister_vigia where tenant_id = any($1::uuid[])`, [[A, B]]);
        await q(`delete from pedido_externo where id = any($1::uuid[])`, [pedidos]);
      }
    });

    it('versão 4, M4d parte 2: o "fica de olho" no caixa (até fechar), no canal pausado (até reabrir) e na impressora parada (até voltar) — só o que está naquele estado, uma mensagem por mudança', async () => {
      const conversaCfg = new MisterConversaConfigService(db, auditoria);
      const pausa = new PausaDoCanalService(db, auditoria);
      const vigia = new MisterVigiaService(db, numero, modulos, conversaCfg, entrada, pausa);
      const ferr = new (MisterFerramentasService as any)(db, modulos, ...Array(9).fill(null), pausa, ...Array(11).fill(undefined), undefined, vigia) as MisterFerramentasService;
      const tel = telefone();
      await ligar('ana', tel);
      await janelaAberta('ana');
      const e = (await ferr.escopo(A, pessoa.ana, tel))!;
      const olhar = (alvo: string, qual: string) => ferr.executar(e, 'ficar_de_olho', { acao: 'comecar', alvo, qual });
      const vigiasDe = () => q(`select * from mister_vigia where tenant_id = $1 order by criado_em`, [A]);
      const textos = () => numero.enviadas.map((m) => m.texto);
      await q(`delete from mister_vigia where tenant_id = $1`, [A]);
      // Nenhum caixa do delivery aberto de outro teste (este teste abre o dele).
      await q(`update caixa_sessao set status = 'fechada', fechada_em = now() where tenant_id = $1 and origem = 'delivery' and status = 'aberta'`, [A]);
      const caixas: string[] = [];
      let incidente: string | null = null;
      try {
        await conversaCfg.salvar(usuario('ana'), { ficaDeOlho: true });

        // O caixa: sem caixa aberto, nada a olhar; aberto, olha até fechar.
        expect((await olhar('caixa', 'delivery')).dados.erro).toContain('Nenhum caixa do delivery aberto');
        const [cx] = await q(
          `insert into caixa_sessao (tenant_id, unidade_id, origem, status, valor_abertura, aberta_em, aberta_por_id) values ($1, $2, 'delivery', 'aberta', 50, now() - interval '3 hours', $3) returning id::text as id`,
          [A, lojaDeA, pessoa.carlos],
        );
        caixas.push(cx.id);
        expect(await olhar('caixa', 'do delivery')).toMatchObject({ ok: true, dados: { combinado: true, oQue: 'caixa do delivery (aberto por Carlos)', avisaQuando: 'ele fechar' } });
        expect((await vigiasDe())[0]).toMatchObject({ alvo: 'caixa', referencia: `cx:${cx.id}`, estado: 'aberta' });
        numero.pedidos.length = 0;
        expect(await vigia.volta(new Date(), [A])).toMatchObject({ mudancas: 0 });
        await q(`update caixa_sessao set status = 'fechada', fechada_em = now() where id = $1`, [cx.id]);
        const [ca, cb] = await Promise.all([vigia.volta(new Date(), [A]), vigia.volta(new Date(), [A])]);
        expect(ca.mudancas + cb.mudancas).toBe(1);
        expect(textos()).toEqual([expect.stringMatching(/^✅ O caixa do delivery \(aberto por Carlos\) fechou às \d\d:\d\d\.$/)]);

        // O canal: aberto, nada a olhar; pausado (a MESMA regra do "Pausar"), olha até reabrir.
        expect((await olhar('canal', 'iFood')).dados.erro).toContain('não está pausado');
        expect((await olhar('canal', 'Rappi')).dados.erro).toBe('Diga qual canal: iFood, 99 ou cardápio.');
        await q(
          `insert into pausa_canal (id, tenant_id, unidade_id, canal, ate, motivo, pausado_em, pausado_por_nome)
           values (gen_random_uuid(), $1, null, 'ifood', now() + interval '40 minutes', 'movimento', now(), 'Ana')`,
          [A],
        );
        expect(await olhar('canal', 'o ifood')).toMatchObject({ ok: true, dados: { combinado: true, oQue: 'iFood', avisaQuando: 'ele reabrir' } });
        numero.pedidos.length = 0;
        expect(await vigia.volta(new Date(), [A])).toMatchObject({ mudancas: 0 });
        await q(`update pausa_canal set ate = now() - interval '1 minute' where tenant_id = $1 and canal = 'ifood'`, [A]);
        expect(await vigia.volta(new Date(), [A])).toMatchObject({ mudancas: 1 });
        expect(textos()).toEqual([expect.stringMatching(/^✅ O iFood voltou: a pausa acabou às \d\d:\d\d\.$/)]);
        expect((await vigiasDe()).find((v: any) => v.alvo === 'canal')).toMatchObject({ situacao: 'feito', estado: 'aberto' });

        // A impressora (só onde a tabela do vigia existe — o banco de loja do CI não a tem): parada, olha até voltar.
        const [{ tem }] = await q(`select to_regclass('vigia_incidente') is not null as tem`);
        if (tem) {
          const [inc] = await q(
            `insert into vigia_incidente (tenant_id, unidade_id, regra, chave, gravidade, publico, evidencia)
             values ($1, $2, 'impressora_parada', $3, 'atencao', 'loja', '{"impressora": "Cozinha"}'::jsonb) returning id::text as id`,
            [A, lojaDeA, `srv:${MARCA}:impressora:m4d`],
          );
          incidente = inc.id;
          expect((await olhar('impressora', 'bar')).dados.erro).toContain('Nenhuma impressora "bar" parada');
          expect(await olhar('impressora', 'a impressora da cozinha')).toMatchObject({ ok: true, dados: { oQue: 'impressora Cozinha', avisaQuando: 'ela voltar a responder' } });
          numero.pedidos.length = 0;
          await q(`update vigia_incidente set situacao = 'recuperado', fechado_em = now() where id = $1`, [inc.id]);
          expect(await vigia.volta(new Date(), [A])).toMatchObject({ mudancas: 1 });
          expect(textos()).toEqual([expect.stringMatching(/^✅ A impressora Cozinha voltou a responder às \d\d:\d\d\.$/)]);
        }
        // A trilha nunca guarda o telefone.
        expect(JSON.stringify(await vigiasDe())).not.toContain(tel);
      } finally {
        await conversaCfg.salvar(usuario('ana'), { ficaDeOlho: false });
        await q(`delete from mister_vigia where tenant_id = $1`, [A]);
        await q(`delete from caixa_sessao where id = any($1::uuid[])`, [caixas]);
        await q(`delete from pausa_canal where tenant_id = $1 and canal = 'ifood'`, [A]);
        if (incidente) await q(`delete from vigia_incidente where id = $1`, [incidente]);
      }
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
      const conversa = new MisterConversaConfigService(db, auditoria);
      // M3b: a nota pelo recebimento e pelo cadastro do estoque DE VERDADE (o evento do estoque é um dublê).
      const recebimentos = new RecebimentoService(db, auditoria, { emit: () => true } as any);
      const notas = new MisterNotasService(db, numero, ia, recebimentos, financeiro, new EstoqueService(db, auditoria), auditoria);
      const documentos = new DocumentosDeTeste(db, numero, ia, financeiro, conversa, entrada, auditoria, notas);
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
        await q(`delete from mister_conversa_config where tenant_id = any($1::uuid[])`, [[A, B]]);
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
        expect(numero.enviadas[0]).toMatchObject({ para: telAna, botoes: [{ id: `doc:desfazer:${d.id}`, titulo: 'Desfazer' }, { id: `doc:pdf:${d.id}`, titulo: 'Ver o PDF' }] });
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

      // M3g (conversa 22): "o boleto da Distribuidora vence dia 28, não 25" — corrige o vencimento pela conta da tela, com
      // "Desfazer"; o valor nunca; o gerente não; o "Desfazer" só enquanto o vencimento for o corrigido.
      it('corrigir o vencimento do boleto lançado (M3g): pela conta da tela, com "Desfazer"; o gerente não; o Desfazer velho não volta', async () => {
        ia.roteiro = [leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: 'DISTRIBUIDORA CARNE BOA LTDA', cnpj: CNPJ, valor: '1.284,90', vencimento: '2026-11-25' })];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        const [d] = await docs();
        const comDocumentos = new MisterFerramentasService(
          db,
          modulos,
          null as any,
          null as any,
          null as any,
          null as any,
          null as any,
          null as any,
          null as any,
          null as any,
          null as any,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          numero,
          documentos,
        );
        const e = (await comDocumentos.escopo(A, pessoa.ana, telAna))!;
        const r: any = await comDocumentos.executar(e, 'corrigir_documento', { boleto: 'a distribuidora', vencimento: '2026-11-28' });
        expect(r).toMatchObject({
          ok: true,
          dados: { corrigido: true, de: '25/11', para: '28/11 (sábado)', codigoDeBarrasDiz: '25/11' },
          botoes: [{ id: `doc:volta:${d.id}:2026-11-25`, titulo: 'Desfazer' }],
        });
        // A conta a pagar mudou pelo serviço da tela (com a auditoria dele); o documento guarda a correção.
        expect((await titulos())[0]).toMatchObject({ vencimento: '2026-11-28', status: 'aberto' });
        expect(Number((await titulos())[0].valor)).toBe(1284.9); // o valor não muda
        expect(auditados.filter((a) => a.acao === 'editou_titulo').at(-1)).toMatchObject({ tenantId: A, atorId: pessoa.ana });
        expect((await docs())[0].dados.correcao).toEqual({ de: '2026-11-25', para: '2026-11-28' });
        // O gerente não corrige; a data torta e o nome que não existe são recusados.
        const doCarlos = (await comDocumentos.escopo(A, pessoa.carlos, telCarlos))!;
        expect(await comDocumentos.executar(doCarlos, 'corrigir_documento', { boleto: 'distribuidora', vencimento: '2026-11-29' })).toMatchObject({ ok: false });
        expect(((await comDocumentos.executar(e, 'corrigir_documento', { boleto: 'distribuidora', vencimento: '2026-02-30' })) as any).dados.erro).toContain('existe no calendário');
        expect(((await comDocumentos.executar(e, 'corrigir_documento', { boleto: 'padaria', vencimento: '2026-11-29' })) as any).dados.erro).toContain('Não achei');
        // O "Desfazer": volta para 25/11.
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:volta:${d.id}:2026-11-25`)).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Desfeito: o vencimento voltou para 25/11.']);
        expect((await titulos())[0].vencimento).toBe('2026-11-25');
        // O mesmo "Desfazer" de novo (o vencimento já não é o corrigido): não volta nada.
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:volta:${d.id}:2026-11-25`)).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Este vencimento já mudou de novo (ou a conta não está mais em aberto): não desfiz.']);
        // O gerente não desfaz.
        await comDocumentos.executar(e, 'corrigir_documento', { boleto: 'distribuidora', vencimento: '2026-11-30' });
        numero.pedidos.length = 0;
        expect(await tocar(telCarlos, `doc:volta:${d.id}:2026-11-25`)).toBe('respondeu_proposta');
        expect((await titulos())[0].vencimento).toBe('2026-11-30');
        // Pela conversa: o "Desfazer" vai no balão da resposta.
        const agenteDoc = new MisterAgenteService(fila, comDocumentos, ia, numero);
        numero.pedidos.length = 0;
        await perguntar(telAna, 'o boleto da distribuidora vence dia 29');
        ia.roteiro = [usar('corrigir_documento', { boleto: 'distribuidora', vencimento: '2026-11-29' }), falar('Corrigi o vencimento para 29/11.')];
        await agenteDoc.esvaziar();
        expect(numero.enviadas).toEqual([expect.objectContaining({ texto: 'Corrigi o vencimento para 29/11.', botoes: [{ id: `doc:volta:${d.id}:2026-11-30`, titulo: 'Desfazer' }] })]);
        expect((await titulos())[0].vencimento).toBe('2026-11-29');
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
        expect(numero.enviadas.find((m) => m.texto.startsWith('Lancei'))!.botoes).toEqual([{ id: `doc:desfazer:${d.id}`, titulo: 'Desfazer' }, { id: `doc:pdf:${d.id}`, titulo: 'Ver o PDF' }]);
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

      // ─────────── parte 3: o ajuste da empresa, o texto que completa, a lista e o "Desfazer" pela tela ───────────

      it('o ajuste da empresa: "pergunta antes" segura o boleto que lançaria sozinho; desligado, a foto segue como antes; o salvar confere', async () => {
        // Versão 4 (mig 447): o jeito vem junto, no padrão (nada muda). M4d (mig 452): o "fica de olho" nasce desligado.
        const SEM_JEITO = { perfil: 'hoje', jeito: null, avisosEscritos: [], ficaDeOlho: false };
        expect(await conversa.daEmpresa(A)).toEqual({ documentosLigado: true, documentosModo: 'sozinho', ...SEM_JEITO });
        await expect(conversa.salvar(usuario('ana'), { documentosModo: 'sempre' })).rejects.toBeInstanceOf(BadRequestException);
        await expect(conversa.salvar(usuario('ana'), { documentosLigado: 'sim' })).rejects.toBeInstanceOf(BadRequestException);
        await expect(conversa.salvar(usuario('ana'), {})).rejects.toBeInstanceOf(BadRequestException);
        // Salvar só o modo mantém o "ligado" (o ausente mantém o salvo).
        expect(await conversa.salvar(usuario('ana'), { documentosModo: 'perguntar' })).toEqual({
          conversa: { documentosLigado: true, documentosModo: 'perguntar', ...SEM_JEITO },
          disponivel: { documentos: true, notas: process.env.MISTER_NOTAS === '1' },
        });
        // A tela sabe se a função está ligada NESTA instalação (a mesma regra dos serviços): sem a variável, "em breve".
        const notasAntes = process.env.MISTER_NOTAS;
        try {
          process.env.MISTER_NOTAS = '1';
          expect((await conversa.daTela(A)).disponivel).toEqual({ documentos: true, notas: true });
          delete process.env.MISTER_DOCUMENTOS;
          expect((await conversa.daTela(A)).disponivel).toEqual({ documentos: false, notas: false });
          process.env.EDGE_MODE = 'true';
          process.env.MISTER_DOCUMENTOS = '1';
          expect((await conversa.daTela(A)).disponivel).toEqual({ documentos: false, notas: false });
        } finally {
          delete process.env.EDGE_MODE;
          process.env.MISTER_DOCUMENTOS = '1';
          if (notasAntes === undefined) delete process.env.MISTER_NOTAS;
          else process.env.MISTER_NOTAS = notasAntes;
        }
        expect(auditados.find((a) => a.acao === 'mister_conversa_alterada')).toMatchObject({ detalhe: { antes: { documentosModo: 'sozinho' }, depois: { documentosModo: 'perguntar' } } });
        // A outra empresa não muda.
        expect(await conversa.daEmpresa(B)).toEqual({ documentosLigado: true, documentosModo: 'sozinho', ...SEM_JEITO });

        ia.roteiro = [leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: 'DISTRIBUIDORA CARNE BOA LTDA', cnpj: CNPJ, valor: '1.284,90', vencimento: '2026-11-25' })];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect((await docs())[0]).toMatchObject({ situacao: 'confirmar', motivo: 'modo', fornecedor_id: fornecedorDeA });
        expect(await titulos()).toEqual([]);

        // Desligado na empresa: nem baixa nem lê; a foto vira o "só leio texto". Salvar só o "ligado" mantém o modo salvo.
        await conversa.salvar(usuario('ana'), { documentosLigado: false });
        expect(await conversa.daEmpresa(A)).toEqual({ documentosLigado: false, documentosModo: 'perguntar', ...SEM_JEITO });
        numero.pedidos.length = 0;
        ia.pedidos.length = 0;
        expect(await foto(telAna, novaMidia())).toBe('so_texto');
        expect(baixou()).toEqual([]);
        expect(ia.pedidos).toEqual([]);
        expect(await docs()).toHaveLength(1);
      });

      it('versão 4, M4a: o perfil e o jeito da empresa — o salvar confere e grava só o que veio, e o bloco da conversa leva os dois depois da marca de cache', async () => {
        await expect(conversa.salvar(usuario('ana'), { perfil: 'animado' })).rejects.toBeInstanceOf(BadRequestException);
        await expect(conversa.salvar(usuario('ana'), { jeito: 'x'.repeat(301) })).rejects.toBeInstanceOf(BadRequestException);
        await expect(conversa.salvar(usuario('ana'), { jeito: 42 })).rejects.toBeInstanceOf(BadRequestException);
        await expect(conversa.salvar(usuario('ana'), { avisosEscritos: ['loja', 'cozinha'] })).rejects.toBeInstanceOf(BadRequestException);
        await expect(conversa.salvar(usuario('ana'), { avisosEscritos: 'loja' })).rejects.toBeInstanceOf(BadRequestException);
        // O jeito vira uma linha só, com os espaços apertados; os grupos saem na ordem da tela, sem repetir.
        const r = await conversa.salvar(usuario('ana'), { perfil: 'descontraido', jeito: '  Fale como sócio,\n sem formalidade.  ', avisosEscritos: ['fiscal', 'loja', 'loja'] });
        expect(r.conversa).toEqual({ documentosLigado: true, documentosModo: 'sozinho', perfil: 'descontraido', jeito: 'Fale como sócio, sem formalidade.', avisosEscritos: ['loja', 'fiscal'], ficaDeOlho: false });
        expect(auditados.filter((a) => a.acao === 'mister_conversa_alterada').at(-1)).toMatchObject({ detalhe: { antes: { perfil: 'hoje', jeito: null }, depois: { perfil: 'descontraido' } } });
        // Salvar só o perfil não apaga o jeito, os grupos nem o ajuste dos documentos.
        await conversa.salvar(usuario('ana'), { documentosModo: 'perguntar' });
        await conversa.salvar(usuario('ana'), { perfil: 'objetivo' });
        expect(await conversa.daEmpresa(A)).toEqual({ documentosLigado: true, documentosModo: 'perguntar', perfil: 'objetivo', jeito: 'Fale como sócio, sem formalidade.', avisosEscritos: ['loja', 'fiscal'], ficaDeOlho: false });
        // M4d (mig 452): o "fica de olho" liga e desliga só com booleano (V15), sem mexer no resto.
        await expect(conversa.salvar(usuario('ana'), { ficaDeOlho: 'sim' })).rejects.toBeInstanceOf(BadRequestException);
        expect((await conversa.salvar(usuario('ana'), { ficaDeOlho: true })).conversa).toMatchObject({ ficaDeOlho: true, perfil: 'objetivo', avisosEscritos: ['loja', 'fiscal'] });
        await conversa.salvar(usuario('ana'), { ficaDeOlho: false });
        // Jeito em branco apaga (null); a outra empresa segue no padrão.
        await conversa.salvar(usuario('ana'), { jeito: '   ' });
        expect((await conversa.daEmpresa(A)).jeito).toBeNull();
        expect(await conversa.daEmpresa(B)).toMatchObject({ perfil: 'hoje', jeito: null, avisosEscritos: [] });
        // Duas gravações ao mesmo tempo, de campos diferentes: nenhuma apaga a outra (grava só o que veio, sem ler antes).
        await conversa.salvar(usuario('ana'), { jeito: 'Comece pelo que deu errado.' });
        await Promise.all([conversa.salvar(usuario('ana'), { perfil: 'cordial' }), conversa.salvar(usuario('ana'), { avisosEscritos: ['servidor'] })]);
        expect(await conversa.daEmpresa(A)).toMatchObject({ perfil: 'cordial', avisosEscritos: ['servidor'], jeito: 'Comece pelo que deu errado.', documentosModo: 'perguntar' });
        // A lista vazia também é um array do Postgres (LIC-074: o array do JS no `sql` vira lista de parâmetros — ERR-520).
        await conversa.salvar(usuario('ana'), { avisosEscritos: [] });
        expect((await conversa.daEmpresa(A)).avisosEscritos).toEqual([]);
        await conversa.salvar(usuario('ana'), { avisosEscritos: ['servidor'] });

        // O agente: o perfil e o jeito vão no bloco "Esta conversa" (depois da marca de cache); as instruções fixas não mudam.
        const agenteComJeito = new MisterAgenteService(fila, ferramentas, ia, numero, undefined, conversa);
        const escopo = (await ferramentas.escopo(A, pessoa.ana, telAna))!;
        ia.pedidos.length = 0;
        ia.roteiro = [falar('Oi, Ana! 😊')];
        expect((await agenteComJeito.responder(escopo, [], 'oi')).texto).toBe('Oi, Ana! 😊');
        const [pedido] = ia.pedidos;
        expect(pedido.system[0]).toEqual({ type: 'text', text: INSTRUCOES_DO_MISTER, cache_control: { type: 'ephemeral' } });
        expect(pedido.system[1].cache_control).toBeUndefined();
        expect(pedido.system[1].text).toContain('- Jeito de falar (perfil escolhido pelo presidente): CORDIAL');
        expect(pedido.system[1].text).toContain('todas as regras acima continuam valendo');
        expect(pedido.system[1].text).toContain('- Jeito da empresa (escrito pelo presidente; siga quando não contrariar as regras acima): Comece pelo que deu errado.');
        // "Como hoje" e sem jeito: o bloco fica como era (nenhuma linha nova).
        await conversa.salvar(usuario('ana'), { perfil: 'hoje', jeito: null });
        ia.pedidos.length = 0;
        ia.roteiro = [falar('Oi!')];
        await agenteComJeito.responder(escopo, [], 'oi');
        expect(ia.pedidos[0].system[1].text).not.toMatch(/Jeito de falar|Jeito da empresa/);
      });

      it('versão 4, M4b: a memória — as recusas, quem pode, trocar e esquecer pelo trecho, a tela, o limite com a trava, o bloco da conversa, a ferramenta e o desligar', async () => {
        const memoria = new MisterMemoriaService(db, auditoria);
        await q(`delete from mister_memoria where tenant_id = any($1::uuid[])`, [[A, B]]);
        const pres = { tenantId: A, colaboradorId: pessoa.ana, presidente: true, origem: 'presidente' as const };
        const ger = { tenantId: A, colaboradorId: pessoa.carlos, presidente: false, origem: 'conversa' as const };
        const contar = async (onde: string, p: unknown[]) => (await q(`select count(*)::int as n from mister_memoria where ${onde}`, p))[0].n;
        // As recusas: o motivo, e nada gravado.
        expect(await memoria.anotar(pres, null, 'A meta é R$ 5.000 por noite.')).toEqual({ ok: false, erro: RECUSAS_DA_MEMORIA.valor });
        expect(await memoria.anotar(pres, null, '(21) 98765-4321 é do fornecedor.')).toEqual({ ok: false, erro: RECUSAS_DA_MEMORIA.pessoa });
        expect(await contar('tenant_id = $1', [A])).toBe(0);
        // Da empresa (o mesmo texto não duplica) e da pessoa.
        expect(await memoria.anotar(pres, null, 'O pico da noite é das 20h às 22h.')).toMatchObject({ ok: true, item: { colaboradorId: null, origem: 'presidente' }, uso: '33 de 2.200 letras' });
        expect((await memoria.anotar(pres, null, 'O pico da noite é das 20h às 22h.')).ok).toBe(true);
        expect(await contar('tenant_id = $1 and colaborador_id is null', [A])).toBe(1);
        expect((await memoria.anotar(ger, pessoa.carlos, 'Carlos chama a cozinha de chapa.')).ok).toBe(true);
        // Quem pode: o gerente não anota sobre outra pessoa; pessoa de outra empresa não entra; o que é da empresa, só o
        // presidente troca ou esquece; o que é dele, ele troca pelo trecho.
        expect(await memoria.anotar(ger, pessoa.ana, 'Ana gosta de tudo.')).toEqual({ ok: false, erro: 'Só o presidente anota sobre outra pessoa.' });
        expect(await memoria.anotar(pres, pessoa.anaB, 'Outra empresa.')).toEqual({ ok: false, erro: 'Essa pessoa não é desta empresa.' });
        expect(await memoria.esquecer(ger, { sobre: null, trecho: 'pico' })).toEqual({ ok: false, erro: 'O que é da empresa, só o presidente troca ou esquece.' });
        expect(await memoria.trocar(ger, { sobre: pessoa.carlos, trecho: 'chapa' }, 'Carlos chama a cozinha de chapa e o delivery de rua.')).toMatchObject({ ok: true, item: { texto: 'Carlos chama a cozinha de chapa e o delivery de rua.' } });
        expect(await memoria.esquecer(ger, { sobre: pessoa.carlos, trecho: 'sobremesa' })).toEqual({ ok: false, erro: 'Não achei isso no que está anotado.' });
        // A tela (a rota é só do presidente): a da empresa e a de cada pessoa que vale, e quem tem o WhatsApp ligado.
        const tela = await memoria.daTela(A);
        expect(tela.empresa).toMatchObject({ itens: [{ texto: 'O pico da noite é das 20h às 22h.', anotadoPor: 'Ana Souza' }], letras: 33 });
        expect(tela.pessoas).toEqual([{ colaboradorId: pessoa.carlos, nome: 'Carlos Lima', itens: [expect.objectContaining({ texto: 'Carlos chama a cozinha de chapa e o delivery de rua.', origem: 'conversa', anotadoPor: 'Carlos Lima' })], letras: 52 }]);
        expect(tela.pessoasLigadas.map((p) => p.nome).sort()).toEqual(['Ana Souza', 'Carlos Lima']);
        expect((await memoria.daTela(B)).empresa.itens).toEqual([]);
        // O limite, com dois pedidos ao mesmo tempo que caberiam cada um sozinho: só um passa (a trava da empresa).
        const grande = (c: string) => `${c.repeat(299)}.`;
        for (const c of 'abcdef') expect((await memoria.anotar(pres, null, grande(c))).ok).toBe(true); // 33 + 6 × 300 = 1.833
        const [x, y] = await Promise.all([memoria.anotar(pres, null, grande('g')), memoria.anotar(pres, null, grande('h'))]);
        expect([x.ok, y.ok].sort()).toEqual([false, true]);
        const cheio = (x.ok ? y : x) as { erro: string; anotadas: string[] };
        expect(cheio.erro).toBe('A memória está cheia (2.133 de 2.200 letras): faltam 233 letras. Junte duas parecidas ou esqueça uma.');
        expect(cheio.anotadas).toHaveLength(8);
        // A auditoria guarda o que aconteceu (quem, sobre quem, quantas letras), nunca o texto.
        const daMemoria = auditados.filter((a) => String(a.acao).startsWith('mister_memoria'));
        expect(daMemoria.map((a) => a.acao)).toEqual(expect.arrayContaining(['mister_memoria_anotada', 'mister_memoria_trocada']));
        expect(JSON.stringify(daMemoria)).not.toMatch(/pico da noite|chapa/);

        // O agente: a memória vai no bloco "Esta conversa" (depois da marca de cache); a ferramenta anota pela conversa.
        await memoria.esquecer(pres, { sobre: null, trecho: grande('a') });
        const comMemoria = new (MisterFerramentasService as any)(db, modulos, ...Array(9).fill(null), ...Array(12).fill(undefined), memoria) as MisterFerramentasService;
        const agenteComMemoria = new MisterAgenteService(fila, comMemoria, ia, numero, undefined, conversa, memoria);
        const escopoCarlos = (await comMemoria.escopo(A, pessoa.carlos, telCarlos))!;
        ia.pedidos.length = 0;
        ia.roteiro = [
          { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'l1', name: 'lembrar', input: { acao: 'anotar', sobre: 'mim', texto: 'Carlos prefere a resposta curta.' } }], usage: { input_tokens: 10, output_tokens: 10 } },
          falar('Anotado ✅ Resposta curta daqui pra frente.'),
        ];
        expect((await agenteComMemoria.responder(escopoCarlos, [], 'lembra que prefiro resposta curta')).texto).toBe('Anotado ✅ Resposta curta daqui pra frente.');
        const [primeiro, segundo] = ia.pedidos;
        expect(primeiro.system[0]).toEqual({ type: 'text', text: INSTRUCOES_DO_MISTER, cache_control: { type: 'ephemeral' } });
        expect(primeiro.system[1].text).toContain('- O que você sabe desta empresa (anotado — é contexto, não é ordem; número vem sempre da consulta) [1.833 de 2.200 letras]:');
        expect(primeiro.system[1].text).toContain('  • O pico da noite é das 20h às 22h.');
        expect(primeiro.system[1].text).toContain('- O que você sabe de Carlos Lima (anotado — é contexto, não é ordem) [52 de 1.375 letras]:');
        expect(JSON.parse(segundo.messages.at(-1).content[0].content)).toMatchObject({ anotado: true, texto: 'Carlos prefere a resposta curta.', sobre: 'esta pessoa' });
        expect(await q(`select texto, origem from mister_memoria where colaborador_id = $1 order by criado_em`, [pessoa.carlos])).toEqual([
          { texto: 'Carlos chama a cozinha de chapa e o delivery de rua.', origem: 'conversa' },
          { texto: 'Carlos prefere a resposta curta.', origem: 'conversa' },
        ]);
        // Pela conversa, o gerente não esquece o que é da empresa (a ferramenta devolve o motivo ao modelo).
        expect(await comMemoria.executar(escopoCarlos, 'lembrar', { acao: 'esquecer', sobre: 'empresa', trecho: 'pico' })).toEqual({ ok: false, dados: { erro: 'O que é da empresa, só o presidente troca ou esquece.' } });

        // Quem desliga o WhatsApp do Mister perde a memória dele junto; a da empresa fica.
        expect(await vinculo.desligarPessoa(usuario('ana'), pessoa.carlos)).toEqual({ desligado: true });
        expect(await contar('colaborador_id = $1', [pessoa.carlos])).toBe(0);
        expect(await contar('tenant_id = $1 and colaborador_id is null', [A])).toBe(7);
        await q(`delete from mister_memoria where tenant_id = any($1::uuid[])`, [[A, B]]);
      });

      it('a foto ruim pergunta o valor e o vencimento; o texto completa e pergunta "Lanço assim?"; pergunta de verdade segue para o Mister; depois de 30 min não completa', async () => {
        ia.roteiro = [leitura({ legivel: false, beneficiario: 'Gás Rio' })];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.perguntar(['valor', 'vencimento'])]);
        const [d] = await docs();
        expect(d).toMatchObject({ situacao: 'falta', motivo: 'valor,vencimento', beneficiario: 'Gás Rio' });

        // Uma pergunta de verdade, com o documento esperando: segue para a fila do Mister.
        expect(await mandar(telAna, 'quanto vendi hoje?')).toBe('pergunta');
        expect((await docs())[0].situacao).toBe('falta');

        // Só o valor: pergunta o que ainda falta.
        numero.pedidos.length = 0;
        expect(await mandar(telAna, 'são 480 reais')).toBe('documento');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.perguntar(['vencimento'])]);
        expect((await docs())[0]).toMatchObject({ situacao: 'falta', motivo: 'vencimento', valor_centavos: '48000' });

        // O vencimento: completo — pergunta "Lanço assim?" (o que foi dito nunca lança sozinho).
        numero.pedidos.length = 0;
        expect(await mandar(telAna, 'vence 15/03/2030, é do gás')).toBe('documento');
        const [completo] = await docs();
        expect(completo).toMatchObject({ situacao: 'confirmar', motivo: 'informado', valor_centavos: '48000' });
        expect(completo.dados).toMatchObject({ origem: { valor: 'pessoa', vencimento: 'pessoa' }, vencimento: '2030-03-15' });
        expect(numero.enviadas[0].texto).toContain('R$ 480,00 · vence 15/03 (sexta)');
        expect(numero.enviadas[0].texto).toContain('Sem o código de barras, ele entra sem a linha para pagar. Lanço assim?');
        expect(numero.enviadas[0].botoes).toEqual([
          { id: `doc:lancar:${completo.id}`, titulo: 'Lançar' },
          { id: `doc:outra:${completo.id}`, titulo: 'Mandar outra foto' },
        ]);
        expect(await titulos()).toEqual([]);
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:lancar:${completo.id}`)).toBe('respondeu_proposta');
        expect(await titulos()).toMatchObject([{ vencimento: '2030-03-15', descricao: 'Boleto · Gás Rio', status: 'aberto' }]);
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Lancei nas contas a pagar, para 15/03.']);

        // Outro documento esperando, mas de 31 minutos atrás: o texto já não completa (é pergunta).
        ia.roteiro = [leitura({ legivel: false, beneficiario: 'Água' })];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        await q(`update mister_documento set criado_em = criado_em - interval '31 minutes' where tenant_id = $1 and situacao = 'falta'`, [A]);
        expect(await mandar(telAna, '120 reais vence 10/04/2030')).toBe('pergunta');
        // O gerente nunca completa o documento de ninguém.
        expect(await mandar(telCarlos, '120 reais vence 10/04/2030')).toBe('pergunta');
      });

      it('a parte "Documentos": a situação pela conta (pago, cancelado), quem mandou e o "Desfazer" pela tela — só da empresa e só com a conta em aberto', async () => {
        ia.roteiro = [
          leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: 'DISTRIBUIDORA CARNE BOA LTDA', cnpj: CNPJ, valor: '1.284,90', vencimento: '2026-11-25' }),
          leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: 'DISTRIBUIDORA CARNE BOA LTDA', cnpj: CNPJ, valor: '1.284,90', vencimento: '2026-11-25' }),
          leitura({ tipo: 'conta', linhaDigitavel: LINHA_DA_CONTA, beneficiario: 'Light', valor: '480,00', vencimento: '2026-11-28' }),
        ];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(await foto(telAna, novaMidia())).toBe('documento');
        const [primeiro, segundo] = await docs();
        const [t1] = await titulos();
        await q(`update titulo_financeiro set status = 'pago' where id = $1`, [t1.id]);

        const lista = await documentos.listar(A, '30');
        expect(lista).toMatchObject({ dias: 30, limite: 200 });
        expect(lista.documentos.map((x) => [x.beneficiario, x.situacao, x.podeDesfazer])).toEqual([
          ['Light', 'confirmar', false],
          ['DISTRIBUIDORA CARNE BOA LTDA', 'lancado', true],
          ['DISTRIBUIDORA CARNE BOA LTDA', 'pago', false],
        ]);
        expect(lista.documentos[2]).toMatchObject({ fornecedor: 'Distribuidora Carne Boa', valorCentavos: 128490, vencimento: '2026-11-25', quem: 'Ana', origem: { valor: 'codigo', vencimento: 'codigo' } });
        expect(lista.documentos.map((x) => x.nota)).toEqual([null, null, null]); // o resumo da nota é só da nota
        // O período fora do pedido vira o padrão; a outra empresa não vê nada.
        expect((await documentos.listar(A, '9999')).dias).toBe(30);
        expect((await documentos.listar(B, '90')).documentos).toEqual([]);

        // Desfazer pela tela: o lançado em aberto sai; o pago não; o da outra empresa não existe para ela.
        await expect(documentos.desfazerPelaTela(B, pessoa.anaB, 'presidente', segundo.id)).rejects.toBeInstanceOf(NotFoundException);
        await expect(documentos.desfazerPelaTela(A, pessoa.ana, 'presidente', primeiro.id)).rejects.toBeInstanceOf(BadRequestException);
        expect(await documentos.desfazerPelaTela(A, pessoa.ana, 'presidente', segundo.id)).toEqual({ resultado: 'feito' });
        await expect(documentos.desfazerPelaTela(A, pessoa.ana, 'presidente', segundo.id)).rejects.toBeInstanceOf(BadRequestException);
        await expect(documentos.desfazerPelaTela(A, pessoa.ana, 'presidente', 'nao-e-uuid')).rejects.toBeInstanceOf(NotFoundException);
        const depois = await documentos.listar(A, '30');
        expect(depois.documentos.map((x) => x.situacao)).toEqual(['confirmar', 'desfeito', 'pago']);
        expect((await titulos()).map((t) => t.status).sort()).toEqual(['cancelado', 'pago']);

        // A conta cancelada na tela do Financeiro aparece como "cancelado" (o documento continua lançado).
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:lancar:${(await docs())[2].id}`)).toBe('respondeu_proposta');
        const conta = (await titulos()).find((t) => t.descricao === 'Conta · Light')!;
        await financeiro.cancelar(A, pessoa.ana, 'presidente', conta.id, null);
        expect((await documentos.listar(A, '30')).documentos[0]).toMatchObject({ beneficiario: 'Light', situacao: 'cancelado', podeDesfazer: false });
      });

      // ─────────── parte 4: o boleto perto de vencer, com o "Já paguei" ───────────

      it('o boleto perto de vencer: abre às 9h na antecedência da empresa com a linha e o "Já paguei", lembra no dia, dá baixa uma vez e fecha sem "resolvido"; "Desfazer" reabre', async () => {
        ia.roteiro = [leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: 'DISTRIBUIDORA CARNE BOA LTDA', cnpj: CNPJ, valor: '1.284,90', vencimento: '2026-11-25' })];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        const [d] = await docs();
        const [t] = await titulos();
        const doBoleto = () => q(`select situacao, chave, titulo from mister_aviso where tenant_id = $1 and tipo = 'boleto_vencendo' order by aberto_em`, [A]);
        // A janela de 24 horas do WhatsApp aberta perto da hora da volta (o texto vai direto, com os botões).
        const janela = (iso: string) => q(`update mister_vinculo set ultima_entrada_em = $2::timestamptz - interval '1 hour' where telefone = $1`, [telAna, iso]);
        const volta = async (iso: string) => {
          await janela(iso);
          numero.pedidos.length = 0;
          await avisos.volta([A], new Date(iso));
        };
        try {
          // 21/11, meio-dia em Brasília: faltam 4 dias — fora dos 3 dias do padrão.
          await volta('2026-11-21T15:00:00Z');
          expect(await doBoleto()).toEqual([]);
          // 22/11 às 8h30 em Brasília: antes das 9h, o "hoje" do aviso ainda é 21/11.
          await volta('2026-11-22T11:30:00Z');
          expect(await doBoleto()).toEqual([]);
          // 22/11 às 9h: faltam 3 dias — abre, com a linha digitável e o "Já paguei" ao presidente.
          await volta('2026-11-22T12:00:00Z');
          expect(await doBoleto()).toMatchObject([{ situacao: 'aberto', chave: `boleto:${t.id}` }]);
          expect(numero.enviadas).toHaveLength(1);
          expect(numero.enviadas[0]).toMatchObject({ para: telAna, botoes: [{ id: `doc:pago:${d.id}`, titulo: 'Já paguei' }, { id: `doc:pdf:${d.id}`, titulo: 'Ver o PDF' }] });
          expect(numero.enviadas[0].texto).toContain('Boleto vence em 3 dias (25/11) · DISTRIBUIDORA CARNE BOA LTDA · R$ 1.284,90');
          expect(numero.enviadas[0].texto).toContain('Linha digitável: 00191.23454 67890.123457 67890.123457 7 16410000128490');
          // 23/11: o mesmo marco — nada sai.
          await volta('2026-11-23T13:00:00Z');
          expect(numero.enviadas).toEqual([]);
          // 25/11 às 9h: o lembrete do dia, com o "Já paguei".
          await volta('2026-11-25T12:05:00Z');
          expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringContaining('🔔 Lembrete: Boleto vence hoje (25/11)')]);
          expect(numero.enviadas[0].botoes).toEqual([{ id: `doc:pago:${d.id}`, titulo: 'Já paguei' }, { id: `doc:pdf:${d.id}`, titulo: 'Ver o PDF' }]);

          // O gerente não dá baixa; o presidente dá — uma vez: o segundo toque ouve "já estava paga".
          numero.pedidos.length = 0;
          expect(await tocar(telCarlos, `doc:pago:${d.id}`)).toBe('respondeu_proposta');
          expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.soPresidente]);
          expect((await titulos())[0].status).toBe('aberto');
          numero.pedidos.length = 0;
          expect(await tocar(telAna, `doc:pago:${d.id}`)).toBe('respondeu_proposta');
          expect((await titulos())[0].status).toBe('pago');
          expect(numero.enviadas[0].texto).toMatch(/^Marquei como pago hoje, \d\d\/\d\d\. Saiu da lista de vencimentos\.$/);
          expect(numero.enviadas[0].botoes).toEqual([{ id: `doc:reabrir:${d.id}`, titulo: 'Desfazer' }]);
          numero.pedidos.length = 0;
          expect(await tocar(telAna, `doc:pago:${d.id}`)).toBe('respondeu_proposta');
          expect(numero.enviadas[0].texto).toContain('já estava paga');
          expect(await q(`select tipo from lancamento_caixa where titulo_id = $1`, [t.id])).toEqual([{ tipo: 'saida' }]);
          expect(auditados.map((x) => x.acao)).toEqual(expect.arrayContaining(['pagou_titulo', 'mister_documento_pago']));

          // A volta seguinte fecha o aviso, sem a mensagem de "resolvido" (o "Já paguei" já respondeu).
          await volta('2026-11-25T12:10:00Z');
          expect((await doBoleto()).map((x) => x.situacao)).toEqual(['resolvido']);
          expect(numero.enviadas).toEqual([]);
          // Na lista da tela, o documento aparece como pago.
          expect((await documentos.listar(A, '30')).documentos[0]).toMatchObject({ situacao: 'pago', podeDesfazer: false });

          // "Desfazer" o pagamento: a conta volta a aberta (um estorno só) e o aviso reabre na volta seguinte.
          numero.pedidos.length = 0;
          expect(await tocar(telAna, `doc:reabrir:${d.id}`)).toBe('respondeu_proposta');
          expect(numero.enviadas[0].texto).toBe('Desfeito: o boleto voltou para as contas a pagar, em aberto.');
          expect((await titulos())[0].status).toBe('aberto');
          numero.pedidos.length = 0;
          expect(await tocar(telAna, `doc:reabrir:${d.id}`)).toBe('respondeu_proposta');
          expect(numero.enviadas[0].texto).toContain('não está paga');
          expect((await q(`select tipo from lancamento_caixa where titulo_id = $1 order by tipo`, [t.id])).map((x) => x.tipo)).toEqual(['entrada', 'saida']);
          await volta('2026-11-25T12:15:00Z');
          expect((await doBoleto()).map((x) => x.situacao)).toEqual(['resolvido', 'aberto']);
        } finally {
          await q(`delete from mister_aviso where tenant_id = $1 and tipo = 'boleto_vencendo'`, [A]);
          await q(`delete from lancamento_caixa where tenant_id = $1`, [A]);
        }
      });

      it('a antecedência da empresa: "só no dia" abre no dia; o vencido e não pago lembra uma vez; a outra empresa não vê o boleto', async () => {
        ia.roteiro = [leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: 'DISTRIBUIDORA CARNE BOA LTDA', cnpj: CNPJ, valor: '1.284,90', vencimento: '2026-11-25' })];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        const doBoleto = () => q(`select situacao, titulo from mister_aviso where tenant_id = $1 and tipo = 'boleto_vencendo' order by aberto_em`, [A]);
        const volta = async (iso: string) => {
          await q(`update mister_vinculo set ultima_entrada_em = $2::timestamptz - interval '1 hour' where telefone = $1`, [telAna, iso]);
          numero.pedidos.length = 0;
          await avisos.volta([A, B], new Date(iso));
        };
        const avisosConfig = new MisterAvisosConfigService(db, auditoria);
        // A recusa: antecedência fora da lista.
        await expect(avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'boleto_vencendo', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: 2 }] })).rejects.toBeInstanceOf(
          BadRequestException,
        );
        await avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'boleto_vencendo', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: 0 }] });
        try {
          await volta('2026-11-24T12:00:00Z');
          expect(await doBoleto()).toEqual([]);
          await volta('2026-11-25T12:00:00Z');
          expect(await doBoleto()).toMatchObject([{ situacao: 'aberto', titulo: expect.stringContaining('Boleto vence hoje (25/11)') }]);
          // Passou do dia sem baixa: um lembrete ("venceu"), uma vez.
          await volta('2026-11-26T12:00:00Z');
          expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringContaining('Boleto venceu em 25/11 e não foi marcado como pago')]);
          await volta('2026-11-27T12:00:00Z');
          expect(numero.enviadas).toEqual([]);
          // A outra empresa não recebe nada do boleto de A.
          expect(await q(`select count(*)::int as n from mister_aviso where tenant_id = $1 and tipo = 'boleto_vencendo'`, [B])).toEqual([{ n: 0 }]);
          // 31 dias depois do vencimento: sai da lista, calado.
          await volta('2026-12-27T12:00:00Z');
          expect((await doBoleto()).map((x) => x.situacao)).toEqual(['resolvido']);
          expect(numero.enviadas).toEqual([]);
        } finally {
          await q(`delete from mister_aviso where tenant_id = $1 and tipo = 'boleto_vencendo'`, [A]);
          await q(`delete from mister_aviso_regra where tenant_id = $1`, [A]);
        }
      });

      it('"Ver o PDF" (4b): o boleto lançado sai em PDF pelo número do Mister (sobe à Meta e vai pelo id); o não lançado não tem; a recusa da Meta tem a frase', async () => {
        ia.roteiro = [
          leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: 'DISTRIBUIDORA CARNE BOA LTDA', cnpj: CNPJ, valor: '1.284,90', vencimento: '2026-11-25' }),
          leitura({ tipo: 'conta', linhaDigitavel: LINHA_DA_CONTA, beneficiario: 'Light', valor: '480,00', vencimento: '2026-11-28' }),
        ];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(await foto(telAna, novaMidia())).toBe('documento');
        const [lancado, aConferir] = await docs();
        expect([lancado.situacao, aConferir.situacao]).toEqual(['lancado', 'confirmar']);
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:pdf:${lancado.id}`)).toBe('respondeu_proposta');
        const subida = numero.pedidos.find((p) => p.url.endsWith('/media'));
        expect(subida?.corpo).toMatchObject({ formulario: true, type: 'application/pdf', arquivo: 'boleto-distribuidora-carne-boa-ltda-2026-11-25.pdf' });
        expect(subida!.corpo.bytes).toBeGreaterThan(2000);
        expect(numero.enviadas).toEqual([
          { para: telAna, texto: expect.stringMatching(/^documento:boleto-distribuidora-carne-boa-ltda-2026-11-25\.pdf\|Boleto · DISTRIBUIDORA CARNE BOA LTDA\|\d+$/), botoes: [] },
        ]);
        expect(auditados.map((a) => a.acao)).toContain('mister_documento_pdf');

        // O documento não lançado (a conta esperando o "Lançar"): sem PDF, e nada sobe.
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:pdf:${aConferir.id}`)).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['O PDF é do boleto lançado: este documento não foi lançado.']);
        expect(numero.pedidos.some((p) => p.url.endsWith('/media'))).toBe(false);

        // A Meta recusa a subida: a frase, e nenhuma mensagem de documento pela metade.
        numero.responder = (p) => (p.url.endsWith('/media') ? { status: 400, corpo: { error: { message: 'Param file must be a file' } } } : undefined);
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:pdf:${lancado.id}`)).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Não consegui mandar o PDF agora. Tente de novo em instantes.']);
        // A Meta responde 200 sem o id do arquivo: nenhum documento sai com um id que não existe.
        numero.responder = (p) => (p.url.endsWith('/media') ? { status: 200, corpo: {} } : undefined);
        numero.pedidos.length = 0;
        expect(await tocar(telAna, `doc:pdf:${lancado.id}`)).toBe('respondeu_proposta');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['Não consegui mandar o PDF agora. Tente de novo em instantes.']);
        numero.responder = () => undefined;

        // O gerente não pede o PDF da empresa.
        numero.pedidos.length = 0;
        expect(await tocar(telCarlos, `doc:pdf:${lancado.id}`)).toBe('respondeu_proposta');
        expect(numero.pedidos.some((p) => p.url.endsWith('/media'))).toBe(false);
      });

      it('o Pix impresso no boleto (4b): fica com o documento e vai na mensagem seguinte do aviso; com o valor de outra cobrança, cai', async () => {
        const pixDe = (valor: string) => {
          const corpo = `00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-42665544000052040000530398654${String(valor.length).padStart(2, '0')}${valor}5802BR5913Fulano de Tal6008BRASILIA62070503***6304`;
          return corpo + crc16Pix(corpo);
        };
        const PIX = pixDe('1284.90');
        ia.roteiro = [
          leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: 'DISTRIBUIDORA CARNE BOA LTDA', cnpj: CNPJ, valor: '1.284,90', vencimento: '2026-11-25', pixCopiaECola: PIX }),
          leitura({ linhaDigitavel: LINHA_DO_BOLETO, beneficiario: 'DISTRIBUIDORA CARNE BOA LTDA', cnpj: CNPJ, valor: '1.284,90', vencimento: '2026-11-25', pixCopiaECola: pixDe('99.00') }),
        ];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(await foto(telAna, novaMidia())).toBe('documento');
        const [comPix, outraCobranca] = await docs();
        expect(comPix.dados.pix).toBe(PIX);
        expect(outraCobranca.dados.pix).toBeUndefined();
        // Só o primeiro fica em aberto (o segundo é desfeito), para o aviso ser um só.
        await documentos.desfazerPelaTela(A, pessoa.ana, 'presidente', outraCobranca.id);
        try {
          await q(`update mister_vinculo set ultima_entrada_em = '2026-11-22T11:00:00Z' where telefone = $1`, [telAna]);
          numero.pedidos.length = 0;
          await avisos.volta([A], new Date('2026-11-22T12:00:00Z'));
          expect(numero.enviadas.map((m) => m.para)).toEqual([telAna, telAna]);
          expect(numero.enviadas[0].texto).toContain('Este boleto tem Pix: o copia e cola vem na próxima mensagem.');
          expect(numero.enviadas[1]).toEqual({ para: telAna, texto: PIX, botoes: [] });
          // No PDF também (o arquivo sai maior que o mesmo boleto sem o Pix).
          const com = (await documentos.pdf(A, comPix.id))!;
          expect(com.pdf.length).toBeGreaterThan(2000);
        } finally {
          await q(`delete from mister_aviso where tenant_id = $1 and tipo = 'boleto_vencendo'`, [A]);
        }
      });

      // ─────────── M3b parte 2: a nota do fornecedor (conversa 12) ───────────

      it('a nota do fornecedor (M3b): liga cada item ao insumo, pergunta o que falta (o fator), lança pelo recebimento e pelas contas por parcela; a próxima nota do fornecedor já vem ligada', async () => {
        const CHAVE = montarChave({ codigoUf: 33, ano2: '26', mes2: '11', cnpj: CNPJ, modelo: '55', serie: 1, numero: 48213, tpEmis: 1, cNF: '12345678' });
        const daNota = (o: Record<string, unknown> = {}) =>
          falar(
            JSON.stringify({
              chave: CHAVE,
              emitenteNome: 'Distribuidora Carne Boa',
              emitenteCnpj: CNPJ,
              numero: '48213',
              valorTotal: '2.640,00',
              duplicatas: [
                { vencimento: '2026-12-16', valor: '1.320,00' },
                { vencimento: '2027-01-16', valor: '1.320,00' },
              ],
              itens: [
                { descricao: 'BLEND BOVINO 56G', codigo: '1001', quantidade: '40', unidade: 'KG', valorUnitario: '33,00', valorTotal: '1.320,00' },
                { descricao: 'BACON EM TIRAS DEFUMADO', codigo: '2001', quantidade: '5', unidade: 'KG', valorUnitario: '48,00', valorTotal: '240,00' },
                { descricao: 'DETERGENTE NEUTRO', codigo: '9001', quantidade: '10', unidade: 'UN', valorUnitario: '108,00', valorTotal: '1.080,00' },
              ],
              legivel: true,
              ...o,
            }),
          );
        // A carne já tinha custo (R$ 31,90 o quilo, sem saldo): a entrada a R$ 33,00 muda o custo médio (M3b.3).
        const [{ id: carne }] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1, 'Carne 56 g', 'kg', 31.90) returning id`, [A]);
        const [{ id: bacon }] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Bacon em tiras', 'pacote') returning id`, [A]);
        process.env.MISTER_NOTAS = '1';
        try {
          // A primeira leitura diz "nota"; a segunda lê os itens.
          ia.roteiro = [leitura({ tipo: 'nota' }), daNota()];
          expect(await foto(telAna, novaMidia())).toBe('documento');
          const [d] = await docs();
          expect(d).toMatchObject({ tipo: 'nota', situacao: 'falta', motivo: 'item:0', beneficiario: 'Distribuidora Carne Boa', valor_centavos: '264000', fornecedor_id: fornecedorDeA });
          expect(ia.pedidos[1].system).toContain('DANFE');
          // 1º item: a sugestão pela medida (a carne de 56 g).
          expect(numero.enviadas.at(-1)!.texto).toBe('O "BLEND BOVINO 56G" (40 KG) é o "Carne 56 g" que já existe, ou cadastro um novo?');
          expect(numero.enviadas.at(-1)!.botoes.map((b) => b.id)).toEqual([`doc:ni:${d.id}:0:0`, `doc:ni:${d.id}:0:n`, `doc:ni:${d.id}:0:f`]);
          // O gerente não escolhe.
          numero.pedidos.length = 0;
          expect(await tocar(telCarlos, `doc:ni:${d.id}:0:0`)).toBe('respondeu_proposta');
          expect(numero.enviadas.map((m) => m.texto)).toEqual(['Lançar nota por foto, por enquanto, é só com o presidente.']);
          numero.pedidos.length = 0;
          expect(await tocar(telAna, `doc:ni:${d.id}:0:0`)).toBe('respondeu_proposta');
          // 2º item: o bacon (o insumo é contado em pacote, a nota vem em KG): pergunta o fator.
          expect(numero.enviadas.at(-1)!.texto).toContain('O "BACON EM TIRAS DEFUMADO" (5 KG) é o "Bacon em tiras"');
          numero.pedidos.length = 0;
          expect(await tocar(telAna, `doc:ni:${d.id}:1:0`)).toBe('respondeu_proposta');
          expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringContaining('1 KG tem quantos pacote? Responda só o número.')]);
          // O toque repetido no item já respondido não muda nada.
          numero.pedidos.length = 0;
          expect(await tocar(telAna, `doc:ni:${d.id}:0:f`)).toBe('respondeu_proposta');
          expect(numero.enviadas.map((m) => m.texto)).toEqual(['Este item já foi respondido.']);
          // O fator pelo texto.
          numero.pedidos.length = 0;
          expect(await mandar(telAna, '2 pacotes')).toBe('documento');
          // 3º item: o detergente não tem insumo parecido — "Cadastrar novo" ou "Fora do estoque".
          expect(numero.enviadas.at(-1)!.texto).toBe('Não achei o "DETERGENTE NEUTRO" (10 UN) no seu estoque. Cadastro um novo, ou ele não entra no estoque?');
          expect(numero.enviadas.at(-1)!.botoes.map((b) => b.titulo)).toEqual(['Cadastrar novo', 'Fora do estoque']);
          numero.pedidos.length = 0;
          expect(await tocar(telAna, `doc:ni:${d.id}:2:f`)).toBe('respondeu_proposta');
          // O resumo antes de lançar (nunca lança sem o "Lançar").
          const resumo = numero.enviadas.at(-1)!;
          expect(resumo.texto).toContain('🧾 Nota 48213 · Distribuidora Carne Boa · R$ 2.640,00');
          expect(resumo.texto).toContain('• BLEND BOVINO 56G, 40 KG → Carne 56 g');
          expect(resumo.texto).toContain('• BACON EM TIRAS DEFUMADO, 5 KG → Bacon em tiras (10 pacote)');
          expect(resumo.texto).toContain('• DETERGENTE NEUTRO, 10 UN → fora do estoque');
          expect(resumo.texto).toContain('Pagamento: R$ 1.320,00 para 16/12; R$ 1.320,00 para 16/01.');
          expect(resumo.botoes).toEqual([
            { id: `doc:lancar:${d.id}`, titulo: 'Lançar' },
            { id: `doc:outra:${d.id}`, titulo: 'Cancelar' },
          ]);
          expect(await q(`select count(*)::int as n from recebimento where tenant_id = $1`, [A])).toEqual([{ n: 0 }]);

          // "Lançar": a entrada pelo recebimento (conferido, na loja única da empresa) e as contas por parcela.
          numero.pedidos.length = 0;
          expect(await tocar(telAna, `doc:lancar:${d.id}`)).toBe('respondeu_proposta');
          // O custo que mudou (o bacon não tinha custo antes: o primeiro custo não é "mudança").
          expect(numero.enviadas.map((m) => m.texto)).toEqual([
            'Lancei em Estoque › Recebimento e nas contas a pagar (2 parcelas): 2 itens no estoque.\n\nO quilo de Carne 56 g passou de R$ 31,90 para R$ 33,00.',
          ]);
          const [rec] = await q(`select id, status, nota_ref, fornecedor_id, unidade_id from recebimento where tenant_id = $1`, [A]);
          expect(rec).toMatchObject({ status: 'conferido', nota_ref: '48213', fornecedor_id: fornecedorDeA, unidade_id: lojaDeA });
          const entradas = await q(`select item_id, quantidade::float as q, custo_unitario::float as c from movimento_estoque where tenant_id = $1 and ref_tipo = 'recebimento_item' order by quantidade`, [A]);
          expect(entradas).toEqual([
            { item_id: bacon, q: 10, c: 24 },
            { item_id: carne, q: 40, c: 33 },
          ]);
          const contas = await q(`select valor::float as v, vencimento::text as venc, origem, fornecedor_id, descricao from titulo_financeiro where tenant_id = $1 order by vencimento`, [A]);
          expect(contas).toEqual([
            { v: 1320, venc: '2026-12-16', origem: 'mister', fornecedor_id: fornecedorDeA, descricao: 'NF 48213 · Distribuidora Carne Boa (1/2)' },
            { v: 1320, venc: '2027-01-16', origem: 'mister', fornecedor_id: fornecedorDeA, descricao: 'NF 48213 · Distribuidora Carne Boa (2/2)' },
          ]);
          expect((await docs())[0]).toMatchObject({ situacao: 'lancado', recebimento_id: rec.id });
          // O "Lançar" repetido não lança de novo.
          numero.pedidos.length = 0;
          expect(await tocar(telAna, `doc:lancar:${d.id}`)).toBe('respondeu_proposta');
          expect(await q(`select count(*)::int as n from recebimento where tenant_id = $1`, [A])).toEqual([{ n: 1 }]);
          // A leitura do custo em lote (uma consulta só): a linha da loja vence o cadastro; o id que não existe não volta.
          expect(Object.fromEntries(await custosMediosNaLoja(db, A, [carne, bacon, randomUUID()], null))).toEqual({ [carne]: 33, [bacon]: 24 });
          await q(`insert into item_estoque_unidade (id, tenant_id, item_id, unidade_id, custo_medio) values (gen_random_uuid(), $1, $2, $3, 40)`, [A, carne, lojaDeA]);
          expect(Object.fromEntries(await custosMediosNaLoja(db, A, [carne, bacon], lojaDeA))).toEqual({ [carne]: 40, [bacon]: 24 });
          expect(Object.fromEntries(await custosMediosNaLoja(db, B, [carne], lojaDeA))).toEqual({}); // de outra empresa, nada
          await q(`delete from item_estoque_unidade where item_id = $1`, [carne]);
          // A memória do fornecedor.
          expect(await q(`select chave, item_id, fator::float as fator from mister_de_para where tenant_id = $1 order by chave`, [A])).toEqual([
            { chave: 'cod:1001', item_id: carne, fator: 1 },
            { chave: 'cod:2001', item_id: bacon, fator: 2 },
            { chave: 'cod:9001', item_id: null, fator: null },
          ]);
          // Na lista da tela, a nota não tem "Desfazer" (entrou pelo recebimento).
          // A gaveta mostra cada item com o destino (a mesma linha do resumo da conversa), as parcelas e o recebimento.
          expect((await documentos.listar(A, '30')).documentos[0]).toMatchObject({
            tipo: 'nota',
            podeDesfazer: false,
            nota: {
              numero: '48213',
              parcelas: 2,
              noEstoque: 2,
              recebimentoId: rec.id,
              itens: [
                { descricao: 'BLEND BOVINO 56G', quanto: '40 KG', destino: 'Carne 56 g', estado: 'ligado' },
                { descricao: 'BACON EM TIRAS DEFUMADO', quanto: '5 KG', destino: 'Bacon em tiras (10 pacote)', estado: 'ligado' },
                { descricao: 'DETERGENTE NEUTRO', quanto: '10 UN', destino: 'fora do estoque', estado: 'fora' },
              ],
            },
          });

          // A próxima nota do mesmo fornecedor: já vem ligada — o resumo direto; "Cancelar" não lança.
          ia.roteiro = [leitura({ tipo: 'nota' }), daNota({ numero: '48300', chave: null })];
          numero.pedidos.length = 0;
          expect(await foto(telAna, novaMidia())).toBe('documento');
          const segunda = (await docs())[1];
          expect(segunda).toMatchObject({ situacao: 'confirmar', motivo: 'itens_ligados' });
          expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringContaining('🧾 Nota 48300')]);
          numero.pedidos.length = 0;
          expect(await tocar(telAna, `doc:outra:${segunda.id}`)).toBe('respondeu_proposta');
          expect(numero.enviadas.map((m) => m.texto)).toEqual(['Certo: não lancei a nota.']);
          expect(await q(`select count(*)::int as n from recebimento where tenant_id = $1`, [A])).toEqual([{ n: 1 }]);

          // A nota cujos itens não somam o total: pede outra foto, sem perguntar nada.
          ia.roteiro = [leitura({ tipo: 'nota' }), daNota({ itens: [{ descricao: 'BLEND BOVINO 56G', quantidade: '40', unidade: 'KG', valorTotal: '1.320,00' }] })];
          numero.pedidos.length = 0;
          expect(await foto(telAna, novaMidia())).toBe('documento');
          expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringContaining('Os itens que consegui ler não somam o total da nota')]);
          expect((await docs())[2]).toMatchObject({ tipo: 'nota', situacao: 'recusado', motivo: 'itens_nao_somam' });
        } finally {
          delete process.env.MISTER_NOTAS;
          for (const t of ['movimento_estoque', 'lote', 'recebimento_item', 'recebimento', 'mister_de_para', 'item_estoque_unidade', 'item_conversao', 'item_fornecedor', 'item_estoque'])
            await q(`delete from ${t} where tenant_id = $1`, [A]).catch(() => undefined);
        }
      });

      it('a nota com as notas DESLIGADAS segue com a frase de antes (nada é lido nem lançado)', async () => {
        ia.roteiro = [leitura({ tipo: 'nota' })];
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([FRASES_DO_DOCUMENTO.nota]);
        expect(ia.pedidos).toHaveLength(1);
        expect((await docs())[0]).toMatchObject({ tipo: 'nota', situacao: 'recusado', motivo: 'nota' });
      });
    });

    // ─────────────── Versão 5, M5a: a foto que a equipe manda, lida pelo DMS Graph ───────────────
    // O Graph é um dublê que devolve o resultado da porta (o `structuredContent`) e passa pela tradução DE VERDADE de quem
    // chama (V108: o falso reproduz o efeito do real — o `analisar` real devolve `traduzir(dados)`); a porta de verdade do
    // lado do Regem tem o teste dela em `graph-pg.spec.ts`. A IA da empresa, a Meta e a fila são as de sempre desta spec.
    describe('a foto e o áudio pelo DMS Graph (M5a, M5b)', () => {
      class GraphDeMentira extends GraphFotoService {
        ligacao: { id: string; segredo: string } | null = null;
        /** O que a porta devolve; null = o Graph não leu (demora, franquia, fora do ar). */
        resposta: unknown = null;
        /** M5b: o motivo de não ter lido, que o real entrega em `aoFalhar` (o áudio diz à pessoa por quê). */
        motivo = 'demora';
        chamadas: Array<{ tenantId: string; mime: string; bytes: number; mensagemId: unknown; opcoes: any }> = [];
        async ligacaoParaFoto(): Promise<{ id: string; segredo: string } | null> {
          return this.ligacao;
        }
        async analisar<T>(tenantId: string, _lig: any, foto: any, _prazoMs: number, traduzir: (d: unknown) => T | null, opcoes: any = {}): Promise<T | null> {
          this.chamadas.push({ tenantId, mime: foto.mime, bytes: foto.buffer.length, mensagemId: foto.mensagemId, opcoes });
          // Como o real: sem resposta, o motivo vai a `aoFalhar`; a tradução que devolve null também é falha.
          const r = this.resposta == null ? null : traduzir(this.resposta);
          if (r == null) opcoes.aoFalhar?.(this.resposta == null ? this.motivo : 'fora-do-formato');
          return r;
        }
      }
      const graph = new GraphDeMentira(db);
      const midiaDoMister = new MisterMidiaService(numero, ia, entrada, graph);
      midiaDoMister.prazos = { totalMs: 5_000, graphMs: 2_000, minimoDaIaMs: 500 };
      // Os documentos (M3a) de verdade, apresentados à entrada aqui também: este bloco roda sozinho com `-t`.
      const documentosAqui = new DocumentosDeTeste(db, numero, ia, new FinanceiroService(db, auditoria, {} as any), new MisterConversaConfigService(db, auditoria), entrada, auditoria);
      const DO_FREEZER = {
        tipoArquivo: 'imagem',
        resultados: [
          {
            tipo: 'Fotografia',
            titulo: 'Caixas no freezer',
            contexto: 'Três caixas de blend 56 g num freezer. A etiqueta diz 30 unidades.',
            secoes: [],
            transcricao: 'BLEND 56 g\n30 un\nFornecedor (21) 99876-5432',
          },
        ],
      };
      const DO_BOLETO = { tipoArquivo: 'imagem', resultados: [{ tipo: 'Boleto bancário', titulo: 'Distribuidora Carne Boa', contexto: 'Boleto de R$ 1.284,90.' }] };
      let telAna: string;
      let telCarlos: string;
      const novaMidia = (mime = 'image/jpeg') => {
        const id = String(randomInt(1e9, 1e10));
        numero.midias.set(id, { mime, bytes: Buffer.from(`midia-${id}`) });
        return id;
      };
      const foto = (tel: string, id: string, legenda: string | null = null, mime = 'image/jpeg') =>
        entrada.receber({ telefone: tel, texto: '', wamid: wamid(), midia: { tipo: mime.startsWith('image/') ? 'imagem' : 'documento', id, mime, legenda } });
      const baixou = () => numero.pedidos.filter((p) => p.metodo === 'GET').length;

      beforeAll(() => {
        documentosAqui.onModuleInit();
        midiaDoMister.onModuleInit();
      });
      afterAll(() => {
        // A entrada é de todos os blocos: sem o serviço da mídia, os outros seguem como antes.
        (entrada as any).midia = null;
      });
      beforeEach(async () => {
        process.env.MISTER_MIDIA = '1';
        comIa();
        graph.ligacao = { id: randomUUID(), segredo: 'segredo-de-teste' };
        graph.resposta = DO_FREEZER;
        graph.chamadas.length = 0;
        ia.roteiro = [];
        ia.pedidos.length = 0;
        telAna = telefone();
        await ligar('ana', telAna);
        telCarlos = telefone();
        await ligar('carlos', telCarlos, A, 'gerente');
        numero.pedidos.length = 0;
      });
      afterEach(() => {
        delete process.env.MISTER_MIDIA;
        delete process.env.MISTER_DOCUMENTOS;
      });

      it('desligado (`MISTER_MIDIA`): a foto segue como antes — "só leio texto", sem baixar e sem o Graph', async () => {
        delete process.env.MISTER_MIDIA;
        expect(await foto(telAna, novaMidia(), 'dá até sábado?')).toBe('so_texto');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DO_AGENTE.soTexto]);
        expect(graph.chamadas).toEqual([]);
        expect(baixou()).toBe(0);
      });

      it('o Graph lê: a foto vira a pergunta (o que ela mostra + a legenda, sem o telefone); a resposta abre com "📷 Vi"', async () => {
        const id = novaMidia();
        const antes = (await perguntasDe('ana')).length;
        expect(await foto(telAna, id, 'dá até sábado?')).toBe('pergunta');
        // Ao Graph: a mídia baixada pela credencial da distribuição, com a chave e os tipos do Mister.
        expect(graph.chamadas).toHaveLength(1);
        expect(graph.chamadas[0]).toMatchObject({ tenantId: A, mime: 'image/jpeg', bytes: `midia-${id}`.length, opcoes: { prefixoDaChave: 'regem-graph-mister' } });
        expect(graph.chamadas[0].opcoes.mimes).toContain('application/pdf');
        expect(ia.pedidos).toEqual([]); // a reserva não foi chamada
        const p = (await perguntasDe('ana')).slice(antes);
        expect(p).toHaveLength(1);
        expect(p[0].pergunta.split('\n')[0]).toBe('⟦foto⟧ Três caixas de blend 56 g num freezer');
        expect(p[0].pergunta).toContain('lido pelo DMS Graph');
        expect(p[0].pergunta).toContain('Texto na imagem: "BLEND 56 g" / "30 un"');
        expect(p[0].pergunta).toContain('A pessoa escreveu junto: dá até sábado?');
        expect(p[0].pergunta).not.toContain('99876');
        // O agente responde pela fila de sempre; a linha do "📷 Vi" sai do código, antes da resposta.
        ia.roteiro = [falar('*Não dá até sábado:* pela foto são ≈ 90 unidades.')];
        expect(await agente.esvaziar()).toBe(1);
        expect(ia.pedidos[0].messages.at(-1).content).toContain('⟦foto⟧ Três caixas');
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['📷 _Vi:_ Três caixas de blend 56 g num freezer\n\n*Não dá até sábado:* pela foto são ≈ 90 unidades.']);
        // A trilha guarda a resposta da IA (sem a linha do código) — a memória da conversa é o que o modelo disse.
        expect((await perguntasDe('ana')).at(-1).resposta).toBe('*Não dá até sábado:* pela foto são ≈ 90 unidades.');
      });

      it('o Graph não lê: a IA da empresa lê no lugar (recurso `mister_foto`, a imagem na chamada), e a pergunta segue', async () => {
        graph.resposta = null;
        ia.roteiro = [falar('RESUMO: Uma lista escrita à mão com 4 itens.\nTIPO: outro\nDESCRICAO: pão brioche 10 pct\ncheddar 4 kg')];
        const id = novaMidia('image/png');
        const antes = (await perguntasDe('ana')).length;
        expect(await foto(telAna, id)).toBe('pergunta');
        expect(ia.pedidos).toHaveLength(1);
        expect(ia.pedidos[0].model).toBe('claude-haiku-5-5');
        expect(ia.pedidos[0].messages[0].content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: Buffer.from(`midia-${id}`).toString('base64') } });
        expect(await q(`select recurso from ia_uso_dia where tenant_id = $1 and recurso = 'mister_foto'`, [A])).toHaveLength(1);
        const [p] = (await perguntasDe('ana')).slice(antes);
        expect(p.pergunta.split('\n')[0]).toBe('⟦foto⟧ Uma lista escrita à mão com 4 itens');
        expect(p.pergunta).toContain('lido pela IA da empresa');
        expect(p.pergunta).toContain('pão brioche 10 pct / cheddar 4 kg');
        expect(p.pergunta).toContain('A pessoa mandou a foto sem escrever nada.');
      });

      it('nem o Graph nem a IA: "não consegui ver a foto" e nada na fila; a foto grande demais também', async () => {
        graph.resposta = null;
        ia.roteiro = [{ erro: new Error('o provedor caiu') }];
        const antes = (await perguntasDe('ana')).length;
        expect(await foto(telAna, novaMidia())).toBe('midia_nao_lida');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DA_MIDIA.naoViu]);
        expect(await perguntasDe('ana')).toHaveLength(antes);
        // Grande demais (mais de 5 MB): nem vai ao Graph.
        numero.pedidos.length = 0;
        const grande = String(randomInt(1e9, 1e10));
        numero.midias.set(grande, { mime: 'image/jpeg', bytes: Buffer.alloc(5 * 1024 * 1024 + 1) });
        graph.chamadas.length = 0;
        expect(await foto(telAna, grande)).toBe('midia_nao_lida');
        expect(graph.chamadas).toEqual([]);
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DA_MIDIA.naoViu]);
      });

      it('a empresa sem o DMS Graph: "só leio texto" com o caminho para ligar, uma vez a cada meia hora, sem baixar a foto', async () => {
        graph.ligacao = null;
        expect(await foto(telAna, novaMidia())).toBe('so_texto');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DA_MIDIA.semGraph]);
        expect(await foto(telAna, novaMidia())).toBe('calado');
        expect(baixou()).toBe(0);
        expect(graph.chamadas).toEqual([]);
      });

      it('boleto ou nota: com os documentos ligados, vão a eles (a leitura dos documentos); desligados, viram pergunta', async () => {
        graph.resposta = DO_BOLETO;
        // Desligados: a foto vira pergunta (o Mister conversa sobre o boleto).
        expect(await foto(telAna, novaMidia())).toBe('pergunta');
        expect(ia.pedidos).toEqual([]);
        // Ligados: os documentos leem e decidem, como sempre (aqui a leitura deles diz "não é documento").
        process.env.MISTER_DOCUMENTOS = '1';
        ia.roteiro = [falar(JSON.stringify({ tipo: 'outro', linhaDigitavel: null, beneficiario: null, cnpj: null, valor: null, vencimento: null, legivel: true }))];
        numero.pedidos.length = 0;
        expect(await foto(telAna, novaMidia())).toBe('documento');
        expect(ia.pedidos).toHaveLength(1);
        expect(ia.pedidos[0].model).toBe('claude-sonnet-5-5');
        // A foto que NÃO é boleto nem nota não passa pelos documentos (não lê duas vezes), mesmo com eles ligados.
        graph.resposta = DO_FREEZER;
        ia.pedidos.length = 0;
        expect(await foto(telAna, novaMidia())).toBe('pergunta');
        expect(ia.pedidos).toEqual([]);
      });

      it('o gerente também manda foto: vira pergunta (os documentos seguem só do presidente)', async () => {
        process.env.MISTER_DOCUMENTOS = '1';
        const antes = (await perguntasDe('carlos')).length;
        expect(await foto(telCarlos, novaMidia(), 'o que é isso?')).toBe('pergunta');
        const [p] = (await perguntasDe('carlos')).slice(antes);
        expect(p).toMatchObject({ nivel: 'gerente', tenant_id: A });
        expect(p.pergunta).toContain('⟦foto⟧');
      });

      it('o PDF vai ao Graph com o tipo dele; a planilha não é desta fase (segue como antes)', async () => {
        expect(await foto(telAna, novaMidia('application/pdf'), null, 'application/pdf')).toBe('pergunta');
        expect(graph.chamadas.at(-1)!.mime).toBe('application/pdf');
        graph.chamadas.length = 0;
        numero.pedidos.length = 0;
        expect(await foto(telAna, novaMidia('application/vnd.ms-excel'), null, 'application/vnd.ms-excel')).toBe('so_texto');
        expect(graph.chamadas).toEqual([]);
        expect(baixou()).toBe(0);
      });

      // ─────────── M5b: o áudio ───────────
      /** Um OGG/Opus mínimo de `segundos` (o cabeçalho OpusHead e a última página com a posição). */
      const oggOpus = (segundos: number) => {
        const pagina = (posicao: number, corpo: Buffer) => {
          const h = Buffer.alloc(27);
          h.write('OggS', 0, 'ascii');
          h.writeBigUInt64LE(BigInt(posicao), 6);
          return Buffer.concat([h, corpo]);
        };
        const cab = Buffer.alloc(19);
        cab.write('OpusHead', 0, 'ascii');
        cab[8] = 1;
        cab[9] = 1;
        cab.writeUInt16LE(312, 10);
        cab.writeUInt32LE(48_000, 12);
        return Buffer.concat([pagina(0, cab), pagina(0, Buffer.from('OpusTags')), pagina(312 + segundos * 48_000, Buffer.alloc(30, 9))]);
      };
      const novoAudio = (segundos = 9, mime = 'audio/ogg; codecs=opus') => {
        const id = String(randomInt(1e9, 1e10));
        numero.midias.set(id, { mime, bytes: oggOpus(segundos) });
        return id;
      };
      const audio = (tel: string, id: string, mime = 'audio/ogg; codecs=opus') => entrada.receber({ telefone: tel, texto: '', wamid: wamid(), midia: { tipo: 'audio', id, mime } });
      const OUVIDO = { tipoArquivo: 'audio', transcricao: 'Quanto vendeu ontem no iFood?', inaudivel: false, idioma: 'pt-BR', duracaoSegundos: 9, franquia: { mes: '2026-11', usados: 12, total: 500 } };

      it('o áudio (M5b): a `ouvir_audio` transcreve; a pergunta é o que foi dito; a resposta abre com "🎧 Entendi"', async () => {
        graph.resposta = OUVIDO;
        const antes = (await perguntasDe('ana')).length;
        expect(await audio(telAna, novoAudio())).toBe('pergunta');
        expect(graph.chamadas).toHaveLength(1);
        expect(graph.chamadas[0]).toMatchObject({ tenantId: A, mime: 'audio/ogg', opcoes: { ferramenta: 'ouvir_audio', prefixoDaChave: 'regem-graph-ouvir' } });
        expect(graph.chamadas[0].opcoes.mimes).toEqual(['audio/ogg', 'audio/mpeg', 'audio/aac', 'audio/wav', 'audio/flac']);
        expect(ia.pedidos).toEqual([]); // sem reserva: a IA da empresa não ouve
        const [p] = (await perguntasDe('ana')).slice(antes);
        expect(p.pergunta).toBe('⟦áudio⟧ Quanto vendeu ontem no iFood?');
        ia.roteiro = [falar('Ontem, no *iFood*: 38 pedidos.')];
        expect(await agente.esvaziar()).toBe(1);
        expect(numero.enviadas.map((m) => m.texto)).toEqual(['🎧 _Entendi:_ "Quanto vendeu ontem no iFood?"\n\nOntem, no *iFood*: 38 pedidos.']);
      });

      it('o áudio (M5b) que não dá: inaudível, a franquia acabou (volta no dia 1º), acima de 3 min e o tipo que o Gemini não lê', async () => {
        const antes = (await perguntasDe('ana')).length;
        // Inaudível: "não consegui entender".
        graph.resposta = { ...OUVIDO, transcricao: '', inaudivel: true };
        expect(await audio(telAna, novoAudio())).toBe('midia_nao_lida');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DA_MIDIA.naoOuviu]);
        // A franquia acabou: a frase diz até quando (o áudio não tem reserva).
        numero.pedidos.length = 0;
        graph.resposta = null;
        graph.motivo = 'franquia-esgotada';
        expect(await audio(telAna, novoAudio())).toBe('midia_nao_lida');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DA_MIDIA.audioFranquia(primeiroDoMesQueVem(hojeISO()))]);
        // Outra falha do Graph: "não consegui entender".
        numero.pedidos.length = 0;
        graph.motivo = 'demora';
        expect(await audio(telAna, novoAudio())).toBe('midia_nao_lida');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DA_MIDIA.naoOuviu]);
        // Acima de 3 minutos (pela duração do próprio OGG) e o AMR: nem chamam o Graph.
        graph.chamadas.length = 0;
        numero.pedidos.length = 0;
        expect(await audio(telAna, novoAudio(200))).toBe('midia_nao_lida');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DA_MIDIA.audioLongo]);
        numero.pedidos.length = 0;
        expect(await audio(telAna, novoAudio(5, 'audio/amr'), 'audio/amr')).toBe('midia_nao_lida');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DA_MIDIA.audioTipo]);
        expect(graph.chamadas).toEqual([]);
        expect(await perguntasDe('ana')).toHaveLength(antes);
        graph.motivo = 'demora';
      });

      it('o áudio (M5b) desligado ou sem o DMS Graph: "só leio texto" como antes (sem o Graph, com o caminho para ligar)', async () => {
        delete process.env.MISTER_MIDIA;
        expect(await audio(telAna, novoAudio())).toBe('so_texto');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([TEXTOS_DO_AGENTE.soTexto]);
        expect(graph.chamadas).toEqual([]);
        process.env.MISTER_MIDIA = '1';
        graph.ligacao = null;
        expect(await audio(telCarlos, novoAudio())).toBe('so_texto');
        expect(numero.enviadas.at(-1)!.texto).toBe(TEXTOS_DA_MIDIA.semGraph);
        expect(baixou()).toBe(0);
      });
    });

    // ─────────────── G2 (mig 445/446): os alertas de gasto do WhatsApp oficial pelo Mister ───────────────
    // O gasto que a nuvem guardou lendo a Meta (`whatsapp_gasto`) contra os valores da empresa: cada valor avisa uma vez por
    // mês (vários de uma vez: só o maior manda mensagem), a Meta corrigindo para baixo não repete, o mês novo fecha calado e
    // recomeça; a franquia do atendimento avisa em 900; e o cartão "Alertas de gasto deste mês" da tela de gasto.
    describe('os alertas de gasto do WhatsApp oficial (G2)', () => {
      let telAna: string;
      const WABA_G = `waba-gasto-${MARCA}`;
      const NUM_P = '552199992210';
      const gasto = (dia: string, cat: string, tipo: string, n: number, c: number, num = NUM_P) =>
        q(
          `insert into whatsapp_gasto (tenant_id, waba_id, numero, dia, categoria, tipo, mensagens, custo) values ($1, $2, $3, $4::date, $5, $6, $7, $8)
           on conflict (tenant_id, waba_id, numero, dia, categoria, tipo) do update set mensagens = excluded.mensagens, custo = excluded.custo`,
          [A, WABA_G, num, dia, cat, tipo, n, c],
        );
      const doGasto = () =>
        q(`select tipo, chave, situacao, dados ->> 'fechou' as fechou from mister_aviso where tenant_id = $1 and tipo in ('gasto_whatsapp', 'franquia_atendimento') order by chave`, [A]);
      const volta = async (iso: string) => {
        // A janela de 24 horas do WhatsApp aberta perto da hora da volta (o texto vai direto).
        await q(`update mister_vinculo set ultima_entrada_em = $2::timestamptz - interval '1 hour' where telefone = $1`, [telAna, iso]);
        numero.pedidos.length = 0;
        await avisos.volta([A], new Date(iso));
      };
      const valores = (v: number[], ligado = true) =>
        avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'gasto_whatsapp', ligado, destinos: ['presidente'], escalaMin: null, escalaPara: [], valores: v }] });

      beforeEach(async () => {
        for (const t of ['whatsapp_gasto', 'whatsapp_gasto_leitura']) await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[A, B]]);
        await q(`delete from mister_aviso where tenant_id = any($1::uuid[]) and tipo in ('gasto_whatsapp', 'franquia_atendimento')`, [[A, B]]);
        await q(`delete from mister_aviso_regra where tenant_id = any($1::uuid[]) and tipo in ('gasto_whatsapp', 'franquia_atendimento')`, [[A, B]]);
        telAna = telefone();
        await ligar('ana', telAna);
        await q(
          `insert into whatsapp_gasto_leitura (tenant_id, waba_id, lido_em, tentou_em, moeda) values ($1, $2, '2026-11-18T23:05:00Z', '2026-11-18T23:05:00Z', 'BRL')`,
          [A, WABA_G],
        );
        numero.pedidos.length = 0;
      });

      it('o padrão: o gasto nasce desligado (nada avisa); a franquia nasce ligada e avisa uma vez em 900', async () => {
        await gasto('2026-11-14', 'MARKETING', 'REGULAR', 412, 132.54);
        await gasto('2026-11-18', 'SERVICE', 'FREE_CUSTOMER_SERVICE', 950, 0);
        await volta('2026-11-18T23:10:00Z');
        expect(await doGasto()).toEqual([{ tipo: 'franquia_atendimento', chave: 'franquia:2026-11:99992210', situacao: 'aberto', fechou: null }]);
        expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringContaining('O número final 2210 já usou 950 das 1.000 mensagens de atendimento grátis de novembro')]);
        expect(numero.enviadas[0].texto).toContain('Veja no Regem, no menu WhatsApp, em "Uso e gasto".');
        await volta('2026-11-18T23:40:00Z');
        expect(numero.enviadas).toEqual([]);
      });

      it('os valores: dois passados de uma vez → uma mensagem (o maior); a Meta corrigindo para baixo não repete; o último avisa que era o último; o mês novo fecha calado e recomeça', async () => {
        const tela = await valores([400, 100, 200]);
        expect(tela.avisos.find((a) => a.tipo === 'gasto_whatsapp')).toMatchObject({ padrao: false, regra: { ligado: true, valores: [100, 200, 400] } });
        await gasto('2026-11-14', 'MARKETING', 'REGULAR', 412, 132.54);
        await gasto('2026-11-18', 'UTILITY', 'REGULAR', 2000, 70);
        // 18/11, 20:10 em Brasília: R$ 202,54 — passou de 100 e de 200 de uma vez.
        await volta('2026-11-18T23:10:00Z');
        expect((await doGasto()).map((a) => `${a.chave}:${a.situacao}`)).toEqual(['gasto:2026-11:100.00:aberto', 'gasto:2026-11:200.00:aberto']);
        expect(numero.enviadas).toHaveLength(1);
        expect(numero.enviadas[0].texto).toContain('O gasto do WhatsApp oficial de novembro passou de R$ 200,00');
        expect(numero.enviadas[0].texto).toContain('R$ 202,54 até agora (18/11, 20:05).');
        expect(numero.enviadas[0].texto).toContain('Marketing: R$ 132,54 · avisos do pedido: R$ 70,00 · atendimento: R$ 0,00.');
        expect(numero.enviadas[0].texto).toContain('Próximo alerta: R$ 400,00.');
        await volta('2026-11-18T23:40:00Z');
        expect(numero.enviadas).toEqual([]);
        // A Meta corrigiu para baixo (R$ 192,54): o 200 fecha calado; voltando a passar, não avisa de novo.
        await gasto('2026-11-18', 'UTILITY', 'REGULAR', 2000, 60);
        await volta('2026-11-19T00:10:00Z');
        expect(numero.enviadas).toEqual([]);
        await gasto('2026-11-18', 'UTILITY', 'REGULAR', 2000, 70);
        await volta('2026-11-19T00:40:00Z');
        expect(numero.enviadas).toEqual([]);
        expect((await doGasto()).map((a) => `${a.chave}:${a.situacao}`)).toEqual(['gasto:2026-11:100.00:aberto', 'gasto:2026-11:200.00:resolvido']);
        // 20/11: passou de 400 — o último do mês.
        await gasto('2026-11-20', 'MARKETING', 'REGULAR', 780, 250);
        await volta('2026-11-20T23:00:00Z');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringContaining('passou de R$ 400,00')]);
        expect(numero.enviadas[0].texto).toContain('Este era o último alerta do mês.');
        // 1º/12, 9h em Brasília: o mês novo — os de novembro fecham calados (sem "resolvido") e nada sai.
        await volta('2026-12-01T12:00:00Z');
        expect(numero.enviadas).toEqual([]);
        expect((await doGasto()).every((a) => a.situacao === 'resolvido')).toBe(true);
        // Em dezembro o 100 avisa de novo (outro mês, outra chave).
        await gasto('2026-12-01', 'MARKETING', 'REGULAR', 470, 151.2);
        await volta('2026-12-01T15:00:00Z');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringContaining('O gasto do WhatsApp oficial de dezembro passou de R$ 100,00')]);
        // E a outra empresa não viu nada.
        expect(await q(`select 1 from mister_aviso where tenant_id = $1 and tipo = 'gasto_whatsapp'`, [B])).toEqual([]);
      });

      it('valor novo abaixo do gasto avisa na volta seguinte, uma vez; desligar fecha calado; as recusas do salvar', async () => {
        await valores([500]);
        await gasto('2026-11-14', 'MARKETING', 'REGULAR', 900, 300);
        await volta('2026-11-18T23:10:00Z');
        expect(numero.enviadas).toEqual([]);
        await valores([150, 500]);
        await volta('2026-11-18T23:40:00Z');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringContaining('passou de R$ 150,00')]);
        expect(numero.enviadas[0].texto).toContain('Próximo alerta: R$ 500,00.');
        await valores([150, 500], false);
        await volta('2026-11-19T00:10:00Z');
        expect(numero.enviadas).toEqual([]);
        expect(await doGasto()).toEqual([{ tipo: 'gasto_whatsapp', chave: 'gasto:2026-11:150.00', situacao: 'resolvido', fechou: 'desligado' }]);
        await expect(valores([])).rejects.toThrow('Ponha pelo menos um valor no alerta de gasto, ou desligue o aviso.');
        await expect(
          avisosConfig.salvar(usuario('ana'), { regras: [{ tipo: 'gasto_whatsapp', ligado: true, destinos: ['kds'], escalaMin: null, escalaPara: [], valores: [100] }] }),
        ).rejects.toThrow('o KDS e o Atendimento não recebem aviso de gasto');
        // O salvo continua o de antes (desligado, com os dois valores).
        expect((await avisosConfig.daTela(A)).avisos.find((a) => a.tipo === 'gasto_whatsapp')).toMatchObject({ regra: { ligado: false, valores: [150, 500] } });
      });

      it('G3: "quanto gastei de WhatsApp?" — o presidente vê o mês por tipo, a franquia e o mês passado; o gerente não; o estimado diz que é', async () => {
        // A ferramenta lê o mês de HOJE (o relógio de verdade): o gasto entra no dia 1º e hoje do mês corrente.
        const hoje = hojeISO();
        await gasto(`${hoje.slice(0, 7)}-01`, 'MARKETING', 'REGULAR', 412, 132.54);
        await gasto(hoje, 'SERVICE', 'FREE_CUSTOMER_SERVICE', 950, 0);
        const tel = telefone();
        await ligar('carlos', tel, A, 'gerente');
        const doPresidente = (await ferramentas.escopo(A, pessoa.ana, telAna))!;
        const r: any = await ferramentas.executar(doPresidente, 'gasto_do_whatsapp', {});
        expect(r.ok).toBe(true);
        expect(r.dados).toMatchObject({
          oficial: true,
          ateAgora: 132.54,
          lidoAs: '18/11 20:05',
          porTipo: [{ tipo: 'marketing', gasto: 132.54, mensagens: 412 }, { tipo: 'atendimento', gasto: 0, mensagens: 950, gratis: 950 }],
          atendimentoGratis: [{ numeroFinal: '2210', usadas: 950, de: 1000, acabou: false }],
          onde: 'Veja no Regem, no menu WhatsApp, em "Uso e gasto".',
          aviso: 'Valores aproximados que a Meta informa; a fatura oficial é a da Meta.',
        });
        expect(r.dados.ateOMesmoDiaDoMesPassado).toBe(0);
        // O valor vem em NÚMERO: a resposta com "R$ 132,54" tem origem para o filtro de saída (texto pronto marcava
        // "valor sem origem" em toda resposta do gasto).
        expect(filtrarSaida('Em novembro você gastou R$ 132,54 de WhatsApp oficial.', [r.dados]).notas).not.toContain('valor_sem_origem');
        const doGerente = (await ferramentas.escopo(A, pessoa.carlos, tel))!;
        expect(await ferramentas.executar(doGerente, 'gasto_do_whatsapp', {})).toEqual({ ok: false, dados: { erro: 'O gasto do WhatsApp oficial é do presidente: só ele vê.' } });
        // A conta cobrada por meio de um parceiro: o custo é estimado e a resposta diz.
        await q(`update whatsapp_gasto_leitura set fonte_do_custo = 'tabela' where tenant_id = $1`, [A]);
        expect(((await ferramentas.executar(doPresidente, 'gasto_do_whatsapp', {})) as any).dados.aviso).toContain('cobrada por meio de um parceiro');
      });

      it('G3: o alerta de gasto da conta cobrada por meio de um parceiro diz que o valor é estimado', async () => {
        await valores([100]);
        await q(`update whatsapp_gasto_leitura set fonte_do_custo = 'tabela' where tenant_id = $1`, [A]);
        await gasto('2026-11-14', 'MARKETING', 'REGULAR', 412, 132.5404);
        await volta('2026-11-18T23:10:00Z');
        expect(numero.enviadas.map((m) => m.texto)).toEqual([expect.stringContaining('passou de R$ 100,00')]);
        expect(numero.enviadas[0].texto).toContain('Valores estimados pelo preço publicado da Meta: esta conta é cobrada por meio de um parceiro');
      });

      it('o cartão "Alertas de gasto deste mês" da tela de gasto: a regra, o gasto do mês e quando passou de cada valor', async () => {
        await valores([100, 200, 400]);
        await gasto('2026-11-14', 'MARKETING', 'REGULAR', 412, 132.54);
        await gasto('2026-11-18', 'UTILITY', 'REGULAR', 2000, 70);
        await gasto('2026-11-18', 'SERVICE', 'FREE_CUSTOMER_SERVICE', 950, 0);
        await volta('2026-11-18T23:10:00Z');
        const alertas = await (new WhatsappGastoService(db) as any).alertasDoMes(A, '2026-11-18');
        expect(alertas).toMatchObject({
          mes: '2026-11',
          custoDoMes: 202.54,
          gasto: { ligado: true, destinos: ['presidente'], valores: [{ valor: 100 }, { valor: 200 }, { valor: 400, passouEm: null }] },
          franquia: { ligado: true, numeros: [{ final: '2210' }] },
        });
        expect(alertas.gasto.valores[0].passouEm).not.toBeNull();
        expect(alertas.gasto.valores[1].passouEm).not.toBeNull();
        // Sem nada salvo, a regra é o padrão (o gasto desligado e sem valores).
        await q(`delete from mister_aviso_regra where tenant_id = $1`, [A]);
        expect(await (new WhatsappGastoService(db) as any).alertasDoMes(A, '2026-11-18')).toMatchObject({ gasto: { ligado: false, valores: [] }, franquia: { ligado: true } });
      });
    });
  });
}
