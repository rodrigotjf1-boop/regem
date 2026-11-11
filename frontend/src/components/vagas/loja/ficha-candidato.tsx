'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { mascaraCep, mascaraTelefone } from '@/lib/br';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialogo, Gaveta } from '@/components/ui/sobreposto';
import { Selo, hojeIso, texto2 } from '@/components/ui/lista';
import {
  brl, CARGO_ROTULO, COMECA_ROTULO, CURSO_SITUACAO_ROTULO, distanciaTexto, EQUIPE_ROTULO, GRAU_ATUAL_ROTULO, GRAU_FINAL_ROTULO, idadeEm, MEIO_ROTULO, type Distancia,
  nomeDaFuncao, nomeDaOrigem, ORIGEM_ROTULO, SETOR_ROTULO, SEXO_ROTULO, SITUACAO_ROTULO, TEMPO_ROTULO, TURNO_ESTUDO_ROTULO, UBER_ROTULO, VINCULO_ROTULO,
} from '@/lib/vagas-ficha';
import { vagaDoCandidato } from './lista-candidatos';

// A ficha do candidato (gaveta): o funil da situação (novo → em análise → entrevista → aprovado → contratado; banco de
// talentos e "não seguiu" ao lado), o contato, a vaga, as experiências com o selo carteira/informal, a liderança, os
// estudos e cursos, como chega (o que ELE informou), as anotações e o histórico. "Apagar dados" (LGPD) não se desfaz.
const FUNIL = ['novo', 'analise', 'entrevista', 'aprovado', 'contratado'];
const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const semIcone = (s: string | undefined) => (s ?? '').replace(/^\S+\s(?=[A-ZÀ-Ú])/, '');

function Item({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={`text-xs font-bold ${texto2}`}>{rotulo}</dt>
      <dd className="m-0 break-words font-semibold">{children}</dd>
    </div>
  );
}
function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className={`font-display text-xs font-bold uppercase tracking-wider ${texto2}`}>{titulo}</h3>
      {children}
    </section>
  );
}
const Lista = ({ children }: { children: React.ReactNode }) => <dl className="m-0 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2">{children}</dl>;

export function FichaCandidato({ id, nomesDasFuncoes, aoFechar, aoMudar, aoApagar }: {
  id: string; nomesDasFuncoes: Record<string, string>; aoFechar: () => void; aoMudar: () => void; aoApagar: () => void;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [c, setC] = useState<any>(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [nota, setNota] = useState('');
  const [entrevista, setEntrevista] = useState<{ dia: string; hora: string } | null>(null);
  const [apagando, setApagando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setC(await api.vagasCandidato(id));
      setErro('');
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não deu para abrir a ficha.');
    }
  }, [id]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const fazer = async (acao: () => Promise<unknown>, ok: string) => {
    setOcupado(true);
    try {
      await acao();
      toast.success(ok);
      await carregar();
      aoMudar();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu certo. Tente de novo.');
      return false;
    } finally {
      setOcupado(false);
    }
  };

  // F2: medir de novo a distância (a loja acabou de pôr o ponto no mapa, por exemplo) — a resposta já diz se mediu
  const medirDeNovo = async () => {
    setOcupado(true);
    try {
      const d = (await api.vagasMedirDistancia(id)) as Distancia;
      if (d.km !== null) toast.success('Distância medida.');
      else toast.error(distanciaTexto({ ...d, medindo: false }));
      await carregar();
      aoMudar();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não deu para medir agora. Tente de novo.');
    } finally {
      setOcupado(false);
    }
  };

  const titulo = c ? c.nome : 'Ficha do candidato';
  if (erro || !c)
    return (
      <Gaveta titulo={titulo} aoFechar={aoFechar}>
        <p className={texto2}>{erro || 'Carregando a ficha…'}</p>
      </Gaveta>
    );

  const idx = FUNIL.indexOf(c.situacao);
  const trabalho = (c.experiencias ?? []).filter((x: { tipo: string }) => x.tipo === 'trabalho');
  const lideranca = (c.experiencias ?? []).filter((x: { tipo: string }) => x.tipo === 'lideranca');
  const valor = c.valorIda !== null && c.valorVolta !== null ? c.valorIda + c.valorVolta : null;
  const r = c.respostas ?? {};
  const zap = `https://wa.me/55${c.telefone}`;
  const autorizou = c.comunicacao?.aceitaEm && !c.comunicacao?.canceladaEm;

  return (
    <Gaveta
      titulo={titulo}
      aoFechar={aoFechar}
      media
      rodape={
        <>
          <Button type="button" variant="outline" onClick={() => setApagando(true)} disabled={ocupado}>
            Apagar dados
          </Button>
          <Button type="button" variant="outline" onClick={() => setEntrevista({ dia: hojeIso(), hora: '15:00' })} disabled={ocupado}>
            📅 Marcar entrevista
          </Button>
          <Button type="button" onClick={() => window.open(zap, '_blank', 'noopener,noreferrer')}>
            💬 Chamar no WhatsApp
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <p className={`text-sm ${texto2}`}>
          {c.nascimento ? `${idadeEm(c.nascimento, hojeIso())} anos · ` : ''}
          {c.endereco?.bairro}, {c.endereco?.cidade} · protocolo {c.protocolo.slice(0, 3)}-{c.protocolo.slice(3)} · ficha de {quando(c.recebidoEm)}
        </p>

        <Secao titulo="Situação">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5" role="group" aria-label="Situação da ficha">
            {FUNIL.map((s, i) => (
              <button
                key={s}
                type="button"
                aria-pressed={c.situacao === s}
                disabled={ocupado}
                onClick={() => c.situacao !== s && fazer(() => api.vagasSituacao(id, s), 'Situação alterada e registrada no histórico.')}
                className={`min-h-12 rounded-lg border px-2 py-1.5 text-xs font-bold ${
                  c.situacao === s ? 'border-foreground bg-foreground text-background' : idx >= 0 && i < idx ? 'border-ok/40 bg-ok/10 text-ok' : 'border-border bg-card'
                }`}
              >
                {idx >= 0 && i < idx ? '✓ ' : `${i + 1}. `}
                {SITUACAO_ROTULO[s]}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {['banco', 'reprovado'].map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={c.situacao === s ? 'default' : 'outline'}
                aria-pressed={c.situacao === s}
                disabled={ocupado}
                onClick={() => c.situacao !== s && fazer(() => api.vagasSituacao(id, s), 'Situação alterada e registrada no histórico.')}
              >
                {SITUACAO_ROTULO[s]}
              </Button>
            ))}
          </div>
          {c.entrevistaEm && <p className="text-sm">📅 Entrevista: <b>{quando(c.entrevistaEm)}</b></p>}
        </Secao>

        <Secao titulo="Contato">
          <Lista>
            <Item rotulo="WhatsApp">{mascaraTelefone(c.telefone)}</Item>
            {c.email && <Item rotulo="E-mail">{c.email}</Item>}
            <Item rotulo="Sexo">{c.sexo ? SEXO_ROTULO[c.sexo] : 'Não informou'}</Item>
            <Item rotulo="Chegou por">{c.origem ? nomeDaOrigem(c.origem, c.origemNome) : r.origem_declarada ? ORIGEM_ROTULO[r.origem_declarada] : '—'}</Item>
            <Item rotulo="Trabalhando agora">{c.trabalhando ? 'Sim' : 'Não'}</Item>
            <Item rotulo="Começa">{COMECA_ROTULO[c.comeca]}</Item>
            <Item rotulo="Mensagens e e-mails">{autorizou ? '✓ Autorizou (vagas e novidades)' : 'Não autorizou — só sobre esta ficha'}</Item>
          </Lista>
        </Secao>

        <Secao titulo="Vaga desejada">
          <div className="flex flex-wrap gap-1">
            {c.funcoes.map((fn: string) => (
              <Selo key={fn} tom="neutro">
                {nomeDaFuncao(fn, nomesDasFuncoes)}
              </Selo>
            ))}
          </div>
          <Lista>
            <Item rotulo="Tipo e horário">{vagaDoCandidato(c)}</Item>
            <Item rotulo="Setores com facilidade">{c.setores.map((s: string) => semIcone(SETOR_ROTULO[s])).join(', ')}</Item>
            {c.obsHorarios && <Item rotulo="Sobre os horários">{c.obsHorarios}</Item>}
          </Lista>
        </Secao>

        <Secao titulo="Experiência">
          {c.experiencia === 'primeiro' && <p className={texto2}>Primeiro emprego.</p>}
          {trabalho.map((x: Record<string, string | boolean | null>, i: number) => (
            <div key={i} className="rounded-lg border border-border p-3">
              <b className="block">
                {x.funcao} — {x.empresa}
              </b>
              <div className="mt-1 flex flex-wrap gap-1">
                <Selo tom="neutro">{TEMPO_ROTULO[String(x.tempo)]}</Selo>
                <Selo tom={x.vinculo === 'carteira' ? 'ok' : 'aviso'}>{VINCULO_ROTULO[String(x.vinculo)]}</Selo>
                {x.atual && <Selo tom="info">Trabalha lá hoje</Selo>}
              </div>
              {x.descricao && <p className={`mt-1 text-sm ${texto2}`}>{x.descricao}</p>}
            </div>
          ))}
        </Secao>

        {(lideranca.length > 0 || c.liderou === false) && (
          <Secao titulo="Liderança">
            {c.liderou === false && <p className={texto2}>Tem interesse, mas ainda não liderou.</p>}
            {lideranca.map((x: Record<string, string | null>, i: number) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <b className="block">
                  {CARGO_ROTULO[String(x.cargo)]} — {x.empresa}
                </b>
                <div className="mt-1 flex flex-wrap gap-1">
                  <Selo tom="neutro">equipe: {EQUIPE_ROTULO[String(x.equipe)]}</Selo>
                  <Selo tom="neutro">{TEMPO_ROTULO[String(x.tempo)]}</Selo>
                  <Selo tom={x.vinculo === 'carteira' ? 'ok' : 'aviso'}>{VINCULO_ROTULO[String(x.vinculo)]}</Selo>
                </div>
                <p className={`mt-1 text-sm ${texto2}`}>{x.descricao}</p>
              </div>
            ))}
          </Secao>
        )}

        <Secao titulo="Estudos e cursos">
          <Lista>
            <Item rotulo={c.estuda ? 'Estuda agora' : 'Já encerrou os estudos'}>{(c.estuda ? GRAU_ATUAL_ROTULO : GRAU_FINAL_ROTULO)[c.grauEstudo] ?? c.grauEstudo}</Item>
            <Item rotulo={c.estuda ? 'Onde estuda' : 'Onde estudou'}>{c.escola}</Item>
            {c.turnoEstudo && <Item rotulo="Turno da aula">{semIcone(TURNO_ESTUDO_ROTULO[c.turnoEstudo])}</Item>}
          </Lista>
          {(c.cursos ?? []).length === 0 ? (
            <p className={`text-sm ${texto2}`}>Nenhum curso.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {c.cursos.map((x: { nome: string; onde: string; situacao: string }, i: number) => (
                <Selo key={i} tom={x.situacao === 'concluido' ? 'ok' : x.situacao === 'fazendo' ? 'info' : 'aviso'}>
                  {x.nome} · {x.onde} · {CURSO_SITUACAO_ROTULO[x.situacao]}
                </Selo>
              ))}
            </div>
          )}
        </Secao>

        <Secao titulo="Como chega à loja">
          <Lista>
            <Item rotulo="Endereço">
              {[c.endereco?.rua, c.endereco?.numero, c.endereco?.complemento].filter(Boolean).join(', ')}{c.endereco?.cep ? ` · CEP ${mascaraCep(c.endereco.cep)}` : ''}
            </Item>
            <Item rotulo="Distância até a loja (pela rua)">
              <span className="block">{c.distancia ? distanciaTexto(c.distancia) : 'Distância não medida'}</span>
              {c.distancia && c.distancia.km === null && (!c.distancia.medindo || c.distancia.falha) && (
                <Button type="button" size="sm" variant="outline" className="mt-1" disabled={ocupado} onClick={() => void medirDeNovo()}>
                  Medir de novo
                </Button>
              )}
            </Item>
            <Item rotulo="Como vem">{c.meios.map((m: string) => MEIO_ROTULO[m]).join(' + ')}</Item>
            {c.conducoes && <Item rotulo="Conduções (informou)">{c.conducoes >= 4 ? '4 ou mais' : c.conducoes}</Item>}
            {valor !== null && (
              <Item rotulo="Gasta por dia (informou)">
                {brl(valor)} — ida {brl(c.valorIda)} · volta {brl(c.valorVolta)}
              </Item>
            )}
            {c.uberMotivo && <Item rotulo="Por que Uber">{UBER_ROTULO[c.uberMotivo]}{c.uberObs ? ` — ${c.uberObs}` : ''}</Item>}
          </Lista>
        </Secao>

        {(r.cnh || r.feriados || r.ja_trabalhou || r.indicado_por || r.sobre) && (
          <Secao titulo="Outras respostas">
            <Lista>
              {r.cnh && <Item rotulo="CNH A / moto própria">{r.cnh === 'tirando' ? 'Tirando' : r.cnh === 'sim' ? 'Sim' : 'Não'} / {r.moto === 'sim' ? 'Sim' : 'Não'}</Item>}
              {r.feriados && <Item rotulo="Feriados e datas de movimento">{{ sim: 'Sim', alguns: 'Em alguns', nao: 'Não' }[r.feriados as string]}</Item>}
              {r.ja_trabalhou && <Item rotulo="Já trabalhou aqui">{r.ja_trabalhou === 'sim' ? 'Sim' : 'Não'}</Item>}
              {r.indicado_por && <Item rotulo="Indicado por">{r.indicado_por}</Item>}
            </Lista>
            {r.sobre && <p className="rounded-lg bg-secondary p-3 text-sm">“{r.sobre}”</p>}
          </Secao>
        )}

        <Secao titulo="Anotações da entrevista">
          <label htmlFor="ficha-nota" className="sr-only">
            Anotação
          </label>
          <textarea
            id="ficha-nota"
            className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-base"
            maxLength={1000}
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            placeholder="Só a equipe da loja vê. Ex.: comunicativa, já usou chapa a gás…"
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ocupado || !nota.trim()}
            onClick={async () => (await fazer(() => api.vagasAnotar(id, nota.trim()), 'Anotação salva.')) && setNota('')}
          >
            Salvar anotação
          </Button>
        </Secao>

        <Secao titulo="Histórico">
          <ul className="m-0 list-none space-y-2 border-l-2 border-border pl-3">
            {(c.historico ?? []).map((h: { tipo: string; de: string | null; para: string | null; texto: string; autorNome: string | null; criadoEm: string }, i: number) => (
              <li key={i} className="text-sm">
                <time className={`block font-mono text-xs ${texto2}`}>{quando(h.criadoEm)}</time>
                {h.tipo === 'situacao'
                  ? `Situação: ${SITUACAO_ROTULO[h.de ?? ''] ?? h.de} → ${SITUACAO_ROTULO[h.para ?? ''] ?? h.para}`
                  : h.tipo === 'entrevista' && h.para
                    ? `Entrevista marcada para ${quando(h.para)}`
                    : h.tipo === 'anotacao'
                      ? `Anotação: “${h.texto}”`
                      : h.texto}
                {h.autorNome ? ` (${h.autorNome})` : ''}
              </li>
            ))}
          </ul>
          <p className={`text-xs ${texto2}`}>A ficha se apaga sozinha em {c.expurgoEm?.split('-').reverse().join('/')} se não houver contratação.</p>
        </Secao>
      </div>

      {entrevista && (
        <Dialogo
          titulo={`Marcar entrevista — ${c.nome}`}
          aoFechar={() => setEntrevista(null)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setEntrevista(null)}>
                Cancelar
              </Button>
              <Button
                type="button"
                disabled={ocupado || !entrevista.dia || !entrevista.hora}
                onClick={async () => {
                  const iso = new Date(`${entrevista.dia}T${entrevista.hora}:00`).toISOString();
                  if (await fazer(() => api.vagasEntrevista(id, iso), 'Entrevista marcada. Combine com o candidato pelo WhatsApp.')) setEntrevista(null);
                }}
              >
                Marcar entrevista
              </Button>
            </>
          }
        >
          <p className={`mb-3 text-sm ${texto2}`}>A data fica na ficha e a situação vai para &quot;Entrevista&quot;.</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label htmlFor="ent-dia" className="text-sm font-bold">
                Dia
              </label>
              <Input id="ent-dia" type="date" value={entrevista.dia} min={hojeIso()} onChange={(e) => setEntrevista({ ...entrevista, dia: e.target.value })} data-foco-inicial />
            </div>
            <div className="space-y-1">
              <label htmlFor="ent-hora" className="text-sm font-bold">
                Hora
              </label>
              <Input id="ent-hora" type="time" value={entrevista.hora} onChange={(e) => setEntrevista({ ...entrevista, hora: e.target.value })} />
            </div>
          </div>
        </Dialogo>
      )}

      {apagando && (
        <Dialogo
          titulo={`Apagar os dados de ${c.nome}?`}
          alerta
          aoFechar={() => setApagando(false)}
          rodape={
            <>
              <Button type="button" variant="outline" onClick={() => setApagando(false)} data-foco-inicial>
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={ocupado}
                onClick={async () => {
                  setOcupado(true);
                  try {
                    await api.vagasApagar(id);
                    toast.success('Dados apagados. A auditoria guarda só que a ficha foi apagada.');
                    aoApagar();
                  } catch (e) {
                    toast.error(e instanceof Error ? e.message : 'Não deu para apagar. Tente de novo.');
                  } finally {
                    setOcupado(false);
                  }
                }}
              >
                Apagar dados
              </Button>
            </>
          }
        >
          <p className="text-sm">
            A ficha some da base, com experiências, cursos, endereço, anotações e histórico. Fica só o registro de que uma ficha foi apagada, por quem e quando —
            sem os dados. Não dá para desfazer.
          </p>
        </Dialogo>
      )}
    </Gaveta>
  );
}

