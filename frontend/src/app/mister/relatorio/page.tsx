'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, getToken } from '@/lib/api';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { SkeletonList } from '@/components/ui/skeleton';
import { NO_SERVIDOR_DA_LOJA } from '@/components/ui/so-pela-nuvem';
import { texto2 } from '@/components/ui/lista';
import { CorpoDoRelatorio } from '@/components/mister/corpo-do-relatorio';
import type { PlanoDoRelatorio } from '@/lib/mister-relatorio';

// MISTER › O RELATÓRIO DO LINK (M3c.4; versão 3 do protótipo `mockups/regem-mister.html`, aba "Arquivos e links" › "A
// página do link"; decisão 7: abre no Regem com o usuário da pessoa). O link vem na resposta do Mister ("Ver no Regem").
// O servidor refaz o relatório no escopo de quem abre e devolve o MESMO plano do PDF (os textos, os números, as barras):
// a conversa, o PDF e esta página mostram os mesmos números. Aqui só se troca o período e se baixa o PDF.

type Resposta = { plano: PlanoDoRelatorio; nomeDoPdf: string; total: number };

const hojeNaLoja = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

function Aviso({ titulo, children }: { titulo: string; children?: React.ReactNode }) {
  return (
    <Card className="p-8 text-center">
      <p className="font-display text-lg font-semibold">{titulo}</p>
      {children && <div className="mx-auto mt-1 max-w-xl text-sm text-muted-foreground">{children}</div>}
    </Card>
  );
}

export default function RelatorioDoMisterPage() {
  const [params, setParams] = useState<URLSearchParams | null>(null);
  const [dados, setDados] = useState<Resposta | null>(null);
  const [erro, setErro] = useState('');
  const [de, setDe] = useState('');
  const [ate, setAte] = useState('');
  const [abrindo, setAbrindo] = useState(false);
  const [erroDoPdf, setErroDoPdf] = useState('');

  const carregar = useCallback(async (p: URLSearchParams) => {
    setErro('');
    setDados(null);
    try {
      setDados((await api.get(`/mister/relatorio/insumo?${p.toString()}`)) as Resposta);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui abrir o relatório agora.');
    }
  }, []);

  useEffect(() => {
    if (!getToken()) return;
    const p = new URLSearchParams(window.location.search);
    setParams(p);
    setDe(p.get('de') ?? '');
    setAte(p.get('ate') ?? '');
    if (!NO_SERVIDOR_DA_LOJA) void carregar(p);
  }, [carregar]);

  function mudarPeriodo(e: React.FormEvent) {
    e.preventDefault();
    if (!params || !de) return;
    const p = new URLSearchParams(params);
    p.set('de', de);
    p.set('ate', ate && ate >= de ? ate : de);
    window.history.replaceState(null, '', `?${p.toString()}`);
    setParams(p);
    void carregar(p);
  }

  async function baixarPdf() {
    if (!params) return;
    setAbrindo(true);
    setErroDoPdf('');
    try {
      window.open(await api.misterRelatorioPdfUrl(params.toString()), '_blank');
    } catch (e) {
      setErroDoPdf(e instanceof Error ? e.message : 'Não consegui abrir o PDF agora.');
    } finally {
      setAbrindo(false);
    }
  }

  let corpo: React.ReactNode;
  if (NO_SERVIDOR_DA_LOJA) {
    corpo = <Aviso titulo="O relatório do Mister funciona pela nuvem">Abra este link no Regem na nuvem.</Aviso>;
  } else if (erro) {
    corpo = (
      <Aviso titulo="Não consegui abrir o relatório">
        <p>{erro}</p>
        {params && (
          <button type="button" className="mt-2 inline-flex min-h-11 items-center font-semibold underline" onClick={() => void carregar(params)}>
            Tentar de novo
          </button>
        )}
      </Aviso>
    );
  } else if (!dados) {
    corpo = <SkeletonList rows={3} />;
  } else {
    const p = dados.plano;
    const vazio = dados.total <= 0;
    corpo = (
      <div className="space-y-5">
        <section aria-labelledby="titulo-do-relatorio" className="space-y-1">
          <h2 id="titulo-do-relatorio" className="font-display text-xl font-bold [text-wrap:balance]">
            {p.titulo}
          </h2>
          <p className={`text-sm ${texto2}`}>
            {p.cabecalho} · {p.gerado}
          </p>
        </section>

        <form onSubmit={mudarPeriodo} className="flex flex-wrap items-end gap-3" aria-label="Mudar o período">
          <label className="flex flex-col gap-1 text-sm font-semibold">
            De
            <input type="date" className="min-h-11 rounded-md border border-input bg-card px-3 font-normal" value={de} max={hojeNaLoja()} onChange={(e) => setDe(e.target.value)} required />
          </label>
          <label className="flex flex-col gap-1 text-sm font-semibold">
            Até
            <input type="date" className="min-h-11 rounded-md border border-input bg-card px-3 font-normal" value={ate} min={de || undefined} max={hojeNaLoja()} onChange={(e) => setAte(e.target.value)} />
          </label>
          <Button type="submit" variant="outline">
            Mudar o período
          </Button>
          <Button type="button" onClick={() => void baixarPdf()} disabled={abrindo}>
            {abrindo ? 'Abrindo o PDF…' : 'Baixar PDF'}
          </Button>
        </form>
        {erroDoPdf && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
            {erroDoPdf}
          </p>
        )}

        <CorpoDoRelatorio plano={p} vazio={vazio} />
      </div>
    );
  }

  return (
    <Shell eyebrow="Mister" title="Relatório">
      {corpo}
    </Shell>
  );
}
