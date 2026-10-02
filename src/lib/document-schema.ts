import { z } from "zod";

export const documentEvidenceSchema = z.object({
  abstain: z.boolean(),
  citations: z.array(z.object({ sourceId: z.string().min(1), quote: z.string().min(20).max(1200) }).strict()).max(4),
}).strict();
