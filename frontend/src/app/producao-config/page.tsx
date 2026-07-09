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
  const [cores, setCores] = useState({ verdeAteMin: 5, amareloAteMin: 10, usaPreparo: true, usaEntregue: true });
  const [senhaPeriodo, setSenhaPeriodo] = useState('diario');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState('');

  const reload = useCallback(async () => {
    setErro('');
    try {
      const [ss, eq, cor, sc] = await Promise.all([
        api.setores(),
        api.equipamentos().catch(() => []),
        api.kdsCores().catch(() => ({})),
        api.senhaConfig().catch(() => ({ periodo: 'diario' })),
      ]);
      setSetores(ss as any[]);
      setEquipamentos(
        (eq as any[]).filter((e) => e.tipo === 'kds' || e.tipo === 'impressora'),
      );
      setCores({
        verdeAteMin: (cor as any).verdeAteMin ?? 5,
        amareloAteMin: (cor as any).amareloAteMin ?? 10,
        usaPreparo: (cor as any).usaPreparo ?? true,
        usaEntregue: (cor as any).usaEntregue ?? true,
      });
      setSenhaPeriodo((sc as any).periodo ?? 'diario');
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

  async function salvarCores() {
    setSalvando('cores');
    try {
      await api.setKdsCores({
        verdeAteMin: Number(cores.verdeAteMin),
        amareloAteMin: Number(cores.amareloAteMin),
        usaPreparo: cores.usaPreparo,
        usaEntregue: cores.usaEntregue,
      });
      toast.success('Configuração do KDS salva.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando('');
    }
  }

  async function salvarSenha(periodo: string) {
    setSenhaPeriodo(periodo);
    try {
      await api.setSenhaPeriodo(periodo);
      toast.success('Reset de senha atualizado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
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
              {salvando === 'cores' ? 'Salvando…' : 'Salvar'}
            </Button>
          </div>

          {/* Prévia das 3 faixas */}
          <div className="mt-3 flex items-stretch gap-1 text-center text-[11px] font-semibold">
            <div className="flex-1 rounded-md bg-ok/15 py-1.5 text-ok">
              🟢 0–{cores.verdeAteMin} min
            </div>
            <div className="flex-1 rounded-md bg-warn/15 py-1.5 text-warn">
              🟡 {cores.verdeAteMin}–{cores.amareloAteMin} min
            </div>
            <div className="flex-1 rounded-md bg-destructive/15 py-1.5 text-destructive">
              🔴 acima de {cores.amareloAteMin} min
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Etapas do pedido (a etapa “pronto” é sempre usada)
            </p>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={cores.usaPreparo}
                  onChange={(e) => setCores((c) => ({ ...c, usaPreparo: e.target.checked }))}
                  className="h-4 w-4 accent-primary"
                />
                Usar “em preparo”
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={cores.usaEntregue}
                  onChange={(e) => setCores((c) => ({ ...c, usaEntregue: e.target.checked }))}
                  className="h-4 w-4 accent-primary"
                />
                Usar “entregue”
              </label>
            </div>
          </div>
        </Card>

        {/* Senha */}
        <Card className="p-4">
          <h2 className="font-display text-lg font-semibold">Senha de atendimento</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Quando a numeração da senha reinicia.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[
              { v: 'diario', l: 'Diário' },
              { v: 'semanal', l: 'Semanal' },
              { v: 'nunca', l: 'Sem reset' },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                onClick={() => salvarSenha(o.v)}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium ${senhaPeriodo === o.v ? 'border-primary bg-primary/15 text-primary' : 'border-border'}`}
              >
                {o.l}
              </button>
            ))}
          </div>
        </Card>

        {/* Destino da produção — informativo */}
        <Card className="p-4">
          <h2 className="font-display text-lg font-semibold">Destino da produção</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Cada venda gera <strong>um único pedido</strong> no KDS, com a senha e
            todos os itens juntos. As impressoras cadastradas continuam recebendo
            a via de produção automaticamente.
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Aparelhos (KDS/impressora):{' '}
            <strong>{equipamentos.length}</strong> cadastrado(s) · gerencie em
            Cadastros → Equipamentos.
          </p>
        </Card>
      </div>
    </Shell>
  );
}
