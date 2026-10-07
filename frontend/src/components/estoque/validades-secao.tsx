'use client';

import { useCallback, useEffect, useState } from 'react';
import { Recycle, Tag } from 'lucide-react';
import { api, getCategoria, podePerm } from '@/lib/api';
import { SkeletonList } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { DesperdicioForm } from './desperdicio-secao';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, NomeComApoio, Selo, Situacoes, TituloLista, Vazio,
  dataBr, diasAte, distintos, num, semAcento, type Situacao, type Tom,
} from './lista';

/* eslint-disable @typescript-eslint/no-explicit-any */
const dias = (l: any) => (l.validade ? diasAte(l.validade) : null);
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Vencidos', filtro: (l) => dias(l) !== null && dias(l)! < 0, tom: 'critico' },
  { rotulo: 'Vencem em 7 dias', filtro: (l) => dias(l) !== null && dias(l)! >= 0 && dias(l)! <= 7, tom: 'aviso' },
  { rotulo: 'No prazo', filtro: (l) => dias(l) !== null && dias(l)! > 7 },
  { rotulo: 'Sem validade', filtro: (l) => dias(l) === null },
];
function situacao(l: any): { tom: Tom; texto: string } {
  const d = dias(l);
  if (d === null) return { tom: 'neutro', texto: 'sem validade' };
  if (d < 0) return { tom: 'critico', texto: `vencido há ${-d} dia(s)` };
  if (d === 0) return { tom: 'critico', texto: 'vence hoje' };
  if (d <= 7) return { tom: 'aviso', texto: `vence em ${d} dia(s)` };
  return { tom: 'ok', texto: 'no prazo' };
}

// Aba Validades: os lotes com saldo, do que vence primeiro para o que vence por último (o
// primeiro que vence é o primeiro que sai). Do lote vencido dá para registrar a perda aqui; do
// lote com validade, gerar a etiqueta (`aoEtiquetar` leva para a aba Etiquetas com ele escolhido).
export function ValidadesSecao({
  itens,
  aoMudarEstoque,
  aoEtiquetar,
}: {
  itens: any[];
  aoMudarEstoque: () => void;
  aoEtiquetar?: (lote: any) => void;
}) {
  const [lista, setLista] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [categoria, setCategoria] = useState('');
  const [perda, setPerda] = useState<any>(null);

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const r: any = await api.lotes();
      setLista(Array.isArray(r) ? r : []);
    } catch (e) {
      setLista([]);
      setErro(e instanceof Error ? e.message : 'Erro ao carregar os lotes');
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  if (lista === null) return <SkeletonList rows={5} />;

  const b = semAcento(busca);
  const base = lista.filter(
    (l) => (!b || semAcento(`${l.itemNome} ${l.codigo ?? ''}`).includes(b)) && (!categoria || (l.categoriaNome ?? 'Sem categoria') === categoria),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || categoria || sit >= 0);
  const limpar = () => { setBusca(''); setCategoria(''); setSit(-1); };
  const podePerda = podePerm('desperdicio');
  // Mesma regra de "Gerar etiqueta" na aba Etiquetas: gestão com "editar estoque".
  const podeEtiquetar =
    !!aoEtiquetar && ['presidente', 'gerente', 'supervisao', 'suporte'].includes(getCategoria() ?? '') && podePerm('estoque', 'editar');

  return (
    <section className="space-y-3" aria-labelledby="validades-titulo">
      <TituloLista id="validades-titulo" titulo="Validades" total={lista.length} mostrando={linhas.length} um="lote" varios="lotes"
        extra="primeiro que vence, primeiro que sai" />
      {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">{erro}</p>}
      <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id="validades-busca" valor={busca} aoMudar={setBusca} placeholder="Produto ou código do lote" />
        <FiltroSelect id="validades-categoria" rotulo="Categoria" todos="Todas as categorias" opcoes={distintos(lista, (l) => l.categoriaNome ?? 'Sem categoria')} valor={categoria} aoMudar={setCategoria} />
      </Filtros>

      {lista.length === 0 ? (
        <Vazio>Nenhum lote com saldo. Os lotes nascem ao confirmar um recebimento ou uma compra com data de validade.</Vazio>
      ) : linhas.length === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        <ListaDados
          legenda="Lotes com saldo, por validade"
          linhas={linhas}
          chave={(l) => l.id}
          nome={(l) => l.itemNome}
          colunas={[
            { titulo: 'Produto', celula: (l) => <NomeComApoio nome={l.itemNome} apoio={`${l.categoriaNome ?? 'Sem categoria'} · ${l.codigo ? `lote ${l.codigo}` : 'sem código de lote'}`} /> },
            { titulo: 'Quantidade', celula: (l) => <span className="whitespace-nowrap"><span className="font-mono">{num(l.quantidade)}</span> {l.unidade}</span> },
            { titulo: 'Entrada', celula: (l) => <span className="font-mono">{dataBr(l.entrada)}</span> },
            { titulo: 'Validade', celula: (l) => (l.validade ? <span className="font-mono">{dataBr(l.validade)}</span> : '—') },
            { titulo: 'Situação', celula: (l) => <Selo tom={situacao(l).tom}>{situacao(l).texto}</Selo> },
          ]}
          acoes={(l) => [
            // Lote sem validade não vira etiqueta de validade (não há data para imprimir).
            ...(podeEtiquetar && dias(l) !== null ? [{ rotulo: 'Etiqueta', icone: Tag, aoClicar: aoEtiquetar! }] : []),
            ...(podePerda && dias(l) !== null && dias(l)! <= 0 ? [{ rotulo: 'Registrar perda', icone: Recycle, aoClicar: setPerda, tom: 'perigo' as const }] : []),
          ]}
        />
      )}
      {filtrando && linhas.length > 0 && (
        <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
      )}

      {perda && (
        <DesperdicioForm
          itens={itens}
          inicial={{ descricao: `${perda.itemNome} vencido`, itemId: perda.itemId, quantidade: String(perda.quantidade), motivo: 'Validade' }}
          aoFechar={() => setPerda(null)}
          aoSalvar={async () => {
            setPerda(null);
            await carregar();
            // O lote (e o botão que abriu a gaveta) pode ter saído da lista: o foco vai para o título.
            document.getElementById('validades-titulo')?.focus();
            aoMudarEstoque();
          }}
        />
      )}
    </section>
  );
}
