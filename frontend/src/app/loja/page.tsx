'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, getToken, getCategoria } from '@/lib/api';
import { toast } from '@/lib/toast';
import { buscarCep, geocodificar, localizacaoAtual, mapaEmbedUrl } from '@/lib/geo';
import { Shell } from '@/components/app-shell/shell';
import { Ajustes, alterados, type GrupoDeAjustes, type Valor, type Valores } from '@/components/ui/ajustes';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ImageUpload } from '@/components/ui/image-upload';
import { SkeletonList } from '@/components/ui/skeleton';
import { texto2 } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Os campos de `/cardapio/config` que ESTA tela edita. O mesmo registro tem dezenas de outros
// (tema, horários, frete…), editados em Delivery → Configurações: daqui só saem estes, e só os
// que mudaram — mandar o registro inteiro regravava por cima o que a outra tela tinha salvo.
const CAMPOS = [
  'logoRef', 'nomePublico', 'contatoLoja', 'documento', 'whatsapp', 'instagram', 'subtitulo',
  'endCep', 'endCidade', 'endRua', 'endNumero', 'endBairro', 'endEstado', 'endReferencia', 'endComplemento',
  'endLat', 'endLng', 'pedidoMinimo', 'obsCheckout',
] as const;
const retrato = (cfg: any): Valores => Object.fromEntries(CAMPOS.map((k) => [k, cfg?.[k] ?? '']));

// Configurações → Loja (mockup `mockups/regem-configuracoes.html`): identidade e endereço do
// estabelecimento, no modelo de ajustes. Só o presidente.
export default function LojaPage() {
  const router = useRouter();
  const [salvos, setSalvos] = useState<Valores | null>(null);
  const [valores, setValores] = useState<Valores>({});
  const [idLoja, setIdLoja] = useState('');
  const [erroCarga, setErroCarga] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');
  const [copiado, setCopiado] = useState(false);
  const [msgMapa, setMsgMapa] = useState('');

  const receber = useCallback((cfg: any) => {
    const r = retrato(cfg);
    setSalvos(r);
    setValores(r);
    setIdLoja(cfg?.id ?? '');
  }, []);
  const carregar = useCallback(async () => {
    setErroCarga('');
    try {
      receber((await api.cardapioConfig()) ?? {});
    } catch (e) {
      // Erro não é "loja sem dados": o formulário vazio aqui enganava (e salvar por cima apagaria).
      setErroCarga(e instanceof Error ? e.message : 'Não foi possível carregar os dados da loja.');
    }
  }, [receber]);
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
    void carregar();
  }, [carregar, router]);

  const mudar = useCallback((chave: string, valor: Valor) => setValores((v) => ({ ...v, [chave]: valor })), []);
  const varios = (patch: Valores) => setValores((v) => ({ ...v, ...patch }));

  async function aoSairDoCep(cep: string) {
    const d = await buscarCep(cep);
    if (!d) return;
    setValores((v) => ({ ...v, endRua: d.logradouro || v.endRua, endBairro: d.bairro || v.endBairro, endCidade: d.cidade || v.endCidade, endEstado: d.uf || v.endEstado }));
  }
  async function usarLocalizacao() {
    setMsgMapa('Obtendo localização…');
    try {
      const c = await localizacaoAtual();
      varios({ endLat: c.lat, endLng: c.lng });
      setMsgMapa('Ponto definido pela sua localização.');
    } catch (e) {
      setMsgMapa(e instanceof Error ? e.message : 'Falha ao localizar.');
    }
  }
  async function pontoPeloEndereco() {
    const endereco = [valores.endRua, valores.endNumero, valores.endBairro, valores.endCidade, valores.endEstado].filter(Boolean).join(', ');
    setMsgMapa('Geocodificando o endereço…');
    const c = await geocodificar(endereco || String(valores.endCep ?? ''));
    if (c) {
      varios({ endLat: c.lat, endLng: c.lng });
      setMsgMapa('Ponto definido pelo endereço.');
    } else {
      setMsgMapa('Endereço não encontrado. Confira rua/número/cidade ou use "Usar minha localização".');
    }
  }

  const lat = Number(valores.endLat);
  const lng = Number(valores.endLng);
  const temPonto = String(valores.endLat ?? '') !== '' && Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

  const grupos: GrupoDeAjustes[] = [
    {
      titulo: 'Identidade',
      itens: [
        {
          id: 'logoRef', rotulo: 'Logo da loja (imagem)', tipo: 'livre',
          desenhar: (v, m) => <ImageUpload value={String(v || '') || undefined} onChange={(url) => m(url)} id="logo-loja" alt="Logo da loja" />,
        },
        { id: 'nomePublico', rotulo: 'Nome do estabelecimento', tipo: 'texto' },
        { id: 'contatoLoja', rotulo: 'Telefone de contato', tipo: 'texto', entrada: 'tel' },
        { id: 'documento', rotulo: 'CPF / CNPJ', tipo: 'texto' },
        { id: 'whatsapp', rotulo: 'WhatsApp', tipo: 'texto', placeholder: '+55', entrada: 'tel', opcional: true },
        { id: 'instagram', rotulo: 'Instagram', tipo: 'texto', placeholder: '@sualoja', opcional: true },
        { id: 'subtitulo', rotulo: 'Descrição', ajuda: 'Uma frase sobre a loja (aparece no cardápio).', tipo: 'area', opcional: true },
      ],
    },
    {
      titulo: 'Endereço do estabelecimento',
      nota: 'Ao sair do campo CEP, rua, bairro, cidade e UF são preenchidos sozinhos.',
      itens: [
        { id: 'endCep', rotulo: 'CEP', tipo: 'texto', placeholder: '00000-000', entrada: 'numeric', aoSair: (v) => void aoSairDoCep(v) },
        { id: 'endCidade', rotulo: 'Cidade', tipo: 'texto' },
        { id: 'endRua', rotulo: 'Rua', tipo: 'texto' },
        { id: 'endNumero', rotulo: 'Número', tipo: 'texto' },
        { id: 'endBairro', rotulo: 'Bairro', tipo: 'texto' },
        { id: 'endEstado', rotulo: 'Estado (UF)', tipo: 'texto', maximo: 2 },
        { id: 'endReferencia', rotulo: 'Referência', tipo: 'texto', opcional: true },
        { id: 'endComplemento', rotulo: 'Complemento', tipo: 'texto', opcional: true },
      ],
    },
    {
      titulo: 'Ponto da loja no mapa',
      nota: 'Base para o frete por distância (raio). Defina pelo endereço, pela sua localização, ou ajuste as coordenadas.',
      itens: [
        { id: 'endLat', rotulo: 'Latitude', tipo: 'texto', palavras: 'mapa coordenadas' },
        { id: 'endLng', rotulo: 'Longitude', tipo: 'texto', palavras: 'mapa coordenadas' },
      ],
      depois: (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void pontoPeloEndereco()}>Definir pelo endereço</Button>
            <Button type="button" variant="outline" onClick={() => void usarLocalizacao()}>Usar minha localização</Button>
          </div>
          {msgMapa && <p className={`text-sm ${texto2}`} role="status">{msgMapa}</p>}
          {temPonto ? (
            <iframe title="Mapa da loja" src={mapaEmbedUrl(lat, lng)} className="h-56 w-full rounded-lg border-0" loading="lazy" allowFullScreen />
          ) : (
            <p className={`text-sm ${texto2}`}>Defina o ponto para ver o mapa.</p>
          )}
        </div>
      ),
    },
    {
      titulo: 'Pedidos pelo cardápio',
      itens: [
        { id: 'pedidoMinimo', rotulo: 'Pedido mínimo p/ delivery', tipo: 'texto', placeholder: '0,00', entrada: 'decimal', sufixo: 'R$', opcional: true },
        { id: 'obsCheckout', rotulo: 'Observação antes de finalizar o pedido', ajuda: 'Aparece para o cliente antes de fechar o pedido no cardápio.', tipo: 'area', opcional: true },
      ],
      depois: idLoja ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold">ID do estabelecimento</p>
            <p className="break-all font-mono text-xs">{idLoja}</p>
          </div>
          <Button type="button" variant="outline" onClick={async () => { await navigator.clipboard.writeText(idLoja); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}>
            {copiado ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
      ) : undefined,
    },
  ];

  async function salvar() {
    if (!salvos || salvando) return;
    const chaves = alterados(grupos, valores, salvos);
    if (!chaves.length) return;
    setErro('');
    setSalvando(true);
    try {
      receber(await api.setCardapioConfig(Object.fromEntries(chaves.map((k) => [k, valores[k]]))));
      toast.success('Loja salva.');
      document.getElementById('loja-titulo')?.focus(); // a barra de salvar (e o botão) sai da tela
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar');
    } finally {
      setSalvando(false);
    }
  }

  if (erroCarga)
    return (
      <Shell eyebrow="Configurações" title="Loja">
        <Card className="flex flex-wrap items-center justify-center gap-3 p-8 text-center text-sm">
          <span role="alert">{erroCarga}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void carregar()}>Tentar de novo</Button>
        </Card>
      </Shell>
    );
  if (!salvos)
    return (
      <Shell eyebrow="Configurações" title="Loja">
        <SkeletonList rows={5} />
      </Shell>
    );

  return (
    <Shell eyebrow="Configurações" title="Loja">
      <Ajustes
        id="loja"
        titulo="Dados da loja"
        grupos={grupos}
        valores={valores}
        salvos={salvos}
        aoMudar={mudar}
        aoSalvar={() => void salvar()}
        aoDescartar={() => { setValores(salvos); setErro(''); setMsgMapa(''); document.getElementById('loja-titulo')?.focus(); }}
        salvando={salvando}
        erro={erro}
      />
    </Shell>
  );
}
