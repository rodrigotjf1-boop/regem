'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function ProducaoConfigPage() {
  const router = useRouter();
  const [setores, setSetores] = useState<any[]>([]);
  const [equipamentos, setEquipamentos] = useState<any[]>([]);
  const [destinosPorSetor, setDestinosPorSetor] = useState<Record<string, string[]>>({});
  const [cores, setCores] = useState({ verdeAteMin: 5, amareloAteMin: 10 });
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState('');

  const reload = useCallback(async () => {
    setErro('');
    try {
      const [ss, eq, cor] = await Promise.all([
        api.setores(),
        api.equipamentos().catch(() => []),
        api.kdsCores().catch(() => ({ verdeAteMin: 5, amareloAteMin: 10 })),
      ]);
      setSetores(ss as any[]);
      setEquipamentos(
        (eq as any[]).filter((e) => e.tipo === 'kds' || e.tipo === 'impressora'),
      );
      setCores({
        verdeAteMin: (cor as any).verdeAteMin ?? 5,
        amareloAteMin: (cor as any).amareloAteMin ?? 10,
      });
      // carrega destinos de cada setor
      const mapa: Record<string, string[]> = {};
      await Promise.all(
        (ss as any[]).map(async (s) => {
          const d: any = await api.destinosSetor(s.id).catch(() => []);
          mapa[s.id] = (d as any[]).map((x) => x.equipamentoId);
        }),
      );
      setDestinosPorSetor(mapa);
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

  function toggle(setorId: string, equipId: string) {
    setDestinosPorSetor((m) => {
      const atual = m[setorId] ?? [];
      return {
        ...m,
        [setorId]: atual.includes(equipId)
          ? atual.filter((x) => x !== equipId)
          : [...atual, equipId],
      };
    });
  }

  async function salvarSetor(setorId: string) {
    setSalvando(setorId);
    try {
      await api.setDestinosSetor(setorId, destinosPorSetor[setorId] ?? []);
      toast.success('Padrão do setor salvo.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando('');
    }
  }

  async function salvarCores() {
    setSalvando('cores');
    try {
      await api.setKdsCores({
        verdeAteMin: Number(cores.verdeAteMin),
        amareloAteMin: Number(cores.amareloAteMin),
      });
      toast.success('Cores do KDS salvas.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando('');
    }
  }

  return (
    <Shell eyebrow="Gestão · produção" title="Produção & KDS">
      <div className="max-w-3xl space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}

        {/* Cores do KDS */}
        <Card className="p-4">
          <h2 className="font-display text-lg font-semibold">Cores do KDS por tempo</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Limiares em minutos desde a chegada do pedido: até verde, até amarelo, acima disso vermelho.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Verde até (min)</Label>
              <Input
                type="number"
                className="w-28"
                value={cores.verdeAteMin}
                onChange={(e) => setCores((c) => ({ ...c, verdeAteMin: Number(e.target.value) }))}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Amarelo até (min)</Label>
              <Input
                type="number"
                className="w-28"
                value={cores.amareloAteMin}
                onChange={(e) => setCores((c) => ({ ...c, amareloAteMin: Number(e.target.value) }))}
              />
            </div>
            <Button type="button" onClick={salvarCores} disabled={salvando === 'cores'}>
              {salvando === 'cores' ? 'Salvando…' : 'Salvar cores'}
            </Button>
          </div>
        </Card>

        {/* Padrão do setor */}
        <Card className="p-4">
          <h2 className="font-display text-lg font-semibold">Destino padrão por setor</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Onde os produtos de cada setor saem quando o produto não define destino próprio.
          </p>
          {setores.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum setor cadastrado.</p>
          )}
          {equipamentos.length === 0 && setores.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum KDS/impressora. Cadastre em Cadastros → Equipamentos.
            </p>
          )}
          <div className="space-y-3">
            {setores.map((s) => (
              <div key={s.id} className="rounded-lg border border-border p-3">
                <div className="mb-2 font-medium">{s.nome}</div>
                <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {equipamentos.map((e) => (
                    <label
                      key={e.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm ${(destinosPorSetor[s.id] ?? []).includes(e.id) ? 'border-primary bg-primary/10' : 'border-border'}`}
                    >
                      <input
                        type="checkbox"
                        checked={(destinosPorSetor[s.id] ?? []).includes(e.id)}
                        onChange={() => toggle(s.id, e.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="flex-1">{e.nome}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        {e.tipo === 'impressora' ? 'impressora' : 'KDS'}
                      </span>
                    </label>
                  ))}
                </div>
                {equipamentos.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2"
                    onClick={() => salvarSetor(s.id)}
                    disabled={salvando === s.id}
                  >
                    {salvando === s.id ? 'Salvando…' : 'Salvar setor'}
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
