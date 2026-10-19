import { fold } from "./text.ts";
import type { Book, BookCard, Profile, UserState } from "./types.ts";

export interface Suggestion {
  book: Book;
  reason: string;
}

function exclusive(values: string[]): string | null {
  const unique = [...new Set(values.filter(Boolean))];
  return unique.length === 1 ? unique[0] : null;
}

function audienceLabel(bucket: string | null): string {
  if (bucket === "youth") return "ילדים ונוער";
  if (bucket === "adult") return "מבוגרים";
  return "";
}

export function buildProfile(books: Book[], state: UserState): Profile {
  const rated = books.filter(
    (book) => state.likes[String(book.id)] || state.dislikes[String(book.id)],
  );
  const language = exclusive(rated.map((book) => book.language));
  const audience = exclusive(
    rated
      .map((book) => book.audienceBucket)
      .filter((bucket): bucket is "youth" | "adult" => bucket != null),
  );
  const parts: string[] = [];
  if (language) parts.push(`רק ספרים ב${language}`);
  if (audience === "youth") parts.push("רק ספרי ילדים ונוער");
  if (audience === "adult") parts.push("רק ספרי מבוגרים");

  return {
    readCount: rated.length,
    likeCount: Object.keys(state.likes).length,
    dislikeCount: Object.keys(state.dislikes).length,
    borrowedCount: Object.keys(state.borrowed).length,
    waitingCount: Object.keys(state.waiting ?? {}).length,
    language: language ?? "",
    audience: audienceLabel(audience),
    note: parts.length
      ? `ההמלצות מותאמות לפי מה שקראתם: ${parts.join(" · ")}.`
      : "ההמלצות נבנות מספרים שאהבתם: הספר הבא בסדרה, עוד ספרים של אותו מחבר, ואותו סוג ספרים.",
  };
}

function allowed(
  book: Book,
  language: string | null,
  audience: "youth" | "adult" | null,
  allowUnknown: boolean,
): boolean {
  if (language && book.language !== language && !(allowUnknown && !book.language)) return false;
  if (audience && book.audienceBucket !== audience && !(allowUnknown && !book.audienceBucket)) {
    return false;
  }
  return true;
}

function seriesPhrase(book: Book, next: boolean): string {
  const name = book.seriesName && book.seriesName.length >= 6 ? ` «${book.seriesName}»` : "";
  return `${next ? "הספר הבא בסדרה" : "המשך הסדרה"}${name}`;
}

export function recommend(books: Book[], state: UserState, limit = 24): Suggestion[] {
  const liked = books.filter((book) => state.likes[String(book.id)]);
  const dislikedAuthors = new Set(
    books
      .filter((book) => state.dislikes[String(book.id)] && book.authorKey)
      .map((book) => book.authorKey),
  );
  for (const book of liked) {
    if (book.authorKey) dislikedAuthors.delete(book.authorKey);
  }

  const rated = books.filter(
    (book) => state.likes[String(book.id)] || state.dislikes[String(book.id)],
  );
  const language = exclusive(rated.map((book) => book.language));
  const audience = exclusive(
    rated
      .map((book) => book.audienceBucket)
      .filter((bucket): bucket is "youth" | "adult" => bucket != null),
  );
  const readIds = new Set<string>([...Object.keys(state.likes), ...Object.keys(state.dislikes)]);
  const borrowedIds = new Set(Object.keys(state.borrowed));
  const waitingIds = new Set(Object.keys(state.waiting ?? {}));
  const heldIds = new Set([...borrowedIds, ...waitingIds]);
  const likedAuthors = new Set(liked.map((book) => book.authorKey).filter(Boolean));

  const bySeries = new Map<string, Book[]>();
  for (const book of books) {
    if (!book.seriesId) continue;
    const mates = bySeries.get(book.seriesId) ?? [];
    mates.push(book);
    bySeries.set(book.seriesId, mates);
  }

  const likedVolumes = new Map<string, number[]>();
  for (const book of liked) {
    if (!book.seriesId || book.volume == null) continue;
    const volumes = likedVolumes.get(book.seriesId) ?? [];
    volumes.push(book.volume);
    likedVolumes.set(book.seriesId, volumes);
  }

  const scores = new Map<number, Suggestion & { score: number }>();
  const consider = (book: Book, score: number, reason: string, allowUnknown: boolean): void => {
    const key = String(book.id);
    if (readIds.has(key) || heldIds.has(key)) return;
    if (book.authorKey && dislikedAuthors.has(book.authorKey)) return;
    if (!allowed(book, language, audience, allowUnknown)) return;
    const current = scores.get(book.id);
    if (!current || score > current.score) scores.set(book.id, { book, score, reason });
  };

  const nextBonuses = [120, 110, 100, 90, 80, 70];
  for (const [seriesId, volumes] of likedVolumes) {
    const later = (bySeries.get(seriesId) ?? [])
      .filter((book) => book.volume != null && book.volume > Math.max(...volumes))
      .sort((left, right) => (left.volume ?? 0) - (right.volume ?? 0));
    const nextAtHome = later[0] != null && heldIds.has(String(later[0].id));
    later.slice(0, 6).forEach((book, index) => {
      consider(book, nextBonuses[index] ?? 60, seriesPhrase(book, index === 0 && !nextAtHome), true);
    });

    const earlier = (bySeries.get(seriesId) ?? [])
      .filter((book) => book.volume != null && book.volume < Math.min(...volumes))
      .sort((left, right) => (left.volume ?? 0) - (right.volume ?? 0));
    if (earlier[0]) consider(earlier[0], 48, "ספר קודם בסדרה שעוד לא קראתם", true);
  }

  for (const book of liked) {
    if (!book.seriesId || book.volume != null) continue;
    const mates = (bySeries.get(book.seriesId) ?? [])
      .filter((mate) => mate.id !== book.id)
      .sort((left, right) => (left.volume ?? 999) - (right.volume ?? 999));
    mates.slice(0, 4).forEach((mate) => consider(mate, 55, "עוד ספר באותה סדרה", true));
  }

  const unfinishedSeries = (book: Book): boolean =>
    book.volume != null && book.volume > 1 && (!book.seriesId || !likedVolumes.has(book.seriesId));

  for (const book of books) {
    if (!book.authorKey || !likedAuthors.has(book.authorKey)) continue;
    if (unfinishedSeries(book)) continue;
    consider(book, 36, `עוד ספר של ${book.author || "מחבר שאהבתם"}`, false);
  }

  if ((language || audience) && [...scores.values()].filter((item) => item.score >= 36).length < 8) {
    const pool = books.filter((book) => {
      const key = String(book.id);
      if (readIds.has(key) || heldIds.has(key)) return false;
      if (book.authorKey && dislikedAuthors.has(book.authorKey)) return false;
      if (!allowed(book, language, audience, false)) return false;
      if (unfinishedSeries(book)) return false;
      return !scores.has(book.id);
    });
    const stride = Math.max(1, Math.floor(pool.length / 16));
    const origin = (liked[0]?.id ?? 0) % stride;
    for (let index = origin; index < pool.length; index += stride) {
      consider(pool[index], 18, "מתאים לגיל ולשפה שאתם קוראים", false);
    }
  }

  const ranked = [...scores.values()].sort(
    (left, right) => right.score - left.score || left.book.name.localeCompare(right.book.name, "he"),
  );
  const perAuthor = new Map<string, number>();
  const picked: Suggestion[] = [];
  const take = (item: Suggestion & { score: number }, cap: number): void => {
    if (picked.length >= limit) return;
    const bucket = item.book.authorKey || "__unknown__";
    const seen = perAuthor.get(bucket) ?? 0;
    if (seen >= cap) return;
    perAuthor.set(bucket, seen + 1);
    picked.push({ book: item.book, reason: item.reason });
  };

  for (const item of ranked) {
    if (item.score < 36) continue;
    take(item, item.score >= 48 ? 6 : 3);
  }
  if (picked.length < 8) {
    const weak = ranked.filter((item) => item.score < 36);
    const stride = Math.max(1, Math.floor(weak.length / 8));
    for (let index = 0; index < weak.length && picked.length < 8; index += stride) {
      take(weak[index], 2);
    }
  }
  return picked;
}

export function toCard(book: Book, state: UserState, reason = ""): BookCard {
  const key = String(book.id);
  return {
    id: book.id,
    name: book.name,
    author: book.author,
    language: book.language,
    audience: book.audience,
    pages: book.pages,
    image: book.image,
    liked: Boolean(state.likes[key]),
    disliked: Boolean(state.dislikes[key]),
    borrowed: Boolean(state.borrowed[key]),
    waiting: Boolean(state.waiting?.[key]),
    reason,
    seriesName: book.seriesName ?? "",
  };
}

export function searchBooks(books: Book[], query: string, limit = 40): Book[] {
  const terms = fold(query)
    .split(" ")
    .filter((term) => term.length >= 2);
  if (!terms.length) return [];

  const hits: { book: Book; score: number }[] = [];
  for (const book of books) {
    if (!terms.every((term) => book.hay.includes(term))) continue;
    const titleHit = terms.every((term) => book.hayTitle.includes(term)) ? 2 : 0;
    const starts = book.hayTitle.startsWith(terms[0]) ? 2 : 0;
    hits.push({ book, score: titleHit + starts });
  }
  hits.sort(
    (left, right) =>
      right.score - left.score || left.book.name.localeCompare(right.book.name, "he"),
  );
  return hits.slice(0, limit).map((hit) => hit.book);
}

export function byRecent(books: Book[], stamps: Record<string, number>): Book[] {
  return books
    .filter((book) => stamps[String(book.id)])
    .sort((left, right) => (stamps[String(right.id)] ?? 0) - (stamps[String(left.id)] ?? 0));
}
