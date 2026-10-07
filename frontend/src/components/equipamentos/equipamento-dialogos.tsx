'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { texto2 } from '@/components/ui/lista';
import { ehGogem, tipoDe } from './equipamento';

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

/** Gera o código de 6 dígitos do terminal e mostra quanto tempo ele ainda vale. */
export function CodigoDePareamento({ equipamento, voltarPara, aoFechar }: { equipamento: any; voltarPara: string; aoFechar: () => void }) {
  const [codigo, setCodigo] = useState<{ codigo: string; expiraEm: string } | null>(null);
  const [erro, setErro] = useState('');
  const [resta, setResta] = useState(0);
  const [gerando, setGerando] = useState(false);

  async function gerar() {
    setErro('');
    setGerando(true);
    try {
      const r: any = await api.gerarCodigoTerminal(equipamento.id);
      setCodigo({ codigo: String(r.codigo), expiraEm: r.expiraEm });
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao gerar o código');
    } finally {
      setGerando(false);
    }
  }
  useEffect(() => {
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
            <p>No computador do caixa, abra o PDV e digite este código:</p>
            <p data-codigo aria-label={`Código ${codigo.codigo.split('').join(' ')}`} className={`rounded-md bg-secondary px-4 py-3 text-center font-mono text-3xl font-semibold tracking-[0.3em] ${vencido ? 'line-through opacity-60' : ''}`}>
              {codigo.codigo.slice(0, 3)} {codigo.codigo.slice(3)}
            </p>
            {vencido ? (
              <p role="alert" className="font-medium">Este código venceu. Gere outro.</p>
            ) : (
              <p className={texto2}>Vale por <b role="timer" className="font-mono text-foreground">{relogio(resta)}</b> e por um uso só.</p>
            )}
          </>
        )}
      </div>
    </Dialogo>
  );
}

/** Revogar: o que acontece depende do tipo — e a credencial do totem tem o aviso dela. */
export function RevogarEquipamento({ equipamento, voltarPara, aoFechar, aoRevogar }: { equipamento: any; voltarPara: string; aoFechar: () => void; aoRevogar: () => void }) {
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState('');
  async function confirmar() {
    if (gravando) return;
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
  return (
    <Dialogo alerta titulo="Revogar equipamento" aoFechar={aoFechar} voltarPara={voltarPara}
      rodape={
        <>
          <Button type="button" variant="outline" data-foco-inicial onClick={aoFechar} disabled={gravando}>Cancelar</Button>
          <Button type="button" variant="destructive" onClick={confirmar} disabled={gravando}>{gravando ? 'Revogando…' : 'Revogar'}</Button>
        </>
      }>
      <div className="space-y-3 text-sm">
        <p>Revogar <b>{equipamento.nome}</b> ({tipoDe(equipamento)})?</p>
        {ehGogem(equipamento) && (
          <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2 font-medium">Esta é a credencial do totem (GoGeM): a venda pelo totem para.</p>
        )}
        <p className="rounded-md border-l-4 border-destructive bg-destructive/10 px-3 py-2">
          {impressora
            ? 'A impressora fica inativa e deixa de receber impressões; o que estava direcionado a ela segue os outros destinos ou o padrão do setor. Dá para reativar em Configurações → Impressoras e cupons.'
            : `O aparelho perde o acesso na hora: o token deixa de valer e o pareamento é desfeito.${
                equipamento.tipo === 'kds' ? ' A produção direcionada a ele segue os outros destinos ou o padrão do setor.' : ''
              } Não dá para reativar por esta tela — para voltar a usar, cadastre o equipamento de novo.`}
        </p>
        {erro && <p role="alert" className="font-medium">{erro}</p>}
      </div>
    </Dialogo>
  );
}
