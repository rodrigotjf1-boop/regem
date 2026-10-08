'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download } from 'lucide-react';
import { api, getCategoria, getToken } from '@/lib/api';
import { baixarCsv } from '@/lib/csv';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { SkeletonList } from '@/components/ui/skeleton';
import {
  FiltroBusca, FiltroSelect, Filtros, ListaDados, Selo, Situacoes, TituloLista, Vazio, distintos, semAcento, texto2, type Situacao,
} from '@/components/ui/lista';
import { BarraPeriodo, usePeriodo } from '@/components/relatorios/periodo';
import { useEscopoDeLoja } from '@/components/relatorios/escopo';
import { AvisoDeLimite, ErroDeLeitura } from '@/components/relatorios/pecas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CANCELAMENTOS DE ITENS — os itens retirados de comandas de mesa depois de lançados, com quem
// retirou e a justificativa. Mockup `mockups/regem-relatorios.html` (aprovado em 07/10/2026).
// A lista vem de `GET /vendas/remocoes` (presidente, gerente e supervisão, permissão
// "Cancelamentos"): são os registros da auditoria, que guardam o item, quem e a justificativa —
// NÃO a mesa, a quantidade nem o valor. A rota devolve as 300 retiradas mais recentes do período,
// da loja em uso (a loja é a da comanda de onde o item saiu).

const LIMITE = 300;
const ID_TITULO = 'itens-titulo';
const quando = (iso: unknown) =>
  iso ? new Date(String(iso)).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const SITUACOES: Situacao<any>[] = [
  { rotulo: 'Sem justificativa', filtro: (r) => !String(r.justificativa ?? '').trim(), tom: 'aviso' },
  { rotulo: 'Com justificativa', filtro: (r) => !!String(r.justificativa ?? '').trim() },
];

export default function CancelamentosDeItensPage() {
  const router = useRouter();
  const periodo = usePeriodo('30');
  const loja = useEscopoDeLoja();
  const [rows, setRows] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [atualizadoEm, setAtualizadoEm] = useState<Date | null>(null);
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const [quem, setQuem] = useState('');

  const { de, ate, pronto } = periodo;
  const carregar = useCallback(async () => {
    if (!pronto) return;
    setCarregando(true);
    setErro('');
    try {
      const r: any = await api.remocoesItens(de, ate, loja.total);
      setRows(Array.isArray(r) ? r : []);
      setAtualizadoEm(new Date());
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Tente de novo em instantes.');
    } finally {
      setCarregando(false);
    }
  }, [de, ate, pronto, loja.total]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    // Só a gestão vê (o servidor também barra, com a permissão "Cancelamentos").
    if (!['presidente', 'gerente', 'supervisao'].includes(getCategoria() ?? '')) {
      router.replace('/meu-dia');
      return;
    }
    void carregar();
  }, [router, carregar]);

  const todos = rows ?? [];
  const b = semAcento(busca);
  const base = todos.filter(
    (r) => (!b || semAcento(`${r.descricao ?? ''} ${r.ator ?? ''} ${r.justificativa ?? ''}`).includes(b)) && (!quem || r.ator === quem),
  );
  const linhas = sit < 0 ? base : base.filter(SITUACOES[sit].filtro);
  const filtrando = !!(busca.trim() || quem || sit >= 0);
  const limpar = () => { setBusca(''); setQuem(''); setSit(-1); };
  const exportar = () =>
    baixarCsv('itens-retirados', linhas.map((r) => ({ quando: quando(r.data), item: r.descricao ?? '', 'quem retirou': r.ator ?? '', justificativa: r.justificativa ?? '' })));

  return (
    <Shell eyebrow="Relatórios" title="Cancelamentos de itens">
      <div className="space-y-4">
        <p className={`text-sm ${texto2}`}>Itens retirados de comandas de mesa depois de lançados, com quem retirou e a justificativa.</p>
        <BarraPeriodo periodo={periodo} escopo={loja.texto} total={loja.opcao} atualizadoEm={atualizadoEm} carregando={carregando} aoAtualizar={() => void carregar()} />

        {erro ? (
          <ErroDeLeitura oQue="os itens retirados" motivo={erro} aoTentar={() => void carregar()} ocupado={carregando} />
        ) : rows === null ? (
          <SkeletonList rows={4} />
        ) : (
          <section className="space-y-3" aria-labelledby={ID_TITULO}>
            <TituloLista id={ID_TITULO} titulo="Itens retirados" total={todos.length} mostrando={linhas.length} um="item retirado" varios="itens retirados">
              {linhas.length > 0 && <Button type="button" variant="outline" onClick={exportar}><Download className="h-4 w-4" aria-hidden="true" /> Exportar CSV</Button>}
            </TituloLista>
            <AvisoDeLimite linhas={todos.length} limite={LIMITE} oQue="as retiradas" />
            <Situacoes base={base} opcoes={SITUACOES} valor={sit} aoMudar={setSit} />
            <Filtros>
              <FiltroBusca id="itens-busca" valor={busca} aoMudar={setBusca} placeholder="Item, quem retirou ou justificativa" />
              <FiltroSelect id="itens-quem" rotulo="Quem retirou" todos="Todos" opcoes={distintos(todos, (r) => r.ator)} valor={quem} aoMudar={setQuem} />
            </Filtros>

            {todos.length === 0 ? (
              <Vazio>Nenhum item retirado neste período. Um item aparece aqui quando é tirado de uma comanda de mesa depois de lançado.</Vazio>
            ) : linhas.length === 0 ? (
              <Vazio aoLimpar={limpar} />
            ) : (
              <ListaDados
                legenda="Itens retirados de comandas de mesa"
                linhas={linhas}
                chave={(r) => r.id}
                nome={(r) => r.descricao ?? 'item'}
                colunas={[
                  { titulo: 'Item', celula: (r) => <span className="break-words font-bold">{r.descricao ?? '—'}</span> },
                  { titulo: 'Quando', celula: (r) => <span className="whitespace-nowrap font-mono">{quando(r.data)}</span> },
                  { titulo: 'Quem retirou', celula: (r) => r.ator ?? '—' },
                  { titulo: 'Justificativa', celula: (r) => (String(r.justificativa ?? '').trim() ? <span className="break-words">{r.justificativa}</span> : <Selo tom="aviso">sem justificativa</Selo>) },
                ]}
              />
            )}
            {filtrando && linhas.length > 0 && (
              <p><Button type="button" variant="outline" size="sm" onClick={limpar}>Limpar filtros</Button></p>
            )}
          </section>
        )}
      </div>
    </Shell>
  );
}
