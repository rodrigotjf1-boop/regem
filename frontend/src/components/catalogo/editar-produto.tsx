'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { ImageUpload } from '@/components/ui/image-upload';
import { Gaveta } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { UltimoEnvioIfood } from '@/components/produtos/ultimo-envio-ifood';
import { FotosDosApps } from '@/components/catalogo/fotos-dos-apps';
import type { FotosDoProduto } from '@/lib/conferencia-apps';
import {
  analisarEdicao, edicaoInicial, esgotado, pausaNoRegem, type CategoriaDaGestao, type EdicaoDoProduto, type ProdutoDaGestao,
} from '@/lib/catalogo-gestao';

/* eslint-disable @typescript-eslint/no-explicit-any */
const NOVA = '__nova';

// EDITAR (Gestão do catálogo › Produtos e preços — protótipo `regem-conciliacao-ifood.html`, a gaveta de editar): nome,
// descrição, código PDV, categoria, foto, o preço e a pausa de cada canal, o "Está no iFood" e o "Está na 99". Antes de
// salvar, diz o que muda no Regem e o que vai (e o que não vai) ao iFood e à 99. Grava pelo cadastro (PATCH) e pelas rotas
// do canal (preço e pausa, com auditoria); toda recusa conhecida aparece ANTES da 1ª gravação.
export function EditarProduto({
  produto: p,
  categorias,
  outros,
  comIfood,
  com99 = false,
  podeMudarPreco,
  voltarPara,
  aoFechar,
  aoSalvar,
  aoNovaCategoria,
  fotosDosApps,
  aoMandarFoto99,
  aoMandarFotoIfood,
  aoUsarFotoDoApp,
}: {
  produto: ProdutoDaGestao & Record<string, any>;
  categorias: CategoriaDaGestao[];
  outros: Pick<ProdutoDaGestao, 'id' | 'nome' | 'codigo'>[];
  comIfood: boolean;
  com99?: boolean;
  podeMudarPreco: boolean;
  voltarPara?: string;
  aoFechar: () => void;
  /** Depois de gravar (tudo ou parte): a tela relê a lista. */
  aoSalvar: (fechar: boolean, foiAoIfood: boolean, foiA99: boolean) => void;
  aoNovaCategoria: (c: CategoriaDaGestao) => void;
  /** As fotos do produto nos apps, pela última leitura da conferência (R3 F6). */
  fotosDosApps?: FotosDoProduto;
  /** "Mandar esta foto à 99" (R3 F6). */
  aoMandarFoto99?: () => Promise<void>;
  /** "Mandar esta foto ao iFood" (R3 F6b, pela porta do Orzuni; `imagem` = a cópia enquadrada, F6c). */
  aoMandarFotoIfood?: (imagem?: string) => Promise<void>;
  /** "Usar esta foto no Regem" (R3 G1): devolve o endereço da foto guardada (ou null), que vai para o campo da foto. */
  aoUsarFotoDoApp?: (canal: 'ifood' | '99food') => Promise<string | null>;
}) {
  const [e, setE] = useState<EdicaoDoProduto>(() => edicaoInicial(p));
  const [salvando, setSalvando] = useState(false);
  const [falha, setFalha] = useState('');
  const [novaCat, setNovaCat] = useState<string | null>(null);
  const [criandoCat, setCriandoCat] = useState(false);
  const mudar = (m: Partial<EdicaoDoProduto>) => {
    setFalha('');
    setE((x) => ({ ...x, ...m }));
  };
  const plano = useMemo(
    () => analisarEdicao(p, e, { comIfood, com99, podeMudarPreco, outros, categorias }),
    [p, e, comIfood, com99, podeMudarPreco, outros, categorias],
  );
  const vaiAosApps = plano.ifoodVai.length > 0 || plano.n99Vai.length > 0;
  const parcial = pausaNoRegem(p).parcial;
  const semCodigo = !e.codigo.trim();

  async function criarCategoria() {
    const nome = (novaCat ?? '').trim();
    if (!nome) return;
    setCriandoCat(true);
    try {
      const c: any = await api.criarCategoriaProduto({ nome });
      aoNovaCategoria({ id: c.id, nome: c.nome ?? nome, ordem: c.ordem });
      mudar({ categoriaId: c.id });
      setNovaCat(null);
      toast.success(`Categoria "${nome}" criada.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível criar a categoria.');
    } finally {
      setCriandoCat(false);
    }
  }

  async function salvar() {
    if (plano.erros.length || !plano.mudou) return;
    setSalvando(true);
    setFalha('');
    const feito: string[] = [];
    const passo = async (oQue: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        feito.push(oQue);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'erro ao salvar';
        // O código repetido que a lista não conhecia (cadastrado agora em outra tela): o servidor recusa (índice único).
        const texto = oQue === 'cadastro' && 'codigo' in plano.patch && /já existe/i.test(msg) ? `O código ${e.codigo.trim()} já é de outro produto.` : msg;
        throw new Error(feito.length ? `Salvo: ${feito.join(', ')}. Não salvou ${oQue}: ${texto}` : texto);
      }
    };
    const PRECO = { regem: 'o preço de venda', ifood: 'o preço no iFood', '99food': 'o preço na 99' } as const;
    const PAUSA = { regem: 'a pausa do Regem', ifood: 'a pausa do iFood', '99food': 'a pausa da 99' } as const;
    try {
      if (Object.keys(plano.patch).length) await passo('cadastro', () => api.atualizarProduto(p.id, plano.patch));
      for (const x of plano.precos) await passo(PRECO[x.canal], () => api.precoDoCanal(p.id, x.canal, x.valor));
      for (const x of plano.pausas) await passo(PAUSA[x.canal], () => api.pausaDoCanal(p.id, x.canal, x.pausado));
      const vai = [
        plano.ifoodVai.length ? ' O que é do iFood vai em instantes pelo Orzuni.' : '',
        plano.n99Vai.length ? ' O que é da 99 vai em instantes à 99.' : '',
      ].join('');
      toast.success(`"${e.nome.trim()}" salvo.${vai}`);
      aoSalvar(true, plano.ifoodVai.length > 0, plano.n99Vai.length > 0);
    } catch (err) {
      setFalha(err instanceof Error ? err.message : 'Não foi possível salvar.');
      if (feito.length) aoSalvar(false, plano.ifoodVai.length > 0, plano.n99Vai.length > 0);
    } finally {
      setSalvando(false);
    }
  }

  const caixa = 'h-5 w-5 flex-none accent-primary';
  return (
    <Gaveta
      media
      titulo={`Editar: ${p.nome}`}
      aoFechar={aoFechar}
      voltarPara={voltarPara}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="button" onClick={() => void salvar()} disabled={salvando || !plano.mudou || plano.erros.length > 0}>
            {salvando ? 'Salvando…' : vaiAosApps ? 'Salvar e enviar' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ep-nome">Nome</Label>
            <Input id="ep-nome" data-foco-inicial value={e.nome} onChange={(x) => mudar({ nome: x.target.value })} autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ep-cod">Código PDV</Label>
            <Input id="ep-cod" value={e.codigo} onChange={(x) => mudar({ codigo: x.target.value })} autoComplete="off" placeholder="Ex.: 2051" aria-describedby="ep-cod-ajuda" />
            <p id="ep-cod-ajuda" className={`text-xs ${texto2}`}>O código do item nos apps: é por ele que a venda se liga.</p>
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="ep-desc">Descrição</Label>
          <textarea
            id="ep-desc"
            rows={3}
            value={e.descricao}
            onChange={(x) => mudar({ descricao: x.target.value })}
            className="w-full rounded-md border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ep-cat">Categoria</Label>
          <Select
            id="ep-cat"
            value={novaCat !== null ? NOVA : e.categoriaId}
            onChange={(x) => (x.target.value === NOVA ? setNovaCat('') : (setNovaCat(null), mudar({ categoriaId: x.target.value })))}
          >
            {!e.categoriaId && <option value="">Escolha…</option>}
            {categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
            <option value={NOVA}>＋ Cadastrar nova categoria</option>
          </Select>
          {novaCat !== null && (
            <div className="flex flex-wrap items-end gap-2 pt-1">
              <div className="min-w-0 flex-1 basis-48 space-y-1">
                <Label htmlFor="ep-nova-cat">Nome da nova categoria</Label>
                <Input
                  id="ep-nova-cat"
                  autoFocus
                  value={novaCat}
                  onChange={(x) => setNovaCat(x.target.value)}
                  onKeyDown={(x) => {
                    if (x.key === 'Enter') { x.preventDefault(); void criarCategoria(); }
                  }}
                  autoComplete="off"
                />
              </div>
              <Button type="button" onClick={() => void criarCategoria()} disabled={criandoCat || !novaCat.trim()}>{criandoCat ? 'Criando…' : 'Criar categoria'}</Button>
              <Button type="button" variant="outline" onClick={() => setNovaCat(null)}>Cancelar</Button>
            </div>
          )}
        </div>

        <fieldset className="space-y-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-bold">Foto</legend>
          <ImageUpload value={e.imagemRef || undefined} onChange={(url) => mudar({ imagemRef: url ?? '' })} alt={e.nome || 'produto'} />
          <FotosDosApps
            fotoDoRegem={e.imagemRef || ''}
            fotoSalva={String(p.imagemRef ?? '')}
            fotos={fotosDosApps ?? {}}
            noIfood={comIfood && p.noIfood === true}
            na99={com99 && p.na99 === true && !!String(p.codigo ?? '').trim()}
            aoMandar99={aoMandarFoto99}
            aoMandarIfood={String(p.codigo ?? '').trim() ? aoMandarFotoIfood : undefined}
            aoUsarFoto={
              aoUsarFotoDoApp
                ? async (canal) => {
                    const url = await aoUsarFotoDoApp(canal);
                    if (url) mudar({ imagemRef: url });
                  }
                : undefined
            }
          />
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-bold">Preço em cada canal</legend>
          {!podeMudarPreco && <p className={`text-xs ${texto2}`}>Seu perfil não muda preço: pede "Ver valores em R$".</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="ep-p-regem">Preço de venda (Regem)</Label>
              <Input id="ep-p-regem" inputMode="decimal" autoComplete="off" value={e.precoRegem} disabled={!podeMudarPreco} onChange={(x) => mudar({ precoRegem: x.target.value })} className="font-mono" />
              <p className={`text-xs ${texto2}`}>Balcão e cardápio digital.</p>
            </div>
            {comIfood && (
              <div className="space-y-1">
                <Label htmlFor="ep-p-ifood">Preço no iFood</Label>
                <Input id="ep-p-ifood" inputMode="decimal" autoComplete="off" value={e.precoIfood} disabled={!podeMudarPreco} onChange={(x) => mudar({ precoIfood: x.target.value })} placeholder="Em branco: o Regem não mexe" className="font-mono" />
                <p className={`text-xs ${texto2}`}>Vai ao iFood pelo Orzuni.</p>
              </div>
            )}
            {com99 && (
              <div className="space-y-1">
                <Label htmlFor="ep-p-99">Preço na 99</Label>
                <Input id="ep-p-99" inputMode="decimal" autoComplete="off" value={e.preco99} disabled={!podeMudarPreco} onChange={(x) => mudar({ preco99: x.target.value })} placeholder="Em branco: o Regem não mexe" className="font-mono" />
                <p className={`text-xs ${texto2}`}>Vai à 99 na hora.</p>
              </div>
            )}
          </div>
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-bold">Onde vende e pausa</legend>
          <div className="space-y-1">
            <p className="text-sm font-bold">Regem <span className={`font-normal ${texto2}`}>(balcão e cardápio digital)</span></p>
            <label className="flex min-h-10 items-center gap-2 text-sm">
              <input type="checkbox" className={caixa} checked={e.pausaRegem} onChange={(x) => mudar({ pausaRegem: x.target.checked })} />
              Pausado no Regem
            </label>
            {parcial && <p className={`text-xs ${texto2}`}>Hoje está {parcial}. Pausar tira dos dois; reativar põe nos dois.</p>}
          </div>
          {comIfood && (
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-sm font-bold">iFood <span className={`font-normal ${texto2}`}>(pelo Orzuni)</span></p>
              <div className="flex flex-wrap gap-x-6">
                <label className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" className={caixa} checked={e.noIfood} onChange={(x) => mudar({ noIfood: x.target.checked })} />
                  Está no iFood
                </label>
                <label className={`flex min-h-10 items-center gap-2 text-sm ${!e.noIfood ? 'opacity-60' : ''}`}>
                  <input type="checkbox" className={caixa} checked={e.pausaIfood} disabled={!e.noIfood} onChange={(x) => mudar({ pausaIfood: x.target.checked })} />
                  Pausado no iFood
                </label>
              </div>
              <p className={`text-xs ${texto2}`}>
                {semCodigo
                  ? 'Sem código PDV: não liga ao iFood.'
                  : 'Tirar do iFood pausa o item lá (o Regem não apaga item do iFood). Pôr no iFood um produto que não existe lá: crie-o no Gestor de Pedidos com o mesmo código.'}
              </p>
            </div>
          )}
          {com99 && (
            <div className="space-y-1 border-t border-border pt-3">
              <p className="text-sm font-bold">99</p>
              <div className="flex flex-wrap gap-x-6">
                <label className="flex min-h-10 items-center gap-2 text-sm">
                  <input type="checkbox" className={caixa} checked={e.na99} onChange={(x) => mudar({ na99: x.target.checked })} />
                  Está na 99
                </label>
                <label className={`flex min-h-10 items-center gap-2 text-sm ${!e.na99 ? 'opacity-60' : ''}`}>
                  <input type="checkbox" className={caixa} checked={e.pausa99} disabled={!e.na99} onChange={(x) => mudar({ pausa99: x.target.checked })} />
                  Pausado na 99
                </label>
              </div>
              <p className={`text-xs ${texto2}`}>
                {semCodigo
                  ? 'Sem código PDV: não liga à 99.'
                  : 'Tirar da 99 pausa o item lá (o Regem não apaga item da 99). O item que ainda não existe na 99 vai pelo "Exportar catálogo" (Delivery › Painel › ⚙️ › Integrações › 99Food).'}
              </p>
            </div>
          )}
          {esgotado(p) && (
            <p className="rounded-md bg-warn/15 px-3 py-2 text-xs">
              <b>Esgotado pelo estoque</b>
              {Array.isArray(p.lojasPausadas) && p.lojasPausadas.length ? ` (${p.lojasPausadas.join(', ')})` : ''}: fica fora do balcão, do cardápio digital
              {comIfood && com99 ? ', do iFood e da 99' : comIfood ? ' e do iFood' : com99 ? ' e da 99' : ''} até o estoque voltar.
            </p>
          )}
        </fieldset>

        <div aria-live="polite" className="space-y-2">
          {plano.erros.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm">
              <b>Corrija antes de salvar:</b>
              <ul className="ml-5 list-disc">{plano.erros.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          {falha && (
            <div role="alert" className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm">{falha}</div>
          )}
          {!plano.mudou ? (
            <p className={`text-sm ${texto2}`}>Nada mudou ainda.</p>
          ) : (
            <div className="rounded-md border border-info bg-info/10 px-3 py-2 text-sm">
              <b>Ao salvar:</b>
              <ul className="ml-5 list-disc">
                {plano.regem.length > 0 && <li><b>Regem:</b> {plano.regem.join(', ')}.</li>}
                {(plano.ifoodVai.length > 0 || plano.ifoodAtencao.length > 0) && (
                  <li>
                    <b>iFood</b>
                    {plano.ifoodVai.length > 0 && <> — vai agora pelo Orzuni: {plano.ifoodVai.join(', ')}.</>}
                    {plano.ifoodAtencao.length > 0 && <> Atenção: {plano.ifoodAtencao.join('; ')}.</>}
                  </li>
                )}
                {(plano.n99Vai.length > 0 || plano.n99Atencao.length > 0) && (
                  <li>
                    <b>99</b>
                    {plano.n99Vai.length > 0 && <> — vai agora: {plano.n99Vai.join(', ')}.</>}
                    {plano.n99Atencao.length > 0 && <> Atenção: {plano.n99Atencao.join('; ')}.</>}
                  </li>
                )}
              </ul>
            </div>
          )}
        </div>

        {comIfood && p.noIfood && !!(p.codigo ?? '').trim() && <UltimoEnvioIfood alvo="produto" id={p.id} />}
        {com99 && p.na99 && !!(p.codigo ?? '').trim() && <UltimoEnvioIfood alvo="produto" id={p.id} canal="99food" />}
      </div>
    </Gaveta>
  );
}
