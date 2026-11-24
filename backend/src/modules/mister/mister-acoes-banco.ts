import { CHAVES_DE_TIPO, TIPOS } from '../banco-repasses/banco-repasses.regras';

// CLASSIFICAR O LANÇAMENTO DO BANCO PELA CONVERSA (versão 9, fase O5; o catálogo do protótipo `mockups/regem-mister-v9.html`:
// "Financeiro — classificar lançamento do banco, com PIN"). O "Isso é o quê?" de Financeiro › Banco e repasses (R1 da versão 8,
// mig 499) pela conversa: a pessoa diz o dia, o valor e o tipo ("o Pix de R$ 1.200 do dia 20 é retirada do dono"); o Regem acha o
// lançamento, mostra o que vai fazer e o PIN autoriza. Só o presidente (V8-2, como a rota). Aqui só a conferência; sem banco.

export interface ParametrosDaClassificacao {
  acao: 'classificar_banco';
  dia: string;
  valorCentavos: number;
  trecho: string | null;
  tipo: string;
  lembrar: boolean;
}

const texto = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataValida = (iso: string) => DATA.test(iso) && new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso;
const reais = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const MAX_CENTAVOS = 1_000_000_000;

/** O nome do tipo como a tela mostra ("Retirada do dono"). */
export const rotuloDoTipo = (chave: string): string => TIPOS.find((t) => t.chave === chave)?.rotulo ?? chave;

export function conferirClassificacao(en: Record<string, unknown>, hoje: string): { parametros: ParametrosDaClassificacao; resumo: string } | { erro: string } {
  const dia = texto(en.diaDoLancamento);
  if (!dataValida(dia)) return { erro: 'Diga o dia do lançamento em AAAA-MM-DD.' };
  if (dia > hoje) return { erro: 'O lançamento do banco é de hoje para trás.' };
  const v = en.valorDoLancamento;
  if (typeof v !== 'number' || !Number.isFinite(v) || v === 0) return { erro: 'Diga o valor do lançamento em reais, como está no extrato.' };
  const valorCentavos = Math.round(Math.abs(v) * 100);
  if (valorCentavos > MAX_CENTAVOS) return { erro: 'Esse valor não parece de um lançamento.' };
  const tipo = texto(en.tipoDoLancamento);
  if (!CHAVES_DE_TIPO.includes(tipo)) return { erro: `O tipo é um destes: ${TIPOS.map((t) => t.rotulo).join(', ')}.` };
  const trecho = texto(en.trechoDoLancamento).slice(0, 40) || null;
  return { parametros: { acao: 'classificar_banco', dia, valorCentavos, trecho, tipo, lembrar: en.lembrarNosProximos === true }, resumo: '' };
}

/** O que vai acontecer, com o lançamento achado (a descrição já vem mascarada do extrato: V8-3). */
export function resumoDaClassificacao(l: { data: string; descricao: string; valorCentavos: number }, tipo: string, lembrar: boolean): string {
  const sinal = l.valorCentavos < 0 ? 'saída de ' : 'entrada de ';
  return (
    `Marcar o lançamento de ${dataBr(l.data)} "${l.descricao}" (${sinal}${reais(Math.abs(l.valorCentavos))}) como ${rotuloDoTipo(tipo)}` +
    `${lembrar ? ', e os próximos com a mesma descrição já entram assim' : ''}. Fica em Financeiro › Banco e repasses; nenhum dinheiro se move.`
  );
}

/** A página do PIN (a mesma forma das outras): o valor em destaque, o dia, a descrição e o tipo. */
export function apresentacaoDaClassificacao(p: { data: string; descricao: string; valorCentavos: number; tipo: string; lembrar?: boolean }): {
  titulo: string;
  itens: string[];
  detalhe: string | null;
  valor: number | null;
  botao: string;
} {
  return {
    titulo: 'Classificar o lançamento do banco',
    itens: [`Dia: ${dataBr(p.data)}`, `No extrato: ${p.descricao}`, `Vai como: ${rotuloDoTipo(p.tipo)}`, ...(p.lembrar ? ['Os próximos com a mesma descrição entram assim'] : [])],
    detalhe: 'Fica em Financeiro › Banco e repasses. Nenhum dinheiro se move.',
    valor: Math.abs(p.valorCentavos) / 100,
    botao: 'Classificar',
  };
}
