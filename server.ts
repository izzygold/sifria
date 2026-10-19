import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { loadCatalog } from "./lib/catalog.ts";
import { buildProfile, byRecent, recommend, searchBooks, toCard } from "./lib/recommend.ts";
import { applyAction, loadState, type BookAction } from "./lib/store.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const { books, seriesCount } = loadCatalog(path.join(root, "data", "books.csv"));
const byId = new Map(books.map((book) => [book.id, book]));
const actions = new Set<BookAction>(["like", "dislike", "borrow"]);

const app = express();
app.use(express.static(path.join(root, "public")));

function totals(): { books: number; series: number } {
  return { books: books.length, series: seriesCount };
}

app.get("/api/home", (req: Request, res: Response) => {
  const state = loadState();
  const query = typeof req.query.q === "string" ? req.query.q : "";
  res.set("Cache-Control", "no-store");
  res.json({
    profile: buildProfile(books, state),
    borrowed: byRecent(books, state.borrowed).map((book) => toCard(book, state)),
    recommended: recommend(books, state).map((item) => toCard(item.book, state, item.reason)),
    search: searchBooks(books, query).map((book) => toCard(book, state)),
    totals: totals(),
  });
});

app.get("/api/read", (_req: Request, res: Response) => {
  const state = loadState();
  res.set("Cache-Control", "no-store");
  res.json({
    profile: buildProfile(books, state),
    liked: byRecent(books, state.likes).map((book) => toCard(book, state)),
    disliked: byRecent(books, state.dislikes).map((book) => toCard(book, state)),
    totals: totals(),
  });
});

app.post("/api/books/:id/:action", (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const action = String(req.params.action);
  if (!byId.has(id) || !actions.has(action as BookAction)) {
    res.status(404).json({ error: "הספר לא נמצא" });
    return;
  }
  applyAction(loadState(), id, action as BookAction);
  res.json({ ok: true });
});

const port = Number(process.env.PORT) || 3789;
app.listen(port, "127.0.0.1", () => {
  console.log(`sifria ready — ${books.length} books, ${seriesCount} series`);
  console.log(`open http://127.0.0.1:${port}`);
});
