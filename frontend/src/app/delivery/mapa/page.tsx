'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import {
  MapaEntregadores,
  horaCurta,
  minAtras,
  type Centro,
  type EntregadorAoVivo,
} from '@/components/delivery/mapa-entregadores';

// E2b — mapa dos entregadores ao vivo: última posição de cada entregador da loja nos últimos
// 15 min + os pedidos em rota. No servidor da loja a posição vem da nuvem (sem internet: aviso).
type AoVivo = { centro?: Centro; entregadores?: EntregadorAoVivo[]; semConexao?: boolean };

export default function MapaEntregadoresPage() {
  const [vivos, setVivos] = useState<EntregadorAoVivo[]>([]);
  const [centro, setCentro] = useState<Centro>(null);
  const [semConexao, setSemConexao] = useState(false);
  const [carregando, setCarregando] = useState(true);

  const carregar = useCallback(async () => {
    // Não consome tráfego enquanto a aba está oculta.
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const r = (await api.entregadoresAoVivo()) as AoVivo;
      setVivos(Array.isArray(r?.entregadores) ? r.entregadores : []);
      if (r?.centro) setCentro(r.centro);
      setSemConexao(r?.semConexao === true);
    } catch {
      /* silencioso — polling */
    } finally {
      setCarregando(false);
    }
  }, []);

  // Polling a cada 15s; recarrega ao voltar pra aba (e pausa quando oculta).
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

  return (
    <Shell>
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Delivery</p>
        <h1 className="text-2xl font-bold">Mapa ao vivo</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Centrado na sua loja 🏪. Entregadores em rota — última posição dos últimos 15 minutos. Atualiza
          sozinho a cada 15s (pausa quando a aba está em segundo plano).
        </p>
        {semConexao && (
          <p role="status" className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Sem conexão com a nuvem agora — a posição dos entregadores volta sozinha quando a internet da loja
            voltar.
          </p>
        )}
        {!carregando && !semConexao && !centro && (
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            A loja ainda não tem coordenadas definidas — o mapa não consegue centralizar. Defina o endereço da
            loja em <span className="font-medium">Delivery → Configurações</span>.
          </p>
        )}

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="overflow-hidden p-0 lg:col-span-2">
            <MapaEntregadores centro={centro} entregadores={vivos} />
          </Card>

          <Card className="p-4">
            <h2 className="mb-3 text-sm font-semibold">
              Em rota agora {vivos.length > 0 && <span className="text-muted-foreground">({vivos.length})</span>}
            </h2>
            {carregando ? (
              <p className="text-sm text-muted-foreground">Carregando…</p>
            ) : vivos.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Nenhum entregador transmitindo posição agora. Aparecem aqui quando estão com uma entrega ativa no app.
              </div>
            ) : (
              <ul className="flex flex-col gap-2">
                {vivos.map((v) => {
                  const m = minAtras(v.criado_em);
                  return (
                    <li
                      key={v.colaborador_id}
                      className="flex items-center justify-between rounded-lg border px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">🛵 {v.nome ?? 'Entregador'}</p>
                        <p className="text-xs text-muted-foreground">
                          {v.em_rota > 0
                            ? `${v.em_rota} pedido(s) em rota${v.pedidos?.length ? ` · #${v.pedidos.join(', #')}` : ''}`
                            : 'sem pedido em rota'}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-mono text-xs">{horaCurta(v.criado_em)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {m === 0 ? 'agora' : m != null ? `há ${m} min` : ''}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
