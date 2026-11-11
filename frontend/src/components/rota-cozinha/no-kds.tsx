'use client';

import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Selo, texto2 } from '@/components/ui/lista';
import { cn } from '@/lib/utils';
import { IMPRIME_QUANDO, ehDespacho, naRota, proximoDeVerdade, recebeDe, type Etapa, type KdsDaRota } from '@/lib/rota-cozinha';

/** O que o KDS faz quando o pedido fica pronto, pelo cadastro de verdade (o desligado no meio é pulado). */
export function vaiParaTexto(k: KdsDaRota, kds: KdsDaRota[]): string {
  if (ehDespacho(k)) return 'Termina aqui · chama a senha na TV';
  const prox = k.proximoKdsId ? kds.find((x) => x.id === k.proximoKdsId) : undefined;
  if (!prox) return 'Termina aqui';
  if (prox.ativo) return `Vai para ${prox.nome}`;
  const depois = proximoDeVerdade(kds, k.id);
  const nome = depois ? kds.find((x) => x.id === depois)?.nome : null;
  return `Vai para ${prox.nome} (desligado: ${nome ? `passa direto para ${nome}` : 'termina aqui'})`;
}

/** Um KDS na rota (modo de ver): o tipo, de quem recebe, os produtos, para onde vai e se imprime ao avançar. */
export function NoKds({
  k,
  kds,
  etapas,
  estacoes,
  aoEditar,
}: {
  k: KdsDaRota;
  kds: KdsDaRota[];
  etapas: Etapa[];
  estacoes: boolean;
  aoEditar?: (k: KdsDaRota) => void;
}) {
  const desp = ehDespacho(k);
  const de = recebeDe(kds, k.id).map((x) => x.nome);
  const n = k.produtos ?? 0;
  const produtos = n
    ? `${n} produto${n === 1 ? '' : 's'} marcado${n === 1 ? '' : 's'}`
    : !estacoes
      ? 'Todos os produtos (nenhum KDS marcou produto: a loja está no modo comum)'
      : de.length
        ? `Nenhum produto marcado: só o que chega de ${de.join(' e ')}`
        : 'Nenhum produto marcado';
  const imprime = k.imprimeAoAvancar
    ? `Sim, ${IMPRIME_QUANDO[k.imprimeNoStatus ?? 'pronto'] ?? 'ao avançar'}, na ${k.impressora ?? 'impressora escolhida'}`
    : 'Não, só avança';
  return (
    <article
      aria-label={`${k.nome}, ${desp ? 'despacho' : 'estação de preparo'}`}
      className={cn(
        'grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2 rounded-xl border bg-card p-3',
        desp && 'border-primary shadow-[inset_0_0_0_1px_hsl(var(--primary))]',
        !k.ativo && 'border-dashed bg-secondary',
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="min-w-0">
          <span className={`block text-xs font-extrabold uppercase tracking-wider ${texto2}`}>KDS · {desp ? 'despacho' : 'estação de preparo'}</span>
          <h4 className="font-display text-lg font-extrabold leading-tight [overflow-wrap:anywhere]">{k.nome}</h4>
        </div>
        {k.ativo ? <Selo tom="ok">Ligado</Selo> : <Selo tom="aviso">Desligado · é pulado</Selo>}
      </header>
      <dl className="grid gap-1.5 text-sm">
        {de.length > 0 && (
          <div>
            <dt className={`text-xs font-extrabold ${texto2}`}>Recebe de</dt>
            <dd className="[overflow-wrap:anywhere]">{de.join(' e ')}</dd>
          </div>
        )}
        <div>
          <dt className={`text-xs font-extrabold ${texto2}`}>{desp ? 'Vê' : 'Produtos que recebe'}</dt>
          <dd className="[overflow-wrap:anywhere]">
            {desp ? `O pedido inteiro, com o andamento de cada estação. Direto para cá: ${produtos.charAt(0).toLowerCase()}${produtos.slice(1)}` : produtos}
          </dd>
        </div>
        <div>
          <dt className={`text-xs font-extrabold ${texto2}`}>{desp ? 'Ao despachar' : 'Quando ficar pronto'}</dt>
          <dd className="[overflow-wrap:anywhere]">
            {vaiParaTexto(k, kds)}
            {!naRota(etapas, k.id) && !desp && <span className={texto2}> · fora da rota</span>}
          </dd>
        </div>
        <div>
          <dt className={`text-xs font-extrabold ${texto2}`}>Imprimir ao avançar</dt>
          <dd className="[overflow-wrap:anywhere]">{imprime}</dd>
        </div>
      </dl>
      {aoEditar && (
        <Button type="button" variant="outline" size="sm" className="justify-self-start h-auto min-h-11 whitespace-normal text-left [overflow-wrap:anywhere]" onClick={() => aoEditar(k)}>
          <Pencil className="h-4 w-4" aria-hidden="true" /> Editar {k.nome}
        </Button>
      )}
    </article>
  );
}

/** A TV de senhas: não é etapa; fica sempre no fim e acompanha os KDS sozinha. */
export function NoTv({ tvs, editando }: { tvs: { id: string; nome: string }[]; editando: boolean }) {
  return (
    <article aria-label="TV de senhas" className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-2 rounded-xl border border-dashed bg-card p-3">
      <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <div className="min-w-0">
          <span className={`block text-xs font-extrabold uppercase tracking-wider ${texto2}`}>TV de senhas · não é etapa</span>
          <h4 className="font-display text-lg font-extrabold leading-tight [overflow-wrap:anywhere]">
            {tvs.length ? tvs.map((t) => t.nome).join(', ') : 'Nenhuma TV ligada'}
          </h4>
        </div>
        {tvs.length > 0 && <Selo tom="ok">Ligada</Selo>}
      </header>
      <dl className="grid gap-1.5 text-sm">
        <div>
          <dt className={`text-xs font-extrabold ${texto2}`}>Mostra</dt>
          <dd>
            <b>Preparando</b> enquanto algum KDS tem o pedido; <b>Pronto</b> quando nenhum tem.
          </dd>
        </div>
        <div>
          <dt className={`text-xs font-extrabold ${texto2}`}>{editando ? 'Fica sempre no fim' : 'Não é um "vai para"'}</dt>
          <dd>{editando ? 'Não se move: ela acompanha a rota sozinha.' : 'Ela acompanha os KDS sozinha: não aparece na lista de destinos.'}</dd>
        </div>
      </dl>
    </article>
  );
}
