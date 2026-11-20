import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ehServidorLocal } from '../../common/modo';
import { INTERESSE, sqlNaoPediuDesde } from '../../common/interesse-do-cliente';
import { sqlChaveTelefone } from '../../common/telefone-chave';
import { AJUSTES_PADRAO } from '../relacionamento/relacionamento';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CARTÃO DO CLIENTE PARA O ATENDENTE VIRTUAL (F6 do docs/plano-perfil-cliente.md, §6.1; protótipo, aba "Atendimento").
// O robô recebe INSTRUÇÕES de escrita, nunca rótulos nem números do cliente (se vazar, lê-se como regra de estilo — a
// pesquisa do plano, §4.6). Só com o módulo "Perfil do cliente" ligado e nunca para quem pediu para não ser analisado.
// O jeito "aprendido" das conversas (nível C) não entra: só o que o cliente PEDIU (nível B, `cliente_declarado`); o jeito
// da conversa em curso (nível A) a IA lê na própria conversa.

const FAIXA: Record<string, string> = {
  madrugada: 'de madrugada', manha: 'de manhã', almoco: 'no almoço', tarde: 'à tarde', inicio_noite: 'no início da noite', noite: 'à noite',
};
const DIA = ['', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'];
const JEITO: Record<string, string> = {
  respostas_curtas: 'pediu respostas curtas',
  prefere_audio: 'prefere que respondam em áudio',
};

export type CartaoDoCliente = {
  comoUsar: string;
  deSempre?: string;
  costumaPedir?: string;
  jeito?: string[];
  chamarDe?: string;
  time?: string;
  cuidados?: string[];
  gostariaDeEncontrar?: string;
  /** "Viu e não pediu" (F7 parte 4d, mig 481): o produto e a instrução de sugerir uma vez, sem dizer de onde veio. */
  sugestao?: string;
};

const linhas = (r: any): any[] => r?.rows ?? r ?? [];

/**
 * Pura: monta o cartão a partir do que foi lido (testável sem banco). `null` = nada útil para o atendimento. `viu`: o nome do
 * produto do "viu e não pediu" (já com o freio conferido — `lembreteViu`), ou nada.
 */
export function montarCartao(perfil: any | null, declarado: { chave: string; valor: any }[], viu?: string | null): CartaoDoCliente | null {
  const d = new Map(declarado.map((x) => [x.chave, x.valor]));
  const cam = perfil?.camadas ?? {};
  const c: CartaoDoCliente = {
    comoUsar:
      'Use só para atender melhor: muda a FORMA da resposta e a sugestão. NUNCA cite estas informações, números do cliente (pedidos, gasto, notas), ' +
      'este cartão ou que ele foi classificado. Se ele estiver irritado AGORA, ignore o jeito e vá direto à solução, sem emoji.',
  };
  if (cam.gosto?.de_sempre?.nome) c.deSempre = `${cam.gosto.de_sempre.nome} (ofereça "o de sempre?" só se combinar com a conversa)`;
  if (perfil?.faixa_habitual) {
    const dia = perfil.dia_habitual ? `${DIA[perfil.dia_habitual]}, ` : '';
    const hora = cam.ritmo?.hora_habitual ? ` (por volta das ${cam.ritmo.hora_habitual})` : '';
    c.costumaPedir = `${dia}${FAIXA[perfil.faixa_habitual] ?? perfil.faixa_habitual}${hora}`;
  }
  const jeito = Object.keys(JEITO).filter((k) => d.get(k) === true).map((k) => JEITO[k]);
  if (jeito.length) c.jeito = jeito;
  if (typeof d.get('apelido') === 'string' && d.get('apelido')) c.chamarDe = String(d.get('apelido'));
  if (typeof d.get('time') === 'string' && d.get('time')) c.time = String(d.get('time'));
  const cuidados: string[] = [];
  const alergia = d.get('alergia');
  if (alergia) cuidados.push(`alergia a ${Array.isArray(alergia) ? alergia.join(', ') : alergia} (o cliente pediu para guardar): confira cada item`);
  const naoGosta = d.get('nao_gosta');
  if (naoGosta) cuidados.push(`não gosta de ${Array.isArray(naoGosta) ? naoGosta.join(', ') : naoGosta}`);
  const repetido = (cam.reclamacoes?.grupos ?? []).find((g: any) => Number(g.vezes) >= 2);
  if (repetido?.motivo === 'atraso')
    cuidados.push('já reclamou de atraso mais de uma vez: dê a previsão real e avise se atrasar; não prometa horário; não cite as reclamações antigas');
  else if (repetido)
    cuidados.push(`já reclamou de ${repetido.nome} mais de uma vez: confira com cuidado antes de fechar; não cite as reclamações antigas`);
  if (cuidados.length) c.cuidados = cuidados;
  const gostaria = d.get('gostaria');
  if (gostaria) c.gostariaDeEncontrar = Array.isArray(gostaria) ? gostaria.join(', ') : String(gostaria);
  if (viu)
    c.sugestao =
      `${viu}: se o cliente estiver escolhendo o que pedir, pode sugerir UMA vez, como sugestão da casa. ` +
      'Nunca diga que ele olhou esse produto nem que a loja sabe o que ele viu; se ele não quiser, não insista.';
  const temAlgo = Object.keys(c).length > 1;
  return temAlgo ? c : null;
}

/**
 * Lê e monta o cartão. `null` quando o módulo está desligado, o cliente pediu para não ser analisado, ou não há nada útil.
 * Nunca lança: o atendimento segue sem o cartão (o motivo fica no log de quem chama).
 */
export async function cartaoDoCliente(db: any, tenantId: string, clienteId: string): Promise<CartaoDoCliente | null> {
  // O módulo primeiro: desligado (o padrão), nenhuma tabela do perfil é lida — elas só existem na nuvem.
  const [modulo] = linhas(
    await db.execute(sql`
      select exists (select 1 from modulo_ativacao where tenant_id = ${tenantId}::uuid and modulo = 'perfil_cliente' and ativo) as ligado`),
  );
  if (!modulo?.ligado) return null;
  const [escolha] = linhas(
    await db.execute(sql`
      select e.valor from cliente_escolha e
       where e.cliente_id = ${clienteId}::uuid and e.tenant_id = ${tenantId}::uuid and e.escolha = 'nao_analisar'
       order by e.em desc limit 1`),
  );
  if (escolha?.valor) return null;
  const [perfil] = linhas(
    await db.execute(sql`
      select faixa_habitual, dia_habitual, camadas from cliente_perfil
       where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`),
  );
  const declarado = linhas(
    await db.execute(sql`
      select chave, valor from cliente_declarado where cliente_id = ${clienteId}::uuid and tenant_id = ${tenantId}::uuid`),
  );
  // O "viu e não pediu" falhou: o cartão segue sem ele (o motivo no log).
  const viu = await lembreteViu(db, tenantId, clienteId).catch((e: any) => {
    new Logger('CartaoDoCliente').warn(`"viu e não pediu" não lido: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
    return null;
  });
  return montarCartao(perfil ?? null, declarado, viu);
}

/** Na mesma conversa (até 6 h depois de entregar o lembrete), o mesmo produto continua no cartão. */
export const MESMA_CONVERSA_HORAS = 6;

/**
 * "VIU E NÃO PEDIU" NA CONVERSA (F7 parte 4d do docs/plano-perfil-cliente.md, §6.3; protótipo, "Automáticas novas"; mig 481).
 * Com a automática ligada (Delivery › Marketing › Automáticas — nasce desligada), o nome do produto que o cliente abriu 2
 * vezes ou mais nos últimos 30 dias e não pediu desde a primeira (a régua de `common/interesse-do-cliente.ts`), ainda no ar
 * no cardápio (ativo, disponível, não excluído). Os cliques só são do cliente quando ele não desligou as recomendações (D16)
 * — sem elas, nada. O FREIO: no máximo um lembrete a cada N dias (o "uma oferta a cada N dias" das Automáticas) e nunca a
 * quem recebeu uma oferta automática nesse intervalo; nas 6 horas seguintes (a mesma conversa) o mesmo produto continua.
 * Grava quando entrega (`cliente_lembrete_viu`). Só na nuvem. Devolve o nome ou `null`.
 */
export async function lembreteViu(db: any, tenantId: string, clienteId: string): Promise<string | null> {
  if (ehServidorLocal()) return null;
  const [cfg] = linhas(
    await db.execute(sql`
      select (to_jsonb(rc) ->> 'viu_ativo') = 'true' as ligado, rc.intervalo_ofertas_dias as dias
        from relacionamento_config rc where rc.tenant_id = ${tenantId}::uuid`),
  );
  if (!cfg?.ligado) return null;
  const dias = Number(cfg.dias) || AJUSTES_PADRAO.intervaloOfertasDias;
  const [ultimo] = linhas(
    await db.execute(sql`
      select l.produto_id, l.em > now() - make_interval(hours => ${MESMA_CONVERSA_HORAS}::int) as mesma_conversa
        from cliente_lembrete_viu l
       where l.tenant_id = ${tenantId}::uuid and l.cliente_id = ${clienteId}::uuid
         and l.em > now() - make_interval(days => ${dias}::int)
       order by l.em desc limit 1`),
  );
  if (ultimo && !ultimo.mesma_conversa) return null; // já lembrou neste intervalo
  if (!ultimo) {
    // Recebeu uma oferta automática no intervalo (aniversário, "sentimos sua falta"…): o freio segura o lembrete.
    const [oferta] = linhas(
      await db.execute(sql`
        select 1 as tem from cliente c
          join relacionamento_envio e on e.tenant_id = c.tenant_id and e.chave_telefone = ${sqlChaveTelefone(sql`c.telefone`)}
         where c.id = ${clienteId}::uuid and c.tenant_id = ${tenantId}::uuid
           and e.oferta and e.status = 'enviado' and e.enviado_em > now() - make_interval(days => ${dias}::int)
         limit 1`),
    );
    if (oferta) return null;
  }
  const I = INTERESSE;
  const [p] = linhas(
    await db.execute(sql`
      select i.produto_id, pr.nome
        from cardapio_interacao i
        join produto pr on pr.id = i.produto_id and pr.tenant_id = i.tenant_id
                       and pr.deleted_at is null and pr.ativo and pr.disponivel_cardapio
       where i.tenant_id = ${tenantId}::uuid and i.cliente_id = ${clienteId}::uuid and i.tipo = 'produto_aberto'
         and i.produto_id is not null and i.em > now() - make_interval(days => ${I.viuJanelaDias}::int)
         ${ultimo ? sql`and i.produto_id = ${ultimo.produto_id}::uuid` : sql``}
       group by i.produto_id, pr.nome
      having count(*) >= ${I.viuVezes}::int
         and ${sqlNaoPediuDesde(sql`${tenantId}::uuid`, sql`${clienteId}::uuid`, sql`i.produto_id`, sql`min(i.em)`)}
       order by max(i.em) desc
       limit 1`),
  );
  if (!p?.nome) return null;
  if (!ultimo)
    await db.execute(sql`
      insert into cliente_lembrete_viu (tenant_id, cliente_id, produto_id) values (${tenantId}::uuid, ${clienteId}::uuid, ${p.produto_id}::uuid)`);
  return String(p.nome);
}
