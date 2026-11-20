'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { Gaveta } from '@/components/ui/sobreposto';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { REPETE, TIPOS_DA_LOJA, type ItemDoCalendario } from './tipos';

// "＋ Evento da loja" e "Editar" (protótipo, aba "Calendário", a gaveta "Evento da loja"): nome, tipo, dia (seletor
// nativo), a hora em que começa (opcional, seletor nativo) e se repete. O servidor confere tudo de novo
// (`lerEventoDaLoja`) e grava na loja em uso.

export function GavetaEventoDaLoja({
  evento,
  diaInicial,
  aoFechar,
  aoSalvar,
}: {
  /** Editar este evento; ausente = criar. */
  evento?: ItemDoCalendario | null;
  /** O dia que o "criar" já traz (hoje). */
  diaInicial: string;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState(evento?.nome ?? '');
  const [tipo, setTipo] = useState(evento?.tipo ?? 'promocao');
  const [dia, setDia] = useState(evento?.diaDoCadastro ?? diaInicial);
  const [hora, setHora] = useState(evento?.hora ?? '');
  const [repete, setRepete] = useState(evento?.repete ?? 'nao');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState('');

  async function salvar() {
    if (nome.trim().length < 2) return setErro('Dê um nome ao evento.');
    if (!dia) return setErro('Escolha o dia do evento.');
    setSalvando(true);
    setErro('');
    const corpo = { nome: nome.trim(), tipo, dia, hora: hora || null, repete };
    try {
      if (evento?.id) await api.calendarioEditarEvento(evento.id, corpo);
      else await api.calendarioCriarEvento(corpo);
      toast.success(evento?.id ? 'Evento salvo.' : 'Evento incluído no calendário.');
      aoSalvar();
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : 'Não consegui salvar o evento agora. Tente de novo.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Gaveta
      titulo={evento?.id ? 'Editar evento da loja' : 'Evento da loja'}
      aoFechar={aoFechar}
      rodape={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" onClick={aoFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void salvar()} disabled={salvando}>
            {salvando ? 'Salvando…' : 'Salvar evento'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <Label htmlFor="evento-loja-nome">Nome</Label>
          <Input id="evento-loja-nome" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Show no estádio" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="evento-loja-tipo">Tipo</Label>
          <Select id="evento-loja-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            {TIPOS_DA_LOJA.map((t) => (
              <option key={t.v} value={t.v}>
                {t.rotulo}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="evento-loja-dia">Dia</Label>
            <Input id="evento-loja-dia" type="date" value={dia} onChange={(e) => setDia(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="evento-loja-hora">Começa (opcional)</Label>
            <Input id="evento-loja-hora" type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="evento-loja-repete">Repete</Label>
          <Select id="evento-loja-repete" value={repete} onChange={(e) => setRepete(e.target.value)}>
            {REPETE.map((r) => (
              <option key={r.v} value={r.v}>
                {r.rotulo}
              </option>
            ))}
          </Select>
        </div>
        <p className="rounded-md border border-border bg-secondary/50 px-3 py-2 text-sm text-secondary-foreground">
          ℹ O evento aparece neste calendário e entra na cópia por loja que as análises do perfil dos clientes usam. Ninguém
          de fora da empresa vê.
        </p>
        {erro && (
          <p role="alert" className="text-sm font-semibold text-destructive">
            {erro}
          </p>
        )}
      </div>
    </Gaveta>
  );
}
