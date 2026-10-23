'use client';

import { useEffect, useRef, useState } from 'react';
import { ACAO_KDS, type TemaKds } from '@/lib/kds-tema';
import { useSenhaSemSalvar } from '@/lib/use-senha-sem-salvar';
import {
  acoesDoDespacho,
  agregarItens,
  corDoPedido,
  identPedido,
  minutosDesde,
  rotuloDaEstacao,
  type LimitesTempo,
} from '@/lib/kds-fila';

/* eslint-disable @typescript-eslint/no-explicit-any */

const MONO = 'JetBrains Mono, monospace';
const TITULO = 'Archivo, sans-serif';

// KDS DE DESPACHO (Cozinha em estações, entrega 2; decisão do dono em 21/10/2026): um cartão por PEDIDO, com o andamento
// de cada estação ("Chapa ✓ · Montagem · 2 min") e os itens de todas — a bebida e o molho já chegam aqui. "Despachar"
// (delivery) / "Pronto: chamar a senha" só com todas as estações prontas; com estação faltando, o gestor libera com a
// senha ("Despachar assim mesmo"). Depois, "Entregue". Mockup: `mockups/regem-kds-estacoes.html`, aba Despacho.
// A cor do cartão continua sendo só a do tempo (cabeçalho), como nos outros KDS.
export function KdsDespacho({
  pedidos,
  limites,
  agoraMs,
  T,
  esc,
  carregando,
  onAcao,
  onDialogo,
}: {
  pedidos: any[];
  limites: LimitesTempo;
  agoraMs: number;
  T: TemaKds;
  esc: number;
  carregando: boolean;
  onAcao: (p: any, acao: 'pronto' | 'entregue', senha?: string) => Promise<string | null>;
  onDialogo?: (aberto: boolean) => void; // a página para o teclado da senha do KDS enquanto o diálogo está aberto
}) {
  const [msg, setMsg] = useState<{ texto: string; erro: boolean } | null>(null);
  const [ocupado, setOcupado] = useState('');
  const [liberar, setLiberar] = useState<any | null>(null); // pedido do "Despachar assim mesmo" (pede a senha)
  const [senha, setSenha] = useState('');
  const campoSenha = useRef<HTMLInputElement | null>(null);
  const senhaSemSalvar = useSenhaSemSalvar(); // nem preenchida nem guardada pelo navegador (aparelho compartilhado)

  // Diálogo aberto: Esc fecha de qualquer lugar (o foco sai do diálogo quando o botão fica "Liberando…"), e a página
  // sabe que o teclado é dele — sem isso, o número digitado ia para a senha do KDS, atrás do diálogo.
  useEffect(() => {
    onDialogo?.(!!liberar);
    if (!liberar) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLiberar(null);
    };
    window.addEventListener('keydown', tecla);
    return () => window.removeEventListener('keydown', tecla);
  }, [liberar, onDialogo]);
  useEffect(() => () => onDialogo?.(false), [onDialogo]);

  async function agir(p: any, acao: 'pronto' | 'entregue', senhaGestor?: string) {
    setOcupado(p.comandaId);
    setMsg(null);
    const erro = await onAcao(p, acao, senhaGestor);
    setOcupado('');
    if (erro) {
      setMsg({ texto: erro, erro: true });
      if (senhaGestor !== undefined) {
        // Senha recusada: o foco volta ao campo, pronta para digitar de novo.
        setSenha('');
        setTimeout(() => campoSenha.current?.focus(), 0);
      }
    } else {
      setMsg({ texto: `${identPedido(p)}: ${acao === 'entregue' ? 'entregue' : p.origem === 'delivery' ? 'despachado' : 'pronto'}.`, erro: false });
      setLiberar(null);
      setSenha('');
    }
    return erro;
  }

  if (!carregando && pedidos.length === 0) {
    return (
      <div className="border border-dashed px-6 py-14 text-center text-sm" style={{ borderColor: T.border, color: T.muted }}>
        Nenhum pedido no despacho. Os pedidos aparecem aqui assim que entram, com o andamento de cada estação.
      </div>
    );
  }

  return (
    <section aria-label="Pedidos no despacho">
      <p role="status" className="mb-2 min-h-[20px] text-[14px] font-semibold" style={{ color: msg?.erro ? T.erro : T.feito }}>
        {msg?.texto ?? ''}
      </p>
      <div className="grid" style={{ gap: 4, gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${Math.round(300 * esc)}px), 1fr))` }}>
        {pedidos.map((p) => {
          const min = minutosDesde(p.criadoEm, agoraMs);
          const cor = corDoPedido(p, min, limites);
          const cancelado = p.situacao === 'cancelado';
          const { principal, forcar } = acoesDoDespacho(p);
          const itens = agregarItens(p.itens ?? []);
          const fs = (px: number) => Math.round(px * esc);
          return (
            <article key={p.comandaId} className="flex min-w-0 flex-col border" style={{ background: T.panel, borderColor: T.border, color: T.text }}>
              <header className="flex items-center justify-between gap-2 px-3 py-2" style={{ background: cor.fundo, color: cor.texto }}>
                <span className="min-w-0 truncate font-extrabold" style={{ fontFamily: TITULO, fontSize: fs(22) }}>
                  {identPedido(p)}
                  {p.plataforma ? <span className="ml-2 font-bold" style={{ fontSize: fs(13) }}>{p.plataforma}</span> : null}
                </span>
                <span className="flex-none font-bold tabular-nums" style={{ fontFamily: MONO, fontSize: fs(16) }}>
                  {cancelado ? 'CANCELADO' : `${min} min`}
                </span>
              </header>

              <div className="flex flex-1 flex-col gap-2 px-3 py-2">
                {p.estacoes?.length > 0 && (
                  <ul aria-label="Andamento das estações" className="flex flex-wrap gap-1">
                    {p.estacoes.map((e: any) => (
                      <li
                        key={e.kds}
                        className="border px-2 py-0.5 font-semibold"
                        style={{
                          fontSize: fs(13),
                          borderColor: T.border,
                          background: e.estado === 'feito' ? T.panel : T.panel2,
                          color: e.estado === 'feito' ? T.feito : T.text,
                        }}
                      >
                        {rotuloDaEstacao(e, agoraMs)}
                      </li>
                    ))}
                  </ul>
                )}

                <ul className="grid gap-0.5" style={{ fontSize: fs(16) }}>
                  {itens.map((it: any, i: number) => (
                    <li key={`${it.descricao}-${i}`} className="break-words" style={{ textDecoration: cancelado ? 'line-through' : undefined }}>
                      <span className="font-bold tabular-nums" style={{ fontFamily: MONO }}>{Number(it.quantidade)}×</span> {it.descricao}
                      {it.complementosTexto ? <span style={{ color: T.muted }}> · {it.complementosTexto}</span> : null}
                      {it.observacao ? <span className="block font-semibold" style={{ color: T.muted, fontSize: fs(14) }}>Obs.: {it.observacao}</span> : null}
                    </li>
                  ))}
                </ul>

                {p.alterado && !cancelado && (
                  <p className="font-bold uppercase tracking-wider" style={{ fontSize: fs(12), color: T.text }}>Alterado depois de entrar</p>
                )}
                {p.logistica?.status === 130 && (
                  <p className="font-semibold" style={{ fontSize: fs(14) }}>🛵 entregador da 99 chegou</p>
                )}
                {p.situacao === 'preparando' && p.falta?.length > 0 && (
                  <p className="font-bold" style={{ fontSize: fs(15) }}>Falta: {p.falta.join(', ')}</p>
                )}
                {p.situacao === 'pronto' && (
                  <p className="font-semibold" style={{ fontSize: fs(14), color: T.muted }}>
                    {p.origem === 'delivery' ? 'Pronto para o entregador.' : 'Pronto: chame a senha no balcão.'}
                  </p>
                )}
                {cancelado && (
                  <p className="font-bold" style={{ fontSize: fs(15), color: T.erro }}>Cancelado: não ponha na sacola.</p>
                )}
              </div>

              {principal && (
                <div className="flex flex-wrap gap-1 border-t p-2" style={{ borderColor: T.border }}>
                  <button
                    type="button"
                    disabled={!principal.liberada || ocupado === p.comandaId}
                    onClick={() => agir(p, principal.acao)}
                    // Largura mínima: no cartão estreito o botão do gestor desce para a linha de baixo, em vez de espremer
                    // "Pronto: chamar a senha" em três linhas (visto na tela de verdade).
                    className="min-h-[48px] min-w-[12rem] flex-1 px-3 font-extrabold disabled:cursor-not-allowed"
                    style={{
                      fontSize: fs(16),
                      background: principal.liberada ? ACAO_KDS.fundo : T.panel2,
                      color: principal.liberada ? ACAO_KDS.texto : T.muted,
                    }}
                    title={principal.liberada ? undefined : 'Libera quando todas as estações terminarem'}
                  >
                    {ocupado === p.comandaId ? 'Aguarde…' : principal.rotulo}
                  </button>
                  {forcar && (
                    <button
                      type="button"
                      onClick={() => {
                        setLiberar(p);
                        setSenha('');
                        setMsg(null);
                      }}
                      className="min-h-[48px] min-w-[12rem] flex-1 border px-3 font-bold"
                      style={{ fontSize: fs(14), borderColor: T.border, background: T.panel, color: T.text }}
                    >
                      {p.origem === 'delivery' ? 'Despachar' : 'Chamar'} assim mesmo (gestor)
                    </button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      {liberar && (
        <div className="fixed inset-0 z-40 grid place-items-center px-4" style={{ background: 'rgba(15, 34, 48, 0.45)' }} onClick={() => setLiberar(null)}>
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="kds-liberar-titulo"
            className="w-full max-w-[420px] border p-4"
            style={{ background: T.panel, borderColor: T.border, color: T.text }}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void agir(liberar, 'pronto', senha);
            }}
          >
            <h2 id="kds-liberar-titulo" className="text-[18px] font-extrabold" style={{ fontFamily: TITULO }}>
              {liberar.origem === 'delivery' ? 'Despachar' : 'Chamar a senha de'} {identPedido(liberar)} sem todas as estações?
            </h2>
            <p className="mt-1 text-[14px]" style={{ color: T.muted }}>
              Falta: {(liberar.falta ?? []).join(', ') || 'uma estação'}. O cartão sai das estações que faltam, e a liberação fica no
              histórico com o nome de quem autorizou.
            </p>
            <label className="mt-3 block text-[14px] font-bold" htmlFor="kds-senha-gestor">
              Senha do gestor (presidente ou gerente)
            </label>
            {/* O aparelho da cozinha é compartilhado: o navegador não preenche (V54) nem oferece guardar esta senha — o
                campo é texto com a máscara de pontos (`useSenhaSemSalvar`); `new-password` só impedia preencher. */}
            <input
              ref={campoSenha}
              id="kds-senha-gestor"
              {...senhaSemSalvar}
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              autoFocus
              className="mt-1 min-h-[44px] w-full border px-3 text-[15px]"
              style={{ borderColor: T.border, background: T.panel2, color: T.text }}
            />
            {msg?.erro && (
              <p role="alert" className="mt-2 text-[14px] font-semibold" style={{ color: T.erro }}>
                {msg.texto}
              </p>
            )}
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => setLiberar(null)} className="min-h-[44px] border px-4 text-[14px] font-bold" style={{ borderColor: T.border, background: T.panel, color: T.text }}>
                Voltar
              </button>
              <button
                type="submit"
                disabled={!senha || ocupado === liberar.comandaId}
                className="min-h-[44px] px-4 text-[14px] font-extrabold disabled:opacity-60"
                style={{ background: ACAO_KDS.fundo, color: ACAO_KDS.texto }}
              >
                {ocupado === liberar.comandaId ? 'Liberando…' : 'Liberar com a senha'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
