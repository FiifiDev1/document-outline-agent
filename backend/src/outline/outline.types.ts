import { z } from 'zod';

export interface OutlineItem {
  id: string;
  title: string;
  description: string;
}

export interface OutlineDoc {
  items: OutlineItem[];
}

export interface PositionedItem extends OutlineItem {
  position: number;
}

export const OutlineItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string(),
});

export const OutlineDocSchema = z.object({
  items: z.array(OutlineItemSchema),
});
