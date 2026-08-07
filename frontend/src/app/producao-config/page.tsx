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
  const [cores, setCores] = useState({ verdeAteMin: 5, amareloAteMin: 10, usaPreparo: true, usaEntregue: true });
  const [senhaPeriodo, setSenhaPeriodo] = useState('diario');
  const [dcfg, setDcfg] = useState<any>({});
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState('');

  const reload = useCallback(async () => {
    setErro('');
    try {
      const [ss, eq, cor, sc, dc] = await Promise.all([
        api.setores(),
        api.equipamentos().catch(() => []),
        api.kdsCores().catch(() => ({})),
        api.senhaConfig().catch(() => ({ periodo: 'diario' })),
        api.deliveryConfig().catch(() => ({})),
      ]);
      setSetores(ss as any[]);
      setDcfg(dc ?? {});
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
      toast.success('Direcionamento do setor salvo.');
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

  async function salvarAdiar(v: boolean) {
    const prev = dcfg;
    setDcfg((d: any) => ({ ...d, adiarProducaoAteKds: v }));
    try {
      const c = await api.setDeliveryConfig({ ...dcfg, adiarProducaoAteKds: v });
      setDcfg(c);
      toast.success('Configuração do KDS salva.');
    } catch (e) {
      setDcfg(prev);
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    }
  }

  return (
    <Shell eyebrow="Gestão · produção" title="Produção & KDS">
      <div className="space-y-4">
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

        {/* Impressão da produção (movido de Delivery → Impressoras e cupons) */}
        <Card className="p-4">
          <h2 className="font-display text-lg font-semibold">Impressão da produção</h2>
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-primary"
              checked={!!dcfg?.adiarProducaoAteKds}
              onChange={(e) => salvarAdiar(e.target.checked)} />
            <span>Imprimir a produção só ao avançar no KDS
              <span className="block text-[11px] text-muted-foreground">Por padrão a via de produção sai ao registrar o pedido. Ligado, ela sai apenas quando o pedido avança no KDS que imprime na etapa (ex.: só no despacho). Se nenhum KDS estiver com “imprimir ao avançar”, a via sai no registro mesmo (não perde o ticket).</span>
            </span>
          </label>
        </Card>

        {/* Direcionamento por setor */}
        <Card className="p-4">
          <h2 className="font-display text-lg font-semibold">
            Direcionamento por setor
          </h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Para onde vai a produção de cada setor: um <strong>KDS</strong> (tela)
            ou uma <strong>impressora</strong> (via automática, cadastrada pelo
            servidor edge). A venda continua com <strong>1 senha</strong>; os itens
            do setor aparecem no destino escolhido.
          </p>
          {setores.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum setor cadastrado.</p>
          )}
          {equipamentos.length === 0 && setores.length > 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum KDS/impressora. Cadastre em Cadastros → Equipamentos (as
              impressoras do sistema são registradas pelo servidor edge).
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
                        {e.tipo === 'impressora' ? '🖨️ impressora' : '🖥️ KDS'}
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
