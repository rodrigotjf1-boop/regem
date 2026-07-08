// Modelos de checklist sugeridos por ramo. Viram um checklist com itens já
// preenchidos (descrição + procedimento), editáveis antes de publicar o POP.
export type SugestaoChecklist = {
  nome: string;
  itens: { descricao: string; procedimento?: string }[];
};

export const SUGESTOES_CHECKLIST: Record<string, SugestaoChecklist[]> = {
  food_service: [
    {
      nome: 'Abertura da cozinha',
      itens: [
        {
          descricao: 'Higienizar bancadas e utensílios',
          procedimento: 'Lavar com detergente, enxaguar e sanitizar antes do preparo.',
        },
        {
          descricao: 'Conferir temperatura de geladeiras e câmaras',
          procedimento: 'Refrigerados ≤ 5 °C e congelados ≤ -12 °C; registrar na planilha.',
        },
        {
          descricao: 'Checar validades e FEFO',
          procedimento: 'Retirar itens vencidos; posicionar o que vence primeiro à frente.',
        },
        {
          descricao: 'Ligar e testar equipamentos',
          procedimento: 'Fogão, coifa, chapa e fritadeira funcionando com segurança.',
        },
        {
          descricao: 'Conferir uniforme e higiene da equipe',
          procedimento: 'Uniforme limpo, touca, mãos higienizadas, sem adornos.',
        },
      ],
    },
    {
      nome: 'Fechamento da cozinha',
      itens: [
        {
          descricao: 'Guardar e etiquetar sobras',
          procedimento: 'Refrigerar em recipientes fechados com data e validade.',
        },
        {
          descricao: 'Higienizar bancadas, chão e utensílios',
          procedimento: 'Limpeza completa das áreas de preparo e pisos.',
        },
        {
          descricao: 'Desligar equipamentos não essenciais',
          procedimento: 'Chapa, fritadeira e fornos desligados e resfriados.',
        },
        {
          descricao: 'Retirar lixo e trocar sacos',
          procedimento: 'Descartar resíduos e higienizar as lixeiras.',
        },
      ],
    },
    {
      nome: 'Limpeza do salão',
      itens: [
        { descricao: 'Limpar e organizar mesas e cadeiras' },
        { descricao: 'Higienizar cardápios e superfícies de contato' },
        { descricao: 'Repor guardanapos e temperos' },
        { descricao: 'Varrer e passar pano no piso' },
      ],
    },
  ],
  geral: [
    {
      nome: 'Abertura da loja',
      itens: [
        { descricao: 'Conferir limpeza e organização' },
        { descricao: 'Ligar e testar equipamentos' },
        { descricao: 'Abrir o caixa com fundo de troco' },
        { descricao: 'Conferir estoque do dia' },
      ],
    },
    {
      nome: 'Fechamento da loja',
      itens: [
        { descricao: 'Fechar e conferir o caixa' },
        { descricao: 'Limpar e organizar as áreas' },
        { descricao: 'Desligar equipamentos não essenciais' },
        { descricao: 'Conferir portas, luzes e alarme' },
      ],
    },
  ],
};
