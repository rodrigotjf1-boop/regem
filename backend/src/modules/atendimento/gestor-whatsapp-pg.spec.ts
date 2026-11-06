import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { GestorWhatsappService } from './gestor-whatsapp.service';
import { portaoDoGestor } from './gestor-whatsapp-entrada';

/* eslint-disable @typescript-eslint/no-explicit-any */

// GERENTE NO WHATSAPP (mig 375, parte 5a), contra o Postgres real, com o WhatsApp de mentira: ligar o PRÓPRIO número pelo
// código (uma vez, um número por pessoa, o de quem saiu fica livre); PARAR/VOLTAR AVISOS; a rotina manda a decisão e o
// "ninguém pegou" a quem pode receber AGORA (V75: pausado, bloqueado, rebaixado, loja apagada ficam de fora; gerente só a
// loja dele), uma vez só; API oficial: texto na janela, modelo fora dela e o "Ver por aqui"; a falha passageira tenta de
// novo até 3 vezes; o limite da volta só pega quem vale (V84); desligar; o grupo da tela (só o final do número; V82).
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
      enviados.push({ via: 'evolution', tenantId, para, texto });
      return { ok: true };
    },
  };
  const cloud: any = {
    enviarInterno: async (tenantId: string, para: string, conteudo: any) => {
      if (falharEnvio) throw new Error('Falha ao enviar pela Cloud API (500)');
      enviados.push({ via: 'cloud', tenantId, para, ...conteudo });
      return { ok: true, id: 'wamid' };
    },
    garantirModeloRelacionamento: async () => 'pendente',
  };
  let svc: GestorWhatsappService;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const user = (nome: string, categoria = 'gerente') => ({ tenantId: T, colaboradorId: pessoa[nome], categoria }) as any;
  const auditar = async (e: any) => void auditados.push(e);
  const entrada = (telefone: string, texto: string, idMensagem: string = randomUUID()) =>
    portaoDoGestor(db, { tenantId: T, telefone, texto, idMensagem }, async (t) => void respostas.push(t), auditar);
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
      ...o,
    };
    const [{ id }] = await q(
      `insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, pedido_numero, mensagem, prazo_em, detalhe,
                                        criado_em, responsavel_id)
       values ($1, $2, $3, $4, $5, $6, $7, case when $8::text is null then null else now() + $8::interval end, $9::jsonb,
               now() - $10::interval, $11) returning id`,
      [T, c.unidade_id, c.tipo, c.canal, c.cliente, c.pedido_numero, c.mensagem, c.prazo, JSON.stringify(c.detalhe), c.criado, c.responsavel_id],
    );
    return id as string;
  };
  const quemRecebeu = (chamado: string) =>
    q(`select c.nome, a.situacao, a.tipo from aviso_gestor_whatsapp a join colaborador c on c.id = a.colaborador_id
        where a.chamado_id = $1 order by c.nome`, [chamado]);
  const limpar = () => {
    enviados.length = 0;
    respostas.length = 0;
    auditados.length = 0;
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
    for (const m of ['215_whatsapp_mensagem.sql', '342_robo_pausa_e_config.sql', '353_app_atendimento.sql', '375_gestor_whatsapp.sql'])
      await aplicar(m);
    svc = new GestorWhatsappService(db, cloud, evolution, { registrar: auditar } as any);
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
    expect(enviados.map((e) => e.para).sort()).toEqual([TEL.ana, TEL.rodrigo]);
    expect(enviados[0].texto).toContain('⚖️ *Disputa do iFood · pedido 4521*');
    expect(enviados[0].texto).toContain(`/atendimento?caso=${c}`);
    expect(await svc.enviarPendentes([T])).toBe(0);
    expect(enviados).toHaveLength(2);
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
    const paraAna = enviados.find((e) => e.para === TEL.ana);
    expect(paraAna).toEqual({ via: 'cloud', tenantId: T, para: TEL.ana, modelo: 'aviso_ao_gestor', variaveis: ['disputa do iFood no pedido 4521, responder até ' + paraAna.variaveis[0].slice(-5)] });
    expect(enviados.find((e) => e.para === TEL.rodrigo)?.texto).toContain('Disputa do iFood');
    expect((await quemRecebeu(c)).map((x) => [x.nome, x.situacao])).toEqual([
      ['Ana Souza', 'modelo'],
      ['Rodrigo Dono', 'enviado'],
    ]);
    // A Ana toca em "Ver por aqui": chega o texto, o aviso fica "enviado" e a janela abre.
    expect(await entrada(TEL.ana, 'Ver por aqui')).toBe(true);
    expect(respostas).toHaveLength(1);
    expect(respostas[0]).toContain(`/atendimento?caso=${c}`);
    expect((await quemRecebeu(c)).find((x) => x.nome === 'Ana Souza')?.situacao).toBe('enviado');
    expect(new Date((await gestor('ana')).ultima_entrada_em).getTime()).toBeGreaterThan(Date.now() - 60_000);
    // Outro modelo; o caso é resolvido antes do toque: "nada esperando", e o aviso expira.
    await q(`update gestor_whatsapp set ultima_entrada_em = now() - interval '2 days' where colaborador_id = $1`, [pessoa.ana]);
    const c2 = await novoCaso();
    await svc.enviarPendentes([T]);
    await q(`update atendimento_chamado set status = 'resolvido' where id = $1`, [c2]);
    respostas.length = 0;
    expect(await entrada(TEL.ana, 'ver por aqui')).toBe(true);
    expect(respostas[0]).toContain('Nada esperando por você agora');
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
    expect(await svc.ajuste(T2)).toEqual({ ligado: false, decisoes: true, ninguemPegou: true });
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
});
