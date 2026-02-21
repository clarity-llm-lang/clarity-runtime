import type { IncomingMessage } from "node:http";

export class HttpBodyError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function readJsonBody(req: IncomingMessage, maxBytes = 1_048_576): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const part = Buffer.from(chunk);
    total += part.byteLength;
    if (total > maxBytes) {
      throw new HttpBodyError(413, `request body too large (>${maxBytes} bytes)`);
    }
    chunks.push(part);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpBodyError(400, "invalid JSON body");
  }
}
