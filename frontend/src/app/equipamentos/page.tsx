'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TIPOS = [
  { value: 'terminal_ponto', label: 'Terminal de Ponto' },
  { value: 'kds', label: 'KDS (cozinha)' },
  { value: 'impressora', label: 'Impressora térmica' },
  { value: 'servidor_local', label: 'Servidor local (edge)' },
];
const TIPO_LABEL: Record<string, string> = {
  terminal_ponto: 'Terminal de Ponto',
  kds: 'KDS',
  impressora: 'Impressora',
  servidor_local: 'Servidor local',
};
const selectCls = 'flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm';

export default function EquipamentosPage() {
  const router = useRouter();
  const [lista, setLista] = useState<any[] | null>(null);
  const [unidades, setUnidades] = useState<any[]>([]);
  const [setores, setSetores] = useState<any[]>([]);
  const [erro, setErro] = useState('');

  const [tipo, setTipo] = useState('terminal_ponto');
  const [nome, setNome] = useState('');
  const [unidadeId, setUnidadeId] = useState('');
  const [setorId, setSetorId] = useState('');
  const [escopo, setEscopo] = useState('producao');
  const [papel, setPapel] = useState('producao');
  const [host, setHost] = useState('');
  const [porta, setPorta] = useState('9100');
  const [largura, setLargura] = useState('80');
  const [setoresAtendidos, setSetoresAtendidos] = useState<string[]>([]);
  const [padrao, setPadrao] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [fila, setFila] = useState<any[] | null>(null);
  const [testando, setTestando] = useState<string | null>(null);
  const [aviso, setAviso] = useState('');
  const [tokenNovo, setTokenNovo] = useState<{ nome: string; token: string } | null>(
    null,
  );
  const [copiado, setCopiado] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [eqs, unis, sets, f] = await Promise.all([
        api.equipamentos(),
        api.unidades(),
        api.setores().catch(() => []),
        api.impressaoFila().catch(() => []),
      ]);
      setLista(eqs);
      setUnidades(unis);
      setSetores(sets as any[]);
      setFila(f as any[]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    reload();
  }, [reload, router]);

  async function cadastrar(e: React.FormEvent) {
    e.preventDefault();
    setErro('');
    setSalvando(true);
    try {
      const novo: any = await api.criarEquipamento({
        tipo,
        nome,
        unidadeId: unidadeId || undefined,
        setorId: (tipo === 'kds' || tipo === 'impressora') && setorId ? setorId : undefined,
        escopo: tipo === 'kds' ? escopo : undefined,
        papel: tipo === 'impressora' ? papel : undefined,
        host: tipo === 'impressora' && host ? host : undefined,
        porta: tipo === 'impressora' && porta ? Number(porta) : undefined,
        largura: tipo === 'impressora' ? Number(largura) : undefined,
        setoresAtendidos:
          tipo === 'impressora' && setoresAtendidos.length ? setoresAtendidos : undefined,
        padrao: tipo === 'impressora' ? padrao : undefined,
      });
      setTokenNovo({ nome: novo.nome, token: novo.token });
      setCopiado(false);
      setNome('');
      setSetoresAtendidos([]);
      setPadrao(false);
      await reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao cadastrar');
    } finally {
      setSalvando(false);
    }
  }

  async function revogar(id: string, nome: string) {
    if (!confirm(`Revogar "${nome}"? O device perde o acesso imediatamente.`)) return;
    try {
      await api.revogarEquipamento(id);
      await reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao revogar');
    }
  }

  async function imprimirTeste(id: string) {
    setAviso('');
    setErro('');
    setTestando(id);
    try {
      await api.impressoraTeste(id);
      setAviso('Página de teste enviada. Se o servidor local estiver ativo, sai em segundos.');
      const f = await api.impressaoFila().catch(() => []);
      setFila(f as any[]);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao enviar teste');
    } finally {
      setTestando(null);
    }
  }

  async function reimprimir(id: string) {
    setErro('');
    try {
      await api.reimprimir(id);
      const f = await api.impressaoFila().catch(() => []);
      setFila(f as any[]);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Erro ao reimprimir');
    }
  }

  const toggleSetor = (id: string) =>
    setSetoresAtendidos((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );

  const nomeUnidade = (id: string | null) =>
    unidades.find((u) => u.id === id)?.nome ?? '—';

  return (
    <Shell eyebrow="Gestão" title="Equipamentos & Apps">
      <div className="max-w-3xl space-y-4">
        <p className="text-sm text-muted-foreground">
          Registre os apps satélites (KDS e Terminal de Ponto) que se conectam ao
          Regem. Cada device recebe um token único usado no pareamento.
        </p>

        {/* Token recém-criado — exibido UMA vez */}
        {tokenNovo && (
          <Card className="border-primary/40 bg-primary/5 p-4">
            <h2 className="font-semibold">Token de “{tokenNovo.nome}”</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Guarde agora — por segurança, ele <strong>não será exibido de novo</strong>.
              Use no pareamento do device.
            </p>
            <div className="mt-3 flex items-center gap-2">
              <code className="flex-1 overflow-x-auto rounded-md bg-secondary px-3 py-2 font-mono text-sm">
                {tokenNovo.token}
              </code>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  await navigator.clipboard.writeText(tokenNovo.token);
                  setCopiado(true);
                }}
              >
                {copiado ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
            <button
              type="button"
              onClick={() => setTokenNovo(null)}
              className="mt-3 text-sm text-muted-foreground hover:text-foreground"
            >
              Já guardei, fechar
            </button>
          </Card>
        )}

        {aviso && (
          <Card className="border-emerald-500/40 bg-emerald-500/5 p-3">
            <p className="text-sm text-emerald-700 dark:text-emerald-400">{aviso}</p>
          </Card>
        )}

        {/* Cadastro */}
        <Card className="p-4">
          <h2 className="mb-3 font-display text-lg font-semibold">Novo equipamento</h2>
          <form onSubmit={cadastrar} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <select
                id="tipo"
                value={tipo}
                onChange={(e) => setTipo(e.target.value)}
                className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                {TIPOS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nome">Nome</Label>
              <Input
                id="nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Ex.: Terminal do balcão"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="unidade">Unidade</Label>
              <select
                id="unidade"
                value={unidadeId}
                onChange={(e) => setUnidadeId(e.target.value)}
                className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-sm"
              >
                <option value="">— sem unidade —</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.nome}
                  </option>
                ))}
              </select>
            </div>

            {/* KDS/impressora: setor de produção */}
            {(tipo === 'kds' || tipo === 'impressora') && (
              <div className="space-y-1.5">
                <Label htmlFor="setor">Setor de produção</Label>
                <select id="setor" value={setorId} onChange={(e) => setSetorId(e.target.value)} className={selectCls}>
                  <option value="">— sem setor —</option>
                  {setores.map((s) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              </div>
            )}

            {/* KDS: escopo (produção / entrega / só avisos) */}
            {tipo === 'kds' && (
              <div className="space-y-1.5">
                <Label htmlFor="escopo">Escopo do KDS</Label>
                <select id="escopo" value={escopo} onChange={(e) => setEscopo(e.target.value)} className={selectCls}>
                  <option value="producao">Produção (pedidos)</option>
                  <option value="entrega">Entrega (retirada por senha)</option>
                  <option value="avisos">Só avisos (tarefas/picos)</option>
                </select>
              </div>
            )}

            {/* Impressora: papel + host + porta */}
            {tipo === 'impressora' && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="papel">Papel da impressora</Label>
                  <select id="papel" value={papel} onChange={(e) => setPapel(e.target.value)} className={selectCls}>
                    <option value="producao">Produção (cozinha/bar — sem valores)</option>
                    <option value="cupom">Cupom (via do cliente — com valores)</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="host">IP da impressora</Label>
                    <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="192.168.1.50" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="porta">Porta</Label>
                    <Input id="porta" type="number" value={porta} onChange={(e) => setPorta(e.target.value)} placeholder="9100" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="largura">Papel</Label>
                    <select id="largura" value={largura} onChange={(e) => setLargura(e.target.value)} className={selectCls} title="Largura do papel">
                      <option value="80">80 mm</option>
                      <option value="58">58 mm</option>
                    </select>
                  </div>
                </div>
                {/* Produção: setores que a impressora atende (cozinha, bar…) */}
                {papel === 'producao' && (
                  <div className="space-y-1.5">
                    <Label>Setores atendidos</Label>
                    <p className="text-xs text-muted-foreground">
                      Marque os setores cujos itens saem nesta impressora. Vazio = usa o setor único acima.
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {setores.length === 0 && (
                        <span className="text-xs text-muted-foreground">Nenhum setor cadastrado.</span>
                      )}
                      {setores.map((s) => {
                        const on = setoresAtendidos.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleSetor(s.id)}
                            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                              on
                                ? 'border-primary bg-primary/10 text-primary'
                                : 'border-border text-muted-foreground hover:border-primary/50'
                            }`}
                          >
                            {s.nome}
                          </button>
                        );
                      })}
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={padrao}
                        onChange={(e) => setPadrao(e.target.checked)}
                        className="h-4 w-4 rounded border-input"
                      />
                      Impressora padrão da unidade (recebe itens sem setor)
                    </label>
                  </div>
                )}
              </>
            )}
            {erro && (
              <p role="alert" className="text-sm text-destructive">
                {erro}
              </p>
            )}
            <Button type="submit" disabled={salvando}>
              {salvando ? 'Cadastrando…' : 'Cadastrar equipamento'}
            </Button>
          </form>
        </Card>

        {/* Lista */}
        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Equipamentos {lista ? `(${lista.length})` : ''}
          </p>
          {!lista && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {lista && lista.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum equipamento cadastrado ainda.
            </p>
          )}
          <div className="space-y-2">
            {lista?.map((eq) => (
              <div
                key={eq.id}
                className="flex items-center gap-3 rounded-lg border border-border p-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{eq.nome}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                      {TIPO_LABEL[eq.tipo] ?? eq.tipo}
                    </span>
                    {eq.padrao && eq.tipo === 'terminal_ponto' && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">
                        REP-Software
                      </span>
                    )}
                    {!eq.ativo && (
                      <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">
                        Revogado
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {nomeUnidade(eq.unidadeId)}
                    {eq.tipo === 'impressora' && eq.host ? ` · ${eq.host}:${eq.porta ?? 9100}` : ''}
                    {eq.tipo === 'impressora' ? ` · ${eq.largura ?? 80}mm` : ''}
                    {eq.tipo === 'impressora' && (eq.setoresAtendidos?.length ?? 0) > 0
                      ? ` · ${eq.setoresAtendidos.length} setor(es)`
                      : ''}
                    {eq.tipo === 'impressora' && eq.padrao ? ' · padrão' : ''}
                    {eq.tipo === 'kds' && eq.escopo === 'avisos' ? ' · só avisos' : ''}
                    {eq.ultimoPing
                      ? ` · último acesso ${new Date(eq.ultimoPing).toLocaleString('pt-BR')}`
                      : ' · nunca conectou'}
                  </div>
                </div>
                {eq.tipo === 'impressora' && eq.ativo && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={testando === eq.id}
                    onClick={() => imprimirTeste(eq.id)}
                  >
                    {testando === eq.id ? 'Enviando…' : 'Imprimir teste'}
                  </Button>
                )}
                {eq.ativo && !eq.padrao && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => revogar(eq.id, eq.nome)}
                    className="text-destructive"
                  >
                    Revogar
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>

        {/* Fila de impressão (status + reimpressão de falhas) */}
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-muted-foreground">
              Fila de impressão {fila ? `(${fila.length})` : ''}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => setFila((await api.impressaoFila().catch(() => [])) as any[])}
            >
              Atualizar
            </Button>
          </div>
          {fila && fila.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma impressão ainda. Confirme um pedido ou use “Imprimir teste”.
            </p>
          )}
          <div className="space-y-1.5">
            {fila?.map((j) => (
              <div
                key={j.id}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm"
              >
                <span
                  className={`h-2 w-2 flex-none rounded-full ${
                    j.status === 'impresso'
                      ? 'bg-emerald-500'
                      : j.status === 'erro'
                        ? 'bg-red-500'
                        : 'bg-amber-500 animate-pulse'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{j.impressora ?? '—'}</span>
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                      {j.via}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {j.status === 'impresso'
                        ? 'impresso'
                        : j.status === 'erro'
                          ? `falhou (${j.tentativas}x)`
                          : 'na fila'}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(j.criadoEm).toLocaleString('pt-BR')}
                    {j.status === 'erro' && j.erro ? ` · ${j.erro}` : ''}
                  </div>
                </div>
                {j.status === 'erro' && (
                  <Button type="button" variant="outline" size="sm" onClick={() => reimprimir(j.id)}>
                    Reimprimir
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </Shell>
  );
}
