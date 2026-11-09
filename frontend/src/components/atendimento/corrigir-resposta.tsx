'use client';

import { useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Dialogo } from '@/components/ui/sobreposto';
import { Select } from '@/components/ui/select';
import {
  ASSUNTOS_DO_CONHECIMENTO,
  MAX_PERGUNTA,
  MAX_RESPOSTA,
  sugerirAssunto,
  umaLinha,
  type AssuntoDoConhecimento,
  type ItemDeConhecimento,
  type OrigemDoConhecimento,
} from '@/lib/treino-do-atendente';

/**
 * "CORRIGIR ESTA RESPOSTA" (F4, protótipo v13): o mesmo diálogo corrige uma resposta do atendente (no teste ou numa
 * conversa real do Direct), ensina uma resposta à mão e edita o que ele aprendeu. Vira um item de conhecimento — o robô
 * usa quando a pergunta do cliente combinar. Toda recusa (vazio, limite) acontece antes de fechar; o servidor confere de
 * novo (quem pode, o limite de 100, o tamanho).
 */
export function CorrigirResposta({
  origem,
  pergunta = '',
  resposta = '',
  item,
  aoSalvar,
  aoFechar,
}: {
  /** De onde veio: o teste, uma conversa real ou à mão. Ao editar, vale a do item. */
  origem: OrigemDoConhecimento;
  /** O que o cliente perguntou (a última mensagem dele antes da resposta). */
  pergunta?: string;
  /** O que o atendente respondeu (só para mostrar; a resposta nova começa vazia). */
  resposta?: string;
  /** Editar um item que já existe. */
  item?: ItemDeConhecimento;
  aoSalvar: (item: ItemDeConhecimento) => void;
  aoFechar: () => void;
}) {
  const sozinho = !!item || origem === 'manual'; // sem a conversa em volta: só os campos
  const [assunto, setAssunto] = useState<AssuntoDoConhecimento>(item?.assunto ?? sugerirAssunto(pergunta));
  const [perg, setPerg] = useState(item?.pergunta ?? umaLinha(pergunta, MAX_PERGUNTA));
  const [resp, setResp] = useState(item?.resposta ?? '');
  const [erro, setErro] = useState('');
  const [salvando, setSalvando] = useState(false);
  const ids = { assunto: useId(), perg: useId(), resp: useId(), conta: useId() };

  const titulo = item ? 'Editar o que o atendente aprendeu' : origem === 'manual' ? 'Ensinar uma resposta ao atendente' : 'Corrigir a resposta do atendente';

  async function salvar() {
    const p = umaLinha(perg, MAX_PERGUNTA);
    const r = resp.trim();
    if (!p) return setErro('Escreva o que o cliente pergunta.');
    if (!r) return setErro('Escreva como o atendente deve responder.');
    setErro('');
    setSalvando(true);
    try {
      const salvo: ItemDeConhecimento = item
        ? await api.atendimentoConhecimentoEditar(item.id, { assunto, pergunta: p, resposta: r })
        : await api.atendimentoConhecimentoCriar({ assunto, pergunta: p, resposta: r, origem });
      toast.success(item ? 'Resposta atualizada.' : 'Ensinado: o atendente passa a usar esta resposta quando a pergunta combinar.');
      aoSalvar(salvo);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      setErro(
        code === 'LIMITE_CONHECIMENTO'
          ? 'O atendente já tem 100 respostas ensinadas. Remova uma em "O que ele aprendeu" antes.'
          : (e as Error)?.message || 'Não deu para salvar agora. Tente de novo.',
      );
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialogo
      titulo={titulo}
      aoFechar={aoFechar}
      fecharNoFundo={false}
      rodape={
        <>
          <Button type="button" variant="outline" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Salvando…' : item ? 'Salvar' : 'Ensinar ao atendente'}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {!sozinho && (
          <div className="space-y-1">
            <p className="font-semibold">O cliente perguntou</p>
            <p className="break-words border-l-4 border-border pl-3">{pergunta || '(sem pergunta antes)'}</p>
            <p className="pt-1 font-semibold">O atendente respondeu</p>
            <p className="whitespace-pre-wrap break-words border-l-4 border-border pl-3">{resposta}</p>
          </div>
        )}
        <div className="space-y-1">
          <label htmlFor={ids.assunto} className="font-semibold">
            Assunto
          </label>
          <Select id={ids.assunto} value={assunto} onChange={(e) => setAssunto(e.target.value as AssuntoDoConhecimento)}>
            {ASSUNTOS_DO_CONHECIMENTO.map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.rotulo}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.perg} className="font-semibold">
            Quando o cliente perguntar
          </label>
          <input
            id={ids.perg}
            type="text"
            value={perg}
            maxLength={MAX_PERGUNTA}
            autoFocus={sozinho}
            autoComplete="off"
            onChange={(e) => setPerg(e.target.value)}
            placeholder="Ex.: Vocês entregam no Recreio?"
            className="flex h-11 w-full rounded-md border border-input bg-card px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-secondary-foreground">Uma linha. Não precisa ser igual: o atendente usa a resposta quando a pergunta combinar.</p>
        </div>
        <div className="space-y-1">
          <label htmlFor={ids.resp} className="font-semibold">
            {sozinho ? 'O atendente responde' : 'O atendente deveria responder'}
          </label>
          <textarea
            id={ids.resp}
            rows={4}
            value={resp}
            maxLength={MAX_RESPOSTA}
            autoFocus={!sozinho}
            aria-describedby={ids.conta}
            onChange={(e) => setResp(e.target.value)}
            placeholder="Escreva como a loja responderia"
            className="w-full min-w-0 rounded-md border border-input bg-card px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p id={ids.conta} className="text-xs text-secondary-foreground">
            {resp.length} de {MAX_RESPOSTA}. Preço, taxa, prazo e horário ele continua tirando do cadastro, mesmo que a resposta traga um valor.
          </p>
        </div>
        <p className="text-xs text-secondary-foreground">Vale para todos os canais do atendente virtual: WhatsApp, Direct, Messenger, o chat do iFood e da 99 e os comentários do Instagram. Só gerente e presidente ensinam.</p>
        {erro && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 font-semibold text-destructive">
            {erro}
          </p>
        )}
      </div>
    </Dialogo>
  );
}
