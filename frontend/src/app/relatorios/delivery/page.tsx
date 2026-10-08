'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import { api, getCategoria, getToken } from '@/lib/api';
import { baixarCsv } from '@/lib/csv';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { FiltroBusca, Filtros, ListaDados, TituloLista, Vazio, brl, semAcento, texto2 } from '@/components/ui/lista';
import { ErroDeLeitura, Indicadores } from '@/components/relatorios/pecas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// MAPA DE CALOR DE ENTREGAS — as entregas de todos os canais (fora os pedidos cancelados) somadas
// por bairro. Abre pelo botão da aba Delivery de Relatórios de vendas. Mockup
// `mockups/regem-relatorios.html` (aprovado em 07/10/2026). Vem de `GET /delivery/mapa-calor?dias=`
// (presidente e gerente, permissão "Delivery"), que aceita só "últimos N dias" e soma a empresa inteira.

const PERIODOS = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
];
const ID_TITULO = 'calor-titulo';

export default function MapaCalorDeliveryPage() {
  const router = useRouter();
  const [dias, setDias] = useState(30);
  const [dados, setDados] = useState<any | null>(null);
  const [erro, setErro] = useState('');
  const [carregando, setCarregando] = useState(false);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro('');
    try {
      setDados(await api.deliveryMapaCalor(dias));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Tente de novo em instantes.');
    } finally {
      setCarregando(false);
    }
  }, [dias]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    // Só presidência e gerência veem (o servidor também barra).
    if (!['presidente', 'gerente'].includes(getCategoria() ?? '')) {
      router.replace('/meu-dia');
      return;
    }
    void carregar();
  }, [router, carregar]);

  const bairros: any[] = dados?.bairros ?? [];
  const geral = dados?.geral;
  const campeao = bairros[0];
  const maior = bairros.reduce((m, x) => Math.max(m, Number(x.pedidos)), 0) || 1;
  const b = semAcento(busca);
  const linhas = b ? bairros.filter((x) => semAcento(x.bairro).includes(b)) : bairros;
  const exportar = () =>
    baixarCsv('entregas-por-bairro', linhas.map((x) => ({ bairro: x.bairro, pedidos: x.pedidos, 'participacao %': x.pct, receita: x.receita, 'ticket medio': x.ticketMedio, 'taxa media': x.taxaMedia })));

  return (
    <Shell eyebrow="Relatórios" title="Mapa de calor de entregas">
      <div className="space-y-4">
        <p>
          <Link href="/relatorios?aba=delivery" className="inline-flex min-h-10 items-center gap-1.5 rounded-md text-sm font-semibold underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> Relatórios de vendas › Delivery
          </Link>
        </p>
        <p className={`text-sm ${texto2}`}>Entregas de todos os canais, fora os pedidos cancelados, somadas por bairro.</p>

        <Card className="space-y-2 p-3">
          <p className={`text-xs font-bold ${texto2}`} id="calor-periodo">Período</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="calor-periodo">
            {PERIODOS.map((p) => (
              <button
                key={p.dias}
                type="button"
                aria-pressed={dias === p.dias}
                onClick={() => setDias(p.dias)}
                className={`min-h-10 rounded-md border px-3.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  dias === p.dias ? 'border-foreground bg-foreground text-background' : `border-input bg-card ${texto2} hover:border-secondary-foreground hover:text-foreground`
                }`}
              >
                {p.rotulo}
              </button>
            ))}
          </div>
          <p className={`text-sm ${texto2}`} role="status" aria-live="polite">últimos {dias} dias · todas as lojas da empresa{carregando ? ' · carregando…' : ''}</p>
        </Card>

        {erro ? (
          <ErroDeLeitura oQue="as entregas por bairro" motivo={erro} aoTentar={() => void carregar()} ocupado={carregando} />
        ) : dados === null ? (
          <SkeletonList rows={4} />
        ) : (
          <section className="space-y-3" aria-labelledby={ID_TITULO}>
            <TituloLista id={ID_TITULO} titulo="Entregas por bairro" total={bairros.length} mostrando={linhas.length} um="bairro" varios="bairros">
              {linhas.length > 0 && <Button type="button" variant="outline" onClick={exportar}><Download className="h-4 w-4" aria-hidden="true" /> Exportar CSV</Button>}
            </TituloLista>
            <Indicadores itens={[
              { rotulo: 'Bairro campeão', valor: campeao?.bairro ?? '—', apoio: campeao ? `${campeao.pedidos} pedidos · ${String(campeao.pct).replace('.', ',')}%` : 'sem entregas' },
              { rotulo: 'Pedidos no período', valor: String(geral?.pedidos ?? 0), apoio: `${geral?.bairros ?? 0} ${geral?.bairros === 1 ? 'bairro' : 'bairros'}` },
              { rotulo: 'Ticket médio', valor: geral?.pedidos ? brl(geral.ticketMedio) : '—', apoio: 'por pedido' },
              { rotulo: 'Taxa média', valor: geral?.pedidos ? brl(geral.taxaMedia) : '—', apoio: 'frete cobrado' },
            ]} />
            <Filtros>
              <FiltroBusca id="calor-busca" valor={busca} aoMudar={setBusca} placeholder="Nome do bairro" />
            </Filtros>
            {bairros.length === 0 ? (
              <Vazio>Nenhuma entrega neste período.</Vazio>
            ) : linhas.length === 0 ? (
              <Vazio aoLimpar={() => setBusca('')} />
            ) : (
              <ListaDados
                legenda="Entregas por bairro no período: pedidos, participação, receita, ticket médio e taxa média"
                linhas={linhas}
                chave={(x) => x.bairro}
                nome={(x) => x.bairro}
                colunas={[
                  {
                    titulo: 'Bairro',
                    celula: (x) => (
                      <>
                        <span className="break-words font-bold">{x.bairro}</span>
                        {/* A barra repete, em desenho, o número da coluna ao lado. */}
                        <span className="mt-1 block h-2.5 max-w-64 overflow-hidden rounded-full bg-secondary" aria-hidden="true">
                          <span className="block h-full rounded-full bg-[hsl(var(--dado))]" style={{ width: `${Math.max(3, Math.round((Number(x.pedidos) / maior) * 100))}%` }} />
                        </span>
                      </>
                    ),
                  },
                  { titulo: 'Pedidos', celula: (x) => <span className="whitespace-nowrap font-mono">{x.pedidos} <span className={`font-sans text-xs ${texto2}`}>{String(x.pct).replace('.', ',')}%</span></span> },
                  { titulo: 'Receita', celula: (x) => <span className="whitespace-nowrap font-mono">{brl(x.receita)}</span> },
                  { titulo: 'Ticket médio', celula: (x) => <span className="whitespace-nowrap font-mono">{brl(x.ticketMedio)}</span> },
                  { titulo: 'Taxa média', celula: (x) => <span className="whitespace-nowrap font-mono">{brl(x.taxaMedia)}</span> },
                ]}
              />
            )}
          </section>
        )}
      </div>
    </Shell>
  );
}
