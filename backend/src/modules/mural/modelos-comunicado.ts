// Modelos rápidos de comunicado por ramo. Preenchem o formulário do mural; o
// gestor edita e publica.
export type ModeloComunicado = { titulo: string; corpo: string };

export const MODELOS_COMUNICADO: Record<string, ModeloComunicado[]> = {
  food_service: [
    {
      titulo: 'Reforço de higiene',
      corpo: 'Reforçando a higienização de bancadas e utensílios a cada troca de preparo e no fim do turno. Mãos sempre higienizadas.',
    },
    {
      titulo: 'Inventário geral',
      corpo: 'Faremos a contagem geral de estoque. Chegar 1h antes do turno e conferir as validades (FEFO).',
    },
    {
      titulo: 'Reunião de equipe',
      corpo: 'Reunião rápida de alinhamento antes da abertura. Presença de todos os turnos.',
    },
    {
      titulo: 'Escala da semana publicada',
      corpo: 'A escala da próxima semana já está disponível. Confira seus turnos e sinalize trocas com antecedência.',
    },
  ],
  geral: [
    {
      titulo: 'Reunião de equipe',
      corpo: 'Reunião rápida de alinhamento. Presença de todos.',
    },
    {
      titulo: 'Aviso importante',
      corpo: 'Descreva aqui o aviso à equipe.',
    },
    {
      titulo: 'Escala publicada',
      corpo: 'A escala da próxima semana está disponível. Confira seus turnos.',
    },
  ],
};
