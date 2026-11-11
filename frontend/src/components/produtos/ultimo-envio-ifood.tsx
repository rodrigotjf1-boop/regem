'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O "ÚLTIMO ENVIO AO iFOOD" de um produto ou opção, por loja (R2b; mig 370). O servidor diz a situação já em palavras
// do lojista (sem detalhe técnico) e, no servidor da loja, traz o dado da nuvem; `semConexao` é "não deu para ler" —
// a tela diz isso em vez de "nenhum envio" (V37). Só a resposta da leitura mais nova vale (V64).

type Envio = {
  unidadeId: string;
  loja: string | null;
  oQue: 'preco' | 'pausa' | 'cadastro' | 'codigo';
  situacao: string;
  frase: string | null;
  antes: number | null;
  depois: number | null;
  quando: string;
};

const ACOMPANHAR_MS = 5_000;
const ACOMPANHAR_VEZES = 12;

const brl = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const O_QUE: Record<string, string> = { preco: 'preço', pausa: 'pausa', cadastro: 'nome e descrição', codigo: 'código' };
const SITUACAO: Record<string, { rotulo: string; cor: string }> = {
  na_fila: { rotulo: 'na fila', cor: 'text-muted-foreground' },
  enviando: { rotulo: 'enviando', cor: 'text-muted-foreground' },
  aplicado: { rotulo: 'aplicado no iFood', cor: 'text-ok' },
  sem_mudanca: { rotulo: 'já estava assim no iFood', cor: 'text-ok' },
  parcial: { rotulo: 'aplicado em parte', cor: 'text-foreground' },
  nao_encontrado: { rotulo: 'não existe no iFood desta loja', cor: 'text-destructive' },
  recusado: { rotulo: 'recusado pelo iFood', cor: 'text-destructive' },
  nao_enviado: { rotulo: 'não enviado', cor: 'text-muted-foreground' },
  desistiu: { rotulo: 'não enviado', cor: 'text-destructive' },
};

export function UltimoEnvioIfood({ alvo, id }: { alvo: 'produto' | 'opcao'; id: string }) {
  const [envios, setEnvios] = useState<Envio[] | null>(null);
  const [semConexao, setSemConexao] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const pedido = useRef(0);
  const voltas = useRef(0);

  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    setCarregando(true);
    try {
      const r = alvo === 'produto' ? await api.produtoIfoodEnvios(id) : await api.opcaoIfoodEnvios(id);
      if (meu !== pedido.current) return;
      setEnvios(Array.isArray(r?.envios) ? (r.envios as Envio[]) : []);
      setSemConexao(r?.semConexao === true);
    } catch {
      if (meu !== pedido.current) return;
      setEnvios([]);
      setSemConexao(true);
    } finally {
      if (meu === pedido.current) setCarregando(false);
    }
  }, [alvo, id]);

  useEffect(() => {
    voltas.current = 0;
    void carregar();
  }, [carregar]);

  // Enquanto algum envio está a caminho (na fila / enviando), o quadro relê sozinho a cada 5 s, por até 1 minuto — o
  // envio sai em segundos depois de salvar. O link "Conferir de novo" só relê o quadro; não envia nada ao iFood.
  useEffect(() => {
    if (!envios?.some((e) => e.situacao === 'na_fila' || e.situacao === 'enviando')) return;
    if (voltas.current >= ACOMPANHAR_VEZES) return;
    const t = setTimeout(() => {
      voltas.current += 1;
      void carregar();
    }, ACOMPANHAR_MS);
    return () => clearTimeout(t);
  }, [envios, carregar]);

  return (
    <div className="mt-3 rounded-lg border border-border p-2.5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold">Último envio ao iFood</p>
        <button
          type="button"
          onClick={() => {
            voltas.current = 0;
            void carregar();
          }}
          disabled={carregando}
          title="Lê de novo o resultado do envio (o envio ao iFood já sai sozinho quando você salva)"
          className="ml-auto text-[11px] font-medium text-primary hover:underline disabled:opacity-50"
        >
          {carregando ? 'Conferindo…' : 'Conferir de novo'}
        </button>
      </div>
      {envios === null ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Carregando…</p>
      ) : semConexao ? (
        <p className="mt-1 text-[11px] text-muted-foreground">
          Sem conexão com a nuvem agora: o resultado do envio aparece quando a conexão voltar.
        </p>
      ) : envios.length === 0 ? (
        <p className="mt-1 text-[11px] text-muted-foreground">Nenhum envio ao iFood ainda.</p>
      ) : (
        <ul className="mt-1 space-y-1.5">
          {envios.map((e) => {
            const s = SITUACAO[e.situacao] ?? { rotulo: e.situacao, cor: 'text-foreground' };
            return (
              <li key={`${e.unidadeId}-${e.oQue}`} className="min-w-0 text-[11px]">
                <p className="break-words">
                  <span className="font-medium">{e.loja ?? 'Loja'}</span>
                  <span className="text-muted-foreground"> · {O_QUE[e.oQue] ?? e.oQue}: </span>
                  <span className={`font-medium ${s.cor}`}>{s.rotulo}</span>
                  {e.antes != null && e.depois != null && (
                    <span className="text-muted-foreground">
                      {' '}
                      ({brl(e.antes)} → {brl(e.depois)})
                    </span>
                  )}
                  <span className="text-muted-foreground"> · {new Date(e.quando).toLocaleString('pt-BR')}</span>
                </p>
                {e.frase && <p className="break-words text-muted-foreground">{e.frase}</p>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
