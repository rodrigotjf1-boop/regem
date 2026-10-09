'use client';

import { useEffect, useState } from 'react';
import { Select } from '@/components/ui/select';
import { carregarUnidadesDeMedida, unidadeDaLista, type ListaDeUnidades } from '@/lib/unidades-medida';

// Campo de UNIDADE DE MEDIDA: sempre uma lista, nunca texto livre (decisão do dono, 09/10/2026 —
// com texto livre cada um escrevia de um jeito: "un", "Un.", "unid"). As opções são a lista fechada
// do servidor. O que já estava gravado de outro jeito abre na unidade certa ("un" → unidade); o que
// não tem correspondente aparece marcado como antigo, para a pessoa escolher outro.
export function SeletorDeUnidade({
  value,
  onChange,
  id,
  ariaLabel,
  disabled,
  className,
}: {
  value: string | null | undefined;
  onChange: (unidade: string) => void;
  id?: string;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [lista, setLista] = useState<ListaDeUnidades | null>(null);
  const [falhou, setFalhou] = useState(false);
  useEffect(() => {
    let vivo = true;
    carregarUnidadesDeMedida()
      .then((l) => vivo && setLista(l))
      .catch(() => vivo && setFalhou(true));
    return () => {
      vivo = false;
    };
  }, []);

  const daLista = unidadeDaLista(value, lista);
  const antiga = !!value && !!lista && !daLista;
  return (
    <Select
      id={id}
      aria-label={ariaLabel}
      disabled={disabled || (!lista && !falhou)}
      value={daLista ?? value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      title={falhou ? 'Não foi possível carregar a lista de unidades. Recarregue a página.' : undefined}
      className={className}
    >
      {!value && <option value="">Escolha…</option>}
      {value && !daLista && <option value={value}>{antiga ? `${value} (antiga — escolha outra)` : value}</option>}
      {(lista?.unidades ?? []).map((u) => (
        <option key={u} value={u}>
          {u}
        </option>
      ))}
    </Select>
  );
}
