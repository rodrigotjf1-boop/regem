import { sql } from 'drizzle-orm';

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
};

const linhas = (r: any): any[] => r?.rows ?? r ?? [];

/** Pura: monta o cartão a partir do que foi lido (testável sem banco). `null` = nada útil para o atendimento. */
export function montarCartao(perfil: any | null, declarado: { chave: string; valor: any }[]): CartaoDoCliente | null {
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
  return montarCartao(perfil ?? null, declarado);
}
