import { bairroOuNulo } from './contato-integracao';
import { ProblemaException } from './problema';

// OS PEDIDOS POR BAIRRO da API de integração (GET /integracao/pedidos/bairros — pedido do Liame, decisão D-RG-8 aprovada
// pelo dono em 11/11/2026: "pedir ao Regem os pedidos por bairro, agregados, com mínimo por bairro"). As regras puras: a
// janela de dias e a montagem da resposta a partir dos grupos que o banco somou. Nunca sai cliente, telefone, rua, número
// ou CEP — só o nome do bairro, a cidade, a UF e as contas.

/** Bairro com menos pedidos que isto na janela vai para "outros", sem o nome. */
export const MINIMO_POR_BAIRRO = 5;
/** A janela vai até este número de dias, contando o de e o ate. */
export const JANELA_MAX_DIAS = 92;
/** Centavos → micros (a unidade de dinheiro do contrato do Liame: 1 real = 1.000.000). */
const MICROS_POR_CENTAVO = 10_000;

const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

function dia(v: unknown, nome: 'de' | 'ate'): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!FORMATO_DIA.test(s)) {
    throw new ProblemaException(400, 'parametro-invalido', `"${nome}" é obrigatório, no formato AAAA-MM-DD.`);
  }
  const [a, m, d] = s.split('-').map(Number);
  const data = new Date(Date.UTC(a, m - 1, d));
  if (data.getUTCFullYear() !== a || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) {
    throw new ProblemaException(400, 'parametro-invalido', `"${nome}" não é uma data que existe (${s}).`);
  }
  return s;
}

/** A janela pedida: os dois dias obrigatórios, `de` até `ate` (inclusive), no máximo `JANELA_MAX_DIAS`. */
export function lerJanelaDeDias(de: unknown, ate: unknown): { de: string; ate: string; dias: number } {
  const a = dia(de, 'de');
  const b = dia(ate, 'ate');
  const dias = Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;
  if (dias < 1) throw new ProblemaException(400, 'parametro-invalido', `"de" (${a}) vem depois de "ate" (${b}).`);
  if (dias > JANELA_MAX_DIAS) {
    throw new ProblemaException(400, 'parametro-invalido', `A janela vai até ${JANELA_MAX_DIAS} dias; a pedida tem ${dias}.`);
  }
  return { de: a, ate: b, dias };
}

/** Um grupo que o banco somou: as entregas de um bairro (e cidade), ou tudo o que não é entrega junto. */
export type GrupoDeBairro = {
  grupo: 'entrega' | 'outro';
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  pedidos: number | string;
  receita_centavos: number | string;
};

export type BairroDaResposta = { bairro: string; cidade: string | null; uf: string | null; pedidos: number; receita_micros: number };

export type PedidosPorBairro = {
  bairros: BairroDaResposta[];
  outros: { bairros: number; pedidos: number; receita_micros: number };
  sem_bairro: { pedidos: number; receita_micros: number };
  retirada_e_balcao: { pedidos: number };
};

const uf = (v: unknown): string | null => {
  const s = String(v ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : null;
};

/**
 * A resposta a partir dos grupos do banco. O bairro passa pela MESMA regra dos campos do RegemCast (`bairroOuNulo`: o
 * "bairro" que é distância — "~3.2 km", frete por raio — não é bairro e vai para `sem_bairro`). Maiúscula e minúscula não
 * separam (o banco já agrupa assim; aqui junta o que só a regra deixou igual). Bairro com menos de `minimo` pedidos vai
 * para `outros` — só a conta, sem o nome. Ordem: mais pedidos primeiro, depois mais receita, depois o nome.
 */
export function montarBairros(grupos: readonly GrupoDeBairro[], minimo = MINIMO_POR_BAIRRO): PedidosPorBairro {
  const porBairro = new Map<string, { bairro: string; cidade: string | null; uf: string | null; pedidos: number; centavos: number }>();
  const semBairro = { pedidos: 0, receita_micros: 0 };
  let retirada = 0;
  for (const g of grupos) {
    const pedidos = Number(g.pedidos) || 0;
    const centavos = Number(g.receita_centavos) || 0;
    if (g.grupo !== 'entrega') {
      retirada += pedidos;
      continue;
    }
    const nome = bairroOuNulo(g.bairro);
    if (!nome) {
      semBairro.pedidos += pedidos;
      semBairro.receita_micros += centavos * MICROS_POR_CENTAVO;
      continue;
    }
    const cidade = String(g.cidade ?? '').trim().slice(0, 120) || null;
    const chave = `${nome.toLocaleLowerCase('pt-BR')}|${(cidade ?? '').toLocaleLowerCase('pt-BR')}`;
    const ja = porBairro.get(chave);
    if (ja) {
      ja.pedidos += pedidos;
      ja.centavos += centavos;
      ja.uf = ja.uf ?? uf(g.uf);
    } else {
      porBairro.set(chave, { bairro: nome, cidade, uf: uf(g.uf), pedidos, centavos });
    }
  }
  const bairros: BairroDaResposta[] = [];
  const outros = { bairros: 0, pedidos: 0, receita_micros: 0 };
  for (const b of porBairro.values()) {
    if (b.pedidos >= minimo) {
      bairros.push({ bairro: b.bairro, cidade: b.cidade, uf: b.uf, pedidos: b.pedidos, receita_micros: b.centavos * MICROS_POR_CENTAVO });
    } else {
      outros.bairros += 1;
      outros.pedidos += b.pedidos;
      outros.receita_micros += b.centavos * MICROS_POR_CENTAVO;
    }
  }
  bairros.sort((x, y) => y.pedidos - x.pedidos || y.receita_micros - x.receita_micros || x.bairro.localeCompare(y.bairro, 'pt-BR'));
  return { bairros, outros, sem_bairro: semBairro, retirada_e_balcao: { pedidos: retirada } };
}
