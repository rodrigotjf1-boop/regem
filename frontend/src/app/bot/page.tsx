'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ESCALA_LABEL: Record<string, string> = {
  nunca: 'Nunca',
  sempre: 'Sempre',
  condicional: 'Condicional',
};

type Msg = { de: 'user' | 'bot'; texto: string; escalado?: boolean; cond?: string | null };

export default function BotPage() {
  const router = useRouter();
  const [regras, setRegras] = useState<any[] | null>(null);
  const [metricas, setMetricas] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([
    { de: 'bot', texto: 'Olá! 👋 Sou o assistente da Regem. Como posso ajudar?' },
  ]);
  const [pergunta, setPergunta] = useState('');
  const [enviando, setEnviando] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  // Form de nova/editar regra
  const [editId, setEditId] = useState<string | null>(null);
  const [tipo, setTipo] = useState('');
  const [gatilhos, setGatilhos] = useState('');
  const [resposta, setResposta] = useState('');
  const [escala, setEscala] = useState('nunca');
  const [escalaCondicao, setEscalaCondicao] = useState('');
  const formRef = useRef<HTMLDivElement>(null);

  const presidente = getCategoria() === 'presidente';

  const carregar = useCallback(async () => {
    setErro('');
    try {
      const [r, m] = await Promise.all([api.botRegras(), api.botMetricas()]);
      setRegras(r);
      setMetricas(m);
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

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [msgs]);

  async function enviar() {
    const p = pergunta.trim();
    if (!p || enviando) return;
    setMsgs((m) => [...m, { de: 'user', texto: p }]);
    setPergunta('');
    setEnviando(true);
    try {
      const r: any = await api.botPerguntar(p);
      setMsgs((m) => [
        ...m,
        { de: 'bot', texto: r.resposta, escalado: r.escalado, cond: r.escalaCondicao },
      ]);
      carregar(); // atualiza métrica
    } catch (e) {
      setMsgs((m) => [
        ...m,
        { de: 'bot', texto: e instanceof Error ? e.message : 'Erro ao responder' },
      ]);
    } finally {
      setEnviando(false);
    }
  }

  function limparForm() {
    setEditId(null);
    setTipo('');
    setGatilhos('');
    setResposta('');
    setEscala('nunca');
    setEscalaCondicao('');
  }

  async function salvar() {
    if (tipo.trim().length < 2 || !gatilhos.trim() || !resposta.trim()) return;
    const body = {
      tipo,
      gatilhos,
      resposta,
      escala,
      escalaCondicao: escala === 'condicional' ? escalaCondicao || undefined : undefined,
    };
    try {
      if (editId) await api.atualizarBotRegra(editId, body);
      else await api.criarBotRegra(body);
      limparForm();
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar regra');
    }
  }

  function editar(r: any) {
    setEditId(r.id);
    setTipo(r.tipo);
    setGatilhos(r.gatilhos);
    setResposta(r.resposta);
    setEscala(r.escala ?? 'nunca');
    setEscalaCondicao(r.escalaCondicao ?? '');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // "Virar regra" a partir de uma pergunta sem resposta: prefila o form.
  function virarRegra(pergunta: string) {
    setEditId(null);
    setTipo('');
    setGatilhos(pergunta);
    setResposta('');
    setEscala('nunca');
    setEscalaCondicao('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function toggle(r: any) {
    try {
      await api.atualizarBotRegra(r.id, { ativa: !r.ativa });
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao atualizar');
    }
  }

  async function remover(id: string) {
    try {
      await api.removerBotRegra(id);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao remover');
    }
  }

  return (
    <Shell eyebrow="Suporte" title="Bot de Suporte">
      <div className="space-y-5">
        {/* Alerta / métrica */}
        <div className="flex flex-wrap items-center gap-3">
          <span
            className="rounded-lg px-3 py-1.5 text-xs font-medium"
            style={{ background: 'hsl(var(--info)/.12)', color: 'hsl(var(--info))' }}
          >
            🔒 Regras editáveis só pelo Proprietário / C&O
          </span>
          {metricas && (
            <span className="rounded-lg bg-muted px-3 py-1.5 text-xs font-medium">
              🤖 {metricas.hoje} atendimento(s) hoje · {metricas.escaladosHoje} escalado(s)
            </span>
          )}
          {metricas?.semRespostaMes > 0 && (
            <span
              className="rounded-lg px-3 py-1.5 text-xs font-medium"
              style={{ background: 'hsl(var(--warn)/.12)', color: 'hsl(var(--warn))' }}
            >
              ❓ {metricas.semRespostaMes} sem resposta (30 dias)
            </span>
          )}
        </div>

        {erro && <p className="text-destructive">{erro}</p>}

        <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
          {/* Regras */}
          <Card className="p-0">
            <div className="border-b border-border px-5 py-3.5">
              <p className="font-display text-sm font-bold">Respostas predefinidas por tipo</p>
              <p className="text-xs text-muted-foreground">
                O bot identifica palavras-chave e responde
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">Regras do bot de suporte</caption>
                <thead>
                  <tr className="border-b border-border text-left">
                    {['Tipo', 'Gatilhos', 'Escala p/ gerente', 'Ativa', ''].map((h) => (
                      <th
                        key={h}
                        className="whitespace-nowrap px-4 py-2.5 font-display text-[10px] font-bold uppercase tracking-[.1em] text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {regras === null && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Carregando…</td></tr>
                  )}
                  {regras?.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">Nenhuma regra ainda.</td></tr>
                  )}
                  {regras?.map((r) => (
                    <tr key={r.id} className="border-b border-border last:border-0 align-top">
                      <td className="px-4 py-3 font-medium">{r.tipo}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {r.gatilhos.split(',').map((g: string, i: number) => (
                            <span key={i} className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              {g.trim()}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs">
                        {ESCALA_LABEL[r.escala] ?? r.escala}
                        {r.escala === 'condicional' && r.escalaCondicao ? ` · ${r.escalaCondicao}` : ''}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={r.ativa ? 'true' : 'false'}
                          aria-label={`Ativar ${r.tipo}`}
                          disabled={!presidente}
                          onClick={() => toggle(r)}
                          className="rounded-md px-2 py-0.5 text-[11px] font-bold disabled:opacity-60"
                          style={{
                            background: r.ativa ? 'hsl(var(--ok)/.15)' : 'hsl(var(--muted))',
                            color: r.ativa ? 'hsl(var(--ok))' : 'hsl(var(--muted-foreground))',
                          }}
                        >
                          {r.ativa ? 'Ativa' : 'Inativa'}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        {presidente && (
                          <span className="inline-flex gap-3">
                            <button
                              type="button"
                              onClick={() => editar(r)}
                              className="text-xs text-primary hover:underline"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => remover(r.id)}
                              className="text-xs text-destructive hover:underline"
                            >
                              Remover
                            </button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {presidente && (
              <div ref={formRef} className="space-y-3 border-t border-border p-4">
                <div className="flex items-center justify-between">
                  <p className="font-display text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {editId ? 'Editar regra' : 'Nova regra'}
                  </p>
                  {editId && (
                    <button type="button" onClick={limparForm} className="text-xs text-muted-foreground hover:underline">
                      Cancelar edição
                    </button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="tipo" className="text-xs">Tipo</Label>
                    <Input id="tipo" value={tipo} onChange={(e) => setTipo(e.target.value)} placeholder="Ex.: Pedido atrasado" />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="gat" className="text-xs">Gatilhos (vírgula)</Label>
                    <Input id="gat" value={gatilhos} onChange={(e) => setGatilhos(e.target.value)} placeholder="atraso, demorando" />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="resp" className="text-xs">Resposta</Label>
                  <Input id="resp" value={resposta} onChange={(e) => setResposta(e.target.value)} placeholder="Já verifiquei com a cozinha…" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="esc" className="text-xs">Escalar p/ gerente</Label>
                    <select
                      id="esc"
                      aria-label="Escalar para gerente"
                      title="Escalar para gerente"
                      value={escala}
                      onChange={(e) => setEscala(e.target.value)}
                      className="h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
                    >
                      <option value="nunca">Nunca</option>
                      <option value="sempre">Sempre</option>
                      <option value="condicional">Condicional</option>
                    </select>
                  </div>
                  {escala === 'condicional' && (
                    <div className="space-y-1">
                      <Label htmlFor="cond" className="text-xs">Condição</Label>
                      <Input id="cond" value={escalaCondicao} onChange={(e) => setEscalaCondicao(e.target.value)} placeholder="Se > 15 min" />
                    </div>
                  )}
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={salvar}
                    disabled={tipo.trim().length < 2 || !gatilhos.trim() || !resposta.trim()}
                  >
                    {editId ? 'Salvar alterações' : '+ Nova regra'}
                  </Button>
                </div>
              </div>
            )}
          </Card>

          {/* Testar o bot */}
          <Card className="flex flex-col p-4">
            <p className="font-display text-sm font-bold">Testar o bot</p>
            <div
              ref={chatRef}
              className="mt-3 flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg bg-muted p-3"
              style={{ minHeight: 200, maxHeight: 320 }}
            >
              {msgs.map((m, i) => (
                <div
                  key={i}
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-[12.5px] ${
                    m.de === 'user'
                      ? 'self-end bg-primary text-primary-foreground'
                      : 'self-start bg-card'
                  }`}
                >
                  {m.texto}
                  {m.de === 'bot' && m.escalado && (
                    <span className="mt-1 block text-[10px] font-bold" style={{ color: 'hsl(var(--warn))' }}>
                      ⚠️ Escalado para um responsável
                    </span>
                  )}
                  {m.de === 'bot' && m.cond && (
                    <span className="mt-1 block text-[10px] text-muted-foreground">
                      Escala se: {m.cond}
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2.5 flex gap-2">
              <Input
                value={pergunta}
                onChange={(e) => setPergunta(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && enviar()}
                placeholder='Tente: "meu pedido está atrasado"'
              />
              <Button onClick={enviar} disabled={enviando || !pergunta.trim()}>
                Enviar
              </Button>
            </div>
            {(regras ?? []).some((r) => r.ativa) && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Gatilhos:{' '}
                {(regras ?? [])
                  .filter((r) => r.ativa)
                  .map((r) => r.gatilhos.split(',')[0].trim())
                  .slice(0, 6)
                  .join(' · ')}
              </p>
            )}
          </Card>
        </div>

        {/* Perguntas sem resposta — insumo para novas regras (só presidente) */}
        {presidente && (metricas?.naoRespondidas?.length ?? 0) > 0 && (
          <Card className="p-0">
            <div className="border-b border-border px-5 py-3.5">
              <p className="font-display text-sm font-bold">Perguntas sem resposta</p>
              <p className="text-xs text-muted-foreground">
                O bot não encontrou regra para estas perguntas (últimos 30 dias) — vire-as em regras
              </p>
            </div>
            <div className="divide-y divide-border">
              {metricas.naoRespondidas.map((q: any, i: number) => (
                <div key={i} className="flex items-center gap-3 px-5 py-2.5">
                  <span className="min-w-0 flex-1 truncate text-sm">{q.pergunta}</span>
                  {q.vezes > 1 && (
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                      {q.vezes}×
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => virarRegra(q.pergunta)}
                    className="flex-none text-xs font-medium text-primary hover:underline"
                  >
                    ＋ virar regra
                  </button>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </Shell>
  );
}
