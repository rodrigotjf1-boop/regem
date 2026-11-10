import type { FichaForm, PaginaPublica } from '@/lib/vagas-ficha';
import type { Erros } from './campos';

/** O que toda etapa da ficha recebe: a ficha, como mudá-la, a página da loja, os erros da etapa e o dia de hoje. */
export interface PropsEtapa {
  f: FichaForm;
  muda: <K extends keyof FichaForm>(k: K, v: FichaForm[K]) => void;
  p: PaginaPublica;
  erros: Erros;
  hoje: string;
}

/** Id da linha da lista (experiência, liderança, curso) — só para a chave do React; sai no envio. */
export const novoId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
