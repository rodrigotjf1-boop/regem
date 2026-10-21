'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Gaveta } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { QuadroSenhas } from '@/components/senhas/quadro-senhas';
import {
  CAMPOS_TAMANHO,
  ROTULO_TAMANHO,
  SOM_PADRAO,
  TAMANHOS_PADRAO,
  TAMANHO_MAX,
  TAMANHO_MIN,
  TAMANHO_PASSO,
  TEMPOS_PRONTO_MIN,
  TEMPO_PRONTO_PADRAO,
  rotuloTempo,
  tamanhosValidos,
  type SenhaProntaTv,
  type SenhaTv,
  type Tamanhos,
} from '@/lib/tela-senhas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "Ajustes da tela" de uma tela de senhas (Configurações › Equipamentos; mockups/regem-kds-estacoes.html, aba "Tela de
// senhas"): a prévia da TV com senhas de exemplo, aplicada na hora; a logo e o nome (de Configurações › Loja); o
// tamanho das letras DESTA TV; o tempo em Pronto e o aviso, que valem para TODAS as telas de senhas (o servidor grava
// no ajuste da empresa). Salvo, as TVs se redesenham na hora (aviso pelo tempo real).

const EXEMPLO_PREPARANDO: SenhaTv[] = ['B118', 'D251', 'B119', 'D252', 'B120', 'D253'].map((s, i) => ({ id: `p${i}`, senha: Number(s.slice(1)), prefixo: s[0] }));
const EXEMPLO_PRONTO: SenhaProntaTv[] = ['D247', 'B115', 'D249'].map((s, i) => ({ id: `r${i}`, senha: Number(s.slice(1)), prefixo: s[0], prontoEm: '', saiEm: null }));
const CHAMA = new Set(['r0']);

export function TelaSenhasGaveta({ equipamento, voltarPara, aoFechar, aoSalvar }: {
  equipamento: any;
  voltarPara: string;
  aoFechar: () => void;
  aoSalvar?: () => void;
}) {
  const [carregado, setCarregado] = useState<{ tamanhos: Tamanhos; prontoMin: number; som: boolean; loja: any } | null>(null);
  const [erro, setErro] = useState('');
  const [tamanhos, setTamanhos] = useState<Tamanhos>(TAMANHOS_PADRAO);
  const [prontoMin, setProntoMin] = useState<number>(TEMPO_PRONTO_PADRAO);
  const [som, setSom] = useState<boolean>(SOM_PADRAO);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    let vivo = true;
    api
      .ajustesDaTelaSenhas(equipamento.id)
      .then((r: any) => {
        if (!vivo) return;
        const t = tamanhosValidos(r?.tamanhos);
        setCarregado({ tamanhos: t, prontoMin: Number(r?.prontoMin ?? TEMPO_PRONTO_PADRAO), som: r?.som !== false, loja: r?.loja ?? { nome: equipamento.nome } });
        setTamanhos(t);
        setProntoMin(Number(r?.prontoMin ?? TEMPO_PRONTO_PADRAO));
        setSom(r?.som !== false);
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : 'Não consegui ler os ajustes desta tela.'));
    return () => {
      vivo = false;
    };
  }, [equipamento.id, equipamento.nome]);

  const mudou = useMemo(
    () =>
      !!carregado &&
      (JSON.stringify(tamanhos) !== JSON.stringify(carregado.tamanhos) || prontoMin !== carregado.prontoMin || som !== carregado.som),
    [carregado, tamanhos, prontoMin, som],
  );

  function padrao() {
    setTamanhos(TAMANHOS_PADRAO);
    setProntoMin(TEMPO_PRONTO_PADRAO);
    setSom(SOM_PADRAO);
  }

  async function salvar() {
    setSalvando(true);
    setErro('');
    try {
      const r: any = await api.salvarAjustesDaTelaSenhas(equipamento.id, { tamanhos, prontoMin, som });
      const t = tamanhosValidos(r?.tamanhos ?? tamanhos);
      setCarregado((c) => (c ? { ...c, tamanhos: t, prontoMin: Number(r?.prontoMin ?? prontoMin), som: r?.som ?? som } : c));
      toast.success('Ajustes da tela salvos — as TVs já mostram assim.');
      aoSalvar?.();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Não consegui salvar os ajustes.';
      setErro(msg);
      toast.error(msg);
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo={`Ajustes da tela de senhas — ${equipamento.nome}`}
      aoFechar={aoFechar}
      voltarPara={voltarPara}
      media
      rodape={
        <>
          <Button type="button" variant="outline" onClick={padrao} disabled={!carregado || salvando}>
            Voltar ao padrão
          </Button>
          <Button type="button" onClick={() => void salvar()} disabled={!carregado || !mudou || salvando}>
            {salvando ? 'Salvando…' : 'Salvar ajustes da tela'}
          </Button>
        </>
      }
    >
      {erro && (
        <p role="alert" className="mb-3 rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium">
          {erro}
        </p>
      )}
      {!carregado ? (
        !erro && <p className={texto2} role="status">Lendo os ajustes…</p>
      ) : (
        <div className="space-y-5">
          <p className={`text-sm ${texto2}`}>
            O <strong className="text-foreground">tamanho das letras</strong> é só desta TV. O <strong className="text-foreground">tempo em Pronto</strong> e o{' '}
            <strong className="text-foreground">aviso</strong> valem para todas as telas de senhas. A tela mostra os pedidos que passam por um KDS:
            Preparando enquanto alguma estação trabalha, e Pronto quando o último KDS termina (ou o despacho chama a senha).
          </p>

          <figure className="space-y-1.5">
            <div className="w-full">
              <QuadroSenhas
                previa
                loja={carregado.loja}
                tamanhos={tamanhos}
                preparando={EXEMPLO_PREPARANDO}
                pronto={EXEMPLO_PRONTO}
                novas={CHAMA}
                hora="21:14"
              />
            </div>
            <figcaption className={`text-xs ${texto2}`}>Prévia com senhas de exemplo — muda na hora, conforme os ajustes abaixo.</figcaption>
          </figure>

          <section className="space-y-2" aria-labelledby="tv-logo-nome">
            <h3 id="tv-logo-nome" className="font-display text-sm font-bold">Logo e nome</h3>
            <p className={`text-sm ${texto2}`}>
              <strong className="text-foreground">{carregado.loja?.nome}</strong> — vêm de <strong className="text-foreground">Configurações › Loja</strong>: a logo e
              o nome público, os mesmos do cardápio online.
            </p>
          </section>

          <section className="space-y-3" aria-labelledby="tv-tamanhos">
            <h3 id="tv-tamanhos" className="font-display text-sm font-bold">Tamanho das letras</h3>
            {CAMPOS_TAMANHO.map((c) => {
              const id = `tv-tam-${c}`;
              return (
                <div key={c} className="grid grid-cols-1 items-center gap-1 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_3.5rem] sm:gap-3">
                  <label htmlFor={id} className="text-sm">{ROTULO_TAMANHO[c]}</label>
                  <input
                    id={id}
                    type="range"
                    min={TAMANHO_MIN}
                    max={TAMANHO_MAX}
                    step={TAMANHO_PASSO}
                    value={tamanhos[c]}
                    onChange={(e) => setTamanhos((t) => ({ ...t, [c]: Number(e.target.value) }))}
                    className="w-full accent-primary"
                  />
                  <output htmlFor={id} className="font-mono text-sm tabular-nums">{tamanhos[c]}%</output>
                </div>
              );
            })}
          </section>

          {/* Um controle só: o rótulo é do seletor (dar o mesmo nome à seção faria o leitor de tela anunciar duas vezes). */}
          <section className="space-y-2">
            <label htmlFor="tv-tempo-pronto" className="block font-display text-sm font-bold">Tempo da senha em Pronto</label>
            <select
              id="tv-tempo-pronto"
              value={prontoMin}
              onChange={(e) => setProntoMin(Number(e.target.value))}
              className="h-11 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
            >
              {TEMPOS_PRONTO_MIN.map((m) => (
                <option key={m} value={m}>{rotuloTempo(m)}</option>
              ))}
            </select>
            <p className={`text-xs ${texto2}`}>A senha sai antes se o balcão marcar entregue.</p>
          </section>

          <section className="space-y-2" aria-labelledby="tv-aviso">
            <h3 id="tv-aviso" className="font-display text-sm font-bold">Aviso</h3>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={som} onChange={(e) => setSom(e.target.checked)} />
              Tocar um aviso curto quando uma senha ficar pronta
            </label>
          </section>
        </div>
      )}
    </Gaveta>
  );
}
