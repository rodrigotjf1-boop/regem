'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Chave } from '@/components/ui/chave';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Dialogo } from '@/components/ui/sobreposto';
import { FiltroBusca, Filtros, Situacoes, Vazio, semAcento, texto2, type Situacao } from '@/components/ui/lista';
import { cn } from '@/lib/utils';

// Peças das telas de AJUSTE (mockup `mockups/regem-configuracoes.html`) — as telas de configuração que
// não são uma lista de registros (Loja, Produção & KDS…). O mesmo modelo das listas, adaptado:
//   título com a CONTAGEM ("18 ajustes em 4 grupos") e as alterações ainda não salvas;
//   situações com quantidade (ligados, desligados, em branco, alterados) que filtram;
//   "buscar ajuste"; os ajustes em grupos, cada grupo com a sua contagem;
//   UMA barra de "Salvar alterações" para a tela inteira, e a pergunta antes de sair com pendência.
// Quem usa guarda dois retratos dos valores — o da tela (`valores`) e o gravado (`salvos`); a
// diferença entre os dois é o que está pendente.

export type Valor = string | number | boolean;
export type Valores = Record<string, Valor>;
export type Ajuste = {
  /** Chave do valor em `valores` / `salvos`. */
  id: string;
  rotulo: string;
  ajuda?: React.ReactNode;
  tipo: 'texto' | 'area' | 'numero' | 'chave' | 'selecao' | 'livre';
  opcoes?: { v: string; rotulo: string }[];
  /** Unidade ao lado do campo ("min", "R$"). */
  sufixo?: string;
  /** Campo de texto que pode ficar vazio sem contar como "em branco". */
  opcional?: boolean;
  placeholder?: string;
  maximo?: number;
  entrada?: 'decimal' | 'numeric' | 'tel' | 'email';
  /** Ao sair do campo (ex.: CEP que preenche o endereço). */
  aoSair?: (valor: string) => void;
  /** `livre`: o controle é desenhado por quem usa (ex.: envio de imagem). */
  desenhar?: (valor: Valor, mudar: (v: Valor) => void) => React.ReactNode;
  /** Texto do item para a busca, além do rótulo. */
  palavras?: string;
};
export type GrupoDeAjustes = {
  titulo: string;
  nota?: React.ReactNode;
  itens: Ajuste[];
  /** Conteúdo próprio do grupo, depois dos ajustes (prévia, mapa, botões). */
  depois?: React.ReactNode;
};

const igual = (a: Valor | undefined, b: Valor | undefined) => (typeof a === 'boolean' || typeof b === 'boolean' ? !!a === !!b : String(a ?? '') === String(b ?? ''));
/** As chaves que mudaram em relação ao que está gravado. */
export function alterados(grupos: GrupoDeAjustes[], valores: Valores, salvos: Valores): string[] {
  return grupos.flatMap((g) => g.itens).filter((it) => !igual(valores[it.id], salvos[it.id])).map((it) => it.id);
}

export function Ajustes({
  id,
  titulo,
  grupos,
  valores,
  salvos,
  aoMudar,
  aoSalvar,
  aoDescartar,
  salvando = false,
  antes,
  erro,
}: {
  /** Prefixo dos ids (título em `${id}-titulo`, busca em `${id}-busca`). */
  id: string;
  titulo: string;
  grupos: GrupoDeAjustes[];
  valores: Valores;
  salvos: Valores;
  aoMudar: (chave: string, valor: Valor) => void;
  aoSalvar: () => void;
  aoDescartar: () => void;
  salvando?: boolean;
  /** Conteúdo entre o título e as situações (um aviso da tela). */
  antes?: React.ReactNode;
  /** Erro do último salvar, mostrado junto da barra. */
  erro?: string;
}) {
  const [busca, setBusca] = useState('');
  const [sit, setSit] = useState(-1);
  const todos = grupos.flatMap((g) => g.itens);
  const mudou = (it: Ajuste) => !igual(valores[it.id], salvos[it.id]);
  const pendentes = todos.filter(mudou).length;
  const saida = useSairSemSalvar(pendentes);

  const ehCampo = (it: Ajuste) => it.tipo === 'texto' || it.tipo === 'area' || it.tipo === 'numero';
  const situacoes: Situacao<Ajuste>[] = [
    ...(todos.some((it) => it.tipo === 'chave')
      ? [
          { rotulo: 'Ligados', filtro: (it: Ajuste) => it.tipo === 'chave' && !!valores[it.id] },
          { rotulo: 'Desligados', filtro: (it: Ajuste) => it.tipo === 'chave' && !valores[it.id] },
        ]
      : []),
    ...(todos.some((it) => ehCampo(it) && !it.opcional)
      ? [{ rotulo: 'Em branco', filtro: (it: Ajuste) => ehCampo(it) && !it.opcional && String(valores[it.id] ?? '').trim() === '', tom: 'aviso' as const }]
      : []),
    { rotulo: 'Alterados, sem salvar', filtro: mudou, tom: 'aviso' as const },
  ];
  const b = semAcento(busca);
  const casa = (it: Ajuste) => !b || semAcento(`${it.rotulo} ${it.palavras ?? ''} ${typeof it.ajuda === 'string' ? it.ajuda : ''}`).includes(b);
  const base = todos.filter(casa);
  const visiveis = new Set((sit < 0 ? base : base.filter(situacoes[sit].filtro)).map((it) => it.id));
  const limpar = () => { setBusca(''); setSit(-1); };
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

  return (
    <section className="space-y-3" aria-labelledby={`${id}-titulo`}>
      <div>
        <h2 id={`${id}-titulo`} tabIndex={-1} className="font-display text-xl font-bold outline-none">{titulo}</h2>
        <p className={`text-sm ${texto2}`} role="status" aria-live="polite">
          {visiveis.size === todos.length ? plural(todos.length, 'ajuste', 'ajustes') : `${visiveis.size} de ${plural(todos.length, 'ajuste', 'ajustes')}`} em {plural(grupos.length, 'grupo', 'grupos')}
          {pendentes > 0 && ` · ${plural(pendentes, 'alteração ainda não salva', 'alterações ainda não salvas')}`}
        </p>
      </div>
      {antes}
      <Situacoes base={base} opcoes={situacoes} valor={sit} aoMudar={setSit} />
      <Filtros>
        <FiltroBusca id={`${id}-busca`} valor={busca} aoMudar={setBusca} placeholder="Digite parte do nome do ajuste" />
      </Filtros>

      {visiveis.size === 0 ? (
        <Vazio aoLimpar={limpar} />
      ) : (
        grupos.map((g) => {
          const itens = g.itens.filter((it) => visiveis.has(it.id));
          if (!itens.length) return null;
          const chaves = g.itens.filter((it) => it.tipo === 'chave');
          return (
            <Card key={g.titulo} className="overflow-hidden p-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-3">
                <h3 className="font-display text-base font-bold">{g.titulo}</h3>
                <span className={`text-xs ${texto2}`}>
                  {chaves.length ? `${chaves.filter((it) => !!valores[it.id]).length} de ${chaves.length} ligados` : plural(g.itens.length, 'ajuste', 'ajustes')}
                </span>
              </div>
              {g.nota && <p className={`border-b border-border px-4 py-2.5 text-xs ${texto2}`}>{g.nota}</p>}
              {itens.map((it) => (
                <LinhaDeAjuste key={it.id} idTela={id} ajuste={it} valor={valores[it.id]} mudou={mudou(it)} aoMudar={(v) => aoMudar(it.id, v)} />
              ))}
              {g.depois && <div className="px-4 py-3">{g.depois}</div>}
            </Card>
          );
        })
      )}

      {pendentes > 0 && (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-foreground px-4 py-3 text-background shadow-lg">
          <span className="text-sm font-bold" role="status">
            {plural(pendentes, 'alteração ainda não salva', 'alterações ainda não salvas')}
            {erro && <span className="block font-medium" role="alert">Não foi possível salvar: {erro}</span>}
          </span>
          <span className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" className="border-background/50 bg-transparent text-background hover:bg-background/10 hover:text-background" onClick={aoDescartar} disabled={salvando}>
              Descartar
            </Button>
            <Button type="button" onClick={aoSalvar} disabled={salvando}>{salvando ? 'Salvando…' : 'Salvar alterações'}</Button>
          </span>
        </div>
      )}

      {saida.destino && (
        <Dialogo alerta titulo="Sair sem salvar?" aoFechar={saida.ficar}
          rodape={
            <>
              <Button type="button" variant="outline" data-foco-inicial onClick={saida.ficar}>Continuar editando</Button>
              <Button type="button" variant="destructive" onClick={saida.sair}>Sair sem salvar</Button>
            </>
          }>
          <p className="text-sm">
            Há <b>{plural(pendentes, 'alteração', 'alterações')}</b> nesta tela que ainda não {pendentes === 1 ? 'foi salva' : 'foram salvas'}. Se sair agora, {pendentes === 1 ? 'ela se perde' : 'elas se perdem'}.
          </p>
        </Dialogo>
      )}
    </section>
  );
}

function LinhaDeAjuste({ idTela, ajuste: it, valor, mudou, aoMudar }: { idTela: string; ajuste: Ajuste; valor: Valor | undefined; mudou: boolean; aoMudar: (v: Valor) => void }) {
  const idCampo = `${idTela}-${it.id}`;
  const idRotulo = `${idCampo}-rotulo`;
  const texto = String(valor ?? '');
  const campo = 'min-w-0 flex-1';
  return (
    <div className={cn('grid grid-cols-1 items-center gap-x-4 gap-y-1.5 border-b border-border px-4 py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]', it.tipo === 'area' && 'md:grid-cols-1', mudou && 'bg-primary/10 shadow-[inset_3px_0_0_hsl(var(--primary))]')}>
      <div className="min-w-0">
        {it.tipo === 'chave' || it.tipo === 'livre' ? (
          <span id={idRotulo} className="text-sm font-semibold">{it.rotulo}</span>
        ) : (
          <label id={idRotulo} htmlFor={idCampo} className="text-sm font-semibold">{it.rotulo}</label>
        )}
        {mudou && <span className="sr-only"> (alterado, ainda não salvo)</span>}
        {it.ajuda && <span className={`block text-xs ${texto2}`}>{it.ajuda}</span>}
      </div>
      <div className={cn('flex min-w-0 items-center gap-2', it.tipo === 'chave' && 'md:justify-end')}>
        {it.tipo === 'chave' && <Chave id={idCampo} ligada={!!valor} rotulo={it.rotulo} aoMudar={aoMudar} />}
        {it.tipo === 'selecao' && (
          <Select id={idCampo} className={campo} value={texto} onChange={(e) => aoMudar(e.target.value)}>
            {(it.opcoes ?? []).map((o) => <option key={o.v} value={o.v}>{o.rotulo}</option>)}
          </Select>
        )}
        {(it.tipo === 'texto' || it.tipo === 'numero') && (
          <Input
            id={idCampo}
            className={campo}
            type={it.tipo === 'numero' ? 'number' : 'text'}
            min={it.tipo === 'numero' ? 0 : undefined}
            inputMode={it.tipo === 'numero' ? 'decimal' : it.entrada}
            value={texto}
            maxLength={it.maximo}
            placeholder={it.placeholder}
            autoComplete="off"
            onChange={(e) => aoMudar(e.target.value)}
            onBlur={it.aoSair ? (e) => it.aoSair!(e.target.value) : undefined}
          />
        )}
        {it.tipo === 'area' && (
          <textarea
            id={idCampo}
            rows={3}
            value={texto}
            placeholder={it.placeholder}
            onChange={(e) => aoMudar(e.target.value)}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
        {it.tipo === 'livre' && <div className="min-w-0 flex-1" role="group" aria-labelledby={idRotulo}>{it.desenhar?.(valor ?? '', aoMudar)}</div>}
        {it.sufixo && <span className={`flex-none text-sm ${texto2}`}>{it.sufixo}</span>}
      </div>
    </div>
  );
}

// Com alteração pendente: fechar ou recarregar a aba pede a confirmação do navegador (não há como
// trocar essa), e clicar num link do aplicativo abre o diálogo "Sair sem salvar?".
function useSairSemSalvar(pendentes: number) {
  const router = useRouter();
  const [destino, setDestino] = useState<string | null>(null);
  useEffect(() => {
    if (!pendentes) return;
    const aoFecharAba = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    // Na captura, antes do roteador: o link só segue se a pessoa confirmar.
    const aoClicar = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      e.preventDefault();
      e.stopPropagation();
      setDestino(url.pathname + url.search + url.hash);
    };
    window.addEventListener('beforeunload', aoFecharAba);
    document.addEventListener('click', aoClicar, true);
    return () => {
      window.removeEventListener('beforeunload', aoFecharAba);
      document.removeEventListener('click', aoClicar, true);
    };
  }, [pendentes]);
  return {
    destino,
    ficar: () => setDestino(null),
    sair: () => {
      const d = destino;
      setDestino(null);
      if (d) router.push(d);
    },
  };
}
