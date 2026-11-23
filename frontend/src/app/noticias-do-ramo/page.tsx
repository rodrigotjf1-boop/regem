'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { hojeNaLoja } from '@/lib/hoje-na-loja';
import { Shell } from '@/components/app-shell/shell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FiltroBusca, Filtros, Situacoes, TituloLista, Vazio, texto2 } from '@/components/ui/lista';
import { BlocoDeNoticias } from '@/components/noticias-ramo/bloco-de-noticias';
import { IndicadoresDoRamo } from '@/components/noticias-ramo/indicadores-do-ramo';
import {
  diaPorExtenso,
  passaNaBusca,
  situacoesDoBoletim,
  todasAsNoticias,
  type NoticiaDoRamo,
  type RespostaDoBoletim,
} from '@/components/noticias-ramo/regras';

// RELATÓRIOS › NOTÍCIAS DO RAMO (fase N1; protótipo `mockups/regem-noticias-do-ramo.html`, versão 2, aprovado em 22/11/2026).
// O boletim diário do Pulso: os indicadores, os destaques de fonte oficial, as novidades e tendências do setor e o resto em
// lista. A permissão e o ramo são conferidos no servidor. O "Receber no WhatsApp" do protótipo entra com o relatório (N2).

function Aviso({ titulo, children, aoTentar }: { titulo: string; children?: React.ReactNode; aoTentar?: () => void }) {
  return (
    <Card role={aoTentar ? 'alert' : undefined} className="space-y-2 p-6 text-center sm:p-8">
      <h2 className="font-display text-lg font-bold">{titulo}</h2>
      {children && <p className={`text-sm ${texto2}`}>{children}</p>}
      {aoTentar && (
        <Button type="button" onClick={aoTentar}>
          Tentar de novo
        </Button>
      )}
    </Card>
  );
}

function CampoDoDia({ valor, min, max, aoMudar }: { valor: string; min?: string; max: string; aoMudar: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="noticias-dia">Dia</Label>
      <Input id="noticias-dia" type="date" className="w-auto" value={valor} min={min} max={max} onChange={(e) => e.target.value && aoMudar(e.target.value)} />
    </div>
  );
}

export default function NoticiasDoRamoPage() {
  const [dados, setDados] = useState<RespostaDoBoletim | null>(null);
  const [dia, setDia] = useState<string | null>(null);
  const [hoje, setHoje] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [situacao, setSituacao] = useState(-1);
  const [busca, setBusca] = useState('');
  const pedido = useRef(0);

  // Só a resposta da leitura mais nova vale (V64): trocar de dia depressa não mostra o boletim do dia anterior.
  const ler = useCallback(async (alvo: string | null) => {
    const este = ++pedido.current;
    setCarregando(true);
    setErro(null);
    try {
      const r = (await api.noticiasDoRamo(alvo ?? undefined)) as RespostaDoBoletim;
      if (este !== pedido.current) return;
      setDados(r);
      setSituacao(-1);
    } catch (e: unknown) {
      if (este !== pedido.current) return;
      setDados(null);
      setErro(e instanceof Error && e.message ? e.message : 'Tente de novo em instantes.');
    } finally {
      if (este === pedido.current) setCarregando(false);
    }
  }, []);

  useEffect(() => {
    setHoje(hojeNaLoja());
    void ler(null);
  }, [ler]);

  const mudarDia = (v: string) => {
    setDia(v);
    void ler(v);
  };
  const verMaisRecente = () => {
    setDia(null);
    void ler(null);
  };

  const boletim = dados?.boletim ?? null;
  const todas = useMemo(() => (boletim ? todasAsNoticias(boletim) : []), [boletim]);
  const achadasNaBusca = useMemo(() => todas.filter((n) => passaNaBusca(n, busca)), [todas, busca]);
  const opcoes = useMemo(() => situacoesDoBoletim(todas), [todas]);
  const passa = useCallback(
    (n: NoticiaDoRamo) => passaNaBusca(n, busca) && (situacao < 0 || !!opcoes[situacao]?.filtro(n)),
    [busca, situacao, opcoes],
  );
  const mostrando = todas.filter(passa).length;
  const limpar = () => {
    setSituacao(-1);
    setBusca('');
  };

  return (
    <Shell eyebrow="Relatórios" title="Notícias do ramo">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <p className={`max-w-prose text-sm ${texto2}`}>
          O que mudou em impostos, trabalho e custos, e as novidades e tendências do setor de bares e restaurantes. O boletim sai todo dia às 8h.
        </p>

        {carregando && (
          <div role="status" aria-label="Carregando o boletim" className="space-y-3">
            <div className="h-24 animate-pulse rounded-lg bg-secondary motion-reduce:animate-none" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
          </div>
        )}

        {!carregando && erro && (
          <Aviso titulo="Não consegui carregar o boletim." aoTentar={() => void ler(dia)}>
            {erro}
          </Aviso>
        )}

        {!carregando && !erro && dados?.semNuvem && (
          <Aviso titulo="Esta loja está sem internet." aoTentar={() => void ler(dia)}>
            O boletim vem da nuvem e volta quando a internet voltar. As vendas da loja continuam normalmente.
          </Aviso>
        )}

        {!carregando && !erro && dados && !dados.semNuvem && !dados.dias.length && (
          <Aviso titulo="Ainda não há boletim.">O próximo sai às 8h.</Aviso>
        )}

        {!carregando && !erro && dados && !dados.semNuvem && dados.dias.length > 0 && (
          <>
            {!boletim ? (
              <>
                <div className="flex justify-end">
                  <CampoDoDia valor={dia ?? ''} min={dados.dias[dados.dias.length - 1]} max={hoje} aoMudar={mudarDia} />
                </div>
                <Card className="space-y-3 p-6 text-center sm:p-8">
                  <h2 className="font-display text-lg font-bold">Não há boletim neste dia.</h2>
                  <Button type="button" variant="outline" onClick={verMaisRecente}>
                    Ver o mais recente
                  </Button>
                </Card>
              </>
            ) : (
              <>
                <TituloLista id="noticias-titulo" titulo={`Boletim de ${diaPorExtenso(boletim.dia)}`} total={todas.length} mostrando={mostrando} um="notícia" varios="notícias">
                  <CampoDoDia valor={dia ?? boletim.dia} min={dados.dias[dados.dias.length - 1]} max={hoje} aoMudar={mudarDia} />
                </TituloLista>

                <IndicadoresDoRamo itens={boletim.indicadores} />

                {boletim.mensagem && <Aviso titulo={boletim.mensagem}>O próximo boletim sai amanhã às 8h.</Aviso>}

                {todas.length > 0 && (
                  <>
                    <Situacoes base={achadasNaBusca} opcoes={opcoes} valor={situacao} aoMudar={setSituacao} />
                    <Filtros emLinha>
                      <FiltroBusca id="noticias-busca" valor={busca} aoMudar={setBusca} placeholder="Buscar no boletim" />
                    </Filtros>
                    {mostrando === 0 ? (
                      <Vazio aoLimpar={limpar} />
                    ) : (
                      <div className="space-y-4">
                        <BlocoDeNoticias titulo="Em destaque" itens={boletim.destaques.filter(passa)} numerar />
                        <BlocoDeNoticias titulo="Novidades e tendências" itens={boletim.novidades.filter(passa)} />
                        <BlocoDeNoticias titulo="Mais notícias" itens={boletim.mais.filter(passa)} />
                      </div>
                    )}
                    <p className={`max-w-prose text-xs ${texto2}`}>
                      De cada notícia vêm só o título, a fonte e o link: o texto completo fica no site de quem publicou. O que vem do Congresso leva o aviso até
                      virar lei. Isto não é orientação fiscal ou jurídica: na dúvida, fale com seu contador.
                    </p>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Shell>
  );
}
