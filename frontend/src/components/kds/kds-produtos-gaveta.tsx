'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { TemaKds } from './kds-cartao-pedido';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Cores do Regem nesta gaveta: ação dourada com tinta navy, "Marcar todos" em dourado escuro (legível no branco),
// mensagem de erro em vermelho e de feito em verde escuro (contraste ≥ 4,5:1 no branco).
const COR = {
  acao: '#E2A340',
  acaoTexto: '#0F2230',
  link: '#B57A12',
  erro: '#D92D20',
  feito: '#0B6654',
  veu: 'rgba(15, 34, 48, 0.45)',
};

// "Configurar este KDS" — os produtos que esta tela mostra (Cozinha em estações, entrega 1; decisão do dono em
// 21/10/2026). Em gaveta, como as outras edições do app. A lista vem do Direcionamento (só produtos que vão para a
// produção: os outros nunca viram cartão) e a gravação é a lista inteira: entra o marcado, sai o desmarcado. Com
// algum KDS da loja com produtos, cada venda vira um cartão por KDS; o produto que nenhum KDS marcar sai na impressora
// da cozinha, como hoje.
export function KdsProdutosGaveta({
  kds,
  T,
  onFechar,
}: {
  kds: { id: string; nome: string };
  T: TemaKds;
  onFechar: () => void;
}) {
  const [produtos, setProdutos] = useState<any[] | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [busca, setBusca] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const tituloRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    tituloRef.current?.focus();
    let vivo = true;
    Promise.all([api.direcionamento(), api.kdsProdutos(kds.id)])
      .then(([lista, deste]: any[]) => {
        if (!vivo) return;
        setProdutos((lista ?? []).filter((p: any) => p.vaiParaProducao));
        setMarcados(new Set(deste?.produtoIds ?? []));
      })
      .catch((e: any) => vivo && setErro(e?.message ?? 'Não consegui carregar os produtos.'));
    return () => {
      vivo = false;
    };
  }, [kds.id]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onFechar();
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [onFechar]);

  // Grupos por categoria (na ordem do cadastro), já filtrados pela busca.
  const grupos = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    const mapa = new Map<string, any[]>();
    for (const p of produtos ?? []) {
      if (termo && !String(p.nome).toLowerCase().includes(termo)) continue;
      const cat = p.categoriaNome || 'Sem categoria';
      mapa.set(cat, [...(mapa.get(cat) ?? []), p]);
    }
    return [...mapa.entries()];
  }, [produtos, busca]);

  const alternar = (id: string) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const alternarCategoria = (lista: any[]) =>
    setMarcados((s) => {
      const n = new Set(s);
      const todos = lista.every((p) => n.has(p.id));
      for (const p of lista) {
        if (todos) n.delete(p.id);
        else n.add(p.id);
      }
      return n;
    });

  async function salvar() {
    setSalvando(true);
    setErro('');
    setAviso('');
    try {
      const r: any = await api.salvarKdsProdutos(kds.id, [...marcados]);
      setAviso(
        r?.entraram || r?.sairam ? `Produtos do ${kds.nome} salvos.` : `Nada mudou nos produtos do ${kds.nome}.`,
      );
    } catch (e: any) {
      setErro(e?.message ?? 'Não consegui salvar. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  const total = produtos?.length ?? 0;
  const linha = { borderColor: T.border };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" style={{ background: COR.veu }} onClick={onFechar}>
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="kds-produtos-titulo"
        className="flex h-full w-full max-w-[460px] flex-col border-l shadow-2xl"
        style={{ background: T.panel, color: T.text, ...linha }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b px-4 py-3" style={linha}>
          <div className="min-w-0">
            <h2 id="kds-produtos-titulo" ref={tituloRef} tabIndex={-1} className="text-[18px] font-extrabold outline-none" style={{ fontFamily: 'Archivo, sans-serif' }}>
              Configurar este KDS · {kds.nome}
            </h2>
            <p className="mt-0.5 text-[13px]" style={{ color: T.muted }}>
              Os produtos marcados aparecem aqui. O que nenhum KDS marcar sai na impressora da cozinha.
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="grid h-11 w-11 flex-none place-items-center text-[18px]" style={{ color: T.muted }}>
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[14px] font-bold">Produtos que aparecem aqui</span>
            {produtos && (
              <span className="text-[13px]" style={{ color: T.muted, fontFamily: 'JetBrains Mono, monospace' }}>
                {marcados.size} de {total}
              </span>
            )}
          </div>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar produto"
            aria-label="Buscar produto"
            className="mb-3 min-h-[44px] w-full border px-3 text-[15px]"
            style={{ ...linha, background: T.panel2, color: T.text }}
          />

          {!produtos && !erro && <p className="text-[14px]" style={{ color: T.muted }}>Carregando os produtos…</p>}
          {produtos && total === 0 && (
            <p className="text-[14px]" style={{ color: T.muted }}>
              Nenhum produto vai para a produção. Marque "Vai para a produção" no cadastro do produto (Cadastros › Cardápio).
            </p>
          )}
          {produtos && total > 0 && grupos.length === 0 && (
            <p className="text-[14px]" style={{ color: T.muted }}>Nenhum produto com esse nome.</p>
          )}

          <div className="grid gap-3">
            {grupos.map(([cat, lista]) => {
              const todos = lista.every((p) => marcados.has(p.id));
              return (
                <section key={cat} className="overflow-hidden border" style={linha} aria-label={cat}>
                  <div className="flex items-center justify-between gap-2 px-3 py-2" style={{ background: T.panel2 }}>
                    <span className="text-[14px] font-bold">{cat}</span>
                    <button type="button" onClick={() => alternarCategoria(lista)} className="min-h-[36px] px-1 text-[13px] font-bold" style={{ color: COR.link }}>
                      {todos ? 'Desmarcar todos' : 'Marcar todos'}
                    </button>
                  </div>
                  {lista.map((p) => (
                    <label key={p.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 border-t px-3 text-[15px]" style={linha}>
                      <input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} className="h-[18px] w-[18px]" style={{ accentColor: COR.acao }} />
                      <span className="min-w-0 flex-1 break-words">{p.nome}</span>
                    </label>
                  ))}
                </section>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3" style={linha}>
          <span role="status" className="mr-auto text-[14px] font-semibold" style={{ color: erro ? COR.erro : COR.feito }}>
            {erro || aviso}
          </span>
          <button type="button" onClick={onFechar} className="min-h-[44px] border px-4 text-[14px] font-bold" style={{ ...linha, background: T.panel, color: T.text }}>
            Fechar
          </button>
          <button
            type="button"
            onClick={salvar}
            disabled={salvando || !produtos}
            className="min-h-[44px] px-4 text-[14px] font-bold disabled:opacity-60"
            style={{ background: COR.acao, color: COR.acaoTexto }}
          >
            {salvando ? 'Salvando…' : 'Salvar produtos deste KDS'}
          </button>
        </div>
      </aside>
    </div>
  );
}
