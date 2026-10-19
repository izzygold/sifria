import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { loadCatalog } from "../lib/catalog.ts";
import { buildProfile, byRecent, recommend, searchBooks, toCard } from "../lib/recommend.ts";
import { applyAction, type BookAction } from "../lib/store.ts";
import {
  clearSessionCookie,
  legacyWaiting,
  listUsers,
  loadShelf,
  loginUser,
  logoutToken,
  readSessionCookie,
  registerUser,
  saveShelf,
  sessionCookie,
  userForToken,
  type PublicUser,
} from "../lib/users.ts";

function catalogFile(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(process.cwd(), "data", "books.csv"),
    path.join(here, "data", "books.csv"),
    path.join(here, "..", "data", "books.csv"),
  ];
  return candidates.find((file) => fs.existsSync(file)) ?? candidates[0];
}

const { books, seriesCount } = loadCatalog(catalogFile());
const byId = new Map(books.map((book) => [book.id, book]));
const actions = new Set<BookAction>(["like", "dislike", "borrow", "wait"]);

const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

function totals(): { books: number; series: number } {
  return { books: books.length, series: seriesCount };
}

async function currentUser(req: Request): Promise<PublicUser | null> {
  return userForToken(readSessionCookie(req.headers.cookie));
}

async function requireUser(req: Request, res: Response): Promise<PublicUser | null> {
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: "צריך להתחבר" });
    return null;
  }
  return user;
}

app.get("/api/users", async (_req: Request, res: Response) => {
  res.set("Cache-Control", "no-store");
  res.json({ users: await listUsers(), legacyWaiting: await legacyWaiting() });
});

app.get("/api/me", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.set("Cache-Control", "no-store");
  res.json({ username: user.username });
});

app.post("/api/register", async (req: Request, res: Response) => {
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const created = await registerUser(username, password);
  if ("error" in created) {
    res.status(400).json({ error: created.error });
    return;
  }
  const session = await loginUser(username, password);
  if ("error" in session) {
    res.status(400).json({ error: session.error });
    return;
  }
  res.setHeader("Set-Cookie", sessionCookie(session.token));
  res.json({ username: session.user.username });
});

app.post("/api/login", async (req: Request, res: Response) => {
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const session = await loginUser(username, password);
  if ("error" in session) {
    res.status(400).json({ error: session.error });
    return;
  }
  res.setHeader("Set-Cookie", sessionCookie(session.token));
  res.json({ username: session.user.username });
});

app.post("/api/logout", async (req: Request, res: Response) => {
  await logoutToken(readSessionCookie(req.headers.cookie));
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});

app.get("/api/home", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const state = await loadShelf(user.id);
  const query = typeof req.query.q === "string" ? req.query.q : "";
  res.set("Cache-Control", "no-store");
  res.json({
    username: user.username,
    profile: buildProfile(books, state),
    borrowed: byRecent(books, state.borrowed).map((book) => toCard(book, state)),
    waiting: byRecent(books, state.waiting ?? {}).map((book) => toCard(book, state)),
    recommended: recommend(books, state).map((item) => toCard(item.book, state, item.reason)),
    search: searchBooks(books, query).map((book) => toCard(book, state)),
    totals: totals(),
  });
});

app.get("/api/read", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const state = await loadShelf(user.id);
  res.set("Cache-Control", "no-store");
  res.json({
    username: user.username,
    profile: buildProfile(books, state),
    liked: byRecent(books, state.likes).map((book) => toCard(book, state)),
    disliked: byRecent(books, state.dislikes).map((book) => toCard(book, state)),
    totals: totals(),
  });
});

app.post("/api/books/:id/:action", async (req: Request, res: Response) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  const action = String(req.params.action);
  if (!byId.has(id) || !actions.has(action as BookAction)) {
    res.status(404).json({ error: "הספר לא נמצא" });
    return;
  }
  const state = await loadShelf(user.id);
  await saveShelf(user.id, applyAction(state, id, action as BookAction));
  res.json({ ok: true });
});

export default app;

if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 3789;
  app.listen(port, "127.0.0.1", () => {
    console.log(`sifria ready — ${books.length} books, ${seriesCount} series`);
    console.log(`open http://127.0.0.1:${port}`);
  });
}
