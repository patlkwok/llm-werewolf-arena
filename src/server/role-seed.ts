import "server-only";
import { createHmac, randomBytes } from "node:crypto";

const processSecret = randomBytes(32);

export function seedForCreateRequest(requestId: string): number {
  const digest = createHmac("sha256", processSecret).update(requestId).digest();
  return digest.readUInt32BE(0) || 1;
}
