import { sql } from 'drizzle-orm';
import {
  NIVEIS_DO_GESTOR_WA,
  ehPararAvisos,
  ehVerPorAqui,
  ehVoltarAvisos,
  finalDoNumero,
  lerCodigoDeLigar,
  textoDeLigado,
} from './gestor-whatsapp';
import { ehRespostaDeDecisao } from './gestor-whatsapp-decisao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ENTRADA DO GESTOR NO WHATSAPP DA LOJA (mig 375). Chamada pela entrada da API oficial e pela da Evolution ANTES de
// qualquer outro portão e antes de gravar a mensagem na caixa de conversas: o que é resposta aos avisos (o código de
// ligar, PARAR AVISOS, VOLTAR AVISOS, o "Ver por aqui" do modelo, o botão ou a enquete de uma decisão) não vai ao robô nem
// vira conversa de cliente. O resto que o gestor escreve segue o caminho de sempre — quem testa o robô pelo próprio
// celular continua sendo atendido. Uma palavra dessas vinda de quem não é gestor ligado também segue o caminho de sempre
// (o código de ligar não: ele responde).
// Ligar e PARAR/VOLTAR se resolvem aqui (só o banco). O "Ver por aqui" e a resposta a uma decisão vão ao serviço do
// gestor (`gestor-whatsapp.service.ts`) pelo evento `gestor.whatsapp.resposta`: é ele que confere quem decide, executa
// pelo mesmo caminho da tela e responde — a entrada do WhatsApp não depende do módulo do atendimento.
// Nunca lança: falhou, a mensagem segue o caminho de sempre (e o motivo vai ao log de quem chamou).

export const EVENTO_RESPOSTA_DO_GESTOR = 'gestor.whatsapp.resposta';
export type RespostaDoGestor = {
  tenantId: string;
  telefone: string;
  colaboradorId: string;
  tipo: 'ver' | 'decisao';
  texto: string;
  opcaoId: string | null;
};

export type EntradaDoGestor = { tenantId: string; telefone: string; texto: string; opcaoId?: string | null; idMensagem?: string | null };
export type Enviar = (texto: string) => Promise<unknown>;
export type Emitir = (evento: string, payload: RespostaDoGestor) => unknown;
export type Auditar = (e: {
  tenantId: string;
  atorId?: string;
  atorPerfil?: string;
  tipo: string;
  acao: string;
  entidadeTipo?: string;
  entidadeId?: string;
  detalhe?: any;
  origem?: string;
}) => Promise<unknown>;

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const niveis = sql.join(NIVEIS_DO_GESTOR_WA.map((n) => sql`${n}`), sql`, `);

// A Meta reenvia a mensagem quando o 200 demora: a mesma mensagem não responde duas vezes (10 min de memória; com mais
// de uma réplica, o reenvio pode cair em outra — o custo é uma resposta repetida, nunca uma decisão em dobro: a decisão
// grava cada passo com condição).
const vistas = new Map<string, number>();
function jaVista(id: string | null | undefined): boolean {
  const k = String(id ?? '').trim();
  if (!k) return false;
  const agora = Date.now();
  const ate = vistas.get(k);
  if (ate && ate > agora) return true;
  vistas.set(k, agora + 10 * 60_000);
  if (vistas.size > 5_000) for (const [c, v] of vistas) if (v <= agora) vistas.delete(c);
  return false;
}

/** O nome da loja nas respostas (o nome público do cardápio; sem ele, o da empresa). */
async function nomeDaLoja(db: any, tenantId: string): Promise<string> {
  const r = await db.execute(sql`
    select coalesce(nullif(trim(cc.nome_publico), ''), e.nome) as nome
      from empresa e left join cardapio_config cc on cc.tenant_id = e.id
     where e.id = ${tenantId}::uuid limit 1`);
  return String(linhas(r)[0]?.nome ?? 'loja');
}

/**
 * Trata a mensagem se for do gestor e responder aos avisos. `true` = tratada (não segue); `false` = segue o caminho de
 * sempre. `enviar` responde pela MESMA via que recebeu; `emitir` entrega ao serviço do gestor o que é dele.
 */
export async function portaoDoGestor(db: any, e: EntradaDoGestor, enviar: Enviar, auditar?: Auditar, emitir?: Emitir): Promise<boolean> {
  const tel = soDigitos(e.telefone);
  if (!tel || !e.tenantId) return false;
  const texto = String(e.texto ?? '');
  const opcaoId = String(e.opcaoId ?? '') || null;
  const codigo = lerCodigoDeLigar(texto);
  const decisao = ehRespostaDeDecisao(texto, opcaoId);
  const comando = !!codigo || ehPararAvisos(texto) || ehVoltarAvisos(texto) || ehVerPorAqui(texto) || decisao;
  // Mensagem comum (a de quase todo cliente): nem consulta o banco — a entrada de cada mensagem não pode pagar por isso.
  // A janela de 24 h dela fica na caixa de conversas, como sempre (o envio ao gestor olha as duas).
  if (!comando) return false;

  if (codigo) {
    if (jaVista(e.idMensagem)) return true;
    return ligar(db, e.tenantId, tel, codigo, enviar, auditar);
  }

  // O número é de um gestor ligado? (o mesmo número, como o provedor entrega — é o que ficou gravado ao ligar).
  const [g] = linhas(
    await db.execute(sql`
      select g.id, g.colaborador_id as "colaboradorId", g.pausado_em as "pausadoEm", c.nome
        from gestor_whatsapp g join colaborador c on c.id = g.colaborador_id
       where g.tenant_id = ${e.tenantId}::uuid and g.telefone = ${tel} and g.ligado_em is not null
       limit 1`),
  );
  if (!g) return false;
  // A mensagem dele abre a janela de 24 h da API oficial (o texto livre volta a valer).
  await db.execute(sql`update gestor_whatsapp set ultima_entrada_em = now() where id = ${g.id}::uuid`);
  if (jaVista(e.idMensagem)) return true;
  const primeiro = String(g.nome ?? '').trim().split(/\s+/)[0] || 'tudo certo';

  if (ehPararAvisos(texto)) {
    await db.execute(sql`update gestor_whatsapp set pausado_em = coalesce(pausado_em, now()), atualizado_em = now() where id = ${g.id}::uuid`);
    await auditar?.({ tenantId: e.tenantId, atorId: g.colaboradorId, tipo: 'config', acao: 'gestor_whatsapp_parou', entidadeTipo: 'gestor_whatsapp', entidadeId: g.id, origem: 'whatsapp', detalhe: { final: finalDoNumero(tel) } });
    await enviar(`Certo, ${primeiro}: este WhatsApp não recebe mais os avisos do atendimento. Para voltar, responda VOLTAR AVISOS.`);
    return true;
  }
  if (ehVoltarAvisos(texto)) {
    await db.execute(sql`update gestor_whatsapp set pausado_em = null, atualizado_em = now() where id = ${g.id}::uuid`);
    await auditar?.({ tenantId: e.tenantId, atorId: g.colaboradorId, tipo: 'config', acao: 'gestor_whatsapp_voltou', entidadeTipo: 'gestor_whatsapp', entidadeId: g.id, origem: 'whatsapp', detalhe: { final: finalDoNumero(tel) } });
    await enviar(`Voltou, ${primeiro}: este WhatsApp recebe de novo os avisos do atendimento.`);
    return true;
  }
  // "Ver por aqui" (o botão do modelo) e a resposta a uma decisão: o serviço do gestor confere, executa e responde.
  if (!emitir) {
    await enviar('Não deu para tratar agora. Abra o caso no Regem.');
    return true;
  }
  emitir(EVENTO_RESPOSTA_DO_GESTOR, { tenantId: e.tenantId, telefone: tel, colaboradorId: g.colaboradorId, tipo: decisao ? 'decisao' : 'ver', texto, opcaoId });
  return true;
}

/** O código que o Regem mostrou: liga ESTE número a quem pediu o código, se ainda pode (V75: acesso vivo e nível). */
async function ligar(db: any, tenantId: string, tel: string, codigo: string, enviar: Enviar, auditar?: Auditar): Promise<boolean> {
  // O número ainda preso a quem saiu (excluído, bloqueado, desligado ou sem o nível) fica livre: senão ele nunca mais
  // ligaria a outra pessoa da loja.
  await db.execute(sql`
    update gestor_whatsapp g set telefone = null, ligado_em = null, pausado_em = null, atualizado_em = now()
     where g.tenant_id = ${tenantId}::uuid and g.telefone = ${tel}
       and not exists (
         select 1 from colaborador c
           left join funcao f on f.id = c.funcao_id
           left join perfil_acesso p on p.id = c.perfil_acesso_id
          where c.id = g.colaborador_id and c.deleted_at is null and c.status = 'ativo'
            and coalesce(p.nivel, f.categoria::text) in (${niveis}))`);
  let ligado: any;
  try {
    [ligado] = linhas(
      await db.execute(sql`
        update gestor_whatsapp g
           set telefone = ${tel}, ligado_em = now(), pausado_em = null, codigo = null, codigo_expira_em = null,
               ultima_entrada_em = now(), atualizado_em = now()
          from colaborador c
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
         where g.tenant_id = ${tenantId}::uuid and g.codigo = ${codigo} and g.codigo_expira_em > now()
           and c.id = g.colaborador_id and c.tenant_id = g.tenant_id and c.deleted_at is null and c.status = 'ativo'
           and coalesce(p.nivel, f.categoria::text) in (${niveis})
           and exists (select 1 from empresa emp where emp.id = g.tenant_id and emp.deleted_at is null)
        returning g.id, g.colaborador_id as "colaboradorId", c.nome`),
    );
  } catch (err: any) {
    if (err?.code !== '23505') throw err;
    // O número já está ligado a OUTRA pessoa da empresa (um número, uma pessoa).
    await enviar(
      'Este número já está ligado a outra pessoa no Regem desta loja. Para ligar a você, ela desliga primeiro em Delivery › Configurações › Atendimento, grupo "Gerente no WhatsApp".',
    );
    return true;
  }
  if (!ligado) {
    // Já ligado com este número há pouco: é a mesma mensagem chegando de novo — não responde outra vez.
    const [recente] = linhas(
      await db.execute(sql`
        select 1 from gestor_whatsapp
         where tenant_id = ${tenantId}::uuid and telefone = ${tel} and ligado_em > now() - interval '10 minutes' limit 1`),
    );
    if (!recente)
      await enviar('Este código não vale mais. Gere outro no Regem, em Delivery › Configurações › Atendimento, grupo "Gerente no WhatsApp".');
    return true;
  }
  await auditar?.({
    tenantId,
    atorId: ligado.colaboradorId,
    tipo: 'config',
    acao: 'gestor_whatsapp_ligado',
    entidadeTipo: 'gestor_whatsapp',
    entidadeId: ligado.id,
    origem: 'whatsapp',
    detalhe: { final: finalDoNumero(tel) },
  });
  await enviar(textoDeLigado(ligado.nome, await nomeDaLoja(db, tenantId)));
  return true;
}
