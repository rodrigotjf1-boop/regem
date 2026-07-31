import { SetMetadata } from '@nestjs/common';

export const CLOUD_ONLY = 'cloud_only';

// Marca um controller/handler que SÓ pode rodar na NUVEM — segredos de terceiros,
// cross-tenant (distribuição), licença, integrações, consolidação. No edge
// (EDGE_MODE=true) o CloudOnlyGuard barra o acesso (defesa em profundidade: mesmo
// que o módulo acabe no bundle do edge, o endpoint não responde). Ver a fronteira
// em docs/roadmap-seguranca-migracao.md §8 e src/edge-manifest.ts.
export const CloudOnly = () => SetMetadata(CLOUD_ONLY, true);
