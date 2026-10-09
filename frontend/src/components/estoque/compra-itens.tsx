'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialogo } from '@/components/ui/sobreposto';
import { Selo, brl, dataBr, num, texto2 } from '@/components/ui/lista';
import { nomeDeApoio, nomeDeCompra, quantoFaltou, textoDaMarcaPedida } from '@/lib/produto-compra';

/* eslint-disable @typescript-eslint/no-explicit-any */
const recebida = (l: any) => l.status === 'recebida';
/** Os itens da lista recebida que vieram a menos (uma parte, ou nada), com o quanto faltou. */
export function itensQueFaltaram(lista: any): { item: any; faltou: number }[] {
  if (!recebida(lista)) return [];
  return (lista.itens ?? [])
    .map((item: any) => ({ item, faltou: item.qtdRecebida != null ? quantoFaltou(item.quantidade, item.qtdRecebida) : 0 }))
    .filter((x: { faltou: number }) => x.faltou > 0);
}

// Título da coluna antes do valor: só aparece quando a tabela está empilhada (abaixo de 640 px).
function RotuloNaLinha({ children }: { children: React.ReactNode }) {
  return <><span className={`font-sans text-xs font-bold sm:hidden ${texto2}`}>{children}:</span>{' '}</>;
}

// Ver os itens de uma lista de compras: o que foi pedido (com a marca e a 2ª opção) e, depois de
// recebida, o que chegou — com a FALTA de cada item à vista e o atalho para pedir de novo.
export function VerItensDaCompra({ lista, verFin, podeGerar, aoFechar, aoGerar }: { lista: any; verFin: boolean; podeGerar: boolean; aoFechar: () => void; aoGerar: () => void }) {
  const itens: any[] = lista.itens ?? [];
  const foiRecebida = recebida(lista);
  const faltas = itensQueFaltaram(lista);
  return (
    <Dialogo largura="lg" titulo={`${lista.nome} · ${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`} aoFechar={aoFechar}
      rodape={
        <>
          {faltas.length > 0 && !lista.listaDoQueFaltou && podeGerar && (
            <Button type="button" variant="outline" className="mr-auto" onClick={aoGerar}>Gerar lista com o que faltou</Button>
          )}
          <Button type="button" data-foco-inicial onClick={aoFechar}>Fechar</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        {lista.origem && <p className={texto2}>Lista gerada com o que faltou de <b className="text-foreground">{lista.origem.nome}</b>.</p>}
        {faltas.length > 0 && (
          <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2" role="status">
            <b>{faltas.length} {faltas.length === 1 ? 'item veio' : 'itens vieram'} a menos do que o pedido.</b>{' '}
            {lista.listaDoQueFaltou ? <>A lista do que faltou já foi gerada: <b>{lista.listaDoQueFaltou.nome}</b>.</> : 'Só o que chegou entrou no estoque.'}
          </p>
        )}
        <div className="overflow-x-auto rounded-lg border border-border">
          {/* Abaixo de 640 px cada item vira um bloco, com o título da coluna antes do valor. */}
          <table className="block w-full border-collapse sm:table sm:min-w-[520px]">
            <caption className="sr-only">Itens da lista de compras</caption>
            <thead className="hidden sm:table-header-group">
              <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                <th scope="col" className="px-3 py-2">Produto</th>
                <th scope="col" className="px-3 py-2">Pedido</th>
                {foiRecebida && <th scope="col" className="px-3 py-2">Recebido</th>}
                {verFin && <th scope="col" className="px-3 py-2">Custo unitário</th>}
                {foiRecebida && <th scope="col" className="px-3 py-2">Validade · lote</th>}
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {itens.map((it) => {
                const conferido = it.qtdRecebida != null;
                const rec = Number(it.qtdRecebida);
                const faltou = conferido ? quantoFaltou(it.quantidade, rec) : 0;
                const pedido = textoDaMarcaPedida(it);
                return (
                  <tr key={it.id} className="block space-y-1 border-b border-border p-3 last:border-b-0 sm:table-row sm:space-y-0 sm:p-0">
                    <td className="block sm:table-cell sm:px-3 sm:py-2">
                      <span className="break-words font-semibold">{nomeDeCompra(it)}</span>
                      {pedido && <span className="block break-words text-xs font-semibold">{pedido}</span>}
                      {it.marcaRecebida && it.marcaRecebida !== it.marca && <span className="block break-words text-xs font-bold">Veio: {it.marcaRecebida}</span>}
                      {nomeDeApoio(it) && <span className={`block break-words text-xs ${texto2}`}>No estoque: {nomeDeApoio(it)}</span>}
                    </td>
                    <td className="block font-mono sm:table-cell sm:whitespace-nowrap sm:px-3 sm:py-2"><RotuloNaLinha>Pedido</RotuloNaLinha>{num(it.quantidade)} {it.unidadeMedida}</td>
                    {foiRecebida && (
                      <td className="block font-mono sm:table-cell sm:px-3 sm:py-2">
                        <RotuloNaLinha>Recebido</RotuloNaLinha>
                        {conferido ? `${num(rec)} ${it.unidadeMedida}` : '—'}
                        {conferido && rec === 0 && <span className="ml-2 font-sans"><Selo tom="critico">não veio</Selo></span>}
                        {conferido && rec > 0 && faltou > 0 && <span className="ml-2 font-sans"><Selo tom="aviso">faltaram {num(faltou)}</Selo></span>}
                        {conferido && rec > Number(it.quantidade) && <span className="ml-2 font-sans"><Selo>veio a mais</Selo></span>}
                      </td>
                    )}
                    {verFin && <td className="block font-mono sm:table-cell sm:px-3 sm:py-2"><RotuloNaLinha>Custo unitário</RotuloNaLinha>{it.custoUnitario != null ? brl(it.custoUnitario) : '—'}</td>}
                    {foiRecebida && (
                      <td className="block sm:table-cell sm:px-3 sm:py-2">
                        <RotuloNaLinha>Validade · lote</RotuloNaLinha>
                        {it.validadeIndefinida ? 'sem validade' : it.validade ? dataBr(it.validade) : '—'}{it.loteCodigo ? ` · ${it.loteCodigo}` : ''}
                      </td>
                    )}
                  </tr>
                );
              })}
              {itens.length === 0 && <tr className="block sm:table-row"><td colSpan={5} className={`block px-3 py-6 text-center sm:table-cell ${texto2}`}>Lista sem itens.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Dialogo>
  );
}

// "Gerar lista com o que faltou" (decisão do dono, 09/10/2026): mostra o que veio a menos e cria
// uma lista NOVA só com essas quantidades — mesmo fornecedor, mesmo responsável, mesmas marcas.
// A lista recebida continua como está. O servidor garante uma só por lista de origem.
export function GerarListaDoQueFaltou({ lista, voltarPara, aoFechar, aoGerar }: { lista: any; voltarPara?: string; aoFechar: () => void; aoGerar: () => void }) {
  const faltas = itensQueFaltaram(lista);
  const [dataRecebimento, setDataRecebimento] = useState('');
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);

  async function gerar() {
    if (gerando) return;
    setErro('');
    setGerando(true);
    try {
      const r: any = await api.gerarListaDoQueFaltou(lista.id, { dataRecebimento: dataRecebimento || undefined });
      if (r?.jaExistia) toast.info(`A lista do que faltou já tinha sido gerada: ${r.nome}.`);
      else toast.success(`Lista "${r?.nome}" criada com ${r?.itens} ${Number(r?.itens) === 1 ? 'item' : 'itens'}.`);
      if (Number(r?.semProduto) > 0) toast.info(`${r.semProduto} produto(s) excluído(s) do estoque ficaram de fora da lista nova.`);
      aoGerar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar a lista');
      setGerando(false);
    }
  }

  return (
    <Dialogo largura="md" titulo="Gerar lista com o que faltou" aoFechar={aoFechar} voltarPara={voltarPara} fecharNoFundo={false}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={gerando}>Agora não</Button>
          <Button type="button" data-foco-inicial onClick={gerar} disabled={gerando || faltas.length === 0}>{gerando ? 'Gerando…' : 'Gerar lista'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>
          Em <b>{lista.nome}</b>, {faltas.length === 1 ? 'um item veio' : `${faltas.length} itens vieram`} a menos do que o pedido. A lista nova leva{' '}
          <b>só o que faltou</b>, com o mesmo fornecedor e as mesmas marcas. A lista recebida continua como está.
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border" aria-label="O que faltou">
          {faltas.map(({ item, faltou }) => (
            <li key={item.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="min-w-0">
                <span className="block break-words font-semibold">{nomeDeCompra(item)}</span>
                {textoDaMarcaPedida(item) && <span className={`block break-words text-xs ${texto2}`}>{textoDaMarcaPedida(item)}</span>}
              </span>
              <span className="text-right">
                <b className="font-mono">{num(faltou)}</b> {item.unidadeMedida}
                <span className={`block text-xs ${texto2}`}>{Number(item.qtdRecebida) === 0 ? `não veio (pedido: ${num(item.quantidade)})` : `pedido ${num(item.quantidade)}, vieram ${num(item.qtdRecebida)}`}</span>
              </span>
            </li>
          ))}
          {faltas.length === 0 && <li className={`px-3 py-4 text-center ${texto2}`}>Não faltou nada nesta lista.</li>}
        </ul>
        <div className="space-y-1.5 sm:max-w-xs">
          <Label htmlFor="faltou-data">Data de recebimento (opcional)</Label>
          <Input id="faltou-data" type="date" value={dataRecebimento} onChange={(e) => setDataRecebimento(e.target.value)} />
        </div>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
