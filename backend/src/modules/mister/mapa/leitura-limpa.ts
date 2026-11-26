import { semDadoPessoal } from '../../graph/graph.regras';
import { semValoresNoTexto } from '../mister-agente.regras';

// O FILTRO DA LEITURA (Mister, versão 10, C3; `docs/plano-mister.md` § "C3"). O que uma tela do Regem devolve passa por aqui
// ANTES de ir à IA. As leituras com dado de pessoa já ficam de fora pelo mapa (`pessoal: true`); isto é a segunda trava,
// pelo NOME de cada campo, para o que sobrar numa resposta qualquer:
//
//  • sai todo campo de contato, documento, endereço, posição, foto, link, segredo e credencial, em qualquer nível;
//  • sai o cliente (o campo "cliente…" que é texto, objeto ou lista; a contagem de clientes fica);
//  • no objeto com cara de pessoa (tem telefone, e-mail, CPF, endereço ou nascimento) sai também o nome — menos no de empresa
//    ou de loja (o fornecedor com CNPJ ou razão social; a loja, com o fuso);
//  • todo texto passa pelo `semDadoPessoal` (e-mail e sequência de 9 dígitos), menos o que é só uma data;
//  • quem não vê valores (`verValores` falso) não recebe campo de dinheiro, e o "R$" no texto vira "(oculto)";
//  • listas longas, textos longos e níveis fundos são cortados, com a observação do corte. Nada aqui inventa dado.

export const TEXTO_NO_MAXIMO = 300;
export const NIVEIS_NO_MAXIMO = 6;
/** O tamanho da resposta que vai à IA (em letras do JSON). Passou: as listas encolhem; ainda passou, a resposta não vai. */
export const RESPOSTA_NO_MAXIMO = 12_000;
const ITENS_POR_TENTATIVA = [30, 15, 8, 4];

/** Palavras do nome do campo que o tiram da resposta, em qualquer nível. */
const FORA = new Set([
  'telefone', 'telefones', 'celular', 'fone', 'phone', 'whatsapp', 'whats', 'wa', 'email', 'emails', 'mail', 'contato', 'contatos',
  'cpf', 'rg', 'cnpj', 'inscricao', 'documento', 'document', 'nascimento', 'aniversario', 'birthday',
  'endereco', 'enderecos', 'address', 'logradouro', 'complemento', 'referencia', 'cep', 'street',
  'latitude', 'longitude', 'lat', 'lng', 'lon', 'coordenadas', 'coordinates', 'geo',
  'foto', 'fotos', 'avatar', 'imagem', 'imagens', 'image', 'url', 'urls', 'link', 'links',
  'senha', 'password', 'hash', 'token', 'tokens', 'segredo', 'secret', 'chave', 'apikey', 'pin', 'certificado', 'csc',
  'ip', 'agent', 'placa', 'agencia', 'payload', 'raw', 'bruto',
]);
/** O cliente: sai quando o campo é texto, objeto ou lista (a contagem fica). */
const CLIENTE = new Set(['cliente', 'clientes', 'consumidor', 'destinatario', 'comprador', 'customer', 'customers', 'buyer']);
/** O nome, que sai junto no objeto com cara de pessoa. */
const NOME = new Set(['nome', 'name', 'apelido', 'sobrenome', 'nomes']);
/** O que faz o objeto ter cara de pessoa. */
const DE_PESSOA = new Set(['telefone', 'celular', 'fone', 'phone', 'whatsapp', 'email', 'cpf', 'rg', 'endereco', 'address', 'nascimento', 'aniversario']);
/** O que faz o objeto ser de empresa ou de loja (o nome fica): o fornecedor tem CNPJ; a loja, o fuso. */
const DE_EMPRESA = new Set(['cnpj', 'razao', 'fantasia', 'timezone', 'fuso']);
/** Dinheiro, para quem não vê valores. */
const DINHEIRO = new Set([
  'valor', 'valores', 'preco', 'precos', 'custo', 'custos', 'total', 'totais', 'receita', 'faturamento', 'lucro', 'margem',
  'ticket', 'salario', 'cmv', 'desconto', 'descontos', 'taxa', 'taxas', 'liquido', 'pago', 'pagar', 'receber', 'despesa', 'despesas',
  'entrada', 'entradas', 'saida', 'saidas', 'sangria', 'suprimento', 'gorjeta', 'troco', 'repasse', 'repasses', 'cashback', 'reais',
]);

/** As palavras do nome de um campo: "clienteNome" → cliente, nome; "valor_total" → valor, total. Sem acento. */
export function palavrasDoCampo(k: string): string[] {
  return String(k)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

const SO_DATA = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$|^\d{2}\/\d{2}\/\d{4}( \d{2}:\d{2}(:\d{2})?)?$|^\d{2}:\d{2}(:\d{2})?$/;

export interface OpcoesDaLimpeza {
  verValores: boolean;
}

export interface LeituraLimpa {
  dados: unknown;
  /** O que foi cortado (lista, texto, nível), para a IA saber que há mais. */
  observacoes: string[];
  /** Quantos campos saíram pelo filtro (para a medida; não vai à IA). */
  tirados: number;
}

function limparUma(valor: unknown, op: OpcoesDaLimpeza, itens: number): LeituraLimpa {
  const observacoes: string[] = [];
  let tirados = 0;
  const vistos = new WeakSet<object>();

  const texto = (s: string, onde: string): string => {
    let t = SO_DATA.test(s.trim()) ? s : semDadoPessoal(s);
    if (!op.verValores) t = semValoresNoTexto(t);
    if (t.length > TEXTO_NO_MAXIMO) {
      observacoes.push(`O texto de "${onde}" foi cortado.`);
      t = `${t.slice(0, TEXTO_NO_MAXIMO - 1)}…`;
    }
    return t;
  };

  const andar = (v: unknown, onde: string, nivel: number): unknown => {
    if (v === null || v === undefined) return v ?? null;
    if (typeof v === 'string') return texto(v, onde);
    if (typeof v === 'number' || typeof v === 'boolean') return v;
    if (typeof v !== 'object') return null;
    if (vistos.has(v as object)) return null;
    vistos.add(v as object);
    if (nivel >= NIVEIS_NO_MAXIMO) {
      observacoes.push(`O detalhe de "${onde}" ficou de fora (fundo demais).`);
      return '…';
    }
    if (Array.isArray(v)) {
      const lista = v.slice(0, itens).map((x, i) => andar(x, `${onde}[${i}]`, nivel + 1));
      if (v.length > itens) observacoes.push(`A lista "${onde || 'resposta'}" tem ${v.length} itens; vieram os ${itens} primeiros.`);
      return lista;
    }
    const obj = v as Record<string, unknown>;
    const chaves = Object.keys(obj);
    const palavras = new Map(chaves.map((k) => [k, palavrasDoCampo(k)]));
    const temPessoa = chaves.some((k) => palavras.get(k)!.some((p) => DE_PESSOA.has(p)));
    const temEmpresa = chaves.some((k) => palavras.get(k)!.some((p) => DE_EMPRESA.has(p)));
    const fora: Record<string, unknown> = {};
    for (const k of chaves) {
      const ps = palavras.get(k)!;
      const x = obj[k];
      const ehNumero = typeof x === 'number' || typeof x === 'boolean';
      const sai =
        ps.some((p) => FORA.has(p)) ||
        (!ehNumero && x !== null && ps.some((p) => CLIENTE.has(p))) ||
        (temPessoa && !temEmpresa && ps.some((p) => NOME.has(p))) ||
        (!op.verValores && ps.some((p) => DINHEIRO.has(p)));
      if (sai) {
        tirados++;
        continue;
      }
      fora[k] = andar(x, onde ? `${onde}.${k}` : k, nivel + 1);
    }
    return fora;
  };

  const dados = andar(valor, '', 0);
  return { dados, observacoes: [...new Set(observacoes)].slice(0, 6), tirados };
}

/**
 * Limpa o que a tela devolveu. As listas encolhem até a resposta caber em `RESPOSTA_NO_MAXIMO`; se nem com 4 itens por
 * lista couber, devolve `null` (quem chama diz à IA para pedir um período menor ou um filtro).
 */
export function limparLeitura(valor: unknown, op: OpcoesDaLimpeza): LeituraLimpa | null {
  for (const itens of ITENS_POR_TENTATIVA) {
    const r = limparUma(valor, op, itens);
    if (JSON.stringify(r.dados ?? null).length <= RESPOSTA_NO_MAXIMO) return r;
  }
  return null;
}
