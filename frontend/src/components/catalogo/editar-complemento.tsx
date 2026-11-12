'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Gaveta } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { UltimoEnvioIfood } from '@/components/produtos/ultimo-envio-ifood';
import { ImageUpload } from '@/components/ui/image-upload';
import { FotosDosApps } from '@/components/catalogo/fotos-dos-apps';
import { analisarEdicaoDaOpcao, edicaoInicialDaOpcao, informativa, type EdicaoDaOpcao, type OpcaoDoGrupo } from '@/lib/catalogo-gestao';
import type { FotosDoProduto } from '@/lib/conferencia-apps';

/* eslint-disable @typescript-eslint/no-explicit-any */

// EDITAR O COMPLEMENTO (Gestão do catálogo › Complementos — protótipo `regem-conciliacao-ifood.html`, a gaveta do
// complemento): o preço do Regem em CADA grupo em que ele aparece, o preço do iFood (um por código) e a pausa de cada
// canal. Antes de salvar, diz o que muda no Regem e o que vai (e o que não vai) ao iFood. O nome, o código PDV e o "Em
// falta" são do Cadastros (a opção do catálogo); aqui aparecem para conferir. Toda recusa conhecida aparece ANTES da 1ª
// gravação; grava pelas rotas do canal (preço e pausa, com auditoria).
export function EditarComplemento({
  opcao: o,
  grupos,
  comIfood,
  com99 = false,
  podeMudarPreco,
  bloqueio,
  voltarPara,
  aoFechar,
  aoSalvar,
  fotosDosApps,
  aoMandarFoto99,
  aoUsarFotoDoApp,
}: {
  opcao: OpcaoDoGrupo;
  grupos: { id: string; nome: string; preco: string | number | null | undefined }[];
  comIfood: boolean;
  com99?: boolean;
  podeMudarPreco: boolean;
  /** Por que a pausa por canal ainda não vale nesta empresa (servidor da loja desatualizado); null = vale. */
  bloqueio: string | null;
  voltarPara?: string;
  aoFechar: () => void;
  aoSalvar: (fechar: boolean, foiAoIfood: boolean, foiA99: boolean) => void;
  /** R3 G3: as fotos do complemento nos apps (pela última leitura da conferência). */
  fotosDosApps?: FotosDoProduto;
  /** R3 G3: "Mandar esta foto à 99" (o complemento é um item na 99). */
  aoMandarFoto99?: () => Promise<void>;
  /** R3 G3: "Usar esta no Regem" — devolve o endereço da foto guardada (ou null). */
  aoUsarFotoDoApp?: (canal: 'ifood' | '99food') => Promise<string | null>;
}) {
  const [e, setE] = useState<EdicaoDaOpcao>(() => edicaoInicialDaOpcao(o, grupos));
  // R3 G3: a foto do complemento — grava só ela, pela rota da foto (nunca o PATCH da opção, que regrava a linha inteira).
  const fotoSalva = String(o.imagemRef ?? '').trim();
  const [foto, setFoto] = useState(fotoSalva);
  const mudouFoto = foto.trim() !== fotoSalva;
  const [salvando, setSalvando] = useState(false);
  const [falha, setFalha] = useState('');
  const mudar = (m: Partial<EdicaoDaOpcao>) => {
    setFalha('');
    setE((x) => ({ ...x, ...m }));
  };
  const plano = useMemo(
    () => analisarEdicaoDaOpcao(o, grupos, e, { comIfood, com99, podeMudarPreco }),
    [o, grupos, e, comIfood, com99, podeMudarPreco],
  );
  const pausaTravada = !!bloqueio || o.esgotado === true;
  const vaiAosApps = plano.ifoodVai.length > 0 || plano.n99Vai.length > 0;
  const mudou = plano.mudou || mudouFoto;
  const doRegem = [...plano.regem, ...(mudouFoto ? [foto.trim() ? 'foto' : 'tirar a foto'] : [])];
  const PRECO_APP = { ifood: 'o preço no iFood', '99food': 'o preço na 99' } as const;
  const PAUSA = { regem: 'a pausa do Regem', ifood: 'a pausa do iFood', '99food': 'a pausa da 99' } as const;

  async function salvar() {
    if (plano.erros.length || !mudou) return;
    setSalvando(true);
    setFalha('');
    const feito: string[] = [];
    const passo = async (oQue: string, fn: () => Promise<unknown>) => {
      try {
        await fn();
        feito.push(oQue);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'erro ao salvar';
        throw new Error(feito.length ? `Salvo: ${feito.join(', ')}. Não salvou ${oQue}: ${msg}` : msg);
      }
    };
    try {
      for (const x of plano.precosGrupo) {
        const nome = grupos.find((g) => g.id === x.grupoId)?.nome ?? 'o grupo';
        await passo(`o preço em "${nome}"`, () => api.precoDaOpcaoNoGrupo(x.grupoId, o.opcaoId, x.valor));
      }
      for (const x of plano.precosApp) await passo(PRECO_APP[x.canal], () => api.precoDaOpcaoNoCanal(o.opcaoId, x.canal, x.valor));
      for (const x of plano.pausas) await passo(PAUSA[x.canal], () => api.pausaDaOpcaoNoCanal(o.opcaoId, x.canal, x.pausado));
      if (mudouFoto) await passo('a foto', () => api.fotoDaOpcao(o.opcaoId, foto.trim()));
      const vai = [
        plano.ifoodVai.length ? ' O que é do iFood vai em instantes pelo Orzuni.' : '',
        plano.n99Vai.length ? ' O que é da 99 vai em instantes à 99.' : '',
      ].join('');
      toast.success(`"${o.nome}" salvo.${vai}`);
      aoSalvar(true, plano.ifoodVai.length > 0, plano.n99Vai.length > 0);
    } catch (err) {
      setFalha(err instanceof Error ? err.message : 'Não foi possível salvar.');
      if (feito.length) aoSalvar(false, plano.ifoodVai.length > 0, plano.n99Vai.length > 0);
    } finally {
      setSalvando(false);
    }
  }

  const caixa = 'h-5 w-5 flex-none accent-primary';
  const liga = !informativa(o);
  return (
    <Gaveta
      media
      titulo={`Editar o complemento: ${o.nome}`}
      aoFechar={aoFechar}
      voltarPara={voltarPara}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>Cancelar</Button>
          <Button type="button" onClick={() => void salvar()} disabled={salvando || !mudou || plano.erros.length > 0}>
            {salvando ? 'Salvando…' : vaiAosApps ? 'Salvar e enviar' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-1 gap-3 rounded-lg border border-border p-3 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className={`text-xs ${texto2}`}>Nome</dt>
            <dd className="break-words font-semibold">{o.nome}</dd>
          </div>
          <div className="min-w-0">
            <dt className={`text-xs ${texto2}`}>Código PDV</dt>
            <dd className="break-words font-mono">{liga ? o.codigoPdv : 'sem código (informativo)'}</dd>
          </div>
          <p className={`text-xs sm:col-span-2 ${texto2}`}>
            O nome, o código PDV e o &quot;Em falta&quot; mudam em Cadastros › Cardápio › Opções.
          </p>
        </dl>

        {/* R3 G3: a foto do complemento e as dos apps (protótipo, "Fotos": cada complemento mostra a do Regem e a de cada app). */}
        <fieldset className="space-y-2 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-bold">Foto</legend>
          <ImageUpload value={foto || undefined} onChange={(url) => setFoto(url ?? '')} alt={o.nome || 'complemento'} maxDim={512} accept="image/png,image/jpeg" />
          {liga && (
            <FotosDosApps
              fotoDoRegem={foto}
              fotoSalva={fotoSalva}
              fotos={fotosDosApps ?? {}}
              noIfood={comIfood}
              na99={com99}
              aoMandar99={aoMandarFoto99}
              aoUsarFoto={
                aoUsarFotoDoApp
                  ? async (canal) => {
                      const url = await aoUsarFotoDoApp(canal);
                      if (url) setFoto(url);
                    }
                  : undefined
              }
            />
          )}
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-bold">Preço em cada canal</legend>
          {!podeMudarPreco && <p className={`text-xs ${texto2}`}>Seu perfil não muda preço: pede &quot;Ver valores em R$&quot;.</p>}
          <p className="text-sm font-bold">Regem <span className={`font-normal ${texto2}`}>(o preço em cada grupo: balcão e cardápio digital)</span></p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {grupos.map((g) => (
              <div key={g.id} className="min-w-0 space-y-1">
                <Label htmlFor={`ec-g-${g.id}`}>Em &quot;{g.nome}&quot;</Label>
                <Input
                  id={`ec-g-${g.id}`}
                  inputMode="decimal"
                  autoComplete="off"
                  value={e.precos[g.id] ?? ''}
                  disabled={!podeMudarPreco}
                  onChange={(x) => mudar({ precos: { ...e.precos, [g.id]: x.target.value } })}
                  className="font-mono"
                />
              </div>
            ))}
          </div>
          {comIfood && liga && (
            <div className="space-y-1 border-t border-border pt-3">
              <Label htmlFor="ec-p-ifood">Preço no iFood</Label>
              <Input
                id="ec-p-ifood"
                inputMode="decimal"
                autoComplete="off"
                value={e.precoIfood}
                disabled={!podeMudarPreco}
                onChange={(x) => mudar({ precoIfood: x.target.value })}
                placeholder="Em branco: o Regem não mexe"
                className="font-mono"
              />
              <p className={`text-xs ${texto2}`}>Um por código ({o.codigoPdv}), em todos os grupos. Vai ao iFood pelo Orzuni.</p>
            </div>
          )}
          {com99 && liga && (
            <div className="space-y-1 border-t border-border pt-3">
              <Label htmlFor="ec-p-99">Preço na 99</Label>
              <Input
                id="ec-p-99"
                inputMode="decimal"
                autoComplete="off"
                value={e.preco99}
                disabled={!podeMudarPreco}
                onChange={(x) => mudar({ preco99: x.target.value })}
                placeholder="Em branco: o Regem não mexe"
                className="font-mono"
              />
              <p className={`text-xs ${texto2}`}>Um por código ({o.codigoPdv}): vai a cada grupo da 99 que tem o complemento.</p>
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-bold">Pausa (em todos os grupos)</legend>
          {o.esgotado && (
            <p className="rounded-md bg-warn/15 px-3 py-2 text-xs">
              <b>Em falta</b>: pausado em todos os canais até sair do &quot;Em falta&quot; em Cadastros › Cardápio › Opções.
            </p>
          )}
          {bloqueio && <p className="rounded-md bg-warn/15 px-3 py-2 text-xs">{bloqueio}</p>}
          <div className="flex flex-wrap gap-x-6">
            <label className={`flex min-h-10 items-center gap-2 text-sm ${pausaTravada ? 'opacity-60' : ''}`}>
              <input type="checkbox" className={caixa} checked={e.pausaRegem} disabled={pausaTravada} onChange={(x) => mudar({ pausaRegem: x.target.checked })} />
              Pausado no Regem
            </label>
            {comIfood && liga && (
              <label className={`flex min-h-10 items-center gap-2 text-sm ${pausaTravada ? 'opacity-60' : ''}`}>
                <input type="checkbox" className={caixa} checked={e.pausaIfood} disabled={pausaTravada} onChange={(x) => mudar({ pausaIfood: x.target.checked })} />
                Pausado no iFood
              </label>
            )}
            {com99 && liga && (
              <label className={`flex min-h-10 items-center gap-2 text-sm ${pausaTravada ? 'opacity-60' : ''}`}>
                <input type="checkbox" className={caixa} checked={e.pausa99} disabled={pausaTravada} onChange={(x) => mudar({ pausa99: x.target.checked })} />
                Pausado na 99
              </label>
            )}
          </div>
          <p className={`text-xs ${texto2}`}>A pausa do Regem tira o complemento do balcão e do cardápio digital; a de cada app, só de lá.</p>
        </fieldset>

        <div aria-live="polite" className="space-y-2">
          {plano.erros.length > 0 && (
            <div role="alert" className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm">
              <b>Corrija antes de salvar:</b>
              <ul className="ml-5 list-disc">{plano.erros.map((m) => <li key={m}>{m}</li>)}</ul>
            </div>
          )}
          {falha && <div role="alert" className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm">{falha}</div>}
          {!mudou ? (
            <p className={`text-sm ${texto2}`}>Nada mudou ainda.</p>
          ) : (
            <div className="rounded-md border border-info bg-info/10 px-3 py-2 text-sm">
              <b>Ao salvar:</b>
              <ul className="ml-5 list-disc">
                {doRegem.length > 0 && <li><b>Regem:</b> {doRegem.join(', ')}.</li>}
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

        {comIfood && liga && <UltimoEnvioIfood alvo="opcao" id={o.opcaoId} />}
        {com99 && liga && <UltimoEnvioIfood alvo="opcao" id={o.opcaoId} canal="99food" />}
      </div>
    </Gaveta>
  );
}
