// Biblioteca de POPs sugeridos por ramo (didáticos, base Anvisa RDC 216 p/ food
// service). São RASCUNHOS editáveis — o gestor ajusta antes de publicar.
export type SugestaoPop = {
  titulo: string;
  descricao: string; // objetivo
  alcance?: string;
  responsavelExecuta?: string;
  responsavelSupervisiona?: string;
  materiais?: string;
  frequencia: string;
  passos: string[];
};

export const SUGESTOES_POP: Record<string, SugestaoPop[]> = {
  food_service: [
    {
      titulo: 'Higienização de bancadas e utensílios',
      descricao: 'Garantir a higienização correta de bancadas e utensílios ao final de cada uso/turno, evitando contaminação cruzada.',
      alcance: 'Cozinha e áreas de manipulação.',
      responsavelExecuta: 'Auxiliar de cozinha / cozinheiro',
      responsavelSupervisiona: 'Chefe de cozinha',
      materiais: 'Detergente neutro, água potável, sanitizante (hipoclorito 200 ppm), panos limpos, EPIs (luvas).',
      frequencia: 'turno',
      passos: [
        'Retirar resíduos e restos de alimentos das superfícies.',
        'Lavar com água e detergente neutro, esfregando toda a superfície.',
        'Enxaguar com água potável até remover o detergente.',
        'Aplicar solução sanitizante (hipoclorito 200 ppm) e aguardar o tempo de contato.',
        'Deixar secar naturalmente ou com pano limpo exclusivo.',
        'Registrar a higienização na planilha do turno.',
      ],
    },
    {
      titulo: 'Recebimento de mercadorias',
      descricao: 'Padronizar a conferência e o armazenamento de mercadorias no recebimento, garantindo qualidade e rastreabilidade.',
      alcance: 'Área de recebimento e estoque.',
      responsavelExecuta: 'Estoquista',
      responsavelSupervisiona: 'Gerente',
      materiais: 'Termômetro, balança, prancheta/nota, EPIs.',
      frequencia: 'sob_demanda',
      passos: [
        'Conferir nota fiscal x pedido (itens, quantidades, preços).',
        'Verificar temperatura de refrigerados (≤ 5 °C) e congelados (≤ -12 °C).',
        'Checar validade, integridade da embalagem e ausência de pragas.',
        'Pesar/contar e registrar divergências.',
        'Armazenar seguindo FEFO (o que vence primeiro sai primeiro).',
        'Lançar a entrada no estoque do sistema.',
      ],
    },
    {
      titulo: 'Higiene e saúde do manipulador',
      descricao: 'Assegurar a higiene pessoal e a saúde dos manipuladores de alimentos.',
      alcance: 'Todos os colaboradores que manipulam alimentos.',
      responsavelExecuta: 'Colaborador',
      responsavelSupervisiona: 'Supervisor de turno',
      materiais: 'Uniforme limpo, touca, sabonete antisséptico, álcool 70%, EPIs.',
      frequencia: 'diaria',
      passos: [
        'Vestir uniforme limpo, touca e calçado fechado.',
        'Higienizar as mãos ao iniciar, ao trocar de tarefa e após o banheiro.',
        'Manter unhas curtas, sem esmalte, sem adornos.',
        'Comunicar ao gestor qualquer sintoma de doença ou ferimento.',
        'Repetir a higienização das mãos ao longo do turno.',
      ],
    },
    {
      titulo: 'Controle de validade e FEFO',
      descricao: 'Controlar validades e a rotatividade do estoque para reduzir perdas.',
      alcance: 'Estoque, câmaras e geladeiras.',
      responsavelExecuta: 'Estoquista / cozinheiro',
      responsavelSupervisiona: 'Gerente',
      materiais: 'Etiquetas de validade, caneta, sistema de estoque.',
      frequencia: 'diaria',
      passos: [
        'Etiquetar todo produto aberto/manipulado com data e validade.',
        'Posicionar o que vence antes à frente (FEFO).',
        'Conferir diariamente itens próximos do vencimento.',
        'Separar e registrar descarte do que venceu.',
        'Repor conforme o ponto de pedido.',
      ],
    },
  ],
  geral: [
    {
      titulo: 'Abertura da loja',
      descricao: 'Padronizar as tarefas de abertura para iniciar o dia com tudo pronto.',
      responsavelExecuta: 'Responsável de turno',
      responsavelSupervisiona: 'Gerente',
      frequencia: 'diaria',
      passos: [
        'Conferir limpeza e organização do salão/área de atendimento.',
        'Ligar equipamentos e checar funcionamento.',
        'Abrir o caixa com o fundo de troco.',
        'Conferir estoque de itens do dia.',
        'Registrar a abertura.',
      ],
    },
    {
      titulo: 'Fechamento da loja',
      descricao: 'Padronizar o fechamento, garantindo caixa conferido e ambiente seguro.',
      responsavelExecuta: 'Responsável de turno',
      responsavelSupervisiona: 'Gerente',
      frequencia: 'diaria',
      passos: [
        'Fechar o caixa (conferência cega) e registrar a diferença.',
        'Limpar e organizar as áreas.',
        'Desligar equipamentos não essenciais.',
        'Conferir portas, luzes e alarme.',
        'Registrar o fechamento.',
      ],
    },
  ],
};
