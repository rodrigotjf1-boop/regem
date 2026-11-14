import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { perfilPadrao } from '../../auth/permissoes';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { hojeISO, somarDias } from '../../common/data';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { EstoqueService } from '../estoque/estoque.service';
import { IaEmpresaService } from '../ia/ia-empresa.service';
import { RelatoriosService } from '../relatorios/relatorios.service';
import { ModuloService } from '../modulo/modulo.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { MisterConsoleService } from './mister-console.service';
import { FERRAMENTAS, INSTRUCOES_DO_MISTER, TETOS, TEXTOS_DO_AGENTE } from './mister-agente.regras';
import { MisterAgenteService } from './mister-agente.service';
import { MisterEntradaService } from './mister-entrada.service';
import { MisterFerramentasService } from './mister-ferramentas.service';
import { MisterFilaService } from './mister-fila.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
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
    const r = this.responder(p) ?? { status: 200, corpo: this.padrao(p) };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corpo, text: async () => JSON.stringify(r.corpo) };
  }
  private padrao(p: Pedido): any {
    if (p.url.endsWith('/messages')) return { messages: [{ id: `wamid.saida.${randomUUID()}` }] };
    if (p.url.includes('/phone_numbers')) return { data: [] };
    if (p.url.includes('fields=display_phone_number')) return { display_phone_number: '+55 21 90000-0000', verified_name: 'Mister', quality_rating: 'GREEN', whatsapp_business_manager_messaging_limit: 'TIER_2K' };
    return { success: true };
  }
  /** As mensagens que saíram pelo número: para quem, o texto e os botões. */
  get enviadas(): { para: string; texto: string; botoes: { id: string; titulo: string }[] }[] {
    return this.pedidos
      .filter((p) => p.url.endsWith('/messages') && p.corpo?.to)
      .map((p) => ({
        para: p.corpo.to,
        texto: p.corpo.type === 'text' ? p.corpo.text.body : p.corpo.interactive.body.text,
        botoes: p.corpo.type === 'interactive' ? p.corpo.interactive.action.buttons.map((b: any) => ({ id: b.reply.id, titulo: b.reply.title })) : [],
      }));
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
    const funcao: Record<string, string> = {};
    const pessoa: Record<string, string> = {};
    const usuario = (nome: string, tenant = A, categoria = 'presidente') => ({ tenantId: tenant, colaboradorId: pessoa[nome], categoria, unidadeId: null }) as any;
    const NOME_A = `Burger da Praça ${MARCA}`;
    const NOME_B = `Pizzaria do Porto ${MARCA}`;

    const linha = async (nome: string) => (await q(`select * from mister_vinculo where colaborador_id = $1`, [pessoa[nome]]))[0];
    const mandar = (tel: string, texto: string, extra: { botaoId?: string; wamid?: string } = {}) => entrada.receber({ telefone: tel, texto, botaoId: extra.botaoId ?? null, wamid: extra.wamid ?? wamid() });
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
      await q(`delete from mister_vinculo where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from mister_mensagem where wamid like $1`, [`wamid.${MARCA}.%`]);
      await q(`delete from mister_conversa where telefone = any($1::text[])`, [telefones]);
      telefones.length = 0;
    };

    beforeAll(async () => {
      // A 415, a 417 e a 418 são só da nuvem: o banco do CI é o de uma loja (ERR-273). Duas vezes: as migrations são idempotentes.
      for (let i = 0; i < 2; i++)
        for (const arq of ['415_ia_por_empresa.sql', '417_mister_numero_e_entrada.sql', '418_mister_perguntas.sql'])
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
      for (const t of ['ia_uso_dia', 'ia_credencial', 'modulo_ativacao', 'cardapio_config', 'colaborador', 'funcao', 'unidade'])
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
      for (const [chave, dias] of [['nova', 1], ['velha', 31], ['antiga', 91]] as const)
        await q(
          `insert into mister_pergunta (tenant_id, colaborador_id, nivel, telefone, chave, pergunta, resposta, situacao, chamadas, criado_em)
           values ($1, $2, 'presidente', $3, $4, 'pergunta', 'resposta', 'respondida', 1, now() - make_interval(days => $5))`,
          [A, pessoa.ana, tel, `limpa-${MARCA}-${chave}`, dias],
        );
      await entrada.limparMensagens();
      expect((await q(`select chave, pergunta, resposta from mister_pergunta where chave like $1 order by criado_em desc`, [`limpa-${MARCA}-%`])).map((l) => [l.chave.split('-').at(-1), l.pergunta, l.resposta])).toEqual([
        ['nova', 'pergunta', 'resposta'],
        ['velha', null, null],
      ]);
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
  });
}
