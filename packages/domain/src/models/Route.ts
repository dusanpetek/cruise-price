import { z } from 'zod';
import { PROVIDER_IDS, PROVIDER_LABELS, detectProviderId } from './Provider';

export const RouteInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(120),
    provider: z.enum(PROVIDER_IDS),
    url: z.string().trim().url('Enter a valid URL'),
  })
  .refine((r) => detectProviderId(r.url) === r.provider, {
    path: ['url'],
    message: 'URL does not belong to the selected provider',
  });
export type RouteInput = z.infer<typeof RouteInputSchema>;

/** The fare and cabin category a route opens with. null = not chosen (cheapest fare / cheapest cabin). */
export const FavoriteSchema = z.object({
  fareCode: z.string().min(1).nullable(),
  cabin: z.string().min(1).nullable(),
});
export type Favorite = z.infer<typeof FavoriteSchema>;

export const RouteSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  provider: z.enum(PROVIDER_IDS),
  url: z.string().url(),
  favorite: FavoriteSchema.nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Route = z.infer<typeof RouteSchema>;

export const providerLabel = (id: Route['provider']) => PROVIDER_LABELS[id];
