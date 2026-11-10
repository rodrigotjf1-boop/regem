'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { PaginaDeVagas } from '@/components/vagas/publico/pagina-de-vagas';

// A página pública de vagas da loja (mig 389): aberta pelo QR impresso (`?o=balcao`), pelo link de post e pelo robô.
// Sem login e sem o Shell. `?o=` é a marca de origem que a loja vê na ficha.
export default function VagasPublicaPage() {
  const params = useParams();
  const search = useSearchParams();
  return <PaginaDeVagas codigo={String(params?.codigo ?? '')} origem={search?.get('o') ?? null} />;
}
