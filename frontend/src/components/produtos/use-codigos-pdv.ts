'use client';

import { useCallback, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import { toast } from '@/lib/toast';

// "Mostrar código PDV" em Cadastros › Cardápio: o rascunho fica na página, então vale nas três abas (a mesma opção aparece
// em Opções e em cada etapa de Complementos) e nada vai ao servidor até "Salvar códigos".
export type TipoDoCodigo = 'produto' | 'opcao';
export type AlvoDoCodigo = { tipo: TipoDoCodigo; id: string; nome: string; de: string | null };
export type RascunhoDoCodigo = AlvoDoCodigo & { para: string };
export type RecusaDoCodigo = { tipo: TipoDoCodigo; id: string; motivo: string };

const chaveDe = (a: { tipo: TipoDoCodigo; id: string }) => `${a.tipo}:${a.id}`;
const limpo = (v: string | null | undefined) => (v ?? '').trim();

export function useCodigosPdv(aoSalvar: () => Promise<unknown> | void) {
  const [ligado, setLigado] = useState(false);
  const [rascunho, setRascunho] = useState<Record<string, RascunhoDoCodigo>>({});
  const [recusas, setRecusas] = useState<Record<string, string>>({});
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  // Sobe a cada gravação: as abas de Opções e Complementos releem a lista delas.
  const [versao, setVersao] = useState(0);

  const pendentes = useMemo(() => Object.values(rascunho), [rascunho]);

  const valor = useCallback((a: AlvoDoCodigo) => rascunho[chaveDe(a)]?.para ?? a.de ?? '', [rascunho]);
  const mudou = useCallback((a: AlvoDoCodigo) => !!rascunho[chaveDe(a)], [rascunho]);
  const recusa = useCallback((a: AlvoDoCodigo) => recusas[chaveDe(a)] ?? '', [recusas]);

  const mudar = useCallback((a: AlvoDoCodigo, texto: string) => {
    const k = chaveDe(a);
    setRascunho((s) => {
      const n = { ...s };
      if (limpo(texto) === limpo(a.de)) delete n[k];
      else n[k] = { ...a, para: texto };
      return n;
    });
    setRecusas((s) => {
      if (!(k in s)) return s;
      const n = { ...s };
      delete n[k];
      return n;
    });
    setErro('');
  }, []);

  const descartar = useCallback(() => {
    setRascunho({});
    setRecusas({});
    setErro('');
  }, []);

  const salvar = useCallback(async () => {
    const itens = Object.values(rascunho);
    if (!itens.length) return true;
    setSalvando(true);
    setErro('');
    try {
      const r: any = await api.trocarCodigosPdv(
        itens.map((i) => ({ tipo: i.tipo, id: i.id, de: limpo(i.de) || null, para: limpo(i.para) || null })),
      );
      setRascunho({});
      setRecusas({});
      setVersao((v) => v + 1);
      await aoSalvar();
      const n = r?.alterados ?? itens.length;
      toast.success(n === 1 ? 'Código PDV salvo.' : `${n} códigos PDV salvos.`);
      return true;
    } catch (e) {
      const lista = e instanceof ApiError ? ((e.details as { recusas?: RecusaDoCodigo[] } | undefined)?.recusas ?? []) : [];
      setRecusas(Object.fromEntries(lista.map((x) => [chaveDe(x), x.motivo])));
      setErro(e instanceof Error ? e.message : 'Não foi possível salvar os códigos.');
      return false;
    } finally {
      setSalvando(false);
    }
  }, [rascunho, aoSalvar]);

  // As recusas com o nome do item: a linha pode estar em outra aba ou fora da categoria aberta.
  const recusasComNome = useMemo(
    () =>
      Object.entries(recusas).map(([k, motivo]) => ({ chave: k, nome: rascunho[k]?.nome ?? 'Item', motivo })),
    [recusas, rascunho],
  );

  return { ligado, setLigado, versao, pendentes, valor, mudou, recusa, mudar, descartar, salvar, salvando, erro, recusasComNome };
}

export type CodigosPdv = ReturnType<typeof useCodigosPdv>;
