'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputMoeda } from '@/components/ui/input-moeda';
import { Label } from '@/components/ui/label';
import { Chave } from '@/components/ui/chave';
import { Gaveta } from '@/components/ui/sobreposto';
import { CORES_DAS_AREAS, type AreaEditavel } from './tipos';

// A GAVETA de uma área desenhada (protótipo `mockups/regem-area-entrega-mapa.html`, aprovado em 15/11/2026): nome, taxa,
// pedido mínimo, tempo de entrega (de–até), frete grátis acima de, cor no mapa e "No ar". O desenho se ajusta no mapa.

const numOuVazio = (v: number | null | undefined) => (v == null ? '' : String(v));
const numOuNulo = (v: string) => (v.trim() === '' ? null : Number(v));

export function GavetaArea({
  area,
  nova,
  pode,
  aoSalvar,
  aoCancelar,
  aoAjustarDesenho,
}: {
  area: AreaEditavel;
  nova: boolean;
  pode: boolean;
  aoSalvar: (a: AreaEditavel) => void;
  aoCancelar: () => void;
  aoAjustarDesenho: () => void;
}) {
  const [nome, setNome] = useState(area.nome);
  const [taxa, setTaxa] = useState(String(area.taxa ?? 0));
  const [minimo, setMinimo] = useState(numOuVazio(area.pedidoMinimo));
  const [gratis, setGratis] = useState(numOuVazio(area.freteGratisAcima));
  const [de, setDe] = useState(numOuVazio(area.tempoMin));
  const [ate, setAte] = useState(numOuVazio(area.tempoMax));
  const [cor, setCor] = useState(area.cor ?? CORES_DAS_AREAS[0]);
  const [ativo, setAtivo] = useState(area.ativo);
  const [erro, setErro] = useState('');

  function salvar() {
    const n = nome.trim();
    if (!n) return setErro('Dê um nome à área.');
    const t1 = numOuNulo(de);
    const t2 = numOuNulo(ate);
    if (t1 != null && t2 != null && t2 < t1) return setErro('O tempo "até" tem de ser maior ou igual ao "de".');
    aoSalvar({
      ...area,
      nome: n.slice(0, 40),
      taxa: Number(taxa) || 0,
      pedidoMinimo: numOuNulo(minimo),
      freteGratisAcima: numOuNulo(gratis),
      tempoMin: t1,
      tempoMax: t2,
      cor,
      ativo,
    });
  }

  return (
    <Gaveta
      titulo={nova ? 'Nova área' : 'Editar área'}
      aoFechar={aoCancelar}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoCancelar}>
            Cancelar
          </Button>
          {pode && (
            <Button type="button" onClick={salvar}>
              Salvar área
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="area-nome">Nome da área</Label>
          <Input id="area-nome" data-foco-inicial value={nome} maxLength={40} onChange={(e) => setNome(e.target.value)} disabled={!pode} />
          <p className="mt-1 text-xs text-muted-foreground">Aparece para a equipe e na via do pedido (o cliente vê só a taxa).</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="area-taxa">Taxa de entrega</Label>
            <InputMoeda id="area-taxa" value={taxa} onChange={setTaxa} disabled={!pode} ariaLabel="Taxa de entrega" />
          </div>
          <div>
            <Label htmlFor="area-minimo">
              Pedido mínimo <span className="font-normal text-muted-foreground">(opcional)</span>
            </Label>
            <InputMoeda id="area-minimo" value={minimo} onChange={setMinimo} disabled={!pode} ariaLabel="Pedido mínimo" placeholder="sem mínimo" />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="area-de">Tempo de entrega, de (min)</Label>
            <Input id="area-de" type="number" inputMode="numeric" min={0} step={5} value={de} onChange={(e) => setDe(e.target.value)} disabled={!pode} />
          </div>
          <div>
            <Label htmlFor="area-ate">até (min)</Label>
            <Input id="area-ate" type="number" inputMode="numeric" min={0} step={5} value={ate} onChange={(e) => setAte(e.target.value)} disabled={!pode} />
          </div>
        </div>
        <div>
          <Label htmlFor="area-frete-gratis">
            Frete grátis acima de <span className="font-normal text-muted-foreground">(opcional)</span>
          </Label>
          <InputMoeda id="area-frete-gratis" value={gratis} onChange={setGratis} disabled={!pode} ariaLabel="Frete grátis acima de" placeholder="segue o da loja" />
          <p className="mt-1 text-xs text-muted-foreground">Vazio = segue o frete grátis da loja.</p>
        </div>
        <div>
          <span id="area-cor" className="mb-1 block text-sm font-medium">
            Cor no mapa
          </span>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby="area-cor">
            {CORES_DAS_AREAS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={c === cor}
                aria-label={`Cor ${c}`}
                disabled={!pode}
                onClick={() => setCor(c)}
                className="h-9 w-9 rounded-md border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-foreground"
                style={{ background: c, borderColor: c === cor ? undefined : 'transparent' }}
              />
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
          <span>
            <b className="block text-sm">No ar</b>
            <span className="text-xs text-muted-foreground">Pausada, o endereço dela fica fora da área (o desenho continua).</span>
          </span>
          <Chave ligada={ativo} aoMudar={setAtivo} rotulo={`Área ${nome || 'nova'} no ar`} ocupada={!pode} />
        </div>
        {pode && (
          <Button type="button" variant="outline" className="w-full" onClick={aoAjustarDesenho}>
            ✎ Ajustar o desenho no mapa
          </Button>
        )}
        {erro && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {erro}
          </p>
        )}
      </div>
    </Gaveta>
  );
}
