'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { ACAO_KDS, type TemaKds } from '@/lib/kds-tema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "Configurar este KDS" (Cozinha em estações; decisões do dono em 21/10/2026). Em gaveta, como as outras edições do app.
//  · LUGAR NO FLUXO (entrega 2): estação de preparo — com "quando ficar pronto, vai para" outro KDS ou "termina aqui" —
//    ou KDS de despacho (vê o pedido inteiro e libera quando todas as estações terminam).
//  · PRODUTOS (entrega 1): os que esta tela mostra. A lista vem do Direcionamento (só produtos que vão para a produção) e
//    a gravação é a lista inteira: entra o marcado, sai o desmarcado. No despacho, são os que vêm direto para ele (bebida,
//    molho). O produto que nenhum KDS marcar sai na impressora da cozinha, como hoje.
// As cores de texto vêm do tema (medidas nos dois temas — ERR-264).
export function KdsProdutosGaveta({
  kds,
  telas,
  T,
  onFechar,
  onFluxoSalvo,
}: {
  kds: { id: string; nome: string; escopo?: string | null; proximoKdsId?: string | null };
  telas: { id: string; nome: string; escopo?: string | null; proximoKdsId?: string | null }[];
  T: TemaKds;
  onFechar: () => void;
  onFluxoSalvo: () => void;
}) {
  const papelSalvo: 'estacao' | 'despacho' = kds.escopo === 'despacho' ? 'despacho' : 'estacao';
  const [papel, setPapel] = useState<'estacao' | 'despacho'>(papelSalvo);
  const [vaiPara, setVaiPara] = useState(kds.proximoKdsId ?? ''); // '' = termina aqui
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

  // Para onde este KDS pode mandar: os outros KDS da loja. De quem ele recebe: quem manda para ele.
  const destinos = telas.filter((t) => t.id !== kds.id);
  const recebeDe = telas.filter((t) => t.id !== kds.id && t.proximoKdsId === kds.id).map((t) => t.nome);

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
      const proximo = papel === 'despacho' ? null : vaiPara || null;
      const fluxoMudou = papel !== papelSalvo || proximo !== (kds.proximoKdsId ?? null);
      if (fluxoMudou) {
        await api.salvarKdsFluxo(kds.id, { papel, proximoKdsId: proximo });
        onFluxoSalvo();
      }
      const r: any = await api.salvarKdsProdutos(kds.id, [...marcados]);
      setAviso(fluxoMudou || r?.entraram || r?.sairam ? `Ajustes do ${kds.nome} salvos.` : `Nada mudou no ${kds.nome}.`);
    } catch (e: any) {
      setErro(e?.message ?? 'Não consegui salvar. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  const total = produtos?.length ?? 0;
  const linha = { borderColor: T.border };
  const opcao = 'flex min-h-[44px] cursor-pointer items-start gap-3 border px-3 py-2.5 text-[15px]';

  return (
    <div className="fixed inset-0 z-40 flex justify-end" style={{ background: 'rgba(15, 34, 48, 0.45)' }} onClick={onFechar}>
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
              O lugar dele no fluxo e os produtos que aparecem aqui. O que nenhum KDS marcar sai na impressora da cozinha.
            </p>
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="grid h-11 w-11 flex-none place-items-center text-[18px]" style={{ color: T.muted }}>
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <fieldset className="mb-4">
            <legend className="mb-2 text-[14px] font-bold">Lugar no fluxo</legend>
            <div className="grid gap-1">
              <label className={opcao} style={{ ...linha, background: papel === 'estacao' ? T.panel2 : T.panel }}>
                <input type="radio" name="kds-papel" checked={papel === 'estacao'} onChange={() => setPapel('estacao')} className="mt-0.5 h-[18px] w-[18px]" style={{ accentColor: ACAO_KDS.fundo }} />
                <span className="min-w-0">
                  <span className="block font-bold">Estação de preparo</span>
                  <span className="block text-[13px]" style={{ color: T.muted }}>
                    {recebeDe.length ? `Recebe de: ${recebeDe.join(', ')}. ` : ''}Recebe os pedidos dos produtos marcados abaixo.
                  </span>
                </span>
              </label>
              <label className={opcao} style={{ ...linha, background: papel === 'despacho' ? T.panel2 : T.panel }}>
                <input type="radio" name="kds-papel" checked={papel === 'despacho'} onChange={() => setPapel('despacho')} className="mt-0.5 h-[18px] w-[18px]" style={{ accentColor: ACAO_KDS.fundo }} />
                <span className="min-w-0">
                  <span className="block font-bold">KDS de despacho</span>
                  <span className="block text-[13px]" style={{ color: T.muted }}>
                    Vê o pedido inteiro, com o andamento de cada estação, e só libera quando todas terminam (o gestor pode liberar
                    antes, com a senha).
                  </span>
                </span>
              </label>
            </div>

            {papel === 'estacao' && (
              <label className="mt-3 block">
                <span className="mb-1 block text-[14px] font-bold">Quando ficar pronto, vai para</span>
                <select
                  value={vaiPara}
                  onChange={(e) => setVaiPara(e.target.value)}
                  className="min-h-[44px] w-full max-w-full border px-3 text-[15px]"
                  style={{ ...linha, background: T.panel2, color: T.text }}
                >
                  <option value="">Termina aqui (a senha vai para a tela de senhas, se a loja usa uma)</option>
                  {destinos.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nome}
                      {t.escopo === 'despacho' ? ' (despacho)' : ''}
                    </option>
                  ))}
                </select>
                <span className="mt-1 block text-[13px]" style={{ color: T.muted }}>
                  Quando esta estação marca pronto, o cartão passa para o KDS escolhido e começa lá como recebido.
                </span>
              </label>
            )}
          </fieldset>

          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-[14px] font-bold">{papel === 'despacho' ? 'Produtos que vêm direto para cá (bebidas, molhos)' : 'Produtos que aparecem aqui'}</span>
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
              Nenhum produto vai para a produção. Marque &quot;Vai para a produção&quot; no cadastro do produto (Cadastros › Cardápio).
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
                    <button type="button" onClick={() => alternarCategoria(lista)} className="min-h-[36px] px-1 text-[13px] font-bold" style={{ color: T.link }}>
                      {todos ? 'Desmarcar todos' : 'Marcar todos'}
                    </button>
                  </div>
                  {lista.map((p) => (
                    <label key={p.id} className="flex min-h-[44px] cursor-pointer items-center gap-3 border-t px-3 text-[15px]" style={linha}>
                      <input type="checkbox" checked={marcados.has(p.id)} onChange={() => alternar(p.id)} className="h-[18px] w-[18px]" style={{ accentColor: ACAO_KDS.fundo }} />
                      <span className="min-w-0 flex-1 break-words">{p.nome}</span>
                    </label>
                  ))}
                </section>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3" style={linha}>
          <span role="status" className="mr-auto text-[14px] font-semibold" style={{ color: erro ? T.erro : T.feito }}>
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
            style={{ background: ACAO_KDS.fundo, color: ACAO_KDS.texto }}
          >
            {salvando ? 'Salvando…' : 'Salvar ajustes deste KDS'}
          </button>
        </div>
      </aside>
    </div>
  );
}
