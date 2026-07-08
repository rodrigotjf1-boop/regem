// Modelos de documento controlado sugeridos por ramo. `conteudo.texto` traz um
// rascunho didático que o gestor edita antes de publicar.
export type SugestaoDocumento = {
  tipo: 'regimento' | 'treinamento' | 'comunicado' | 'outro';
  titulo: string;
  escopo?: string;
  texto: string;
};

export const SUGESTOES_DOCUMENTO: Record<string, SugestaoDocumento[]> = {
  food_service: [
    {
      tipo: 'regimento',
      titulo: 'Regimento interno da equipe',
      escopo: 'Todos os colaboradores da unidade',
      texto: [
        'REGIMENTO INTERNO',
        '',
        '1. Jornada e pontualidade: chegar uniformizado e no horário; registrar o ponto no início e no fim do turno.',
        '2. Higiene pessoal: uniforme limpo, touca, unhas curtas, sem adornos; higienizar as mãos ao iniciar e ao trocar de tarefa.',
        '3. Conduta: respeito com colegas e clientes; proibido uso de celular na área de produção.',
        '4. Segurança dos alimentos: seguir os POPs de higienização, recebimento e controle de validade.',
        '5. Faltas e trocas: comunicar o gestor com antecedência; trocas de turno precisam de aprovação.',
        '6. Penalidades: o descumprimento sujeita às medidas previstas na legislação e nas políticas da empresa.',
      ].join('\n'),
    },
    {
      tipo: 'treinamento',
      titulo: 'Boas práticas de manipulação de alimentos',
      escopo: 'Manipuladores de alimentos',
      texto: [
        'TREINAMENTO — BOAS PRÁTICAS',
        '',
        'Objetivo: reduzir riscos de contaminação e garantir a segurança dos alimentos.',
        '',
        '• Higiene das mãos: lavar por 20s ao iniciar, após o banheiro e ao trocar de tarefa.',
        '• Evitar contaminação cruzada: separar cru de cozido; usar tábuas e utensílios distintos.',
        '• Controle de temperatura: refrigerados ≤ 5 °C, congelados ≤ -12 °C, cocção adequada.',
        '• Armazenamento: FEFO, produtos etiquetados com data e validade.',
        '• Uniforme e EPIs conforme a função.',
        '',
        'Ao final, dê ciência confirmando que leu e entendeu o treinamento.',
      ].join('\n'),
    },
    {
      tipo: 'comunicado',
      titulo: 'Comunicado — reforço de higiene',
      escopo: 'Todos os turnos',
      texto: [
        'COMUNICADO',
        '',
        'Reforçamos a importância da higienização de bancadas e utensílios a cada troca de preparo e ao final do turno.',
        'A partir desta semana, o registro de higienização passa a ser conferido diariamente pela supervisão.',
        'Dúvidas, procurar o gestor da unidade.',
      ].join('\n'),
    },
  ],
  geral: [
    {
      tipo: 'regimento',
      titulo: 'Regimento interno da equipe',
      escopo: 'Todos os colaboradores',
      texto: [
        'REGIMENTO INTERNO',
        '',
        '1. Jornada e pontualidade.',
        '2. Apresentação e conduta profissional.',
        '3. Uso de equipamentos e materiais da empresa.',
        '4. Faltas, trocas e comunicação com o gestor.',
        '5. Penalidades por descumprimento.',
      ].join('\n'),
    },
    {
      tipo: 'comunicado',
      titulo: 'Comunicado geral',
      escopo: 'Todos os colaboradores',
      texto: [
        'COMUNICADO',
        '',
        'Descreva aqui o aviso à equipe. Ao final, todos devem dar ciência.',
      ].join('\n'),
    },
  ],
};
