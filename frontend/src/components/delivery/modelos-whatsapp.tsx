'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Marketing · Modelos (templates da API oficial, Opção B). O lojista cria/edita aqui,
// submete à Meta e acompanha a aprovação — sem sair do Regem. A Meta aprova; a gente
// só envia e espelha o status. Variáveis no corpo com {{1}}, {{2}}…

const STATUS: Record<string, { t: string; c: string }> = {
  rascunho: { t: 'rascunho', c: 'bg-muted text-foreground/70' },
  pendente: { t: 'em análise', c: 'bg-amber-500/10 text-amber-600' },
  aprovado: { t: 'aprovado', c: 'bg-emerald-500/10 text-emerald-600' },
  rejeitado: { t: 'rejeitado', c: 'bg-destructive/10 text-destructive' },
  pausado: { t: 'pausado', c: 'bg-amber-500/10 text-amber-600' },
};
const vazio = { id: '', nome: '', categoria: 'MARKETING', idioma: 'pt_BR', cabecalho: '', corpo: '', rodape: '' };

// Modelos prontos (presets) — o lojista clica, revisa e envia pra aprovação. {{1}}=nome
// do cliente, {{2}}=link (mapeie no disparo da campanha). Servem p/ qualquer loja.
const PRESETS: { t: string; form: any; exemplo: string[] }[] = [
  {
    t: 'Frete grátis',
    form: {
      id: '',
      nome: 'promo_frete_gratis',
      categoria: 'MARKETING',
      idioma: 'pt_BR',
      cabecalho: 'Frete grátis hoje! 🛵',
      corpo: 'Olá {{1}}! Hoje é FRETE GRÁTIS na nossa loja. Aproveite e faça seu pedido: {{2}}',
      rodape: 'Responda SAIR para não receber ofertas.',
    },
    exemplo: ['João', 'https://app.dmsregem.com/c/sua-loja'],
  },
  {
    t: 'Recuperar cliente',
    form: {
      id: '',
      nome: 'recuperacao_cliente',
      categoria: 'MARKETING',
      idioma: 'pt_BR',
      cabecalho: 'Sentimos sua falta 😊',
      corpo: 'Oi {{1}}, faz um tempo que você não pede! Bateu aquela vontade? Veja as novidades: {{2}}',
      rodape: 'Responda SAIR para não receber ofertas.',
    },
    exemplo: ['Maria', 'https://app.dmsregem.com/c/sua-loja'],
  },
];

export function ModelosWhatsapp({ pode }: { pode: boolean }) {
  const [lista, setLista] = useState<any[]>([]);
  const [form, setForm] = useState<any>(vazio);
  const [exemplos, setExemplos] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [aberto, setAberto] = useState(false);

  const carregar = async () => {
    try {
      setLista(await api.whatsappTemplatesLocais());
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    carregar();
  }, []);

  // Nº de variáveis {{n}} no corpo → inputs de exemplo (a Meta exige exemplo por variável).
  const nVars = (form.corpo.match(/\{\{\d+\}\}/g) ?? []).length;
  useEffect(() => {
    setExemplos((cur) => Array.from({ length: nVars }, (_, i) => cur[i] ?? ''));
  }, [nVars]);

  function editar(t: any) {
    setForm({ id: t.id, nome: t.nome, categoria: t.categoria, idioma: t.idioma, cabecalho: t.cabecalho ?? '', corpo: t.corpo, rodape: t.rodape ?? '' });
    setExemplos((t.exemplo as string[]) ?? []);
    setAberto(true);
  }

  async function salvar(submeter: boolean) {
    if (form.corpo.trim().length < 3) {
      toast.error('Escreva o corpo do modelo.');
      return;
    }
    setBusy(true);
    try {
      const salvo: any = await api.whatsappTemplateSalvar({ ...form, exemplo: exemplos });
      if (submeter) {
        await api.whatsappTemplateSubmeter(salvo.id);
        toast.success('Modelo enviado para aprovação da Meta.');
      } else {
        toast.success('Rascunho salvo.');
      }
      setForm(vazio);
      setExemplos([]);
      setAberto(false);
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }

  async function submeter(id: string) {
    setBusy(true);
    try {
      await api.whatsappTemplateSubmeter(id);
      toast.success('Enviado para aprovação.');
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao submeter.');
    } finally {
      setBusy(false);
    }
  }

  async function sincronizar() {
    setBusy(true);
    try {
      setLista(await api.whatsappTemplatesSincronizar());
      toast.success('Status sincronizado com a Meta.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao sincronizar.');
    } finally {
      setBusy(false);
    }
  }

  async function remover(id: string) {
    if (!confirm('Remover este modelo do Regem?')) return;
    try {
      await api.whatsappTemplateRemover(id);
      carregar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover.');
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-foreground/70">
          Modelos aprovados pela Meta permitem <strong>iniciar</strong> conversa (marketing) na API oficial.
        </p>
        {pode && (
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={sincronizar}>
              Sincronizar com a Meta
            </Button>
            <Button size="sm" onClick={() => { setForm(vazio); setExemplos([]); setAberto((v) => !v); }}>
              {aberto ? 'Fechar' : '＋ Novo modelo'}
            </Button>
          </div>
        )}
      </div>

      {aberto && pode && (
        <Card className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-foreground/70">Começar de um modelo pronto:</span>
            {PRESETS.map((p) => (
              <button
                key={p.t}
                type="button"
                onClick={() => {
                  setForm({ ...p.form });
                  setExemplos([...p.exemplo]);
                }}
                className="rounded-full border border-primary/40 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary"
              >
                {p.t}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-xs">
              <span className="mb-0.5 block text-foreground/70">Nome técnico</span>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="promo_frete_gratis" />
            </label>
            <label className="text-xs">
              <span className="mb-0.5 block text-foreground/70">Categoria</span>
              <select
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
              >
                <option value="MARKETING">Marketing</option>
                <option value="UTILITY">Utilidade</option>
                <option value="AUTHENTICATION">Autenticação</option>
              </select>
            </label>
            <label className="text-xs">
              <span className="mb-0.5 block text-foreground/70">Idioma</span>
              <Input value={form.idioma} onChange={(e) => setForm({ ...form, idioma: e.target.value })} placeholder="pt_BR" />
            </label>
          </div>
          {/* O que cada categoria significa (a Meta cobra e regula diferente por categoria) */}
          <div className="rounded-lg border border-dashed border-border bg-muted/40 p-2 text-[11px] leading-relaxed text-foreground/75">
            {form.categoria === 'MARKETING' && (
              <span><strong className="text-foreground">Marketing:</strong> promoções, ofertas, novidades, cupons, reativação. Exige opt-in do cliente, tem teto de frequência e é a categoria mais cara. Use para campanhas.</span>
            )}
            {form.categoria === 'UTILITY' && (
              <span><strong className="text-foreground">Utilidade:</strong> mensagens ligadas a uma transação que o cliente já fez (confirmação/status de pedido, recibo, lembrete). Mais barata; dentro da janela de 24h pode ser grátis. Não serve para promoção.</span>
            )}
            {form.categoria === 'AUTHENTICATION' && (
              <span><strong className="text-foreground">Autenticação:</strong> apenas códigos de verificação/login (OTP). Não use para conteúdo comercial.</span>
            )}
          </div>
          <label className="block text-xs">
            <span className="mb-0.5 block text-foreground/70">Cabeçalho (opcional)</span>
            <Input value={form.cabecalho} onChange={(e) => setForm({ ...form, cabecalho: e.target.value })} placeholder="Ex.: Oferta da semana" />
          </label>
          <label className="block text-xs">
            <span className="mb-0.5 block text-foreground/70">Corpo (use {'{{1}}'}, {'{{2}}'}… para variáveis)</span>
            <textarea
              value={form.corpo}
              onChange={(e) => setForm({ ...form, corpo: e.target.value })}
              rows={4}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="Olá {{1}}! Hoje tem FRETE GRÁTIS na nossa loja 🛵 Peça já!"
            />
          </label>
          {nVars > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {exemplos.map((ex, i) => (
                <label key={i} className="text-xs">
                  <span className="mb-0.5 block text-foreground/70">Exemplo {'{{'}{i + 1}{'}}'}</span>
                  <Input value={ex} onChange={(e) => setExemplos((c) => c.map((x, j) => (j === i ? e.target.value : x)))} placeholder={i === 0 ? 'João' : 'exemplo'} />
                </label>
              ))}
            </div>
          )}
          <label className="block text-xs">
            <span className="mb-0.5 block text-foreground/70">Rodapé (opcional)</span>
            <Input value={form.rodape} onChange={(e) => setForm({ ...form, rodape: e.target.value })} placeholder="Responda SAIR para não receber" />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => salvar(false)}>Salvar rascunho</Button>
            <Button size="sm" disabled={busy} onClick={() => salvar(true)}>Salvar e enviar p/ aprovação</Button>
          </div>
        </Card>
      )}

      <Card className="p-0">
        <div className="border-b border-border px-4 py-3">
          <p className="font-display font-bold">Modelos</p>
        </div>
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
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-foreground/70">{t.categoria}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] ${st.c}`}>{st.t}</span>
                    <div className="ml-auto flex gap-2">
                      {pode && (t.status === 'rascunho' || t.status === 'rejeitado') && (
                        <button type="button" className="text-[11px] text-primary underline" disabled={busy} onClick={() => submeter(t.id)}>enviar p/ aprovação</button>
                      )}
                      {pode && <button type="button" className="text-[11px] underline" onClick={() => editar(t)}>editar</button>}
                      {pode && <button type="button" className="text-[11px] text-destructive underline" onClick={() => remover(t.id)}>remover</button>}
                    </div>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs text-foreground/70">{t.corpo}</p>
                  {t.status === 'rejeitado' && t.motivo_rejeicao && (
                    <p className="mt-1 text-[11px] text-destructive">Motivo: {t.motivo_rejeicao}</p>
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
