import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { GestorWhatsappService } from './gestor-whatsapp.service';
import { portaoDoGestor } from './gestor-whatsapp-entrada';
import { DisputaIfoodService } from './disputa-ifood.service';
import { Pedido99Service } from './pedido-99.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// GERENTE NO WHATSAPP (mig 375), contra o Postgres real, com o WhatsApp, o iFood e a 99 de mentira.
// Parte 5a: ligar o PRÓPRIO número pelo código (uma vez, um número por pessoa, o de quem saiu fica livre); PARAR/VOLTAR
// AVISOS; a rotina manda a decisão e o "ninguém pegou" a quem pode receber AGORA (V75: pausado, bloqueado, rebaixado, loja
// apagada ficam de fora; gerente só a loja dele), uma vez só; API oficial: texto na janela, modelo fora dela e o "Ver por
// aqui"; a falha passageira tenta de novo até 3 vezes; o limite da volta só pega quem vale (V84); desligar; o grupo da
// tela (só o final do número; V82).
// Parte 5b: a decisão pela enquete e pelos botões, passo a passo, pelo MESMO serviço da tela (disputa e 99 de verdade),
// com quem decidiu e "pelo WhatsApp"; o botão vindo de outro número não vale; o limite (e o limite que muda depois do
// envio); o acesso que muda depois do envio; a falha da plataforma devolve a vez; "Voltar"; o mesmo toque duas vezes.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('gestor-whatsapp-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const TEL = { ana: '5521911110001', bruno: '5521922220002', rodrigo: '5521933330003', outro: '5521944440004' };

descrever('gerente no WhatsApp (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let T: string;
  let T2: string;
  let lojaA: string;
  let lojaB: string;
  const pessoa: Record<string, string> = {};
  const funcao: Record<string, string> = {};
  const enviados: any[] = [];
  const respostas: string[] = [];
  const auditados: any[] = [];
  let falharEnvio = false;
  const evolution: any = {
    enviar: async (tenantId: string, para: string, texto: string) => {
      if (falharEnvio) throw new Error('Falha ao enviar (sem resposta)');
      enviados.push({ via: 'evolution', tipo: 'texto', tenantId, para, texto });
      return { ok: true };
    },
    enviarEnquete: async (tenantId: string, para: string, pergunta: string, opcoes: string[]) => {
      if (falharEnvio) throw new Error('Falha ao enviar a enquete (sem resposta)');
      enviados.push({ via: 'evolution', tipo: 'enquete', tenantId, para, pergunta, opcoes });
      return { ok: true };
    },
  };
  const cloud: any = {
    enviarInterno: async (tenantId: string, para: string, conteudo: any) => {
      if (falharEnvio) throw new Error('Falha ao enviar pela Cloud API (500)');
      enviados.push({ via: 'cloud', tipo: 'texto' in conteudo ? 'texto' : 'modelo', tenantId, para, ...conteudo });
      return { ok: true, id: 'wamid' };
    },
    enviarOpcoes: async (tenantId: string, para: string, corpo: string, opcoes: any[], botao: string, interno: boolean) => {
      if (falharEnvio) throw new Error('Falha ao enviar pela Cloud API (500)');
      enviados.push({ via: 'cloud', tipo: 'opcoes', tenantId, para, corpo, opcoes, botao, interno });
      return { ok: true, id: 'wamid' };
    },
    garantirModeloRelacionamento: async () => 'pendente',
  };
  // As plataformas de mentira: o que o Regem mandou ao iFood e à 99 (a resposta de cada vez).
  const aoIfood: any[] = [];
  const aoNoventaENove: any[] = [];
  let respostaDaPlataforma: any = { ok: true };
  const ig = { id: 'ig-gw', tenantId: '' } as any;
  const ifood: any = {
    integracaoDoTenant: async () => ig,
    responderDisputa: async (...a: any[]) => {
      aoIfood.push(a);
      return respostaDaPlataforma;
    },
  };
  const food99: any = {
    integracaoDoTenant: async () => ig,
    responderCancelamento: async (...a: any[]) => {
      aoNoventaENove.push(['cancelamento', ...a]);
      return respostaDaPlataforma;
    },
    responderReembolso: async (...a: any[]) => {
      aoNoventaENove.push(['reembolso', ...a]);
      return respostaDaPlataforma;
    },
  };
  const cancelamentos: any[] = [];
  const atendimento: any = { decidirCancelamento: async (...a: any[]) => void cancelamentos.push(a) };
  const eventos = { emit: () => true } as any;
  let svc: GestorWhatsappService;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const user = (nome: string, categoria = 'gerente') => ({ tenantId: T, colaboradorId: pessoa[nome], categoria }) as any;
  const auditar = async (e: any) => void auditados.push(e);
  // A entrada entrega ao serviço (o evento) — aqui o teste espera o serviço terminar.
  let pendente: Promise<void> | null = null;
  const emitir = (_ev: string, p: any) => {
    pendente = svc.responder(p);
  };
  const entrada = async (telefone: string, texto: string, idMensagem: string = randomUUID(), opcaoId: string | null = null) => {
    const r = await portaoDoGestor(db, { tenantId: T, telefone, texto, opcaoId, idMensagem }, async (t) => void respostas.push(t), auditar, emitir);
    if (pendente) {
      const p = pendente;
      pendente = null;
      await p;
    }
    return r;
  };
  /** O que saiu para um número depois de `desde` (índice em `enviados`). */
  const paraOnde = (tel: string, desde = 0) => enviados.slice(desde).filter((e) => e.para === tel);
  const textoDe = (e: any) => e?.texto ?? e?.corpo ?? '';
  const ligarComo = async (nome: string, telefone: string) => {
    const { codigo } = await svc.ligar(user(nome, nome === 'rodrigo' ? 'presidente' : 'gerente'));
    return entrada(telefone, `REGEM ${codigo}`);
  };
  const gestor = async (nome: string) => (await q(`select * from gestor_whatsapp where colaborador_id = $1`, [pessoa[nome]]))[0];
  const novoCaso = async (o: Record<string, unknown> = {}) => {
    const c: any = {
      unidade_id: lojaA,
      tipo: 'disputa',
      canal: 'ifood',
      cliente: 'Ana P.',
      pedido_numero: '4521',
      mensagem: 'Faltou a batata.',
      prazo: '10 minutes',
      criado: '0 minutes',
      detalhe: { disputa: { acaoAutomatica: 'ACCEPT_CANCELLATION' } },
      responsavel_id: null,
      pedido_id: null,
      externo_id: null,
      ...o,
    };
    const [{ id }] = await q(
      `insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, pedido_numero, mensagem, prazo_em, detalhe,
                                        criado_em, responsavel_id, pedido_id, externo_id)
       values ($1, $2, $3, $4, $5, $6, $7, case when $8::text is null then null else now() + $8::interval end, $9::jsonb,
               now() - $10::interval, $11, $12, $13) returning id`,
      [T, c.unidade_id, c.tipo, c.canal, c.cliente, c.pedido_numero, c.mensagem, c.prazo, JSON.stringify(c.detalhe), c.criado, c.responsavel_id, c.pedido_id, c.externo_id],
    );
    return id as string;
  };
  /** Um pedido com o total (o valor do aceite de um cancelamento). */
  const pedido = async (total: number, canal = 'ifood') =>
    (
      await q(
        `insert into pedido_externo (tenant_id, canal, external_id, display_id, tipo, itens, total, status, cliente_nome)
         values ($1, $2, $3, '4521', 'entrega', '[]', $4, 'producao', 'Ana P.') returning id`,
        [T, canal, `ext-${randomUUID()}`, total],
      )
    )[0].id as string;
  /** A disputa do iFood que pede para cancelar o pedido inteiro, com os motivos de aceite que o iFood mandou. */
  const disputaDeCancelamento = async (total: number, motivosParaAceitar: string[] = ['CUSTOMER_REQUEST']) =>
    novoCaso({
      pedido_id: await pedido(total),
      externo_id: `disp-${randomUUID()}`,
      detalhe: { plataforma: 'ifood', disputa: { id: 'disp-1', acao: 'CANCELLATION', tipo: 'PREPARATION_TIME', acaoAutomatica: 'ACCEPT_CANCELLATION', motivosParaAceitar, alternativas: [], itens: [] } },
    });
  /** A última enquete que saiu para um número (a pergunta e as opções). */
  const ultimaEnquete = (tel: string) => [...enviados].reverse().find((e) => e.para === tel && e.tipo === 'enquete');
  const ultimosBotoes = (tel: string) => [...enviados].reverse().find((e) => e.para === tel && e.tipo === 'opcoes');
  const ultimoTexto = (tel: string) => textoDe([...enviados].reverse().find((e) => e.para === tel && e.tipo === 'texto'));
  /** O voto numa opção da última enquete do número (pelo começo do nome da opção). */
  const votar = async (tel: string, comeco: string) => {
    const opcao = (ultimaEnquete(tel)?.opcoes ?? []).find((o: string) => o.startsWith(comeco));
    if (!opcao) throw new Error(`a enquete não tem "${comeco}": ${JSON.stringify(ultimaEnquete(tel)?.opcoes)}`);
    return entrada(tel, opcao);
  };
  /** O toque num botão dos últimos botões do número (pelo começo do título). */
  const tocar = async (tel: string, comeco: string, de = tel) => {
    const b = (ultimosBotoes(tel)?.opcoes ?? []).find((o: any) => o.titulo.startsWith(comeco));
    if (!b) throw new Error(`os botões não têm "${comeco}": ${JSON.stringify(ultimosBotoes(tel)?.opcoes)}`);
    return entrada(de, b.titulo, randomUUID(), b.id);
  };
  const quemRecebeu = (chamado: string) =>
    q(`select c.nome, a.situacao, a.tipo from aviso_gestor_whatsapp a join colaborador c on c.id = a.colaborador_id
        where a.chamado_id = $1 order by c.nome`, [chamado]);
  const limpar = () => {
    enviados.length = 0;
    respostas.length = 0;
    auditados.length = 0;
    aoIfood.length = 0;
    aoNoventaENove.length = 0;
    cancelamentos.length = 0;
    respostaDaPlataforma = { ok: true };
    falharEnvio = false;
  };

  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
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

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    // As tabelas só da nuvem (o banco do CI é o de uma loja — ERR-273): a caixa de conversas, o robo_config, a 353 (o
    // `avisar_gerente_min` que o teste do V82 confere — sem ela, a suíte só passava depois da suíte da fila) e a 375.
    for (const m of ['215_whatsapp_mensagem.sql', '342_robo_pausa_e_config.sql', '353_app_atendimento.sql', '375_gestor_whatsapp.sql', '379_horario_da_equipe.sql'])
      await aplicar(m);
    const aud = { registrar: auditar } as any;
    svc = new GestorWhatsappService(
      db,
      cloud,
      evolution,
      aud,
      new DisputaIfoodService(db, ifood, eventos, aud),
      new Pedido99Service(db, food99, eventos, aud),
      atendimento,
    );
    [{ id: T }] = await q(`insert into empresa (nome) values ('teste gerente no whatsapp') returning id`);
    [{ id: T2 }] = await q(`insert into empresa (nome) values ('teste gerente no whatsapp sem ajuste') returning id`);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    for (const cat of ['gerente', 'presidente', 'supervisao', 'execucao'])
      [{ id: funcao[cat] }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [T, `F ${cat}`, cat]);
    const criar = async (nome: string, cat: string, loja: string | null) =>
      ([{ id: pessoa[nome] }] = await q(
        `insert into colaborador (tenant_id, nome, funcao_id, unidade_id) values ($1, $2, $3, $4) returning id`,
        [T, nome === 'ana' ? 'Ana Souza' : nome === 'bruno' ? 'Bruno Lima' : nome === 'rodrigo' ? 'Rodrigo Dono' : 'Sara Sup', funcao[cat], loja],
      ));
    await criar('ana', 'gerente', lojaA);
    await criar('bruno', 'gerente', lojaB);
    await criar('rodrigo', 'presidente', null);
    await criar('sara', 'supervisao', lojaA);
    await q(
      `insert into cardapio_config (tenant_id, token, ativo, nome_publico, provedor, evolution_instancia, evolution_numero)
       values ($1, $2, true, 'Loja Centro', 'evolution', 'inst-teste', '5521999990000')`,
      [T, `tok-${randomUUID()}`],
    );
    await q(`insert into robo_config (tenant_id, gestor_wa_ligado) values ($1, true)`, [T]);
  });
  afterAll(async () => {
    if (!pool) return;
    for (const t of [T, T2]) {
      for (const tab of ['aviso_gestor_whatsapp', 'gestor_whatsapp', 'atendimento_chamado', 'robo_config', 'cardapio_config', 'colaborador', 'funcao', 'unidade'])
        await q(`delete from ${tab} where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });
  // Cada teste começa sem caso aberto dos anteriores (a disputa com prazo passa na frente na rotina) e com a loja na
  // conexão por QR.
  beforeEach(async () => {
    limpar();
    if (!T) return;
    await q(`update atendimento_chamado set status = 'resolvido' where tenant_id = $1 and status = 'aberto'`, [T]);
    await q(`update cardapio_config set provedor = 'evolution' where tenant_id = $1`, [T]);
    await q(`update robo_config set gestor_wa_limite_centavos = 10000, gestor_wa_decisoes = true where tenant_id = $1`, [T]);
  });

  it('ligar: só gerente e presidente; o código liga o número que mandou, uma vez; a mesma mensagem não responde duas vezes', async () => {
    await expect(svc.ligar(user('sara', 'supervisao'))).rejects.toThrow('Só gerente e presidente');
    const r = await svc.ligar(user('ana'));
    expect(r.codigo).toMatch(/^\d{6}$/);
    expect(r.link).toBe(`https://wa.me/5521999990000?text=REGEM%20${r.codigo}`);
    const id = randomUUID();
    expect(await entrada(TEL.ana, `REGEM ${r.codigo}`, id)).toBe(true);
    expect(respostas).toHaveLength(1);
    expect(respostas[0]).toContain('Pronto, Ana! Este WhatsApp está ligado a você no Regem da Loja Centro.');
    expect(await gestor('ana')).toMatchObject({ telefone: TEL.ana, codigo: null, pausado_em: null });
    expect(auditados.map((a) => a.acao)).toEqual(['gestor_whatsapp_codigo', 'gestor_whatsapp_ligado']);
    expect(auditados[1]).toMatchObject({ atorId: pessoa.ana, origem: 'whatsapp', detalhe: { final: '0001' } });
    // A Meta reenvia a mesma mensagem; e o mesmo texto de novo (o código já foi gasto, número ligado há pouco): calado.
    expect(await entrada(TEL.ana, `REGEM ${r.codigo}`, id)).toBe(true);
    expect(await entrada(TEL.ana, `REGEM ${r.codigo}`)).toBe(true);
    expect(respostas).toHaveLength(1);
  });

  it('um número liga uma pessoa só; o número de quem saiu fica livre; código vencido ou de quem não é mais gestor não liga', async () => {
    // O Bruno manda o código dele do celular da Ana: recusado, com o caminho para desligar.
    const { codigo } = await svc.ligar(user('bruno'));
    expect(await entrada(TEL.ana, `REGEM ${codigo}`)).toBe(true);
    expect(respostas[0]).toContain('já está ligado a outra pessoa');
    expect(respostas[0]).toContain('Delivery › Configurações › Atendimento');
    expect((await gestor('bruno')).telefone).toBeNull();
    expect(await ligarComo('bruno', TEL.bruno)).toBe(true);
    expect((await gestor('bruno')).telefone).toBe(TEL.bruno);
    // O Rodrigo (presidente) liga; o código vencido não vale.
    const vencido = await svc.ligar(user('rodrigo', 'presidente'));
    await q(`update gestor_whatsapp set codigo_expira_em = now() - interval '1 minute' where colaborador_id = $1`, [pessoa.rodrigo]);
    respostas.length = 0;
    expect(await entrada(TEL.rodrigo, `REGEM ${vencido.codigo}`)).toBe(true);
    expect(respostas[0]).toContain('Este código não vale mais');
    // Rebaixado depois de pedir o código: não liga.
    const rebaixado = await svc.ligar(user('rodrigo', 'presidente'));
    await q(`update colaborador set funcao_id = $1 where id = $2`, [funcao.execucao, pessoa.rodrigo]);
    expect(await entrada(TEL.rodrigo, `REGEM ${rebaixado.codigo}`)).toBe(true);
    expect((await gestor('rodrigo')).telefone).toBeNull();
    await q(`update colaborador set funcao_id = $1 where id = $2`, [funcao.presidente, pessoa.rodrigo]);
    expect(await ligarComo('rodrigo', TEL.rodrigo)).toBe(true);
    // A Sara (supervisão) não liga; quem saiu (Bruno bloqueado) solta o número para outra pessoa.
    await q(`update colaborador set status = 'bloqueado' where id = $1`, [pessoa.bruno]);
    const deOutro = await svc.ligar(user('ana'));
    expect(await entrada(TEL.bruno, `REGEM ${deOutro.codigo}`)).toBe(true);
    expect((await gestor('ana')).telefone).toBe(TEL.bruno);
    expect((await gestor('bruno')).telefone).toBeNull();
    // Volta ao arranjo dos próximos testes: Ana no número dela, Bruno ativo e ligado.
    await q(`update colaborador set status = 'ativo' where id = $1`, [pessoa.bruno]);
    expect(await ligarComo('ana', TEL.ana)).toBe(true);
    expect(await ligarComo('bruno', TEL.bruno)).toBe(true);
    expect((await gestor('ana')).telefone).toBe(TEL.ana);
  });

  it('PARAR AVISOS e VOLTAR AVISOS; "PARAR", mensagem comum e número que não é de gestor seguem o caminho de sempre', async () => {
    expect(await entrada(TEL.ana, 'PARAR AVISOS')).toBe(true);
    expect(respostas[0]).toContain('este WhatsApp não recebe mais os avisos');
    expect((await gestor('ana')).pausado_em).not.toBeNull();
    expect(await entrada(TEL.ana, 'voltar avisos')).toBe(true);
    expect(respostas[1]).toContain('Voltou, Ana');
    expect((await gestor('ana')).pausado_em).toBeNull();
    expect(auditados.map((a) => a.acao)).toEqual(['gestor_whatsapp_parou', 'gestor_whatsapp_voltou']);
    expect(await entrada(TEL.ana, 'PARAR')).toBe(false);
    expect(await entrada(TEL.ana, 'Quero um x-burger')).toBe(false);
    expect(await entrada(TEL.outro, 'PARAR AVISOS')).toBe(false);
    expect(respostas).toHaveLength(2);
  });

  it('a rotina: a disputa da loja A vai à gerente A e ao presidente — não ao gerente da loja B —, com o texto e o link; uma vez só', async () => {
    const c = await novoCaso();
    expect(await svc.enviarPendentes([T])).toBe(2);
    expect((await quemRecebeu(c)).map((x) => [x.nome, x.situacao, x.tipo])).toEqual([
      ['Ana Souza', 'enviado', 'decisao'],
      ['Rodrigo Dono', 'enviado', 'decisao'],
    ]);
    // Pela conexão por QR: o texto do caso e, depois, a enquete da decisão.
    expect(paraOnde(TEL.ana).map((e) => e.tipo)).toEqual(['texto', 'enquete']);
    expect(paraOnde(TEL.rodrigo).map((e) => e.tipo)).toEqual(['texto', 'enquete']);
    expect(paraOnde(TEL.bruno)).toEqual([]);
    const t = paraOnde(TEL.ana)[0].texto;
    expect(t).toContain('⚖️ *Disputa do iFood · pedido 4521*');
    expect(t).toContain(`Responda aqui ou no Regem: `);
    expect(t).toContain(`/atendimento?caso=${c}`);
    expect(await svc.enviarPendentes([T])).toBe(0);
    expect(enviados).toHaveLength(4);
  });

  it('quem não pode receber AGORA fica de fora (V75): pausado, bloqueado, rebaixado; e a loja apagada não manda nada', async () => {
    await q(`update gestor_whatsapp set pausado_em = now() where colaborador_id = $1`, [pessoa.ana]);
    const c1 = await novoCaso();
    await svc.enviarPendentes([T]);
    expect((await quemRecebeu(c1)).map((x) => x.nome)).toEqual(['Rodrigo Dono']);
    await q(`update gestor_whatsapp set pausado_em = null where colaborador_id = $1`, [pessoa.ana]);

    await q(`update colaborador set status = 'bloqueado' where id = $1`, [pessoa.ana]);
    const c2 = await novoCaso();
    await svc.enviarPendentes([T]);
    expect((await quemRecebeu(c2)).map((x) => x.nome)).toEqual(['Rodrigo Dono']);
    await q(`update colaborador set status = 'ativo' where id = $1`, [pessoa.ana]);

    await q(`update colaborador set funcao_id = $1 where id = $2`, [funcao.supervisao, pessoa.ana]);
    const c3 = await novoCaso();
    await svc.enviarPendentes([T]);
    expect((await quemRecebeu(c3)).map((x) => x.nome)).toEqual(['Rodrigo Dono']);
    await q(`update colaborador set funcao_id = $1 where id = $2`, [funcao.gerente, pessoa.ana]);

    await q(`update unidade set deleted_at = now() where id = $1`, [lojaB]);
    const c4 = await novoCaso({ unidade_id: lojaB });
    await svc.enviarPendentes([T]);
    expect(await quemRecebeu(c4)).toEqual([]);
    await q(`update unidade set deleted_at = null where id = $1`, [lojaB]);
    // A loja B viva: vai ao gerente dela (Bruno) e ao presidente, não à Ana.
    const c5 = await novoCaso({ unidade_id: lojaB });
    await svc.enviarPendentes([T]);
    expect((await quemRecebeu(c5)).map((x) => x.nome)).toEqual(['Bruno Lima', 'Rodrigo Dono']);
  });

  it('o "ninguém pegou" vai com a marca e sem ninguém; decisão velha, prazo vencido ou o ajuste desligado não vão', async () => {
    const escalado = { escalado: { em: new Date().toISOString(), minutos: 3 } };
    const c1 = await novoCaso({ tipo: 'humano', canal: 'whatsapp', prazo: null, detalhe: escalado, cliente: 'Carlos M.', pedido_numero: '1180' });
    const c2 = await novoCaso({ tipo: 'humano', canal: 'whatsapp', prazo: null, detalhe: escalado, responsavel_id: pessoa.sara });
    const c3 = await novoCaso({ tipo: 'humano', canal: 'whatsapp', prazo: null, detalhe: {} });
    const c4 = await novoCaso({ criado: '3 hours' });
    const c5 = await novoCaso({ prazo: '-1 minute' });
    await svc.enviarPendentes([T]);
    expect((await quemRecebeu(c1)).map((x) => [x.nome, x.tipo])).toEqual([
      ['Ana Souza', 'ninguem_pegou'],
      ['Rodrigo Dono', 'ninguem_pegou'],
    ]);
    expect(enviados.find((e) => e.para === TEL.ana)?.texto).toContain('🔔 *Ninguém pegou um caso*');
    for (const c of [c2, c3, c4, c5]) expect(await quemRecebeu(c)).toEqual([]);
    // "Decisões com prazo" desligado: a decisão nova não vai.
    await q(`update robo_config set gestor_wa_decisoes = false where tenant_id = $1`, [T]);
    const c6 = await novoCaso();
    await svc.enviarPendentes([T]);
    expect(await quemRecebeu(c6)).toEqual([]);
    await q(`update robo_config set gestor_wa_decisoes = true where tenant_id = $1`, [T]);
  });

  it('o RECADO PARA O RESPONSÁVEL (mig 381: fornecedor, vaga, parceria) não avisa ninguém — nem com a marca de escalado', async () => {
    const recado = { responsavel: { assunto: 'vaga', em: new Date().toISOString() } };
    const escalado = { escalado: { em: new Date().toISOString(), minutos: 3 } };
    const r1 = await novoCaso({ tipo: 'vaga', canal: 'whatsapp', prazo: null, detalhe: { ...recado, ...escalado } });
    const r2 = await novoCaso({ tipo: 'instagram', canal: 'instagram', prazo: null, detalhe: { ...recado, ...escalado } });
    const comum = await novoCaso({ tipo: 'humano', canal: 'whatsapp', prazo: null, detalhe: escalado });
    await svc.enviarPendentes([T]);
    expect(await quemRecebeu(r1)).toEqual([]);
    expect(await quemRecebeu(r2)).toEqual([]);
    expect((await quemRecebeu(comum)).length).toBe(2); // o caso comum segue avisando
  });

  it('o limite da volta só pega quem vale (V84): 12 escalados velhos na frente não seguram o novo', async () => {
    const velho = { escalado: { em: new Date(Date.now() - 2 * 3600_000).toISOString(), minutos: 3 } };
    for (let i = 0; i < 12; i++) await novoCaso({ tipo: 'humano', canal: 'whatsapp', prazo: null, detalhe: velho, criado: '3 hours' });
    const novo = await novoCaso({ tipo: 'humano', canal: 'whatsapp', prazo: null, detalhe: { escalado: { em: new Date().toISOString(), minutos: 3 } } });
    expect(await svc.enviarPendentes([T], 2)).toBe(2);
    expect((await quemRecebeu(novo)).length).toBe(2);
  });

  it('API oficial: texto dentro da janela de 24 h, o modelo fora dela; "Ver por aqui" manda o texto do que ainda vale', async () => {
    await q(`update cardapio_config set provedor = 'cloud', wa_cloud_phone_id = 'pid-teste', wa_cloud_numero = '5521999990000' where tenant_id = $1`, [T]);
    await q(`update gestor_whatsapp set ultima_entrada_em = now() - interval '2 days' where colaborador_id = $1`, [pessoa.ana]);
    await q(`update gestor_whatsapp set ultima_entrada_em = now() - interval '1 hour' where colaborador_id = $1`, [pessoa.rodrigo]);
    const c = await novoCaso();
    await svc.enviarPendentes([T]);
    const paraAna = paraOnde(TEL.ana)[0];
    expect(paraAna).toEqual({
      via: 'cloud',
      tipo: 'modelo',
      tenantId: T,
      para: TEL.ana,
      modelo: 'aviso_ao_gestor',
      variaveis: ['disputa do iFood no pedido 4521, responder até ' + paraAna.variaveis[0].slice(-5)],
    });
    // Dentro da janela: a decisão com os botões (mensagem interna, fora da caixa de conversas).
    const paraRodrigo = paraOnde(TEL.rodrigo)[0];
    expect(paraRodrigo).toMatchObject({ via: 'cloud', tipo: 'opcoes', interno: true });
    expect(paraRodrigo.corpo).toContain('Disputa do iFood');
    expect((await quemRecebeu(c)).map((x) => [x.nome, x.situacao])).toEqual([
      ['Ana Souza', 'modelo'],
      ['Rodrigo Dono', 'enviado'],
    ]);
    // A Ana toca em "Ver por aqui": chega o caso com os botões, o aviso fica "enviado" e a janela abre.
    const antes = enviados.length;
    expect(await entrada(TEL.ana, 'Ver por aqui')).toBe(true);
    const verAna = paraOnde(TEL.ana, antes);
    expect(verAna.map((e) => e.tipo)).toEqual(['opcoes']);
    expect(verAna[0].corpo).toContain(`/atendimento?caso=${c}`);
    expect(respostas).toEqual([]);
    expect((await quemRecebeu(c)).find((x) => x.nome === 'Ana Souza')?.situacao).toBe('enviado');
    expect(new Date((await gestor('ana')).ultima_entrada_em).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // Outro modelo; o caso é resolvido antes do toque: "nada esperando", e o aviso expira.
    await q(`update gestor_whatsapp set ultima_entrada_em = now() - interval '2 days' where colaborador_id = $1`, [pessoa.ana]);
    const c2 = await novoCaso();
    await svc.enviarPendentes([T]);
    await q(`update atendimento_chamado set status = 'resolvido' where id = $1`, [c2]);
    const antes2 = enviados.length;
    expect(await entrada(TEL.ana, 'ver por aqui')).toBe(true);
    expect(textoDe(paraOnde(TEL.ana, antes2)[0])).toContain('Nada esperando por você agora');
    expect((await quemRecebeu(c2)).find((x) => x.nome === 'Ana Souza')?.situacao).toBe('expirado');
    await q(`update cardapio_config set provedor = 'evolution' where tenant_id = $1`, [T]);
  });

  it('falha passageira: "falhou" com o motivo e tenta de novo, até 3 vezes no total, enquanto o caso vale', async () => {
    falharEnvio = true;
    const c = await novoCaso();
    expect(await svc.enviarPendentes([T])).toBe(0);
    const vez = async () => {
      await q(`update aviso_gestor_whatsapp set atualizado_em = now() - interval '2 minutes' where chamado_id = $1`, [c]);
      await svc.enviarPendentes([T]);
      return q(`select situacao, tentativas, erro from aviso_gestor_whatsapp where chamado_id = $1 order by colaborador_id`, [c]);
    };
    expect((await q(`select situacao, tentativas, erro from aviso_gestor_whatsapp where chamado_id = $1`, [c]))[0]).toMatchObject({
      situacao: 'falhou',
      tentativas: 1,
      erro: 'Falha ao enviar (sem resposta)',
    });
    expect((await vez())[0]).toMatchObject({ situacao: 'falhou', tentativas: 2 });
    falharEnvio = false;
    expect((await vez()).map((x) => [x.situacao, x.tentativas])).toEqual([
      ['enviado', 3],
      ['enviado', 3],
    ]);
    // Um que falhou 3 vezes não tenta a quarta.
    falharEnvio = true;
    const c2 = await novoCaso();
    await svc.enviarPendentes([T]);
    for (let i = 0; i < 3; i++) {
      await q(`update aviso_gestor_whatsapp set atualizado_em = now() - interval '2 minutes' where chamado_id = $1`, [c2]);
      await svc.enviarPendentes([T]);
    }
    expect((await q(`select max(tentativas)::int as n from aviso_gestor_whatsapp where chamado_id = $1`, [c2]))[0].n).toBe(3);
  });

  it('desligar: para na hora, e o modelo que esperava o toque não vale mais', async () => {
    await q(`update cardapio_config set provedor = 'cloud' where tenant_id = $1`, [T]);
    await q(`update gestor_whatsapp set ultima_entrada_em = now() - interval '2 days' where colaborador_id = $1`, [pessoa.ana]);
    const c = await novoCaso();
    await svc.enviarPendentes([T]);
    expect((await quemRecebeu(c)).find((x) => x.nome === 'Ana Souza')?.situacao).toBe('modelo');
    await svc.desligar(user('rodrigo', 'presidente'), pessoa.ana);
    expect(await gestor('ana')).toMatchObject({ telefone: null, ligado_em: null });
    expect((await quemRecebeu(c)).find((x) => x.nome === 'Ana Souza')?.situacao).toBe('expirado');
    expect(auditados.find((a) => a.acao === 'gestor_whatsapp_desligado')).toMatchObject({ atorId: pessoa.rodrigo, entidadeId: pessoa.ana, detalhe: { proprio: false } });
    await expect(svc.desligar(user('rodrigo', 'presidente'), pessoa.ana)).rejects.toThrow('já não estava ligado');
    const c2 = await novoCaso();
    await svc.enviarPendentes([T]);
    expect((await quemRecebeu(c2)).map((x) => x.nome)).toEqual(['Rodrigo Dono']);
    await q(`update cardapio_config set provedor = 'evolution' where tenant_id = $1`, [T]);
    expect(await ligarComo('ana', TEL.ana)).toBe(true);
  });

  it('o grupo da tela: nasce desligado; de cada pessoa só o final do número; salvar grava só as colunas dele (V82) e anota', async () => {
    expect(await svc.ajuste(T2)).toEqual({ ligado: false, decisoes: true, ninguemPegou: true, limiteCentavos: 10000 });
    await q(`update robo_config set avisar_gerente_min = 5 where tenant_id = $1`, [T]);
    const g = await svc.grupo(user('ana'));
    expect(g).toMatchObject({ ligado: true, decisoes: true, ninguemPegou: true, via: 'evolution', numeroDaLoja: true, modelo: null });
    expect(g.pessoas.map((p) => [p.nome, p.voce, p.ligado, p.final])).toEqual([
      ['Ana Souza', true, true, '0001'],
      ['Rodrigo Dono', false, true, '0003'],
      ['Bruno Lima', false, true, '0002'],
    ]);
    const json = JSON.stringify(g);
    for (const t of Object.values(TEL)) expect(json).not.toContain(t);
    await svc.salvar(user('ana'), { ninguemPegou: false });
    expect((await q(`select gestor_wa_ligado, gestor_wa_decisoes, gestor_wa_ninguem_pegou, avisar_gerente_min from robo_config where tenant_id = $1`, [T]))[0]).toEqual({
      gestor_wa_ligado: true,
      gestor_wa_decisoes: true,
      gestor_wa_ninguem_pegou: false,
      avisar_gerente_min: 5,
    });
    expect(auditados).toEqual([expect.objectContaining({ acao: 'gestor_whatsapp_ajuste', detalhe: { ajuste: 'ninguemPegou', de: true, para: false } })]);
    await svc.salvar(user('ana'), { ninguemPegou: false });
    expect(auditados).toHaveLength(1);
  });

  // ------------------------------------------------------------------ parte 5b: a decisão pelo WhatsApp

  it('5b · enquete (QR): Aceitar → motivo do iFood → Confirmar → a disputa vai ao iFood pelo serviço da tela, com quem decidiu e "pelo WhatsApp"; o outro gestor fica sabendo', async () => {
    const c = await disputaDeCancelamento(39.9);
    await svc.enviarPendentes([T]);
    const e1 = ultimaEnquete(TEL.ana);
    expect(e1.pergunta).toBe('O que responder?');
    expect(e1.opcoes).toEqual([expect.stringMatching(/^Aceitar · R\$ 39,90 · caso \d{4}$/), expect.stringMatching(/^Recusar · caso \d{4}$/)]);
    await votar(TEL.ana, 'Aceitar');
    const e2 = ultimaEnquete(TEL.ana);
    expect(e2.pergunta).toBe('Qual o motivo? A lista é do iFood.');
    expect(e2.opcoes).toEqual([expect.stringMatching(/^Solicitação do cliente · caso \d{4}$/)]);
    await votar(TEL.ana, 'Solicitação do cliente');
    expect(ultimaEnquete(TEL.ana).pergunta).toBe(
      'Confirma? Aceitar a disputa do pedido 4521, devolvendo R$ 39,90 (motivo: Solicitação do cliente). A resposta vai ao iFood, que aceita uma só.',
    );
    expect(aoIfood).toEqual([]); // nada sai antes de confirmar
    await votar(TEL.ana, 'Confirmar');
    expect(aoIfood).toHaveLength(1);
    expect(aoIfood[0].slice(2)).toEqual(['accept', { reason: 'CUSTOMER_REQUEST' }]);
    const ch = (await q(`select status, decisao, resolvido_por_id, detalhe from atendimento_chamado where id = $1`, [c]))[0];
    expect(ch).toMatchObject({ status: 'resolvido', decisao: 'aceito', resolvido_por_id: pessoa.ana });
    expect(ch.detalhe.resposta).toMatchObject({ acao: 'aceitar', motivo: 'CUSTOMER_REQUEST', por: 'Ana Souza', via: 'whatsapp' });
    expect(ultimoTexto(TEL.ana)).toMatch(
      /^✅ Feito: disputa do pedido 4521 aceita \(R\$ 39,90 de volta ao cliente\)\. No histórico do caso: Ana Souza, pelo WhatsApp, \d\d:\d\d\.$/,
    );
    expect(auditados.filter((a) => a.origem === 'whatsapp').map((a) => a.acao)).toEqual(expect.arrayContaining(['respondeu_disputa_ifood', 'decidiu_pelo_whatsapp']));
    expect(auditados.find((a) => a.acao === 'respondeu_disputa_ifood')).toMatchObject({ atorId: pessoa.ana, atorPerfil: 'gerente' });
    expect((await quemRecebeu(c)).map((x) => [x.nome, x.situacao])).toEqual([
      ['Ana Souza', 'respondido'],
      ['Rodrigo Dono', 'expirado'],
    ]);
    // O Rodrigo vota na enquete dele: fica sabendo quem respondeu; nada vai de novo ao iFood.
    await votar(TEL.rodrigo, 'Aceitar');
    expect(ultimoTexto(TEL.rodrigo)).toMatch(/^Ana Souza já respondeu às \d\d:\d\d, pelo WhatsApp: aceitou\. Nada foi enviado de novo\.$/);
    // A Ana vota de novo no Confirmar: uma resposta só.
    await votar(TEL.ana, 'Confirmar');
    expect(aoIfood).toHaveLength(1);
  });

  it('5b · botões (API oficial): Recusar → motivo da 99 → Confirmar → a 99 recebe a recusa com o motivo; o botão vindo de outro número não vale', async () => {
    await q(`update cardapio_config set provedor = 'cloud', wa_cloud_phone_id = 'pid-teste' where tenant_id = $1`, [T]);
    for (const n of ['ana', 'rodrigo']) await q(`update gestor_whatsapp set ultima_entrada_em = now() where colaborador_id = $1`, [pessoa[n]]);
    const c = await novoCaso({
      tipo: 'cancelamento_99',
      canal: '99food',
      pedido_numero: '77',
      pedido_id: await pedido(58, '99food'),
      detalhe: {
        plataforma: '99food',
        pedido99: { tipo: 'cancelamento', pedidoExterno: 'p-99', applyId: 'ap-1', motivoDoCliente: 'Demorou demais', motivosDeRecusa: ['preparing', 'prepared'], motivosDoReembolso: [], fotos: [] },
      },
    });
    await svc.enviarPendentes([T]);
    const b1 = ultimosBotoes(TEL.ana);
    expect(b1.corpo).toContain('*99Food · cancelamento · pedido 77*');
    expect(b1.interno).toBe(true);
    expect(b1.opcoes.map((o: any) => o.titulo)).toEqual(['Aceitar · R$ 58,00', 'Recusar']);
    expect(b1.opcoes[0].id).toMatch(/^gw:[0-9a-f-]{36}:acao:aceitar$/);
    // O botão da Ana tocado no celular do Bruno (ligado, mas a mensagem não foi para ele): não vale.
    const antes = enviados.length;
    await tocar(TEL.ana, 'Recusar', TEL.bruno);
    expect(textoDe(paraOnde(TEL.bruno, antes)[0])).toContain('Não achei a decisão deste botão');
    // E de um número que não é de gestor: não é tratado aqui (segue o caminho de sempre).
    expect(await entrada(TEL.outro, 'Recusar', randomUUID(), b1.opcoes[1].id)).toBe(false);
    await tocar(TEL.ana, 'Recusar');
    const b2 = ultimosBotoes(TEL.ana);
    expect(b2.botao).toBe('Ver os motivos');
    expect(b2.opcoes.map((o: any) => o.titulo)).toEqual(['O pedido já está em preparo', 'O pedido já está pronto']);
    await tocar(TEL.ana, 'O pedido já está em preparo');
    expect(ultimosBotoes(TEL.ana).corpo).toBe(
      'Confirma? Recusar o cancelamento do pedido 77 (motivo: O pedido já está em preparo). A resposta vai à 99 e não volta atrás.',
    );
    expect(aoNoventaENove).toEqual([]);
    await tocar(TEL.ana, 'Confirmar');
    expect(aoNoventaENove).toEqual([['cancelamento', ig, 'p-99', 'ap-1', false, 'preparing']]);
    expect((await q(`select decisao, detalhe from atendimento_chamado where id = $1`, [c]))[0]).toMatchObject({
      decisao: 'recusado',
      detalhe: { resposta: { via: 'whatsapp', por: 'Ana Souza' } },
    });
    expect(textoDe(paraOnde(TEL.ana).pop())).toMatch(/^✅ Feito: cancelamento do pedido 77 recusado\. No histórico do caso: Ana Souza, pelo WhatsApp/);
  });

  it('5b · o limite: acima dele, só Recusar (e o porquê); "Não aceitar pelo WhatsApp"; o limite que cai depois do envio — o Aceitar velho não vale', async () => {
    const cardapio = async (total: number, numero: string) =>
      novoCaso({ tipo: 'cancelamento', canal: 'cardapio', pedido_numero: numero, prazo: null, pedido_id: await pedido(total, 'cardapio'), detalhe: {}, mensagem: 'Pedi errado' });
    await cardapio(186.4, '1185');
    await svc.enviarPendentes([T]);
    expect(ultimaEnquete(TEL.ana).opcoes).toEqual([expect.stringMatching(/^Recusar · caso \d{4}$/)]);
    expect(ultimoTexto(TEL.ana)).toContain('Acima do seu limite pelo WhatsApp (R$ 100,00): para aceitar, abra no Regem e confirme com a sua senha. Recusar dá por aqui.');
    await q(`update robo_config set gestor_wa_limite_centavos = 0 where tenant_id = $1`, [T]);
    await cardapio(30, '1186');
    await svc.enviarPendentes([T]);
    expect(ultimoTexto(TEL.ana)).toContain('Aceitar só pelo Regem, com a sua senha. Recusar dá por aqui.');
    await q(`update robo_config set gestor_wa_limite_centavos = 10000 where tenant_id = $1`, [T]);
    await cardapio(50, '1187');
    await svc.enviarPendentes([T]);
    expect(ultimaEnquete(TEL.ana).opcoes[0]).toMatch(/^Aceitar · R\$ 50,00 · caso \d{4}$/);
    // O limite cai para R$ 30 depois do envio: o "Aceitar" da enquete não vale mais — vai o passo de agora, só Recusar.
    await q(`update robo_config set gestor_wa_limite_centavos = 3000 where tenant_id = $1`, [T]);
    const antes = enviados.length;
    await votar(TEL.ana, 'Aceitar');
    const depois = paraOnde(TEL.ana, antes);
    expect(textoDe(depois[0])).toContain('Esse botão é de uma mensagem anterior');
    expect(depois.find((e) => e.tipo === 'enquete')?.opcoes).toEqual([expect.stringMatching(/^Recusar · caso \d{4}$/)]);
    expect(cancelamentos).toEqual([]);
  });

  it('5b · cancelamento do cardápio: Aceitar → Perda → Confirmar → o cancelamento da tela, com quem decidiu no lugar da senha', async () => {
    const c = await novoCaso({ tipo: 'cancelamento', canal: 'cardapio', pedido_numero: '1190', prazo: null, pedido_id: await pedido(42, 'cardapio'), detalhe: {}, mensagem: 'Mudei de ideia' });
    await svc.enviarPendentes([T]);
    await votar(TEL.ana, 'Aceitar');
    expect(ultimaEnquete(TEL.ana).pergunta).toContain('O que aconteceu com os insumos do pedido?');
    await votar(TEL.ana, 'Perda');
    expect(ultimaEnquete(TEL.ana).pergunta).toBe(
      'Confirma? Aceitar o cancelamento do pedido 1190; insumos como perda. O pedido é cancelado aqui, como no painel; pago no Pix pelo cardápio, o valor volta ao cliente sozinho.',
    );
    await votar(TEL.ana, 'Confirmar');
    expect(cancelamentos).toHaveLength(1);
    const [u, id, dto, terminal, autorizadoPor] = cancelamentos[0];
    expect(u).toMatchObject({ tenantId: T, colaboradorId: pessoa.ana, categoria: 'gerente' });
    expect([id, dto, terminal, autorizadoPor]).toEqual([c, { aceita: true, reaproveitado: false }, null, { id: pessoa.ana, nome: 'Ana Souza' }]);
    expect(ultimoTexto(TEL.ana)).toMatch(/^✅ Feito: cancelamento do pedido 1190 aceito, insumos como perda\./);
  });

  it('5b · quem não pode mais decidir (V75): rebaixado depois do envio, ou "Decisões com prazo" desligado — nada muda nem vai à plataforma', async () => {
    const c = await disputaDeCancelamento(20);
    await svc.enviarPendentes([T]);
    await q(`update colaborador set funcao_id = $1 where id = $2`, [funcao.supervisao, pessoa.ana]);
    await votar(TEL.ana, 'Recusar');
    expect(ultimoTexto(TEL.ana)).toContain('Este WhatsApp não decide mais por aqui');
    await q(`update colaborador set funcao_id = $1 where id = $2`, [funcao.gerente, pessoa.ana]);
    await q(`update robo_config set gestor_wa_decisoes = false where tenant_id = $1`, [T]);
    await votar(TEL.ana, 'Recusar');
    expect(ultimoTexto(TEL.ana)).toContain('Este WhatsApp não decide mais por aqui');
    expect(aoIfood).toEqual([]);
    expect((await q(`select escolha from aviso_gestor_whatsapp where chamado_id = $1 and colaborador_id = $2`, [c, pessoa.ana]))[0].escolha).toBeNull();
  });

  it('5b · a falha do iFood devolve a vez (Confirmar de novo); "Voltar" recomeça; o toque numa enquete velha manda o passo de agora', async () => {
    const c = await disputaDeCancelamento(20, []); // sem motivo de aceite: o Aceitar vai direto ao Confirmar
    await svc.enviarPendentes([T]);
    const daAcao = ultimaEnquete(TEL.ana);
    await votar(TEL.ana, 'Recusar');
    expect(ultimaEnquete(TEL.ana).pergunta).toBe('Qual o motivo? A lista é do iFood.');
    // O voto na enquete VELHA (a da ação): não muda nada, e vai o passo de agora.
    const antes = enviados.length;
    await entrada(TEL.ana, daAcao.opcoes.find((o: string) => o.startsWith('Aceitar')));
    expect(textoDe(paraOnde(TEL.ana, antes)[0])).toContain('Esse botão é de uma mensagem anterior');
    expect(ultimaEnquete(TEL.ana).pergunta).toBe('Qual o motivo? A lista é do iFood.');
    await votar(TEL.ana, 'Problema técnico');
    await votar(TEL.ana, 'Voltar');
    expect(ultimaEnquete(TEL.ana).pergunta).toBe('O que responder?');
    await votar(TEL.ana, 'Aceitar');
    expect(ultimaEnquete(TEL.ana).pergunta).toBe('Confirma? Aceitar a disputa do pedido 4521, devolvendo R$ 20,00. A resposta vai ao iFood, que aceita uma só.');
    respostaDaPlataforma = { ok: false, status: 500 };
    await votar(TEL.ana, 'Confirmar');
    expect(ultimoTexto(TEL.ana)).toContain('Não deu: O iFood não respondeu agora. Tente de novo.');
    expect((await q(`select decisao, situacao from aviso_gestor_whatsapp where chamado_id = $1 and colaborador_id = $2`, [c, pessoa.ana]))[0]).toEqual({
      decisao: null,
      situacao: 'enviado',
    });
    respostaDaPlataforma = { ok: true };
    await votar(TEL.ana, 'Confirmar');
    expect(aoIfood).toHaveLength(2);
    expect(aoIfood[1].slice(2)).toEqual(['accept', {}]);
    expect((await q(`select decisao from atendimento_chamado where id = $1`, [c]))[0].decisao).toBe('aceito');
  });

  it('5b · dois toques em Confirmar ao mesmo tempo (ou duas réplicas): uma resposta só ao iFood', async () => {
    await disputaDeCancelamento(20, []);
    await svc.enviarPendentes([T]);
    await votar(TEL.ana, 'Aceitar');
    const voto = ultimaEnquete(TEL.ana).opcoes.find((o: string) => o.startsWith('Confirmar'));
    const p = { tenantId: T, telefone: TEL.ana, colaboradorId: pessoa.ana, tipo: 'decisao' as const, texto: voto, opcaoId: null };
    await Promise.all([svc.responder(p), svc.responder(p), svc.responder(p)]);
    expect(aoIfood).toHaveLength(1);
  });
});
