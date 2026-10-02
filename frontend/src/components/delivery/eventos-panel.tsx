'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

// EVENTOS SAZONAIS DO CARDÁPIO (Delivery → Configurações → Eventos).
// Nenhum evento liga sozinho: o presidente liga só os que quer usar; cada um vale no período dele
// e depois o cardápio volta ao normal. Quem não é presidente vê a agenda, sem editar (o servidor
// recusa a gravação de qualquer outro perfil — aqui os controles só ficam desabilitados).

interface LinhaAgenda {
  chave: string;
  nome: string;
  inicio: string;
  fim: string;
  dia: string;
  ativo: boolean;
  noPeriodo: boolean;
  noAr: boolean;
  periodoPadrao: { antes: number; depois: number };
  temJogo: boolean;
}
interface Resposta {
  temCardapio: boolean;
  podeEditar: boolean;
  config: { animacoes: boolean; coresDoEvento: boolean; jogos: { inicio: string; chamada?: string }[]; porEvento: Record<string, any> };
  hoje: string;
  noAr: string | null;
  agenda: LinhaAgenda[];
  diaDeJogo: { ativo: boolean; ligaAntesMin: number; desligaDepoisMin: number };
  limites: { diasAntes: number; diasDepois: number; titulo: number; texto: number; colecao: number; jogos: number; chamada: number };
}

const data = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86_400_000);
const horas = (min: number) => (min % 60 === 0 ? `${min / 60} h` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}`);

function situacao(l: LinhaAgenda, hoje: string): { texto: string; tom: 'ok' | 'neutro' | 'aviso' } {
  if (l.noAr) return { texto: 'No ar agora', tom: 'ok' };
  if (!l.ativo) return { texto: 'Desligado', tom: 'neutro' };
  if (l.noPeriodo) return { texto: 'Ligado · outro evento tem prioridade hoje', tom: 'aviso' };
  const n = diasEntre(hoje, l.inicio);
  return { texto: n === 1 ? 'Ligado · começa amanhã' : `Ligado · começa em ${n} dias`, tom: 'aviso' };
}

function Chave({ ligado, onChange, disabled, rotulo }: { ligado: boolean; onChange: (v: boolean) => void; disabled?: boolean; rotulo: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={disabled}
      onClick={() => onChange(!ligado)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${ligado ? 'bg-primary' : 'bg-muted-foreground/30'}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${ligado ? 'left-[22px]' : 'left-0.5'}`} />
    </button>
  );
}

export function EventosPanel({ linkCardapio }: { linkCardapio: string }) {
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [aberto, setAberto] = useState<string | null>(null);
  const [form, setForm] = useState<any>({});
  const [jogos, setJogos] = useState<{ inicio: string; chamada: string }[]>([]);
  const [jogosMexidos, setJogosMexidos] = useState(false);
  const [produtos, setProdutos] = useState<any[]>([]);
  const [cupons, setCupons] = useState<any[]>([]);
  const [filtro, setFiltro] = useState('');

  const receber = (r: Resposta) => {
    setDados(r);
    setJogos(r.config.jogos.map((j) => ({ inicio: j.inicio.slice(0, 16), chamada: j.chamada ?? '' })));
    setJogosMexidos(false);
  };

  useEffect(() => {
    api.cardapioEventos().then((r: any) => receber(r as Resposta)).catch((e: any) => setErro(e?.message ?? 'Não foi possível carregar os eventos.'));
    api.produtos().then((p: any) => setProdutos(Array.isArray(p) ? p : [])).catch(() => {});
    api.cardapioCupons().then((c: any) => setCupons(Array.isArray(c) ? c : [])).catch(() => {});
  }, []);

  const pode = !!dados?.podeEditar && !!dados?.temCardapio;

  async function gravar(corpo: Record<string, unknown>, aviso: string): Promise<boolean> {
    setSalvando(true);
    try {
      receber((await api.salvarCardapioEventos(corpo)) as Resposta);
      toast.success(aviso);
      return true;
    } catch (e: any) {
      toast.error(e?.message ?? 'Não foi possível salvar.');
      return false;
    } finally {
      setSalvando(false);
    }
  }

  function abrir(l: LinhaAgenda) {
    if (aberto === l.chave) return setAberto(null);
    const e = dados?.config.porEvento[l.chave] ?? {};
    setForm({
      diasAntes: e.diasAntes ?? '',
      diasDepois: e.diasDepois ?? '',
      titulo: e.titulo ?? '',
      texto: e.texto ?? '',
      colecao: e.colecao ?? [],
      cupomJogo: e.cupomJogo ?? '',
    });
    setFiltro('');
    setAberto(l.chave);
  }

  async function salvarEvento(l: LinhaAgenda) {
    const num = (v: any) => (v === '' || v == null ? null : Number(v));
    const corpo: any = { diasAntes: num(form.diasAntes), diasDepois: num(form.diasDepois), titulo: form.titulo.trim(), texto: form.texto.trim(), colecao: form.colecao };
    if (l.temJogo) corpo.cupomJogo = form.cupomJogo || null;
    if (await gravar({ porEvento: { [l.chave]: corpo } }, `${l.nome}: alterações salvas.`)) setAberto(null);
  }

  const produtosFiltrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return produtos.filter((p) => !q || String(p.nome ?? '').toLowerCase().includes(q)).slice(0, 80);
  }, [produtos, filtro]);
  const cuponsAtivos = useMemo(() => cupons.filter((c) => c.ativo !== false), [cupons]);

  if (erro) return <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{erro}</p>;
  if (!dados) return <p className="text-sm text-muted-foreground">Carregando os eventos…</p>;

  const lim = dados.limites;
  const noAr = dados.noAr === 'jogo' ? 'Dia de jogo' : dados.agenda.find((l) => l.chave === dados.noAr)?.nome;
  const tomCls = { ok: 'bg-emerald-100 text-emerald-800', neutro: 'bg-muted text-muted-foreground', aviso: 'bg-amber-100 text-amber-800' } as const;

  return (
    <div className="space-y-5">
      <p className="text-xs text-muted-foreground">
        Em datas especiais o cardápio online ganha o clima do evento: enfeite no topo, faixa com contagem, uma coleção de produtos e animações. <strong>Nenhum evento liga sozinho</strong> — ligue só os que
        quiser usar. Cada um vale no período dele e depois o cardápio volta ao normal. O checkout continua limpo: o evento não muda preço, pedido nem pagamento.
      </p>

      {!dados.temCardapio && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">Ative o cardápio digital na aba Cardápio para poder usar os eventos.</p>
      )}
      {dados.temCardapio && !dados.podeEditar && (
        <p className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">Só o presidente liga, desliga e personaliza os eventos. Você pode ver a agenda e abrir as prévias.</p>
      )}

      <div className="rounded-lg border border-border p-3">
        <p className="text-xs text-muted-foreground">No ar agora</p>
        <p className="font-display text-base font-bold">{noAr ?? 'Nenhum evento — o cardápio está normal'}</p>
      </div>

      {/* chaves gerais */}
      <div className="space-y-3 rounded-lg border border-border p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Animações</p>
            <p className="text-xs text-muted-foreground">Neve, confete e enfeites em movimento. Desligado, o evento aparece parado. O aparelho do cliente com &quot;reduzir movimento&quot; já fica parado sozinho.</p>
          </div>
          <Chave rotulo="Animações" ligado={dados.config.animacoes} disabled={!pode || salvando} onChange={(v) => gravar({ animacoes: v }, v ? 'Animações ligadas.' : 'Animações desligadas.')} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">Cores do evento</p>
            <p className="text-xs text-muted-foreground">Os botões do cardápio ficam na cor do evento enquanto ele durar. Desligado, continuam na cor da loja.</p>
          </div>
          <Chave rotulo="Cores do evento" ligado={dados.config.coresDoEvento} disabled={!pode || salvando} onChange={(v) => gravar({ coresDoEvento: v }, v ? 'Cores do evento ligadas.' : 'O cardápio mantém a cor da loja nos eventos.')} />
        </div>
      </div>

      {/* agenda */}
      <div>
        <h3 className="mb-2 font-display text-sm font-bold">Agenda dos próximos 12 meses</h3>
        <ul className="space-y-2">
          {dados.agenda.map((l) => {
            const s = situacao(l, dados.hoje);
            const ed = aberto === l.chave;
            return (
              <li key={l.chave} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
                  <Chave rotulo={`Ligar ${l.nome}`} ligado={l.ativo} disabled={!pode || salvando} onChange={(v) => gravar({ porEvento: { [l.chave]: { ativo: v } } }, v ? `${l.nome} ligado: entra no ar de ${data(l.inicio)} a ${data(l.fim)}.` : `${l.nome} desligado.`)} />
                  <div className="min-w-[10rem] flex-1">
                    <p className="text-sm font-semibold">{l.nome}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {data(l.inicio)} a {data(l.fim)}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tomCls[s.tom]}`}>{s.texto}</span>
                  <div className="flex flex-wrap gap-2">
                    {linkCardapio && (
                      <a href={`${linkCardapio}?evento=${l.chave}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-semibold hover:bg-muted">
                        Ver prévia
                      </a>
                    )}
                    <Button type="button" size="sm" variant="outline" className="h-8" aria-expanded={ed} onClick={() => abrir(l)}>
                      {ed ? 'Fechar' : pode ? 'Personalizar' : 'Ver detalhes'}
                    </Button>
                  </div>
                </div>
                {ed && (
                  <div className="space-y-3 border-t border-border p-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Começa quantos dias antes do dia do evento</Label>
                        <Input type="number" min={0} max={lim.diasAntes} disabled={!pode} value={form.diasAntes} placeholder={`padrão: ${l.periodoPadrao.antes}`} onChange={(e) => setForm({ ...form, diasAntes: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Termina quantos dias depois</Label>
                        <Input type="number" min={0} max={lim.diasDepois} disabled={!pode} value={form.diasDepois} placeholder={`padrão: ${l.periodoPadrao.depois}`} onChange={(e) => setForm({ ...form, diasDepois: e.target.value })} />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      O dia do evento é {data(l.dia)}. Em branco, vale o período padrão. As datas da agenda se ajustam sozinhas a cada ano (inclusive Páscoa, Carnaval, Dia das Mães, Dia dos Pais e Black Friday).
                    </p>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Título da faixa (até {lim.titulo} caracteres)</Label>
                        <Input maxLength={lim.titulo} disabled={!pode} value={form.titulo} placeholder="Em branco = título padrão do evento" onChange={(e) => setForm({ ...form, titulo: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Texto da faixa (até {lim.texto} caracteres)</Label>
                        <Input maxLength={lim.texto} disabled={!pode} value={form.texto} placeholder="Em branco = texto padrão do evento" onChange={(e) => setForm({ ...form, texto: e.target.value })} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">
                        Produtos da coleção do evento ({form.colecao.length} de {lim.colecao})
                      </Label>
                      <Input placeholder="Filtrar produtos…" value={filtro} onChange={(e) => setFiltro(e.target.value)} disabled={!pode} />
                      <div className="max-h-44 space-y-1 overflow-y-auto rounded-md border border-input p-2">
                        {produtosFiltrados.map((p) => {
                          const marcado = form.colecao.includes(p.id);
                          return (
                            <label key={p.id} className="flex cursor-pointer items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                className="h-4 w-4 accent-primary"
                                checked={marcado}
                                disabled={!pode || (!marcado && form.colecao.length >= lim.colecao)}
                                onChange={() => setForm({ ...form, colecao: marcado ? form.colecao.filter((x: string) => x !== p.id) : [...form.colecao, p.id] })}
                              />
                              <span className="truncate">{p.nome}</span>
                            </label>
                          );
                        })}
                        {produtosFiltrados.length === 0 && <p className="text-xs text-muted-foreground">Nenhum produto encontrado.</p>}
                      </div>
                      <p className="text-xs text-muted-foreground">Sem produto escolhido, a coleção mostra os destaques da loja{l.chave === 'blackfriday' ? ' (na Black Friday, os produtos com preço promocional)' : ''}.</p>
                    </div>
                    {l.temJogo && (
                      <div className="space-y-1">
                        <Label className="text-xs">Cupom do mini-jogo ({l.chave === 'pascoa' ? 'caça aos ovos' : 'gostosuras ou travessuras'})</Label>
                        <select
                          aria-label="Cupom do mini-jogo"
                          disabled={!pode}
                          value={form.cupomJogo}
                          onChange={(e) => setForm({ ...form, cupomJogo: e.target.value })}
                          className="flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm"
                        >
                          <option value="">Sem jogo</option>
                          {cuponsAtivos.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.codigo}
                              {c.nome ? ` · ${c.nome}` : ''}
                            </option>
                          ))}
                        </select>
                        <p className="text-xs text-muted-foreground">
                          O jogo só aparece com um cupom escolhido. Todo cliente que joga ganha o mesmo cupom (não há sorteio); os limites de uso são os do próprio cupom, na aba Cupons.
                        </p>
                      </div>
                    )}
                    {pode && (
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" disabled={salvando} onClick={() => salvarEvento(l)}>
                          {salvando ? 'Salvando…' : 'Salvar evento'}
                        </Button>
                        <Button type="button" size="sm" variant="outline" disabled={salvando} onClick={() => setForm({ diasAntes: '', diasDepois: '', titulo: '', texto: '', colecao: [], cupomJogo: '' })}>
                          Voltar ao padrão
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Dia de jogo */}
      <div className="rounded-lg border border-border">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
          <Chave rotulo="Ligar Dia de jogo" ligado={dados.diaDeJogo.ativo} disabled={!pode || salvando} onChange={(v) => gravar({ porEvento: { jogo: { ativo: v } } }, v ? 'Dia de jogo ligado: o tema entra no horário de cada jogo cadastrado.' : 'Dia de jogo desligado.')} />
          <div className="min-w-[10rem] flex-1">
            <p className="text-sm font-semibold">Dia de jogo</p>
            <p className="text-xs text-muted-foreground">
              Liga {horas(dados.diaDeJogo.ligaAntesMin)} antes de cada jogo cadastrado e desliga {horas(dados.diaDeJogo.desligaDepoisMin)} depois. Nesse período vence qualquer outro evento.
            </p>
          </div>
          {dados.noAr === 'jogo' && <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${tomCls.ok}`}>No ar agora</span>}
          {linkCardapio && (
            <a href={`${linkCardapio}?evento=jogo`} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center rounded-md border border-input px-3 text-xs font-semibold hover:bg-muted">
              Ver prévia
            </a>
          )}
        </div>
        <div className="space-y-2 border-t border-border p-3">
          {jogos.length === 0 && <p className="text-sm text-muted-foreground">Nenhum jogo cadastrado. Adicione a data e a hora dos jogos em que o cardápio deve entrar no clima.</p>}
          {jogos.map((j, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[14rem_1fr_auto]">
              <Input
                type="datetime-local"
                aria-label={`Data e hora do jogo ${i + 1}`}
                disabled={!pode}
                value={j.inicio}
                onChange={(e) => {
                  setJogos(jogos.map((x, k) => (k === i ? { ...x, inicio: e.target.value } : x)));
                  setJogosMexidos(true);
                }}
              />
              <Input
                aria-label={`Chamada do jogo ${i + 1}`}
                maxLength={lim.chamada}
                disabled={!pode}
                value={j.chamada}
                placeholder="Chamada (opcional). Ex.: Final do campeonato"
                onChange={(e) => {
                  setJogos(jogos.map((x, k) => (k === i ? { ...x, chamada: e.target.value } : x)));
                  setJogosMexidos(true);
                }}
              />
              {pode && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-10"
                  onClick={() => {
                    setJogos(jogos.filter((_, k) => k !== i));
                    setJogosMexidos(true);
                  }}
                >
                  Remover
                </Button>
              )}
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            Horário de Brasília. <strong>Não use nome de time nem de campeonato</strong> na chamada: a arte do Dia de jogo é neutra (gramado e bola) e o sistema recusa esses nomes.
          </p>
          {pode && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={jogos.length >= lim.jogos}
                onClick={() => {
                  setJogos([...jogos, { inicio: '', chamada: '' }]);
                  setJogosMexidos(true);
                }}
              >
                ＋ Adicionar jogo
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={salvando || !jogosMexidos}
                onClick={() => {
                  if (jogos.some((j) => !j.inicio)) return toast.error('Informe a data e a hora de cada jogo (ou remova a linha vazia).');
                  void gravar({ jogos: jogos.map((j) => ({ inicio: j.inicio, chamada: j.chamada.trim() || undefined })) }, 'Jogos salvos.');
                }}
              >
                {salvando ? 'Salvando…' : 'Salvar jogos'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
