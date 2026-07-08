// Paleta fixa por hierarquia (categoria da função). Define a cor da vaga na
// escala — cor 100% derivada da hierarquia, sem override por etiqueta.
// (Cores editáveis aqui; documentadas no changelog de decisoes-design.)
export const CORES_HIERARQUIA: Record<string, string> = {
  presidente: '#6D28D9', // Presidente / C&O — violeta
  gerente: '#2563EB', // Gerente — azul
  supervisao: '#0D9488', // Supervisão — teal
  execucao: '#64748B', // Execução / operacional — ardósia
};

export const LABEL_HIERARQUIA: Record<string, string> = {
  presidente: 'Presidente / C&O',
  gerente: 'Gerente',
  supervisao: 'Supervisão',
  execucao: 'Execução',
};

// Ordem hierárquica (topo → base), útil p/ ordenar legendas/agrupamentos.
export const ORDEM_HIERARQUIA = ['presidente', 'gerente', 'supervisao', 'execucao'];

export function corHierarquia(categoria?: string | null): string {
  return CORES_HIERARQUIA[categoria ?? ''] ?? '#94A3B8'; // cinza p/ sem categoria
}
