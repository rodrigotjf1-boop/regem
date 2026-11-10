/* eslint-disable @typescript-eslint/no-explicit-any */

// A ficha "boa" das specs de vagas: a do protótipo preenchida inteira. O nome termina em `-spec.ts` para ficar FORA da
// build (`tsconfig.build.json` exclui `**/*spec.ts`) sem virar suíte do jest (que roda só `*.spec.ts`).
export function fichaValida(extra: Record<string, any> = {}): Record<string, any> {
  return {
    nome: 'Maria Teste da Silva',
    nascimento: '2000-05-10',
    sexo: 'feminino',
    whatsapp: '(21) 3333-0000', // inventado e fixo (regra: nada de número com cara de celular de verdade no repositório)
    email: '',
    funcoes: ['chapeiro', 'supervisao'],
    setores: ['chapa', 'delivery'],
    tipo: 'tanto',
    escala: '12x36',
    dias: ['sex', 'sab'],
    experiencia: 'sim',
    exps: [{ empresa: 'Lanchonete Teste', funcao: 'Chapeiro', tempo: '1a2a', vinculo: 'informal', atual: false, descricao: '' }],
    liderou: true,
    lids: [{ cargo: 'lider_turno', empresa: 'Lanchonete Teste', equipe: 'ate5', tempo: '6m1a', vinculo: 'carteira', descricao: 'Abria a loja.' }],
    estuda: true,
    grau_atual: 'tecnico',
    escola: 'Escola Técnica Teste',
    turno_estudo: 'manha',
    cursos_sit: 'fazendo',
    cursos: [{ nome: 'Barista', onde: 'SENAC', situacao: 'fazendo' }],
    cep: '20000-000',
    numero: '120',
    bairro: 'Centro',
    cidade: 'Rio de Janeiro – RJ',
    meio: ['publico', 'uber'],
    conducoes: 1,
    uber_motivo: 'madrugada',
    valor_ida: '4,70',
    valor_volta: '18,00',
    trabalhando: 'sim',
    comeca: 'aviso',
    cnh: 'sim',
    moto: 'sim',
    origem_declarada: 'qr_loja',
    consentimento: true,
    comunicacao: false,
    ...extra,
  };
}
