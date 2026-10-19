import type { UserState } from "./types.ts";

export type BookAction = "like" | "dislike" | "borrow" | "wait";

export function applyAction(state: UserState, id: number, action: BookAction): UserState {
  const key = String(id);
  const now = Date.now();
  state.waiting ??= {};
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
  } else if (action === "borrow") {
    if (state.borrowed[key]) delete state.borrowed[key];
    else {
      state.borrowed[key] = now;
      delete state.waiting[key];
    }
  } else if (state.waiting[key]) {
    delete state.waiting[key];
  } else {
    state.waiting[key] = now;
    delete state.borrowed[key];
  }
  return state;
}
