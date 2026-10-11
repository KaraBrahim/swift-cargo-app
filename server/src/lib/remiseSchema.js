// La remise telle que les routes l'acceptent. `settle: true` reste permis (c'est ce
// que disaient les écrans d'avant) ; une remise complète passe par `remise`.
import { z } from 'zod';

export const remiseSchema = z.object({
  kind: z.enum(['amount', 'percent', 'round', 'settle']),
  value: z.union([z.string(), z.number()]).transform((v) => String(v).trim()).optional(),
  reasonId: z.coerce.number().int().positive().nullable().optional(),
  note: z.string().trim().max(300).optional(),
});
