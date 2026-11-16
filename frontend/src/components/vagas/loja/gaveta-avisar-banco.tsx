'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { ErroDeLeitura } from '@/components/relatorios/pecas';
import { Button } from '@/components/ui/button';
import { dataBr, texto2 } from '@/components/ui/lista';
import { SkeletonList } from '@/components/ui/skeleton';
import { Gaveta } from '@/components/ui/sobreposto';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import type { AvisoDoBanco } from '@/lib/vagas-ficha';

// F4b, parte 1 (protótipo `mockups/regem-vagas-talentos.html`, gaveta "Avisar o banco de talentos", via "sem número de
// marketing" — decisão 3): para a função aberta escolhida, quem recebe (autorizou mensagens, não saiu, não foi avisado dela
// nos últimos 30 dias) com "Abrir no WhatsApp" (a mensagem pronta no WhatsApp de quem avisa) e "Marquei como avisado"
// (guarda no histórico da ficha); quem não recebe, com o motivo. A regra é do servidor; a tela só mostra.

const km = (n: number | null) => (n === null ? null : `${String(Math.round(n * 10) / 10).replace('.', ',')} km`);

export function GavetaAvisarBanco({ funcaoInicial, aoFechar, aoMudar }: { funcaoInicial: string | null; aoFechar: () => void; aoMudar: () => void }) {
  const [funcao, setFuncao] = useState<string | null>(funcaoInicial);
  const [dados, setDados] = useState<AvisoDoBanco | null>(null);
  const [erro, setErro] = useState('');
  const [marcando, setMarcando] = useState<string | null>(null);
  const leitura = useRef(0);

  const carregar = useCallback(async (f: string | null) => {
    const minha = ++leitura.current;
    setErro('');
    try {
      const d = await api.vagasAvisoDoBanco(f);
      if (minha !== leitura.current) return;
      if (!Array.isArray(d?.funcoes) || !Array.isArray(d?.dentro) || !Array.isArray(d?.fora)) throw new Error('A resposta veio incompleta.');
      setDados(d);
    } catch (e) {
      if (minha === leitura.current) setErro(e instanceof Error ? e.message : 'Tente de novo.');
    }
  }, []);
  useEffect(() => {
    carregar(funcao);
  }, [carregar, funcao]);

  const atual = dados?.funcoes.find((f) => f.codigo === dados.funcao) ?? null;
  const marcar = async (id: string, nome: string) => {
    if (!dados?.funcao) return;
    setMarcando(id);
    try {
      const r = await api.vagasMarcarAvisado(id, dados.funcao);
      toast.success(r.jaAvisado ? `${nome.split(' ')[0]} já estava marcado como avisado.` : `${nome.split(' ')[0]} marcado como avisado de ${atual?.nome ?? 'a vaga'}.`);
      await carregar(dados.funcao);
      aoMudar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para marcar.');
    } finally {
      setMarcando(null);
    }
  };

  return (
    <Gaveta
      titulo="Avisar o banco de talentos"
      aoFechar={aoFechar}
      rodape={
        <>
          <span className={`mr-auto self-center text-xs ${texto2}`}>Cada conversa abre no seu WhatsApp.</span>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Fechar
          </Button>
        </>
      }
    >
      <div className="space-y-5" data-gaveta-avisar>
        {erro && !dados ? (
          <ErroDeLeitura oQue="o banco de talentos" motivo={erro} aoTentar={() => carregar(funcao)} />
        ) : !dados ? (
          <SkeletonList />
        ) : !dados.funcoes.length ? (
          <p className="rounded-md border border-dashed border-border p-4 text-sm">
            Nenhuma função está aberta na Página de vagas. Abra uma em Pessoas › Candidatos › Página de vagas.
          </p>
        ) : (
          <>
            <section className="space-y-2">
              <h3 className="font-display text-sm font-bold">A vaga</h3>
              <label className="block text-sm" htmlFor="avisar-funcao">
                Função aberta na Página de vagas
              </label>
              <select
                id="avisar-funcao"
                className="min-h-10 w-full rounded-md border border-input bg-background px-2"
                value={dados.funcao ?? ''}
                onChange={(e) => setFuncao(e.target.value)}
              >
                {dados.funcoes.map((f) => (
                  <option key={f.codigo} value={f.codigo}>
                    {f.nome} — {f.dentro === 1 ? '1 para avisar' : `${f.dentro} para avisar`}
                  </option>
                ))}
              </select>
              {atual?.detalhe && <p className={`text-sm ${texto2}`}>{atual.detalhe}</p>}
            </section>

            <section className="space-y-2">
              <h3 className="font-display text-sm font-bold">Quem recebe ({dados.dentro.length})</h3>
              {dados.dentro.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-4 text-sm">
                  <b className="block">Ninguém para avisar desta função</b>
                  Ninguém do banco de talentos que quer esta função autorizou mensagens, ou todos já foram avisados nos últimos 30 dias.
                </p>
              ) : (
                <ul className="divide-y divide-border" aria-label="Quem recebe o aviso">
                  {dados.dentro.map((p) => (
                    <li key={p.id} className="space-y-2 py-3" data-avisar-pessoa>
                      <div className="min-w-0">
                        <span className="block font-semibold">{p.nome}</span>
                        <span className={`block text-xs ${texto2}`}>
                          {[p.funcoes.join(', '), km(p.distanciaKm), p.autorizouEm ? `autorizou em ${dataBr(p.autorizouEm)}` : null].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a
                          href={p.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex min-h-9 items-center gap-1 rounded-md border border-border bg-card px-3 text-sm font-medium"
                        >
                          <MessageCircle className="h-4 w-4" aria-hidden="true" /> Abrir no WhatsApp
                        </a>
                        <Button type="button" size="sm" variant="outline" disabled={marcando === p.id} onClick={() => void marcar(p.id, p.nome)}>
                          {marcando === p.id ? 'Marcando…' : 'Marquei como avisado'}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {dados.fora.length > 0 && (
              <section className="space-y-2">
                <h3 className="font-display text-sm font-bold">Não recebe ({dados.fora.length})</h3>
                <ul className="divide-y divide-border" aria-label="Quem não recebe o aviso">
                  {dados.fora.map((p) => (
                    <li key={p.id} className="py-2">
                      <span className="block text-sm font-semibold">{p.nome}</span>
                      <span className={`block text-xs ${texto2}`}>{p.motivo}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {dados.dentro[0] && (
              <section className="space-y-2">
                <h3 className="font-display text-sm font-bold">A mensagem</h3>
                <p className="whitespace-pre-line rounded-md bg-secondary p-3 text-sm">{dados.dentro[0].mensagem}</p>
                <p className={`text-xs ${texto2}`}>O nome muda para cada pessoa; o resto vem da Página de vagas.</p>
              </section>
            )}

            <section className="space-y-1">
              <h3 className="font-display text-sm font-bold">Por onde sai</h3>
              <p className="text-sm">
                Pelo seu WhatsApp: cada conversa abre com a mensagem pronta, e &quot;Marquei como avisado&quot; guarda no histórico da ficha (a pessoa só recebe o
                aviso desta função de novo depois de 30 dias). O envio pelo número de marketing da loja chega numa próxima entrega.
              </p>
            </section>
          </>
        )}
      </div>
    </Gaveta>
  );
}
