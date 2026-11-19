'use client';

import { useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Gaveta } from '@/components/ui/sobreposto';
import { MarcarAlergenos } from '@/components/alergenos/marcar-alergenos';
import { comMaiuscula, listaParaLer, marcacaoDe, marcacaoVazia, rotuloDoAlergeno, type MarcacaoDeAlergenos } from '@/lib/alergenos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A GAVETA "ALÉRGENOS DO PRODUTO" (mig 454, D2 — protótipo `regem-atendente-alergenos-agendado.html`): o que o produto
// herda pela ficha técnica (cada insumo com a marcação dele), o resumo de como fica para o cliente e o ajuste à mão (A3: só
// soma cautela; no produto sem ficha é a própria marcação). Salvar manda só `alergenosAjuste` (PATCH parcial do produto).

export type AlergenosDoProdutoLinha = {
  id: string;
  nome: string;
  categoria: string | null;
  temFicha: boolean;
  revenda: boolean;
  tipo: string;
  situacao: 'informado' | 'parcial' | 'nao_informado';
  origem: 'ficha' | 'mao' | 'nenhuma';
  contem: string[];
  podeConter: string[];
  naoInformados: string[];
  gluten: 'sim' | 'nao' | null;
  lactose: 'sim' | 'nao' | null;
  faltaConferir: string[];
  folhas: Array<{ nome: string; itemId: string | null; marcacao: any }>;
  ajuste: any;
  seloContradiz: string | null;
};

const texto2 = 'text-secondary-foreground';

function Marcacao({ m }: { m: any }) {
  const v = marcacaoDe(m);
  if (!m || !v.conferido) {
    const sabe = [...v.contem.map(rotuloDoAlergeno), ...v.podeConter.map((a) => `pode conter ${rotuloDoAlergeno(a).toLowerCase()}`)];
    return <span className={`text-xs ${texto2}`}>Não informado{sabe.length ? ` · ${sabe.join(', ')}` : ' · ninguém conferiu o rótulo'}</span>;
  }
  const partes = [...v.contem.map(rotuloDoAlergeno), ...v.podeConter.map((a) => `Pode conter ${rotuloDoAlergeno(a).toLowerCase()}`)];
  return <span className="text-xs">{partes.length ? partes.join(' · ') : 'Nenhum da lista'}</span>;
}

/** O resumo de como fica para o cliente (as mesmas linhas da página do produto). */
export function ResumoParaOCliente({ p }: { p: Pick<AlergenosDoProdutoLinha, 'situacao' | 'contem' | 'podeConter' | 'gluten' | 'lactose' | 'naoInformados'> }) {
  const gl = p.gluten === 'sim' ? 'contém glúten' : p.gluten === 'nao' ? 'não contém glúten' : null;
  const la = p.lactose === 'sim' ? 'contém lactose' : p.lactose === 'nao' ? 'não contém lactose' : null;
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
      <dt className="font-semibold">Contém</dt>
      <dd>{p.contem.length ? comMaiuscula(listaParaLer(p.contem)) : '—'}</dd>
      <dt className="font-semibold">Pode conter</dt>
      <dd>{p.podeConter.length ? comMaiuscula(listaParaLer(p.podeConter)) : '—'}</dd>
      <dt className="font-semibold">Glúten e lactose</dt>
      <dd>{[gl, la].filter(Boolean).join(' · ') || 'sem resposta'}</dd>
      <dt className="font-semibold">Os outros</dt>
      <dd>{p.situacao === 'informado' ? 'Não contém' : `Não informado (${p.naoInformados.length} da lista)`}</dd>
    </dl>
  );
}

export function AlergenosProdutoGaveta({ p, aoFechar, aoSalvar }: { p: AlergenosDoProdutoLinha; aoFechar: () => void; aoSalvar: () => void }) {
  const [ajuste, setAjuste] = useState<MarcacaoDeAlergenos>(() => marcacaoDe(p.ajuste));
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const comFolhas = p.folhas.length > 0;
  // O que vem da ficha que CONTÉM fica travado no ajuste (A3): não se desmarca aqui.
  const daFicha = [...new Set(p.folhas.flatMap((f) => (marcacaoDe(f.marcacao).conferido ? marcacaoDe(f.marcacao).contem : [])))];

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    setErro('');
    try {
      const enviar = { ...ajuste, contem: ajuste.contem.filter((a) => !daFicha.includes(a)) };
      await api.patch(`/produtos/${p.id}`, { alergenosAjuste: marcacaoVazia(enviar) ? null : enviar });
      toast.success('Alérgenos do produto salvos.');
      aoSalvar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para salvar os alérgenos.');
    } finally {
      setSalvando(false);
    }
  }

  const deOnde = p.temFicha ? 'ficha técnica' : p.revenda ? 'item do estoque (revenda)' : p.tipo === 'combo' ? 'produtos do combo' : null;
  return (
    <Gaveta
      titulo={`Alérgenos · ${p.nome}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar produto'}</Button>
        </>
      }
    >
      <div className="space-y-5">
        {comFolhas && (
          <section className="space-y-2" aria-labelledby="alerg-folhas">
            <h3 id="alerg-folhas" className="font-display text-sm font-bold">O produto herda pela {deOnde}</h3>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {p.folhas.map((f, i) => (
                <li key={`${f.itemId ?? f.nome}-${i}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span className="min-w-0 break-words text-sm font-semibold">{f.nome}</span>
                  <Marcacao m={f.marcacao} />
                </li>
              ))}
            </ul>
            {p.faltaConferir.length > 0 && (
              <p className={`text-xs ${texto2}`}>
                Falta conferir: <b>{p.faltaConferir.join(', ')}</b>. Marque em{' '}
                <Link href="/operacao?aba=produtos" className="font-semibold text-foreground underline underline-offset-2">Estoque › Produtos</Link>{' '}
                (a gaveta do insumo, grupo &quot;Alérgenos e restrições&quot;). Enquanto isso, o que não se sabe fica &quot;não informado&quot;.
              </p>
            )}
          </section>
        )}

        <section className="space-y-2 rounded-lg border border-border bg-secondary/40 p-3" aria-labelledby="alerg-resumo">
          <h3 id="alerg-resumo" className="font-display text-sm font-bold">Como fica para o cliente</h3>
          <ResumoParaOCliente p={p} />
          {p.situacao !== 'informado' && (
            <p className={`text-xs ${texto2}`}>Enquanto não estiver informado, a página do produto no cardápio fica como é hoje e o atendente oferece confirmar com a equipe.</p>
          )}
          {p.seloContradiz && <p role="alert" className="text-xs font-semibold text-destructive">{p.seloContradiz} Tire o selo do produto.</p>}
        </section>

        <section className="space-y-2" aria-labelledby="alerg-ajuste">
          <h3 id="alerg-ajuste" className="font-display text-sm font-bold">{comFolhas ? 'Ajustar no produto' : 'No produto, à mão'}</h3>
          <p className={`text-xs ${texto2}`}>
            {comFolhas
              ? 'O ajuste serve para somar cautela ("pode conter — contato no preparo"). O que a ficha diz que contém não se apaga aqui: corrige-se o insumo.'
              : 'Este produto não tem ficha técnica: marque aqui o que ele contém e confira.'}
          </p>
          <MarcarAlergenos modo="produto" temFicha={comFolhas} valor={ajuste} aoMudar={setAjuste} travadosContem={daFicha} />
        </section>

        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{erro}</p>}
      </div>
    </Gaveta>
  );
}
