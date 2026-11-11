'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Gaveta } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { APP, efeitoDeLigar, precoNoApp, type CanalConferido, type LinhaConferida, type ProdutoParaLigar } from '@/lib/conferencia-apps';

// "Conferir com os apps" (R3 F4b) — a gaveta "Ligar a um produto do Regem" da linha "só no app": escolher o produto, ver o
// efeito antes (decisão 4: o código passa a ser o do app; quem usava o código antigo deixa de ligar) e ligar. O produto
// copia o "Está no", o preço e a pausa do app — nada muda no app.
export function ConferenciaLigar({
  linha: l,
  canal,
  produtos,
  aoFechar,
  aoLigar,
}: {
  linha: LinhaConferida;
  canal: CanalConferido;
  produtos: ProdutoParaLigar[];
  aoFechar: () => void;
  aoLigar: (produtoId: string) => Promise<void>;
}) {
  const a = APP[canal];
  const [busca, setBusca] = useState('');
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const lista = useMemo(() => {
    const b = semAcento(busca.trim());
    return produtos
      .filter((p) => !b || semAcento(`${p.nome} ${p.codigo ?? ''}`).includes(b))
      .sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR'))
      .slice(0, 60);
  }, [busca, produtos]);
  const p = produtos.find((x) => x.id === escolhido) ?? null;
  const efeito = p ? efeitoDeLigar(p, l, canal) : null;

  return (
    <Gaveta
      titulo={`Ligar a um produto do Regem: ${l.nome}`}
      aoFechar={() => !ocupado && aoFechar()}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={ocupado}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!p || ocupado}
            onClick={async () => {
              if (!p) return;
              setOcupado(true);
              try {
                await aoLigar(p.id);
              } finally {
                setOcupado(false);
              }
            }}
          >
            {ocupado ? 'Ligando…' : 'Ligar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-md border border-border bg-secondary/40 p-3">
          <dt className={texto2}>{a.no.replace(/^./, (x) => x.toUpperCase())}</dt>
          <dd className="min-w-0 break-words font-semibold">{l.nome}</dd>
          <dt className={texto2}>Código PDV</dt>
          <dd className="font-mono">{l.pdv}</dd>
          <dt className={texto2}>Preço</dt>
          <dd className="font-mono">{precoNoApp(l)}</dd>
        </dl>
        <div className="space-y-1">
          <Label htmlFor="ligar-busca">Buscar o produto do Regem</Label>
          <Input id="ligar-busca" type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Nome ou código" autoComplete="off" />
          <p className={`text-xs ${texto2}`}>O código do produto vai ser o {a.do}.</p>
        </div>
        <div role="group" aria-label="Produtos do Regem" className="max-h-72 space-y-1 overflow-y-auto">
          {lista.length === 0 ? (
            <p className={`text-xs ${texto2}`}>Nenhum produto com esse nome.</p>
          ) : (
            lista.map((x) => (
              <button
                key={x.id}
                type="button"
                aria-pressed={escolhido === x.id}
                onClick={() => setEscolhido(x.id)}
                className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  escolhido === x.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary'
                }`}
              >
                <span className="min-w-0">
                  <span className="block break-words font-semibold">{x.nome}</span>
                  <span className={`block text-xs ${texto2}`}>{x.categoriaNome || 'sem categoria'}</span>
                </span>
                <span className={`shrink-0 font-mono text-xs ${(x.codigo ?? '').trim() ? '' : texto2}`}>
                  {(x.codigo ?? '').trim() ? `código ${x.codigo}` : 'sem código'}
                </span>
              </button>
            ))
          )}
        </div>
        {efeito && (
          <div
            aria-live="polite"
            className={`space-y-1 rounded-md border px-3 py-2 ${efeito.tom === 'critico' ? 'border-destructive/40 bg-destructive/10' : 'border-info/40 bg-info/10'}`}
          >
            {efeito.frases.map((f, i) => (
              <p key={f} className={i === 0 ? 'font-semibold' : ''}>
                {f}
              </p>
            ))}
          </div>
        )}
      </div>
    </Gaveta>
  );
}
