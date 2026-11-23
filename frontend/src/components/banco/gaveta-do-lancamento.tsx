'use client';

import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Selo, texto2 } from '@/components/ui/lista';
import { Gaveta } from '@/components/ui/sobreposto';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { NOME_DA_FONTE, apoioDoLancamento, comSinal, diaCurto, diaInteiro, situacaoDe, type Lancamento } from '@/lib/banco-repasses';

// A gaveta de um lançamento: como veio no extrato (mascarado) e o "Isso é o quê?", com "Lembrar para os próximos".
export function GavetaDoLancamento({
  lancamento: l,
  tipos,
  aoFechar,
  aoSalvar,
}: {
  lancamento: Lancamento;
  tipos: readonly { chave: string; rotulo: string }[];
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const idTipo = useId();
  const [tipo, setTipo] = useState(l.tipo ?? '');
  const [lembrar, setLembrar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const s = situacaoDe(l.situacao);
  const apoio = apoioDoLancamento(l);
  const entrada = l.valor > 0;

  async function salvar() {
    if (salvando) return;
    setErro('');
    setSalvando(true);
    try {
      const comLembrete = lembrar && !!tipo;
      await api.bancoClassificar(l.id, { tipo: tipo || null, lembrar: comLembrete });
      const rotulo = tipos.find((t) => t.chave === tipo)?.rotulo;
      toast.success(comLembrete ? `Salvo. Os próximos com esta descrição entram como "${rotulo}".` : 'Lançamento salvo');
      aoSalvar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui salvar. Tente de novo.');
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo={`${entrada ? 'Entrada' : 'Saída'} de ${diaCurto(l.data)}`}
      aoFechar={aoFechar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar'}</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <Selo tom={s.tom}>{s.rotulo}</Selo>
        <p className={`font-mono text-[26px] font-bold leading-tight tabular-nums [overflow-wrap:anywhere] ${entrada ? 'text-ok' : ''}`}>{comSinal(l.valor)}</p>
        <dl className="divide-y divide-border rounded-lg border border-border">
          <div className="flex items-baseline justify-between gap-3 px-3 py-2">
            <dt className={texto2}>Data</dt>
            <dd className="font-mono text-[13px] font-bold">{diaInteiro(l.data)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 px-3 py-2">
            <dt className={texto2}>Fonte</dt>
            <dd className="font-mono text-[13px] font-bold">{NOME_DA_FONTE[l.fonte]}</dd>
          </div>
        </dl>
        <div>
          <h3 className="mb-1 font-display text-sm font-bold">Como veio no extrato</h3>
          <p className="rounded-md bg-secondary px-3 py-2 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">{l.descricao}</p>
          <p className={`mt-1 text-xs ${texto2}`}>Nomes e documentos ficam mascarados e nunca vão para a IA.</p>
        </div>
        {apoio && <p className={`rounded-md border-l-4 px-3 py-2 ${l.situacao === 'a_conferir' ? 'border-warn bg-warn/10' : 'border-info bg-info/10'}`}>{apoio}.</p>}
        <div className="space-y-1">
          <Label htmlFor={idTipo}>Isso é o quê?</Label>
          <Select id={idTipo} data-foco-inicial value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">Escolher</option>
            {tipos.map((t) => <option key={t.chave} value={t.chave}>{t.rotulo}</option>)}
          </Select>
        </div>
        <label className="flex cursor-pointer items-start gap-2">
          <input type="checkbox" className="mt-0.5 h-[18px] w-[18px] flex-none accent-primary" checked={lembrar} onChange={(e) => setLembrar(e.target.checked)} />
          <span>
            <b className="block">Lembrar para os próximos</b>
            <span className={`text-xs ${texto2}`}>Os próximos lançamentos com esta descrição entram com o mesmo tipo.</span>
          </span>
        </label>
        {erro && <p role="alert" className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">{erro}</p>}
      </div>
    </Gaveta>
  );
}
