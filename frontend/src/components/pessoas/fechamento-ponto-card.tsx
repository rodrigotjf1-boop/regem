'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileText, RefreshCw, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/* eslint-disable @typescript-eslint/no-explicit-any */
const MESES = [
  '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
function mesLabel(competencia: string) {
  const [y, m] = competencia.split('-');
  return `${MESES[Number(m)]}/${y}`;
}
function diaBr(data: string) {
  const [, m, d] = data.split('-');
  return `${d}/${m}`;
}

// Alerta de fechamento mensal de ponto (Épico #2) em Gerenciamento de ponto.
// Mostra as pendências detectadas pelo job do 1º dia do mês; ao zerar, oferece
// encaminhar o espelho ao RH. Clicar num colaborador abre o espelho dele.
export function FechamentoPontoCard({
  onAbrirColaborador,
}: {
  onAbrirColaborador?: (id: string, nome: string) => void;
}) {
  const [fechamentos, setFechamentos] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pedindoResp, setPedindoResp] = useState(false);
  const [respNome, setRespNome] = useState('');
  const [respTel, setRespTel] = useState('');

  const carregar = useCallback(async () => {
    try {
      setFechamentos(await api.pontoFechamentos());
    } catch {
      setFechamentos([]);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function recalcular(competencia?: string) {
    setBusy(true);
    try {
      await api.gerarFechamentoPonto(competencia);
      await carregar();
    } finally {
      setBusy(false);
    }
  }

  async function abrirPdf(competencia: string) {
    setBusy(true);
    try {
      const url = await api.pontoEspelhoPdfUrl(competencia);
      window.open(url, '_blank');
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao gerar o PDF');
    } finally {
      setBusy(false);
    }
  }

  async function encaminhar(
    competencia: string,
    resp?: { nome: string; telefone: string },
  ) {
    setBusy(true);
    try {
      const r: any = await api.enviarEspelhoPonto(competencia, resp);
      if (r?.precisaResponsavel) {
        setPedindoResp(true);
      } else {
        setPedindoResp(false);
        setRespNome('');
        setRespTel('');
        await carregar();
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Erro ao encaminhar');
    } finally {
      setBusy(false);
    }
  }

  if (!fechamentos) return null;

  // Nunca rodou o job: oferece gerar o fechamento do mês anterior à mão.
  if (fechamentos.length === 0) {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-2 p-4">
        <p className="text-sm text-muted-foreground">
          Nenhum fechamento de ponto gerado ainda.
        </p>
        <Button variant="outline" onClick={() => recalcular()} disabled={busy}>
          <RefreshCw className={`mr-2 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          Gerar fechamento do mês anterior
        </Button>
      </Card>
    );
  }

  // O fechamento em foco: o mais recente ainda não enviado (senão o topo).
  const atual = fechamentos.find((f) => f.status !== 'enviado') ?? fechamentos[0];
  const pend = Number(atual.totalPendencias) || 0;
  const pendencias: any[] = Array.isArray(atual.pendencias) ? atual.pendencias : [];

  if (atual.status === 'enviado') {
    return (
      <Card className="flex flex-wrap items-center gap-2 border-ok/30 bg-ok/10 p-4">
        <CheckCircle2 className="h-5 w-5 flex-none text-ok" />
        <p className="text-sm">
          Espelho de <strong>{mesLabel(atual.competencia)}</strong> encaminhado ao RH.
        </p>
      </Card>
    );
  }

  const ok = pend === 0;
  return (
    <Card
      className={`p-4 ${ok ? 'border-ok/30 bg-ok/10' : 'border-warn/30 bg-warn/10'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          {ok ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 flex-none text-ok" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-none text-warn" />
          )}
          <div>
            <p className="font-display text-sm font-bold">
              Fechamento de ponto · {mesLabel(atual.competencia)}
            </p>
            <p className="text-xs text-muted-foreground">
              {ok
                ? `Sem pendências em ${atual.totalColaboradores} colaborador(es) escalado(s). Pronto para encaminhar ao RH.`
                : `${pend} pendência(s) em ${pendencias.length} colaborador(es). Corrija as batidas e recalcule.`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="!py-1.5 !px-3 text-xs"
            onClick={() => recalcular(atual.competencia)}
            disabled={busy}
          >
            <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            Recalcular
          </Button>
          <Button
            variant="outline"
            className="!py-1.5 !px-3 text-xs"
            onClick={() => abrirPdf(atual.competencia)}
            disabled={busy}
          >
            <FileText className="mr-1.5 h-3.5 w-3.5" />
            Gerar PDF
          </Button>
          {ok && (
            <Button
              className="!py-1.5 !px-3 text-xs"
              onClick={() => encaminhar(atual.competencia)}
              disabled={busy}
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              Encaminhar ao RH
            </Button>
          )}
        </div>
      </div>

      {pedindoResp && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          <p className="text-xs text-muted-foreground">
            Nenhum responsável do RH cadastrado. Informe o nome e o WhatsApp para
            encaminhar o espelho.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[9rem] flex-1">
              <label className="mb-1 block text-[11px] text-muted-foreground">Nome</label>
              <Input
                value={respNome}
                onChange={(e) => setRespNome(e.target.value)}
                placeholder="Responsável do RH"
              />
            </div>
            <div className="min-w-[9rem] flex-1">
              <label className="mb-1 block text-[11px] text-muted-foreground">WhatsApp</label>
              <Input
                value={respTel}
                onChange={(e) => setRespTel(e.target.value)}
                placeholder="(11) 90000-0000"
              />
            </div>
            <Button
              className="!py-2 !px-3 text-xs"
              disabled={busy || !respNome.trim() || !respTel.trim()}
              onClick={() =>
                encaminhar(atual.competencia, {
                  nome: respNome.trim(),
                  telefone: respTel.trim(),
                })
              }
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              Enviar ao RH
            </Button>
          </div>
        </div>
      )}

      {!ok && pendencias.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-t border-warn/20 pt-3">
          {pendencias.map((p) => (
            <li key={p.colaboradorId} className="text-sm">
              <button
                type="button"
                className="font-medium underline-offset-2 hover:underline"
                onClick={() => onAbrirColaborador?.(p.colaboradorId, p.nome)}
              >
                {p.nome}
              </button>
              <span className="ml-2 text-xs text-muted-foreground">
                {(p.dias ?? [])
                  .map((d: any) => `${diaBr(d.data)} (${d.motivo})`)
                  .join(' · ')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
