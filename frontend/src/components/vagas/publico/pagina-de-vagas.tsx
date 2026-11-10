'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { hojeIso } from '@/components/ui/lista';
import { corpoDoEnvio, fichaVazia, origemDeclaradaDoLink, type FichaForm, type PaginaPublica } from '@/lib/vagas-ficha';
import { varsDoTema } from './tema';
import { Capa } from './capa';
import { Formulario } from './formulario';
import { Recebida } from './recebida';
import './vagas.css';

// A página pública de vagas (/v/<codigo>, sem login): carrega a página da loja (só ligada e com o módulo ligado), mostra
// a capa, a ficha em 7 etapas e a ficha recebida. Nada aqui guarda a ficha no aparelho (dado pessoal).
export function PaginaDeVagas({ codigo, origem }: { codigo: string; origem: string | null }) {
  const [p, setP] = useState<PaginaPublica | null>(null);
  const [falha, setFalha] = useState<'nao-achou' | 'rede' | null>(null);
  const [tela, setTela] = useState<'capa' | 'ficha' | 'ok'>('capa');
  const [f, setF] = useState<FichaForm>(() => fichaVazia(origemDeclaradaDoLink(origem)));
  const [enviando, setEnviando] = useState(false);
  const [erroDoEnvio, setErroDoEnvio] = useState('');
  const [protocolo, setProtocolo] = useState('');
  const hoje = useMemo(() => hojeIso(), []);

  const carregar = useCallback(async () => {
    setFalha(null);
    try {
      setP(await api.vagasPaginaPublica(codigo));
    } catch (e: unknown) {
      setFalha((e as { status?: number })?.status === 404 ? 'nao-achou' : 'rede');
    }
  }, [codigo]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const muda = useCallback(<K extends keyof FichaForm>(k: K, v: FichaForm[K]) => setF((o) => ({ ...o, [k]: v })), []);

  const enviar = async () => {
    setEnviando(true);
    setErroDoEnvio('');
    try {
      const r = await api.vagasEnviarFicha(codigo, corpoDoEnvio(f, origem));
      setProtocolo(String(r?.protocolo ?? ''));
      setTela('ok');
      window.scrollTo({ top: 0 });
    } catch (e: unknown) {
      const st = (e as { status?: number })?.status;
      setErroDoEnvio(
        st === 429
          ? 'Muitas tentativas seguidas. Espere um minuto e envie de novo.'
          : e instanceof Error && e.message
            ? e.message
            : 'Não conseguimos enviar agora. Confira a internet e tente de novo.',
      );
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="vg-palco">
      <main className="vg-root" style={varsDoTema(p?.cores)}>
        {!p && !falha && (
          <div className="vg-estado" aria-busy="true">
            Carregando as vagas…
          </div>
        )}
        {falha === 'nao-achou' && (
          <div className="vg-estado">
            <h1>Página de vagas não encontrada</h1>
            <p>Esta página não existe ou está fechada no momento. Confira o link com a loja.</p>
          </div>
        )}
        {falha === 'rede' && (
          <div className="vg-estado">
            <h1>Não conseguimos abrir as vagas</h1>
            <p>Confira a internet e tente de novo.</p>
            <button type="button" className="vg-cta" onClick={carregar}>
              Tentar de novo
            </button>
          </div>
        )}
        {p && tela === 'capa' && (
          <Capa
            p={p}
            aoComecar={() => {
              setTela('ficha');
              window.scrollTo({ top: 0 });
            }}
          />
        )}
        {p && tela === 'ficha' && (
          <Formulario p={p} f={f} muda={muda} hoje={hoje} enviando={enviando} erroDoEnvio={erroDoEnvio} aoSair={() => setTela('capa')} aoEnviar={enviar} />
        )}
        {p && tela === 'ok' && (
          <Recebida
            p={p}
            protocolo={protocolo}
            nome={f.nome}
            whatsapp={f.whatsapp}
            codigo={codigo}
            aoVoltar={() => {
              setF(fichaVazia(origemDeclaradaDoLink(origem)));
              setTela('capa');
              window.scrollTo({ top: 0 });
            }}
          />
        )}
      </main>
    </div>
  );
}
