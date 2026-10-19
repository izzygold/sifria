import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { UserState } from "./types.ts";

function stateFile(): string {
  const root = path.dirname(fileURLToPath(import.meta.url));
  return path.join(root, "..", "data", "state.json");
}

export function loadState(): UserState {
  const file = stateFile();
  if (!fs.existsSync(file)) return { likes: {}, dislikes: {}, borrowed: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<UserState>;
    return {
      likes: parsed.likes ?? {},
      dislikes: parsed.dislikes ?? {},
      borrowed: parsed.borrowed ?? {},
    };
  } catch {
    return { likes: {}, dislikes: {}, borrowed: {} };
  }
}

export function saveState(state: UserState): void {
  const file = stateFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(temporary, file);
}

export type BookAction = "like" | "dislike" | "borrow";

export function applyAction(state: UserState, id: number, action: BookAction): UserState {
  const key = String(id);
  const now = Date.now();
  if (action === "like") {
    if (state.likes[key]) delete state.likes[key];
    else {
      state.likes[key] = now;
      delete state.dislikes[key];
    }
  } else if (action === "dislike") {
    if (state.dislikes[key]) delete state.dislikes[key];
    else {
      state.dislikes[key] = now;
      delete state.likes[key];
    }
  } else if (state.borrowed[key]) {
    delete state.borrowed[key];
  } else {
    state.borrowed[key] = now;
  }
  saveState(state);
  return state;
}
