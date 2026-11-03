'use client';

import { useEffect, useId, useState } from 'react';
import { api, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialogo } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';

// O ANIVERSÁRIO NA GAVETA DO CLIENTE (Delivery › Clientes; Onda 3 · PR 3, mig 357; protótipo
// `mockups/regem-relacionamento.html`, "No painel da loja"): a data, de onde veio (o cliente, no cardápio; ou quem da
// loja), desde quando vale para promoções e se o cliente ainda pode corrigir. A loja ANOTA a data de quem não tem e
// CORRIGE com o motivo — só gerente e presidente (o servidor confere); toda troca recomeça os 30 dias e fica na auditoria.

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS_DO_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const dataBr = (iso?: string | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');
const ORIGEM: Record<string, string> = { perfil: 'pelo cliente, no Perfil do cardápio', confirmacao: 'pelo cliente, na confirmação do pedido', loja: 'pela loja' };

type Estado = {
  dia: number | null;
  mes: number | null;
  texto: string | null;
  informadoEm: string | null;
  origem: string | null;
  valeDesde: string | null;
  podeCorrigirCliente: boolean;
  quem: string | null;
};

export function AniversarioNaGaveta({ clienteId, nome }: { clienteId: string; nome: string }) {
  const [estado, setEstado] = useState<Estado | null>(null);
  const [falhou, setFalhou] = useState(false);
  const [aberto, setAberto] = useState(false);
  const [pode, setPode] = useState(false);
  const [dia, setDia] = useState('');
  const [mes, setMes] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const id = useId();

  useEffect(() => {
    setPode(['presidente', 'gerente'].includes(getCategoria() ?? ''));
    let vivo = true;
    setEstado(null);
    setFalhou(false);
    api
      .crmAniversario(clienteId)
      .then((e: Estado) => vivo && setEstado(e))
      .catch(() => vivo && setFalhou(true));
    return () => {
      vivo = false;
    };
  }, [clienteId]);

  const temData = !!estado?.dia;
  const maxDia = mes ? DIAS_DO_MES[Number(mes) - 1] : 31;

  function abrirDialogo() {
    setDia(estado?.dia ? String(estado.dia) : '');
    setMes(estado?.mes ? String(estado.mes) : '');
    setMotivo('');
    setErro('');
    setAberto(true);
  }
  async function salvar() {
    if (!dia || !mes) return setErro('Escolha o dia e o mês.');
    if (temData && motivo.trim().length < 3) return setErro('Escreva o motivo para corrigir.');
    setSalvando(true);
    setErro('');
    try {
      setEstado(await api.crmCorrigirAniversario(clienteId, { dia: Number(dia), mes: Number(mes), motivo: motivo.trim() || undefined }));
      setAberto(false);
      toast.success(temData ? 'Data corrigida. Vale para promoções daqui a 30 dias; a troca ficou na auditoria.' : 'Aniversário anotado. Vale para promoções daqui a 30 dias.');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'tente de novo');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="border-b border-border px-4 py-3" data-aniversario-gaveta>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">🎂 Aniversário{estado?.texto ? ` · ${estado.texto}` : ''}</p>
          <p className={`text-xs ${texto2}`}>
            {falhou
              ? 'Não foi possível ler o aniversário.'
              : estado == null
                ? 'Carregando…'
                : temData
                  ? `Informado em ${dataBr(estado.informadoEm)} ${estado.origem === 'loja' && estado.quem ? `por ${estado.quem}` : ORIGEM[estado.origem ?? ''] ?? ''}. Vale para promoções desde ${dataBr(estado.valeDesde)}.${estado.podeCorrigirCliente ? ' O cliente ainda pode corrigir uma vez.' : ''}`
                  : 'Sem data. A equipe pode anotar — vale em 30 dias.'}
          </p>
        </div>
        {pode && estado != null && (
          <Button type="button" size="sm" variant="outline" onClick={abrirDialogo}>
            {temData ? 'Corrigir' : 'Anotar'}
          </Button>
        )}
      </div>
      {aberto && (
        <Dialogo
          titulo={`${temData ? 'Corrigir' : 'Anotar'} o aniversário · ${nome || 'Cliente'}`}
          aoFechar={() => setAberto(false)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setAberto(false)} disabled={salvando}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void salvar()} disabled={salvando}>
                {salvando ? 'Salvando…' : temData ? 'Corrigir a data' : 'Anotar a data'}
              </Button>
            </>
          }
        >
          <div className="space-y-3 text-sm">
            {temData && (
              <p>
                Hoje: <b>{estado?.texto}</b>, informado em {dataBr(estado?.informadoEm)}.
              </p>
            )}
            <div role="group" aria-labelledby={`${id}-data`}>
              <span id={`${id}-data`} className="mb-1 block text-sm font-semibold">
                {temData ? 'Nova data' : 'Data'}
              </span>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
                <Select aria-label="Dia" value={dia} onChange={(e) => setDia(e.target.value)} data-foco-inicial>
                  <option value="">Dia</option>
                  {Array.from({ length: maxDia }, (_, i) => (
                    <option key={i + 1} value={String(i + 1)}>
                      {i + 1}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Mês"
                  value={mes}
                  onChange={(e) => {
                    const m = e.target.value;
                    if (dia && m && Number(dia) > DIAS_DO_MES[Number(m) - 1]) setDia('');
                    setMes(m);
                  }}
                >
                  <option value="">Mês</option>
                  {MESES.map((nm, i) => (
                    <option key={nm} value={String(i + 1)}>
                      {nm}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {temData && (
              <div>
                <label htmlFor={`${id}-motivo`} className="mb-1 block text-sm font-semibold">
                  Motivo (obrigatório)
                </label>
                <Input id={`${id}-motivo`} value={motivo} maxLength={200} placeholder="Ex.: o cliente mostrou o documento" onChange={(e) => setMotivo(e.target.value)} />
              </div>
            )}
            {erro && (
              <p className="text-sm font-semibold text-destructive" role="alert">
                {erro}
              </p>
            )}
            <p className={`text-xs ${texto2}`}>
              A data vale para promoções 30 dias depois de {temData ? 'corrigida' : 'anotada'} e o presente continua no máximo uma vez a cada 12 meses.
              {temData ? ' Fica na auditoria: quem, quando, a data de antes e a nova, e o motivo.' : ''} Só gerente e presidente mudam.
            </p>
          </div>
        </Dialogo>
      )}
    </div>
  );
}
