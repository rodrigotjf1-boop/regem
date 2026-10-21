import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { enviarEmail } from '../../common/mailer';
import { CLIENTES_INTEGRACAO } from './escopos';

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
    'Você não precisa fazer nada. O acesso continua em Integrações › Aplicativos conectados, onde você vê o que ele recebe e desliga quando quiser.',
    'Não reconhece este acesso? Desligue-o nessa mesma tela.',
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
    const presidentes = await rows(sql`
      select distinct on (lower(trim(c.email))) c.nome, trim(c.email) as email
        from colaborador c
        left join funcao f on f.id = c.funcao_id
        left join perfil_acesso pa on pa.id = c.perfil_acesso_id
       where c.tenant_id = ${d.tenantId}::uuid and c.deleted_at is null and c.status is distinct from 'bloqueado'
         and coalesce(pa.nivel::text, f.categoria::text, 'execucao') = 'presidente'
         and coalesce(trim(c.email), '') <> ''
       order by lower(trim(c.email)), c.nome
       limit 20`);
    const destinos = presidentes.filter((p) => EMAIL.test(String(p.email)));
    if (!onde || !destinos.length) {
      log.warn(`aviso da ligação nova do ${aplicativo} não saiu: a empresa ${d.tenantId.slice(0, 8)} não tem presidente com e-mail`);
      return;
    }
    const fuso = String(onde.fuso ?? 'America/Sao_Paulo');
    const link = `${(process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/+$/, '')}/integracoes`;
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
