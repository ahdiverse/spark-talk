import { z } from "zod";

export const PROTOCOL_VERSION = "1.0" as const;

const sessionIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const agentNamePattern = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export const sessionIdSchema = z
  .string()
  .regex(sessionIdPattern, "sessionId must match [a-zA-Z0-9][a-zA-Z0-9._-]{0,63}");

export const agentNameSchema = z
  .string()
  .regex(agentNamePattern, "agent must match [a-zA-Z0-9][a-zA-Z0-9_-]{0,63}");

export const turnStatusSchema = z.enum(["queued", "delivered", "acked", "failed"]);

export type TurnStatus = z.infer<typeof turnStatusSchema>;

export interface MessageEnvelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  sessionId: string;
  turnId: number;
  from: string;
  to: string;
  body: string;
  replyToTurnId?: number;
  createdAt: string;
  deliveredAt?: string;
  ackedAt?: string;
  status: TurnStatus;
  meta?: Record<string, unknown>;
}

export const sendInputSchema = z.object({
  sessionId: sessionIdSchema,
  from: agentNameSchema,
  to: agentNameSchema,
  body: z.string().min(1, "message body cannot be empty"),
  replyToTurnId: z.number().int().positive().optional(),
  meta: z.record(z.string(), z.unknown()).optional()
});

export type SendInput = z.infer<typeof sendInputSchema>;

export interface DbTurnRow {
  id: number;
  session_id: string;
  from_agent: string;
  to_agent: string;
  body: string;
  reply_to_turn_id: number | null;
  status: TurnStatus;
  created_at: string;
  delivered_at: string | null;
  acked_at: string | null;
  meta_json: string | null;
}
