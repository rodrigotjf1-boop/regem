import type { Metadata, Viewport } from 'next';
import { AlertasTela } from './alertas-tela';

// Configurações › Alertas do KDS. Mora no mesmo endereço (o menu aponta para `/kds/alertas`), mas é uma tela do APP, no
// Shell claro, e não a do aparelho da cozinha: o layout de `/kds` trava o zoom e usa a cor e o manifesto do quiosque, e
// esta página herdava isso (auditoria do KDS, 11/11/2026, K1). O viewport e o metadata daqui valem sobre os de `/kds`.

export const metadata: Metadata = {
  title: 'Alertas do KDS · Regem',
  manifest: null,
  appleWebApp: null,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#EDF0F4',
};

export default function Pagina() {
  return <AlertasTela />;
}
