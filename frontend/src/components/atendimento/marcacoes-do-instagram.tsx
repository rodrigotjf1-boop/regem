'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { MarcacaoCartao } from '@/components/atendimento/marcacao-cartao';
import { ajudaDasMarcacoes, type ListaDeMarcacoes, type MarcacaoDoInstagram } from '@/lib/marcacoes-do-instagram';

/** Com a lista aberta, relê a cada tanto (a sugestão da IA e o agradecimento chegam em segundo plano). */
const RELER_MS = 20_000;

/**
 * O filtro "Marcações" da gaveta "💬 Comentários" (mig 387, protótipo v18): o @ da loja no post, reels ou comentário de
 * outra pessoa e a menção no story, dos últimos 30 dias, da mais nova à mais velha.
 */
export function MarcacoesDoInstagram({
  podeAgir,
  aoAbrirCaso,
  aoContar,
}: {
  podeAgir: boolean;
  aoAbrirCaso: (casoId: string) => void;
  /** Avisa a gaveta do total (o número no filtro). */
  aoContar: (todas: number) => void;
}) {
  const [itens, setItens] = useState<MarcacaoDoInstagram[]>([]);
  const [ajustes, setAjustes] = useState<ListaDeMarcacoes['ajustes'] | null>(null);
  const [proximo, setProximo] = useState<string | null>(null);
  const [situacao, setSituacao] = useState<'lendo' | 'pronta' | 'erro'>('lendo');
  const [lendoMais, setLendoMais] = useState(false);
  // Só a leitura mais nova vale (V64).
  const leitura = useRef(0);
  // Quantas páginas a pessoa abriu: a releitura silenciosa só troca a primeira (o resto fica como está).
  const paginas = useRef(1);

  const ler = useCallback(
    async (silencioso = false) => {
      const n = ++leitura.current;
      if (!silencioso) setSituacao('lendo');
      try {
        const r = (await api.atendimentoMarcacoes()) as ListaDeMarcacoes;
        if (n !== leitura.current) return;
        const novos = Array.isArray(r?.itens) ? r.itens : [];
        setItens((a) => {
          if (!silencioso || paginas.current === 1) return novos;
          // Com mais páginas abertas: a primeira página nova na frente, as outras sem os repetidos.
          const vistos = new Set(novos.map((x) => x.id));
          return [...novos, ...a.filter((x) => !vistos.has(x.id))];
        });
        if (!silencioso || paginas.current === 1) setProximo(r?.proximo ?? null);
        setAjustes(r?.ajustes ?? null);
        aoContar(Number(r?.contagem?.todas ?? 0));
        setSituacao('pronta');
      } catch {
        if (n !== leitura.current) return;
        if (!silencioso) setSituacao('erro');
      }
    },
    [aoContar],
  );

  useEffect(() => {
    paginas.current = 1;
    void ler();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void ler(true);
    }, RELER_MS);
    return () => clearInterval(t);
  }, [ler]);

  async function verMais() {
    if (!proximo) return;
    setLendoMais(true);
    const n = leitura.current;
    try {
      const r = (await api.atendimentoMarcacoes(proximo)) as ListaDeMarcacoes;
      if (n !== leitura.current) return;
      paginas.current += 1;
      setItens((a) => {
        const vistos = new Set(a.map((x) => x.id));
        return [...a, ...(r.itens ?? []).filter((x) => !vistos.has(x.id))];
      });
      setProximo(r.proximo ?? null);
    } catch {
      setSituacao('erro');
    } finally {
      setLendoMais(false);
    }
  }

  // Mudou uma marcação (publicou, ignorou): troca no lugar (não pula da lista) e relê em silêncio.
  const mudou = (m: MarcacaoDoInstagram) => {
    setItens((a) => a.map((x) => (x.id === m.id ? m : x)));
    void ler(true);
  };

  return (
    <>
      <p className="text-sm text-secondary-foreground">{ajudaDasMarcacoes(ajustes)}</p>
      <div className="space-y-2.5" aria-live="polite" aria-busy={situacao === 'lendo'}>
        {situacao === 'lendo' ? (
          <p className="py-8 text-center text-sm text-secondary-foreground">Lendo as marcações…</p>
        ) : situacao === 'erro' ? (
          <div className="space-y-2 rounded-md border border-dashed border-border p-4 text-center text-sm" role="status">
            <p>
              <b>Não consegui ler as marcações agora.</b> Elas continuam no Instagram.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={() => void ler()}>
              Tentar de novo
            </Button>
          </div>
        ) : itens.length === 0 ? (
          <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-secondary-foreground" role="status">
            <b className="text-foreground">Nenhuma marcação nos últimos 30 dias.</b>
            <br />
            Quando alguém marcar a loja (@) num post ou no story, aparece aqui.
          </div>
        ) : (
          itens.map((m) => <MarcacaoCartao key={m.id} marcacao={m} podeAgir={podeAgir} aoMudar={mudou} aoAbrirCaso={aoAbrirCaso} />)
        )}
      </div>
      {situacao === 'pronta' && proximo && (
        <Button type="button" variant="outline" onClick={() => void verMais()} disabled={lendoMais}>
          {lendoMais ? 'Lendo…' : 'Ver mais marcações'}
        </Button>
      )}
    </>
  );
}
