'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  MapaEntregadores,
  horaCurta,
  minAtras,
  type Centro,
  type EntregadorAoVivo,
} from '@/components/delivery/mapa-entregadores';

// MAPA DOS ENTREGADORES NO KDS (mig 293) — o "Mapa ao vivo" do delivery numa tela de KDS, para a
// cozinha/expedição acompanhar quem está na rua. Só aparece se o gestor ligou a chave da loja
// (Delivery → Configurações); cada tela escolhe no ⚙ se mostra os pedidos ou o mapa.
// Mesma disposição do Mapa ao vivo (mapa + "Em rota agora"), nas cores e no tamanho do KDS.

type Tema = { bg: string; panel: string; panel2: string; border: string; text: string; muted: string };
type Resposta = {
  habilitado?: boolean;
  centro?: Centro;
  entregadores?: EntregadorAoVivo[];
  semConexao?: boolean;
};

export function KdsMapaEntregadores({
  T,
  escuro,
  esc,
  onDesligado,
}: {
  T: Tema;
  escuro: boolean;
  esc: number; // tamanho escolhido no ⚙ (o mesmo dos cards)
  onDesligado: () => void; // o gestor desligou a chave: a tela volta aos pedidos
}) {
  const [vivos, setVivos] = useState<EntregadorAoVivo[]>([]);
  const [centro, setCentro] = useState<Centro>(null);
  const [semConexao, setSemConexao] = useState(false);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const r = (await api.entregadoresAoVivoKds()) as Resposta;
      if (r?.habilitado === false) {
        onDesligado();
        return;
      }
      setVivos(Array.isArray(r?.entregadores) ? r.entregadores : []);
      if (r?.centro) setCentro(r.centro);
      setSemConexao(r?.semConexao === true);
    } catch {
      setSemConexao(true); // o servidor não respondeu: mantém o último mapa e avisa
    } finally {
      setCarregando(false);
    }
  }, [onDesligado]);

  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 15000);
    const onVis = () => {
      if (typeof document !== 'undefined' && !document.hidden) carregar();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [carregar]);

  const emRota = vivos.filter((v) => v.em_rota > 0).length;

  return (
    <section aria-label="Entregadores ao vivo" className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <div className="overflow-hidden rounded-[14px] border" style={{ borderColor: T.border, background: T.panel }}>
        {semConexao && (
          <div
            role="status"
            className="px-4 py-2 text-[13px] font-semibold"
            style={{ background: 'rgba(226,163,64,.18)', color: T.text }}
          >
            Sem conexão com a nuvem — a posição dos entregadores volta sozinha quando a internet voltar.
          </div>
        )}
        <MapaEntregadores
          centro={centro}
          entregadores={vivos}
          escuro={escuro}
          escala={Math.max(1.15, esc)}
          className="h-[58dvh] w-full lg:h-[calc(100dvh-150px)]"
        />
      </div>

      <div className="rounded-[14px] border p-4" style={{ borderColor: T.border, background: T.panel }}>
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 className="font-extrabold" style={{ fontFamily: 'Archivo, sans-serif', fontSize: 18 * esc }}>
            Em rota agora
          </h2>
          <span className="tabular-nums" style={{ color: T.muted, fontFamily: 'JetBrains Mono, monospace', fontSize: 13 * esc }}>
            {emRota}/{vivos.length}
          </span>
        </div>
        {carregando ? (
          <p style={{ color: T.muted }}>Carregando…</p>
        ) : vivos.length === 0 ? (
          <div className="rounded-[10px] border border-dashed p-5 text-center" style={{ borderColor: T.border, color: T.muted, fontSize: 14 * esc }}>
            Nenhum entregador transmitindo posição agora. Aparecem aqui quando estão com uma entrega ativa no app.
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {vivos.map((v) => {
              const m = minAtras(v.criado_em);
              return (
                <li
                  key={v.colaborador_id}
                  className="flex items-center justify-between gap-3 rounded-[10px] border px-3 py-2.5"
                  style={{ borderColor: T.border, background: T.panel2 }}
                >
                  <div className="min-w-0">
                    <p className="truncate font-bold" style={{ fontSize: 16 * esc }}>🛵 {v.nome || 'Entregador'}</p>
                    <p className="truncate" style={{ color: T.muted, fontSize: 13 * esc }}>
                      {v.em_rota > 0
                        ? `${v.em_rota} em rota${v.pedidos?.length ? ` · #${v.pedidos.join(', #')}` : ''}`
                        : 'sem pedido em rota'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    <p style={{ fontSize: 13 * esc }}>{horaCurta(v.criado_em)}</p>
                    <p style={{ color: T.muted, fontSize: 12 * esc }}>
                      {m === 0 ? 'agora' : m != null ? `há ${m} min` : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
