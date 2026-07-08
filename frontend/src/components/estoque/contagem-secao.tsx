'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';

/* eslint-disable @typescript-eslint/no-explicit-any */
const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const RECOR: Record<string, string> = {
  diaria: 'Diária',
  semanal: 'Semanal',
  mensal: 'Mensal',
  avulsa: 'Avulsa',
};

// Seção Contagem do hub de Estoque: listas personalizadas (recorrência,
// delegação, alerta por horário) + executar a contagem (contado × sistema).
export function ContagemSecao({ itens }: { itens: any[] }) {
  const [listas, setListas] = useState<any[]>([]);
  const [colabs, setColabs] = useState<any[]>([]);
  const [novo, setNovo] = useState(false);
  const [exec, setExec] = useState<any>(null); // execução aberta (modal)
  const [contado, setContado] = useState<Record<string, string>>({});
  const [ajuste, setAjuste] = useState(true);
  const [salvando, setSalvando] = useState(false);

  // form nova lista
  const [nome, setNome] = useState('');
  const [sel, setSel] = useState<string[]>([]);
  const [recorrencia, setRecorrencia] = useState('semanal');
  const [diaSemana, setDiaSemana] = useState('1');
  const [diaMes, setDiaMes] = useState('1');
  const [hora, setHora] = useState('08:00');
  const [delegadoId, setDelegadoId] = useState('');
  const [enviarKds, setEnviarKds] = useState(true);
  const [enviarDashboard, setEnviarDashboard] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [ls, cs] = await Promise.all([api.contagemListas(), api.colaboradores()]);
      setListas(ls as any[]);
      setColabs(cs as any[]);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao carregar contagens');
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  function toggleItem(id: string) {
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function criar() {
    if (!nome.trim() || sel.length === 0) {
      toast.error('Dê um nome e selecione ao menos 1 produto.');
      return;
    }
    try {
      await api.criarContagemLista({
        nome: nome.trim(),
        itemIds: sel,
        recorrencia,
        diaSemana: recorrencia === 'semanal' ? Number(diaSemana) : undefined,
        diaMes: recorrencia === 'mensal' ? Number(diaMes) : undefined,
        hora: hora || undefined,
        delegadoId: delegadoId || undefined,
        enviarKds,
        enviarDashboard,
      });
      toast.success('Lista de contagem criada.');
      setNovo(false); setNome(''); setSel([]);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao criar');
    }
  }

  async function contar(listaId: string) {
    try {
      const ex: any = await api.iniciarContagem(listaId);
      setExec(ex);
      setContado(Object.fromEntries((ex.itens ?? []).map((i: any) => [i.itemId, ''])));
      setAjuste(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao iniciar');
    }
  }

  async function salvarContagem() {
    if (!exec) return;
    setSalvando(true);
    try {
      const itensContados = (exec.itens ?? [])
        .filter((i: any) => contado[i.itemId] !== '' && contado[i.itemId] != null)
        .map((i: any) => ({ itemId: i.itemId, contado: Number(contado[i.itemId]) }));
      await api.salvarContagem(exec.id, { itens: itensContados, aplicarAjuste: ajuste });
      toast.success(ajuste ? 'Contagem salva e estoque ajustado.' : 'Contagem salva.');
      setExec(null);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display font-semibold">Contagem</h2>
        {!novo && (
          <Button size="sm" onClick={() => setNovo(true)}>
            <Plus className="h-4 w-4" /> Nova lista
          </Button>
        )}
      </div>

      {novo && (
        <Card className="space-y-3 p-4">
          <div className="space-y-1.5">
            <Label>Nome da contagem</Label>
            <Input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Contagem geral segunda" />
          </div>

          <div className="space-y-1.5">
            <Label>Produtos a contar ({sel.length})</Label>
            <div className="max-h-40 overflow-y-auto rounded-md border border-border p-2">
              {itens.length === 0 && <p className="text-xs text-muted-foreground">Cadastre insumos primeiro.</p>}
              <div className="flex flex-wrap gap-1.5">
                {itens.map((i) => {
                  const on = sel.includes(i.id);
                  return (
                    <button key={i.id} type="button" aria-pressed={on ? 'true' : 'false'}
                      onClick={() => toggleItem(i.id)}
                      className={`rounded-md border px-2 py-1 text-xs ${on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground'}`}>
                      {i.nome}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Recorrência</Label>
              <Select value={recorrencia} onChange={(e) => setRecorrencia(e.target.value)}>
                <option value="diaria">Diária</option>
                <option value="semanal">Semanal</option>
                <option value="mensal">Mensal</option>
                <option value="avulsa">Avulsa</option>
              </Select>
            </div>
            {recorrencia === 'semanal' && (
              <div className="space-y-1.5">
                <Label>Dia da semana</Label>
                <Select value={diaSemana} onChange={(e) => setDiaSemana(e.target.value)}>
                  {DIAS.map((d, i) => (<option key={i} value={i}>{d}</option>))}
                </Select>
              </div>
            )}
            {recorrencia === 'mensal' && (
              <div className="space-y-1.5">
                <Label>Dia do mês</Label>
                <Input type="number" min={1} max={31} value={diaMes} onChange={(e) => setDiaMes(e.target.value)} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Horário do alerta</Label>
              <Input type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Delegar a (opcional)</Label>
              <Select value={delegadoId} onChange={(e) => setDelegadoId(e.target.value)}>
                <option value="">— ninguém —</option>
                {colabs.map((c) => (<option key={c.id} value={c.id}>{c.nome}</option>))}
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={enviarKds} onChange={(e) => setEnviarKds(e.target.checked)} className="h-4 w-4 accent-primary" />
              Avisar no KDS
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={enviarDashboard} onChange={(e) => setEnviarDashboard(e.target.checked)} className="h-4 w-4 accent-primary" />
              Avisar no dashboard do gerente
            </label>
          </div>

          <div className="flex gap-2">
            <Button type="button" className="flex-1" onClick={criar}>Criar lista</Button>
            <Button type="button" variant="outline" onClick={() => setNovo(false)}>Cancelar</Button>
          </div>
        </Card>
      )}

      {listas.length === 0 && !novo && (
        <Card className="p-6 text-center text-sm text-muted-foreground">Nenhuma lista de contagem criada.</Card>
      )}
      {listas.map((l) => (
        <Card key={l.id} className="flex items-center justify-between gap-3 p-4">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-medium">
              {l.nome}
              {l.pendenteHoje && <Badge className="bg-warn/10 text-warn">hoje</Badge>}
            </p>
            <p className="text-xs text-muted-foreground">
              {RECOR[l.recorrencia] ?? l.recorrencia}
              {l.recorrencia === 'semanal' && l.diaSemana != null ? ` (${DIAS[l.diaSemana]})` : ''}
              {l.hora ? ` · ${String(l.hora).slice(0, 5)}` : ''}
              {` · ${l.itens} produto(s)`}
              {l.ultimaContagem ? ` · última ${l.ultimaContagem}` : ' · nunca contada'}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" onClick={() => contar(l.id)}>Contar</Button>
            <Button type="button" variant="ghost" size="icon" aria-label="Remover lista"
              className="text-destructive"
              onClick={async () => { if (confirm('Remover esta lista?')) { await api.removerContagemLista(l.id); reload(); } }}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </Card>
      ))}

      {/* Modal de contagem */}
      {exec && (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/50 p-4" onClick={() => setExec(null)}>
          <Card className="w-full max-w-md space-y-3 p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-semibold">Contar estoque</h3>
            <div className="space-y-2">
              {(exec.itens ?? []).map((i: any) => {
                const c = contado[i.itemId];
                const diff = c !== '' && c != null ? Number(c) - Number(i.saldoSistema) : null;
                return (
                  <div key={i.itemId} className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{i.nome}</p>
                      <p className="text-[11px] text-muted-foreground">sistema: {Number(i.saldoSistema)} {i.unidadeMedida}</p>
                    </div>
                    <Input type="number" inputMode="decimal" value={c ?? ''} placeholder="contado" className="h-9 w-24"
                      onChange={(e) => setContado((s) => ({ ...s, [i.itemId]: e.target.value }))} />
                    {diff != null && Math.abs(diff) > 1e-9 && (
                      <span className={`w-12 text-right text-xs ${diff < 0 ? 'text-destructive' : 'text-ok'}`}>
                        {diff > 0 ? '+' : ''}{diff}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={ajuste} onChange={(e) => setAjuste(e.target.checked)} className="h-4 w-4 accent-primary" />
              Ajustar o estoque pela contagem (lança ajuste da diferença)
            </label>
            <div className="flex gap-2">
              <Button type="button" className="flex-1" disabled={salvando} onClick={salvarContagem}>
                {salvando ? 'Salvando…' : 'Salvar contagem'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setExec(null)}>Cancelar</Button>
            </div>
          </Card>
        </div>
      )}
    </section>
  );
}
