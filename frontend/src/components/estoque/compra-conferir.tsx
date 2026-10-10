'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Dialogo } from '@/components/ui/sobreposto';
import { brl, num, texto2 } from '@/components/ui/lista';
import { marcasDe, nomeDeApoio, nomeDeCompra, quantoFaltou, textoDaMarcaPedida } from '@/lib/produto-compra';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Conferência: o que de fato chegou, por linha da compra. `recebido` é o MARCADOR — sem ele o
// item fica registrado como "não veio" e nada entra no estoque.
type Conf = { recebido: boolean; qtdRecebida: string; custoUnitario: string; validade: string; indefinida: boolean; loteCodigo: string; marcaRecebida: string };

// Título da coluna escrito em cima do campo: só aparece quando a tabela está empilhada (abaixo
// de 1024 px), em que o cabeçalho some.
function RotuloDaColuna({ children }: { children: React.ReactNode }) {
  return <span className={`block font-sans text-xs font-bold uppercase tracking-wide lg:hidden ${texto2}`}>{children}</span>;
}

// Conferir e receber uma lista de compras (decisão do dono, 09/10/2026): cada item tem um
// MARCADOR de recebido. Marcado, pede a quantidade (vem a pedida; baixar mostra o que faltou), a
// validade e o lote; SEM marcar, é "não veio". Só a quantidade recebida entra no estoque — e o
// estoque é um só por produto: a marca que veio fica no registro da compra.
// VALORES DA NOTA (decisão do dono, 10/10/2026): cada item marcado tem o valor unitário, que vem com
// o do pedido e se corrige pelo que está na nota; é ele que vai para o custo médio e a conta a
// pagar. Qualquer conferente informa: quem não vê valores em R$ recebe o campo vazio (o servidor não
// manda o valor do pedido) e digita o da nota — em branco, vale o do pedido.
export function ConferirCompra({ lista, aoFechar, aoReceber }: { lista: any; aoFechar: () => void; aoReceber: (itensComFalta: number) => void }) {
  const itens: any[] = lista.itens ?? [];
  const [conf, setConf] = useState<Record<string, Conf>>(() =>
    Object.fromEntries(
      itens.map((it) => [
        it.id,
        {
          recebido: false, // nada entra sem alguém confirmar que chegou
          qtdRecebida: String(it.quantidade ?? ''), // parte-se do pedido; corrige quem confere
          custoUnitario: it.custoUnitario != null ? String(Number(it.custoUnitario)) : '', // o do pedido; a nota pode trazer outro
          validade: '',
          // Memória por insumo: como ele foi conferido da última vez. A decisão continua na
          // tela para ser confirmada — só não se redigita.
          indefinida: !!it.sugestao?.validadeIndefinida,
          loteCodigo: '',
          marcaRecebida: it.marca ?? '', // vem a pedida; troca quem recebe, se veio a 2ª opção
        },
      ]),
    ),
  );
  const [vencimento, setVencimento] = useState(lista.vencimento ? String(lista.vencimento).slice(0, 10) : '');
  const [notaRef, setNotaRef] = useState('');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const mudar = (id: string, patch: Partial<Conf>) => setConf((c) => ({ ...c, [id]: { ...c[id], ...patch } }));

  const marcados = itens.filter((it) => conf[it.id]?.recebido);
  const naoVieram = itens.length - marcados.length;
  const comFalta = marcados.filter((it) => conf[it.id].qtdRecebida !== '' && quantoFaltou(it.quantidade, conf[it.id].qtdRecebida) > 0).length;
  const todos = marcados.length === itens.length;
  // O que a nota soma, pelos valores que estão na tela (o servidor refaz a conta com o que gravar).
  const totalConferido = Math.round(marcados.reduce((s, it) => s + (Number(conf[it.id].qtdRecebida) || 0) * (Number(conf[it.id].custoUnitario) || 0), 0) * 100) / 100;
  const marcarTodos = (v: boolean) => setConf((c) => Object.fromEntries(Object.entries(c).map(([id, x]) => [id, { ...x, recebido: v }])));

  async function confirmar() {
    if (salvando || !marcados.length) return;
    const semQtd = marcados.find((it) => !(Number(conf[it.id].qtdRecebida) > 0));
    if (semQtd) {
      setErro(`Confira "${nomeDeCompra(semQtd)}": informe a quantidade que chegou — ou tire o marcador, se não veio.`);
      return;
    }
    const valorRuim = marcados.find((it) => conf[it.id].custoUnitario !== '' && !(Number(conf[it.id].custoUnitario) >= 0));
    if (valorRuim) {
      setErro(`Confira "${nomeDeCompra(valorRuim)}": o valor unitário não pode ser negativo.`);
      return;
    }
    const semValidade = marcados.find((it) => !conf[it.id].validade && !conf[it.id].indefinida);
    if (semValidade) {
      setErro(`Confira "${nomeDeCompra(semValidade)}": informe a validade (ou marque "sem validade").`);
      return;
    }
    setErro('');
    setSalvando(true);
    try {
      const r: any = await api.receberCompra(lista.id, {
        vencimento: vencimento || undefined,
        notaRef: notaRef.trim() || undefined,
        itens: itens.map((it) => {
          const c = conf[it.id];
          if (!c.recebido) return { compraItemId: it.id, qtdRecebida: 0 }; // não veio
          return {
            compraItemId: it.id,
            qtdRecebida: Number(c.qtdRecebida),
            custoUnitario: c.custoUnitario !== '' ? Number(c.custoUnitario) : undefined, // em branco, vale o do pedido
            validade: c.indefinida ? undefined : c.validade,
            validadeIndefinida: c.indefinida || undefined,
            loteCodigo: c.loteCodigo.trim() || undefined,
            marcaRecebida: marcasDe(it).length >= 2 ? c.marcaRecebida || undefined : undefined,
          };
        }),
      });
      toast.success('Compra conferida e recebida — estoque atualizado.');
      aoReceber(Number(r?.itensComFalta) || 0);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao receber');
      setSalvando(false);
    }
  }

  return (
    <Dialogo largura="lg" titulo={`Conferir e receber: ${lista.nome}`} aoFechar={aoFechar} fecharNoFundo={false}
      rodape={
        <>
          <span className={`mr-auto self-center text-sm ${texto2}`} role="status" aria-live="polite">
            {marcados.length === 0
              ? 'Marque o que chegou para confirmar.'
              : `${marcados.length} de ${itens.length} marcado(s)${comFalta ? ` · ${comFalta} com falta` : ''}${naoVieram ? ` · ${naoVieram} sem marcar (não veio)` : ''}`}
            {totalConferido > 0 && <b className="block text-foreground">Total conferido: {brl(totalConferido)}</b>}
          </span>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="button" onClick={confirmar} disabled={salvando || marcados.length === 0}>{salvando ? 'Recebendo…' : 'Confirmar recebimento'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className={`min-w-0 flex-1 basis-64 ${texto2}`}>
            Marque cada item que chegou. O que ficar sem marcar é registrado como <b className="text-foreground">não veio</b> e não entra no estoque.
            Acerte o valor unitário pelo que está na nota.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => marcarTodos(!todos)}>{todos ? 'Desmarcar todos' : 'Marcar todos'}</Button>
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          {/* Abaixo de 1024 px a tabela vira blocos — um por item, com o título de cada coluna em
              cima do campo: nada rola para o lado. */}
          <table className="block w-full border-collapse lg:table lg:min-w-[800px]">
            <caption className="sr-only">Conferência dos itens da compra</caption>
            <thead className="hidden lg:table-header-group">
              <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                <th scope="col" className="px-3 py-2">Recebido · item</th>
                <th scope="col" className="px-3 py-2">Pedido</th>
                <th scope="col" className="px-3 py-2">Chegou *</th>
                <th scope="col" className="px-3 py-2">Valor un.</th>
                <th scope="col" className="px-3 py-2">Validade *</th>
                <th scope="col" className="px-3 py-2">Lote</th>
              </tr>
            </thead>
            <tbody className="block lg:table-row-group">
              {itens.map((it, n) => {
                const c = conf[it.id];
                const pedida = Number(it.quantidade);
                const rec = Number(c.qtdRecebida);
                const faltou = c.qtdRecebida !== '' ? quantoFaltou(pedida, rec) : 0;
                const veioMais = c.qtdRecebida !== '' && rec > pedida;
                const titulo = nomeDeCompra(it); // o que vem escrito na caixa e na nota
                const marcas = marcasDe(it);
                const pedido = textoDaMarcaPedida(it);
                // O valor do pedido só vem para quem vê valores em R$: é contra ele que a tela avisa a mudança.
                const valorDoPedido = it.custoUnitario != null ? Number(it.custoUnitario) : null;
                const valorMudou = valorDoPedido != null && c.custoUnitario !== '' && Math.abs(Number(c.custoUnitario) - valorDoPedido) > 1e-9;
                // Sem o marcador, os campos da mercadoria somem (empilhado) ou viram traço (tabela):
                // não há o que conferir. Empilhado: quantidade e validade lado a lado a partir de 640 px.
                const fora = 'hidden lg:table-cell lg:px-3 lg:py-2';
                const meia = c.recebido ? 'col-span-2 sm:col-span-1 lg:px-3 lg:py-2' : fora;
                return (
                  <tr key={it.id} className={`grid grid-cols-2 gap-x-3 gap-y-2 border-b border-border p-3 align-top last:border-b-0 lg:table-row lg:p-0 ${c.recebido ? 'bg-ok/10' : ''}`}>
                    <td className="col-span-2 lg:px-3 lg:py-2">
                      <label className="flex min-h-11 cursor-pointer items-start gap-3">
                        <input type="checkbox" className="mt-0.5 h-6 w-6 flex-none accent-primary" checked={c.recebido}
                          {...(n === 0 ? { 'data-foco-inicial': true } : {})}
                          aria-label={`Recebido: ${titulo}`} onChange={(e) => mudar(it.id, { recebido: e.target.checked })} />
                        <span className="min-w-0">
                          <span className="block break-words font-semibold">{titulo}</span>
                          {pedido && <span className="block break-words text-xs font-semibold">{pedido}</span>}
                          <span className={`block break-words text-xs ${texto2}`}>{nomeDeApoio(it) ? `No estoque: ${nomeDeApoio(it)} · ` : ''}{it.unidadeMedida}</span>
                          <span className="block text-xs font-bold">{c.recebido ? '✓ Recebido' : 'Não marcado'}</span>
                        </span>
                      </label>
                      {c.recebido && marcas.length >= 2 && (
                        <div className="mt-1.5 space-y-1 pl-9">
                          <Label htmlFor={`veio-${it.id}`} className="text-xs">Marca que veio</Label>
                          <Select id={`veio-${it.id}`} className="w-full max-w-60" value={c.marcaRecebida} onChange={(e) => mudar(it.id, { marcaRecebida: e.target.value })}>
                            {!it.marca && <option value="">— não informada —</option>}
                            {marcas.map((m) => (
                              <option key={m} value={m}>{m}{m === it.marca ? ' (pedida)' : m === it.marcaAlternativa ? ' (2ª opção)' : ''}</option>
                            ))}
                          </Select>
                        </div>
                      )}
                    </td>
                    <td className="col-span-2 font-mono lg:px-3 lg:py-2"><RotuloDaColuna>Pedido</RotuloDaColuna>{num(pedida)} <span className="font-sans lg:hidden">{it.unidadeMedida}</span></td>
                    <td className={meia}>
                      {c.recebido ? (
                        <>
                          <RotuloDaColuna>Chegou *</RotuloDaColuna>
                          <Input type="number" min={0} step="any" inputMode="decimal" className={`w-full lg:w-28 ${faltou > 0 || veioMais ? 'border-warn' : ''}`} value={c.qtdRecebida}
                            aria-label={`Quantidade que chegou de ${titulo}`} onChange={(e) => mudar(it.id, { qtdRecebida: e.target.value })} />
                          {faltou > 0 && <span className="mt-0.5 block text-xs font-bold">faltaram {num(faltou)}</span>}
                          {veioMais && <span className="mt-0.5 block text-xs font-bold">veio a mais</span>}
                        </>
                      ) : <span className={texto2}>—</span>}
                    </td>
                    <td className={meia}>
                      {c.recebido ? (
                        <>
                          <RotuloDaColuna>Valor unitário (R$)</RotuloDaColuna>
                          <Input type="number" min={0} step="any" inputMode="decimal" className={`w-full lg:w-28 ${valorMudou ? 'border-warn' : ''}`} value={c.custoUnitario} placeholder="da nota"
                            aria-label={`Valor unitário de ${titulo}, pela nota`} onChange={(e) => mudar(it.id, { custoUnitario: e.target.value })} />
                          {valorMudou && <span className="mt-0.5 block text-xs font-bold">pedido: {brl(valorDoPedido)}</span>}
                        </>
                      ) : <span className={texto2}>—</span>}
                    </td>
                    <td className={meia}>
                      {c.recebido ? (
                        <>
                          <RotuloDaColuna>Validade *</RotuloDaColuna>
                          <Input type="date" className="w-full lg:w-44" value={c.validade} disabled={c.indefinida} aria-label={`Validade de ${titulo}`} onChange={(e) => mudar(it.id, { validade: e.target.value })} />
                          <label className={`mt-1 flex min-h-8 items-center gap-1.5 text-xs ${texto2}`}>
                            <input type="checkbox" className="h-4 w-4 accent-primary" checked={c.indefinida} aria-label={`Sem validade: ${titulo}`} onChange={(e) => mudar(it.id, { indefinida: e.target.checked, validade: '' })} />
                            sem validade
                          </label>
                        </>
                      ) : <span className={texto2}>—</span>}
                    </td>
                    <td className={meia}>
                      {c.recebido ? (
                        <>
                          <RotuloDaColuna>Lote</RotuloDaColuna>
                          <Input className="w-full lg:w-36" value={c.loteCodigo} placeholder="opcional" aria-label={`Código do lote de ${titulo}`} onChange={(e) => mudar(it.id, { loteCodigo: e.target.value })} />
                        </>
                      ) : <span className={texto2}>—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={`text-xs ${texto2}`}>O código do lote é opcional, mas é ele que permite separar a mercadoria numa troca ou num recall sem abrir embalagem.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="conf-nota">Número da nota (opcional)</Label>
          <Input id="conf-nota" value={notaRef} onChange={(e) => setNotaRef(e.target.value)} maxLength={60} placeholder="Ex.: NF 4471" autoComplete="off" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="conf-venc">Data de pagamento</Label>
          <Input id="conf-venc" type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} aria-describedby="conf-venc-ajuda" />
          <p id="conf-venc-ajuda" className={`text-xs ${texto2}`}>Gera a conta a pagar do fornecedor pelo valor CONFERIDO. Em branco, usa o prazo cadastrado do fornecedor.</p>
        </div>
        </div>
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
