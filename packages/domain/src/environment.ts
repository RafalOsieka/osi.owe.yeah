import { z } from 'zod';

/**
 * What the server says about the environment it runs in (#105): whether it is a test one,
 * whose data may be wiped at any time, which the app then warns about on every screen.
 */
export const environmentResponseSchema = z.object({ testEnvironment: z.boolean() });

export type EnvironmentResponse = z.infer<typeof environmentResponseSchema>;
