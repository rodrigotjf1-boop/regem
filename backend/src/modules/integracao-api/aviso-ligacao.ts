import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { enviarEmail } from '../../common/mailer';
import { APLICATIVOS_DO_CLIQUE, PERMISSAO_NA_TELA, cnpjComMascara, naOrdemDoCatalogo, noAssuntoDe } from './autorizacao-clique.regras';
import { listaNaFrase } from './autorizacao-clique.tela';
import { CLIENTES_INTEGRACAO, type EscopoIntegracao } from './escopos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O AVISO AO DONO quando uma ligação do Hub DMS nasce sozinha de um token antigo (Padrão DMS §3, decisão B1-4):
// por e-mail, que não se desliga. O alcance não muda — a ligação é outra forma de apresentar o MESMO acesso, com os
// mesmos escopos —, mas o dono fica sabendo que a forma mudou e onde desliga. Vai para os presidentes ativos da
// empresa que têm e-mail (no Regem, quem autoriza integração é o presidente).
//
// Nada aqui lança (V3): quem chama faz `void` depois de gravar. O aviso perdido vira linha de log com o motivo, nunca
// uma ligação desfeita.

const log = new Logger('AvisoDeLigacao');
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

export type LigacaoNova = {
  tenantId: string;
  unidadeId: string | null;
  cliente: string;
  /** Quando a loja liberou o acesso (a criação do token). */
  liberadoEm: Date;
  /** Quando a ligação nasceu. */
  desde: Date;
};

const escapar = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** O e-mail (assunto, texto e HTML) — exportado para o teste. */
export function emailDaLigacaoNova(d: {
  nome: string;
  aplicativo: string;
  loja: string | null;
  desde: string;
  liberadoEm: string;
  link: string;
}) {
  const primeiroNome = d.nome.trim().split(/\s+/)[0] || d.nome.trim() || 'Olá';
  const onde = d.loja ? `à loja ${d.loja}` : 'à sua empresa';
  const assunto = `O acesso do ${d.aplicativo} ${onde} mudou de forma`;
  const paragrafos = [
    `${primeiroNome}, desde ${d.desde} o ${d.aplicativo} lê ${d.loja ? `a loja ${d.loja}` : 'a sua empresa'} no Regem por uma ligação nova, conferida pelo DMS ID da DMS Tecnologias. Ele continua vendo só o que foi liberado em ${d.liberadoEm}.`,
    // O caminho e o verbo são os do menu e do botão do Regem (Configurações › Aplicativos conectados, "Revogar"),
    // não os do RegemCast, de onde o texto veio (ERR-269).
    'Você não precisa fazer nada. O acesso continua em Configurações › Aplicativos conectados, onde você vê o que ele recebe e revoga quando quiser.',
    'Não reconhece este acesso? Revogue-o nessa mesma tela.',
  ];
  const texto = `${paragrafos.join('\n\n')}\n\nAplicativos conectados: ${d.link}`;
  const html = `
  <div style="background:#0B1220;padding:32px 0;font-family:Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#0F1A2E;border:1px solid #243150;border-radius:16px;overflow:hidden">
      <div style="padding:28px 32px;border-bottom:1px solid #243150">
        <span style="color:#EDF1F8;font-size:20px;font-weight:700">Regem</span>
        <span style="color:#909CB4;font-size:12px;letter-spacing:.14em;text-transform:uppercase;display:block;margin-top:4px">Aplicativos conectados</span>
      </div>
      <div style="padding:32px">
        ${paragrafos.map((p) => `<p style="color:#EDF1F8;font-size:15px;line-height:1.5;margin:0 0 16px">${escapar(p)}</p>`).join('\n        ')}
        <a href="${escapar(d.link)}" style="display:inline-block;background:#E2A340;color:#0F2230;font-weight:700;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:10px">Ver aplicativos conectados</a>
      </div>
    </div>
  </div>`;
  return { assunto, texto, html };
}

/** "20/10/2026", no fuso da loja. */
const dataNoFuso = (d: Date, fuso: string) => {
  try {
    return d.toLocaleDateString('pt-BR', { timeZone: fuso });
  } catch {
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }
};

/** Os presidentes ativos da empresa com e-mail válido (até 20, um por endereço). */
async function presidentesComEmail(db: any, tenantId: string): Promise<{ nome: string; email: string }[]> {
  const r: any = await db.execute(sql`
    select distinct on (lower(trim(c.email))) c.nome, trim(c.email) as email
      from colaborador c
      left join funcao f on f.id = c.funcao_id
      left join perfil_acesso pa on pa.id = c.perfil_acesso_id
     where c.tenant_id = ${tenantId}::uuid and c.deleted_at is null and c.status is distinct from 'bloqueado'
       and coalesce(pa.nivel::text, f.categoria::text, 'execucao') = 'presidente'
       and coalesce(trim(c.email), '') <> ''
     order by lower(trim(c.email)), c.nome
     limit 20`);
  return ((r.rows ?? r) as any[])
    .filter((p) => EMAIL.test(String(p.email)))
    .map((p) => ({ nome: String(p.nome ?? ''), email: String(p.email) }));
}

const linkDosAplicativos = () => `${(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '')}/integracoes`;

/**
 * Manda o aviso da ligação nova aos presidentes da empresa (e-mail). Nunca rejeita. `enviar` é a função do e-mail
 * (o teste troca).
 */
export async function avisarLigacaoNova(db: any, d: LigacaoNova, enviar: typeof enviarEmail = enviarEmail): Promise<void> {
  try {
    const aplicativo = CLIENTES_INTEGRACAO[d.cliente]?.rotulo ?? d.cliente;
    const rows = async (q: any) => {
      const r: any = await db.execute(q);
      return (r.rows ?? r) as any[];
    };
    const [onde] = await rows(sql`
      select u.nome as loja, coalesce(nullif(u.timezone, ''), 'America/Sao_Paulo') as fuso
        from empresa e
        left join unidade u on u.id = ${d.unidadeId}::uuid and u.tenant_id = e.id
       where e.id = ${d.tenantId}::uuid`);
    const destinos = await presidentesComEmail(db, d.tenantId);
    if (!onde || !destinos.length) {
      log.warn(`aviso da ligação nova do ${aplicativo} não saiu: a empresa ${d.tenantId.slice(0, 8)} não tem presidente com e-mail`);
      return;
    }
    const fuso = String(onde.fuso ?? 'America/Sao_Paulo');
    const link = linkDosAplicativos();
    await Promise.all(
      destinos.map(async (p) => {
        const e = emailDaLigacaoNova({
          nome: String(p.nome ?? ''),
          aplicativo,
          loja: d.unidadeId ? (onde.loja ?? null) : null,
          desde: dataNoFuso(d.desde, fuso),
          liberadoEm: dataNoFuso(d.liberadoEm, fuso),
          link,
        });
        const ok = await enviar(String(p.email), e.assunto, e.html, e.texto).catch(() => false);
        if (!ok) log.warn(`aviso da ligação nova do ${aplicativo} não saiu para um presidente da empresa ${d.tenantId.slice(0, 8)}`);
      }),
    );
  } catch (erro: any) {
    log.warn(`aviso da ligação nova não saiu (empresa ${d.tenantId.slice(0, 8)}): ${erro?.message ?? erro}`);
  }
}

// ───────────────────────────── a autorização por clique (Hub DMS, F3, parte C) ─────────────────────────────
//
// Os e-mails aos presidentes depois da troca do código (a ligação só existe a partir dela): "foi autorizado" para as
// lojas que não tinham acesso e "passou a receber" para a loja que ganhou permissão. Renovar com as mesmas permissões
// (ou menos) não manda nada. Textos aprovados pelo dono em 21/10/2026 (C-5), com "com a própria senha" no lugar de
// "com a senha dele": o presidente pode ser qualquer pessoa.

/** Um pedaço de parágrafo: texto, ou texto em negrito. */
type Parte = string | { b: string };

const RODAPE_DO_AVISO = (empresa: string) =>
  `Este aviso não se desliga: ele protege a sua empresa. Vai para todos os presidentes da ${empresa}.`;

function emailDoAviso(assunto: string, paragrafos: Parte[][], link: string, rodape: string) {
  const plano = (p: Parte[]) => p.map((x) => (typeof x === 'string' ? x : x.b)).join('');
  const rico = (p: Parte[]) => p.map((x) => (typeof x === 'string' ? escapar(x) : `<b>${escapar(x.b)}</b>`)).join('');
  const texto = `${paragrafos.map(plano).join('\n\n')}\n\nAplicativos conectados: ${link}\n\n${rodape}`;
  const html = `
  <div style="background:#0B1220;padding:32px 0;font-family:Helvetica,Arial,sans-serif">
    <div style="max-width:520px;margin:0 auto;background:#0F1A2E;border:1px solid #243150;border-radius:16px;overflow:hidden">
      <div style="padding:28px 32px;border-bottom:1px solid #243150">
        <span style="color:#EDF1F8;font-size:20px;font-weight:700">Regem</span>
        <span style="color:#909CB4;font-size:12px;letter-spacing:.14em;text-transform:uppercase;display:block;margin-top:4px">Aplicativos conectados</span>
      </div>
      <div style="padding:32px">
        ${paragrafos.map((p) => `<p style="color:#EDF1F8;font-size:15px;line-height:1.5;margin:0 0 16px">${rico(p)}</p>`).join('\n        ')}
        <a href="${escapar(link)}" style="display:inline-block;background:#E2A340;color:#0F2230;font-weight:700;font-size:14px;text-decoration:none;padding:12px 20px;border-radius:10px">Ver aplicativos conectados</a>
        <p style="color:#A3AEC4;font-size:13px;line-height:1.5;margin:20px 0 0">${escapar(rodape)}</p>
      </div>
    </div>
  </div>`;
  return { assunto, texto, html };
}

const primeiro = (nome: string) => nome.trim().split(/\s+/)[0] || nome.trim() || 'Olá';
const emMinusculas = (ids: readonly EscopoIntegracao[]) =>
  ids.map((id) => {
    const r = PERMISSAO_NA_TELA[id]?.rotulo ?? id;
    return r.charAt(0).toLowerCase() + r.slice(1);
  });

/** O e-mail da loja (ou das lojas) que o aplicativo passou a ler — exportado para o teste. */
export function emailDaAutorizacaoNova(d: {
  nome: string;
  aplicativo: string;
  lojas: readonly string[];
  hora: string;
  data: string;
  por: string;
  conta: { nome: string; cnpj: string | null };
  pode: readonly EscopoIntegracao[];
  desligado: readonly EscopoIntegracao[];
  naoPode: string;
  empresa: string;
  link: string;
}) {
  const uma = d.lojas.length === 1;
  const lojas = listaNaFrase(d.lojas);
  const assunto = `O ${d.aplicativo} foi autorizado ${uma ? `na loja ${lojas}` : `nas lojas ${lojas}`}`;
  const paragrafos: Parte[][] = [
    [
      `${primeiro(d.nome)}, às ${d.hora} de ${d.data} o ${d.por} (presidente) autorizou o ${d.aplicativo} a ler ${uma ? `a loja ${lojas}` : `as lojas ${lojas}`} no Regem, com a própria senha. ` +
        `O pedido veio da conta ${d.conta.nome} no ${d.aplicativo} (${d.conta.cnpj ? `CNPJ ${d.conta.cnpj}` : 'sem CNPJ informado'}).`,
    ],
    [{ b: `O ${d.aplicativo} pode ver:` }, ` ${listaNaFrase(emMinusculas(d.pode))}.`],
  ];
  if (d.desligado.length) paragrafos.push([{ b: 'Ficou desligado:' }, ` ${listaNaFrase(emMinusculas(d.desligado))}.`]);
  paragrafos.push([d.naoPode]);
  paragrafos.push([
    { b: 'Foi alguém da sua empresa?' },
    ' Não precisa fazer nada. ',
    { b: 'Não reconhece?' },
    ' Revogue agora em Configurações › Aplicativos conectados.',
  ]);
  return emailDoAviso(assunto, paragrafos, d.link, RODAPE_DO_AVISO(d.empresa));
}

/** O e-mail da permissão a mais numa loja que já tinha acesso — exportado para o teste. */
export function emailDaPermissaoAMais(d: {
  nome: string;
  aplicativo: string;
  loja: string;
  hora: string;
  data: string;
  por: string;
  novas: readonly EscopoIntegracao[];
  resto: readonly EscopoIntegracao[];
  empresa: string;
  link: string;
}) {
  const assunto = `O ${d.aplicativo} passou a receber ${listaNaFrase(d.novas.map(noAssuntoDe))} na ${d.loja}`;
  const naFrase = listaNaFrase(d.novas.map((id) => PERMISSAO_NA_TELA[id]?.naFrase ?? id));
  const paragrafos: Parte[][] = [
    [`${primeiro(d.nome)}, às ${d.hora} de ${d.data} o ${d.por} (presidente) liberou para o ${d.aplicativo} ${naFrase}, na loja ${d.loja}, com a própria senha.`],
    ...d.novas.map((id): Parte[] => [PERMISSAO_NA_TELA[id]?.frase ?? id]),
  ];
  if (d.resto.length) paragrafos.push([`O resto continua como estava: ${listaNaFrase(emMinusculas(d.resto))}.`]);
  paragrafos.push([{ b: 'Não reconhece?' }, ' Revogue agora em Configurações › Aplicativos conectados.']);
  return emailDoAviso(assunto, paragrafos, d.link, RODAPE_DO_AVISO(d.empresa));
}

export type AutorizacaoPorClique = {
  tenantId: string;
  cliente: string;
  porNome: string;
  autorizacaoId: string;
  /** Cada loja ligada na troca: o que ela recebe agora e o que tinha antes (nulo = não tinha acesso). */
  lojas: readonly { id: string; nome: string; escopos: readonly EscopoIntegracao[]; antes: readonly EscopoIntegracao[] | null }[];
};

/** "10:20" e "04/11/2026", no fuso da loja. */
const horaEData = (d: Date, fuso: string): { hora: string; data: string } => {
  const f = (o: Intl.DateTimeFormatOptions) => {
    try {
      return d.toLocaleString('pt-BR', { ...o, timeZone: fuso });
    } catch {
      return d.toLocaleString('pt-BR', { ...o, timeZone: 'America/Sao_Paulo' });
    }
  };
  return { hora: f({ hour: '2-digit', minute: '2-digit', hour12: false }), data: f({ day: '2-digit', month: '2-digit', year: 'numeric' }) };
};

/**
 * Os e-mails da autorização por clique aos presidentes da empresa. Nunca rejeita (V3): quem chama faz `void` depois da
 * troca. `enviar` é a função do e-mail (o teste troca).
 */
export async function avisarAutorizacaoPorClique(db: any, d: AutorizacaoPorClique, enviar: typeof enviarEmail = enviarEmail): Promise<void> {
  try {
    const novas = d.lojas.filter((l) => !l.antes);
    const mais = d.lojas
      .filter((l) => l.antes)
      .map((l) => ({ ...l, ganhou: naOrdemDoCatalogo(l.escopos.filter((e) => !(l.antes as readonly string[]).includes(e))) }))
      .filter((l) => l.ganhou.length);
    if (!novas.length && !mais.length) return;
    const rows = async (q: any) => {
      const r: any = await db.execute(q);
      return (r.rows ?? r) as any[];
    };
    const [a] = await rows(sql`
      select a.criado_em, a.conta_que_pede, a.opcionais_desligados, e.nome as empresa,
             (select coalesce(nullif(u.timezone, ''), 'America/Sao_Paulo') from unidade u
               where u.id = ${d.lojas[0]?.id ?? null}::uuid) as fuso
        from integracao_autorizacao a join empresa e on e.id = a.tenant_id
       where a.id = ${d.autorizacaoId}::uuid and a.tenant_id = ${d.tenantId}::uuid`);
    const destinos = await presidentesComEmail(db, d.tenantId);
    const aplicativo = APLICATIVOS_DO_CLIQUE[d.cliente]?.nome ?? CLIENTES_INTEGRACAO[d.cliente]?.rotulo ?? d.cliente;
    if (!a || !destinos.length) {
      log.warn(`aviso da autorização do ${aplicativo} não saiu: a empresa ${d.tenantId.slice(0, 8)} não tem presidente com e-mail`);
      return;
    }
    const { hora, data } = horaEData(new Date(a.criado_em), String(a.fuso ?? 'America/Sao_Paulo'));
    const empresa = String(a.empresa ?? '');
    const link = linkDosAplicativos();
    const conta = { nome: String(a.conta_que_pede?.nome ?? ''), cnpj: cnpjComMascara(a.conta_que_pede?.cnpj ?? null) };
    const desligado = naOrdemDoCatalogo(a.opcionais_desligados ?? []);
    const naoPode = APLICATIVOS_DO_CLIQUE[d.cliente]?.naoPodeNoEmail ?? '';
    const emails: { assunto: string; texto: string; html: string; para: { nome: string; email: string } }[] = [];
    for (const p of destinos) {
      if (novas.length) {
        const pode = naOrdemDoCatalogo(novas.flatMap((l) => l.escopos));
        emails.push({
          para: p,
          ...emailDaAutorizacaoNova({ nome: p.nome, aplicativo, lojas: novas.map((l) => l.nome), hora, data, por: d.porNome, conta, pode, desligado, naoPode, empresa, link }),
        });
      }
      for (const l of mais) {
        const resto = naOrdemDoCatalogo((l.antes as readonly string[]).filter((e) => l.escopos.includes(e as EscopoIntegracao)));
        emails.push({
          para: p,
          ...emailDaPermissaoAMais({ nome: p.nome, aplicativo, loja: l.nome, hora, data, por: d.porNome, novas: l.ganhou, resto, empresa, link }),
        });
      }
    }
    await Promise.all(
      emails.map(async (e) => {
        const ok = await enviar(e.para.email, e.assunto, e.html, e.texto).catch(() => false);
        if (!ok) log.warn(`aviso da autorização do ${aplicativo} não saiu para um presidente da empresa ${d.tenantId.slice(0, 8)}`);
      }),
    );
  } catch (erro: any) {
    log.warn(`aviso da autorização por clique não saiu (empresa ${d.tenantId.slice(0, 8)}): ${erro?.message ?? erro}`);
  }
}
