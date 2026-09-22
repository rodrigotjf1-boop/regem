// FUSO DA UF DO EMITENTE — para `dhEmi` e para a competência (AAMM) da chave.
//
// ⚠️ O defeito que isto corrige: o `dhEmi` era montado com
//    `new Date().toISOString().replace(/\.\d{3}Z$/, '-03:00')`. `toISOString()` devolve
//    UTC; trocar o "Z" por "-03:00" NÃO converte nada — declara o horário de Greenwich
//    como se fosse o de Brasília. Toda nota saía TRÊS HORAS NO FUTURO, e a SEFAZ rejeita
//    data-hora de emissão fora da tolerância (5 minutos).
//
// ⚠️ E o Brasil não é só −03:00: AC é −05:00; AM, MT, MS, RO e RR são −04:00. Uma loja em
//    Manaus com o horário de Brasília nasce uma hora adiantada.
//
// A competência da CHAVE sai do MESMO instante local. Ela era lida de `getFullYear()` /
// `getMonth()`, que é o fuso do SERVIDOR: na nuvem (UTC) toda venda a partir das 21h do
// dia 31 declararia o mês seguinte na chave e o mês corrente no `dhEmi`.
//
// Sem horário de verão: o Brasil não o adota desde 2019. O Intl resolve o restante.

const TZ_POR_UF: Record<string, string> = {
  AC: 'America/Rio_Branco',
  AM: 'America/Manaus',
  RR: 'America/Boa_Vista',
  RO: 'America/Porto_Velho',
  MT: 'America/Cuiaba',
  MS: 'America/Campo_Grande',
};
const TZ_PADRAO = 'America/Sao_Paulo';

export function fusoDaUf(uf?: string | null): string {
  return TZ_POR_UF[String(uf ?? '').trim().toUpperCase()] ?? TZ_PADRAO;
}

type Partes = { ano: number; mes: number; dia: number; hora: number; min: number; seg: number };

function partesNoFuso(d: Date, tz: string): Partes {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(d)) p[type] = value;
  // 'hour' pode vir '24' para meia-noite em algumas plataformas com hour12:false.
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour) % 24,
    min: Number(p.minute),
    seg: Number(p.second),
  };
}

// Deslocamento do fuso, em minutos, no instante dado (negativo a oeste de Greenwich).
export function offsetMinutos(d: Date, tz: string): number {
  const p = partesNoFuso(d, tz);
  const comoUtc = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.min, p.seg);
  // Zera os milissegundos dos dois lados: as partes formatadas não os têm.
  return Math.round((comoUtc - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}

const p2 = (n: number) => String(n).padStart(2, '0');

/** `dhEmi` no formato do leiaute: AAAA-MM-DDThh:mm:ss±hh:mm, no fuso da UF do emitente. */
export function dhEmiSefaz(agora: Date, uf?: string | null): string {
  const tz = fusoDaUf(uf);
  const p = partesNoFuso(agora, tz);
  const off = offsetMinutos(agora, tz);
  const sinal = off < 0 ? '-' : '+';
  const abs = Math.abs(off);
  return (
    `${p.ano}-${p2(p.mes)}-${p2(p.dia)}T${p2(p.hora)}:${p2(p.min)}:${p2(p.seg)}` +
    `${sinal}${p2(Math.floor(abs / 60))}:${p2(abs % 60)}`
  );
}

/** Competência (AA, MM) da chave de acesso — do MESMO instante local do `dhEmi`. */
export function competenciaChave(agora: Date, uf?: string | null): { ano2: string; mes2: string } {
  const p = partesNoFuso(agora, fusoDaUf(uf));
  return { ano2: String(p.ano).slice(-2), mes2: p2(p.mes) };
}
