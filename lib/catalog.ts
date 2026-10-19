import fs from "node:fs";
import { parse } from "csv-parse/sync";
import {
  audienceBucket,
  authorKey,
  clusterLabel,
  fold,
  sameSeriesStem,
  shelfKey,
  stemTitle,
} from "./text.ts";
import type { Book } from "./types.ts";

interface CsvRow {
  name?: string;
  author?: string;
  classification_number?: string;
  language?: string;
  pages?: string;
  target_audience?: string;
  image_url?: string;
}

function clusterIndexes(size: number, related: (left: number, right: number) => boolean): number[][] {
  const parent = Array.from({ length: size }, (_, index) => index);
  const find = (index: number): number => {
    let current = index;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]];
      current = parent[current];
    }
    return current;
  };

  for (let left = 0; left < size; left += 1) {
    for (let right = left + 1; right < size; right += 1) {
      if (!related(left, right)) continue;
      const a = find(left);
      const b = find(right);
      if (a !== b) parent[a] = b;
    }
  }

  const grouped = new Map<number, number[]>();
  for (let index = 0; index < size; index += 1) {
    const root = find(index);
    const list = grouped.get(root) ?? [];
    list.push(index);
    grouped.set(root, list);
  }
  return [...grouped.values()];
}

function assignSeries(books: Book[]): number {
  const byAuthor = new Map<string, Book[]>();
  for (const book of books) {
    if (!book.authorKey) continue;
    const list = byAuthor.get(book.authorKey) ?? [];
    list.push(book);
    byAuthor.set(book.authorKey, list);
  }

  let seriesCount = 0;
  for (const [author, group] of byAuthor) {
    if (group.length < 2) continue;
    const clusters = clusterIndexes(group.length, (left, right) =>
      sameSeriesStem(group[left], group[right]),
    );

    for (const indexes of clusters) {
      if (indexes.length < 2) continue;
      const members = indexes.map((index) => group[index]);
      if (members.length > 30) {
        const numbered = members.filter((book) => book.volume != null).length;
        if (numbered / members.length < 0.3) continue;
      }
      const label = clusterLabel(members.map((book) => book.stem));
      const seriesName = label.length >= 6 ? label : null;
      const seriesId = `${author}::${seriesName || `cluster-${seriesCount}`}`;
      seriesCount += 1;
      for (const book of members) {
        book.seriesId = seriesId;
        book.seriesName = seriesName;
      }
    }
  }
  return seriesCount;
}

export function loadCatalog(csvPath: string): { books: Book[]; seriesCount: number } {
  const rows = parse(fs.readFileSync(csvPath), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true,
  }) as CsvRow[];

  const books: Book[] = [];
  for (const row of rows) {
    const name = (row.name ?? "").trim();
    if (name.length < 2) continue;
    const author = (row.author ?? "").trim();
    const stemmed = stemTitle(name);
    const language = (row.language ?? "").trim();
    const audience = (row.target_audience ?? "").trim();
    books.push({
      id: books.length + 1,
      name,
      author,
      language,
      pages: (row.pages ?? "").trim(),
      audience,
      image: (row.image_url ?? "").trim(),
      stem: stemmed.stem,
      volume: stemmed.volume,
      hasSeparator: stemmed.hasSeparator,
      seriesId: null,
      seriesName: null,
      authorKey: authorKey(author),
      audienceBucket: audienceBucket(audience),
      shelfKey: shelfKey((row.classification_number ?? "").trim()),
      hay: fold(`${name} ${author}`),
      hayTitle: fold(name),
    });
  }

  return { books, seriesCount: assignSeries(books) };
}
