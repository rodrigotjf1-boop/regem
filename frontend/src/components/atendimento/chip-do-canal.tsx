import { COR_DO_CANAL, ROTULO_DO_CANAL } from '@/lib/atendimento';

/** O canal do caso (WhatsApp, iFood, 99Food, Cardápio, Anota AI), com a cor de identificação de cada um. */
export function ChipDoCanal({ canal }: { canal: string | null | undefined }) {
  if (!canal) return null;
  return (
    <span className={`inline-flex flex-none items-center whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-extrabold ${COR_DO_CANAL[canal] ?? 'bg-secondary text-foreground'}`}>
      {ROTULO_DO_CANAL[canal] ?? canal}
    </span>
  );
}
