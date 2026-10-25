'use client';

import { useRef, useState } from 'react';
import { Check, ChevronRight, Info, Lock, Plus, ShieldCheck, Store, TriangleAlert, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Chave } from './chave';
import { ParDeSelos } from './autorizar-moldura';
import { dia, plural } from './textos';
import type { PermissaoNaTela, TelaDaAutorizacao } from './clique-tipos';

export type Escolha = { lojas: string[]; opcionais: string[]; senha: string; confirmoOutraEmpresa: boolean };

function Secao({ n, titulo, id, children }: { n: number; titulo: string; id: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-2.5" aria-labelledby={id}>
      <h2 id={id} className="flex items-center gap-2 font-display text-[15px] font-bold">
        <span className="grid h-5 w-5 flex-none place-items-center rounded-full bg-foreground font-mono text-[11px] font-bold text-white">{n}</span>
        {titulo}
      </h2>
      {children}
    </section>
  );
}

const subtitulo = 'font-display text-xs font-bold uppercase tracking-wider text-secondary-foreground';
const ajuda = 'text-[13px] text-secondary-foreground';
const chip = 'rounded-full px-2 py-0.5 text-[11.5px] font-semibold';

/** "Por que o <aplicativo> pede": o motivo que o aplicativo declara, aberto ao tocar. */
function PorQue({ app, motivo }: { app: string; motivo: string }) {
  if (!motivo) return null;
  return (
    <details className="group text-[13px]">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-semibold text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
        Por que o {app} pede
      </summary>
      <p className="mt-1 text-secondary-foreground">{motivo}</p>
    </details>
  );
}

function ItemDePermissao({
  app,
  p,
  ligada,
  aoMudar,
  nova = false,
}: {
  app: string;
  p: PermissaoNaTela;
  /** `undefined` = necessária (sem chave). */
  ligada?: boolean;
  aoMudar?: (v: boolean) => void;
  nova?: boolean;
}) {
  const comChave = ligada !== undefined && aoMudar !== undefined;
  const acesa = comChave ? ligada && p.disponivel : true;
  const idTitulo = `aut-perm-${p.id.replace(/\./g, '-')}`;
  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-2 border-t border-border px-3.5 py-3 first:border-t-0">
      {nova ? (
        <Plus className="mt-0.5 h-[18px] w-[18px] flex-none text-ok" aria-hidden="true" />
      ) : acesa ? (
        <Check className="mt-0.5 h-[18px] w-[18px] flex-none text-ok" aria-hidden="true" />
      ) : (
        <Lock className="mt-0.5 h-[18px] w-[18px] flex-none text-secondary-foreground" aria-hidden="true" />
      )}
      <div className="grid min-w-0 flex-1 basis-48 gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <b id={idTitulo} className={cn('font-bold', !acesa && 'text-secondary-foreground')}>
            {p.rotulo}
          </b>
          {p.dadoPessoal && <span className={cn(chip, 'bg-warn/15 text-foreground')}>Dado pessoal</span>}
          {nova && <span className={cn(chip, 'border border-border bg-secondary text-secondary-foreground')}>Novo</span>}
        </span>
        <span className={ajuda}>{!p.disponivel && p.trava ? p.trava : p.frase}</span>
        {comChave && !acesa && p.disponivel && p.semEla && <span className="text-[12.5px] text-secondary-foreground">{p.semEla}</span>}
        <PorQue app={app} motivo={p.motivo} />
      </div>
      {comChave && (
        <div className="self-center pl-[30px] sm:pl-0">
          <Chave ligada={acesa} travada={!p.disponivel} rotuladaPor={idTitulo} aoMudar={(v) => aoMudar?.(v)} />
        </div>
      )}
    </li>
  );
}

// O formulário da autorização por clique (protótipo "Autorização no Regem", aprovado em 21/10/2026). Os textos vêm do
// servidor (`tela`); a página só desenha e junta a escolha. A senha é a do Regem, e o campo não oferece senha salva:
// o computador da loja é de todos (V54).
export function AutorizarCliqueFormulario({
  tela,
  enviando,
  erroSenha,
  erroConfirmacao,
  aoAutorizar,
  aoCancelar,
}: {
  tela: TelaDaAutorizacao;
  enviando: boolean;
  /** A recusa da senha que veio do servidor (422). */
  erroSenha: string | null;
  erroConfirmacao: boolean;
  aoAutorizar: (e: Escolha) => void;
  aoCancelar: () => void;
}) {
  const app = tela.aplicativo.nome;
  const mais = tela.modo === 'mais';
  const umaLoja = tela.lojas.length === 1;
  const [marcadas, setMarcadas] = useState<Record<string, boolean>>(() => Object.fromEntries(tela.lojas.map((l) => [l.id, l.marcada])));
  // C-1: as opcionais nascem desligadas, o custo também.
  const [ligadas, setLigadas] = useState<Record<string, boolean>>({});
  const [confirmo, setConfirmo] = useState(false);
  const [senha, setSenha] = useState('');
  const [semLoja, setSemLoja] = useState(false);
  const [semConfirmacao, setSemConfirmacao] = useState(false);
  const [senhaVazia, setSenhaVazia] = useState(false);
  const primeiraLoja = useRef<HTMLInputElement>(null);
  const caixaConfirmacao = useRef<HTMLInputElement>(null);
  const campoSenha = useRef<HTMLInputElement>(null);
  const escolhidas = tela.lojas.filter((l) => marcadas[l.id]).map((l) => l.id);
  // O aplicativo de parceiro em teste: até N lojas no total, somando as empresas. As vagas são para LOJA NOVA (a que ele
  // já lê pode ser marcada de novo: é trocada, não soma). Esgotadas, as lojas novas desmarcadas ficam travadas (o
  // servidor confere de novo ao autorizar e na troca).
  const vagas = tela.lojasDoTeste?.vagas ?? null;
  const novasMarcadas = tela.lojas.filter((l) => marcadas[l.id] && !l.conectadaDesde).length;
  const semVaga = vagas !== null && novasMarcadas >= vagas;
  const parceiro = tela.classe === 'parceiro';
  const mostrarConfirmacao = semConfirmacao || erroConfirmacao;
  const mensagemSenha = senhaVazia ? 'Digite a sua senha do Regem para autorizar.' : erroSenha;

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!escolhidas.length) {
      setSemLoja(true);
      primeiraLoja.current?.focus();
      return;
    }
    if (tela.confirmacao && !confirmo) {
      setSemConfirmacao(true);
      caixaConfirmacao.current?.focus();
      return;
    }
    if (!senha) {
      setSenhaVazia(true);
      campoSenha.current?.focus();
      return;
    }
    const opcionais = mais
      ? tela.novas.filter((n) => n.opcional && n.disponivel).map((n) => n.id)
      : [...tela.opcionais, ...tela.dadosDosClientes].filter((p) => p.disponivel && ligadas[p.id]).map((p) => p.id);
    aoAutorizar({ lojas: escolhidas, opcionais, senha, confirmoOutraEmpresa: Boolean(tela.confirmacao) && confirmo });
  }

  const p = tela.contaQuePede;
  return (
    <form onSubmit={enviar} noValidate className="grid w-full max-w-[640px] gap-5 rounded-xl border border-border bg-card p-[18px] sm:gap-[22px] sm:p-[26px]">
      <div className="grid gap-2">
        <ParDeSelos cliente={tela.aplicativo.cliente} rotulo={app} />
        <h1 tabIndex={-1} className="font-display text-[19px] font-extrabold leading-tight focus-visible:outline-none sm:text-[22px]">
          {tela.titulo}
        </h1>
        <p className="text-secondary-foreground">{tela.abertura}</p>
      </div>

      <Secao n={1} titulo="Quem pede" id="aut-quem">
        <ul className="overflow-hidden rounded-[11px] border border-border">
          <li className="grid gap-1 border-t border-border px-3.5 py-3 first:border-t-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <b className="font-bold">{app}</b>
              <span className={cn(chip, 'inline-flex items-center gap-1 bg-ok/15 text-foreground')}>
                <Check className="h-3 w-3" aria-hidden="true" />
                {tela.aplicativo.selo}
              </span>
            </span>
            <span className={ajuda}>
              Aplicativo de {tela.aplicativo.empresa}
              {tela.aplicativo.cnpj ? ` · CNPJ ${tela.aplicativo.cnpj}` : ''}
            </span>
            <details className="group text-[13px]">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-semibold text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
                Detalhes
              </summary>
              <p className="mt-1 text-secondary-foreground">{tela.aplicativo.detalhes}</p>
            </details>
          </li>
          <li className="grid gap-1 border-t border-border px-3.5 py-3 first:border-t-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <User className="h-4 w-4 flex-none text-secondary-foreground" aria-hidden="true" />
              <b className="font-bold">{p.outraEmpresa || parceiro ? `${p.nome}, no ${app}` : `A conta ${p.nome} no ${app}`}</b>
              {/* O parceiro informa a conta (e o CNPJ dela) sozinho: nada de selo verde de "mesma empresa" — o presidente
                  confirma a empresa dona do aplicativo, conferida pela DMS, e não a conta. */}
              <span
                className={cn(
                  chip,
                  parceiro ? 'border border-border bg-secondary text-secondary-foreground' : p.outraEmpresa ? 'bg-warn/15 text-foreground' : 'bg-ok/15 text-foreground',
                )}
              >
                {parceiro ? 'Informada pelo aplicativo' : p.outraEmpresa ? 'Outra empresa' : `A mesma empresa ${umaLoja ? 'desta loja' : 'destas lojas'}`}
              </span>
            </span>
            <span className={cn(ajuda, 'break-words')}>
              {p.cnpj ? `CNPJ ${p.cnpj}` : 'Sem CNPJ informado'} · {p.email}
              {p.marca ? ` · para a marca ${p.marca}` : ''}
            </span>
          </li>
          <li className="grid gap-1 border-t border-border px-3.5 py-3 first:border-t-0">
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Store className="h-4 w-4 flex-none text-secondary-foreground" aria-hidden="true" />
              <b className="font-bold">A sua empresa {tela.empresa.nome} no Regem</b>
            </span>
            <span className={ajuda}>
              {tela.empresa.cnpj ? `CNPJ ${tela.empresa.cnpj} · ` : ''}é a empresa que o {app} vai ler
            </span>
          </li>
        </ul>
      </Secao>

      <Secao n={2} titulo={umaLoja ? 'A loja' : 'Em quais lojas'} id="aut-lojas">
        {tela.ajudaLojas && <p className={ajuda}>{tela.ajudaLojas}</p>}
        {tela.lojas.map((l, i) => {
          const travada = semVaga && !marcadas[l.id] && !l.conectadaDesde;
          return (
            <label
              key={l.id}
              className={cn(
                'grid grid-cols-[auto_1fr] items-start gap-x-3 gap-y-0.5 rounded-[11px] border px-3.5 py-3',
                travada ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
                marcadas[l.id] ? 'border-primary bg-primary/10' : 'border-border',
              )}
            >
              <input
                ref={i === 0 ? primeiraLoja : undefined}
                type="checkbox"
                data-loja={l.id}
                className="mt-0.5 h-[18px] w-[18px] accent-[hsl(var(--primary))]"
                checked={Boolean(marcadas[l.id])}
                disabled={travada}
                aria-invalid={semLoja || undefined}
                aria-describedby={semLoja ? 'aut-lojas-erro' : travada ? 'aut-lojas-vagas' : undefined}
                onChange={(e) => {
                  setMarcadas((m) => ({ ...m, [l.id]: e.target.checked }));
                  setSemLoja(false);
                }}
              />
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <b className="font-bold">{l.nome}</b>
                <span className={cn(chip, 'border border-border bg-secondary text-secondary-foreground')}>{l.tipo}</span>
                {l.conectadaDesde && <span className={cn(chip, 'bg-ok/15 text-foreground')}>Conectada desde {dia(l.conectadaDesde)}</span>}
              </span>
              {l.nota && <small className="col-start-2 text-[12.5px] text-secondary-foreground">{l.nota}</small>}
            </label>
          );
        })}
        {semVaga && tela.lojas.some((l) => !marcadas[l.id] && !l.conectadaDesde) && (
          <p id="aut-lojas-vagas" className="text-[13px] text-secondary-foreground">
            {vagas === 0
              ? 'Sem vaga para outra loja agora.'
              : vagas === 1
                ? 'A vaga desta empresa está marcada: para trocar de loja, desmarque a que está marcada.'
                : `As ${vagas} vagas desta empresa estão marcadas: para trocar, desmarque uma.`}
          </p>
        )}
        {semLoja && (
          <p id="aut-lojas-erro" role="alert" className="text-[13px] font-semibold text-destructive">
            {umaLoja ? 'Marque a loja para autorizar.' : 'Marque ao menos uma loja.'}
          </p>
        )}
      </Secao>

      {mais ? (
        <Secao n={3} titulo="O que muda" id="aut-muda">
          <ul className="overflow-hidden rounded-[11px] border border-border">
            {tela.novas.map((n) => (
              <ItemDePermissao key={n.id} app={app} p={n} nova />
            ))}
          </ul>
          {tela.jaLiberado && (
            <details className="group rounded-[11px] border border-border px-3.5 py-2.5 text-[13px]">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-semibold text-secondary-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
                Já liberado desde {dia(tela.jaLiberado.desde)} ({tela.jaLiberado.permissoes.length})
              </summary>
              <ul className="mt-2 grid gap-1.5">
                {tela.jaLiberado.permissoes.map((j) => (
                  <li key={j.id} className="flex items-center gap-2">
                    <Check className="h-4 w-4 flex-none text-ok" aria-hidden="true" />
                    <b className="font-semibold">{j.rotulo}</b>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </Secao>
      ) : (
        <Secao n={3} titulo={`O que o ${app} vai ver`} id="aut-ve">
          <h3 className={subtitulo}>Necessárias</h3>
          <p className={ajuda}>Sem estas, o {app} não funciona. Para não liberar, cancele.</p>
          <ul className="overflow-hidden rounded-[11px] border border-border">
            {tela.necessarias.map((n) => (
              <ItemDePermissao key={n.id} app={app} p={n} />
            ))}
          </ul>
          {tela.opcionais.length > 0 && (
            <>
              <h3 className={subtitulo}>Opcionais · você decide</h3>
              <ul className="overflow-hidden rounded-[11px] border border-border">
                {tela.opcionais.map((o) => (
                  <ItemDePermissao key={o.id} app={app} p={o} ligada={Boolean(ligadas[o.id])} aoMudar={(v) => setLigadas((x) => ({ ...x, [o.id]: v }))} />
                ))}
              </ul>
            </>
          )}
          {tela.dadosDosClientes.length > 0 && (
            <>
              <h3 className={subtitulo}>Dados dos seus clientes · você decide</h3>
              <ul className="overflow-hidden rounded-[11px] border border-border">
                {tela.dadosDosClientes.map((o) => (
                  <ItemDePermissao key={o.id} app={app} p={o} ligada={Boolean(ligadas[o.id])} aoMudar={(v) => setLigadas((x) => ({ ...x, [o.id]: v }))} />
                ))}
              </ul>
            </>
          )}
        </Secao>
      )}

      <Secao n={4} titulo={`O que o ${app} não pode`} id="aut-nao">
        <ul className="overflow-hidden rounded-[11px] border border-border">
          {tela.naoPode.map((n) => (
            <li key={n.rotulo} className="flex items-start gap-3 border-t border-border px-3.5 py-3 first:border-t-0">
              <Lock className="mt-0.5 h-[18px] w-[18px] flex-none text-secondary-foreground" aria-hidden="true" />
              <span className="grid min-w-0 gap-0.5">
                <b className="font-bold">{n.rotulo}</b>
                <span className={ajuda}>{n.frase}</span>
              </span>
            </li>
          ))}
        </ul>
      </Secao>

      <p className="flex gap-2.5 rounded-[11px] border border-border bg-secondary px-3.5 py-3 text-[13px] text-secondary-foreground">
        <ShieldCheck className="mt-px h-[18px] w-[18px] flex-none text-secondary-foreground" aria-hidden="true" />
        <span>{tela.nota}</span>
      </p>

      {tela.confirmacao && (
        <div className="flex gap-2.5 rounded-[11px] border border-warn/40 bg-warn/10 px-3.5 py-3">
          <TriangleAlert className="mt-0.5 h-[18px] w-[18px] flex-none text-warn" aria-hidden="true" />
          <div className="grid min-w-0 gap-1.5">
            <b className="font-bold">{tela.confirmacao.titulo}</b>
            <p className={ajuda}>{tela.confirmacao.texto}</p>
            <label className="flex items-start gap-2 text-[13.5px] font-semibold">
              <input
                ref={caixaConfirmacao}
                id="aut-confirma"
                type="checkbox"
                className="mt-0.5 h-[18px] w-[18px] flex-none accent-[hsl(var(--primary))]"
                checked={confirmo}
                aria-invalid={mostrarConfirmacao || undefined}
                aria-describedby={mostrarConfirmacao ? 'aut-confirma-erro' : undefined}
                onChange={(e) => {
                  setConfirmo(e.target.checked);
                  setSemConfirmacao(false);
                }}
              />
              {tela.confirmacao.rotulo}
            </label>
          </div>
        </div>
      )}
      {/* Fora da caixa tingida: o vermelho sobre o fundo de atenção fica abaixo de 4,5:1. */}
      {tela.confirmacao && mostrarConfirmacao && !confirmo && (
        <p id="aut-confirma-erro" role="alert" className="-mt-3 text-[13px] font-semibold text-destructive">
          Marque a confirmação para ligar a conta de outra empresa.
        </p>
      )}

      <Secao n={5} titulo="Confirme com a sua senha" id="aut-senha-titulo">
        <div className="grid gap-1.5">
          <label htmlFor="aut-senha" className="text-[13px] font-semibold">
            Senha do Regem
          </label>
          <input
            ref={campoSenha}
            id="aut-senha"
            type="password"
            autoComplete="new-password"
            value={senha}
            onChange={(e) => {
              setSenha(e.target.value);
              setSenhaVazia(false);
            }}
            aria-invalid={mensagemSenha ? true : undefined}
            aria-describedby={mensagemSenha ? 'aut-senha-erro aut-senha-ajuda' : 'aut-senha-ajuda'}
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          {mensagemSenha && (
            <p id="aut-senha-erro" role="alert" className="text-[13px] font-semibold text-destructive">
              {mensagemSenha}
            </p>
          )}
          <p id="aut-senha-ajuda" className="flex items-start gap-1.5 text-[12.5px] text-secondary-foreground">
            <Info className="mt-px h-3.5 w-3.5 flex-none" aria-hidden="true" />A mesma senha de entrar no Regem, nunca o PIN. O {app} não recebe a senha.
          </p>
        </div>
      </Secao>

      <div className="flex flex-wrap justify-end gap-2.5">
        <Button type="button" variant="outline" className="flex-1 font-bold sm:flex-none" onClick={aoCancelar} disabled={enviando}>
          {tela.botoes.cancelar}
        </Button>
        <Button type="submit" className="flex-1 font-bold sm:flex-none" disabled={enviando}>
          {enviando ? 'Autorizando…' : mais || !escolhidas.length ? tela.botoes.autorizar : `${tela.botoes.autorizar} ${plural(escolhidas.length, 'loja', 'lojas')}`}
        </Button>
      </div>
      <p className="text-[12.5px] text-secondary-foreground">{tela.rodape}</p>
    </form>
  );
}
