'use client';

import { useCallback, useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import { api, handleApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  MapaEntregadores,
  horaCurta,
  minAtras,
  type Centro,
  type EntregadorAoVivo,
} from '@/components/delivery/mapa-entregadores';
import { ONDE_LIGA, textoDaFaixa, textoDoAviso, type MapaNosKds } from '@/components/delivery/mapa-nos-kds';
import { MapaNosKdsDialogo } from '@/components/delivery/mapa-nos-kds-dialogo';

// E2b — mapa dos entregadores ao vivo: última posição de cada entregador da loja nos últimos
// 15 min + os pedidos em rota. No servidor da loja a posição vem da nuvem (sem internet: aviso).
// Entrega 5 (cozinha em estações): "Mostrar num KDS" manda este mapa para uma ou mais telas de KDS.
type AoVivo = { centro?: Centro; entregadores?: EntregadorAoVivo[]; semConexao?: boolean };

export default function MapaEntregadoresPage() {
  const [vivos, setVivos] = useState<EntregadorAoVivo[]>([]);
  const [centro, setCentro] = useState<Centro>(null);
  const [semConexao, setSemConexao] = useState(false);
  const [carregando, setCarregando] = useState(true);
  // As telas de KDS (null = sem o módulo KDS ou sem acesso: o botão não aparece).
  const [kds, setKds] = useState<MapaNosKds | null>(null);
  const [dialogo, setDialogo] = useState(false);
  const [abrindo, setAbrindo] = useState(false);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    api
      .telasKdsDoMapa()
      .then((r: MapaNosKds) => setKds(r))
      .catch(() => setKds(null));
  }, []);

  // Abre com a lista relida: outra pessoa pode ter mudado os KDS desde que a tela abriu.
  async function abrirDialogo() {
    setAbrindo(true);
    try {
      setKds((await api.telasKdsDoMapa()) as MapaNosKds);
      setDialogo(true);
    } catch (e) {
      toast.error(handleApiError(e, 'Não foi possível abrir a lista dos KDS. Tente de novo.'));
    } finally {
      setAbrindo(false);
    }
  }

  async function gravar(kdsIds: string[]) {
    setSalvando(true);
    try {
      const r = (await api.mostrarMapaNosKds(kdsIds)) as MapaNosKds & { entraram: string[]; sairam: string[] };
      setKds({ ligado: r.ligado, telas: r.telas });
      setDialogo(false);
      // "Tirar de todos" some com a faixa (e com o botão que tinha o foco): o foco vai para o botão do alto.
      if (!kdsIds.length) requestAnimationFrame(() => document.getElementById('mostrar-num-kds')?.focus());
      const aviso = textoDoAviso(r.entraram ?? [], r.sairam ?? [], r.ligado);
      if (r.entraram?.length || r.sairam?.length) toast.success(aviso);
      else toast.info(aviso);
    } catch (e) {
      toast.error(handleApiError(e, 'Não foi possível mandar o mapa para os KDS. Tente de novo.'));
    } finally {
      setSalvando(false);
    }
  }

  const noMapa = (kds?.telas ?? []).filter((t) => t.mapa).map((t) => t.nome);

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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-72">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Delivery</p>
            <h1 className="text-2xl font-bold">Mapa ao vivo</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Centrado na sua loja 🏪. Entregadores em rota — última posição dos últimos 15 minutos. Atualiza
              sozinho a cada 15s (pausa quando a aba está em segundo plano).
            </p>
          </div>
          {kds && (
            <Button id="mostrar-num-kds" type="button" aria-haspopup="dialog" disabled={abrindo} onClick={abrirDialogo}>
              <Monitor className="h-4 w-4" aria-hidden="true" />
              {noMapa.length ? 'Escolher os KDS' : 'Mostrar num KDS'}
            </Button>
          )}
        </div>
        {kds && noMapa.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm">
            <p className="min-w-0 flex-1 basis-60">
              {textoDaFaixa(noMapa)}
              {!kds.ligado && (
                <span className="mt-0.5 block text-xs text-amber-800">
                  O mapa no KDS está desligado nesta loja: por enquanto {noMapa.length > 1 ? 'eles mostram' : 'ele mostra'} os
                  pedidos. Liga em {ONDE_LIGA}.
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={abrindo || salvando} onClick={abrirDialogo}>
                Escolher os KDS
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={salvando} onClick={() => gravar([])}>
                Tirar de todos
              </Button>
            </div>
          </div>
        )}
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
      {dialogo && kds && (
        <MapaNosKdsDialogo dados={kds} salvando={salvando} aoFechar={() => setDialogo(false)} aoConfirmar={gravar} />
      )}
    </Shell>
  );
}
