'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ÁLBUM DE SELOS em Sua conta › Benefícios (fase A2 do Clube, mig 479; protótipo `mockups/regem-clube-banner.html`,
// "No cardápio" › Minha conta): um selo por mês com pedido; completo, o cliente escolhe um prêmio da lista e ele vira
// cupom para o próximo pedido (o álbum recomeça). O servidor confere tudo de novo ao escolher.

export type AlbumDoCliente =
  | { ativo: false }
  | {
      ativo: true;
      selos: Array<{ mes: string; rotulo: string; arte: string }>;
      tem: number;
      total: number;
      completo: boolean;
      validadeMeses: number;
      premios: Array<{ id: string; nome: string; descricao: string }>;
    };

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

/** O mês em que o próximo selo pode vir: este, se ainda não tem selo dele; senão, o próximo. (`mes` = AAAA-MM.) */
export function mesDoProximoSelo(meses: string[], agora: Date): string {
  const atual = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const m = meses.includes(atual) ? (agora.getMonth() + 1) % 12 : agora.getMonth();
  return MESES[m];
}

export function AlbumDaConta({
  album,
  token,
  clienteToken,
  aoEscolher,
  avisar,
}: {
  album: AlbumDoCliente;
  token: string;
  clienteToken: string;
  aoEscolher: () => void;
  avisar: (texto: string) => void;
}) {
  const [escolhido, setEscolhido] = useState('');
  const [mandando, setMandando] = useState(false);
  if (!album.ativo) return null;
  const vazios = Math.max(0, album.total - album.selos.length);

  async function escolher() {
    if (!escolhido || mandando) return;
    setMandando(true);
    try {
      const r: any = await api.clienteEscolherDoAlbum(token, clienteToken, escolhido);
      avisar(`Prêmio escolhido: ${r?.premio ?? 'pronto'}. Já está nos seus benefícios.`);
      aoEscolher();
    } catch (e) {
      avisar(e instanceof Error ? e.message : 'Não deu para escolher agora.');
    } finally {
      setMandando(false);
    }
  }

  return (
    <div className="c-sec">
      <h3 className="c-h">
        Álbum de selos · {album.tem} de {album.total}
      </h3>
      <div className="c-album" role="list" aria-label="Selos do álbum">
        {album.selos.map((s) => (
          <div key={s.mes} className="c-selo tem" role="listitem">
            <span aria-hidden="true">{s.arte}</span>
            {s.rotulo}
          </div>
        ))}
        {Array.from({ length: vazios }, (_, i) => (
          <div key={`falta-${i}`} className="c-selo falta" role="listitem">
            <span aria-hidden="true">?</span>
            <span className="sr-only">selo que falta</span>
          </div>
        ))}
      </div>
      {album.completo ? (
        <div className="c-album-escolha">
          <p className="c-album-nota">Você completou o álbum! Escolha 1 prêmio — vale no próximo pedido pelo cardápio ou pelo WhatsApp.</p>
          <div className="c-album-premios" role="group" aria-label="Prêmios do álbum">
            {album.premios.map((p) => (
              <button key={p.id} type="button" className="c-album-premio" aria-pressed={escolhido === p.id} onClick={() => setEscolhido(p.id)}>
                <b>{p.nome}</b>
                <small>{p.descricao}</small>
              </button>
            ))}
          </div>
          <button type="button" className="lk" onClick={() => void escolher()} disabled={!escolhido || mandando}>
            {mandando ? 'Escolhendo…' : 'Quero este'}
          </button>
        </div>
      ) : (
        <p className="c-album-nota">
          {album.total - album.tem === 1
            ? `Peça em ${mesDoProximoSelo(album.selos.map((s) => s.mes), new Date())} e escolha um prêmio.`
            : `Faltam ${album.total - album.tem} selos: um por mês com pedido, não precisam ser seguidos.`}{' '}
          Seus selos valem {album.validadeMeses} meses.
        </p>
      )}
    </div>
  );
}
