import { randomInt, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { hojeISO } from '../../common/data';
import { IaEmpresaService } from '../ia/ia-empresa.service';
import { ModuloService } from '../modulo/modulo.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { MisterConsoleService } from './mister-console.service';
import { MisterEntradaService } from './mister-entrada.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { MisterVinculoService } from './mister-vinculo.service';
import * as regras from './mister.regras';
import { TEXTOS, idDoBotaoDaEmpresa } from './mister.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O MISTER (mig 417), contra o Postgres real, com a Meta de mentira (nenhum teste fala com a Meta).
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
      .filter((p) => p.url.endsWith('/messages'))
      .map((p) => ({
        para: p.corpo.to,
        texto: p.corpo.type === 'text' ? p.corpo.text.body : p.corpo.interactive.body.text,
        botoes: p.corpo.type === 'interactive' ? p.corpo.interactive.action.buttons.map((b: any) => ({ id: b.reply.id, titulo: b.reply.title })) : [],
      }));
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
    const entrada = new MisterEntradaService(db, numero, modulos, auditoria);
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
      await q(`delete from mister_vinculo where tenant_id = any($1::uuid[])`, [[A, B]]);
      await q(`delete from mister_mensagem where wamid like $1`, [`wamid.${MARCA}.%`]);
      await q(`delete from mister_conversa where telefone = any($1::text[])`, [telefones]);
      telefones.length = 0;
    };

    beforeAll(async () => {
      // A 415 e a 417 são só da nuvem: o banco do CI é o de uma loja (ERR-273). Duas vezes: as migrations são idempotentes.
      for (let i = 0; i < 2; i++)
        for (const arq of ['415_ia_por_empresa.sql', '417_mister_numero_e_entrada.sql'])
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
      for (const t of ['ia_uso_dia', 'ia_credencial', 'modulo_ativacao', 'cardapio_config', 'colaborador', 'funcao'])
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
      expect(await reconhecido()).toBe('ainda_nao_respondo');
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
      expect(await reconhecido()).toBe('ainda_nao_respondo');
      // Desligou por dentro do Regem: o telefone deixa de representar a pessoa.
      const meu = await vinculo.desligar(usuario('carlos', A, 'gerente'));
      expect(meu).toMatchObject({ ligado: false, final: null });
      expect(await reconhecido()).toBe('fixa');
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
      // Qualquer outra coisa: o Mister diz que ainda não responde a perguntas — uma vez, não a cada mensagem.
      numero.pedidos.length = 0;
      expect(await mandar(tel, 'quanto vendi hoje?')).toBe('ainda_nao_respondo');
      expect(await mandar(tel, 'e ontem?')).toBe('calado');
      expect(numero.enviadas).toEqual([{ para: tel, texto: TEXTOS.aindaNaoRespondo('Ana', NOME_A), botoes: [] }]);
      await q(`update mister_conversa set provisoria_em = now() - interval '31 minutes' where telefone = $1`, [tel]);
      expect(await mandar(tel, 'oi')).toBe('ainda_nao_respondo');
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
      expect(await mandar(tel, '2')).toBe('ainda_nao_respondo');
      expect(await mandar(tel, NOME_B)).toBe('calado');
      expect((await q(`select tenant_id from mister_conversa where telefone = $1`, [tel]))[0].tenant_id).toBe(A);
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
  });
}
