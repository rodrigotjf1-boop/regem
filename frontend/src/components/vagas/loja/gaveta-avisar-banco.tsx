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
import { viaManda, type AvisoDoBanco, type ViaNaTela } from '@/lib/vagas-ficha';

// F4b (protótipo `mockups/regem-vagas-talentos.html`, gaveta "Avisar o banco de talentos"; decisões 3, 4 e 5). Para a
// função aberta escolhida, quem recebe (autorizou mensagens, não saiu, não foi avisado dela nos últimos 30 dias) e quem
// não recebe, com o motivo. Por onde sai, decidido pelo servidor (o número de marketing da loja e o modelo na Meta):
//  • sem número de marketing (parte 1): "Abrir no WhatsApp" com a mensagem pronta e "Marquei como avisado";
//  • pelo número de marketing (parte 2, mig 438): marcar quem recebe e "Avisar N pessoas" — a fila manda uma por vez, no
//    ritmo das campanhas. Na oficial, só com o modelo `vaga_aberta` aprovado (o "Enviar o modelo à Meta" pede).
// A regra é do servidor; a tela só mostra.

const km = (n: number | null) => (n === null ? null : `${String(Math.round(n * 10) / 10).replace('.', ',')} km`);
const pessoas = (n: number) => (n === 1 ? '1 pessoa' : `${n} pessoas`);

/** O que o bloco "Por onde sai" diz em cada via (os textos do protótipo; sem prometer o que o servidor não faz). */
function porOndeSai(v: ViaNaTela): { icone: string; texto: string } {
  const final = v.final ? ` (final ${v.final})` : '';
  switch (v.via) {
    case 'oficial_aprovado':
      return { icone: '✅', texto: `Sai pelo número de marketing da loja${final}, com o modelo vaga_aberta aprovado pela Meta. A Meta cobra cada conversa de marketing na conta da loja, pela tabela dela.` };
    case 'oficial_analise':
      return { icone: '⏳', texto: 'O modelo vaga_aberta foi enviado à Meta e está em análise. O botão libera quando a Meta aprovar.' };
    case 'oficial_sem_modelo':
      return { icone: '📝', texto: `O número de marketing da loja${final} está na API oficial, e o modelo vaga_aberta ainda não foi enviado à Meta. Envie o modelo: o botão libera quando ela aprovar.` };
    case 'oficial_recusado':
      return { icone: '⛔', texto: `A Meta recusou (ou pausou) o modelo vaga_aberta${v.motivoDaMeta ? `: ${v.motivoDaMeta.replace(/\.+$/, '')}.` : '.'} Fale com o suporte para ajustar o texto.` };
    case 'evolution':
      return {
        icone: '⚠️',
        texto: `Sai pelo número de marketing conectado pelo Evolution${final}, uma mensagem a cada 20 segundos (o ritmo das campanhas). Mensagem para quem não falou com a loja aumenta o risco de o WhatsApp bloquear o número.`,
      };
    default:
      return { icone: '📱', texto: 'A loja não tem número de marketing. Abra cada conversa no seu WhatsApp com a mensagem pronta e marque como avisado: fica no histórico da ficha e conta para os 30 dias.' };
  }
}

export function GavetaAvisarBanco({ funcaoInicial, aoFechar, aoMudar }: { funcaoInicial: string | null; aoFechar: () => void; aoMudar: () => void }) {
  const [funcao, setFuncao] = useState<string | null>(funcaoInicial);
  const [dados, setDados] = useState<AvisoDoBanco | null>(null);
  const [erro, setErro] = useState('');
  const [marcando, setMarcando] = useState<string | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [enviando, setEnviando] = useState(false);
  const [pedindo, setPedindo] = useState(false);
  const leitura = useRef(0);

  const carregar = useCallback(async (f: string | null) => {
    const minha = ++leitura.current;
    setErro('');
    try {
      const d = await api.vagasAvisoDoBanco(f);
      if (minha !== leitura.current) return;
      if (!Array.isArray(d?.funcoes) || !Array.isArray(d?.dentro) || !Array.isArray(d?.fora)) throw new Error('A resposta veio incompleta.');
      setDados(d);
      // Quem pode receber já vem marcado (como no protótipo); quem espera na fila, não.
      setMarcados(new Set(d.dentro.filter((p) => !p.naFila).map((p) => p.id)));
    } catch (e) {
      if (minha === leitura.current) setErro(e instanceof Error ? e.message : 'Tente de novo.');
    }
  }, []);
  useEffect(() => {
    carregar(funcao);
  }, [carregar, funcao]);

  const atual = dados?.funcoes.find((f) => f.codigo === dados.funcao) ?? null;
  const via: ViaNaTela = dados?.via ?? { via: 'sem', final: null, motivo: null, motivoDaMeta: null };
  const pelaFila = via.via !== 'sem';
  const pode = viaManda(via.via);
  const n = dados ? dados.dentro.filter((p) => !p.naFila && marcados.has(p.id)).length : 0;

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

  const avisar = async () => {
    if (!dados?.funcao || !n) return;
    setEnviando(true);
    try {
      const ids = dados.dentro.filter((p) => !p.naFila && marcados.has(p.id)).map((p) => p.id);
      const r = await api.vagasAvisarPeloMarketing(dados.funcao, ids);
      const fora = r.ficaramDeFora ? ` ${pessoas(r.ficaramDeFora)} ficou de fora (a ficha mudou desde que a gaveta abriu).` : '';
      toast.success(`${r.entraram === 1 ? '1 aviso entrou' : `${r.entraram} avisos entraram`} na fila do número de marketing. Cada ficha guarda no histórico quando o aviso sai.${fora}`);
      await carregar(dados.funcao);
      aoMudar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para avisar.');
    } finally {
      setEnviando(false);
    }
  };

  const pedirModelo = async () => {
    setPedindo(true);
    try {
      await api.vagasPedirModeloDaVaga();
      toast.success('O modelo vaga_aberta foi enviado à Meta. O botão libera quando ela aprovar.');
      await carregar(dados?.funcao ?? funcao);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para enviar o modelo.');
    } finally {
      setPedindo(false);
    }
  };

  const trocar = (id: string, sim: boolean) =>
    setMarcados((s) => {
      const novo = new Set(s);
      if (sim) novo.add(id);
      else novo.delete(id);
      return novo;
    });

  const sai = porOndeSai(via);
  // A mensagem do modelo: o texto da vaga (o mesmo da parte 1) com as respostas da via — os botões na oficial, escritas no Evolution.
  const corpoDaMensagem = dados?.dentro[0]?.mensagem.split('\n\n')[0] ?? '';

  return (
    <Gaveta
      titulo="Avisar o banco de talentos"
      aoFechar={aoFechar}
      rodape={
        pelaFila && dados?.funcoes.length ? (
          <>
            <span className={`mr-auto self-center text-xs ${texto2}`} aria-live="polite" data-avisar-resumo>
              {n === 1 ? '1 pessoa marcada' : `${n} pessoas marcadas`}
            </span>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Cancelar
            </Button>
            <Button type="button" disabled={!pode || !n || enviando} onClick={() => void avisar()} data-avisar-enviar>
              {enviando ? 'Avisando…' : `Avisar ${pessoas(n)}`}
            </Button>
          </>
        ) : (
          <>
            <span className={`mr-auto self-center text-xs ${texto2}`}>Cada conversa abre no seu WhatsApp.</span>
            <Button type="button" variant="outline" onClick={aoFechar}>
              Fechar
            </Button>
          </>
        )
      }
    >
      <div className="space-y-5" data-gaveta-avisar data-via={via.via}>
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
              {!!dados.naFila && pelaFila && (
                <p className={`text-xs ${texto2}`} data-avisar-na-fila>
                  {pessoas(dados.naFila)} {dados.naFila === 1 ? 'espera' : 'esperam'} na fila do número de marketing.
                </p>
              )}
              {dados.dentro.length === 0 ? (
                <p className="rounded-md border border-dashed border-border p-4 text-sm">
                  <b className="block">Ninguém para avisar desta função</b>
                  Ninguém do banco de talentos que quer esta função autorizou mensagens, ou todos já foram avisados nos últimos 30 dias.
                </p>
              ) : (
                <ul className="divide-y divide-border" aria-label="Quem recebe o aviso">
                  {dados.dentro.map((p) => {
                    const detalhe = [p.funcoes.join(', '), km(p.distanciaKm), p.autorizouEm ? `autorizou em ${dataBr(p.autorizouEm)}` : null].filter(Boolean).join(' · ');
                    if (pelaFila)
                      return (
                        <li key={p.id} className="flex items-start gap-3 py-3" data-avisar-pessoa>
                          <input
                            id={`avisar-${p.id}`}
                            type="checkbox"
                            className="mt-1 h-5 w-5 flex-none accent-[hsl(var(--primary))]"
                            checked={!p.naFila && marcados.has(p.id)}
                            disabled={!!p.naFila}
                            onChange={(e) => trocar(p.id, e.target.checked)}
                          />
                          <label htmlFor={`avisar-${p.id}`} className="min-w-0 flex-1">
                            <span className="block font-semibold">
                              {p.nome}
                              {p.naFila && <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-xs font-medium">na fila</span>}
                            </span>
                            <span className={`block text-xs ${texto2}`}>{detalhe}</span>
                          </label>
                        </li>
                      );
                    return (
                      <li key={p.id} className="space-y-2 py-3" data-avisar-pessoa>
                        <div className="min-w-0">
                          <span className="block font-semibold">{p.nome}</span>
                          <span className={`block text-xs ${texto2}`}>{detalhe}</span>
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
                    );
                  })}
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
                {pelaFila ? (
                  <div className="rounded-md bg-secondary p-3 text-sm" data-avisar-mensagem>
                    <p className="whitespace-pre-line">{corpoDaMensagem}</p>
                    {via.via === 'evolution' ? (
                      <p className="mt-2">Responda *Tenho interesse* para participar, ou SAIR para não receber mais.</p>
                    ) : (
                      <>
                        <p className={`mt-2 text-xs ${texto2}`}>Responda SAIR para não receber mais.</p>
                        <div className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
                          {['Tenho interesse', 'Não quero mais receber'].map((b) => (
                            <span key={b} className="rounded-md border border-border bg-card px-2 py-1 text-center text-sm font-medium">
                              {b}
                            </span>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <p className="whitespace-pre-line rounded-md bg-secondary p-3 text-sm">{dados.dentro[0].mensagem}</p>
                )}
                <p className={`text-xs ${texto2}`}>
                  {pelaFila && via.via !== 'evolution'
                    ? 'O texto é o do modelo aprovado pela Meta; o nome muda para cada pessoa e o resto vem da Página de vagas.'
                    : 'O nome muda para cada pessoa; o resto vem da Página de vagas.'}
                </p>
              </section>
            )}

            <section className="space-y-2" data-avisar-por-onde>
              <h3 className="font-display text-sm font-bold">Por onde sai</h3>
              <div className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                <span aria-hidden="true">{sai.icone}</span>
                <p className="min-w-0">{sai.texto}</p>
              </div>
              {via.via === 'oficial_sem_modelo' && (
                <Button type="button" variant="outline" disabled={pedindo} onClick={() => void pedirModelo()} data-avisar-pedir-modelo>
                  {pedindo ? 'Enviando…' : 'Enviar o modelo à Meta'}
                </Button>
              )}
            </section>
          </>
        )}
      </div>
    </Gaveta>
  );
}
