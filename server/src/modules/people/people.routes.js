import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/asyncHandler.js';
import { validate } from '../../middleware/validate.js';
import { idempotent } from '../../middleware/idempotent.js';
import * as svc from './people.service.js';
import { getAccount, settleAccount } from '../accounts/accounts.service.js';

export const peopleRouter = Router();
// Ce routeur déplace de l'argent (règlement de compte) et maintenant de la
// marchandise (remise au comptoir). Un double-clic ou un réessai après un
// timeout ne doit rejouer ni l'un ni l'autre. Sans l'en-tête, comportement
// inchangé — voir middleware/idempotent.js.

const id = z.coerce.number().int().positive();

// Ce qui attend cette personne au bureau d'Alger, tous ordres confondus, et le
// geste qui le lui remet.
peopleRouter.get(
  '/people/:id/deliverable',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json(await svc.deliverableFor(req.params.id)))
);

peopleRouter.post(
  '/people/:id/deliver',
  validate({
    params: z.object({ id }),
    body: z.object({
      lines: z.array(z.object({
        lineId: z.coerce.number().int().positive(),
        quantity: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
      })).min(1),
    }),
  }),
  asyncHandler(async (req, res) => res.json(
    await svc.deliverToPerson({ admin: req.admin, personId: req.params.id, lines: req.body.lines, ip: req.ip })
  ))
);

peopleRouter.get(
  '/people/:id/account',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ account: await getAccount('personne', req.params.id) }))
);

// Un seul compte, donc un seul règlement. Le sens de l'argent ne se déduit plus
// du rôle — une même personne peut vous devoir comme fournisseur et être payée
// comme passager — il est donné explicitement, et le service le devine au signe
// du solde quand l'appelant se tait.
peopleRouter.post(
  '/people/:id/payment',
  validate({
    params: z.object({ id }),
    body: z.object({
      caisseId: z.coerce.number().int().positive(),
      amount: z.union([z.string(), z.number()]).transform((v) => String(v).trim()),
      currency: z.string().trim().toUpperCase().length(3).default('DZD'),
      direction: z.enum(['in', 'out']).optional(),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => res.json(
    await settleAccount({ admin: req.admin, personId: req.params.id, ...req.body, ip: req.ip })
  ))
);

const body = z
  .object({
    name: z.string().trim().min(1).max(160),
    phone: z.string().trim().max(40).optional(),
    notes: z.string().trim().max(1000).optional(),
    isFournisseur: z.boolean().default(false),
    isPassager: z.boolean().default(false),
    passagerType: z.enum(['regular', 'auto']).optional(),
  })
  // La contrainte existe aussi en base (people_has_role) ; ici elle donne un
  // message plutôt qu'une erreur de base de données.
  .refine((d) => d.isFournisseur || d.isPassager, {
    path: ['isFournisseur'],
    message: 'Choisissez au moins un rôle : fournisseur, passager, ou les deux.',
  });

peopleRouter.get(
  '/people',
  validate({
    query: z.object({
      role: z.enum(['fournisseur', 'passager']).optional(),
      search: z.string().trim().max(80).optional(),
      passagerType: z.enum(['regular', 'auto']).optional(),
      includeInactive: z.coerce.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => res.json({ people: await svc.listPeople(req.validatedQuery) }))
);

peopleRouter.get(
  '/people/:id',
  validate({ params: z.object({ id }) }),
  asyncHandler(async (req, res) => res.json({ person: await svc.getPerson(req.params.id) }))
);

peopleRouter.post(
  '/people',
  validate({ body }),
  asyncHandler(async (req, res) => res.status(201).json({ person: await svc.createPerson({ admin: req.admin, data: req.body, ip: req.ip }) }))
);

peopleRouter.put(
  '/people/:id',
  validate({ params: z.object({ id }), body }),
  asyncHandler(async (req, res) => res.json({ person: await svc.updatePerson({ admin: req.admin, id: req.params.id, data: req.body, ip: req.ip }) }))
);

peopleRouter.post(
  '/people/:id/active',
  validate({ params: z.object({ id }), body: z.object({ active: z.boolean() }) }),
  asyncHandler(async (req, res) => res.json({ person: await svc.setPersonActive({ admin: req.admin, id: req.params.id, active: req.body.active, ip: req.ip }) }))
);
