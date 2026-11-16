import { Injectable, Logger } from '@nestjs/common';

// AS RESPOSTAS AO NÚMERO DE MARKETING que são de OUTRO módulo (F4b parte 2 das vagas: "Tenho interesse" e "Não quero mais
// receber" no aviso da vaga). As duas entradas (API oficial e Evolution) perguntam aqui ANTES do SAIR/VOLTAR genéricos:
// o módulo que reconhece a resposta (pelo telefone e por algo que ele mandou há pouco) trata e responde pelo MESMO número.
// Ninguém reconheceu: segue o caminho de sempre (ERR-484). O módulo das vagas importa o do WhatsApp — por isso o gancho se
// registra aqui ao subir, em vez de o WhatsApp importar as vagas (ciclo).

export interface RespostaDoMarketing {
  tenantId: string;
  /** O telefone de quem respondeu, como o canal entrega (com o 55). */
  telefone: string;
  texto: string;
  /** Responde pelo mesmo número de marketing (a pessoa acabou de escrever: a janela está aberta). */
  responder: (texto: string) => Promise<void>;
}
/** Devolve true quando tratou (a entrada para por aqui). */
export type GanchoDoMarketing = (r: RespostaDoMarketing) => Promise<boolean>;

@Injectable()
export class RespostasDoMarketingService {
  private readonly logger = new Logger('RespostasDoMarketing');
  private readonly ganchos: GanchoDoMarketing[] = [];

  registrar(gancho: GanchoDoMarketing): void {
    this.ganchos.push(gancho);
  }

  /** O primeiro gancho que trata leva a resposta; o que falha não segura a entrada (segue para o próximo e o de sempre). */
  async tratar(r: RespostaDoMarketing): Promise<boolean> {
    for (const g of this.ganchos) {
      try {
        if (await g(r)) return true;
      } catch (e: any) {
        this.logger.warn(`resposta ao número de marketing não tratada por um gancho: ${e?.message ?? e}`);
      }
    }
    return false;
  }
}
