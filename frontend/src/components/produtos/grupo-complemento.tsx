'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { brl, selectCls } from '@/components/produtos/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Um grupo de complementos + suas opções + formulário de nova opção.
//
// Grupo que veio de uma ETAPA do catálogo (`origemComplementoId`): só mostra. Ele é montado a partir de Cadastros ›
// Cardápio › Opções/Complementos a cada mudança lá — o que se criasse ou apagasse aqui seria desfeito na próxima
// montagem (o servidor também recusa). Cada opção mostra o código PDV (é por ele que o adicional do iFood, da 99 e do
// Anota Aí acha a opção) e se controla estoque.
//
// Grupo PRÓPRIO do produto: a opção nova leva o código PDV e, no adicional com insumo, "Controlar estoque". Sem código
// a opção é só observação (mig 126): a venda não cobra o preço nem baixa estoque — a tela diz isso ao lado do campo.
export function GrupoComplemento({
  grupo,
  fichaIngs,
  insumos,
  produtos,
  onAddOpcao,
  onDelGrupo,
  onDelOpcao,
}: {
  grupo: any;
  fichaIngs: any[];
  insumos: any[];
  produtos: any[];
  /** Devolve se salvou: o formulário só se limpa quando a opção entrou (recusada, o que foi digitado fica). */
  onAddOpcao: (grupo: any, dados: any) => Promise<boolean>;
  onDelGrupo: (id: string) => void;
  onDelOpcao: (id: string) => void;
}) {
  const remover = grupo.tipo === 'remover';
  const escolha = grupo.tipo === 'escolha';
  const doCatalogo = !!grupo.origemComplementoId;
  const badge = remover ? 'retirar' : escolha ? 'escolher' : 'adicionar';
  const [nome, setNome] = useState('');
  const [precoDelta, setPrecoDelta] = useState('');
  const [ref, setRef] = useState(''); // fichaIngredienteId (remover) / itemId (adicionar) / produtoRefId (escolha)
  const [quantidade, setQuantidade] = useState('1');
  const [codigoPdv, setCodigoPdv] = useState('');
  const [controla, setControla] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const idBase = `grupo-${grupo.id}`;

  async function submit() {
    if (!nome.trim() && !ref) return;
    const dados: any = { nome: nome.trim() };
    if (remover) {
      dados.fichaIngredienteId = ref || undefined;
      if (!dados.nome && ref) {
        const ing = fichaIngs.find((i) => i.id === ref);
        dados.nome = ing?.insumoNome ?? ing?.subFichaNome ?? 'ingrediente';
      }
    } else if (escolha) {
      dados.precoDelta = precoDelta !== '' ? Number(String(precoDelta).replace(',', '.')) : 0;
      dados.produtoRefId = ref || undefined;
      if (!dados.nome && ref) dados.nome = produtos.find((p) => p.id === ref)?.nome ?? 'opção';
    } else {
      dados.precoDelta = precoDelta !== '' ? Number(String(precoDelta).replace(',', '.')) : 0;
      dados.itemId = ref || undefined;
      dados.quantidade = Number(String(quantidade).replace(',', '.')) || 1;
    }
    const codigo = codigoPdv.trim();
    if (codigo) dados.codigoPdv = codigo;
    // "Controlar estoque" só vale com código e com o insumo escolhido (o adicional que baixa).
    if (!remover && !escolha && codigo && ref) dados.controlaEstoque = controla;
    setSalvando(true);
    const ok = await onAddOpcao(grupo, dados).finally(() => setSalvando(false));
    if (!ok) return;
    setNome('');
    setPrecoDelta('');
    setRef('');
    setQuantidade('1');
    setCodigoPdv('');
    setControla(true);
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 font-medium">
          {grupo.nome}{' '}
          <span className={`ml-1 rounded px-1.5 py-0.5 text-xs ${remover ? 'bg-warn/10 text-warn' : escolha ? 'bg-primary/10 text-primary' : 'bg-info/10 text-info'}`}>
            {badge}
          </span>
          {doCatalogo && <span className="ml-1 rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">do catálogo</span>}
          {(grupo.min > 0 || grupo.max) && (
            <span className="ml-1 text-[11px] text-muted-foreground">
              {grupo.min > 0 ? 'obrigatório · ' : ''}{grupo.max ? `até ${grupo.max}` : ''}
            </span>
          )}
        </span>
        {!doCatalogo && (
          <Button type="button" variant="ghost" size="sm" className="text-destructive" onClick={() => onDelGrupo(grupo.id)}>
            remover grupo
          </Button>
        )}
      </div>

      {doCatalogo && (
        <p className="mb-2 rounded-md border-l-4 border-info bg-info/10 px-3 py-2 text-xs">
          Este grupo vem de uma etapa do catálogo. O <strong>código PDV</strong>, o preço e a baixa de cada opção se editam em{' '}
          <strong>Cadastros › Cardápio › Opções</strong> — lá a mudança vale para todos os produtos com esta etapa. Para tirar o
          grupo deste produto, desmarque a etapa em “Etapas do produto (complementos)”, acima.
        </p>
      )}

      {(grupo.opcoes ?? []).length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">Sem opções ainda.</p>
      )}
      <ul className="mb-2 space-y-1" aria-label={`Opções de ${grupo.nome}`}>
        {(grupo.opcoes ?? []).map((o: any) => {
          const codigo = String(o.codigoPdv ?? '').trim();
          return (
            <li key={o.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-border px-2 py-1 text-sm">
              <span className="min-w-0 flex-1 break-words">{o.nome}</span>
              {Number(o.precoDelta) > 0 && (
                <span className="font-mono text-xs text-primary">+ {brl(Number(o.precoDelta))}</span>
              )}
              {codigo ? (
                <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-xs" title="Código PDV: é por ele que o adicional dos canais acha esta opção">
                  PDV {codigo}
                </span>
              ) : remover ? (
                // Retirar ("sem cebola") vale mesmo sem código na venda daqui; o código é o que o canal usa.
                <span className="rounded bg-secondary px-1.5 py-0.5 text-xs text-muted-foreground">sem código PDV</span>
              ) : (
                <span className="rounded bg-warn/10 px-1.5 py-0.5 text-xs text-warn">sem código PDV — observação: não cobra nem baixa</span>
              )}
              {codigo && !remover && (
                <span className="text-xs text-muted-foreground">{o.controlaEstoque ? 'controla estoque' : 'não controla estoque'}</span>
              )}
              {!doCatalogo && (
                <Button type="button" variant="ghost" size="sm" className="text-destructive" aria-label={`Remover a opção ${o.nome}`} onClick={() => onDelOpcao(o.id)}>×</Button>
              )}
            </li>
          );
        })}
      </ul>

      {!doCatalogo && (
        <>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <Input placeholder="Nome da opção" aria-label="Nome da opção" value={nome} onChange={(e) => setNome(e.target.value)} />
            {remover ? (
              <select
                aria-label="Ingrediente da ficha a retirar"
                className={selectCls}
                value={ref}
                onChange={(e) => setRef(e.target.value)}
              >
                <option value="">— ingrediente da ficha —</option>
                {fichaIngs.map((i) => (
                  <option key={i.id} value={i.id}>{i.insumoNome ?? i.subFichaNome ?? 'ingrediente'}</option>
                ))}
              </select>
            ) : escolha ? (
              <>
                <Input type="number" placeholder="+ R$ (opcional)" aria-label="Preço a mais" value={precoDelta} onChange={(e) => setPrecoDelta(e.target.value)} />
                <select
                  aria-label="Produto vinculado (opcional)"
                  className={selectCls}
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                >
                  <option value="">— sem produto (só rótulo) —</option>
                  {produtos.map((p) => (
                    <option key={p.id} value={p.id}>{p.nome}</option>
                  ))}
                </select>
              </>
            ) : (
              <>
                <Input type="number" placeholder="+ R$" aria-label="Preço a mais" value={precoDelta} onChange={(e) => setPrecoDelta(e.target.value)} />
                <select
                  aria-label="Insumo a dar baixa"
                  className={selectCls}
                  value={ref}
                  onChange={(e) => setRef(e.target.value)}
                >
                  <option value="">— insumo (baixa) —</option>
                  {insumos.map((i) => (
                    <option key={i.id} value={i.id}>{i.nome}</option>
                  ))}
                </select>
                <Input type="number" placeholder="Qtd baixa" aria-label="Quantidade que baixa" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} />
              </>
            )}
            <Input
              id={`${idBase}-codigo`}
              placeholder="Código PDV (o do canal)"
              aria-label="Código PDV"
              aria-describedby={`${idBase}-codigo-ajuda`}
              value={codigoPdv}
              onChange={(e) => setCodigoPdv(e.target.value)}
              maxLength={60}
            />
            {!remover && !escolha && (
              <label className={`flex items-center gap-2 text-sm ${codigoPdv.trim() && ref ? '' : 'text-muted-foreground'}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-primary"
                  checked={controla && !!codigoPdv.trim() && !!ref}
                  disabled={!codigoPdv.trim() || !ref}
                  onChange={(e) => setControla(e.target.checked)}
                />
                Controlar estoque (baixa o insumo)
              </label>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => void submit()} disabled={salvando}>
              {salvando ? 'Salvando…' : '＋ opção'}
            </Button>
          </div>
          <p id={`${idBase}-codigo-ajuda`} className="mt-1.5 text-xs text-muted-foreground">
            O código PDV é o mesmo que a opção tem no iFood, na 99 e no Anota Aí — é por ele que o adicional do pedido acha a
            opção. {remover ? '' : 'Sem código, a opção vira só observação: a venda não cobra o preço nem baixa estoque.'}
          </p>
        </>
      )}
    </div>
  );
}
