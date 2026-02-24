import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export interface HitlQuestion {
  key: string;
  safeKey: string;
  question: string;
  timestamp: number;
  pid?: number;
  questionPath: string;
  answerPath: string;
  answered: boolean;
  ageSeconds: number;
}

interface BrokerOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

interface QuestionPayload {
  key?: unknown;
  question?: unknown;
  timestamp?: unknown;
  pid?: unknown;
}

interface BrokerStateEntry {
  key: string;
  answered: boolean;
  questionMtimeMs: number;
  answerMtimeMs: number;
}

export function resolveHitlDir(input: BrokerOptions = {}): string {
  const env = input.env ?? process.env;
  const cwd = input.cwd ?? process.cwd();
  const raw = (env.CLARITY_HITL_DIR ?? ".clarity-hitl").trim();
  return path.resolve(cwd, raw.length > 0 ? raw : ".clarity-hitl");
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function toSafeKey(key: string): string {
  const safe = key.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return safe.length > 0 ? safe : "question";
}

function parseQuestionPayload(raw: string, safeKey: string): QuestionPayload {
  try {
    const parsed = JSON.parse(raw) as QuestionPayload;
    return parsed;
  } catch {
    return {
      key: safeKey,
      question: raw,
      timestamp: Date.now()
    };
  }
}

export async function ensureHitlDir(input: BrokerOptions = {}): Promise<string> {
  const dir = resolveHitlDir(input);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function listQuestions(input: BrokerOptions = {}): Promise<HitlQuestion[]> {
  const dir = await ensureHitlDir(input);
  const files = await readdir(dir).catch(() => []);
  const out: HitlQuestion[] = [];
  for (const file of files) {
    if (!file.endsWith(".question")) {
      continue;
    }
    const safeKey = file.slice(0, -".question".length);
    if (!safeKey) {
      continue;
    }
    const questionPath = path.join(dir, `${safeKey}.question`);
    const answerPath = path.join(dir, `${safeKey}.answer`);
    const raw = await readFile(questionPath, "utf8").catch(() => "");
    if (!raw) {
      continue;
    }
    const parsed = parseQuestionPayload(raw, safeKey);
    const key = typeof parsed.key === "string" && parsed.key.trim().length > 0 ? parsed.key.trim() : safeKey;
    const question = typeof parsed.question === "string" ? parsed.question : "";
    const timestamp = isNumber(parsed.timestamp) ? parsed.timestamp : Date.now();
    const pid = isNumber(parsed.pid) ? Math.floor(parsed.pid) : undefined;
    const answerStat = await stat(answerPath).catch(() => null);
    out.push({
      key,
      safeKey,
      question,
      timestamp,
      ...(pid !== undefined ? { pid } : {}),
      questionPath,
      answerPath,
      answered: Boolean(answerStat),
      ageSeconds: Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
    });
  }
  return out.sort((a, b) => a.timestamp - b.timestamp);
}

export async function getQuestionByKey(key: string, input: BrokerOptions = {}): Promise<HitlQuestion | null> {
  const safeKey = toSafeKey(key);
  const questions = await listQuestions(input);
  return questions.find((question) => question.safeKey === safeKey || question.key === key.trim()) ?? null;
}

export async function submitQuestion(payload: {
  key: string;
  question: string;
  timestamp?: number;
  pid?: number;
}, input: BrokerOptions = {}): Promise<{ key: string; safeKey: string; path: string }> {
  const safeKey = toSafeKey(payload.key);
  const dir = await ensureHitlDir(input);
  const questionPath = path.join(dir, `${safeKey}.question`);
  const record = {
    key: payload.key,
    question: payload.question,
    timestamp: isNumber(payload.timestamp) ? payload.timestamp : Date.now(),
    ...(isNumber(payload.pid) ? { pid: Math.floor(payload.pid) } : {})
  };
  await writeFile(questionPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { key: payload.key, safeKey, path: questionPath };
}

export async function answerQuestion(key: string, response: string, input: BrokerOptions = {}): Promise<{ key: string; safeKey: string; path: string }> {
  const safeKey = toSafeKey(key);
  const dir = await ensureHitlDir(input);
  const answerPath = path.join(dir, `${safeKey}.answer`);
  await writeFile(answerPath, response, "utf8");
  return { key, safeKey, path: answerPath };
}

export async function cancelQuestion(key: string, input: BrokerOptions = {}): Promise<{ key: string; safeKey: string; removed: boolean }> {
  const safeKey = toSafeKey(key);
  const dir = await ensureHitlDir(input);
  const questionPath = path.join(dir, `${safeKey}.question`);
  const existed = await stat(questionPath).then(() => true).catch(() => false);
  await rm(questionPath, { force: true });
  return { key, safeKey, removed: existed };
}

export async function readAnswer(key: string, input: BrokerOptions = {}): Promise<string | null> {
  const safeKey = toSafeKey(key);
  const dir = await ensureHitlDir(input);
  const answerPath = path.join(dir, `${safeKey}.answer`);
  const raw = await readFile(answerPath, "utf8").catch(() => null);
  if (raw === null) {
    return null;
  }
  return raw.trim();
}

export async function readQuestionState(key: string, input: BrokerOptions = {}): Promise<{
  key: string;
  safeKey: string;
  status: "pending" | "answered" | "missing";
  response?: string;
}> {
  const safeKey = toSafeKey(key);
  const question = await getQuestionByKey(key, input);
  if (!question) {
    return { key, safeKey, status: "missing" };
  }
  const response = await readAnswer(question.safeKey, input);
  if (response !== null) {
    return { key: question.key, safeKey: question.safeKey, status: "answered", response };
  }
  return { key: question.key, safeKey: question.safeKey, status: "pending" };
}

export async function listBrokerState(input: BrokerOptions = {}): Promise<Map<string, BrokerStateEntry>> {
  const dir = await ensureHitlDir(input);
  const files = await readdir(dir).catch(() => []);
  const state = new Map<string, BrokerStateEntry>();
  for (const file of files) {
    if (!file.endsWith(".question")) {
      continue;
    }
    const safeKey = file.slice(0, -".question".length);
    if (!safeKey) {
      continue;
    }
    const questionPath = path.join(dir, `${safeKey}.question`);
    const answerPath = path.join(dir, `${safeKey}.answer`);
    const questionMtimeMs = await stat(questionPath).then((row) => row.mtimeMs).catch(() => 0);
    const answerStat = await stat(answerPath).catch(() => null);
    state.set(safeKey, {
      key: safeKey,
      answered: Boolean(answerStat),
      questionMtimeMs,
      answerMtimeMs: answerStat ? answerStat.mtimeMs : 0
    });
  }
  return state;
}
