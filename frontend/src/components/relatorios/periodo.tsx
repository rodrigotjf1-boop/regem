'use client';

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { dataBr, hojeIso, texto2 } from '@/components/ui/lista';

// PERÍODO das telas do menu Relatórios (mockup `mockups/regem-relatorios.html`): atalhos em vez de
// duas datas soltas, e a tela ESCREVE de quando a quando são os números, de qual loja e a que
// horas foram atualizados. O corte é feito no servidor — aqui só se monta o pedido.

export const ATALHOS = [
  { v: 'hoje', rotulo: 'Hoje' },
  { v: 'ontem', rotulo: 'Ontem' },
  { v: '7', rotulo: 'Últimos 7 dias' },
  { v: '30', rotulo: 'Últimos 30 dias' },
  { v: 'mes', rotulo: 'Este mês' },
  { v: 'mesp', rotulo: 'Mês passado' },
  { v: 'ano', rotulo: 'Este ano' },
  { v: 'outro', rotulo: 'Personalizado' },
] as const;
export type Atalho = (typeof ATALHOS)[number]['v'];

const maisDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
/** As datas (yyyy-mm-dd) de um atalho, contadas a partir de `hoje` no fuso da loja. */
export function datasDoAtalho(v: Atalho, hoje: string): { de: string; ate: string } | null {
  const mes1 = `${hoje.slice(0, 7)}-01`;
  switch (v) {
    case 'hoje': return { de: hoje, ate: hoje };
    case 'ontem': return { de: maisDias(hoje, -1), ate: maisDias(hoje, -1) };
    case '7': return { de: maisDias(hoje, -6), ate: hoje };
    case '30': return { de: maisDias(hoje, -29), ate: hoje };
    case 'mes': return { de: mes1, ate: hoje };
    case 'mesp': { const fim = maisDias(mes1, -1); return { de: `${fim.slice(0, 7)}-01`, ate: fim }; }
    case 'ano': return { de: `${hoje.slice(0, 4)}-01-01`, ate: hoje };
    default: return null;
  }
}

export type Periodo = {
  atalho: Atalho;
  /** yyyy-mm-dd; vazio até a tela montar no navegador (a data de hoje não entra no primeiro desenho). */
  de: string;
  ate: string;
  /** Só uma faixa de horário (telas que aceitam hora). */
  comHora: boolean;
  horaDe: string;
  horaAte: string;
  /** Motivo de o período não poder ser consultado ("a data inicial é depois da final"). */
  invalido: string;
  /** Pronto para consultar: montou no navegador e as datas valem. */
  pronto: boolean;
  /** "08/09 a 07/10" (ou "07/10" quando é um dia só), com a faixa de horário se houver. */
  texto: string;
  /** Carimbos para as rotas que aceitam hora: "yyyy-mm-dd hh:mm:ss". */
  inicioTs: string;
  fimTs: string;
  escolher: (v: Atalho) => void;
  mudar: (p: Partial<Pick<Periodo, 'de' | 'ate' | 'comHora' | 'horaDe' | 'horaAte'>>) => void;
};

export function usePeriodo(inicial: Atalho = '30'): Periodo {
  // A data de hoje é lida DEPOIS de montar: a página é pré-desenhada no servidor e "hoje" de lá
  // não é o "hoje" de quem abre a tela.
  const [hoje, setHoje] = useState('');
  const [atalho, setAtalho] = useState<Atalho>(inicial);
  const [proprio, setProprio] = useState({ de: '', ate: '' });
  const [hora, setHora] = useState({ comHora: false, horaDe: '00:00', horaAte: '23:59' });
  useEffect(() => setHoje(hojeIso()), []);

  return useMemo(() => {
    const datas = hoje ? (atalho === 'outro' ? proprio : datasDoAtalho(atalho, hoje)) : null;
    const de = datas?.de ?? '';
    const ate = datas?.ate ?? '';
    const invalido = !hoje ? '' : !de || !ate ? 'Informe as duas datas.' : de > ate ? 'A data inicial é depois da final.' : hora.comHora && de === ate && hora.horaDe > hora.horaAte ? 'A hora inicial é depois da final.' : '';
    const hDe = hora.comHora ? hora.horaDe || '00:00' : '00:00';
    const hAte = hora.comHora ? hora.horaAte || '23:59' : '23:59';
    return {
      atalho, de, ate, ...hora, invalido,
      pronto: !!hoje && !invalido,
      texto: !de || !ate ? '' : `${de === ate ? dataBr(de) : `${dataBr(de)} a ${dataBr(ate)}`}${hora.comHora ? `, das ${hDe} às ${hAte}` : ''}`,
      inicioTs: de ? `${de} ${hDe}:00` : '',
      fimTs: ate ? `${ate} ${hAte}:59` : '',
      escolher: (v: Atalho) => {
        // "Personalizado" começa nas datas que estavam na tela — a pessoa só ajusta.
        if (v === 'outro' && hoje) setProprio(datasDoAtalho(atalho === 'outro' ? '30' : atalho, hoje) ?? { de: hoje, ate: hoje });
        setAtalho(v);
      },
      mudar: (p) => {
        if (p.de !== undefined || p.ate !== undefined) setProprio((a) => ({ de: p.de ?? a.de, ate: p.ate ?? a.ate }));
        if (p.comHora !== undefined || p.horaDe !== undefined || p.horaAte !== undefined)
          setHora((a) => ({ comHora: p.comHora ?? a.comHora, horaDe: p.horaDe ?? a.horaDe, horaAte: p.horaAte ?? a.horaAte }));
      },
    };
  }, [hoje, atalho, proprio, hora]);
}

export function BarraPeriodo({
  periodo,
  escopo,
  comHorario = false,
  atualizadoEm,
  carregando = false,
  aoAtualizar,
  atalhos = ATALHOS,
  total,
}: {
  periodo: Periodo;
  /** De qual loja são os números — o que o SERVIDOR faz nesta tela ("loja Matriz", "todas as lojas somadas"). */
  escopo: string;
  /** Opção de somar todas as lojas. Só é passada a quem vê a rede, em empresa com mais de uma loja. */
  total?: { ligado: boolean; aoMudar: (v: boolean) => void };
  /** A tela aceita filtrar por faixa de horário. */
  comHorario?: boolean;
  /** Quando a última leitura chegou (nulo = ainda não leu). */
  atualizadoEm: Date | null;
  carregando?: boolean;
  aoAtualizar: () => void;
  atalhos?: readonly { v: Atalho; rotulo: string }[];
}) {
  const p = periodo;
  const status = p.invalido
    ? p.invalido
    : [p.texto, escopo, atualizadoEm ? `atualizado às ${atualizadoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : carregando ? 'carregando…' : ''].filter(Boolean).join(' · ');
  return (
    <Card className="grid grid-cols-2 items-end gap-3 p-3 md:grid-cols-[repeat(auto-fit,minmax(170px,1fr))]" role="group" aria-label="Período">
      <div className="col-span-2 min-w-0 space-y-1 md:col-span-1">
        <Label htmlFor="periodo-atalho">Período</Label>
        <Select id="periodo-atalho" value={p.atalho} onChange={(e) => p.escolher(e.target.value as Atalho)}>
          {atalhos.map((a) => <option key={a.v} value={a.v}>{a.rotulo}</option>)}
        </Select>
      </div>
      {p.atalho === 'outro' && (
        <>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="periodo-de">De</Label>
            <Input id="periodo-de" type="date" value={p.de} max={p.ate || undefined} onChange={(e) => p.mudar({ de: e.target.value })} />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="periodo-ate">Até</Label>
            <Input id="periodo-ate" type="date" value={p.ate} min={p.de || undefined} onChange={(e) => p.mudar({ ate: e.target.value })} />
          </div>
        </>
      )}
      {comHorario && p.comHora && (
        <>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="periodo-hora-de">Das</Label>
            <Input id="periodo-hora-de" type="time" value={p.horaDe} onChange={(e) => p.mudar({ horaDe: e.target.value })} />
          </div>
          <div className="min-w-0 space-y-1">
            <Label htmlFor="periodo-hora-ate">Às</Label>
            <Input id="periodo-hora-ate" type="time" value={p.horaAte} onChange={(e) => p.mudar({ horaAte: e.target.value })} />
          </div>
        </>
      )}
      {comHorario && (
        <label className="col-span-2 flex min-h-10 items-center gap-2 text-sm font-semibold md:col-span-1">
          <input type="checkbox" className="h-5 w-5 flex-none accent-[hsl(var(--ok))]" checked={p.comHora} onChange={(e) => p.mudar({ comHora: e.target.checked })} />
          Só uma faixa de horário
        </label>
      )}
      {total && (
        <label className="col-span-2 flex min-h-10 items-center gap-2 text-sm font-semibold md:col-span-1">
          <input id="periodo-total" type="checkbox" className="h-5 w-5 flex-none accent-[hsl(var(--ok))]" checked={total.ligado} onChange={(e) => total.aoMudar(e.target.checked)} />
          Somar todas as lojas
        </label>
      )}
      <div className="col-span-2 md:col-span-1">
        <Button type="button" variant="outline" onClick={aoAtualizar} disabled={carregando || !p.pronto}>
          <RefreshCw className={`h-4 w-4 ${carregando ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden="true" /> Atualizar
        </Button>
      </div>
      <p className={`col-span-full text-sm ${p.invalido ? 'font-semibold' : texto2}`} role="status" aria-live="polite">{status}</p>
    </Card>
  );
}
