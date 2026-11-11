// "CONFERIR COM OS APPS" (R3 F4a; mig 405; protótipo `mockups/regem-conciliacao-ifood.html`): as regras PURAS da tela —
// os nomes de cada app nas frases, o selo e a frase de cada situação, o que entra no "Usar os preços do app" e a busca.
// Sem import: o `check:catalogo` transpila este arquivo sozinho e confere os casos.

export type CanalConferido = 'ifood' | '99food';
export type TipoConferido = 'item' | 'opcao';
export type SituacaoConferida = 'soApp' | 'soRegem' | 'preco' | 'naoLiga' | 'igual' | 'ignorada';
export type MotivoConferido =
  | 'semCodigo'
  | 'repetidoNoApp'
  | 'repetidoNoRegem'
  | 'semCodigoNoRegem'
  | 'semPrecoNoRegem'
  | 'precoDiferente'
  | 'precosDiferentesNosGrupos'
  | null;

/** Uma linha da conferência (o servidor compara; a tela só mostra e filtra). */
export type LinhaConferida = {
  chave: string;
  tipo: TipoConferido;
  nome: string;
  pdv: string | null;
  grupos: string[];
  precos: number[];
  promoDe: number | null;
  pausado: boolean | null;
  regem: { id: string; nome: string; preco: number | null; ativo: boolean } | null;
  ligaPeloId: boolean;
  situacao: SituacaoConferida;
  motivo: MotivoConferido;
  outros: string[];
};

export type EstadoDaConferencia = 'ok' | 'lendo' | 'semLeitura' | 'semLigacao' | 'semConexao';
export type RespostaDaConferencia = {
  loja: { id: string; nome: string } | null;
  canal: CanalConferido;
  canais: Record<CanalConferido, { ligado: boolean; motivo: string | null; pendentes: number | null }>;
  estado: EstadoDaConferencia;
  motivo: string | null;
  lendoAgora: boolean;
  lidoEm: string | null;
  erro: string | null;
  erroEm: string | null;
  itens: LinhaConferida[];
  opcoes: LinhaConferida[];
};

/** Os nomes de cada app nas frases ("no iFood", "da 99", "pelo Orzuni"…). */
export const APP: Record<CanalConferido, { nome: string; o: string; no: string; do: string; ao: string; pelo: string; marca: string }> = {
  ifood: { nome: 'iFood', o: 'o iFood', no: 'no iFood', do: 'do iFood', ao: 'ao iFood', pelo: 'pelo Orzuni', marca: 'Está no iFood' },
  '99food': { nome: '99', o: 'a 99', no: 'na 99', do: 'da 99', ao: 'à 99', pelo: 'pela integração da 99', marca: 'Está na 99' },
};

export const reais = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O preço do app na linha: um só, a faixa (opção com preços diferentes nos grupos) ou nada. */
export function precoNoApp(l: LinhaConferida): string {
  if (!l.precos.length) return '—';
  if (l.precos.length === 1) return reais(l.precos[0]);
  return `${reais(l.precos[0])} a ${reais(l.precos[l.precos.length - 1])}`;
}

export const pendente = (l: LinhaConferida) => l.situacao !== 'igual' && l.situacao !== 'ignorada';

/** `"A", "B" e "C"`. */
export function listaE(nomes: string[]): string {
  const q = nomes.map((n) => `"${n}"`);
  return q.length > 1 ? `${q.slice(0, -1).join(', ')} e ${q[q.length - 1]}` : (q[0] ?? '');
}

/** As situações (fichas) de cada vista, na ordem do protótipo. "Só no Regem" só nos itens. */
export function situacoesDa(canal: CanalConferido, tipo: TipoConferido): { k: SituacaoConferida; rotulo: string; tom?: 'aviso' | 'critico' }[] {
  const s: { k: SituacaoConferida; rotulo: string; tom?: 'aviso' | 'critico' }[] = [
    { k: 'soApp', rotulo: `Só ${APP[canal].no}`, tom: 'critico' },
    { k: 'soRegem', rotulo: 'Só no Regem', tom: 'aviso' },
    { k: 'preco', rotulo: 'Preço diferente', tom: 'aviso' },
    { k: 'naoLiga', rotulo: 'Não dá para ligar', tom: 'critico' },
    { k: 'igual', rotulo: 'Iguais' },
    { k: 'ignorada', rotulo: 'Ignoradas' },
  ];
  return tipo === 'item' ? s : s.filter((x) => x.k !== 'soRegem');
}

/** O selo e a frase da situação da linha (as frases do protótipo). */
export function seloDa(l: LinhaConferida, canal: CanalConferido): { tom: 'ok' | 'aviso' | 'critico' | 'neutro'; rotulo: string; frase: string } {
  const a = APP[canal];
  const venda = canal === 'ifood' ? 'a venda pelo iFood' : 'a venda pela 99';
  switch (l.situacao) {
    case 'soApp':
      return {
        tom: 'critico',
        rotulo: `Só ${a.no}`,
        frase:
          l.tipo === 'item'
            ? `Item sem produto no Regem com este código: ${venda} não baixa o estoque.`
            : 'Complemento sem opção no Regem com este código: não é cobrado nem baixa o estoque pelo Regem.',
      };
    case 'soRegem':
      return {
        tom: 'aviso',
        rotulo: 'Só no Regem',
        frase:
          l.motivo === 'semCodigoNoRegem'
            ? `"${l.nome}" está marcado "${a.marca}", mas não tem código PDV no Regem: não liga ${a.ao}.`
            : `"${l.nome}" está marcado "${a.marca}", mas ${a.o} não tem item com o código ${l.pdv}.`,
      };
    case 'preco':
      if (l.motivo === 'semPrecoNoRegem') return { tom: 'aviso', rotulo: 'Sem preço no Regem', frase: `No Regem o preço ${a.do} está em branco.` };
      if (l.motivo === 'precosDiferentesNosGrupos')
        return { tom: 'aviso', rotulo: 'Preço diferente', frase: `${a.nome}: ${precoNoApp(l)}, conforme o grupo · Regem ${reais(l.regem?.preco)}` };
      return { tom: 'aviso', rotulo: 'Preço diferente', frase: `${a.nome} ${precoNoApp(l)} · Regem ${reais(l.regem?.preco)}` };
    case 'naoLiga':
      if (l.motivo === 'semCodigo')
        return {
          tom: 'critico',
          rotulo: 'Sem código',
          frase:
            canal === 'ifood' && l.tipo === 'opcao'
              ? 'Sem código PDV no iFood (o código que o Orzuni gera não liga a nada).'
              : `${l.tipo === 'item' ? 'O item' : 'O complemento'} não tem código PDV ${a.no}.`,
        };
      if (l.motivo === 'repetidoNoRegem')
        return {
          tom: 'critico',
          rotulo: 'Código repetido no Regem',
          frase: `O código ${l.pdv} está em ${l.outros.length} ${l.tipo === 'item' ? 'produtos' : 'opções'} do Regem: ${listaE(l.outros)}.`,
        };
      return {
        tom: 'critico',
        rotulo: 'Código repetido',
        frase: `O código ${l.pdv} está em ${l.outros.length + 1} ${l.tipo === 'item' ? 'itens' : 'complementos'} ${a.do}: ${listaE([l.nome, ...l.outros])}.`,
      };
    case 'ignorada':
      return { tom: 'neutro', rotulo: 'Ignorada', frase: 'Fica fora das contagens até você desfazer.' };
    default:
      return { tom: 'ok', rotulo: 'Igual', frase: l.ligaPeloId ? 'Liga pelo id do produto (exportado sem código PDV); preço igual.' : 'Código e preço iguais.' };
  }
}

/** Entra no "Usar os preços do app (N)": preço diferente, preenchido no Regem e UM preço no app (decisão 3 do protótipo). */
export const entraNoUsarEmMassa = (l: LinhaConferida) =>
  l.situacao === 'preco' && l.motivo === 'precoDiferente' && l.regem?.preco != null && l.precos.length === 1;

/** A busca: nome no app, código e nome no Regem, sem acento nem caixa. */
export function bateNaBusca(l: LinhaConferida, busca: string): boolean {
  const s = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const b = s(busca.trim());
  return !b || s(`${l.nome} ${l.pdv ?? ''} ${l.regem?.nome ?? ''}`).includes(b);
}

/** "Lido do iFood hoje às 14:30" / "em 10/11 às 09:12" (hora de Brasília). */
export function quandoLido(iso: string | null, agora: Date = new Date()): string {
  if (!iso) return 'ainda não lido';
  const d = new Date(iso);
  const tz = { timeZone: 'America/Sao_Paulo' } as const;
  const dia = (x: Date) => x.toLocaleDateString('pt-BR', tz);
  const hora = d.toLocaleTimeString('pt-BR', { ...tz, hour: '2-digit', minute: '2-digit' });
  return dia(d) === dia(agora) ? `hoje às ${hora}` : `em ${dia(d).slice(0, 5)} às ${hora}`;
}
