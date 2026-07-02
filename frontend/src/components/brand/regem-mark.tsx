// Símbolo R.O. — monograma R (currentColor) em órbita dourada com nó em âmbar claro.
export function RegemMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 80 80" className={className} aria-hidden="true">
      <circle cx="40" cy="40" r="29" fill="none" stroke="#E2A340" strokeWidth="4.5" />
      <path
        d="M33 28 V54"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M33 28 H42 A7.5 7 0 0 1 42 42 H33"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M36 42 L49 54"
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="60.5" cy="19.5" r="5.5" fill="#F2C277" />
    </svg>
  );
}
