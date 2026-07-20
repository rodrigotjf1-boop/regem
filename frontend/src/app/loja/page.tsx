'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { buscarCep } from '@/lib/geo';
import { Shell } from '@/components/app-shell/shell';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ImageUpload } from '@/components/ui/image-upload';
import { Campo, PontoLojaMapa } from '@/components/delivery/config-panel';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default function LojaPage() {
  const router = useRouter();
  const [loja, setLoja] = useState<any>(null);
  const [salvando, setSalvando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  const carregar = useCallback(async () => {
    setLoja((await api.cardapioConfig().catch(() => ({}))) ?? {});
  }, []);
  useEffect(() => {
    if (!getToken()) {
      router.replace('/entrar');
      return;
    }
    // Dados da loja são exclusivos do presidente/C&O (não do gerente).
    if (getCategoria() !== 'presidente') {
      router.replace('/painel');
      return;
    }
    carregar();
  }, [carregar, router]);

  const up = (patch: any) => setLoja((x: any) => ({ ...x, ...patch }));

  async function salvar() {
    setSalvando(true);
    try {
      setLoja(await api.setCardapioConfig(loja));
      toast.success('Loja salva.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  if (!loja) {
    return (
      <Shell eyebrow="Configurações" title="Loja">
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </Shell>
    );
  }

  return (
    <Shell eyebrow="Configurações" title="Loja">
      <div className="grid max-w-5xl gap-4 lg:grid-cols-2">
        {/* Identidade */}
        <Card className="space-y-4 p-5">
          <h2 className="font-display text-base font-bold">Identidade</h2>
          <div className="flex items-center gap-3">
            <ImageUpload value={loja.logoRef} onChange={(url) => up({ logoRef: url })} id="logo-loja" alt="Logo da loja" />
            <div className="text-xs text-muted-foreground">Logo da loja (imagem)</div>
          </div>
          <Campo label="Nome do estabelecimento"><Input value={loja.nomePublico ?? ''} onChange={(e) => up({ nomePublico: e.target.value })} /></Campo>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Campo label="Telefone de contato"><Input value={loja.contatoLoja ?? ''} onChange={(e) => up({ contatoLoja: e.target.value })} /></Campo>
            <Campo label="CPF / CNPJ"><Input value={loja.documento ?? ''} onChange={(e) => up({ documento: e.target.value })} /></Campo>
            <Campo label="WhatsApp"><Input value={loja.whatsapp ?? ''} onChange={(e) => up({ whatsapp: e.target.value })} placeholder="+55" /></Campo>
            <Campo label="Instagram"><Input value={loja.instagram ?? ''} onChange={(e) => up({ instagram: e.target.value })} placeholder="@sualoja" /></Campo>
          </div>
          <Campo label="Descrição">
            <textarea
              rows={3}
              value={loja.subtitulo ?? ''}
              onChange={(e) => up({ subtitulo: e.target.value })}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              placeholder="Uma frase sobre a loja (aparece no cardápio)"
            />
          </Campo>
        </Card>

        {/* Endereço + operação */}
        <Card className="space-y-4 p-5">
          <h2 className="font-display text-base font-bold">Endereço do estabelecimento</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Campo label="CEP">
              <Input
                value={loja.endCep ?? ''}
                onChange={(e) => up({ endCep: e.target.value })}
                onBlur={async (e) => {
                  const d = await buscarCep(e.target.value);
                  if (d) up({ endRua: d.logradouro || loja.endRua, endBairro: d.bairro || loja.endBairro, endCidade: d.cidade || loja.endCidade, endEstado: d.uf || loja.endEstado });
                }}
                placeholder="00000-000"
              />
            </Campo>
            <Campo label="Cidade"><Input value={loja.endCidade ?? ''} onChange={(e) => up({ endCidade: e.target.value })} /></Campo>
            <Campo label="Rua"><Input value={loja.endRua ?? ''} onChange={(e) => up({ endRua: e.target.value })} /></Campo>
            <Campo label="Número"><Input value={loja.endNumero ?? ''} onChange={(e) => up({ endNumero: e.target.value })} /></Campo>
            <Campo label="Bairro"><Input value={loja.endBairro ?? ''} onChange={(e) => up({ endBairro: e.target.value })} /></Campo>
            <Campo label="Estado (UF)"><Input value={loja.endEstado ?? ''} onChange={(e) => up({ endEstado: e.target.value })} maxLength={2} /></Campo>
            <Campo label="Referência"><Input value={loja.endReferencia ?? ''} onChange={(e) => up({ endReferencia: e.target.value })} /></Campo>
            <Campo label="Complemento"><Input value={loja.endComplemento ?? ''} onChange={(e) => up({ endComplemento: e.target.value })} /></Campo>
          </div>
          <PontoLojaMapa loja={loja} up={up} pode />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 border-t border-border pt-3">
            <Campo label="Pedido mínimo p/ delivery (R$)"><Input inputMode="decimal" value={loja.pedidoMinimo ?? ''} onChange={(e) => up({ pedidoMinimo: e.target.value })} placeholder="0,00" /></Campo>
          </div>
          <Campo label="Observação antes de finalizar o pedido">
            <textarea
              rows={2}
              value={loja.obsCheckout ?? ''}
              onChange={(e) => up({ obsCheckout: e.target.value })}
              className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm"
              placeholder="Aparece para o cliente antes de fechar o pedido no cardápio"
            />
          </Campo>

          {loja.id && (
            <div className="flex items-center gap-2">
              <Campo label="ID do estabelecimento">
                <Input value={loja.id} readOnly className="font-mono text-xs" />
              </Campo>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-5"
                onClick={async () => { await navigator.clipboard.writeText(loja.id); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}
              >
                {copiado ? 'Copiado' : 'Copiar'}
              </Button>
            </div>
          )}
        </Card>
      </div>

      <div className="sticky bottom-0 mt-4 flex max-w-5xl justify-end border-t border-border bg-background/80 py-3 backdrop-blur">
        <Button type="button" onClick={salvar} disabled={salvando}>
          {salvando ? 'Salvando…' : 'Salvar loja'}
        </Button>
      </div>
    </Shell>
  );
}
