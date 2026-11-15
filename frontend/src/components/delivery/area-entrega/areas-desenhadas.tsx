'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { areaDoPonto, circuloComoPoligono, km2, pontoNoPoligono, tempoDaArea } from '@/lib/area-entrega';
import { GavetaArea } from './gaveta-area';
import { CORES_DAS_AREAS, daLinha, paraSalvar, type AreaEditavel } from './tipos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ÁREA DE ENTREGA DESENHADA NO MAPA (mig 425; protótipo `mockups/regem-area-entrega-mapa.html`, aprovado pelo dono em
// 15/11/2026). Desenhar quantas áreas quiser (clicar os cantos, fechar no primeiro ponto), editar os pontos, mover, apagar,
// ordenar (onde duas se cruzam vale a de cima), a gaveta de cada uma, "Testar um endereço" e "Converter as faixas de km em
// áreas". O mapa é o OpenStreetMap (o mesmo do Regem, sem Google) e o desenho é a Leaflet-Geoman (MIT). Salvar grava a lista
// INTEIRA de uma vez (1 request); a regra "dentro da área?" é a mesma do servidor (`lib/area-entrega.ts`).

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const MAX_AREAS = 30;
type Modo = 'editar' | 'mover' | 'testar' | null;
type Teste = { ponto: [number, number]; area: AreaEditavel | null; pausada: AreaEditavel | null };

export function AreasDesenhadas({
  lat,
  lng,
  raios,
  pode,
  modoAtual,
  aoUsarModo,
}: {
  lat?: any;
  lng?: any;
  raios: any[];
  pode: boolean;
  /** O modo que vale hoje na loja ('bairro' | 'raio' | 'mapa'). */
  modoAtual: string;
  /** Liga o modo mapa (depois de salvar com pelo menos uma área no ar). */
  aoUsarModo: () => Promise<boolean>;
}) {
  const [areas, setAreas] = useState<AreaEditavel[]>([]);
  const [salvas, setSalvas] = useState('[]');
  const [carregando, setCarregando] = useState(true);
  const [erroLeitura, setErroLeitura] = useState(false);
  const [erroMapa, setErroMapa] = useState(false);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [modo, setModo] = useState<Modo>(null);
  const [desenhando, setDesenhando] = useState(false);
  const [editando, setEditando] = useState<{ area: AreaEditavel; nova: boolean } | null>(null);
  const [apagar, setApagar] = useState<AreaEditavel | null>(null);
  const [teste, setTeste] = useState<Teste | null>(null);
  const [salvando, setSalvando] = useState(false);
  const el = useRef<HTMLDivElement>(null);
  const mapa = useRef<any>(null);
  const L = useRef<any>(null);
  const camadas = useRef<Record<string, any>>({});
  const pino = useRef<any>(null);
  const areasRef = useRef(areas);
  areasRef.current = areas;
  const modoRef = useRef<Modo>(modo);
  modoRef.current = modo;
  const slat = Number(lat);
  const slng = Number(lng);
  const temLoja = lat != null && lng != null && String(lat) !== '' && Number.isFinite(slat) && Number.isFinite(slng);
  const mudou = JSON.stringify(areas) !== salvas;

  // ───────── leitura ─────────
  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroLeitura(false);
    try {
      const lista = ((await api.areasEntrega()) as any[]).map(daLinha);
      setAreas(lista);
      setSalvas(JSON.stringify(lista));
    } catch {
      setErroLeitura(true);
    } finally {
      setCarregando(false);
    }
  }, []);
  useEffect(() => {
    void carregar();
  }, [carregar]);

  // ───────── o teste de um ponto ─────────
  const testar = useCallback((ponto: [number, number]) => {
    const lista = areasRef.current.map((a, i) => ({ ...a, ordem: i }));
    const area = areaDoPonto(lista, ponto[0], ponto[1]);
    const pausada = area ? null : lista.find((a) => !a.ativo && pontoNoPoligono(ponto[0], ponto[1], a.poligono)) ?? null;
    setTeste({ ponto, area, pausada });
    if (mapa.current && L.current) {
      if (pino.current) mapa.current.removeLayer(pino.current);
      pino.current = L.current.circleMarker(ponto, { radius: 8, color: '#0F2230', weight: 3, fillColor: '#E2A340', fillOpacity: 1 }).addTo(mapa.current);
    }
  }, []);

  // ───────── o mapa (uma vez) ─────────
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const mod: any = await import('leaflet');
        const Lf = mod.default ?? mod;
        // A Geoman se pendura na Leaflet GLOBAL (`L.PM`): sem o `window.L`, ela não acha o mapa.
        (window as any).L = Lf;
        await import('@geoman-io/leaflet-geoman-free');
        if (!vivo || !el.current || mapa.current) return;
        L.current = Lf;
        const centro: [number, number] = temLoja ? [slat, slng] : [-22.9068, -43.1729];
        const m = Lf.map(el.current, { zoomControl: true }).setView(centro, 14);
        Lf.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(m);
        if (temLoja) Lf.circleMarker(centro, { radius: 7, color: '#0F2230', fillColor: '#0F2230', fillOpacity: 1 }).addTo(m).bindTooltip('A loja');
        m.pm.setLang('pt_br');
        m.pm.setGlobalOptions({ allowSelfIntersection: false, snappable: true });
        m.on('click', (ev: any) => {
          if (modoRef.current === 'testar') testar([ev.latlng.lat, ev.latlng.lng]);
        });
        m.on('pm:create', (ev: any) => {
          const pontos = (ev.layer.getLatLngs()[0] as any[]).map((ll) => [Math.round(ll.lat * 1e6) / 1e6, Math.round(ll.lng * 1e6) / 1e6] as [number, number]);
          m.removeLayer(ev.layer);
          setDesenhando(false);
          const i = areasRef.current.length;
          const nova: AreaEditavel = {
            chave: `n${Date.now()}`,
            nome: `Área ${i + 1}`,
            poligono: pontos,
            taxa: 0,
            tempoMin: null,
            tempoMax: null,
            pedidoMinimo: null,
            freteGratisAcima: null,
            cor: CORES_DAS_AREAS[i % CORES_DAS_AREAS.length],
            ativo: true,
          };
          setAreas((l) => [...l, nova]);
          setSelecionada(nova.chave);
          setEditando({ area: nova, nova: true });
        });
        m.on('pm:drawend', () => setDesenhando(false));
        mapa.current = m;
        setErroMapa(false);
        // O painel pode abrir escondido (aba): recalcula o tamanho quando aparece.
        setTimeout(() => m.invalidateSize(), 200);
      } catch {
        if (vivo) setErroMapa(true);
      }
    })();
    return () => {
      vivo = false;
      mapa.current?.remove();
      mapa.current = null;
      camadas.current = {};
      pino.current = null;
    };
    // O mapa nasce uma vez; o ponto da loja só muda pela aba Endereço (outro painel).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ───────── desenhar as áreas (a de CIMA da lista fica por cima) ─────────
  useEffect(() => {
    const m = mapa.current;
    const Lf = L.current;
    if (!m || !Lf) return;
    Object.values(camadas.current).forEach((c) => m.removeLayer(c));
    camadas.current = {};
    [...areas].reverse().forEach((a) => {
      if (a.poligono.length < 3) return;
      const cor = a.cor ?? CORES_DAS_AREAS[0];
      const p = Lf.polygon(a.poligono, { color: cor, weight: selecionada === a.chave ? 4 : 2, fillOpacity: a.ativo ? 0.22 : 0.07, dashArray: a.ativo ? undefined : '6 6' }).addTo(m);
      p.bindTooltip(`${a.nome} · ${brl(a.taxa)}`, { direction: 'center' });
      p.on('click', (ev: any) => {
        if (modoRef.current === 'testar') return testar([ev.latlng.lat, ev.latlng.lng]);
        setSelecionada(a.chave);
      });
      const atualizar = () => {
        const pontos = (p.getLatLngs()[0] as any[]).map((ll) => [Math.round(ll.lat * 1e6) / 1e6, Math.round(ll.lng * 1e6) / 1e6] as [number, number]);
        setAreas((l) => l.map((x) => (x.chave === a.chave ? { ...x, poligono: pontos } : x)));
      };
      p.on('pm:edit', atualizar);
      p.on('pm:dragend', atualizar);
      if (pode && modo === 'editar') p.pm.enable({ allowSelfIntersection: false });
      if (pode && modo === 'mover') p.pm.enableLayerDrag();
      camadas.current[a.chave] = p;
    });
  }, [areas, selecionada, modo, pode, testar]);

  // Enquadra as áreas quando a lista chega do servidor.
  useEffect(() => {
    const m = mapa.current;
    const Lf = L.current;
    if (!m || !Lf || carregando) return;
    const pontos = areas.flatMap((a) => a.poligono);
    if (temLoja) pontos.push([slat, slng]);
    if (pontos.length >= 2) m.fitBounds(Lf.latLngBounds(pontos), { padding: [24, 24] });
    // Só na chegada da lista (não a cada edição).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregando, erroMapa]);

  function trocarModo(novo: Modo) {
    mapa.current?.pm.disableDraw();
    setDesenhando(false);
    setModo((atual) => (atual === novo ? null : novo));
  }
  function novaArea() {
    if (!mapa.current) return;
    if (areas.length >= MAX_AREAS) return toast.error(`No máximo ${MAX_AREAS} áreas por loja.`);
    setModo(null);
    setDesenhando(true);
    mapa.current.pm.enableDraw('Polygon', {
      allowSelfIntersection: false,
      templineStyle: { color: '#E2A340' },
      hintlineStyle: { color: '#E2A340', dashArray: '5 5' },
    });
  }
  function converterFaixas() {
    const faixas = [...(raios ?? [])]
      .map((r: any) => ({ km: Number(r.ateKm) || 0, taxa: Number(r.taxa) || 0 }))
      .filter((f) => f.km > 0 && f.km < 100)
      .sort((a, b) => a.km - b.km);
    if (!temLoja) return toast.error('Marque o ponto da loja na aba Endereço antes de converter as faixas.');
    if (!faixas.length) return toast.error('A loja não tem faixas de km cadastradas para converter.');
    const novas = faixas.map((f, i) => ({
      chave: `f${Date.now()}${i}`,
      nome: `Até ${String(f.km).replace('.', ',')} km`,
      poligono: circuloComoPoligono(slat, slng, f.km),
      taxa: f.taxa,
      tempoMin: null,
      tempoMax: null,
      pedidoMinimo: null,
      freteGratisAcima: null,
      cor: CORES_DAS_AREAS[i % CORES_DAS_AREAS.length],
      ativo: true,
    }));
    setAreas(novas);
    setSelecionada(null);
    toast.success(`${novas.length} áreas criadas a partir das faixas de km — ajuste os desenhos e salve.`);
    setTimeout(() => {
      const ultima = camadas.current[novas[novas.length - 1].chave];
      if (ultima) mapa.current?.fitBounds(ultima.getBounds(), { padding: [20, 20] });
    }, 50);
  }
  function mover(i: number, d: -1 | 1) {
    setAreas((l) => {
      const n = [...l];
      const j = i + d;
      if (j < 0 || j >= n.length) return l;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  }
  function duplicar(a: AreaEditavel) {
    if (areas.length >= MAX_AREAS) return toast.error(`No máximo ${MAX_AREAS} áreas por loja.`);
    const c: AreaEditavel = { ...a, chave: `d${Date.now()}`, nome: `${a.nome} (cópia)`.slice(0, 40), poligono: a.poligono.map(([la, lo]) => [la - 0.002, lo + 0.002] as [number, number]) };
    setAreas((l) => {
      const i = l.findIndex((x) => x.chave === a.chave);
      return [...l.slice(0, i + 1), c, ...l.slice(i + 1)];
    });
    toast.success('Área duplicada — ajuste o desenho no mapa.');
  }
  function verNoMapa(a: AreaEditavel) {
    setSelecionada(a.chave);
    const c = camadas.current[a.chave];
    if (c) mapa.current?.fitBounds(c.getBounds(), { padding: [30, 30] });
  }

  async function salvar() {
    if (modoAtual === 'mapa' && !areas.some((a) => a.ativo)) return toast.error('A loja usa a área desenhada no mapa: deixe pelo menos uma área no ar.');
    setSalvando(true);
    try {
      const lista = ((await api.setAreasEntrega(paraSalvar(areas))) as any[]).map(daLinha);
      setAreas(lista);
      setSalvas(JSON.stringify(lista));
      if (modoAtual !== 'mapa' && lista.some((a) => a.ativo)) {
        // A troca de modo mostra o próprio erro; aqui só se comemora o que entrou de verdade.
        if (await aoUsarModo()) toast.success('Áreas salvas — o cardápio e o atendente já entregam pelas áreas desenhadas.');
        else toast.success('Áreas salvas. O modo da loja não mudou.');
      } else toast.success('Áreas de entrega salvas.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para salvar as áreas.');
    } finally {
      setSalvando(false);
    }
  }

  const dica = desenhando
    ? 'Clique no mapa para marcar os cantos da área. Clique no primeiro ponto para fechar. Esc cancela.'
    : modo === 'editar'
      ? 'Arraste os pontos para mudar o desenho. Clique no meio de uma borda para criar um ponto; clique com o botão direito num ponto para tirar.'
      : modo === 'mover'
        ? 'Arraste uma área para mudá-la de lugar.'
        : modo === 'testar'
          ? 'Clique num ponto do mapa para ver qual área atende.'
          : '';

  useEffect(() => {
    if (!desenhando) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        mapa.current?.pm.disableDraw();
        setDesenhando(false);
      }
    };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [desenhando]);

  return (
    <div className="space-y-4">
      {modoAtual !== 'mapa' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm">
          <span className="min-w-0">
            Este modo ainda não está valendo. Desenhe as áreas e salve: com pelo menos uma área no ar, o cardápio e o atendente passam a entregar pelas áreas desenhadas.
          </span>
          {/* Áreas já salvas (de outra vez) e nada mudado: dá para voltar a usá-las sem salvar de novo. */}
          {pode && !mudou && !carregando && areas.some((a) => a.ativo) && (
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                if (await aoUsarModo()) toast.success('Pronto — o cardápio e o atendente já entregam pelas áreas desenhadas.');
              }}
            >
              Usar as áreas desenhadas
            </Button>
          )}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-card" aria-label="Mapa das áreas de entrega">
        {pode && (
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-2.5">
            <Button type="button" size="sm" onClick={novaArea} disabled={erroMapa || carregando}>
              ＋ Nova área
            </Button>
            <Button type="button" size="sm" variant={modo === 'editar' ? 'default' : 'outline'} aria-pressed={modo === 'editar'} onClick={() => trocarModo('editar')} disabled={!areas.length}>
              ✎ Editar pontos
            </Button>
            <Button type="button" size="sm" variant={modo === 'mover' ? 'default' : 'outline'} aria-pressed={modo === 'mover'} onClick={() => trocarModo('mover')} disabled={!areas.length}>
              ✥ Mover área
            </Button>
            <Button type="button" size="sm" variant={modo === 'testar' ? 'default' : 'outline'} aria-pressed={modo === 'testar'} onClick={() => trocarModo('testar')}>
              📍 Testar um endereço
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={converterFaixas} title="Cria uma área para cada faixa de km que a loja já tem">
              Converter as faixas de km em áreas
            </Button>
          </div>
        )}
        {dica && (
          <p role="status" aria-live="polite" className="border-b border-border bg-info/10 px-3 py-1.5 text-sm text-info">
            {dica}
          </p>
        )}
        {erroMapa ? (
          <div className="grid h-[min(60vh,520px)] min-h-[300px] place-items-center p-6 text-center text-sm text-muted-foreground">
            <div>
              <b className="mb-1 block text-base text-foreground">Não deu para carregar o mapa</b>
              Confira a internet deste computador. As áreas salvas continuam valendo no cardápio.
            </div>
          </div>
        ) : (
          <div ref={el} role="application" aria-label="Mapa: arraste para navegar, use + e − para aproximar" className="isolate h-[min(60vh,520px)] min-h-[300px] w-full bg-secondary" />
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="flex flex-wrap gap-3">
            {areas.map((a) => (
              <span key={a.chave} className="inline-flex items-center gap-1">
                <i className="inline-block h-3 w-3 rounded-sm" style={{ background: a.cor ?? CORES_DAS_AREAS[0], opacity: a.ativo ? 1 : 0.45 }} aria-hidden="true" />
                {a.nome}
              </span>
            ))}
          </span>
          <span>Mapa © OpenStreetMap{temLoja ? ' · ● a loja' : ''}</span>
        </div>
      </section>

      {!temLoja && (
        <p className="rounded-md bg-warn/10 px-3 py-2 text-sm text-warn">
          O ponto da loja ainda não está marcado (aba Endereço). Dá para desenhar as áreas assim mesmo; o ponto só ajuda a centralizar o mapa e a converter as faixas.
        </p>
      )}

      <section aria-labelledby="titulo-areas" className="space-y-2">
        <h3 id="titulo-areas" className="font-display text-base font-bold">
          Áreas <span className="font-mono text-sm text-muted-foreground">({areas.length})</span>
        </h3>
        <p className="text-sm text-muted-foreground">
          Onde duas áreas se cruzam, vale a de <b>cima</b> da lista. Use as setas para mudar a ordem. Endereço fora de todas: o pedido não sai.
        </p>
        {carregando ? (
          <p className="text-sm text-muted-foreground">Carregando as áreas…</p>
        ) : erroLeitura ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            Não deu para ler as áreas de entrega.{' '}
            <Button type="button" size="sm" variant="outline" onClick={() => void carregar()}>
              Tentar de novo
            </Button>
          </div>
        ) : !areas.length ? (
          <div className="rounded-lg border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
            <b className="mb-1 block text-foreground">Nenhuma área desenhada ainda</b>
            {pode ? 'Clique em "＋ Nova área" e marque os cantos no mapa.' : 'A loja ainda não desenhou áreas de entrega.'}
          </div>
        ) : (
          <ul className="space-y-2">
            {areas.map((a, i) => (
              <li
                key={a.chave}
                className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-2.5 gap-y-1 rounded-lg border p-3 ${selecionada === a.chave ? 'border-primary ring-1 ring-primary' : 'border-border'}`}
              >
                <span className="mt-1 h-3.5 w-3.5 rounded" style={{ background: a.cor ?? CORES_DAS_AREAS[0] }} aria-hidden="true" />
                <b className="min-w-0 break-words font-display">{a.nome}</b>
                <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-bold ${a.ativo ? 'bg-ok/15 text-ok' : 'bg-warn/15 text-warn'}`}>{a.ativo ? 'No ar' : 'Pausada'}</span>
                <span className="col-span-2 col-start-2 font-mono text-[13px] text-muted-foreground">
                  {[
                    brl(a.taxa),
                    tempoDaArea(a),
                    a.pedidoMinimo != null ? `mínimo ${brl(a.pedidoMinimo)}` : null,
                    a.freteGratisAcima != null ? `grátis acima de ${brl(a.freteGratisAcima)}` : null,
                    `${km2(a.poligono).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km²`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="col-span-2 col-start-2 mt-1 flex flex-wrap gap-1.5">
                  <Button type="button" size="sm" variant="outline" onClick={() => setEditando({ area: a, nova: false })}>
                    {pode ? 'Editar' : 'Ver'}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => verNoMapa(a)}>
                    Ver no mapa
                  </Button>
                  {pode && (
                    <>
                      <Button type="button" size="sm" variant="outline" aria-label={`Subir ${a.nome}`} disabled={i === 0} onClick={() => mover(i, -1)}>
                        ↑
                      </Button>
                      <Button type="button" size="sm" variant="outline" aria-label={`Descer ${a.nome}`} disabled={i === areas.length - 1} onClick={() => mover(i, 1)}>
                        ↓
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => duplicar(a)}>
                        Duplicar
                      </Button>
                      <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => setApagar(a)}>
                        Apagar
                      </Button>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="titulo-teste" className="rounded-xl border border-border bg-card p-3">
        <h3 id="titulo-teste" className="font-display text-base font-bold">
          Testar um endereço
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">Clique em "📍 Testar um endereço" e depois num ponto do mapa: mostra qual área atende, a taxa e o tempo.</p>
        <div aria-live="polite">
          {teste &&
            (teste.area ? (
              <p className="mt-2 rounded-md bg-ok/10 px-3 py-2 text-sm">
                Entrega pela área <b>{teste.area.nome}</b> · <b>{brl(teste.area.taxa)}</b>
                {tempoDaArea(teste.area) ? ` · ${tempoDaArea(teste.area)}` : ''}
                {teste.area.pedidoMinimo != null ? ` · pedido mínimo ${brl(teste.area.pedidoMinimo)}` : ''}
              </p>
            ) : (
              <p className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <b>Fora da área de entrega</b> — o pedido não sai{teste.pausada ? ` (a área "${teste.pausada.nome}" está pausada)` : ''}.
              </p>
            ))}
        </div>
      </section>

      {pode && mudou && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-foreground px-3 py-2.5 text-sm text-background">
          <span>Há alterações ainda não salvas nas áreas</span>
          <span className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-background/40 bg-transparent text-background hover:bg-background/10"
              onClick={() => {
                setAreas(JSON.parse(salvas));
                setTeste(null);
                toast.success('Alterações descartadas.');
              }}
              disabled={salvando}
            >
              Descartar
            </Button>
            <Button type="button" size="sm" onClick={() => void salvar()} disabled={salvando}>
              {salvando ? 'Salvando…' : 'Salvar áreas'}
            </Button>
          </span>
        </div>
      )}

      {editando && (
        <GavetaArea
          area={editando.area}
          nova={editando.nova}
          pode={pode}
          aoCancelar={() => {
            if (editando.nova) setAreas((l) => l.filter((x) => x.chave !== editando.area.chave));
            setEditando(null);
          }}
          aoSalvar={(a) => {
            setAreas((l) => l.map((x) => (x.chave === a.chave ? a : x)));
            setEditando(null);
            toast.success('Área atualizada — falta salvar as alterações.');
          }}
          aoAjustarDesenho={() => {
            const ch = editando.area.chave;
            setEditando(null);
            setSelecionada(ch);
            setModo('editar');
            const c = camadas.current[ch];
            if (c) mapa.current?.fitBounds(c.getBounds(), { padding: [30, 30] });
          }}
        />
      )}

      {apagar && (
        <Dialogo
          alerta
          titulo="Apagar a área?"
          aoFechar={() => setApagar(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setApagar(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setAreas((l) => l.filter((x) => x.chave !== apagar.chave));
                  setApagar(null);
                  toast.success('Área apagada — falta salvar as alterações.');
                }}
              >
                Apagar área
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            &quot;{apagar.nome}&quot; sai do mapa. Endereços só dela passam a ficar fora da área de entrega quando você salvar.
          </p>
        </Dialogo>
      )}
    </div>
  );
}
