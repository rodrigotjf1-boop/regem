'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { api, getCategoria, type LinhaIntegracao, type SituacaoIntegracoes } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';

// "PUBLICAR NAS INTEGRAÇÕES" (Cadastros › Cardápio — pedido do dono de 06/11/2026; substitui o "Publicar no GoGeM" de
// Configurações › Equipamentos). O botão só aparece para a gestão e quando alguma integração usa o cardápio desta loja;
// o ponto vermelho diz que há envio a caminho ou com problema. A janela mostra o que cada integração recebe — o servidor
// já manda a frase em palavras do lojista — e o "Publicar agora" (GoGeM na hora; quem lê pela porta lê de novo; o iFood
// já vai sozinho). Só a resposta da leitura mais nova vale (V64).

const GESTAO = ['presidente', 'gerente', 'supervisao', 'suporte'];

const PONTO: Record<LinhaIntegracao['tom'], string> = {
  ok: 'bg-ok',
  atencao: 'bg-primary',
  problema: 'bg-destructive',
  neutro: 'bg-muted-foreground',
};
const ROTULO_DO_TOM: Record<LinhaIntegracao['tom'], string> = {
  ok: 'em dia',
  atencao: 'a caminho',
  problema: 'com problema',
  neutro: 'sem pendência',
};

const motivo = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);

export function PublicarIntegracoes() {
  const [pode, setPode] = useState(false);
  const [sit, setSit] = useState<SituacaoIntegracoes | null>(null);
  const [aberto, setAberto] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [publicando, setPublicando] = useState(false);
  const [resumo, setResumo] = useState<string | null>(null);
  const pedido = useRef(0);

  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    setLendo(true);
    try {
      const r = await api.integracoesDoCardapio();
      if (meu !== pedido.current) return;
      setSit(r && Array.isArray(r.linhas) ? r : null);
      setErro(null);
    } catch (e) {
      if (meu !== pedido.current) return;
      setErro(motivo(e, 'Não deu para ler as integrações agora.'));
    } finally {
      if (meu === pedido.current) setLendo(false);
    }
  }, []);

  // O perfil vem da sessão do navegador: fora do primeiro render (V35).
  useEffect(() => {
    const gestao = GESTAO.includes(getCategoria() ?? '');
    setPode(gestao);
    if (gestao) void carregar();
  }, [carregar]);

  if (!pode || !sit || sit.linhas.length === 0) return null;

  const atencao = sit.linhas.some((l) => l.tom === 'atencao' || l.tom === 'problema');

  function abrir() {
    setResumo(null);
    setAberto(true);
    void carregar();
  }

  async function publicar() {
    if (publicando) return;
    setPublicando(true);
    // Uma leitura que estava em curso não sobrescreve o resultado do publicar.
    ++pedido.current;
    try {
      const r = await api.publicarNasIntegracoes();
      setSit({ linhas: r.linhas, podePublicar: r.podePublicar, semConexao: r.semConexao });
      setResumo(r.resumo);
      setErro(null);
      if (r.linhas.some((l) => l.modo === 'ao_publicar' && l.tom === 'problema')) toast.error(r.resumo);
      else toast.success(r.resumo);
    } catch (e) {
      toast.error(motivo(e, 'Não foi possível publicar agora.'));
    } finally {
      setPublicando(false);
      setLendo(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        onClick={abrir}
        aria-haspopup="dialog"
        className="relative gap-2 font-bold shadow-sm"
        title={atencao ? 'Há envio a caminho ou com problema' : undefined}
      >
        <Send className="h-4 w-4" aria-hidden />
        Publicar nas integrações
        {atencao && (
          <>
            <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-destructive ring-2 ring-card" aria-hidden />
            <span className="sr-only">(há envio a caminho ou com problema)</span>
          </>
        )}
      </Button>

      {aberto && (
        <Dialogo
          titulo="Publicar nas integrações"
          aoFechar={() => setAberto(false)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setAberto(false)}>
                Fechar
              </Button>
              {sit.podePublicar && (
                <Button type="button" onClick={() => void publicar()} disabled={publicando} data-foco-inicial>
                  {publicando ? 'Publicando…' : 'Publicar agora'}
                </Button>
              )}
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            O que cada integração recebe do cardápio. Preço, nome, pausa e fichas mudam no Regem; aqui você confere se chegaram.
          </p>
          {erro && (
            <p role="alert" className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
              {erro}
            </p>
          )}
          {resumo && (
            <p role="status" className="mt-3 rounded-md border border-border bg-secondary px-3 py-2 text-sm font-semibold">
              {resumo}
            </p>
          )}
          <ul className="mt-3 space-y-2" aria-busy={lendo}>
            {sit.linhas.map((l) => (
              <li key={l.chave} className="min-w-0 rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`h-2.5 w-2.5 flex-none rounded-full ${PONTO[l.tom]}`} aria-hidden />
                  <span className="font-display text-sm font-bold">{l.rotulo}</span>
                  <span className="sr-only">— {ROTULO_DO_TOM[l.tom]}</span>
                  <span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    {l.modo === 'automatico' ? 'Automático' : 'Ao publicar'}
                  </span>
                </div>
                <p className="mt-1 break-words text-sm">{l.frase}</p>
                {!!l.detalhes?.length && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                    {l.detalhes.map((d) => (
                      <li key={d} className="break-words">
                        {d}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
          {!sit.podePublicar && (
            <p className="mt-3 text-sm text-muted-foreground">Tudo aqui vai sozinho: não há o que publicar à mão.</p>
          )}
        </Dialogo>
      )}
    </>
  );
}
