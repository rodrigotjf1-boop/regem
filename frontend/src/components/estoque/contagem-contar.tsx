'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialogo } from '@/components/ui/sobreposto';
import { Selo, dataBr, num, semAcento, texto2 } from '@/components/ui/lista';
import { marcasDe, porMarcaParaEnviar, somaPorMarca, textoDeBusca, textoPorMarca } from '@/lib/produto-compra';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Título da coluna antes do valor: só aparece quando a tabela está empilhada (abaixo de 640 px).
function RotuloNaLinha({ children }: { children: React.ReactNode }) {
  return <><span className={`font-sans text-xs font-bold sm:hidden ${texto2}`}>{children}:</span>{' '}</>;
}

// Contar uma lista (diálogo largo): contado × sistema, com progresso. Produto com duas ou mais
// MARCAS é contado marca a marca (decisão do dono, 09/10/2026): a soma é o contado do produto e é
// ela que ajusta o estoque — que continua um só; o detalhe por marca fica guardado na contagem.
export function ContarContagem({ lista, exec, aoFechar, aoSalvar }: { lista: any; exec: any; aoFechar: () => void; aoSalvar: () => void }) {
  const itens: any[] = exec.itens ?? [];
  const [contado, setContado] = useState<Record<string, string>>({});
  // Produto com duas ou mais marcas: o que foi digitado em cada marca (item → marca → texto).
  const [porMarca, setPorMarca] = useState<Record<string, Record<string, string>>>({});
  // Hora em que CADA item foi informado. É o que permite o servidor usar o saldo do instante
  // certo: o inventário roda durante o expediente e o operador conta item a item, andando
  // entre câmara e freezer, enquanto a venda consome.
  const [contadoEm, setContadoEm] = useState<Record<string, string>>({});
  const [ajuste, setAjuste] = useState(true);
  const [busca, setBusca] = useState('');
  const [soFaltam, setSoFaltam] = useState(false);
  const [soDiferenca, setSoDiferenca] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const marcasDoItem = (i: any) => { const m = marcasDe(i); return m.length >= 2 ? m : []; };
  // O contado do produto: o digitado — ou, no produto contado por marca, a SOMA das marcas.
  const valor = (i: any): string => {
    const marcas = marcasDoItem(i);
    if (!marcas.length) return contado[i.itemId] ?? '';
    const soma = somaPorMarca(marcas, porMarca[i.itemId]);
    return soma === null ? '' : String(soma);
  };
  const informado = (i: any) => valor(i) !== '';
  // O ajuste é calculado contra o saldo do INSTANTE da contagem, não o da abertura. Aqui a
  // melhor aproximação é abertura + o que já se moveu — senão a tela mostraria um número e o
  // servidor lançaria outro.
  const diferenca = (i: any): number | null =>
    informado(i) ? Number(valor(i)) - (Number(i.saldoSistema) + (Number(i.movimentoDesdeAbertura) || 0)) : null;
  const temDiferenca = (i: any) => { const d = diferenca(i); return d !== null && Math.abs(d) > 1e-9; };
  const contados = itens.filter(informado).length;
  const b = semAcento(busca);
  const visiveis = itens.filter((i) => (!b || semAcento(textoDeBusca(i)).includes(b)) && (!soFaltam || !informado(i)) && (!soDiferenca || temDiferenca(i)));
  // Recarimba a cada digitação: se o operador voltar e recontar o item depois do aviso de
  // movimento, a base acompanha.
  const carimbar = (itemId: string) => setContadoEm((s) => ({ ...s, [itemId]: new Date().toISOString() }));

  async function salvar() {
    if (salvando) return;
    setSalvando(true);
    try {
      const r: any = await api.salvarContagem(exec.id, {
        itens: itens.filter(informado).map((i) => {
          const marcas = marcasDoItem(i);
          return {
            itemId: i.itemId,
            contado: Number(valor(i)),
            contadoEm: contadoEm[i.itemId],
            porMarca: marcas.length ? porMarcaParaEnviar(marcas, porMarca[i.itemId]) : undefined,
          };
        }),
        aplicarAjuste: ajuste,
      });
      const moveram = Number(r?.itensComMovimento) || 0;
      if (ajuste && moveram > 0) {
        // O ajuste foi lançado contra o saldo da ABERTURA. Se o item se moveu no meio da
        // contagem, esse ajuste pode estar errado — e este é o único momento em que alguém
        // ainda lembra o que contou.
        toast.info(`Contagem salva, mas ${moveram} item(ns) tiveram venda ou produção durante a contagem. O ajuste desses pode estar errado — confira o saldo.`);
      } else {
        toast.success(ajuste ? 'Contagem salva e estoque ajustado.' : 'Contagem salva.');
      }
      aoSalvar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
      setSalvando(false);
    }
  }
  const ficha = (ligada: boolean) =>
    `inline-flex min-h-10 items-center rounded-full border px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
      ligada ? 'border-primary bg-primary/15 text-foreground' : `border-input bg-card ${texto2}`
    }`;

  return (
    <Dialogo largura="lg" titulo={`Contar: ${lista.nome}`} aoFechar={aoFechar} fecharNoFundo={false}
      rodape={
        <>
          <label className="mr-auto flex min-h-10 items-center gap-2 text-sm">
            <input type="checkbox" className="h-5 w-5 accent-primary" checked={ajuste} onChange={(e) => setAjuste(e.target.checked)} />
            Ajustar o estoque pela contagem (lança a diferença)
          </label>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="button" onClick={salvar} disabled={salvando || contados === 0}>{salvando ? 'Salvando…' : 'Salvar contagem'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        {Number(exec.itensComMovimento) > 0 && (
          <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2">
            {Number(exec.itensComMovimento)} item(ns) tiveram venda ou produção desde que esta contagem abriu. O saldo do sistema abaixo é o da abertura — confira esses itens.
          </p>
        )}
        <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div className="space-y-1">
            <Label htmlFor="contar-busca">Buscar produto ou marca</Label>
            <Input id="contar-busca" data-foco-inicial type="search" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Digite parte do nome" autoComplete="off" />
          </div>
          <p className="rounded-md bg-info/10 px-3 py-2.5 font-semibold" role="status" aria-live="polite">
            {contados} de {itens.length} contados · {itens.filter(temDiferenca).length} com diferença
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-pressed={soFaltam} className={ficha(soFaltam)} onClick={() => setSoFaltam((v) => !v)}>Só os que faltam contar</button>
          <button type="button" aria-pressed={soDiferenca} className={ficha(soDiferenca)} onClick={() => setSoDiferenca((v) => !v)}>Só com diferença</button>
        </div>
        {itens.some((i) => marcasDoItem(i).length > 0) && (
          <p className={`text-xs ${texto2}`}>Produto com mais de uma marca é contado marca a marca: a soma é o contado do produto — o estoque continua um só.</p>
        )}
        <div className="max-h-[46vh] overflow-y-auto rounded-lg border border-border">
          {/* Abaixo de 640 px cada produto vira um bloco (nada rola para o lado). */}
          <table className="block w-full border-collapse sm:table">
            <caption className="sr-only">Produtos desta contagem</caption>
            <thead className="sticky top-0 hidden sm:table-header-group">
              <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                <th scope="col" className="px-3 py-2">Produto</th>
                <th scope="col" className="px-3 py-2">No sistema</th>
                <th scope="col" className="px-3 py-2">Contado</th>
                <th scope="col" className="px-3 py-2">Diferença</th>
              </tr>
            </thead>
            <tbody className="block sm:table-row-group">
              {visiveis.map((i) => {
                const d = diferenca(i);
                const marcas = marcasDoItem(i);
                const total = valor(i);
                return (
                  <tr key={i.itemId} className="block space-y-1.5 border-b border-border p-3 align-top last:border-b-0 sm:table-row sm:space-y-0 sm:p-0">
                    <td className="block sm:table-cell sm:px-3 sm:py-1.5">
                      <span className="break-words font-semibold">{i.nome}</span>
                      {/* O saldo mostrado é o da ABERTURA da contagem. Se o item saiu ou entrou
                          depois, quem está contando precisa saber — é ele quem sabe se contou
                          antes ou depois do movimento. */}
                      {Number(i.movimentosDesdeAbertura) > 0 && (
                        <span className="block text-xs font-semibold">
                          ⚠ {Number(i.movimentoDesdeAbertura) > 0 ? '+' : ''}{num(i.movimentoDesdeAbertura)} desde que a contagem abriu
                        </span>
                      )}
                    </td>
                    <td className="block font-mono sm:table-cell sm:whitespace-nowrap sm:px-3 sm:py-1.5"><RotuloNaLinha>No sistema</RotuloNaLinha>{num(i.saldoSistema)} {i.unidadeMedida}</td>
                    <td className="block sm:table-cell sm:px-3 sm:py-1.5">
                      {marcas.length === 0 ? (
                        <Input type="number" min={0} step="any" inputMode="decimal" className="w-full sm:w-28" value={contado[i.itemId] ?? ''} placeholder="contado"
                          aria-label={`Contado de ${i.nome}, em ${i.unidadeMedida}`}
                          onChange={(e) => { setContado((s) => ({ ...s, [i.itemId]: e.target.value })); carimbar(i.itemId); }} />
                      ) : (
                        <div className="space-y-1.5" role="group" aria-label={`Contado de ${i.nome}, por marca`}>
                          {marcas.map((m) => (
                            <label key={m} className="flex items-center gap-2">
                              <span className="min-w-0 flex-1 break-words text-xs font-semibold sm:w-28 sm:flex-none">{m}</span>
                              <Input type="number" min={0} step="any" inputMode="decimal" className="w-28 flex-none" value={porMarca[i.itemId]?.[m] ?? ''} placeholder="0"
                                aria-label={`Contado de ${i.nome}, marca ${m}, em ${i.unidadeMedida}`}
                                onChange={(e) => { setPorMarca((s) => ({ ...s, [i.itemId]: { ...s[i.itemId], [m]: e.target.value } })); carimbar(i.itemId); }} />
                            </label>
                          ))}
                          <p className="text-xs font-bold" role="status">{total === '' ? 'Informe ao menos uma marca.' : `Total: ${num(total)} ${i.unidadeMedida}`}</p>
                        </div>
                      )}
                    </td>
                    <td className="block sm:table-cell sm:px-3 sm:py-1.5">
                      <RotuloNaLinha>Diferença</RotuloNaLinha>
                      {d === null ? '—' : Math.abs(d) <= 1e-9 ? <Selo tom="ok">confere</Selo> : <Selo tom={d < 0 ? 'critico' : 'aviso'}>{d > 0 ? '+' : ''}{num(d)}</Selo>}
                    </td>
                  </tr>
                );
              })}
              {visiveis.length === 0 && <tr className="block sm:table-row"><td colSpan={4} className={`block px-3 py-6 text-center sm:table-cell ${texto2}`}>Nenhum produto com esses filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </Dialogo>
  );
}

// Histórico das contagens feitas de uma lista, com o detalhe por marca de cada uma.
export function HistoricoDaContagem({ lista, aoFechar }: { lista: any; aoFechar: () => void }) {
  const [linhas, setLinhas] = useState<any[] | null>(null);
  const [erro, setErro] = useState('');
  useEffect(() => {
    let vivo = true;
    api.contagemHistorico(lista.id)
      .then((r: any) => { if (vivo) setLinhas(Array.isArray(r) ? r : []); })
      .catch((e: unknown) => { if (vivo) { setLinhas([]); setErro(e instanceof Error ? e.message : 'Não consegui abrir o histórico.'); } });
    return () => { vivo = false; };
  }, [lista.id]);
  return (
    <Dialogo largura="lg" titulo={`Histórico: ${lista.nome}`} aoFechar={aoFechar}
      rodape={<Button type="button" data-foco-inicial onClick={aoFechar}>Fechar</Button>}>
      <div className="space-y-3 text-sm">
        {erro && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>}
        {linhas === null && <p className={texto2}>Abrindo o histórico…</p>}
        {linhas && linhas.length === 0 && !erro && <p className={`py-6 text-center ${texto2}`}>Esta lista ainda não foi contada.</p>}
        {linhas && linhas.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            {/* Abaixo de 640 px cada contagem vira um bloco, com o título da coluna antes do valor. */}
            <table className="block w-full border-collapse sm:table sm:min-w-[520px]">
              <caption className="sr-only">Contagens feitas desta lista</caption>
              <thead className="hidden sm:table-header-group">
                <tr className={`border-b border-border bg-secondary text-left text-xs uppercase tracking-wide ${texto2}`}>
                  <th scope="col" className="px-3 py-2">Data</th>
                  <th scope="col" className="px-3 py-2">Quem abriu</th>
                  <th scope="col" className="px-3 py-2">Contados</th>
                  <th scope="col" className="px-3 py-2">Diferença</th>
                  <th scope="col" className="px-3 py-2">Situação</th>
                </tr>
              </thead>
              {linhas.map((h) => {
                const marcas: any[] = Array.isArray(h.porMarca) ? h.porMarca : [];
                return (
                  <tbody key={h.id} className="block border-b border-border last:border-b-0 sm:table-row-group">
                    <tr className="block space-y-1 p-3 sm:table-row sm:space-y-0 sm:p-0">
                      <td className="block font-mono sm:table-cell sm:px-3 sm:py-2"><RotuloNaLinha>Data</RotuloNaLinha>{dataBr(h.data)}</td>
                      <td className="block sm:table-cell sm:px-3 sm:py-2"><RotuloNaLinha>Quem abriu</RotuloNaLinha>{h.quemNome ?? <span className={texto2}>não identificado</span>}</td>
                      <td className="block font-mono sm:table-cell sm:px-3 sm:py-2"><RotuloNaLinha>Contados</RotuloNaLinha>{h.contados} de {h.itens}</td>
                      <td className="block sm:table-cell sm:px-3 sm:py-2"><RotuloNaLinha>Diferença</RotuloNaLinha>{Number(h.comDiferenca) > 0 ? <Selo tom="aviso">{h.comDiferenca} produto(s)</Selo> : Number(h.contados) > 0 ? <Selo tom="ok">tudo conferiu</Selo> : '—'}</td>
                      <td className="block sm:table-cell sm:px-3 sm:py-2"><RotuloNaLinha>Situação</RotuloNaLinha>{h.status === 'concluida' ? <Selo tom="ok">concluída</Selo> : <Selo tom="aviso">aberta</Selo>}</td>
                    </tr>
                    {marcas.length > 0 && (
                      <tr className="block px-3 pb-3 sm:table-row sm:p-0">
                        <td colSpan={5} className="block sm:table-cell sm:px-3 sm:pb-2.5">
                          <span className={`block text-xs font-bold uppercase tracking-wide ${texto2}`}>Contado por marca</span>
                          <ul className="mt-0.5 space-y-0.5">
                            {marcas.map((p) => (
                              <li key={p.nome} className="break-words">
                                <b>{p.nome}:</b> {textoPorMarca(p.porMarca, num)} <span className={texto2}>(total {num(p.contado)} {p.unidadeMedida})</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
        <p className={texto2}>A diferença é contra o saldo que o sistema tinha quando a contagem abriu. Mostra as 30 contagens mais recentes.</p>
      </div>
    </Dialogo>
  );
}
