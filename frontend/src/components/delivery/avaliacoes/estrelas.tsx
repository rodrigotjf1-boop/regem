// As estrelas da nota (só leitura): as acesas em dourado, as apagadas na cor da borda; o leitor de tela ouve "nota N de 5".
export function Estrelas({ nota, grande = false }: { nota: number; grande?: boolean }) {
  const n = Math.max(0, Math.min(5, Math.round(nota)));
  return (
    <span role="img" aria-label={`nota ${n} de 5`} className={`whitespace-nowrap tracking-wider ${grande ? 'text-2xl' : 'text-base'}`}>
      <span className="text-primary" aria-hidden="true">
        {'★'.repeat(n)}
      </span>
      <span className="text-border" aria-hidden="true">
        {'★'.repeat(5 - n)}
      </span>
    </span>
  );
}
