'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */
const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';
const CAMPO_LABEL: Record<string, string> = {
  loja: 'Nome da loja', produto: 'Produto', unidade: 'Unidade', fabricacao: 'Fabricação',
  compra: 'Data da compra', status: 'Status (fechado/uso)', validade: 'Validade', responsavel: 'Responsável',
};
const brDate = (iso?: string) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '—');
const STATUS_LABEL: Record<string, { txt: string; cls: string }> = {
  fechado: { txt: 'Fechado', cls: 'bg-info/10 text-info' },
  em_uso: { txt: 'Em uso', cls: 'bg-warn/10 text-warn' },
  baixado: { txt: 'Baixado', cls: 'bg-muted text-muted-foreground' },
  vencido: { txt: 'Vencido/perda', cls: 'bg-danger/10 text-danger' },
};

export function EtiquetasSecao() {
  const [aba, setAba] = useState<'gerar' | 'ativas' | 'template'>('gerar');
  const [fontes, setFontes] = useState<{ produtos: any[]; fichas: any[]; itens: any[] }>({ produtos: [], fichas: [], itens: [] });
  const [lista, setLista] = useState<any[]>([]);
  const [template, setTemplate] = useState<any>(null);

  const reload = useCallback(async () => {
    const [f, l, t] = await Promise.all([
      api.etiquetaFontes().catch(() => ({ produtos: [], fichas: [], itens: [] })),
      api.etiquetasValidade().catch(() => []),
      api.etiquetaTemplate().catch(() => null),
    ]);
    setFontes(f as any);
    setLista(Array.isArray(l) ? l : []);
    setTemplate(t);
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display font-semibold">Etiquetas de validade</h2>
        <div className="flex gap-1 overflow-x-auto">
          {(['gerar', 'ativas', 'template'] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAba(a)}
              className={`whitespace-nowrap rounded-md border px-3 py-1 text-xs font-medium ${aba === a ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
            >
              {a === 'gerar' ? 'Gerar' : a === 'ativas' ? `Ativas (${lista.filter((e) => e.status === 'fechado' || e.status === 'em_uso').length})` : 'Modelo'}
            </button>
          ))}
        </div>
      </div>

      {aba === 'gerar' && <GerarEtiqueta fontes={fontes} onDone={reload} />}
      {aba === 'ativas' && <Ativas lista={lista} onChange={reload} />}
      {aba === 'template' && template && <TemplateEditor template={template} onSaved={reload} />}
    </section>
  );
}

function GerarEtiqueta({ fontes, onDone }: { fontes: any; onDone: () => void }) {
  const [fonteKey, setFonteKey] = useState('');
  const [tipoUso, setTipoUso] = useState<'novo' | 'usado'>('novo');
  const [quantidade, setQuantidade] = useState('1');
  const [fabricacao, setFabricacao] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);

  const opcoes = useMemo(() => {
    const p = (fontes.produtos ?? []).map((x: any) => ({ ...x, key: `produto:${x.id}` }));
    const f = (fontes.fichas ?? []).map((x: any) => ({ ...x, key: `ficha:${x.id}` }));
    const it = (fontes.itens ?? []).map((x: any) => ({ ...x, key: `item:${x.id}` }));
    return [...p, ...f, ...it];
  }, [fontes]);

  async function gerar(e: React.FormEvent) {
    e.preventDefault();
    if (!fonteKey) return toast.error('Escolha o produto, ficha ou insumo.');
    const [tipo, id] = fonteKey.split(':');
    setBusy(true);
    try {
      const r: any = await api.criarEtiqueta({
        produtoId: tipo === 'produto' ? id : undefined,
        fichaId: tipo === 'ficha' ? id : undefined,
        itemId: tipo === 'item' ? id : undefined,
        tipoUso,
        quantidade: Number(quantidade) || 1,
        fabricacao,
      });
      toast.success(`${r?.criadas ?? 1} etiqueta(s) gerada(s) e enviada(s) à impressão.`);
      onDone();
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao gerar etiqueta.');
    } finally {
      setBusy(false);
    }
  }

  if (opcoes.length === 0)
    return (
      <Card className="p-6 text-center text-sm text-muted-foreground">
        Nenhuma fonte com validade. Ative “Controla validade” num produto, informe a validade numa ficha ou cadastre a validade num insumo.
      </Card>
    );

  return (
    <Card className="p-4">
      <form onSubmit={gerar} className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Produto / ficha</Label>
          <select className={selectCls} value={fonteKey} onChange={(e) => setFonteKey(e.target.value)} required>
            <option value="">— escolha —</option>
            <optgroup label="Produtos">
              {(fontes.produtos ?? []).map((p: any) => (
                <option key={p.id} value={`produto:${p.id}`}>{p.nome}</option>
              ))}
            </optgroup>
            <optgroup label="Fichas técnicas">
              {(fontes.fichas ?? []).map((f: any) => (
                <option key={f.id} value={`ficha:${f.id}`}>{f.nome}</option>
              ))}
            </optgroup>
            <optgroup label="Insumos">
              {(fontes.itens ?? []).map((i: any) => (
                <option key={i.id} value={`item:${i.id}`}>{i.nome}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="space-y-1.5">
          <Label>Produto novo ou usado?</Label>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" aria-pressed={tipoUso === 'novo'} onClick={() => setTipoUso('novo')}
              className={`rounded-lg border p-2 text-xs font-semibold ${tipoUso === 'novo' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>
              Novo (fechado)
            </button>
            <button type="button" aria-pressed={tipoUso === 'usado'} onClick={() => setTipoUso('usado')}
              className={`rounded-lg border p-2 text-xs font-semibold ${tipoUso === 'usado' ? 'border-primary bg-primary/10 text-primary' : 'border-border'}`}>
              Usado (aberto)
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Quantidade</Label>
          <Input type="number" min={1} max={50} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
        </div>
        {tipoUso === 'novo' && (
          <div className="space-y-1.5">
            <Label>Data de fabricação</Label>
            <Input type="date" value={fabricacao} onChange={(e) => setFabricacao(e.target.value)} />
          </div>
        )}
        <div className="sm:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? 'Gerando…' : 'Gerar e imprimir'}</Button>
        </div>
      </form>
    </Card>
  );
}

function Ativas({ lista, onChange }: { lista: any[]; onChange: () => void }) {
  const [codigo, setCodigo] = useState('');
  const ativas = lista.filter((e) => e.status === 'fechado' || e.status === 'em_uso');
  const vencidas = lista.filter((e) => e.vencida && e.status !== 'baixado');

  async function ler(e: React.FormEvent) {
    e.preventDefault();
    if (!codigo.trim()) return;
    try {
      const r: any = await api.lerEtiqueta(codigo.trim());
      toast.success(r?.acao === 'aberto' ? 'Etiqueta aberta (em uso).' : 'Etiqueta baixada.');
      setCodigo('');
      onChange();
    } catch (err: any) {
      toast.error(err?.message || 'Código não encontrado.');
    }
  }

  async function acao(fn: () => Promise<any>, msg: string) {
    try {
      await fn();
      toast.success(msg);
      onChange();
    } catch (err: any) {
      toast.error(err?.message || 'Falha na operação.');
    }
  }

  return (
    <div className="space-y-3">
      <Card className="p-3">
        <form onSubmit={ler} className="flex gap-2">
          <Input value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Ler código da etiqueta (abrir / baixar)" />
          <Button type="submit" variant="outline">Ler</Button>
        </form>
      </Card>

      {vencidas.length > 0 && (
        <Card className="border-danger/40 bg-danger/5 p-3">
          <p className="mb-2 text-sm font-semibold text-danger">⚠️ {vencidas.length} etiqueta(s) vencida(s)</p>
          <div className="space-y-1.5">
            {vencidas.map((e) => (
              <div key={e.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{e.descricao} · venceu {brDate(e.validade)}</span>
                <span className="flex gap-1.5">
                  <button className="text-xs font-semibold text-ok" onClick={() => acao(() => api.finalizarEtiqueta(e.id), 'Finalizado (usado).')}>usei → finalizar</button>
                  <button className="text-xs font-semibold text-danger" onClick={() => acao(() => api.perdaEtiqueta(e.id), 'Registrado como perda.')}>venceu → perda</button>
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {ativas.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma etiqueta ativa.</Card>
      ) : (
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {ativas.map((e) => {
            const st = STATUS_LABEL[e.status] ?? { txt: e.status, cls: 'bg-muted' };
            const alerta = e.diasRestantes <= 1;
            return (
              <Card key={e.id} className={`p-3 ${alerta ? 'border-danger/40' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.descricao}</p>
                    <p className="text-xs text-muted-foreground">
                      Validade {brDate(e.validade)} · {e.diasRestantes < 0 ? 'vencida' : `${e.diasRestantes} dia(s)`}
                    </p>
                    <p className="font-mono text-[11px] text-muted-foreground">#{e.codigo}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.txt}</span>
                </div>
                {/* E2 — escolher: Abrir (depois fechar) ou Baixar direto (usou já). */}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {e.status === 'fechado' && (
                    <button
                      type="button"
                      className="rounded border border-border px-2.5 py-1 text-xs font-semibold hover:bg-secondary"
                      onClick={async () => {
                        try {
                          const r: any = await api.abrirEtiqueta(e.id);
                          toast.success(r?.reimpresso ? 'Aberta — nova via impressa (validade encurtou).' : 'Aberta (em uso).');
                          onChange();
                        } catch (err: any) {
                          toast.error(err?.message || 'Falha ao abrir.');
                        }
                      }}
                    >
                      Abrir
                    </button>
                  )}
                  <button
                    type="button"
                    className="rounded border border-border px-2.5 py-1 text-xs font-semibold text-ok hover:bg-secondary"
                    onClick={() => acao(() => api.finalizarEtiqueta(e.id), 'Baixada (usada).')}
                  >
                    Baixar
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Tamanhos comuns de etiqueta térmica (mm) — desktop Argox/Elgin/Zebra, food/RDC 216.
const TAMANHOS = ['33x22', '40x25', '50x30', '60x30', '60x40', '40x40', '80x40', '100x50'];
// Valores de exemplo p/ a prévia (espelham renderEtiqueta do backend).
const CAMPO_EXEMPLO: Record<string, string> = {
  loja: 'Minha Loja', produto: 'Tomate', unidade: 'Unid.: kg',
  fabricacao: 'Fabricacao: 11/08/2026', compra: 'Compra: 09/08/2026',
  status: 'Status: FECHADO', validade: 'VALIDADE: 13/08/2026', responsavel: 'Resp.: Rodrigo',
};

function TemplateEditor({ template, onSaved }: { template: any; onSaved: () => void }) {
  const [campos, setCampos] = useState<any[]>(template.campos ?? []);
  const [tamanho, setTamanho] = useState<string>(template.tamanho ?? '40x40');
  const [codigoTipo, setCodigoTipo] = useState(template.codigoTipo ?? 'code128');
  const [busy, setBusy] = useState(false);

  const isCustom = !TAMANHOS.includes(tamanho);
  const [cw, ch] = (/^\d+x\d+$/.test(tamanho) ? tamanho.split('x') : ['40', '40']).map(Number);
  const setDim = (l: number, a: number) => {
    const L = Math.max(10, Math.min(200, Math.round(l) || 40));
    const A = Math.max(10, Math.min(200, Math.round(a) || 40));
    setTamanho(`${L}x${A}`);
  };

  function toggle(i: number, key: 'visivel' | 'negrito') {
    setCampos((prev) => prev.map((c, idx) => (idx === i ? { ...c, [key]: !c[key] } : c)));
  }

  async function salvar() {
    setBusy(true);
    try {
      await api.salvarEtiquetaTemplate({ campos, tamanho, codigoTipo });
      toast.success('Modelo salvo.');
      onSaved();
    } catch (err: any) {
      toast.error(err?.message || 'Falha ao salvar.');
    } finally {
      setBusy(false);
    }
  }

  // Prévia: caixa proporcional ao tamanho (mm). s = px por mm (limita p/ caber).
  const s = Math.min(3.4, 250 / Math.max(cw, ch));
  const visiveis = campos.filter((c) => c.visivel !== false);

  return (
    <Card className="p-4">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Editor */}
        <div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Tamanho (mm)</Label>
              <select
                className={selectCls}
                value={isCustom ? 'custom' : tamanho}
                onChange={(e) => { if (e.target.value !== 'custom') setTamanho(e.target.value); else if (!isCustom) setTamanho(`${cw}x${ch}`); }}
              >
                {TAMANHOS.map((t) => (<option key={t} value={t}>{t.replace('x', ' × ')}</option>))}
                <option value="custom">Personalizado…</option>
              </select>
              {isCustom && (
                <div className="flex items-center gap-1.5 pt-1">
                  <Input type="number" min={10} max={200} value={cw} onChange={(e) => setDim(Number(e.target.value), ch)} className="h-9 w-20" aria-label="Largura em mm" />
                  <span className="text-sm text-muted-foreground">×</span>
                  <Input type="number" min={10} max={200} value={ch} onChange={(e) => setDim(cw, Number(e.target.value))} className="h-9 w-20" aria-label="Altura em mm" />
                  <span className="text-xs text-muted-foreground">mm</span>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Código</Label>
              <select className={selectCls} value={codigoTipo} onChange={(e) => setCodigoTipo(e.target.value)}>
                <option value="code128">Barras (Code128)</option>
                <option value="ean13">Barras (EAN-13)</option>
                <option value="qr">Mini-QR</option>
                <option value="nenhum">Sem código</option>
              </select>
            </div>
          </div>
          <p className="mt-4 mb-2 text-sm font-medium">Campos da etiqueta</p>
          <div className="space-y-1.5">
            {campos.map((c, i) => (
              <div key={c.campo} className="flex items-center justify-between gap-2 rounded border border-border px-3 py-2 text-sm">
                <span>{CAMPO_LABEL[c.campo] ?? c.campo}</span>
                <span className="flex gap-3 text-xs">
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={c.visivel !== false} onChange={() => toggle(i, 'visivel')} className="h-4 w-4 accent-primary" />
                    visível
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input type="checkbox" checked={!!c.negrito} onChange={() => toggle(i, 'negrito')} className="h-4 w-4 accent-primary" />
                    negrito
                  </label>
                </span>
              </div>
            ))}
          </div>
          <Button className="mt-4" onClick={salvar} disabled={busy}>{busy ? 'Salvando…' : 'Salvar modelo'}</Button>
        </div>

        {/* Prévia (E5) */}
        <div className="space-y-1.5">
          <Label>Prévia — {cw} × {ch} mm</Label>
          <div className="flex justify-center rounded-lg border border-dashed border-border bg-secondary/30 p-4">
            <div
              className="flex flex-col overflow-hidden bg-white text-black shadow-sm"
              style={{ width: cw * s, height: ch * s, padding: Math.max(3, 4 * (s / 3)), fontSize: Math.max(7, 3.2 * s), lineHeight: 1.15 }}
            >
              {visiveis.length === 0 && <span className="text-[10px] text-gray-400">nenhum campo visível</span>}
              {visiveis.map((c, i) => (
                <div key={i} style={{ fontWeight: c.negrito ? 700 : 400, fontSize: c.campo === 'validade' ? '1.2em' : undefined }}>
                  {CAMPO_EXEMPLO[c.campo] ?? c.campo}
                </div>
              ))}
              {codigoTipo !== 'nenhum' && (
                <div className="mt-auto pt-1">
                  {codigoTipo === 'qr' ? (
                    <div style={{ width: 13 * s, height: 13 * s, background: 'conic-gradient(#000 25%, #fff 0 50%, #000 0 75%, #fff 0)', backgroundSize: '3px 3px' }} aria-label="QR (exemplo)" />
                  ) : (
                    <div style={{ height: 8 * s, width: '75%', background: 'repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 5px)' }} aria-label="código de barras (exemplo)" />
                  )}
                </div>
              )}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">Prévia aproximada. O <b>nome da loja</b> real vem de Configurações → Loja (“Nome do estabelecimento”).</p>
        </div>
      </div>
    </Card>
  );
}
