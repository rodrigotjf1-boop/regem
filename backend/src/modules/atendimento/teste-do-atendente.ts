import { BadRequestException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { ehServidorLocal } from '../../common/modo';
import { chaveDoTeste, idDaChaveDeTeste } from '../../common/conversa-do-robo';
import type { CasoSimulado, Simulacao } from './abrir-chamado';
import { NOME_DO_ASSUNTO, type AssuntoDoAtendente } from '../cardapio/assuntos-do-atendente';
import { type MotivoDaTrava, NOME_DO_MOTIVO_DA_TRAVA } from '../ponte-chat/texto-do-chat';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CONVERSA DE TESTE DO ATENDENTE (F4 do atendente virtual, mig 382 — pedido do dono, 08/11/2026: "mais treinamento do
// nosso atendente virtual"; protótipo `mockups/regem-central-atendimento.html`). O gerente abre uma conversa de teste,
// escolhe o canal (WhatsApp ou Direct — muda as instruções e o perfil) e, se quiser, "simular fora do horário"; escreve
// como se fosse um cliente; a mensagem vai ao MESMO robô de verdade (o fluxo do n8n) com a chave `teste:<id>`; a resposta
// volta por `publico/bot/responder` e fica guardada aqui. NADA sai para cliente nenhum e NADA de verdade é criado: chamar a
// equipe, recado e pedido viram uma linha 'sistema' dizendo o que aconteceria na conversa de verdade.
//
// Uma regra só, fora dos serviços — o WhatsApp (a resposta do robô), o cardápio (as consultas, o "chamar atendente" e o
// pedido), o cliente (o link) e a tela (atendimento) importam daqui sem ciclo de módulo. Só banco e funções puras.

/**
 * Os canais que o teste imita (as instruções e o perfil de cada um). `chat` (F5, mig 383) = o chat do iFood: no banco fica
 * `canal = 'whatsapp'` com `plataforma = 'ifood'` (o check da coluna `canal` é da 382 e a migration não pode ter `drop`); a API
 * mostra `canal: 'chat'`.
 */
export const CANAIS_DO_TESTE = ['whatsapp', 'direct', 'chat'] as const;
export type CanalDoTeste = (typeof CANAIS_DO_TESTE)[number];
/** O texto do "cliente" no teste cabe nisto. */
export const TEXTO_DO_TESTE_MAX = 1000;
/** Quantas mensagens de teste cada pessoa manda por minuto. */
export const MENSAGENS_POR_MINUTO = 20;
/** Até quando a tela espera a resposta do robô (a última fala é do "cliente" há menos que isto). */
export const ESPERA_DA_RESPOSTA_MS = 90_000;
/** Conversas de teste paradas há mais que isto são apagadas quando alguém da empresa abre outra. */
export const DIAS_DO_TESTE = 7;
/** O nome do "cliente" que o robô vê. */
export const NOME_NO_TESTE = 'Teste da loja';
/** O que fica na conversa quando o robô responderia em áudio (o teste não toca áudio). */
export const AUDIO_NO_TESTE = '[o robô mandaria um áudio]';
/** O que a linha 'sistema' diz que aconteceria. `plataforma` (F5) = a trava do chat do iFood barraria a resposta. */
export const TIPOS_SIMULADOS = ['equipe', 'recado', 'responsavel', 'nao', 'pedido', 'link', 'plataforma'] as const;
export type TipoSimulado = (typeof TIPOS_SIMULADOS)[number];

const ehCanal = (v: unknown): v is CanalDoTeste => typeof v === 'string' && (CANAIS_DO_TESTE as readonly string[]).includes(v);
const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** O id de quem abriu, quando é um colaborador (o técnico do suporte vem como `sup:<id>` — fica sem dono). */
const uuidOuNulo = (v: unknown): string | null => (typeof v === 'string' && UUID_RE.test(v) ? v : null);

// ───────────────────────── as escolhas (puras) ─────────────────────────

/**
 * O robô pode rodar NESTA instalação? Só na nuvem, com o endereço do fluxo único do robô (`N8N_ROBO_WEBHOOK_URL`) e a senha
 * dele (`BOT_RESOLVER_SECRET`). Não depende do robô ligado na loja nem de WhatsApp/Instagram conectado: o teste é para
 * testar ANTES de ligar.
 */
export function roboDisponivelParaTeste(): boolean {
  return !ehServidorLocal() && !!String(process.env.N8N_ROBO_WEBHOOK_URL ?? '').trim() && !!String(process.env.BOT_RESOLVER_SECRET ?? '').trim();
}

/** O teste novo que a tela pediu, conferido: o canal da lista; "simular fora do horário" só verdadeiro ou falso (V15). */
export function lerNovoTeste(dto: unknown): { canal: CanalDoTeste; foraDoHorario: boolean } {
  const d = ehObjeto(dto) ? dto : {};
  if (!ehCanal(d.canal)) throw new BadRequestException('Escolha o canal do teste: WhatsApp, Direct do Instagram ou chat do iFood.');
  let foraDoHorario = false;
  if (d.foraDoHorario !== undefined && d.foraDoHorario !== null) {
    if (typeof d.foraDoHorario !== 'boolean') throw new BadRequestException('"Simular fora do horário": escolha sim ou não.');
    foraDoHorario = d.foraDoHorario;
  }
  return { canal: d.canal, foraDoHorario };
}

/** O que o "cliente" escreveu no teste: aparado, de 1 a 1000 letras. */
export function lerTextoDoCliente(dto: unknown): string {
  const d = ehObjeto(dto) ? dto : {};
  const t = typeof d.texto === 'string' ? d.texto.trim() : '';
  if (!t) throw new BadRequestException('Escreva a mensagem do cliente.');
  if (t.length > TEXTO_DO_TESTE_MAX) throw new BadRequestException(`A mensagem do teste: no máximo ${TEXTO_DO_TESTE_MAX} letras.`);
  return t;
}

/** A tela espera a resposta do robô? A última fala é do "cliente" e tem menos de 90 s (pelo relógio do banco). */
export function esperandoResposta(mensagens: ReadonlyArray<{ autor: string; criadoEm: string }>, agora: Date): boolean {
  const ultima = mensagens[mensagens.length - 1];
  if (!ultima || ultima.autor !== 'cliente') return false;
  const idade = agora.getTime() - new Date(ultima.criadoEm).getTime();
  return idade < ESPERA_DA_RESPOSTA_MS;
}

// ───────────────────────── o banco ─────────────────────────

/** O cardápio que o robô do teste consulta (o mesmo das consultas de verdade: o token dá a loja, o menu e a taxa). */
export type CardapioDoTeste = {
  id: string;
  token: string;
  ativo: boolean;
  aberto: boolean | null;
  nomePublico: string | null;
  unidadeId: string | null;
  site: string | null;
  instagram: string | null;
  roboSaudacao: string | null;
  roboAusencia: string | null;
  roboPrompt: string | null;
  roboMensagens: any;
};

export type TesteDoAtendente = {
  id: string;
  tenantId: string;
  usuarioId: string | null;
  canal: CanalDoTeste;
  foraDoHorario: boolean;
  cardapioId: string | null;
  criadoEm: string;
  /** null = o cardápio não existe mais (apagado depois de abrir o teste). */
  cardapio: CardapioDoTeste | null;
};

async function lerTesteOnde(db: any, onde: SQL): Promise<TesteDoAtendente | null> {
  let r: any;
  try {
    // `plataforma` (mig 383) pelo to_jsonb: num banco sem a 383 a leitura não falha (o teste é de WhatsApp ou Direct).
    r = await db.execute(sql`
      select t.id, t.tenant_id as "tenantId", t.usuario_id as "usuarioId", t.canal, t.fora_do_horario as "foraDoHorario",
             to_jsonb(t) ->> 'plataforma' as plataforma,
             t.cardapio_id as "cardapioId", t.criado_em as "criadoEm",
             case when c.id is null then null else json_build_object(
               'id', c.id, 'token', c.token, 'ativo', c.ativo, 'aberto', c.aberto, 'nomePublico', c.nome_publico,
               'unidadeId', c.unidade_id, 'site', c.site, 'instagram', c.instagram, 'roboSaudacao', c.robo_saudacao,
               'roboAusencia', c.robo_ausencia, 'roboPrompt', c.robo_prompt, 'roboMensagens', c.robo_mensagens) end as cardapio
        from atendente_teste t
        left join cardapio_config c on c.id = t.cardapio_id and c.tenant_id = t.tenant_id
       where ${onde}`);
  } catch (e: any) {
    // Banco sem a 382 (o servidor da loja, um banco de teste antigo): não há conversa de teste nenhuma.
    if (e?.code === '42P01' || e?.cause?.code === '42P01') return null;
    throw e;
  }
  const [l] = linhasDe(r);
  if (!l) return null;
  return {
    id: String(l.id),
    tenantId: String(l.tenantId),
    usuarioId: l.usuarioId ? String(l.usuarioId) : null,
    canal: l.plataforma ? 'chat' : ehCanal(l.canal) ? l.canal : 'whatsapp',
    foraDoHorario: l.foraDoHorario === true,
    cardapioId: l.cardapioId ? String(l.cardapioId) : null,
    criadoEm: iso(l.criadoEm),
    cardapio: l.cardapio ? { ...l.cardapio, id: String(l.cardapio.id) } : null,
  };
}

/**
 * A conversa de teste da CHAVE que o robô repassou (`teste:<uuid>` na instância ou no telefone). Só pelo id da linha: a
 * empresa vem DELA. Forma inválida, id desconhecido, apagado pela retenção ou banco sem a 382 → null (quem chama recusa).
 */
export async function testeDaChave(db: any, chave: unknown): Promise<TesteDoAtendente | null> {
  const id = idDaChaveDeTeste(chave);
  if (!id) return null;
  return lerTesteOnde(db, sql`t.id = ${id}::uuid`);
}

/** A conversa de teste `id` DESTA empresa (a da sessão); de outra empresa ou inexistente → null (a rota responde 404). */
export async function testeDaEmpresa(db: any, tenantId: string, id: string): Promise<TesteDoAtendente | null> {
  if (!UUID_RE.test(String(id ?? '')) || !tenantId) return null;
  return lerTesteOnde(db, sql`t.id = ${id}::uuid and t.tenant_id = ${tenantId}::uuid`);
}

/**
 * O cardápio que o robô do teste vai consultar: um cardápio ATIVO da empresa (sem ele, o robô não lê nada), preferindo o do
 * canal — no Direct, o "Cardápio que o robô usa" da conta do Instagram; no WhatsApp, o que tem o número ligado (Evolution ou
 * API oficial) —, depois o da empresa (sem loja). null = a empresa não tem cardápio ativo.
 */
export async function escolherCardapioDoTeste(db: any, tenantId: string, canal: CanalDoTeste): Promise<string | null> {
  let preferido: string | null = null;
  if (canal === 'direct') {
    const [tem] = linhasDe(await db.execute(sql`select to_regclass(current_schema() || '.instagram_conta') is not null as tem`));
    if (tem?.tem) {
      const [c] = linhasDe(await db.execute(sql`select cardapio_id as id from instagram_conta where tenant_id = ${tenantId}::uuid`));
      preferido = c?.id ? String(c.id) : null;
    }
  }
  const [l] = linhasDe(
    await db.execute(sql`
      select id from cardapio_config
       where tenant_id = ${tenantId}::uuid and ativo
       order by (id = ${preferido}::uuid) desc nulls last,
                (coalesce(evolution_instancia, '') <> '' or coalesce(wa_cloud_phone_id, '') <> '') desc,
                (unidade_id is null) desc, id
       limit 1`),
  );
  return l?.id ? String(l.id) : null;
}

/** Quem abre o teste. */
export type QuemTesta = { tenantId: string; colaboradorId: string };

/**
 * Abre a conversa de teste e, na MESMA instrução (set-based), apaga as conversas de teste da empresa paradas há mais de 7
 * dias (as mensagens vão junto, em cascata). Devolve o teste novo.
 */
export async function criarTeste(
  db: any,
  quem: QuemTesta,
  lido: { canal: CanalDoTeste; foraDoHorario: boolean },
  cardapioId: string,
): Promise<{ id: string; canal: CanalDoTeste; foraDoHorario: boolean }> {
  // O chat do iFood (F5, mig 383): `canal = 'whatsapp'` por baixo, com a `plataforma` — a coluna só entra na gravação dele.
  const doChat = lido.canal === 'chat';
  const [l] = linhasDe(
    await db.execute(sql`
      with velhos as (
        delete from atendente_teste
         where tenant_id = ${quem.tenantId}::uuid and atualizado_em < clock_timestamp() - make_interval(days => ${DIAS_DO_TESTE}::int)
      )
      insert into atendente_teste (tenant_id, usuario_id, canal, fora_do_horario, cardapio_id${doChat ? sql`, plataforma` : sql``})
      values (${quem.tenantId}::uuid, ${uuidOuNulo(quem.colaboradorId)}::uuid, ${doChat ? 'whatsapp' : lido.canal}, ${lido.foraDoHorario}::boolean,
              ${cardapioId}::uuid${doChat ? sql`, 'ifood'` : sql``})
      returning id, canal, fora_do_horario as "foraDoHorario"`),
  );
  return { id: String(l.id), canal: doChat ? 'chat' : l.canal, foraDoHorario: l.foraDoHorario === true };
}

/** Uma mensagem da conversa de teste como a tela recebe. */
export type MensagemDoTeste = {
  id: string;
  autor: 'cliente' | 'robo' | 'sistema';
  texto: string;
  opcoes: Array<{ titulo: string; descricao?: string }> | null;
  simulado: { tipo: TipoSimulado; detalhe?: string } | null;
  criadoEm: string;
};

const opcoesDaLinha = (v: unknown): MensagemDoTeste['opcoes'] => {
  if (!Array.isArray(v) || !v.length) return null;
  const ops = v
    .filter((o) => ehObjeto(o) && typeof o.titulo === 'string' && o.titulo.trim())
    .map((o: any) => ({ titulo: String(o.titulo), ...(typeof o.descricao === 'string' && o.descricao.trim() ? { descricao: String(o.descricao) } : {}) }));
  return ops.length ? ops : null;
};

const simuladoDaLinha = (v: unknown): MensagemDoTeste['simulado'] => {
  if (!ehObjeto(v) || !(TIPOS_SIMULADOS as readonly string[]).includes(String(v.tipo))) return null;
  return { tipo: v.tipo as TipoSimulado, ...(typeof v.detalhe === 'string' && v.detalhe ? { detalhe: v.detalhe } : {}) };
};

function mensagemDaLinha(l: any): MensagemDoTeste {
  return {
    id: String(l.id),
    autor: l.autor,
    texto: String(l.texto ?? ''),
    opcoes: opcoesDaLinha(l.opcoes),
    simulado: simuladoDaLinha(l.simulado),
    criadoEm: iso(l.criadoEm),
  };
}

/** As mensagens da conversa (as 200 mais novas, na ordem em que foram gravadas) e a hora do banco agora. */
export async function mensagensDoTeste(db: any, testeId: string): Promise<{ mensagens: MensagemDoTeste[]; agora: Date }> {
  const r = await db.execute(sql`
    select x.*, clock_timestamp() as agora from (
      select id, autor, texto, opcoes, simulado, criado_em as "criadoEm"
        from atendente_teste_msg where teste_id = ${testeId}::uuid
       order by criado_em desc, id desc limit 200) x
     order by x."criadoEm", x.id`);
  const linhas = linhasDe(r);
  return { mensagens: linhas.map(mensagemDaLinha), agora: linhas.length ? new Date(linhas[0].agora) : new Date() };
}

/** A conversa de teste como a tela recebe. */
export function testeParaATela(teste: { id: string; canal: CanalDoTeste; foraDoHorario: boolean }, mensagens: MensagemDoTeste[], agora: Date) {
  return { id: teste.id, canal: teste.canal, foraDoHorario: teste.foraDoHorario, esperandoResposta: esperandoResposta(mensagens, agora), mensagens };
}

/** Quantas mensagens de "cliente" esta pessoa mandou nos testes da empresa no último minuto. */
export async function mensagensDoUsuarioNoMinuto(db: any, tenantId: string, colaboradorId: string): Promise<number> {
  const [l] = linhasDe(
    await db.execute(sql`
      select count(*)::int as n
        from atendente_teste_msg m join atendente_teste t on t.id = m.teste_id
       where t.tenant_id = ${tenantId}::uuid and t.usuario_id is not distinct from ${uuidOuNulo(colaboradorId)}::uuid
         and m.autor = 'cliente' and m.criado_em > clock_timestamp() - interval '1 minute'`),
  );
  return Number(l?.n) || 0;
}

/** Uma linha nova na conversa de teste (e a conversa fica "mexida agora" — a retenção conta daqui). */
export async function gravarMensagem(
  db: any,
  teste: { id: string; tenantId: string },
  m: { autor: 'cliente' | 'robo' | 'sistema'; texto: string; opcoes?: unknown[] | null; simulado?: Record<string, unknown> | null },
): Promise<MensagemDoTeste> {
  const [l] = linhasDe(
    await db.execute(sql`
      with nova as (
        insert into atendente_teste_msg (teste_id, tenant_id, autor, texto, opcoes, simulado)
        values (${teste.id}::uuid, ${teste.tenantId}::uuid, ${m.autor}, ${m.texto},
                ${m.opcoes?.length ? JSON.stringify(m.opcoes) : null}::jsonb, ${m.simulado ? JSON.stringify(m.simulado) : null}::jsonb)
        returning id, autor, texto, opcoes, simulado, criado_em as "criadoEm"
      ), mexida as (
        update atendente_teste set atualizado_em = clock_timestamp() where id = ${teste.id}::uuid
      )
      select * from nova`),
  );
  return mensagemDaLinha(l);
}

/**
 * Uma linha 'sistema' que só entra UMA vez por fala do "cliente" (o robô pode chamar várias ferramentas do pedido na mesma
 * resposta): se já há uma linha 'sistema' do mesmo `tipo` depois da última mensagem do cliente, não grava de novo.
 */
export async function gravarUmaVezPorFala(db: any, teste: { id: string; tenantId: string }, texto: string, simulado: { tipo: TipoSimulado; detalhe?: string }): Promise<void> {
  await db.execute(sql`
    with nova as (
      insert into atendente_teste_msg (teste_id, tenant_id, autor, texto, simulado)
      select ${teste.id}::uuid, ${teste.tenantId}::uuid, 'sistema', ${texto}, ${JSON.stringify(simulado)}::jsonb
       where not exists (
         select 1 from atendente_teste_msg s
          where s.teste_id = ${teste.id}::uuid and s.autor = 'sistema' and s.simulado ->> 'tipo' = ${simulado.tipo}::text
            and s.criado_em > coalesce((select max(c.criado_em) from atendente_teste_msg c
                                         where c.teste_id = ${teste.id}::uuid and c.autor = 'cliente'), '-infinity'::timestamptz))
      returning id
    )
    update atendente_teste set atualizado_em = clock_timestamp() where id = ${teste.id}::uuid and exists (select 1 from nova)`);
}

/**
 * A mensagem do "cliente" do teste no formato que o robô (n8n) recebe — o MESMO das outras vias (`MsgNormalizada` da API
 * oficial e da Evolution; `instagram.service.ts` › `mensagemParaORobo` no Direct): a chave `teste:<id>` em `instancia` e
 * em `de`, sem `phoneNumberId` (o n8n acha a loja pela instância, como na Evolution e no Direct). `provedor` segue o canal
 * escolhido: 'instagram' no Direct; 'evolution' no WhatsApp (a forma "instância, sem phoneNumberId" é a da Evolution — a
 * API oficial exigiria um phoneNumberId de verdade). `conversa` vai NULA de propósito (ver `conversa-do-robo.ts`).
 * O chat do iFood (F5, mig 383): a forma da fala do chat de verdade (`ponte-chat/atendente-no-chat.ts` ›
 * `mensagemDoChatParaORobo`) — `provedor` 'instagram' (só texto), `plataforma` 'ifood' e `pedido` NULO (no teste não há
 * pedido; as instruções do teste dizem isso).
 */
export function mensagemParaORobo(teste: TesteDoAtendente & { cardapio: CardapioDoTeste }, texto: string, mensagemId: string, agora: Date = new Date()) {
  const c = teste.cardapio;
  const chave = chaveDoTeste(teste.id);
  const textoSo = teste.canal !== 'whatsapp';
  return {
    provedor: textoSo ? ('instagram' as const) : ('evolution' as const),
    tenantId: teste.tenantId,
    cardapioToken: c.token,
    phoneNumberId: null,
    instancia: chave,
    jid: null,
    loja: { nome: c.nomePublico ?? null, aberto: textoSo ? c.aberto !== false : !!c.aberto },
    de: chave,
    nome: NOME_NO_TESTE,
    tipo: 'text',
    texto,
    mensagemId,
    timestamp: Math.floor(agora.getTime() / 1000),
    midiaId: null,
    opcaoId: null,
    roboSaudacao: c.roboSaudacao ?? null,
    roboAusencia: c.roboAusencia ?? null,
    roboPrompt: c.roboPrompt ?? null,
    roboMensagens: Array.isArray(c.roboMensagens) ? c.roboMensagens : [],
    conversa: null,
    ...(teste.canal === 'chat' ? { plataforma: 'ifood' as const, pedido: null } : {}),
  };
}

/**
 * A linha 'sistema' do teste do chat do iFood quando a TRAVA DA PLATAFORMA barraria a resposta do robô (F5 — a mesma regra
 * do caminho de verdade, `travaDaPlataforma`) ou quando ele responderia só em áudio.
 */
export function linhaDaTravaNoTeste(motivo: MotivoDaTrava | 'audio'): { texto: string; simulado: { tipo: 'plataforma'; detalhe: string } } {
  if (motivo === 'audio')
    return {
      texto: 'No chat do iFood não sai áudio: esta resposta não iria ao cliente — sem resposta, em 2 minutos o caso abriria para a equipe.',
      simulado: { tipo: 'plataforma', detalhe: 'audio' },
    };
  return {
    texto: `O iFood barraria esta resposta: ${NOME_DO_MOTIVO_DA_TRAVA[motivo]}. Na conversa de verdade, nada deste texto sairia: iria a resposta pronta do pedido (quando o cliente pergunta dele) ou o caso abriria para a equipe, com "Já chamei a equipe da loja".`,
    simulado: { tipo: 'plataforma', detalhe: motivo },
  };
}

// ───────────────────────── a simulação do "chamar atendente" ─────────────────────────

const ehPrioridade = (v: unknown): v is 'normal' | 'urgente' => v === 'normal' || v === 'urgente';

/** Os casos que o teste já "abriu" (as linhas 'sistema' do chamar atendente guardam o caso), do mais novo ao mais velho. */
export async function casosSimuladosDoTeste(db: any, testeId: string): Promise<CasoSimulado[]> {
  const r = await db.execute(sql`
    select simulado from atendente_teste_msg
     where teste_id = ${testeId}::uuid and autor = 'sistema' and simulado ? 'casoId'
     order by criado_em desc, id desc limit 50`);
  const vistos = new Set<string>();
  const casos: CasoSimulado[] = [];
  for (const { simulado: s } of linhasDe(r)) {
    if (!ehObjeto(s) || typeof s.casoId !== 'string' || vistos.has(s.casoId)) continue;
    vistos.add(s.casoId); // a linha mais nova de cada caso é o estado dele (a prioridade que subiu)
    if ((s.fila !== 'equipe' && s.fila !== 'responsavel') || !ehPrioridade(s.prioridade) || typeof s.criadoEm !== 'string') continue;
    const recado = ehObjeto(s.recado) && typeof s.recado.ate === 'string' && typeof s.recado.em === 'string' ? { ate: s.recado.ate, em: s.recado.em } : null;
    casos.push({
      id: s.casoId,
      fila: s.fila,
      assunto: typeof s.assunto === 'string' ? (s.assunto as AssuntoDoAtendente) : null,
      prioridade: s.prioridade,
      recado,
      criadoEm: s.criadoEm,
    });
  }
  return casos;
}

const ordinal = (n: number) => `${n}º`;

/**
 * A linha 'sistema' do "chamar atendente" simulado: o que aconteceria na conversa de verdade e o `simulado` que a guarda
 * (`{ tipo, detalhe }` para a tela; o caso para a próxima chamada somar). `nao` = o tipo era um assunto em "Responde que não
 * é por aqui" — o robô não devia ter chamado (na conversa de verdade o chamado vira o caso comum).
 */
export function linhaDaSimulacao(sim: Simulacao, nao: AssuntoDoAtendente | null, canal?: CanalDoTeste): { texto: string; simulado: Record<string, unknown> } {
  const r: any = sim.resposta;
  const caso = { casoId: sim.caso.id, fila: sim.caso.fila, assunto: sim.caso.assunto ?? null, prioridade: sim.caso.prioridade, recado: sim.caso.recado ?? null, criadoEm: sim.caso.criadoEm };
  const ninguem = 'Ninguém foi avisado: é um teste.';
  if (sim.resultado === 'responsavel') {
    const assunto = sim.caso.assunto as AssuntoDoAtendente;
    const acao = sim.somou ? 'somaria ao recado para o responsável que já deixou' : 'deixaria um recado para o responsável';
    return {
      texto: `Na conversa de verdade, o atendente ${acao} (${NOME_DO_ASSUNTO[assunto] ?? assunto}) — fora da fila da equipe; só gerente e presidente veem. ${ninguem}`,
      simulado: { tipo: 'responsavel', detalhe: assunto, ...caso },
    };
  }
  let base: string;
  if (sim.resultado === 'recado') {
    const volta = typeof r?.equipeVolta === 'string' ? ` (${r.equipeVolta})` : '';
    const sempre = sim.situacao?.modo === 'sempre' ? ' Hoje a equipe atende "Sempre": isto só acontece com "No horário da loja".' : '';
    base = `fora do horário da equipe, ${sim.somou ? 'o recado que o atendente já deixou continuaria' : 'ficaria um recado'} para quando a equipe voltar${volta} — ninguém seria chamado agora.${sempre}`;
  } else {
    const urgente = sim.caso.prioridade === 'urgente' ? ' com urgência' : '';
    const fila = typeof r?.posicao === 'number' ? ` — o cliente seria o ${ordinal(r.posicao)} da fila` : '';
    // "Simular fora do horário" sem horário cadastrado (`situacaoForaDoHorario` sem janela: não atende e sem volta): a regra da
    // F1 é "sem horário = a equipe atende sempre" — o recado não nasce. Sem esta frase, a linha parecia ignorar a simulação.
    const semHorario =
      sim.situacao && sim.situacao.atendendo === false && !sim.situacao.voltaEm
        ? ' A loja não tem horário de funcionamento cadastrado (Delivery › Configurações › Horários): sem horário, a equipe é chamada a qualquer hora — por isso "fora do horário" dá o mesmo.'
        : '';
    // No chat do iFood (F5): o caso é o do chat daquela conversa (o pedido), na fila da equipe.
    const chama = canal === 'chat' ? 'abriria o caso do chat do iFood para a equipe' : 'chamaria a equipe';
    base = `o atendente ${sim.somou ? 'somaria ao caso que já abriu' : chama}${urgente}${fila}.${semHorario}`;
  }
  if (nao)
    return {
      texto: `A loja escolheu "Responde que não é por aqui" para ${NOME_DO_ASSUNTO[nao]}: o atendente não devia ter chamado ninguém. Na conversa de verdade, ${base} ${ninguem}`,
      simulado: { tipo: 'nao', detalhe: nao, ...caso },
    };
  const frase = `Na conversa de verdade, ${base} ${ninguem}`;
  return sim.resultado === 'recado'
    ? { texto: frase, simulado: { tipo: 'recado', detalhe: 'abertura', ...caso } }
    : { texto: frase, simulado: { tipo: 'equipe', detalhe: sim.tipoDoChamado, ...caso } };
}

/** A linha 'sistema' das rotas do pedido no teste (o pedido não é montado). */
export const LINHA_DO_PEDIDO = {
  texto: 'Na conversa de verdade, o atendente montaria o pedido com o cliente aqui na conversa. No teste o pedido não é montado: nada vai para a loja.',
  simulado: { tipo: 'pedido' as const, detalhe: 'nao_montado' },
};

/** A linha 'sistema' do link do cliente no teste (não há cliente: o link não é criado). */
export const LINHA_DO_LINK = {
  texto: 'Na conversa de verdade, o atendente mandaria o link do cardápio já com os dados do cliente. No teste não há cliente: o link não é criado (o certo é mandar o link do cardápio).',
  simulado: { tipo: 'link' as const, detalhe: 'cliente' },
};

/** O que as rotas do pedido devolvem ao robô no teste (200, a forma das recusas de regra: `ok: false` com a mensagem). */
export const RESPOSTA_DO_PEDIDO_NO_TESTE = {
  ok: false as const,
  motivo: 'teste',
  simulado: true as const,
  mensagem:
    'Esta é uma conversa de TESTE do atendente: aqui o pedido não é montado nem registrado. Diga ao cliente, em uma frase, que na conversa de verdade você montaria o pedido com ele aqui, e mande o link do cardápio.',
};
