import { z } from 'zod';

/** A Participant id: a UUIDv7 generated on the device, so a retried addition keeps its id. */
export const participantIdSchema = z.uuid({ version: 'v7' });

/** A Participant name: free text, trimmed, never blank. Names need not be unique in a Trip. */
export const participantNameSchema = z.string().trim().min(1).max(50);

/** A person taking part in a Trip, whether or not they use the app. */
export const participantSchema = z.object({
  id: participantIdSchema,
  name: participantNameSchema,
});

export type Participant = z.infer<typeof participantSchema>;
