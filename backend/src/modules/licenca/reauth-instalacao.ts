import { createHash, randomInt } from 'node:crypto';

// F3 — Controle de instalação anti-clone. Peças PURAS/isoladas, testáveis sem o resto do
// fluxo de provisionamento (bcrypt, licença, DB). Ver docs/plano-frota-edge.md §F3.

export type AtivacaoReauth =
  | { reauthAtivo?: boolean | null; deviceFingerprint?: string | null }
  | null
  | undefined;

/**
 * Precisa de re-autorização (2º fator) para prosseguir a instalação?
 *
 * SÓ quando os TRÊS valem: a trava está LIGADA (`reauth_ativo`), já existe um fingerprint
 * vinculado, e ele é de OUTRA máquina (≠ do que está instalando).
 *  - 1ª instalação (sem fingerprint salvo) → false (segue liso, e o fluxo salva o fp).
 *  - Reinstalação na MESMA máquina (MachineGuid estável → fingerprint IGUAL) → false.
 *  - Trava desligada (opt-in) → false (comportamento atual preservado).
 * Só o "outra máquina + trava ligada" exige o código (e-mail/TOTP).
 */
export function precisaReautorizar(ativacao: AtivacaoReauth, fingerprint: string): boolean {
  const fp = ativacao?.deviceFingerprint ?? null;
  return !!ativacao?.reauthAtivo && !!fp && !!fingerprint && fp !== fingerprint;
}

/** Código numérico de 6 dígitos para a re-autorização por e-mail. */
export function gerarCodigoReauth(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** Hash do código (nunca guardamos o código em claro; espelha o padrão do cadastro). */
export function hashCodigoReauth(codigo: string): string {
  return createHash('sha256').update(`reauth-edge|${String(codigo).trim()}`).digest('hex');
}
