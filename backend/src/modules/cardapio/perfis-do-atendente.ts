import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ehServidorLocal } from '../../common/modo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PERFIL DO ATENDENTE VIRTUAL POR CANAL (F2 do atendente virtual, mig 380 — pedido do dono, 07/11/2026: "perfis
// diferentes de atendimento… profissional, cordial e gentil, e outros disponíveis", "um para horário de funcionamento e
// outro fora" e "o perfil pode ser para cada tipo de ação: WhatsApp, Direct, Messenger do Facebook, comentários";
// protótipo `mockups/regem-central-atendimento.html`, versão 11, grupo "Perfil do atendente virtual").
//
// Uma regra só, fora dos serviços — como `atendimento/horario-da-equipe.ts`: as instruções do robô (cardápio) e os ajustes
// (atendimento) importam daqui sem ciclo de módulo. Três partes:
//  • as ESCOLHAS (puras): os perfis, os canais, a conferência do que a tela manda e a leitura tolerante do que vem do banco;
//  • o TEXTO (puro): o bloco que entra nas instruções do robô logo depois da abertura — o perfil (o de fora do horário,
//    quando a equipe não está) e o jeito da loja. "Como hoje" sem jeito = nada: as instruções ficam IGUAIS às de hoje;
//  • o BANCO: `robo_config.atendente_perfis` (só na nuvem), lido sem derrubar transação e gravado campo a campo (V82).
// O perfil muda só o jeito de falar: as regras (preço, prazo, cliente chateado, as travas de cada canal) ficam.

/** Os perfis, na ordem da tela. `hoje` = "Como hoje": o jeito atual, que não acrescenta nada às instruções. */
export const PERFIS_DO_ATENDENTE = ['hoje', 'profissional', 'cordial', 'gentil', 'descontraido', 'objetivo', 'acolhedor'] as const;
export type PerfilDoAtendente = (typeof PERFIS_DO_ATENDENTE)[number];
/** Fora do horário da equipe: "O mesmo" (o de cima) ou um perfil — "Como hoje" não entra (o de cima já é o "como hoje"). */
export const PERFIS_FORA_DO_HORARIO = ['mesmo', 'profissional', 'cordial', 'gentil', 'descontraido', 'objetivo', 'acolhedor'] as const;
export type PerfilForaDoHorario = (typeof PERFIS_FORA_DO_HORARIO)[number];
/** Os canais com perfil: onde o robô de IA já fala — `chat` (F5, mig 383) = o chat do iFood e da 99, pela ponte do chat;
 * `comentarios` (F6, mig 384) = os comentários dos posts do Instagram; `messenger` (mig 386) = o Messenger do Facebook. */
export const CANAIS_DO_PERFIL = ['whatsapp', 'direct', 'chat', 'comentarios', 'messenger'] as const;
export type CanalDoPerfil = (typeof CANAIS_DO_PERFIL)[number];
/** O "jeito da loja" cabe nisto (uma linha só). */
export const JEITO_MAX = 300;

export type PerfilDoCanal = { perfil: PerfilDoAtendente; foraDoHorario: PerfilForaDoHorario; jeito: string | null };
export type PerfisDoAtendente = Record<CanalDoPerfil, PerfilDoCanal>;
/** Nasce em "Como hoje", "O mesmo" fora do horário e sem jeito da loja: nada muda até a loja escolher (versão 11). */
export const PERFIL_DO_CANAL_PADRAO: PerfilDoCanal = { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null };
export const perfisPadrao = (): PerfisDoAtendente => ({
  whatsapp: { ...PERFIL_DO_CANAL_PADRAO },
  direct: { ...PERFIL_DO_CANAL_PADRAO },
  chat: { ...PERFIL_DO_CANAL_PADRAO },
  comentarios: { ...PERFIL_DO_CANAL_PADRAO },
  messenger: { ...PERFIL_DO_CANAL_PADRAO },
});

/** O nome de cada canal como a tela mostra (o rótulo do grupo e as mensagens de recusa). */
export const ROTULO_DO_CANAL: Record<CanalDoPerfil, string> = {
  whatsapp: 'WhatsApp',
  direct: 'Direct do Instagram',
  chat: 'Chat do iFood e da 99',
  comentarios: 'Comentários do Instagram',
  messenger: 'Messenger do Facebook',
};
/** Como o canal aparece nas mensagens de recusa ("Perfil do …"). */
const NOME_DO_CANAL: Record<CanalDoPerfil, string> = {
  whatsapp: 'WhatsApp',
  direct: 'Direct',
  chat: 'chat do iFood e da 99',
  comentarios: 'Instagram (comentários)',
  messenger: 'Messenger',
};

const ehPerfil = (v: unknown): v is PerfilDoAtendente => typeof v === 'string' && (PERFIS_DO_ATENDENTE as readonly string[]).includes(v);
const ehForaDoHorario = (v: unknown): v is PerfilForaDoHorario =>
  typeof v === 'string' && (PERFIS_FORA_DO_HORARIO as readonly string[]).includes(v);
const ehCanal = (v: unknown): v is CanalDoPerfil => typeof v === 'string' && (CANAIS_DO_PERFIL as readonly string[]).includes(v);
const ehObjeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** O jeito da loja numa linha só: qualquer quebra ou sequência de espaços vira um espaço. */
const umaLinha = (t: string) => t.replace(/\s+/g, ' ').trim();

// ───────────────────────── as escolhas (puras) ─────────────────────────

/**
 * O que a tela mandou para "Perfil do atendente virtual", conferido — por canal e campo, parcial (V16: o que não veio
 * fica). Pura: a rota confere ANTES de gravar qualquer grupo dos ajustes (V86). Jeito vazio = sem jeito (null); com
 * quebra de linha, uma linha só. Canal desconhecido, perfil fora da lista ou jeito longo = recusa (400), em pt-BR.
 */
export function lerPerfisDoAtendente(dto: unknown): Partial<Record<CanalDoPerfil, Partial<PerfilDoCanal>>> {
  if (dto === undefined || dto === null) return {};
  if (!ehObjeto(dto)) throw new BadRequestException('Perfil do atendente virtual: mande o perfil de cada canal.');
  const parcial: Partial<Record<CanalDoPerfil, Partial<PerfilDoCanal>>> = {};
  for (const [canal, valor] of Object.entries(dto)) {
    if (!ehCanal(canal))
      throw new BadRequestException(
        `Perfil do atendente virtual: o canal "${String(canal).slice(0, 40)}" não tem perfil (só WhatsApp, Direct, chat do iFood e da 99, comentários do Instagram e Messenger).`,
      );
    if (valor === undefined) continue;
    const nome = NOME_DO_CANAL[canal];
    if (!ehObjeto(valor)) throw new BadRequestException(`Perfil do ${nome}: mande o perfil, o de fora do horário e o jeito da loja.`);
    const p: Partial<PerfilDoCanal> = {};
    if (valor.perfil !== undefined) {
      if (!ehPerfil(valor.perfil)) throw new BadRequestException(`Perfil do ${nome}: escolha um dos perfis da lista.`);
      p.perfil = valor.perfil;
    }
    if (valor.foraDoHorario !== undefined) {
      if (!ehForaDoHorario(valor.foraDoHorario))
        throw new BadRequestException(`Fora do horário (${nome}): escolha "O mesmo" ou um dos perfis.`);
      p.foraDoHorario = valor.foraDoHorario;
    }
    if (valor.jeito !== undefined) {
      if (valor.jeito !== null && typeof valor.jeito !== 'string')
        throw new BadRequestException(`Jeito da loja (${nome}): escreva o texto (ou deixe vazio).`);
      const t = typeof valor.jeito === 'string' ? umaLinha(valor.jeito) : '';
      if (t.length > JEITO_MAX) throw new BadRequestException(`Jeito da loja (${nome}): no máximo ${JEITO_MAX} letras.`);
      p.jeito = t || null;
    }
    parcial[canal] = p;
  }
  return parcial;
}

/** O jeito que veio do banco: uma linha, até 300 letras (sem cortar um emoji ao meio); vazio ou não texto = null. */
function jeitoDaLinha(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = umaLinha(v).slice(0, JEITO_MAX).replace(/[\uD800-\uDBFF]$/, '').trim();
  return t || null;
}

/** Um canal como veio do banco, com os padrões no que faltar ou vier fora da lista. */
function canalDaLinha(v: unknown): PerfilDoCanal {
  const o = ehObjeto(v) ? v : {};
  return {
    perfil: ehPerfil(o.perfil) ? o.perfil : PERFIL_DO_CANAL_PADRAO.perfil,
    foraDoHorario: ehForaDoHorario(o.foraDoHorario) ? o.foraDoHorario : PERFIL_DO_CANAL_PADRAO.foraDoHorario,
    jeito: jeitoDaLinha(o.jeito),
  };
}

/**
 * Os perfis de uma linha do banco (`robo_config.atendente_perfis`, ou o texto JSON dela): sempre os cinco canais, com os
 * padrões no que faltar; valor estranho (lixo no jsonb, chave a mais, tipo errado) → o padrão daquele campo.
 */
export function perfisDaLinha(v: unknown): PerfisDoAtendente {
  let o: unknown = v;
  if (typeof o === 'string') {
    try {
      o = JSON.parse(o);
    } catch {
      o = null;
    }
  }
  const linha = ehObjeto(o) ? o : {};
  return {
    whatsapp: canalDaLinha(linha.whatsapp),
    direct: canalDaLinha(linha.direct),
    chat: canalDaLinha(linha.chat),
    comentarios: canalDaLinha(linha.comentarios),
    messenger: canalDaLinha(linha.messenger),
  };
}

// ───────────────────────── o texto (puro) ─────────────────────────

/** Como o bloco do perfil começa — as instruções reconhecem por ele que há um perfil (e tiram o tom fixo da abertura). */
export const MARCA_DO_PERFIL = 'PERFIL DE ATENDIMENTO (escolhido pela loja):';

/** O texto de cada perfil (exceto "Como hoje", que não acrescenta nada). */
export const TEXTO_DO_PERFIL: Record<Exclude<PerfilDoAtendente, 'hoje'>, string> = {
  profissional: `${MARCA_DO_PERFIL} PROFISSIONAL. Tom cortês e formal: frases completas, sem gírias e sem emoji. Cumprimente com "Olá" e trate o cliente por "você". Seja preciso e direto.`,
  cordial: `${MARCA_DO_PERFIL} CORDIAL. Tom educado e caloroso: cumprimente pelo nome, agradeça o contato e use no máximo 1 emoji quando combinar com o cliente.`,
  gentil: `${MARCA_DO_PERFIL} GENTIL. Tom paciente e delicado: palavras suaves, ofereça ajuda sem pressionar, explique com calma e agradeça a paciência quando o cliente esperar.`,
  descontraido: `${MARCA_DO_PERFIL} DESCONTRAÍDO. Tom leve e simpático, com a linguagem do dia a dia (sem palavrão e sem gíria que o cliente possa não entender), frases curtas e no máximo 1 emoji por mensagem. Mesmo descontraído, nunca brinque com uma reclamação.`,
  objetivo: `${MARCA_DO_PERFIL} OBJETIVO. Respostas curtas e diretas, só o essencial: a informação, o valor e o próximo passo. Sem emoji e sem conversa extra; cumprimente em poucas palavras.`,
  acolhedor: `${MARCA_DO_PERFIL} ACOLHEDOR. Tom empático e próximo: mostre que entendeu o que o cliente quer, transmita segurança ("pode deixar comigo") e ofereça ajuda até o fim do pedido.`,
};

/** Depois de qualquer perfil (≠ "Como hoje"): o perfil não mexe nas regras. */
export const LINHA_DAS_REGRAS =
  'O perfil muda só o jeito de falar: todas as regras abaixo continuam valendo. Cliente chateado: fique sério e siga as regras de cliente chateado, em qualquer perfil.';

/** O começo da linha do jeito da loja. */
export const ROTULO_DO_JEITO = 'JEITO DA LOJA (escrito pela loja, siga quando não contrariar as regras abaixo):';

/**
 * O perfil que vale AGORA no canal: fora do horário da equipe (`equipeAtendendo === false`) e com um perfil próprio para
 * isso, esse; senão, o do canal.
 */
export function perfilEmVigor(perfis: unknown, canal: CanalDoPerfil, equipeAtendendo: boolean): PerfilDoAtendente {
  const p = canalDaLinha(ehObjeto(perfis) ? perfis[canal] : undefined);
  return equipeAtendendo === false && p.foraDoHorario !== 'mesmo' ? p.foraDoHorario : p.perfil;
}

/**
 * O bloco que vai às instruções do robô, logo depois da abertura: o perfil em vigor (com a linha das regras) e o jeito da
 * loja. "Como hoje" sem jeito → '' — as instruções ficam exatamente as de hoje.
 */
export function jeitoDoAtendente(perfis: unknown, canal: CanalDoPerfil, equipeAtendendo: boolean): string {
  const perfil = perfilEmVigor(perfis, canal, equipeAtendendo);
  const jeito = canalDaLinha(ehObjeto(perfis) ? perfis[canal] : undefined).jeito;
  const partes: string[] = [];
  if (perfil !== 'hoje') partes.push(TEXTO_DO_PERFIL[perfil], LINHA_DAS_REGRAS);
  if (jeito) partes.push(`${ROTULO_DO_JEITO} ${jeito}`);
  return partes.join('\n');
}

/** O bloco traz um perfil (≠ "Como hoje")? As instruções tiram, então, o tom fixo da abertura. */
export const temPerfilNoJeito = (jeito: unknown): boolean => typeof jeito === 'string' && jeito.trim().startsWith(MARCA_DO_PERFIL);

// ───────────────────────── o banco ─────────────────────────

const linhasDe = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

/**
 * Os perfis da empresa (`robo_config.atendente_perfis`, só na nuvem). Lido pelo `to_jsonb` da linha, nunca pelo nome da
 * coluna: num banco sem a 380 (ou sem a `robo_config`) a leitura não falha — e não derruba a TRANSAÇÃO de quem chama.
 * Sem tabela, sem linha ou no servidor da loja (V1): os padrões ("Como hoje").
 */
export async function perfisDaEmpresa(db: any, tenantId: string): Promise<PerfisDoAtendente> {
  if (ehServidorLocal() || !tenantId) return perfisPadrao();
  const [tem] = linhasDe(await db.execute(sql`select to_regclass(current_schema() || '.robo_config') is not null as tem`));
  if (!tem?.tem) return perfisPadrao();
  const [l] = linhasDe(
    await db.execute(sql`select to_jsonb(rc) -> 'atendente_perfis' as perfis from robo_config rc where rc.tenant_id = ${tenantId}::uuid`),
  );
  return perfisDaLinha(l?.perfis);
}

/** Quem salva (para a gravação e a auditoria). */
export type QuemSalvaPerfis = { tenantId: string; colaboradorId: string; categoria?: string | null };
/** Uma linha de auditoria — o `AuditoriaService.registrar` (opcional: os testes montam sem ele). */
export type RegistrarAuditoria = (e: Record<string, unknown>) => Promise<unknown> | unknown;

/**
 * Salva o que veio de "Perfil do atendente virtual" (V16: ausente mantém; cada escolha só entre as opções). Grava SÓ os
 * campos que MUDARAM de cada canal, mesclando dentro do jsonb no banco (`atendente_perfis || …` e, dentro do canal,
 * `canal || {campos}`): dois salvamentos ao mesmo tempo — de canais ou de campos diferentes — não desfazem um ao outro, e
 * as outras colunas da `robo_config` (de outros donos) não são tocadas (V82). Cada mudança fica na auditoria
 * (`atendente_perfil_alterado` com canal, campo, de e para). Devolve os perfis como ficaram.
 */
export async function salvarPerfisDoAtendente(
  db: any,
  quem: QuemSalvaPerfis,
  dto: unknown,
  registrar?: RegistrarAuditoria,
): Promise<PerfisDoAtendente> {
  const parcial = lerPerfisDoAtendente(dto);
  const antes = await perfisDaEmpresa(db, quem.tenantId);
  const campos = ['perfil', 'foraDoHorario', 'jeito'] as const;
  const mudancas: Array<{ canal: CanalDoPerfil; campo: (typeof campos)[number]; de: unknown; para: unknown }> = [];
  const porCanal = new Map<CanalDoPerfil, Partial<PerfilDoCanal>>();
  for (const canal of CANAIS_DO_PERFIL) {
    const p = parcial[canal];
    if (!p) continue;
    for (const campo of campos) {
      if (p[campo] === undefined || p[campo] === antes[canal][campo]) continue;
      mudancas.push({ canal, campo, de: antes[canal][campo], para: p[campo] });
      porCanal.set(canal, { ...porCanal.get(canal), [campo]: p[campo] });
    }
  }
  if (!mudancas.length) return antes;
  // Linha nova: o canal inteiro (os padrões + o que mudou). Linha que existe: só os campos que mudaram, dentro do canal —
  // canal com lixo no jsonb (não objeto) recomeça do objeto vazio. Cada valor vai como jsonb tipado (ERR-392).
  const novo: Record<string, PerfilDoCanal> = {};
  for (const [canal, p] of porCanal) novo[canal] = { ...antes[canal], ...p };
  const mescla = sql.join(
    [...porCanal].map(
      ([canal, p]) => sql`jsonb_build_object(${canal}::text,
        case when jsonb_typeof(robo_config.atendente_perfis -> ${canal}::text) = 'object'
             then robo_config.atendente_perfis -> ${canal}::text else '{}'::jsonb end || ${JSON.stringify(p)}::jsonb)`,
    ),
    sql` || `,
  );
  await db.execute(sql`
    insert into robo_config (tenant_id, atendente_perfis, atualizado_por)
    values (${quem.tenantId}::uuid, ${JSON.stringify(novo)}::jsonb, ${quem.colaboradorId}::uuid)
    on conflict (tenant_id) do update
       set atendente_perfis = robo_config.atendente_perfis || ${mescla},
           atualizado_por = excluded.atualizado_por, atualizado_em = now()`);
  for (const m of mudancas)
    await registrar?.({
      tenantId: quem.tenantId,
      atorId: quem.colaboradorId,
      atorPerfil: quem.categoria,
      tipo: 'config',
      acao: 'atendente_perfil_alterado',
      entidadeTipo: 'robo_config',
      entidadeId: quem.tenantId,
      detalhe: { canal: m.canal, campo: m.campo, de: m.de, para: m.para },
    });
  return perfisDaEmpresa(db, quem.tenantId);
}
