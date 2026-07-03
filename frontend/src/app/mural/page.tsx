'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Humor 1..5 (espelha o mockup: 😄 muito bom … 😢 muito ruim).
const HUMORES = [
  { v: 5, emoji: '😄', label: 'Muito bom' },
  { v: 4, emoji: '🙂', label: 'Bom' },
  { v: 3, emoji: '😐', label: 'Regular' },
  { v: 2, emoji: '🙁', label: 'Ruim' },
  { v: 1, emoji: '😢', label: 'Muito ruim' },
];

function quando(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MuralPage() {
  const router = useRouter();
  const [feed, setFeed] = useState<any>(null);
  const [clima, setClima] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [titulo, setTitulo] = useState('');
  const [corpo, setCorpo] = useState('');
  const [fixado, setFixado] = useState(false);
  const cat = getCategoria();
  const gestor = cat === 'presidente' || cat === 'gerente' || cat === 'supervisao';

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const [f, c] = await Promise.all([api.muralFeed(), api.climaAtual()]);
      setFeed(f);
      setClima(c);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    carregar();
  }, [carregar, router]);

  async function publicar() {
    if (titulo.trim().length < 2) return;
    try {
      await api.publicarComunicado({ titulo, corpo: corpo || undefined, fixado });
      setTitulo('');
      setCorpo('');
      setFixado(false);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao publicar');
    }
  }

  async function confirmarLeitura(id: string) {
    try {
      await api.confirmarLeituraMural(id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao confirmar');
    }
  }

  async function criarPesquisa() {
    const t = new Date().toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
    try {
      await api.criarPesquisaClima({ titulo: `Pesquisa de clima — ${t}` });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar pesquisa');
    }
  }

  async function responder(humor: number) {
    if (!clima?.pesquisa) return;
    try {
      await api.responderClima(clima.pesquisa.id, { humor });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao responder');
    }
  }

  const comunicados: any[] = feed?.comunicados ?? [];
  const total = feed?.total ?? 0;

  return (
    <Shell eyebrow="Comunicação" title="Mural & Clima">
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Feed do mural */}
        <div className="space-y-4">
          {gestor && (
            <Card className="space-y-3 p-4">
              <p className="font-display text-sm font-bold">Publicar comunicado</p>
              <div className="space-y-1">
                <Label htmlFor="tit" className="text-xs">Título</Label>
                <Input
                  id="tit"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ex.: Inventário geral neste sábado"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="corpo" className="text-xs">Detalhe (opcional)</Label>
                <Input
                  id="corpo"
                  value={corpo}
                  onChange={(e) => setCorpo(e.target.value)}
                  placeholder="Chegar 1h antes…"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={fixado}
                    onChange={(e) => setFixado(e.target.checked)}
                    aria-label="Fixar comunicado"
                  />
                  Fixar no topo
                </label>
                <Button onClick={publicar} disabled={titulo.trim().length < 2}>
                  Publicar
                </Button>
              </div>
            </Card>
          )}

          {erro && <p className="text-destructive">{erro}</p>}

          {feed === null && (
            <p className="text-muted-foreground">Carregando…</p>
          )}
          {feed !== null && comunicados.length === 0 && (
            <Card className="p-8 text-center text-muted-foreground">
              Nenhum comunicado ainda. {gestor ? 'Publique o primeiro acima.' : ''}
            </Card>
          )}

          {comunicados.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-muted text-lg">
                  {c.fixado ? '📌' : '📣'}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {c.titulo}
                    {c.fixado && (
                      <span
                        className="ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-bold"
                        style={{ background: 'hsl(var(--warn)/.15)', color: 'hsl(var(--warn))' }}
                      >
                        Fixado
                      </span>
                    )}
                  </p>
                  {c.corpo && <p className="mt-0.5 text-sm text-muted-foreground">{c.corpo}</p>}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.autorNome ?? 'Gestão'} · {quando(c.createdAt)} ·{' '}
                    {c.audiencia === 'setor' ? 'Setor' : 'Toda a loja'}
                  </p>
                </div>
                <div className="flex flex-none flex-col items-end gap-1.5">
                  <span
                    className="whitespace-nowrap rounded px-2 py-0.5 font-mono text-[11px] font-bold"
                    style={{ background: 'hsl(var(--ok)/.15)', color: 'hsl(var(--ok))' }}
                  >
                    ✓ {c.leram}/{c.alvo ?? total} leram
                  </span>
                  {!c.euLi && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => confirmarLeitura(c.id)}
                    >
                      Confirmar leitura
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Pesquisa de clima */}
        <div>
          <Card className="p-4" style={{ borderTop: '3px solid hsl(var(--info))' }}>
            {!clima?.pesquisa ? (
              <div className="space-y-3 text-center">
                <p className="font-display text-sm font-bold">Pesquisa de clima</p>
                <p className="text-xs text-muted-foreground">
                  Nenhuma pesquisa aberta no momento.
                </p>
                {gestor && (
                  <Button onClick={criarPesquisa}>Abrir pesquisa de clima</Button>
                )}
              </div>
            ) : (
              <>
                <p className="font-display text-sm font-bold">{clima.pesquisa.titulo}</p>
                <p className="text-xs text-muted-foreground">
                  Anônima · {clima.responderam}/{clima.total} responderam
                </p>

                {clima.euRespondi && clima.distribuicaoOculta ? (
                  <div className="mt-3 rounded-lg bg-muted p-3 text-center text-xs text-muted-foreground">
                    ✓ Resposta registrada. O consolidado aparece a partir de{' '}
                    {clima.minRespostas} respostas (para preservar o anonimato).
                  </div>
                ) : clima.euRespondi ? (
                  <div className="mt-3 space-y-2">
                    {HUMORES.map((h) => {
                      const n = clima.distribuicao?.[h.v] ?? 0;
                      const pct = clima.responderam > 0 ? (n / clima.responderam) * 100 : 0;
                      return (
                        <div key={h.v}>
                          <div className="flex justify-between text-[12.5px]">
                            <span>{h.emoji} {h.label}</span>
                            <span className="font-mono font-bold">{n}</span>
                          </div>
                          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${pct}%`,
                                background:
                                  h.v <= 2 ? 'hsl(var(--warn))' : 'hsl(var(--info))',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-3">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Como você avalia o clima? (resposta anônima)
                    </p>
                    <div className="flex justify-between gap-1">
                      {HUMORES.map((h) => (
                        <button
                          key={h.v}
                          type="button"
                          onClick={() => responder(h.v)}
                          title={h.label}
                          aria-label={h.label}
                          className="flex flex-1 flex-col items-center gap-1 rounded-lg border border-border py-2 text-2xl transition hover:bg-muted"
                        >
                          {h.emoji}
                          <span className="text-[9px] leading-tight text-muted-foreground">
                            {h.label}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <p className="mt-3 text-xs text-muted-foreground">
                  🔒 Anônima (LGPD) · diretoria vê só o consolidado.
                </p>
              </>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
