// Configuração que só a NUVEM altera (fase 3B, decisão do dono de 23/10/2026): módulos, configuração da empresa e
// configuração fiscal. No servidor da loja a tela mostra o que vale, mas não salva — a rota de gravação nem existe lá
// (`@CloudOnly`). Build do servidor da loja = NEXT_PUBLIC_EDGE=1 (constante de build).
export const NO_SERVIDOR_DA_LOJA = process.env.NEXT_PUBLIC_EDGE === '1';

export function SoPelaNuvem({ className = '' }: { className?: string }) {
  if (!NO_SERVIDOR_DA_LOJA) return null;
  return (
    <p role="note" className={`rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground ${className}`}>
      Esta configuração só muda pela nuvem: abra esta mesma tela no Regem na nuvem. Aqui, no servidor da loja, ela só
      aparece.
    </p>
  );
}
