'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const hora = (d?: string) =>
  d ? new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

// Cancelamento comum da NFC-e: 30 minutos da autorização (Ajuste SINIEF 19/16, cl. 15ª — teto
// nacional). Depois disso a SEFAZ devolve 501, então o botão sai de cena em vez de deixar o
// lojista descobrir pelo erro.
const PRAZO_CANCELAMENTO_MIN = 30;
const minutosParaCancelar = (n: any) => {
  if (!n?.emitidaEm) return 0;
  return Math.floor(PRAZO_CANCELAMENTO_MIN - (Date.now() - new Date(n.emitidaEm).getTime()) / 60_000);
};

const COR: Record<string, string> = {
  autorizada: 'bg-ok/10 text-ok',
  cancelada: 'bg-destructive/10 text-destructive',
  rejeitada: 'bg-warn/10 text-warn',
  pendente: 'bg-secondary text-muted-foreground',
  denegada: 'bg-destructive/10 text-destructive',
  contingencia: 'bg-info/10 text-info',
};

export default function NotasPage() {
  const router = useRouter();
  // cat resolvido no cliente (evita divergência de hidratação com o SSR).
  const [cat, setCat] = useState<string | null>(null);
  const isGestor = ['presidente', 'gerente'].includes(cat ?? '');
  const [notas, setNotas] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  const [consultando, setConsultando] = useState<string | null>(null);
  const [lacunas, setLacunas] = useState<any[] | null>(null);
  const [inutilizando, setInutilizando] = useState(false);
  const [duplicidades, setDuplicidades] = useState<any[] | null>(null);
  const [contingencia, setContingencia] = useState<any | null>(null);
  const [transmitindo, setTransmitindo] = useState(false);
  const [cancelandoDup, setCancelandoDup] = useState<string | null>(null);
  const isPresidente = cat === 'presidente';

  const reload = useCallback(async () => {
    try {
      setNotas((await api.notasFiscais()) as any[]);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao carregar');
    }
    // Lacunas são coisa de gestor, e a rota é restrita: falha aqui não derruba a tela.
    try {
      setLacunas((await api.lacunasFiscais()) as any[]);
    } catch {
      setLacunas([]);
    }
    try {
      setDuplicidades((await api.duplicidadesFiscais()) as any[]);
    } catch {
      setDuplicidades([]);
    }
    try {
      setContingencia(await api.contingenciaFiscal());
    } catch {
      setContingencia(null);
    }
  }, []);

  async function transmitirAgora() {
    setTransmitindo(true);
    try {
      const r: any = await api.transmitirContingencia();
      // O ciclo automático já está passando pela fila (ou alguém da loja apertou antes).
      if (r?.emAndamento) toast.info('A fila já está sendo transmitida agora — confira em instantes.');
      else
        toast.success(
          r?.transmitidas ? `${r.transmitidas} nota(s) transmitida(s).` : 'Nada foi transmitido ainda.',
        );
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível transmitir agora.');
    } finally {
      setTransmitindo(false);
    }
  }

  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    setCat(getCategoria());
    reload();
  }, [reload, router]);

  // "Pendente" quer dizer que a SEFAZ não confirmou o resultado — e só ela pode dizer.
  async function consultar(n: any) {
    setConsultando(n.id);
    try {
      const r: any = await api.consultarNota(n.id);
      if (r?.status === 'autorizada') toast.success(`Autorizada na SEFAZ — protocolo ${r.protocolo}.`);
      else if (r?.status === 'pendente') toast.info(`Ainda sem resposta conclusiva: ${r?.motivo ?? ''}`);
      else toast.info(`Situação na SEFAZ: ${r?.status} — ${r?.motivo ?? ''}`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao consultar');
    } finally {
      setConsultando(null);
    }
  }

  // Duas notas para a mesma venda: cancela a ANTIGA referenciando a que o cliente levou.
  async function cancelarDuplicada(d: any) {
    if (
      !window.confirm(
        `Cancelar a NFC-e ${d.serie}/${d.numero}, que foi substituída pela ${d.substitutaSerie}/${d.substitutaNumero}? ` +
          'A SEFAZ registra o cancelamento por substituição e a nota deixa de valer.',
      )
    )
      return;
    setCancelandoDup(d.id);
    try {
      const r: any = await api.cancelarPorSubstituicao(d.id);
      toast.success(`Cancelamento registrado na SEFAZ — protocolo ${r?.protocolo ?? ''}.`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cancelar');
    } finally {
      setCancelandoDup(null);
    }
  }

  // Inutilizar é DEFINITIVO: a faixa homologada nunca mais pode virar nota.
  async function inutilizar(serie: number, faixa: any) {
    const quantos = faixa.quantidade > 1 ? `os números ${faixa.inicio} a ${faixa.fim}` : `o número ${faixa.inicio}`;
    if (!window.confirm(`Inutilizar ${quantos} da série ${serie}? Isso é definitivo: esses números nunca mais poderão virar nota.`))
      return;
    const justificativa =
      window.prompt('Justificativa (mín. 15 caracteres):', 'Numeracao sem nota autorizada - quebra de sequencia') ?? '';
    if (!justificativa) return;
    if (justificativa.trim().length < 15) {
      toast.error('A justificativa precisa de ao menos 15 caracteres.');
      return;
    }
    setInutilizando(true);
    try {
      const r: any = await api.inutilizarFaixa({
        serie,
        numeroInicial: faixa.inicio,
        numeroFinal: faixa.fim,
        justificativa: justificativa.trim(),
      });
      toast.success(`Inutilização homologada — protocolo ${r?.protocolo ?? ''}.`);
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao inutilizar');
    } finally {
      setInutilizando(false);
    }
  }

  async function cancelar(n: any) {
    const justificativa = window.prompt('Justificativa do cancelamento (mín. 15 caracteres):') ?? '';
    if (!justificativa) return;
    if (justificativa.trim().length < 15) {
      toast.error('A justificativa precisa de ao menos 15 caracteres.');
      return;
    }
    try {
      await api.cancelarNota(n.id, justificativa);
      toast.success('Nota cancelada.');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao cancelar');
    }
  }

  return (
    <Shell eyebrow="Fiscal · NFC-e" title="Notas fiscais">
      <div className="space-y-4">
        {erro && <p className="text-destructive">{erro}</p>}
        {/* CONTINGÊNCIA: o caixa continua vendendo, mas a nota ainda não foi autorizada. O
            prazo é curto (fim do primeiro dia útil seguinte) e não transmitir é multa de 5%
            do valor da operação — então isto fica no topo da tela, não escondido numa aba. */}
        {isGestor && (contingencia?.ativa || !!contingencia?.fila?.length) && (
          <Card className="border-warn/40 p-4">
            <p className="text-sm font-medium text-warn">
              {contingencia.ativa ? 'Emitindo em contingência' : 'Notas de contingência à espera de autorização'}
            </p>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">
              {contingencia.ativa
                ? 'A SEFAZ não está respondendo. As vendas continuam saindo com cupom válido, e as notas são transmitidas assim que ela voltar.'
                : 'A SEFAZ voltou. Estas notas ainda precisam ser autorizadas.'}{' '}
              O prazo é <strong>até o fim do primeiro dia útil seguinte</strong> à emissão.
              {contingencia.desde ? ` Em contingência desde ${hora(contingencia.desde)}.` : ''}
            </p>
            <div className="space-y-2">
              {(contingencia.fila ?? []).slice(0, 10).map((n: any) => (
                <div key={n.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">NFC-e {n.serie}/{n.numero}</p>
                    <p className={`text-[11px] ${n.vencida ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {n.vencida
                        ? 'Prazo vencido — transmita e fale com a contabilidade.'
                        : `Restam ${Number(n.horasRestantes).toFixed(0)} h.`}
                      {n.motivo ? ` · ${n.motivo}` : ''}
                    </p>
                  </div>
                </div>
              ))}
              {(contingencia.fila?.length ?? 0) > 10 && (
                <p className="text-[11px] text-muted-foreground">
                  e mais {contingencia.fila.length - 10} nota(s).
                </p>
              )}
            </div>
            <Button type="button" size="sm" variant="outline" className="mt-3" onClick={transmitirAgora} disabled={transmitindo}>
              {transmitindo ? 'Transmitindo…' : 'Tentar transmitir agora'}
            </Button>
          </Card>
        )}
        {!!duplicidades?.length && isGestor && (
          <Card className="border-warn/40 p-4">
            <p className="text-sm font-medium text-warn">Venda com duas notas</p>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">
              A primeira nota não teve resposta da SEFAZ, outra foi emitida para o cliente — e depois a
              primeira apareceu autorizada. As duas cobrem a mesma venda. A lei dá{' '}
              <strong>168 horas da autorização</strong> para cancelar a que não acobertou a operação,
              indicando a que a substituiu. Passado o prazo, a SEFAZ recusa.
            </p>
            <div className="space-y-2">
              {duplicidades.map((d: any) => {
                const horas = Number(d.horasRestantes);
                const venceu = horas <= 0;
                return (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">NFC-e {d.serie}/{d.numero}</span>{' '}
                        <span className="text-muted-foreground">
                          substituída pela {d.substitutaSerie}/{d.substitutaNumero}
                        </span>
                      </p>
                      <p className={`text-[11px] ${venceu ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {venceu
                          ? 'Prazo de 168 h vencido — fale com a contabilidade.'
                          : `Restam ${horas.toFixed(0)} h para cancelar.`}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => cancelarDuplicada(d)}
                      disabled={cancelandoDup === d.id || venceu}
                    >
                      {cancelandoDup === d.id ? 'Cancelando…' : 'Cancelar a duplicada'}
                    </Button>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        {!!lacunas?.length && isGestor && (
          <Card className="p-4">
            <p className="text-sm font-medium text-muted-foreground">Numeração sem nota</p>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">
              Número reservado que não virou nota autorizada deixa um buraco na sequência. A lei manda pedir a
              inutilização desses números <strong>até o dia 10 do mês seguinte</strong> — depois disso, o Fisco
              presume que foram vendas em contingência não transmitidas.
            </p>
            <div className="space-y-3">
              {lacunas.map((l: any) => (
                <div key={l.serie} className="rounded-lg border border-border p-3">
                  <p className="text-sm font-medium">
                    Série {l.serie} · {l.total} número(s)
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {l.faixas.map((f: any) => (
                      <div
                        key={`${l.serie}-${f.inicio}`}
                        className="flex items-center gap-2 rounded border border-border px-2 py-1"
                      >
                        <span className="font-mono text-xs">
                          {f.inicio === f.fim ? f.inicio : `${f.inicio}–${f.fim}`}
                        </span>
                        {isPresidente && (
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => inutilizar(l.serie, f)}
                            disabled={inutilizando}
                          >
                            Inutilizar
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-4">
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            Últimas notas {notas ? `(${notas.length})` : ''}
          </p>
          {!notas && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {notas?.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma nota emitida ainda.</p>
          )}
          <div className="space-y-2">
            {notas?.map((n) => (
              <div key={n.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">NFC-e {n.serie}/{n.numero}</span>
                    <span className={`rounded px-1.5 py-0.5 text-xs ${COR[n.status] ?? ''}`}>{n.status}</span>
                    {n.ambiente === '2' && (
                      <span className="rounded bg-warn/10 px-1.5 py-0.5 text-xs text-warn">homologação</span>
                    )}
                    <span className="text-xs text-muted-foreground">{hora(n.emitidaEm)}</span>
                  </div>
                  {n.chave && (
                    <p className="mt-0.5 break-all font-mono text-[11px] text-muted-foreground">{n.chave}</p>
                  )}
                  {n.motivo && <p className="text-[11px] text-muted-foreground">{n.motivo}</p>}
                </div>
                <span className="font-mono text-sm font-bold">{brl(Number(n.valorTotal))}</span>
                {n.status === 'pendente' && isGestor && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => consultar(n)}
                    disabled={consultando === n.id}
                  >
                    {consultando === n.id ? 'Consultando…' : 'Consultar na SEFAZ'}
                  </Button>
                )}
                {n.status === 'autorizada' && isGestor && minutosParaCancelar(n) > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-destructive"
                    onClick={() => cancelar(n)}
                    title={`Restam ${minutosParaCancelar(n)} min para cancelar na SEFAZ`}
                  >
                    Cancelar ({minutosParaCancelar(n)} min)
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
