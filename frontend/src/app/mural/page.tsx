'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Pin, PinOff, Trash2 } from 'lucide-react';
import { api, getToken, getCategoria } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
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

const AUD_LABEL: Record<string, string> = {
  rede: 'Toda a rede',
  loja: 'Toda a loja',
  setor: 'Setor',
};

export default function MuralPage() {
  const router = useRouter();
  const [feed, setFeed] = useState<any>(null);
  const [clima, setClima] = useState<any>(null);
  const [setores, setSetores] = useState<any[]>([]);
  const [modelos, setModelos] = useState<any[]>([]);
  const [erro, setErro] = useState('');
  const [busy, setBusy] = useState(false);

  const [titulo, setTitulo] = useState('');
  const [corpo, setCorpo] = useState('');
  const [fixado, setFixado] = useState(false);
  const [audiencia, setAudiencia] = useState('loja');
  const [setorId, setSetorId] = useState('');
  const [comentario, setComentario] = useState('');

  const cat = getCategoria();
  const presidente = cat === 'presidente';
  const gestor =
    cat === 'presidente' || cat === 'gerente' || cat === 'supervisao';

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const [f, c, s, m] = await Promise.all([
        api.muralFeed(),
        api.climaAtual(),
        gestor ? api.get('/setores').catch(() => []) : Promise.resolve([]),
        gestor ? api.muralModelos().catch(() => ({ modelos: [] })) : Promise.resolve({ modelos: [] }),
      ]);
      setFeed(f);
      setClima(c);
      setSetores(Array.isArray(s) ? s : []);
      setModelos(m?.modelos ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, [gestor]);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    carregar();
  }, [carregar, router]);

  async function publicar() {
    if (titulo.trim().length < 2) return;
    if (audiencia === 'setor' && !setorId) {
      setErro('Escolha o setor de destino.');
      return;
    }
    setBusy(true);
    setErro('');
    try {
      await api.publicarComunicado({
        titulo,
        corpo: corpo || undefined,
        fixado,
        audiencia,
        setorId: audiencia === 'setor' ? setorId : undefined,
      });
      setTitulo('');
      setCorpo('');
      setFixado(false);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao publicar');
    } finally {
      setBusy(false);
    }
  }

  async function acao(fn: () => Promise<unknown>) {
    setBusy(true);
    setErro('');
    try {
      await fn();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro');
    } finally {
      setBusy(false);
    }
  }

  async function criarPesquisa() {
    const t = new Date().toLocaleString('pt-BR', {
      month: 'long',
      year: 'numeric',
    });
    await acao(() =>
      api.criarPesquisaClima({ titulo: `Pesquisa de clima — ${t}` }),
    );
  }

  async function responder(humor: number) {
    if (!clima?.pesquisa) return;
    await acao(async () => {
      await api.responderClima(clima.pesquisa.id, {
        humor,
        comentario: comentario || undefined,
      });
      setComentario('');
    });
  }

  const comunicados: any[] = feed?.comunicados ?? [];
  const total = feed?.total ?? 0;
  const pesquisa = clima?.pesquisa;
  const aberta = pesquisa?.aberta;
  // Mostra o consolidado quando já respondi OU a pesquisa foi encerrada.
  const mostrarConsolidado = pesquisa && (clima.euRespondi || !aberta);

  return (
    <Shell eyebrow="Comunicação" title="Mural & Clima">
      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Feed do mural */}
        <div className="space-y-4">
          {gestor && (
            <Card className="space-y-3 p-4">
              <p className="font-display text-sm font-bold">
                Publicar comunicado
              </p>

              {modelos.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {modelos.map((m, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        setTitulo(m.titulo);
                        setCorpo(m.corpo);
                      }}
                      className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-secondary"
                    >
                      + {m.titulo}
                    </button>
                  ))}
                </div>
              )}

              <div className="space-y-1">
                <Label htmlFor="tit" className="text-xs">
                  Título
                </Label>
                <Input
                  id="tit"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Ex.: Inventário geral neste sábado"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="corpo" className="text-xs">
                  Detalhe (opcional)
                </Label>
                <Input
                  id="corpo"
                  value={corpo}
                  onChange={(e) => setCorpo(e.target.value)}
                  placeholder="Chegar 1h antes…"
                />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="aud" className="text-xs">
                    Público
                  </Label>
                  <Select
                    id="aud"
                    value={audiencia}
                    onChange={(e) => setAudiencia(e.target.value)}
                  >
                    {presidente && <option value="rede">Toda a rede</option>}
                    <option value="loja">Esta loja</option>
                    <option value="setor">Um setor</option>
                  </Select>
                </div>
                {audiencia === 'setor' && (
                  <div className="space-y-1">
                    <Label htmlFor="set" className="text-xs">
                      Setor
                    </Label>
                    <Select
                      id="set"
                      value={setorId}
                      onChange={(e) => setSetorId(e.target.value)}
                    >
                      <option value="">Escolher…</option>
                      {setores.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.nome}
                        </option>
                      ))}
                    </Select>
                  </div>
                )}
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
                <Button
                  onClick={publicar}
                  disabled={busy || titulo.trim().length < 2}
                >
                  Publicar
                </Button>
              </div>
            </Card>
          )}

          {erro && <p className="text-destructive">{erro}</p>}

          {feed === null &&
            [0, 1].map((i) => (
              <Card key={i} className="p-4">
                <div className="h-4 w-1/2 animate-pulse rounded bg-secondary" />
                <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-secondary" />
              </Card>
            ))}
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
                        style={{
                          background: 'hsl(var(--warn)/.15)',
                          color: 'hsl(var(--warn))',
                        }}
                      >
                        Fixado
                      </span>
                    )}
                  </p>
                  {c.corpo && (
                    <p className="mt-0.5 text-sm text-muted-foreground">
                      {c.corpo}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {c.autorNome ?? 'Gestão'} · {quando(c.createdAt)} ·{' '}
                    {AUD_LABEL[c.audiencia] ?? 'Toda a loja'}
                  </p>
                </div>
                <div className="flex flex-none flex-col items-end gap-1.5">
                  <span
                    className="whitespace-nowrap rounded px-2 py-0.5 font-mono text-[11px] font-bold"
                    style={{
                      background: 'hsl(var(--ok)/.15)',
                      color: 'hsl(var(--ok))',
                    }}
                  >
                    ✓ {c.leram}/{c.alvo ?? total} leram
                  </span>
                  {!c.euLi && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => acao(() => api.confirmarLeituraMural(c.id))}
                    >
                      Confirmar leitura
                    </Button>
                  )}
                  {gestor && (
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={c.fixado ? 'Desafixar' : 'Fixar'}
                        title={c.fixado ? 'Desafixar' : 'Fixar no topo'}
                        disabled={busy}
                        onClick={() => acao(() => api.fixarComunicado(c.id))}
                      >
                        {c.fixado ? (
                          <PinOff className="h-4 w-4" />
                        ) : (
                          <Pin className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Excluir comunicado"
                        disabled={busy}
                        onClick={() => acao(() => api.excluirComunicado(c.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>

        {/* Pesquisa de clima */}
        <div>
          <Card className="p-4" style={{ borderTop: '3px solid hsl(var(--info))' }}>
            {!pesquisa ? (
              <div className="space-y-3 text-center">
                <p className="font-display text-sm font-bold">
                  Pesquisa de clima
                </p>
                <p className="text-xs text-muted-foreground">
                  Nenhuma pesquisa aberta no momento.
                </p>
                {gestor && (
                  <Button onClick={criarPesquisa} disabled={busy}>
                    Abrir pesquisa de clima
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-sm font-bold">
                    {pesquisa.titulo}
                  </p>
                  {!aberta && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-muted-foreground">
                      Encerrada
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Anônima · {clima.responderam}/{clima.total} responderam
                </p>

                {aberta && !clima.euRespondi ? (
                  <div className="mt-3">
                    <p className="mb-2 text-xs text-muted-foreground">
                      Como você avalia o clima? (resposta anônima)
                    </p>
                    <Input
                      value={comentario}
                      onChange={(e) => setComentario(e.target.value)}
                      placeholder="Comentário (opcional, anônimo)"
                      className="mb-2"
                    />
                    <div className="flex justify-between gap-1">
                      {HUMORES.map((h) => (
                        <button
                          key={h.v}
                          type="button"
                          onClick={() => responder(h.v)}
                          disabled={busy}
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
                ) : mostrarConsolidado && clima.distribuicaoOculta ? (
                  <div className="mt-3 rounded-lg bg-muted p-3 text-center text-xs text-muted-foreground">
                    {clima.euRespondi && '✓ Resposta registrada. '}
                    O consolidado aparece a partir de {clima.minRespostas}{' '}
                    respostas (para preservar o anonimato).
                  </div>
                ) : mostrarConsolidado ? (
                  <div className="mt-3 space-y-2">
                    {HUMORES.map((h) => {
                      const n = clima.distribuicao?.[h.v] ?? 0;
                      const pct =
                        clima.responderam > 0
                          ? (n / clima.responderam) * 100
                          : 0;
                      return (
                        <div key={h.v}>
                          <div className="flex justify-between text-[12.5px]">
                            <span>
                              {h.emoji} {h.label}
                            </span>
                            <span className="font-mono font-bold">{n}</span>
                          </div>
                          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${pct}%`,
                                background:
                                  h.v <= 2
                                    ? 'hsl(var(--warn))'
                                    : 'hsl(var(--info))',
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <p className="mt-3 text-xs text-muted-foreground">
                  🔒 Anônima (LGPD) · diretoria vê só o consolidado.
                </p>

                {gestor && aberta && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    disabled={busy}
                    onClick={() =>
                      acao(() => api.encerrarClima(pesquisa.id))
                    }
                  >
                    Encerrar pesquisa
                  </Button>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </Shell>
  );
}
