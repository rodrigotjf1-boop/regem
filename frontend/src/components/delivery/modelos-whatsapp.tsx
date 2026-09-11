'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Marketing · Modelos (templates da API oficial, Opção B). Cria/edita/submete à Meta +
// acompanha aprovação. Suporta BOTÕES (Peça agora / Copiar cupom / Sair das ofertas) e
// CARROSSEL (2–10 cards com imagem). Sempre com PRÉVIA. Só faz sentido no provedor cloud.

const STATUS: Record<string, { t: string; c: string }> = {
  rascunho: { t: 'rascunho', c: 'bg-muted text-foreground/70' },
  pendente: { t: 'em análise', c: 'bg-amber-500/10 text-amber-600' },
  aprovado: { t: 'aprovado', c: 'bg-emerald-500/10 text-emerald-600' },
  rejeitado: { t: 'rejeitado', c: 'bg-destructive/10 text-destructive' },
  pausado: { t: 'pausado', c: 'bg-amber-500/10 text-amber-600' },
};
const vazio = { id: '', nome: '', categoria: 'MARKETING', idioma: 'pt_BR', cabecalho: '', corpo: '', rodape: '' };

const PRESETS: { t: string; form: any; exemplo: string[]; peca?: boolean; cupom?: boolean }[] = [
  {
    t: 'Frete grátis',
    form: { id: '', nome: 'promo_frete_gratis', categoria: 'MARKETING', idioma: 'pt_BR', cabecalho: 'Frete grátis hoje', corpo: 'Olá {{1}}! Hoje é FRETE GRÁTIS na nossa loja. Aproveite e faça seu pedido! 🛵', rodape: '' },
    exemplo: ['João'], peca: true, cupom: true,
  },
  {
    t: 'Recuperar cliente',
    form: { id: '', nome: 'recuperacao_cliente', categoria: 'MARKETING', idioma: 'pt_BR', cabecalho: 'Sentimos sua falta', corpo: 'Oi {{1}}, faz um tempo que você não pede! Bateu aquela vontade? Veja as novidades. 😊', rodape: '' },
    exemplo: ['Maria'], peca: true,
  },
];

// Regras da Meta que rejeitam automático (aviso imediato ao lojista). null = ok.
function validarCorpo(txt: string): string | null {
  const t = (txt ?? '').trim();
  if (t.length < 3) return null; // ainda digitando
  if (/^\{\{\s*\d+\s*\}\}/.test(t)) return 'Não pode começar com variável ({{1}}) — regra da Meta. Coloque um texto antes (ex.: "Olá {{1}}…").';
  if (/\{\{\s*\d+\s*\}\}\s*$/.test(t)) return 'Não pode terminar com variável — regra da Meta. Coloque um texto depois.';
  if (/\{\{\s*\d+\s*\}\}\s*\{\{\s*\d+\s*\}\}/.test(t)) return 'Duas variáveis coladas ({{1}} {{2}}) — separe com texto.';
  const nums = (t.match(/\{\{\s*\d+\s*\}\}/g) ?? []).map((v) => Number(v.replace(/\D/g, '')));
  const uniq = [...new Set(nums)].sort((a, b) => a - b);
  if (uniq.some((n, i) => n !== i + 1)) return 'As variáveis devem ser {{1}}, {{2}}… em sequência, sem pular números.';
  return null;
}

// Regras do CABEÇALHO (HEADER TEXT) da Meta: sem emoji, quebra de linha, asterisco ou
// formatação (* _ ~ `), e até 60 caracteres. (Emoji é permitido só no corpo.)
function validarCabecalho(txt: string): string | null {
  const s = String(txt ?? '');
  if (!s.trim()) return null; // opcional
  if (/[\r\n]/.test(s)) return 'O cabeçalho não pode ter quebra de linha (regra da Meta).';
  if (/[*_~`]/.test(s)) return 'O cabeçalho não pode ter formatação (* _ ~ `) — use só no corpo.';
  if (/\p{Extended_Pictographic}/u.test(s)) return 'O cabeçalho não pode ter emoji — use emoji só no corpo.';
  if (s.length > 60) return 'O cabeçalho deve ter até 60 caracteres.';
  return null;
}

// Comprime imagem no navegador (1080px máx, JPG q80) antes de subir.
async function comprimir(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = document.createElement('img');
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const esc = Math.min(1, 1080 / Math.max(img.width, img.height));
    const w = Math.round(img.width * esc), h = Math.round(img.height * esc);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b as Blob), 'image/jpeg', 0.8));
    return new File([blob], 'card.jpg', { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ModelosWhatsapp({ pode }: { pode: boolean }) {
  const [lista, setLista] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<Record<string, any>>({}); // desempenho Meta por modelo (por loja)
  const [form, setForm] = useState<any>(vazio);
  const [exemplos, setExemplos] = useState<string[]>([]);
  const [formato, setFormato] = useState<'padrao' | 'carrossel'>('padrao');
  const [cards, setCards] = useState<{ imagemRef: string; corpo: string }[]>([]);
  const [btnPeca, setBtnPeca] = useState(false);
  const [btnCupom, setBtnCupom] = useState(false);
  const [btnOptout, setBtnOptout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aberto, setAberto] = useState(false);
  const cardFileRef = useRef<HTMLInputElement>(null);
  const cardAlvo = useRef<number>(-1);

  const carregar = async () => {
    try { setLista(await api.whatsappTemplatesLocais()); } catch { /* ignore */ }
    // Desempenho na Meta (best-effort; só desta loja — o backend filtra por tenant).
    api.whatsappTemplatesAnalytics().then((r: any) => setAnalytics(r?.porTemplate ?? {})).catch(() => {});
  };
  useEffect(() => { carregar(); }, []);

  const nVars = (form.corpo.match(/\{\{\d+\}\}/g) ?? []).length;
  useEffect(() => { setExemplos((cur) => Array.from({ length: nVars }, (_, i) => cur[i] ?? '')); }, [nVars]);

  function resetar() {
    setForm(vazio); setExemplos([]); setFormato('padrao'); setCards([]);
    setBtnPeca(false); setBtnCupom(false); setBtnOptout(false);
  }

  function aplicarPreset(p: any) {
    setForm({ ...p.form }); setExemplos([...p.exemplo]); setFormato('padrao'); setCards([]);
    setBtnPeca(!!p.peca); setBtnCupom(!!p.cupom); setBtnOptout(true);
  }

  function editar(t: any) {
    setForm({ id: t.id, nome: t.nome, categoria: t.categoria, idioma: t.idioma, cabecalho: t.cabecalho ?? '', corpo: t.corpo, rodape: t.rodape ?? '' });
    setExemplos((t.exemplo as string[]) ?? []);
    setFormato(t.formato === 'carrossel' ? 'carrossel' : 'padrao');
    setCards(Array.isArray(t.cards) ? t.cards.map((c: any) => ({ imagemRef: c.imagemRef, corpo: c.corpo ?? '' })) : []);
    const bt = (t.botoes as any[]) ?? [];
    setBtnPeca(bt.some((b) => b.tipo === 'url'));
    setBtnCupom(bt.some((b) => b.tipo === 'copy_code'));
    setBtnOptout(bt.some((b) => b.tipo === 'optout'));
    setAberto(true);
  }

  // Botões (mesma config aplicada ao template simples e a cada card do carrossel).
  function montarBotoes() {
    const b: any[] = [];
    if (btnPeca) b.push({ tipo: 'url', texto: 'Peça agora' });
    if (btnCupom) b.push({ tipo: 'copy_code', texto: 'Copiar cupom' });
    if (btnOptout) b.push({ tipo: 'optout', texto: 'Sair das ofertas' });
    return b;
  }

  async function subirCardImg(i: number, f: File) {
    setBusy(true);
    try {
      const r: any = await api.upload(await comprimir(f));
      setCards((cs) => cs.map((c, j) => (j === i ? { ...c, imagemRef: r?.url ?? '' } : c)));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao subir a imagem.');
    } finally {
      setBusy(false);
    }
  }

  async function salvar(submeter: boolean) {
    if (form.corpo.trim().length < 3) return toast.error(formato === 'carrossel' ? 'Escreva o texto do topo do carrossel.' : 'Escreva o corpo do modelo.');
    // Regras da Meta (só bloqueiam no ENVIO p/ aprovação; rascunho pode salvar).
    if (submeter) {
      const eCorpo = validarCorpo(form.corpo);
      if (eCorpo) return toast.error(eCorpo);
      const eCard = cards.map((c, i) => (validarCorpo(c.corpo) ? `Card ${i + 1}: ${validarCorpo(c.corpo)}` : null)).find(Boolean);
      if (eCard) return toast.error(eCard);
    }
    if (formato === 'carrossel') {
      if (cards.length < 2) return toast.error('O carrossel precisa de pelo menos 2 cards.');
      if (cards.some((c) => !c.imagemRef)) return toast.error('Todo card precisa de uma imagem.');
    }
    setBusy(true);
    try {
      const botoes = montarBotoes();
      const salvo: any = await api.whatsappTemplateSalvar({
        ...form,
        exemplo: exemplos,
        botoes,
        formato,
        cards: formato === 'carrossel' ? cards.map((c) => ({ ...c, botoes })) : null,
      });
      if (submeter) {
        await api.whatsappTemplateSubmeter(salvo.id);
        toast.success('Modelo enviado para aprovação da Meta.');
      } else toast.success('Rascunho salvo.');
      resetar(); setAberto(false); carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function submeter(id: string) {
    setBusy(true);
    try { await api.whatsappTemplateSubmeter(id); toast.success('Enviado para aprovação.'); carregar(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha ao submeter.'); }
    finally { setBusy(false); }
  }
  async function sincronizar() {
    setBusy(true);
    try { setLista(await api.whatsappTemplatesSincronizar()); toast.success('Status sincronizado.'); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha ao sincronizar.'); }
    finally { setBusy(false); }
  }
  async function reenviarRegem() {
    if (!confirm(
      'Enviar a biblioteca de modelos da Regem para ANÁLISE DA META?\n\n' +
      '• Só os modelos que ainda NÃO existem são enviados (é uma vez só).\n' +
      '• Modelos já enviados ou REPROVADOS não são reenviados aqui.\n' +
      '• Para reenviar um reprovado, edite-o e clique em "enviar p/ aprovação".',
    )) return;
    setBusy(true);
    try {
      const r: any = await api.whatsappModelosRegem();
      const novos = (r?.resultados ?? []).filter((x: any) => x?.novo).length;
      toast.success(
        novos > 0
          ? `${novos} modelo(s) da Regem enviado(s) para análise da Meta.`
          : 'Nada a enviar — todos os modelos da Regem já existem (nenhum reenviado).',
      );
      carregar();
    }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha ao enviar os modelos.'); }
    finally { setBusy(false); }
  }
  async function reenviarUtilidade() {
    if (!confirm(
      'Enviar a biblioteca de modelos de UTILIDADE (avisos de status do pedido) para ANÁLISE DA META?\n\n' +
      '• São os avisos "em produção", "pronto", "saiu para entrega", "entregue", "cancelado", "atrasado" e "atendimento".\n' +
      '• Vão para a WABA do número PRINCIPAL (é dele que saem os avisos).\n' +
      '• Só os que ainda NÃO existem são enviados. Reprovados não são reenviados aqui.',
    )) return;
    setBusy(true);
    try {
      const r: any = await api.whatsappModelosUtilidade();
      const novos = (r?.resultados ?? []).filter((x: any) => x?.novo).length;
      toast.success(
        novos > 0
          ? `${novos} modelo(s) de utilidade enviado(s) para análise da Meta.`
          : 'Nada a enviar — todos os modelos de utilidade já existem (nenhum reenviado).',
      );
      carregar();
    }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha ao enviar os modelos de utilidade.'); }
    finally { setBusy(false); }
  }
  async function remover(id: string) {
    if (!confirm('Remover este modelo do Regem?')) return;
    try { await api.whatsappTemplateRemover(id); carregar(); }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Falha ao remover.'); }
  }

  const botoesPreview = montarBotoes();
  const erroCorpo = validarCorpo(form.corpo);
  const erroCabecalho = validarCabecalho(form.cabecalho);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-foreground/70">Modelos aprovados pela Meta permitem <strong>iniciar</strong> conversa (marketing) na API oficial.</p>
        {pode && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={reenviarRegem} title="Envia à Meta só os modelos da Regem que ainda não existem (uma vez). Não reenvia reprovados.">Modelos da Regem</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={reenviarUtilidade} title="Envia à Meta os avisos de status do pedido (em produção, pronto, saiu para entrega, entregue, cancelado, atrasado, atendimento) à WABA do número principal.">Modelos de utilidade</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={sincronizar}>Sincronizar com a Meta</Button>
            <Button size="sm" onClick={() => { resetar(); setAberto((v) => !v); }}>{aberto ? 'Fechar' : '＋ Novo modelo'}</Button>
          </div>
        )}
      </div>
      <p className="rounded-lg bg-primary/5 px-3 py-2 text-[12px] text-foreground/70">
        ℹ️ Ao conectar a API oficial, a <strong>biblioteca de modelos da Regem</strong> já é enviada pra aprovação automaticamente. Você também pode <strong>criar modelos novos</strong> — mas todo modelo novo <strong>passa pela análise da Meta</strong>, e a aprovação depende dela (siga o formato exigido).
      </p>

      {aberto && pode && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Editor */}
          <Card className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-foreground/70">Começar de um modelo pronto:</span>
              {PRESETS.map((p) => (
                <button key={p.t} type="button" onClick={() => aplicarPreset(p)} className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">{p.t}</button>
              ))}
            </div>

            {/* Formato */}
            <div className="flex gap-2">
              {(['padrao', 'carrossel'] as const).map((f) => (
                <button key={f} type="button" onClick={() => setFormato(f)} aria-pressed={formato === f}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${formato === f ? 'border-primary bg-primary/5 text-primary' : 'border-border text-foreground/70'}`}>
                  {f === 'padrao' ? 'Mensagem simples' : 'Carrossel (vários produtos)'}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-xs"><span className="mb-0.5 block text-foreground/70">Nome técnico</span>
                <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="promo_frete_gratis" /></label>
              <label className="text-xs"><span className="mb-0.5 block text-foreground/70">Categoria</span>
                <select value={form.categoria} onChange={(e) => setForm({ ...form, categoria: e.target.value })} className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm">
                  <option value="MARKETING">Marketing</option><option value="UTILITY">Utilidade</option><option value="AUTHENTICATION">Autenticação</option>
                </select></label>
              <label className="text-xs"><span className="mb-0.5 block text-foreground/70">Idioma</span>
                <Input value={form.idioma} onChange={(e) => setForm({ ...form, idioma: e.target.value })} placeholder="pt_BR" /></label>
            </div>

            {formato === 'padrao' && (
              <label className="block text-xs"><span className="mb-0.5 block text-foreground/70">Cabeçalho (opcional) — sem emoji, quebra de linha ou * _ ~ ` (emoji só no corpo)</span>
                <Input value={form.cabecalho} onChange={(e) => setForm({ ...form, cabecalho: e.target.value })} placeholder="Ex.: Oferta da semana" className={erroCabecalho ? 'border-destructive' : undefined} />
                {erroCabecalho && <p className="mt-1 text-[11px] text-destructive">⚠️ {erroCabecalho}</p>}</label>
            )}

            <label className="block text-xs">
              <span className="mb-0.5 block text-foreground/70">{formato === 'carrossel' ? 'Texto do topo (balão)' : 'Corpo'} — use {'{{1}}'} p/ o nome</span>
              <textarea value={form.corpo} onChange={(e) => setForm({ ...form, corpo: e.target.value })} rows={3}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${erroCorpo ? 'border-destructive' : 'border-border'}`} placeholder="Olá {{1}}! Confira nossas ofertas 🍔" />
              {erroCorpo && <p className="mt-1 text-[11px] text-destructive">⚠️ {erroCorpo}</p>}
            </label>
            {nVars > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                {exemplos.map((ex, i) => (
                  <label key={i} className="text-xs"><span className="mb-0.5 block text-foreground/70">Exemplo {'{{'}{i + 1}{'}}'}</span>
                    <Input value={ex} onChange={(e) => setExemplos((c) => c.map((x, j) => (j === i ? e.target.value : x)))} placeholder="João" /></label>
                ))}
              </div>
            )}

            {formato === 'padrao' && (
              <label className="block text-xs"><span className="mb-0.5 block text-foreground/70">Rodapé (opcional)</span>
                <Input value={form.rodape} onChange={(e) => setForm({ ...form, rodape: e.target.value })} placeholder="Ex.: Válido só hoje" /></label>
            )}

            {/* Botões */}
            <div className="rounded-lg border border-dashed border-border p-2 text-xs">
              <p className="mb-1 font-semibold text-foreground/70">Botões {formato === 'carrossel' ? '(iguais em todos os cards)' : ''}</p>
              <div className="flex flex-col gap-1">
                <label className="flex items-center gap-2"><input type="checkbox" checked={btnPeca} onChange={(e) => setBtnPeca(e.target.checked)} /> <strong>Peça agora</strong> — leva ao link da campanha (clique medido)</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={btnCupom} onChange={(e) => setBtnCupom(e.target.checked)} /> <strong>Copiar cupom</strong> — usa o cupom da campanha</label>
                <label className="flex items-center gap-2"><input type="checkbox" checked={btnOptout} onChange={(e) => setBtnOptout(e.target.checked)} /> <strong>Sair das ofertas</strong> — opt-out automático (LGPD)</label>
              </div>
            </div>

            {/* Cards do carrossel */}
            {formato === 'carrossel' && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-foreground/70">Cards (2 a 10 — só imagem por ora)</p>
                <input ref={cardFileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f && cardAlvo.current >= 0) subirCardImg(cardAlvo.current, f); }} />
                {cards.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 rounded-lg border border-border p-2">
                    <button type="button" className="h-16 w-16 shrink-0 overflow-hidden rounded border border-border bg-muted" onClick={() => { cardAlvo.current = i; cardFileRef.current?.click(); }}>
                      {c.imagemRef ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.imagemRef} alt="" className="h-full w-full object-cover" /> : <span className="text-[10px] text-foreground/60">＋ imagem</span>}
                    </button>
                    <textarea value={c.corpo} onChange={(e) => setCards((cs) => cs.map((x, j) => (j === i ? { ...x, corpo: e.target.value } : x)))} rows={2} maxLength={160}
                      className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs" placeholder="Descrição do produto (até 160)" />
                    <button type="button" className="text-[11px] text-destructive underline" onClick={() => setCards((cs) => cs.filter((_, j) => j !== i))}>remover</button>
                  </div>
                ))}
                {cards.length < 10 && (
                  <Button type="button" size="sm" variant="outline" onClick={() => setCards((cs) => [...cs, { imagemRef: '', corpo: '' }])}>＋ Card</Button>
                )}
                <p className="text-[11px] text-foreground/60">Imagem ideal 1080×1080 ou 1200×628. Comprimimos automático.</p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => salvar(false)}>Salvar rascunho</Button>
              <Button size="sm" disabled={busy || !!erroCorpo || !!erroCabecalho} onClick={() => salvar(true)}>Salvar e enviar p/ aprovação</Button>
            </div>
          </Card>

          {/* PRÉVIA */}
          <Card className="p-4">
            <p className="mb-2 text-xs font-semibold text-foreground/70">Prévia (como o cliente vê)</p>
            <div className="rounded-lg bg-[#e5ddd5] p-3">
              <div className="max-w-[320px] rounded-lg bg-white p-2 shadow">
                {form.cabecalho && formato === 'padrao' && <p className="text-[13px] font-bold text-[#111]">{form.cabecalho}</p>}
                {form.corpo && <p className="whitespace-pre-wrap break-words text-[13px] leading-snug text-[#111]">{form.corpo.replace('{{1}}', exemplos[0] || 'João')}</p>}
                {form.rodape && formato === 'padrao' && <p className="mt-1 text-[11px] text-[#667781]">{form.rodape}</p>}
                {formato === 'carrossel' && (
                  <div className="mt-2 flex gap-2 overflow-x-auto">
                    {cards.map((c, i) => (
                      <div key={i} className="w-40 shrink-0 rounded-lg border border-[#eee]">
                        {c.imagemRef ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={c.imagemRef} alt="" className="h-24 w-full rounded-t-lg object-cover" /> : <div className="grid h-24 place-items-center rounded-t-lg bg-[#f0f0f0] text-[10px] text-[#999]">sem imagem</div>}
                        <p className="px-1.5 py-1 text-[11px] text-[#111]">{c.corpo || 'descrição…'}</p>
                        {botoesPreview.map((b, k) => <div key={k} className="border-t border-[#eee] py-1 text-center text-[11px] font-semibold text-[#0a7cff]">{b.texto}</div>)}
                      </div>
                    ))}
                    {cards.length === 0 && <p className="text-[11px] text-[#667781]">adicione cards…</p>}
                  </div>
                )}
                {formato === 'padrao' && botoesPreview.map((b, k) => (
                  <div key={k} className="mt-1 border-t border-[#eee] pt-1 text-center text-[12px] font-semibold text-[#0a7cff]">{b.texto}</div>
                ))}
                <span className="mt-1 block text-right text-[10px] text-[#667781]">agora ✓✓</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Lista */}
      <Card className="p-0">
        <div className="border-b border-border px-4 py-3"><p className="font-display font-bold">Modelos</p></div>
        {lista.length === 0 ? (
          <p className="px-4 py-6 text-sm text-foreground/70">Nenhum modelo ainda.</p>
        ) : (
          <div className="divide-y divide-border">
            {lista.map((t) => {
              const st = STATUS[t.status] ?? STATUS.rascunho;
              return (
                <div key={t.id} className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{t.nome}</span>
                    {t.formato === 'carrossel' && <span className="rounded-full border border-border px-2 py-0.5 text-[10px]">carrossel</span>}
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-foreground/70">{t.categoria}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${st.c}`}>{st.t}</span>
                    <div className="ml-auto flex gap-2">
                      {pode && (t.status === 'rascunho' || t.status === 'rejeitado') && <button type="button" className="text-[11px] text-primary underline" disabled={busy} onClick={() => submeter(t.id)}>enviar p/ aprovação</button>}
                      {pode && <button type="button" className="text-[11px] underline" onClick={() => editar(t)}>editar</button>}
                      {pode && <button type="button" className="text-[11px] text-destructive underline" onClick={() => remover(t.id)}>remover</button>}
                    </div>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-foreground/70">{t.corpo}</p>
                  {t.status === 'rejeitado' && t.motivo_rejeicao && <p className="mt-1 text-[11px] text-destructive">Motivo: {t.motivo_rejeicao}</p>}
                  {analytics[t.nome]?.enviados > 0 && (
                    <p className="mt-1 text-[11px] text-foreground/60">
                      📊 {analytics[t.nome].enviados} enviados · {analytics[t.nome].entregues} entregues · {analytics[t.nome].lidos} lidos · {analytics[t.nome].cliques} clique(s)
                      {analytics[t.nome].custo > 0 ? ` · custo ${Number(analytics[t.nome].custo).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : ''}
                      <span className="ml-1 text-foreground/40">(últimos 30 dias, Meta)</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
