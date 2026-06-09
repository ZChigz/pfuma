import { z } from 'zod';

export const CreateAssetSchema = z.object({
  name:            z.string().min(1, 'Name is required'),
  categoryId:      z.string().min(1, 'Category is required'),
  description:     z.string().optional(),
  tagNumber:       z.string().min(1, 'Tag / serial number is required'),
  acquisitionDate: z.coerce.date(),
  acquisitionCost: z.number().positive('Cost must be positive'),
  currency:        z.enum(['USD', 'ZIG']),
  location:        z.string().min(1, 'Location is required'),
  custodian:       z.string().optional(),
  condition:       z.enum(['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CONDEMNED']),
  imageUrl:        z.string().url('Invalid URL').optional().or(z.literal('')),
});

export const UpdateAssetSchema = z.object({
  condition: z.enum(['EXCELLENT', 'GOOD', 'FAIR', 'POOR', 'CONDEMNED']).optional(),
  location:  z.string().min(1).optional(),
  custodian: z.string().optional(),
  status:    z.enum(['ACTIVE', 'UNDER_MAINTENANCE', 'DISPOSED']).optional(),
  imageUrl:  z.string().url('Invalid URL').optional().or(z.literal('')),
});

export const CreateMaintenanceSchema = z.object({
  maintenanceDate: z.coerce.date(),
  description:     z.string().min(1, 'Description is required'),
  cost:            z.number().positive().optional(),
  currency:        z.enum(['USD', 'ZIG']).optional(),
  provider:        z.string().optional(),
  nextServiceDate: z.coerce.date().optional(),
});

export const DisposeAssetSchema = z.object({
  disposalDate: z.coerce.date(),
  reason:       z.string().min(1, 'Reason is required'),
  method:       z.enum(['SOLD', 'SCRAPPED', 'DONATED']),
  proceeds:     z.number().positive().optional(),
  currency:     z.enum(['USD', 'ZIG']).optional(),
});
