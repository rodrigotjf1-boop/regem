'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';

// GERENTE NO WHATSAPP (mig 375; protótipo `mockups/regem-central-atendimento.html`, versão 4, grupo "Gerente no
// WhatsApp") — a lista "Quem recebe" do grupo: cada gerente e presidente com o WhatsApp dele (só o final do número), o
// "Ligar o meu WhatsApp" de quem está usando a tela (o código que ele manda do celular à loja) e o "Desligar". O
// servidor confere tudo: só a própria pessoa liga o número dela.

export type PessoaDoWhatsapp = {
  id: string;
  nome: string;
  nivel: string;
  loja: string | null;
  voce: boolean;
  ligado: boolean;
  final: string | null;
  desde: string | null;
  pausado: boolean;
};
export type GrupoDoWhatsapp = {
  ligado: boolean;
  decisoes: boolean;
  ninguemPegou: boolean;
  via: 'cloud' | 'evolution' | null;
  numeroDaLoja: boolean;
  modelo: string | null;
  pessoas: PessoaDoWhatsapp[];
};
type Codigo = { codigo: string; link: string; expiraEm: string };

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const horaCurta = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const primeiroNome = (nome: string) => nome.trim().split(/\s+/)[0] || nome;
const MODELO: Record<string, string> = {
  aprovado: 'aprovado pela Meta',
  pendente: 'em análise na Meta',
  rejeitado: 'recusado pela Meta — fora da janela de 24 h o aviso não sai',
  pausado: 'pausado pela Meta — fora da janela de 24 h o aviso não sai',
  rascunho: 'ainda não enviado à Meta',
};

function situacao(p: PessoaDoWhatsapp): string {
  if (p.ligado) return `Ligado · final ${p.final} · desde ${p.desde ? dataCurta(p.desde) : '—'}${p.pausado ? ' · parado pelo PARAR AVISOS' : ''}`;
  return p.voce ? 'Não ligado' : 'Não ligado · só a própria pessoa liga, entrando com o usuário dela';
}

export function QuemRecebeNoWhatsapp({ grupo, aoMudar }: { grupo: GrupoDoWhatsapp; aoMudar: (g: GrupoDoWhatsapp) => void }) {
  const [ligando, setLigando] = useState(false);
  const [desligando, setDesligando] = useState<PessoaDoWhatsapp | null>(null);
  const [enviando, setEnviando] = useState(false);
  const eu = grupo.pessoas.find((p) => p.voce);

  async function desligar(p: PessoaDoWhatsapp) {
    setEnviando(true);
    try {
      aoMudar(await api.desligarWhatsappDoGestor(p.id));
      toast.success(`WhatsApp de ${primeiroNome(p.nome)} desligado.`);
      setDesligando(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para desligar agora. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <section aria-labelledby="atend-wa-quem" className="space-y-2 border-t border-border py-3">
      <h4 id="atend-wa-quem" className="text-sm font-semibold">
        Quem recebe
      </h4>
      <p className={`text-xs ${texto2}`}>
        Gerentes e presidente. Cada um liga o próprio WhatsApp, pelo celular dele: ninguém liga o número de outra pessoa. Gerente recebe o
        que é da loja dele; presidente, de todas as lojas.
      </p>
      {!grupo.via && (
        <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm" role="status">
          O WhatsApp da loja não está conectado. Conecte em Delivery › WhatsApp para ligar os números.
        </p>
      )}
      {grupo.via === 'cloud' && (
        <p className={`text-xs ${texto2}`}>
          Modelo &quot;Atendimento&quot; (o aviso fora da janela de 24 h da Meta):{' '}
          {grupo.modelo ? (MODELO[grupo.modelo] ?? grupo.modelo) : 'é enviado à Meta quando você liga o ajuste acima'}.
        </p>
      )}
      {grupo.pessoas.length === 0 ? (
        <p className={`text-sm ${texto2}`}>Nenhum gerente ou presidente com acesso nesta empresa.</p>
      ) : (
        <ul className="space-y-2">
          {grupo.pessoas.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border px-3 py-2">
              <span className="min-w-0 font-semibold">
                {p.nome} · {p.nivel}
                {p.loja ? ` · ${p.loja}` : ''}
                {p.voce ? ' (você)' : ''}
              </span>
              <span className={`min-w-0 flex-1 basis-48 text-sm ${texto2}`}>{situacao(p)}</span>
              {p.voce && !p.ligado && (
                <Button type="button" size="sm" disabled={!grupo.via} onClick={() => setLigando(true)}>
                  Ligar o meu WhatsApp
                </Button>
              )}
              {p.ligado && (
                <Button type="button" size="sm" variant="outline" onClick={() => setDesligando(p)}>
                  Desligar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {ligando && eu && (
        <DialogoDeLigar
          desdeAntes={eu.desde}
          aoFechar={() => setLigando(false)}
          aoLigar={(g) => {
            aoMudar(g);
            setLigando(false);
            const novo = g.pessoas.find((p) => p.voce);
            toast.success(`WhatsApp ligado: final ${novo?.final ?? ''}.`);
          }}
        />
      )}

      {desligando && (
        <Dialogo
          titulo={`Desligar o WhatsApp de ${primeiroNome(desligando.nome)}`}
          aoFechar={() => setDesligando(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setDesligando(null)}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" disabled={enviando} onClick={() => void desligar(desligando)}>
                Desligar
              </Button>
            </>
          }
        >
          <p className="text-sm">
            {desligando.voce ? 'Você para' : `${primeiroNome(desligando.nome)} para`} de receber os avisos na hora, e o que esperava o toque
            no WhatsApp deixa de valer. Para voltar, {desligando.voce ? 'você liga' : 'a própria pessoa liga'} de novo, pelo celular.
          </p>
        </Dialogo>
      )}
    </section>
  );
}

/**
 * O código para ligar o próprio WhatsApp: o QR e o link abrem o WhatsApp do celular com "REGEM 123456" pronto para a
 * loja. A tela espera a mensagem (lê o grupo a cada 3 s) até a pessoa aparecer ligada; o código vale 10 min.
 */
function DialogoDeLigar({ desdeAntes, aoFechar, aoLigar }: { desdeAntes: string | null; aoFechar: () => void; aoLigar: (g: GrupoDoWhatsapp) => void }) {
  const [codigo, setCodigo] = useState<Codigo | null>(null);
  const [qr, setQr] = useState('');
  const [erro, setErro] = useState('');
  const [venceu, setVenceu] = useState(false);
  // O aviso de "ligou" por referência: a espera não recomeça a cada desenho de quem abriu o diálogo.
  const aoLigarAgora = useRef(aoLigar);
  aoLigarAgora.current = aoLigar;

  async function gerar() {
    setErro('');
    setVenceu(false);
    setCodigo(null);
    try {
      const r: Codigo = await api.ligarWhatsappDoGestor();
      setCodigo(r);
      QRCode.toDataURL(r.link, { width: 220, margin: 1 })
        .then(setQr)
        .catch(() => setQr(''));
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para gerar o código agora. Tente de novo.');
    }
  }

  useEffect(() => {
    void gerar();
  }, []);

  // Espera a mensagem: a pessoa aparece ligada com outro "desde" (o relógio do servidor, sem comparar com o daqui).
  useEffect(() => {
    if (!codigo || venceu) return;
    let vivo = true;
    const t = setInterval(() => {
      if (Date.now() > new Date(codigo.expiraEm).getTime()) {
        setVenceu(true);
        return;
      }
      api
        .whatsappDoGestor()
        .then((g: GrupoDoWhatsapp) => {
          const eu = g.pessoas.find((p) => p.voce);
          if (vivo && eu?.ligado && eu.desde !== desdeAntes) aoLigarAgora.current(g);
        })
        .catch(() => undefined); // sem rede agora: tenta na próxima
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [codigo, venceu, desdeAntes]);

  return (
    <Dialogo
      titulo="Ligar o meu WhatsApp"
      fecharNoFundo={false}
      aoFechar={aoFechar}
      rodape={
        <Button type="button" variant="outline" onClick={aoFechar}>
          Fechar
        </Button>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          Faça no <b>seu</b> celular: o número que mandar a mensagem fica ligado a você.
        </p>
        {erro ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2" role="alert">
            <span className="min-w-0 flex-1">{erro}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void gerar()}>
              Tentar de novo
            </Button>
          </div>
        ) : !codigo ? (
          <p className={texto2} role="status">
            Gerando o código…
          </p>
        ) : (
          <>
            <ol className="list-decimal space-y-1.5 pl-5">
              <li>
                Aponte a câmera do celular para o código abaixo. Ou, no celular,{' '}
                <a href={codigo.link} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                  abra o WhatsApp por este link
                </a>
                .
              </li>
              <li>
                O WhatsApp abre com a mensagem <b className="font-mono">REGEM {codigo.codigo}</b> para o WhatsApp da loja. Toque em enviar.
              </li>
              <li>Pronto: o Regem responde no seu WhatsApp e esta tela mostra &quot;Ligado&quot;.</li>
            </ol>
            {qr && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr} alt="Código para abrir o WhatsApp com a mensagem pronta" width={176} height={176} className="mx-auto rounded-lg border border-border bg-white p-1" />
            )}
            {venceu ? (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2" role="status">
                <span className="min-w-0 flex-1">O código venceu. Gere outro para ligar.</span>
                <Button type="button" size="sm" onClick={() => void gerar()}>
                  Gerar outro código
                </Button>
              </div>
            ) : (
              <p className={texto2} role="status">
                Esperando a sua mensagem · o código vale até {horaCurta(codigo.expiraEm)} e uma vez só. Um número liga uma pessoa só.
              </p>
            )}
          </>
        )}
      </div>
    </Dialogo>
  );
}
