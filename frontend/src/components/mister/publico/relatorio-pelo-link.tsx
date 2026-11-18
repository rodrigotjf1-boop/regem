'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RegemMark } from '@/components/brand/regem-mark';
import { CorpoDoRelatorio } from '@/components/mister/corpo-do-relatorio';
import { api } from '@/lib/api';
import { baixarBlob, type VistaDoRelatorioPublico } from '@/lib/mister-relatorio';

// A PÁGINA DO LINK PARA ENCAMINHAR DO MISTER (M3c, mig 443; versão 3 do protótipo `mockups/regem-mister.html`, aba
// "Arquivos e links" › "A página do link" e a decisão 7: para quem não tem usuário — a contabilidade, um sócio —, só
// leitura, 7 dias). Isolada (sem o menu do Regem), sem login e sem guardar nada no aparelho. Mostra a FOTO do relatório
// que o presidente pediu: o mesmo desenho da página logada, sem "Mudar o período" (não lê dado vivo da loja).

type Leitura = { tipo: 'carregando' } | { tipo: 'naoVale' } | { tipo: 'erro'; texto: string } | { tipo: 'ok'; v: VistaDoRelatorioPublico };

const statusDe = (e: unknown) => (e && typeof e === 'object' && 'status' in e ? Number((e as { status: unknown }).status) : 0);
const MUITAS = 'Muitas aberturas agora. Espere um minuto e tente de novo.';
/** A frase da falha: o limite por minuto nunca sai cru, e a falha de rede diz o que conferir. */
const fraseDaFalha = (e: unknown, padrao: string) => (statusDe(e) === 429 ? MUITAS : statusDe(e) && e instanceof Error && e.message ? e.message : padrao);

export function RelatorioPeloLink({ codigo }: { codigo: string }) {
  const [l, setL] = useState<Leitura>({ tipo: 'carregando' });
  const [baixando, setBaixando] = useState(false);
  const [erroDoPdf, setErroDoPdf] = useState('');
  const vez = useRef(0);

  // Só a resposta da leitura mais nova vale (V64): o "Tentar de novo" pode cruzar com a primeira leitura.
  const ler = useCallback(async () => {
    const n = ++vez.current;
    setL({ tipo: 'carregando' });
    try {
      const v = await api.misterRelatorioPublico(codigo);
      if (n === vez.current) setL({ tipo: 'ok', v });
    } catch (e) {
      if (n !== vez.current) return;
      setL(statusDe(e) === 404 ? { tipo: 'naoVale' } : { tipo: 'erro', texto: fraseDaFalha(e, 'Não consegui falar com o Regem. Confira a internet e tente de novo.') });
    }
  }, [codigo]);

  useEffect(() => {
    void ler();
  }, [ler]);

  async function baixarPdf(v: VistaDoRelatorioPublico) {
    if (baixando) return;
    setBaixando(true);
    setErroDoPdf('');
    try {
      baixarBlob(await api.misterRelatorioPublicoPdf(codigo), v.nomeDoPdf);
    } catch (e) {
      // O link deixou de valer com a página aberta: a página passa a dizer isso.
      if (statusDe(e) === 404) setL({ tipo: 'naoVale' });
      else setErroDoPdf(fraseDaFalha(e, 'Não consegui baixar o PDF agora. Confira a internet e tente de novo.'));
    } finally {
      setBaixando(false);
    }
  }

  const v = l.tipo === 'ok' ? l.v : null;

  return (
    <div className="app-light min-h-screen bg-background font-sans text-foreground">
      <header className="bg-foreground text-card">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <RegemMark className="h-8 w-8 flex-none" />
          <div className="min-w-0">
            <p className="font-display text-base font-bold">Mister</p>
            <p className="break-words text-xs text-card/80">Relatório do Regem{v?.empresa ? ` · ${v.empresa}` : ''}</p>
          </div>
        </div>
      </header>

      {/* `grid-cols-1` (a coluna não cresce com o conteúdo): o gráfico de muitas barras encolhe, não empurra a página. */}
      <main className="mx-auto grid max-w-3xl grid-cols-1 gap-4 px-4 py-4" data-relatorio-do-mister data-estado={l.tipo}>
        {l.tipo === 'carregando' && (
          <p className="rounded-xl border border-border bg-card p-4 text-sm" role="status">
            Abrindo o relatório…
          </p>
        )}

        {l.tipo === 'naoVale' && (
          <section className="grid gap-1.5 rounded-xl border border-border bg-card p-4 text-sm" role="status" aria-labelledby="relatorio-estado">
            <h1 id="relatorio-estado" className="break-words font-display text-lg font-bold">
              Este link não vale mais
            </h1>
            <p>O link de um relatório vale por 7 dias e pode ser cancelado por quem mandou.</p>
            <p className="text-foreground/75">Se ainda precisar do relatório, peça outro link a quem mandou este.</p>
          </section>
        )}

        {l.tipo === 'erro' && (
          <section className="grid gap-1.5 rounded-xl border border-destructive/50 bg-destructive/10 p-4 text-sm" role="alert" aria-labelledby="relatorio-estado">
            <h1 id="relatorio-estado" className="break-words font-display text-lg font-bold">
              Não consegui abrir o relatório
            </h1>
            <p className="break-words">{l.texto}</p>
            <div>
              <button type="button" className="mt-1 min-h-11 rounded-lg border border-border bg-card px-4 font-semibold" onClick={() => void ler()}>
                Tentar de novo
              </button>
            </div>
          </section>
        )}

        {v && (
          <>
            <section aria-labelledby="titulo-do-relatorio" className="min-w-0 space-y-1">
              <h1 id="titulo-do-relatorio" className="break-words font-display text-xl font-bold [text-wrap:balance]">
                {v.plano.titulo}
              </h1>
              <p className="break-words text-sm text-foreground/75">
                {v.plano.cabecalho} · {v.plano.gerado}
              </p>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/50 bg-primary/10 px-4 py-3">
              <p className="min-w-0 text-sm" role="status">
                <b>Só leitura</b> · vale até <b className="font-mono">{v.valeAteDia}</b>. Mostra o relatório como estava quando foi pedido: ele não atualiza.
              </p>
              <button
                type="button"
                className="min-h-11 flex-none rounded-lg bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-60"
                disabled={baixando}
                onClick={() => void baixarPdf(v)}
              >
                {baixando ? 'Baixando o PDF…' : 'Baixar PDF'}
              </button>
            </div>
            {erroDoPdf && (
              <p role="alert" className="break-words rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
                {erroDoPdf}
              </p>
            )}

            <CorpoDoRelatorio plano={v.plano} vazio={!v.comVenda} nivel={2} />
          </>
        )}

        <p className="px-1 text-center text-xs text-foreground/75">Esta página é só deste relatório. Nada fica guardado neste aparelho.</p>
      </main>
    </div>
  );
}
