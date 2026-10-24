'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { Input } from '@/components/ui/input';
import { DIAS_PARA_REATIVAR, conectadoAgora, ehGogem, haQuanto, minutosDesde, tipoDe, ultimoSinal } from './equipamento';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Os três diálogos da lista de Equipamentos: o token (aparece uma vez), o código de pareamento
// (vale 15 minutos e um uso) e a confirmação de revogar.

/** O token recém-criado. Fechar sem ter copiado pede uma segunda vez: ele não aparece de novo. */
export function TokenDoEquipamento({ nome, token, aviso, voltarPara, aoFechar }: { nome: string; token: string; aviso?: string; voltarPara: string; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  const [avisado, setAvisado] = useState(false);
  const [erro, setErro] = useState('');
  const pedirFechar = () => (copiado || avisado ? aoFechar() : setAvisado(true));
  async function copiar() {
    setErro('');
    try {
      await navigator.clipboard.writeText(token);
      setCopiado(true);
    } catch {
      setErro('O navegador não deixou copiar. Selecione o token e copie à mão.');
    }
  }
  return (
    <Dialogo alerta titulo={`Token de ${nome}`} aoFechar={pedirFechar} voltarPara={voltarPara} fecharNoFundo={false}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={() => void copiar()}>{copiado ? 'Copiado' : 'Copiar'}</Button>
          <Button type="button" onClick={aoFechar}>Já guardei, fechar</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2">
          <b>Aparece só agora.</b> Guarde antes de fechar — por segurança, ele não será exibido de novo. Use no pareamento do aparelho.
        </p>
        <code data-token className="block select-all break-all rounded-md bg-secondary px-3 py-2 font-mono text-sm">{token}</code>
        {aviso && <p role="status" className="rounded-md border-l-4 border-warn bg-warn/10 px-3 py-2">{aviso}</p>}
        {avisado && !copiado && <p role="alert" className="font-medium">Copie ou anote o token antes de fechar. Para fechar assim mesmo, use “Já guardei, fechar”.</p>}
        {erro && <p role="alert" className="font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}

const relogio = (seg: number) => `${String(Math.floor(seg / 60)).padStart(2, '0')}:${String(seg % 60).padStart(2, '0')}`;

/** Onde digitar o código, como o servidor manda (`common/onde-digitar.ts`) — o mesmo texto do ícone do servidor. */
export type OndeDigitar = { titulo: string; passos: string[]; obs?: string };
export type CodigoGerado = { codigo: string; expiraEm: string; onde?: OndeDigitar | null };

/** Gera o código de 6 dígitos do terminal e mostra quanto tempo ele ainda vale. */
export function CodigoDePareamento({
  equipamento, inicial, voltarPara, aoFechar,
}: {
  equipamento: any;
  /** Código já gerado pelo servidor (a reativação devolve um): mostra este, sem gerar outro. */
  inicial?: CodigoGerado | null;
  voltarPara: string;
  aoFechar: () => void;
}) {
  const [codigo, setCodigo] = useState<CodigoGerado | null>(inicial ?? null);
  const [erro, setErro] = useState('');
  const [resta, setResta] = useState(0);
  const [gerando, setGerando] = useState(false);

  async function gerar() {
    setErro('');
    setGerando(true);
    try {
      const r: any = await api.gerarCodigoTerminal(equipamento.id);
      setCodigo({ codigo: String(r.codigo), expiraEm: r.expiraEm, onde: r.onde ?? null });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar o código');
    } finally {
      setGerando(false);
    }
  }
  useEffect(() => {
    if (inicial) return;
    void gerar();
    // Uma vez, ao abrir: gerar de novo é pelo botão (cada código gerado invalida o anterior).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!codigo) return;
    const contar = () => setResta(Math.max(0, Math.round((new Date(codigo.expiraEm).getTime() - Date.now()) / 1000)));
    contar();
    const t = setInterval(contar, 1000);
    return () => clearInterval(t);
  }, [codigo]);

  const vencido = !!codigo && resta <= 0;
  return (
    <Dialogo titulo={`Código de pareamento — ${equipamento.nome}`} aoFechar={aoFechar} voltarPara={voltarPara} fecharNoFundo={false}
      rodape={
        <>
          {(vencido || erro) && <Button type="button" variant="outline" onClick={() => void gerar()} disabled={gerando}>{gerando ? 'Gerando…' : 'Gerar outro'}</Button>}
          <Button type="button" data-foco-inicial onClick={aoFechar}>Fechar</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        {erro ? (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-medium">{erro}</p>
        ) : !codigo ? (
          <p className={texto2} role="status">Gerando o código…</p>
        ) : (
          <>
            {/* Onde digitar (parear sem reinstalar, 22/10/2026): os passos vêm do servidor (`common/onde-digitar.ts`), os
                mesmos do ícone do servidor. A estação pareia pelo ícone "Regem neste PC"; o instalador é só para PC novo. */}
            {codigo.onde ? (
              <div className="space-y-1">
                <p className="font-semibold">{codigo.onde.titulo}:</p>
                <ol className="list-decimal space-y-0.5 pl-5">
                  {codigo.onde.passos.map((p) => <li key={p}>{p}</li>)}
                </ol>
                {equipamento.tipo === 'tela_senhas' && (
                  <p className={texto2}>
                    Na primeira vez, abra no navegador da TV{' '}
                    <strong className="break-all font-mono text-foreground">{typeof window !== 'undefined' ? `${window.location.origin}/senhas` : '/senhas'}</strong>.
                  </p>
                )}
              </div>
            ) : (
              <p>{equipamento.tipo === 'tela_senhas' ? 'Na TV de senhas, digite este código:' : 'Digite este código no aparelho:'}</p>
            )}
            <p data-codigo aria-label={`Código ${codigo.codigo.split('').join(' ')}`} className={`rounded-md bg-secondary px-4 py-3 text-center font-mono text-3xl font-semibold tracking-[0.3em] ${vencido ? 'line-through opacity-60' : ''}`}>
              {codigo.codigo.slice(0, 3)} {codigo.codigo.slice(3)}
            </p>
            {vencido ? (
              <p role="alert" className="font-medium">Este código venceu. Gere outro.</p>
            ) : (
              <p className={texto2}>Vale por <b role="timer" className="font-mono text-foreground">{relogio(resta)}</b> e por um uso só.</p>
            )}
            {codigo.onde?.obs && <p className={`text-xs ${texto2}`}>{codigo.onde.obs}</p>}
          </>
        )}
      </div>
    </Dialogo>
  );
}

/** Revogar: o que acontece depende do tipo — e a credencial do totem tem o aviso dela. */
export function RevogarEquipamento({
  equipamento, todos = [], voltarPara, aoFechar, aoRevogar,
}: { equipamento: any; todos?: any[]; voltarPara: string; aoFechar: () => void; aoRevogar: () => void }) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  const [digitado, setDigitado] = useState('');
  // Servidor da loja: revogar tira a loja inteira da sincronização — confirma digitando o nome
  // (ERR-236: em 14/10/2026 o servidor em uso foi revogado com um clique).
  const servidor = equipamento.tipo === 'servidor_local' && !ehGogem(equipamento);
  const normal = (t: string) => t.trim().replace(/\s+/g, ' ').toLowerCase();
  const nomeOk = !servidor || normal(digitado) === normal(equipamento.nome);
  const sinal = ultimoSinal(equipamento);
  const emUso = !!sinal && minutosDesde(sinal) < 60 && equipamento.tipo !== 'impressora';
  async function confirmar() {
    if (gravando || !nomeOk) return;
    setErro('');
    setGravando(true);
    try {
      await api.revogarEquipamento(equipamento.id);
      toast.success('Equipamento revogado.');
      aoRevogar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao revogar');
      setGravando(false);
    }
  }
  const impressora = equipamento.tipo === 'impressora';
  // Impressoras ligadas nesta estação: só ela as imprime (o servidor da loja deixa de lado as que têm
  // estação — `SQL_RESERVAR`), e estação revogada não entra mais (`validarEstacao`).
  const ligadas = equipamento.tipo === 'estacao_impressao'
    ? todos.filter((x) => x.tipo === 'impressora' && x.ativo && x.estacaoId === equipamento.id).map((x) => x.nome)
    : [];
  return (
    <Dialogo alerta titulo="Revogar equipamento" aoFechar={aoFechar} voltarPara={voltarPara}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={gravando}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={confirmar} disabled={gravando || !nomeOk}>{gravando ? 'Revogando…' : 'Revogar'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>Revogar <b>{equipamento.nome}</b> ({tipoDe(equipamento)})?</p>
        {equipamento.tipo !== 'impressora' && (
          <p className={texto2}>
            Último sinal:{' '}
            {sinal ? (
              <b className="font-mono text-foreground">
                {new Date(sinal).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} ({haQuanto(sinal)})
              </b>
            ) : (
              'nenhum registrado'
            )}
            .
          </p>
        )}
        {emUso && (
          <p role="alert" className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2 font-semibold">
            {conectadoAgora(equipamento) ? (
              <>
                Este PC está conectado agora
                {equipamento.presenca?.maquina ? `: ${equipamento.presenca.maquina}` : ''}
                {equipamento.presenca?.ip ? ` (${equipamento.presenca.ip})` : ''}, última resposta{' '}
                {(() => {
                  const s = Math.max(0, Math.round((Date.now() - Date.parse(equipamento.presenca.vistoEm)) / 1000));
                  return s < 60 ? `há ${s} s` : haQuanto(equipamento.presenca.vistoEm);
                })()}
                . Revogar fecha o acesso dele na hora.
              </>
            ) : (
              <>Este equipamento deu sinal {haQuanto(sinal!)}: ele está em uso agora.</>
            )}
          </p>
        )}
        {ehGogem(equipamento) && (
          <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2 font-medium">Esta é a credencial do totem (GoGeM): a venda pelo totem para.</p>
        )}
        {equipamento.tipo === 'estacao_impressao' && (
          <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2 font-medium">
            {ligadas.length
              ? `A estação deixa de imprimir. ${
                  ligadas.length === 1 ? `A impressora ${ligadas[0]} fica sem quem a imprima` : `As impressoras ${ligadas.join(', ')} ficam sem quem as imprima`
                } até você escolher outro “Ligada em” em Configurar.`
              : 'A estação deixa de imprimir. Nenhuma impressora está ligada nela.'}
          </p>
        )}
        <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
          {impressora
            ? 'A impressora fica inativa e deixa de receber impressões; o que estava direcionado a ela segue os outros destinos ou o padrão do setor.'
            : servidor
              ? // SyncTokenGuard recusa a chave inativa (401): o sincronismo para nos dois sentidos; a licença local
                // não muda com o 401 (`licenca()` do sync-daemon só mexe com resposta ok) — a loja segue vendendo.
                'A chave dele deixa de valer: o servidor da loja para de sincronizar com a nuvem. O que vem da nuvem (pedidos que entram por ela, mudanças de cadastro) para de chegar a ele, e o que for vendido nele para de subir. A loja continua vendendo pelo servidor.'
              : `O aparelho perde o acesso na hora: o token deixa de valer e o pareamento é desfeito.${
                  equipamento.tipo === 'kds' ? ' A produção direcionada a ele segue os outros destinos ou o padrão do setor.' : ''
                }`}{' '}
          Dá para desfazer em até {DIAS_PARA_REATIVAR} dias, em “Revogados” → Reativar.
        </p>
        {servidor && (
          <div className="space-y-1.5">
            <label htmlFor="revogar-nome" className="block font-medium">
              Para confirmar, digite o nome do servidor: <b className="break-words">{equipamento.nome}</b>
            </label>
            <Input id="revogar-nome" value={digitado} onChange={(e) => setDigitado(e.target.value)} autoComplete="off" />
          </div>
        )}
        {erro && <p role="alert" className="font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}

/**
 * Reativar (ERR-236): desfaz uma revogação de até 30 dias. O que acontece depende do tipo — o servidor
 * (`EquipamentoService.reativar`) decide e devolve o código quando o PC tem de parear de novo.
 */
export function ReativarEquipamento({
  equipamento, voltarPara, aoFechar, aoReativar,
}: { equipamento: any; voltarPara: string; aoFechar: () => void; aoReativar: (r: any) => void }) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  const comCodigo = ['pdv', 'salao', 'estacao_impressao'].includes(equipamento.tipo);
  async function confirmar() {
    if (gravando) return;
    setErro('');
    setGravando(true);
    try {
      const r: any = await api.reativarEquipamento(equipamento.id);
      toast.success(`${equipamento.nome} reativado.`);
      aoReativar(r);
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao reativar');
      setGravando(false);
    }
  }
  return (
    <Dialogo titulo="Reativar equipamento" aoFechar={aoFechar} voltarPara={voltarPara}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar} disabled={gravando}>Cancelar</Button>
          <Button type="button" data-foco-inicial onClick={confirmar} disabled={gravando}>{gravando ? 'Reativando…' : 'Reativar'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>Reativar <b>{equipamento.nome}</b> ({tipoDe(equipamento)})?</p>
        <p className="rounded-md border-l-4 border-input bg-secondary px-3 py-2">
          {equipamento.tipo === 'servidor_local' && !ehGogem(equipamento)
            ? 'O servidor da loja volta a sincronizar com a mesma chave, no próximo ciclo dele: não precisa reinstalar. Se a loja já tem outro servidor dando sinal, a reativação é recusada — ficariam dois.'
            : comCodigo
              ? 'Sai um código novo de 6 dígitos (vale 15 minutos): digite-o no PC para ele voltar — o pareamento foi desfeito na revogação.'
              : 'Ele volta com a mesma configuração que tinha.'}
        </p>
        {erro && <p role="alert" className="font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
