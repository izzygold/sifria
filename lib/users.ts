import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, put } from "@vercel/blob";
import type { UserState } from "./types.ts";

export interface PublicUser {
  id: string;
  username: string;
}

interface StoredUser extends PublicUser {
  passwordHash: string;
  salt: string;
}

interface Session {
  userId: string;
  expires: number;
}

interface AccountFile {
  migratedLegacy: boolean;
  users: StoredUser[];
  sessions: Record<string, Session>;
  shelves: Record<string, UserState>;
}

const SESSION_MS = 1000 * 60 * 60 * 24 * 30;
const COOKIE = "sifria_session";

function accountFile(): string {
  const root = path.dirname(fileURLToPath(import.meta.url));
  return path.join(root, "..", "data", "accounts.json");
}

function legacyFile(): string {
  const root = path.dirname(fileURLToPath(import.meta.url));
  return path.join(root, "..", "data", "state.json");
}

function emptyShelf(): UserState {
  return { likes: {}, dislikes: {}, borrowed: {}, waiting: {} };
}

function emptyFile(): AccountFile {
  return { migratedLegacy: false, users: [], sessions: {}, shelves: {} };
}

function normalizeFile(parsed: Partial<AccountFile>): AccountFile {
  return {
    migratedLegacy: Boolean(parsed.migratedLegacy),
    users: parsed.users ?? [],
    sessions: parsed.sessions ?? {},
    shelves: parsed.shelves ?? {},
  };
}

function usesBlob(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}

function readLocal(): AccountFile {
  const file = accountFile();
  if (!fs.existsSync(file)) return emptyFile();
  try {
    return normalizeFile(JSON.parse(fs.readFileSync(file, "utf8")) as Partial<AccountFile>);
  } catch {
    return emptyFile();
  }
}

function writeLocal(data: AccountFile): void {
  const file = accountFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

async function readFile(): Promise<AccountFile> {
  if (!usesBlob()) return readLocal();
  try {
    const result = await get("accounts.json", { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return emptyFile();
    const text = await new Response(result.stream).text();
    if (!text) return emptyFile();
    return normalizeFile(JSON.parse(text) as Partial<AccountFile>);
  } catch {
    return emptyFile();
  }
}

async function writeFile(data: AccountFile): Promise<void> {
  if (!usesBlob()) {
    writeLocal(data);
    return;
  }
  await put("accounts.json", JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json",
  });
}

let queue: Promise<void> = Promise.resolve();

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readLegacy(): UserState {
  const file = legacyFile();
  if (!fs.existsSync(file)) return emptyShelf();
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<UserState>;
    return {
      likes: parsed.likes ?? {},
      dislikes: parsed.dislikes ?? {},
      borrowed: parsed.borrowed ?? {},
      waiting: parsed.waiting ?? {},
    };
  } catch {
    return emptyShelf();
  }
}

function shelfHasMarks(state: UserState): boolean {
  return (
    Object.keys(state.likes).length > 0 ||
    Object.keys(state.dislikes).length > 0 ||
    Object.keys(state.borrowed).length > 0 ||
    Object.keys(state.waiting ?? {}).length > 0
  );
}

export function legacyWaiting(): Promise<boolean> {
  return exclusive(async () => {
    const data = await readFile();
    return !data.migratedLegacy && shelfHasMarks(readLegacy());
  });
}

export function displayName(username: string): string {
  return username.normalize("NFC").trim().replace(/\s+/g, " ");
}

function nameKey(username: string): string {
  return displayName(username).toLocaleLowerCase("he");
}

export function validateUsername(username: string): string | null {
  const name = displayName(username);
  if (!name) return "צריך שם משתמש";
  if (name.length > 40) return "השם ארוך מדי";
  if (/[\u0000-\u001F]/.test(name)) return "השם לא תקין";
  return null;
}

export function validatePassword(password: string): string | null {
  if (typeof password !== "string" || password.length < 1) return "צריך סיסמה";
  if (password.length > 100) return "הסיסמה ארוכה מדי";
  return null;
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString("hex");
}

function passwordsMatch(password: string, user: StoredUser): boolean {
  const actual = Buffer.from(hashPassword(password, user.salt), "hex");
  const expected = Buffer.from(user.passwordHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function listUsers(): Promise<PublicUser[]> {
  return exclusive(async () => {
    const data = await readFile();
    return data.users.map((user) => ({ id: user.id, username: user.username }));
  });
}

export function registerUser(
  username: string,
  password: string,
): Promise<{ user: PublicUser } | { error: string }> {
  const nameError = validateUsername(username);
  if (nameError) return Promise.resolve({ error: nameError });
  const passwordError = validatePassword(password);
  if (passwordError) return Promise.resolve({ error: passwordError });

  return exclusive(async () => {
  const data = await readFile();
  const key = nameKey(username);
  if (data.users.some((user) => nameKey(user.username) === key)) {
    return { error: "השם הזה כבר קיים" };
  }

  const salt = randomBytes(16).toString("hex");
  const user: StoredUser = {
    id: randomBytes(8).toString("hex"),
    username: displayName(username),
    salt,
    passwordHash: hashPassword(password, salt),
  };
  data.users.push(user);

  const legacy = readLegacy();
  if (!data.migratedLegacy && data.users.length === 1 && shelfHasMarks(legacy)) {
    data.shelves[user.id] = legacy;
    data.migratedLegacy = true;
  } else {
    data.shelves[user.id] = emptyShelf();
    if (!shelfHasMarks(legacy)) data.migratedLegacy = true;
  }

  await writeFile(data);
  return { user: { id: user.id, username: user.username } };
  });
}

export function loginUser(
  username: string,
  password: string,
): Promise<{ token: string; user: PublicUser } | { error: string }> {
  const nameError = validateUsername(username);
  if (nameError) return Promise.resolve({ error: nameError });
  const passwordError = validatePassword(password);
  if (passwordError) return Promise.resolve({ error: passwordError });

  return exclusive(async () => {
  const data = await readFile();
  const key = nameKey(username);
  const user = data.users.find((item) => nameKey(item.username) === key);
  if (!user || !passwordsMatch(password, user)) return { error: "השם או הסיסמה לא נכונים" };

  const token = randomBytes(24).toString("hex");
  data.sessions[token] = { userId: user.id, expires: Date.now() + SESSION_MS };
  await writeFile(data);
  return { token, user: { id: user.id, username: user.username } };
  });
}

export function logoutToken(token: string): Promise<void> {
  if (!token) return Promise.resolve();
  return exclusive(async () => {
    const data = await readFile();
    if (!data.sessions[token]) return;
    delete data.sessions[token];
    await writeFile(data);
  });
}

export function userForToken(token: string): Promise<PublicUser | null> {
  if (!token) return Promise.resolve(null);
  return exclusive(async () => {
    const data = await readFile();
    const session = data.sessions[token];
    if (!session) return null;
    if (session.expires < Date.now()) {
      delete data.sessions[token];
      await writeFile(data);
      return null;
    }
    const user = data.users.find((item) => item.id === session.userId);
    if (!user) return null;
    return { id: user.id, username: user.username };
  });
}

export function loadShelf(userId: string): Promise<UserState> {
  return exclusive(async () => {
  const shelf = (await readFile()).shelves[userId];
  if (!shelf) return emptyShelf();
  return {
    likes: shelf.likes ?? {},
    dislikes: shelf.dislikes ?? {},
    borrowed: shelf.borrowed ?? {},
    waiting: shelf.waiting ?? {},
  };
  });
}

export function saveShelf(userId: string, state: UserState): Promise<void> {
  return exclusive(async () => {
    const data = await readFile();
    data.shelves[userId] = state;
    await writeFile(data);
  });
}

export function readSessionCookie(header: string | undefined): string {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "";
}

export function sessionCookie(token: string): string {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}
