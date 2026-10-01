import { cn } from '@/lib/utils';

// Chave liga/desliga (role="switch"), rotulada pelo título do item ao lado.
export function Chave({
  ligada,
  aoMudar,
  rotuladaPor,
  travada = false,
}: {
  ligada: boolean;
  aoMudar: (v: boolean) => void;
  rotuladaPor: string;
  travada?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligada}
      aria-labelledby={rotuladaPor}
      disabled={travada}
      onClick={() => aoMudar(!ligada)}
      className={cn(
        'relative h-[26px] w-11 flex-none rounded-full transition-colors motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-55',
        ligada ? 'bg-ok' : 'bg-input',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute left-[3px] top-[3px] h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
          ligada && 'translate-x-[18px]',
        )}
      />
    </button>
  );
}
