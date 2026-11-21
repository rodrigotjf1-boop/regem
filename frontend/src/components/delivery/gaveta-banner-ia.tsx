'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Gaveta } from '@/components/ui/sobreposto';

// "✨ CRIAR BANNER COM IA" (fase B2 do `docs/plano-clube-e-banner.md`; protótipo `mockups/regem-clube-banner.html`, gaveta
// `g-ia`; mig 485). A imagem sai do DMS Graph, pela franquia de imagem da empresa. Por padrão a IA não escreve: o título e a
// chamada vão por cima, pelo Regem, e mudam sem gerar outra imagem. Quem decide se pode criar é o servidor.

export type BannerDaIa = {
  imagemRef: string;
  textoTitulo: string | null;
  textoChamada: string | null;
  descricao: string | null;
  feitoComIa: true;
};

type Situacao = {
  pode: boolean;
  podeCriar: boolean;
  podeEditar: boolean;
  podeMelhorar: boolean;
  mensagem: string | null;
  franquia: { usados: number; total: number } | null;
};

const FOTO_MAX = 5 * 1024 * 1024;
const TIPOS_DA_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const sel = 'flex w-full rounded-md border border-input bg-card px-3 py-2 text-sm';

function novaChave() {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function PreviaDoBanner({ rotulo, imagem, titulo, chamada, classe }: { rotulo: string; imagem: string; titulo: string; chamada: string; classe: string }) {
  return (
    <figure className="min-w-0 space-y-1">
      <figcaption className="text-xs font-semibold text-secondary-foreground">{rotulo}</figcaption>
      <div className={`relative w-full overflow-hidden rounded-md bg-secondary ${classe}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imagem} alt="" className="h-full w-full object-cover" />
        {(titulo || chamada) && (
          <div className="absolute inset-x-0 bottom-0 grid gap-0.5 bg-gradient-to-t from-black/85 via-black/60 to-transparent px-3 pb-2 pt-6 text-white">
            {titulo && <b className="line-clamp-2 text-sm leading-tight [overflow-wrap:anywhere]">{titulo}</b>}
            {chamada && <span className="line-clamp-2 text-xs leading-tight [overflow-wrap:anywhere]">{chamada}</span>}
          </div>
        )}
      </div>
    </figure>
  );
}

export function GavetaBannerIa({
  salvando,
  aoFechar,
  aoUsar,
}: {
  salvando: boolean;
  aoFechar: () => void;
  aoUsar: (b: BannerDaIa) => void;
}) {
  const id = useId();
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [erroLeitura, setErroLeitura] = useState('');
  const [pedido, setPedido] = useState('');
  const [antes, setAntes] = useState<string | null>(null);
  const [melhorando, setMelhorando] = useState(false);
  const [foto, setFoto] = useState<File | null>(null);
  const [textoPelaIa, setTextoPelaIa] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [chamada, setChamada] = useState('');
  const [criando, setCriando] = useState(false);
  const [imagem, setImagem] = useState<string | null>(null);
  const [descricao, setDescricao] = useState('');
  const [erro, setErro] = useState('');
  const arquivo = useRef<HTMLInputElement>(null);
  // Repetir o MESMO pedido depois de uma queda usa a mesma chave: o Graph devolve a imagem sem gastar outra.
  const tentativa = useRef<{ assinatura: string; chave: string } | null>(null);

  const ler = useCallback(() => {
    setErroLeitura('');
    setSituacao(null);
    api
      .bannerIaSituacao()
      .then((s: Situacao) => setSituacao(s))
      .catch((e: Error) => setErroLeitura(e.message || 'Não deu para ler a situação agora.'));
  }, []);
  useEffect(ler, [ler]);

  const pronto = !!imagem;
  const bloqueado = criando || melhorando;
  const faltaFoto = !!situacao && !situacao.podeCriar && situacao.podeEditar && !foto;
  // A mesma regra do servidor (`conferirPedidoDoBanner`): sem texto, a IA não teria o que escrever e a imagem seria gasta.
  const faltaTexto = textoPelaIa && !titulo.trim() && !chamada.trim();

  function escolherFoto(f: File | undefined) {
    if (arquivo.current) arquivo.current.value = '';
    if (!f) return;
    if (!TIPOS_DA_FOTO.includes(f.type)) return setErro('A foto precisa ser JPG, PNG ou WebP.');
    if (f.size > FOTO_MAX) return setErro('A foto passa de 5 MB.');
    setErro('');
    setFoto(f);
  }

  async function melhorar() {
    const atual = pedido.trim();
    if (!atual) return setErro('Escreva o que você quer no banner.');
    setErro('');
    setMelhorando(true);
    try {
      const r = await api.bannerIaMelhorar(atual);
      setAntes(antes ?? atual);
      setPedido(r.pedido);
    } catch (e) {
      setErro((e as Error).message || 'Não deu para melhorar o pedido agora.');
    } finally {
      setMelhorando(false);
    }
  }

  async function criar() {
    const atual = pedido.trim();
    if (!atual) return setErro('Escreva o que você quer no banner.');
    if (faltaFoto) return setErro('Esta empresa só pode criar a partir de uma foto. Envie uma foto.');
    if (faltaTexto) return setErro('Para a IA escrever na imagem, preencha o Título ou a Chamada.');
    setErro('');
    const assinatura = JSON.stringify([atual, foto?.name, foto?.size, foto?.lastModified, textoPelaIa, textoPelaIa ? titulo.trim() : '', textoPelaIa ? chamada.trim() : '']);
    if (tentativa.current?.assinatura !== assinatura) tentativa.current = { assinatura, chave: novaChave() };
    setCriando(true);
    try {
      const r = await api.bannerIaCriar(
        { pedido: atual, chave: tentativa.current.chave, textoPelaIa: String(textoPelaIa), titulo: titulo.trim(), chamada: chamada.trim() },
        foto,
      );
      if (!r.ok) {
        setErro(r.mensagem);
        return;
      }
      tentativa.current = null;
      setImagem(r.imagemRef);
      setDescricao((d) => d || atual.slice(0, 200));
      if (r.franquia) setSituacao((s) => (s ? { ...s, franquia: r.franquia } : s));
    } catch (e) {
      setErro((e as Error).message || 'Não deu para criar o banner agora. Tente de novo.');
    } finally {
      setCriando(false);
    }
  }

  function criarOutra() {
    tentativa.current = null;
    setImagem(null);
    setErro('');
  }

  function usar() {
    if (!imagem) return;
    aoUsar({
      imagemRef: imagem,
      textoTitulo: textoPelaIa ? null : titulo.trim() || null,
      textoChamada: textoPelaIa ? null : chamada.trim() || null,
      descricao: descricao.trim() || null,
      feitoComIa: true,
    });
  }

  const f = situacao?.franquia;
  const acabou = !!f && f.usados >= f.total;
  const legendaPrevia = textoPelaIa ? { titulo: '', chamada: '' } : { titulo: titulo.trim(), chamada: chamada.trim() };

  return (
    <Gaveta
      titulo="✨ Criar banner com IA"
      media
      aoFechar={() => {
        // A imagem em andamento já está sendo paga: a gaveta espera ela chegar.
        if (!criando) aoFechar();
      }}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={criando}>Cancelar</Button>
          {pronto ? (
            <>
              <Button type="button" variant="outline" onClick={criarOutra} disabled={salvando || acabou}>Criar outra</Button>
              <Button type="button" onClick={usar} disabled={salvando}>{salvando ? 'Salvando…' : 'Usar este banner'}</Button>
            </>
          ) : (
            situacao?.pode && (
              <Button type="button" onClick={criar} disabled={bloqueado || !pedido.trim() || faltaTexto}>{criando ? 'Criando…' : 'Criar banner'}</Button>
            )
          )}
        </>
      }
    >
      <div className="space-y-4">
        {!situacao && !erroLeitura && <p role="status" className="text-sm text-secondary-foreground">Conferindo a franquia de imagens…</p>}
        {erroLeitura && (
          <div role="alert" className="space-y-2 rounded-md border border-destructive/40 p-3">
            <p className="text-sm font-semibold text-destructive">{erroLeitura}</p>
            <Button type="button" size="sm" variant="outline" onClick={ler}>Tentar de novo</Button>
          </div>
        )}
        {situacao && !situacao.pode && !pronto && (
          <div role="status" className="space-y-1 rounded-md border border-border bg-secondary p-3 text-sm">
            <p className="font-semibold">{situacao.mensagem}</p>
            <p className="text-secondary-foreground">Você ainda pode enviar uma imagem pronta em "＋ Banner".</p>
          </div>
        )}

        {situacao?.pode && !pronto && (
          <>
            <p className="rounded-md bg-secondary/60 px-3 py-2 text-xs text-secondary-foreground">
              A imagem sai larga, com o assunto no centro, porque o recorte muda entre o celular e o computador.
            </p>
            <div className="space-y-1">
              <label htmlFor={`${id}-pedido`} className="text-sm font-semibold">O que você quer no banner</label>
              <textarea
                id={`${id}-pedido`}
                className={`${sel} min-h-[88px]`}
                maxLength={1000}
                value={pedido}
                disabled={bloqueado}
                onChange={(e) => setPedido(e.target.value)}
                placeholder="Ex.: hambúrguer duplo com bacon, fundo escuro, clima de sexta à noite"
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={melhorar} disabled={bloqueado || !pedido.trim() || !situacao.podeMelhorar}>
                  {melhorando ? 'Melhorando…' : 'Melhorar o pedido'}
                </Button>
                {!situacao.podeMelhorar && <span className="text-xs text-secondary-foreground">Precisa da chave de IA em Mister › IA e uso.</span>}
              </div>
              {antes !== null && (
                <div className="space-y-1 rounded-md bg-secondary/60 px-3 py-2 text-xs">
                  <p className="[overflow-wrap:anywhere]"><b>Você escreveu:</b> {antes}</p>
                  <button type="button" className="font-semibold underline underline-offset-2" disabled={bloqueado} onClick={() => { setPedido(antes); setAntes(null); }}>
                    Voltar ao meu texto
                  </button>
                </div>
              )}
            </div>

            {situacao.podeEditar && (
              <div className="space-y-1">
                <label htmlFor={`${id}-foto`} className="text-sm font-semibold">Foto junto (opcional)</label>
                <input
                  ref={arquivo}
                  id={`${id}-foto`}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className={foto ? 'sr-only' : 'block w-full text-sm'}
                  disabled={bloqueado}
                  onChange={(e) => escolherFoto(e.target.files?.[0])}
                />
                {foto && (
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="min-w-0 [overflow-wrap:anywhere]">{foto.name} · {(foto.size / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB</span>
                    <Button type="button" size="sm" variant="outline" disabled={bloqueado} onClick={() => arquivo.current?.click()}>Trocar</Button>
                    <Button type="button" size="sm" variant="outline" disabled={bloqueado} onClick={() => setFoto(null)}>Tirar</Button>
                  </div>
                )}
                <p className="text-xs text-secondary-foreground">A IA usa como referência (a foto do seu produto). JPG, PNG ou WebP até 5 MB.</p>
              </div>
            )}

            <div className="space-y-1.5">
              <span id={`${id}-texto`} className="text-sm font-semibold">Texto do banner</span>
              <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby={`${id}-texto`}>
                <Button type="button" size="sm" variant={!textoPelaIa ? 'default' : 'outline'} aria-pressed={!textoPelaIa} disabled={bloqueado} onClick={() => setTextoPelaIa(false)}>
                  Por cima, escrito pelo Regem
                </Button>
                <Button type="button" size="sm" variant={textoPelaIa ? 'default' : 'outline'} aria-pressed={textoPelaIa} disabled={bloqueado} onClick={() => setTextoPelaIa(true)}>
                  A IA escreve na imagem
                </Button>
              </div>
              {textoPelaIa && (
                <p aria-live="polite" className={`text-xs text-secondary-foreground ${faltaTexto ? 'font-semibold' : ''}`}>
                  {faltaTexto ? 'Preencha o Título ou a Chamada: é o que a IA vai escrever na imagem.' : 'A IA pode errar letras. Para mudar o texto depois, é preciso criar outra imagem.'}
                </p>
              )}
            </div>
          </>
        )}

        {(situacao?.pode || pronto) && (!textoPelaIa || !pronto) && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor={`${id}-titulo`} className="text-sm font-semibold">Título</label>
              <Input id={`${id}-titulo`} maxLength={60} value={titulo} disabled={bloqueado} onChange={(e) => setTitulo(e.target.value)} placeholder="Sextou com bacon" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-chamada`} className="text-sm font-semibold">Chamada</label>
              <Input id={`${id}-chamada`} maxLength={90} value={chamada} disabled={bloqueado} onChange={(e) => setChamada(e.target.value)} placeholder="Duplo bacon, só hoje" />
            </div>
          </div>
        )}

        {criando && (
          <p role="status" className="rounded-md bg-secondary px-3 py-2 text-sm font-semibold">
            Criando o banner no DMS Graph… pode levar até um minuto.
          </p>
        )}

        {imagem && (
          <div className="space-y-3">
            <span className="text-sm font-semibold">Prévia</span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <PreviaDoBanner rotulo="No celular" imagem={imagem} {...legendaPrevia} classe="aspect-[5/2]" />
              <PreviaDoBanner rotulo="No computador" imagem={imagem} {...legendaPrevia} classe="aspect-[3/1]" />
            </div>
            <div className="space-y-1">
              <label htmlFor={`${id}-descricao`} className="text-sm font-semibold">Texto para leitor de tela</label>
              <textarea id={`${id}-descricao`} className={`${sel} min-h-[64px]`} maxLength={200} value={descricao} onChange={(e) => setDescricao(e.target.value)} />
            </div>
          </div>
        )}

        {erro && <p role="alert" className="text-sm font-semibold text-destructive">{erro}</p>}
        {f && (
          <p className="text-xs text-secondary-foreground">
            Franquia de imagens: <b>{f.usados} de {f.total}</b> usadas neste mês · cada imagem custa cerca de R$ 0,20, pagos pela DMS.
          </p>
        )}
      </div>
    </Gaveta>
  );
}
