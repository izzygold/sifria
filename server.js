// src/server.ts
import fs3 from "node:fs";
import path2 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import express from "express";

// lib/catalog.ts
import fs from "node:fs";
import { parse } from "csv-parse/sync";

// lib/text.ts
var ORDINALS = {
  \u05E8\u05D0\u05E9\u05D5\u05DF: 1,
  \u05E8\u05D0\u05E9\u05D5\u05E0\u05D4: 1,
  \u05E9\u05E0\u05D9: 2,
  \u05E9\u05E0\u05D9\u05D9\u05D4: 2,
  \u05E9\u05E0\u05D9\u05D4: 2,
  \u05E9\u05DC\u05D9\u05E9\u05D9: 3,
  \u05E9\u05DC\u05D9\u05E9\u05D9\u05EA: 3,
  \u05E8\u05D1\u05D9\u05E2\u05D9: 4,
  \u05E8\u05D1\u05D9\u05E2\u05D9\u05EA: 4,
  \u05D7\u05DE\u05D9\u05E9\u05D9: 5,
  \u05D7\u05DE\u05D9\u05E9\u05D9\u05EA: 5,
  \u05E9\u05D9\u05E9\u05D9: 6,
  \u05E9\u05D9\u05E9\u05D9\u05EA: 6,
  \u05E9\u05D1\u05D9\u05E2\u05D9: 7,
  \u05E9\u05D1\u05D9\u05E2\u05D9\u05EA: 7,
  \u05E9\u05DE\u05D9\u05E0\u05D9: 8,
  \u05E9\u05DE\u05D9\u05E0\u05D9\u05EA: 8,
  \u05EA\u05E9\u05D9\u05E2\u05D9: 9,
  \u05EA\u05E9\u05D9\u05E2\u05D9\u05EA: 9,
  \u05E2\u05E9\u05D9\u05E8\u05D9: 10,
  \u05E2\u05E9\u05D9\u05E8\u05D9\u05EA: 10
};
var LETTERS = {
  \u05D0: 1,
  \u05D1: 2,
  \u05D2: 3,
  \u05D3: 4,
  \u05D4: 5,
  \u05D5: 6,
  \u05D6: 7,
  \u05D7: 8,
  \u05D8: 9,
  \u05D9: 10
};
var ORDINAL_PATTERN = Object.keys(ORDINALS).join("|");
var STOP_TOKENS = /* @__PURE__ */ new Set([
  "the",
  "and",
  "of",
  "a",
  "an",
  "in",
  "on",
  "my",
  "to",
  "\u05E9\u05DC",
  "\u05E2\u05DD",
  "\u05E2\u05DC",
  "\u05D0\u05DC",
  "\u05DC\u05D0",
  "\u05D0\u05D9\u05DA",
  "\u05DE\u05D4",
  "\u05DE\u05D9",
  "\u05DB\u05DC",
  "\u05D1\u05D9\u05DF",
  "\u05DB\u05DE\u05D5",
  "\u05D4\u05E8\u05E4\u05EA\u05E7\u05D0\u05D5\u05EA",
  "\u05E1\u05D9\u05E4\u05D5\u05E8\u05D9",
  "\u05E1\u05D9\u05E4\u05D5\u05E8\u05D9\u05DD",
  "\u05DE\u05E2\u05E9\u05D9\u05D5\u05EA"
]);
function fold(value) {
  return value.toLowerCase().replace(/["'״׳”“„«»]/g, "").replace(/[-–—־:|#/\\,._]+/g, " ").replace(/\s+/g, " ").trim();
}
function authorKey(author) {
  return fold(author).replace(/\s+עורך(?:ת)?$/, "").replace(/\s+editor$/, "").trim();
}
function audienceBucket(audience) {
  if (audience === "\u05D9\u05DC\u05D3\u05D9\u05DD" || audience === "\u05D9\u05DC\u05D3\u05D9\u05DD \u05D5\u05E0\u05D5\u05E2\u05E8" || audience === "\u05E0\u05D5\u05E2\u05E8" || audience === "\u05E6\u05E2\u05D9\u05E8\u05D9\u05DD" || audience === "\u05E4\u05E2\u05D5\u05D8\u05D5\u05EA" || audience === "\u05E0\u05D5\u05E2\u05E8 \u05E6\u05E2\u05D9\u05E8") {
    return "youth";
  }
  if (audience === "\u05DE\u05D1\u05D5\u05D2\u05E8\u05D9\u05DD") return "adult";
  return null;
}
function shelfKey(classification) {
  const code = classification.trim();
  if (!code) return "";
  if (code.startsWith("\u05E1")) return "fiction";
  if (code.startsWith("\u05E9")) return "poetry";
  if (code.startsWith("\u05E0")) return "youth-shelf";
  const dewey = code.match(/^(\d)/);
  if (dewey) return `d${dewey[1]}`;
  return code;
}
function volumeToken(token) {
  if (ORDINALS[token]) return ORDINALS[token];
  if (LETTERS[token]) return LETTERS[token];
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 60) return numeric;
  return null;
}
function stemTitle(title) {
  let working = title.replace(/\s+/g, " ").trim();
  let volume = null;
  const hasSeparator = /[:\-–—־]/.test(working);
  const remember = (value) => {
    if (volume == null && value != null) volume = value;
  };
  for (let pass = 0; pass < 4; pass += 1) {
    const match = working.match(/^(.*?)(?:\s*[-–—#:]+\s*|\s+)(\d{1,2})\s*$/);
    if (!match) break;
    const numeric = Number(match[2]);
    if (numeric < 1 || numeric > 60 || match[1].trim().length < 3) break;
    remember(numeric);
    working = match[1].trim();
  }
  const phrase = new RegExp(
    `(?:^|[\\s:\\-\u2013\u2014\u05BE])(?:\u05E1\u05E4\u05E8|\u05D7\u05DC\u05E7|\u05DB\u05E8\u05DA)\\s+\u05D4?(${ORDINAL_PATTERN}|\\d{1,2}|[\u05D0\u05D1\u05D2\u05D3\u05D4\u05D5\u05D6\u05D7\u05D8\u05D9])['\u05F3]?`,
    "gu"
  );
  working = working.replace(phrase, (full, token) => {
    remember(volumeToken(token));
    return full.startsWith(" ") || full.startsWith(":") || full.startsWith("-") ? " " : "";
  });
  const trailing = working.match(
    new RegExp(`(?:^|\\s)\u05D4?(${ORDINAL_PATTERN})\\s*$`)
  );
  if (trailing) {
    remember(ORDINALS[trailing[1]] ?? null);
    working = working.replace(new RegExp(`\\s*\u05D4?${trailing[1]}\\s*$`), "").trim();
  }
  return {
    stem: fold(working),
    volume,
    hasSeparator
  };
}
function commonWordPrefix(left, right) {
  if (!left || !right) return "";
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  let end = index;
  const divergedInsideBoth = index < left.length && index < right.length;
  const divergedMidWord = index > 0 && left[index - 1] !== " ";
  if (divergedInsideBoth && divergedMidWord) {
    end = left.lastIndexOf(" ", index);
    if (end < 0) return "";
  } else if (!divergedInsideBoth && index < Math.max(left.length, right.length)) {
    const longer = left.length >= right.length ? left : right;
    if (longer[index] !== " ") {
      end = left.lastIndexOf(" ", index);
      if (end < 0) return "";
    }
  }
  return left.slice(0, end).trim();
}
function firstToken(value) {
  return value.split(" ")[0] ?? "";
}
function sameSeriesStem(left, right) {
  if (!left.stem || !right.stem) return false;
  if (left.stem === right.stem && (left.volume != null || right.volume != null)) {
    return true;
  }
  const prefix = commonWordPrefix(left.stem, right.stem);
  if (prefix.length >= 14) return true;
  if (prefix.length >= 9 && (left.volume != null || right.volume != null)) return true;
  const token = firstToken(left.stem);
  if (token.length >= 6 && token === firstToken(right.stem) && !STOP_TOKENS.has(token) && left.hasSeparator && right.hasSeparator) {
    return true;
  }
  return false;
}
function clusterLabel(stems) {
  if (!stems.length) return "";
  let prefix = stems[0];
  for (const stem of stems.slice(1)) {
    const shared = commonWordPrefix(prefix, stem);
    if (!shared) {
      prefix = "";
      break;
    }
    prefix = shared;
  }
  if (prefix.length >= 6) return prefix;
  const counts = /* @__PURE__ */ new Map();
  for (const stem of stems) {
    const token = firstToken(stem);
    if (token.length < 6 || STOP_TOKENS.has(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [token, count] of counts) {
    if (count > bestCount) {
      best = token;
      bestCount = count;
    }
  }
  return bestCount >= 2 ? best : prefix;
}

// lib/catalog.ts
function clusterIndexes(size, related) {
  const parent = Array.from({ length: size }, (_, index) => index);
  const find = (index) => {
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
  const grouped = /* @__PURE__ */ new Map();
  for (let index = 0; index < size; index += 1) {
    const root = find(index);
    const list = grouped.get(root) ?? [];
    list.push(index);
    grouped.set(root, list);
  }
  return [...grouped.values()];
}
function assignSeries(books2) {
  const byAuthor = /* @__PURE__ */ new Map();
  for (const book of books2) {
    if (!book.authorKey) continue;
    const list = byAuthor.get(book.authorKey) ?? [];
    list.push(book);
    byAuthor.set(book.authorKey, list);
  }
  let seriesCount2 = 0;
  for (const [author, group] of byAuthor) {
    if (group.length < 2) continue;
    const clusters = clusterIndexes(
      group.length,
      (left, right) => sameSeriesStem(group[left], group[right])
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
      const seriesId = `${author}::${seriesName || `cluster-${seriesCount2}`}`;
      seriesCount2 += 1;
      for (const book of members) {
        book.seriesId = seriesId;
        book.seriesName = seriesName;
      }
    }
  }
  return seriesCount2;
}
function loadCatalog(csvPath) {
  const rows = parse(fs.readFileSync(csvPath), {
    columns: true,
    skip_empty_lines: true,
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    trim: true
  });
  const books2 = [];
  for (const row of rows) {
    const name = (row.name ?? "").trim();
    if (name.length < 2) continue;
    const author = (row.author ?? "").trim();
    const stemmed = stemTitle(name);
    const language = (row.language ?? "").trim();
    const audience = (row.target_audience ?? "").trim();
    books2.push({
      id: books2.length + 1,
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
      hayTitle: fold(name)
    });
  }
  return { books: books2, seriesCount: assignSeries(books2) };
}

// lib/recommend.ts
function exclusive(values) {
  const unique = [...new Set(values.filter((value) => value.length > 0))];
  return unique.length === 1 ? unique[0] : null;
}
function audienceLabel(bucket) {
  if (bucket === "youth") return "\u05D9\u05DC\u05D3\u05D9\u05DD \u05D5\u05E0\u05D5\u05E2\u05E8";
  if (bucket === "adult") return "\u05DE\u05D1\u05D5\u05D2\u05E8\u05D9\u05DD";
  return "";
}
function buildProfile(books2, state) {
  const rated = books2.filter(
    (book) => state.likes[String(book.id)] || state.dislikes[String(book.id)]
  );
  const language = exclusive(rated.map((book) => book.language));
  const audience = exclusive(
    rated.map((book) => book.audienceBucket).filter((bucket) => bucket != null)
  );
  const parts = [];
  if (language) parts.push(`\u05E8\u05E7 \u05E1\u05E4\u05E8\u05D9\u05DD \u05D1${language}`);
  if (audience === "youth") parts.push("\u05E8\u05E7 \u05E1\u05E4\u05E8\u05D9 \u05D9\u05DC\u05D3\u05D9\u05DD \u05D5\u05E0\u05D5\u05E2\u05E8");
  if (audience === "adult") parts.push("\u05E8\u05E7 \u05E1\u05E4\u05E8\u05D9 \u05DE\u05D1\u05D5\u05D2\u05E8\u05D9\u05DD");
  return {
    readCount: rated.length,
    likeCount: Object.keys(state.likes).length,
    dislikeCount: Object.keys(state.dislikes).length,
    borrowedCount: Object.keys(state.borrowed).length,
    waitingCount: Object.keys(state.waiting ?? {}).length,
    language: language ?? "",
    audience: audienceLabel(audience),
    note: parts.length ? `\u05D4\u05D4\u05DE\u05DC\u05E6\u05D5\u05EA \u05DE\u05D5\u05EA\u05D0\u05DE\u05D5\u05EA \u05DC\u05E4\u05D9 \u05DE\u05D4 \u05E9\u05E7\u05E8\u05D0\u05EA\u05DD: ${parts.join(" \xB7 ")}.` : "\u05D4\u05D4\u05DE\u05DC\u05E6\u05D5\u05EA \u05E0\u05D1\u05E0\u05D5\u05EA \u05DE\u05E1\u05E4\u05E8\u05D9\u05DD \u05E9\u05D0\u05D4\u05D1\u05EA\u05DD: \u05D4\u05E1\u05E4\u05E8 \u05D4\u05D1\u05D0 \u05D1\u05E1\u05D3\u05E8\u05D4, \u05E2\u05D5\u05D3 \u05E1\u05E4\u05E8\u05D9\u05DD \u05E9\u05DC \u05D0\u05D5\u05EA\u05D5 \u05DE\u05D7\u05D1\u05E8, \u05D5\u05D0\u05D5\u05EA\u05D5 \u05E1\u05D5\u05D2 \u05E1\u05E4\u05E8\u05D9\u05DD."
  };
}
function allowed(book, language, audience, allowUnknown) {
  if (language && book.language !== language && !(allowUnknown && !book.language)) return false;
  if (audience && book.audienceBucket !== audience && !(allowUnknown && !book.audienceBucket)) {
    return false;
  }
  return true;
}
function seriesPhrase(book, next) {
  const name = book.seriesName && book.seriesName.length >= 6 ? ` \xAB${book.seriesName}\xBB` : "";
  return `${next ? "\u05D4\u05E1\u05E4\u05E8 \u05D4\u05D1\u05D0 \u05D1\u05E1\u05D3\u05E8\u05D4" : "\u05D4\u05DE\u05E9\u05DA \u05D4\u05E1\u05D3\u05E8\u05D4"}${name}`;
}
function recommend(books2, state, limit = 24) {
  const liked = books2.filter((book) => state.likes[String(book.id)]);
  const dislikedAuthors = new Set(
    books2.filter((book) => state.dislikes[String(book.id)] && book.authorKey).map((book) => book.authorKey)
  );
  for (const book of liked) {
    if (book.authorKey) dislikedAuthors.delete(book.authorKey);
  }
  const rated = books2.filter(
    (book) => state.likes[String(book.id)] || state.dislikes[String(book.id)]
  );
  const language = exclusive(rated.map((book) => book.language));
  const audience = exclusive(
    rated.map((book) => book.audienceBucket).filter((bucket) => bucket != null)
  );
  const readIds = /* @__PURE__ */ new Set([...Object.keys(state.likes), ...Object.keys(state.dislikes)]);
  const borrowedIds = new Set(Object.keys(state.borrowed));
  const waitingIds = new Set(Object.keys(state.waiting ?? {}));
  const heldIds = /* @__PURE__ */ new Set([...borrowedIds, ...waitingIds]);
  const likedAuthors = new Set(liked.map((book) => book.authorKey).filter(Boolean));
  const bySeries = /* @__PURE__ */ new Map();
  for (const book of books2) {
    if (!book.seriesId) continue;
    const mates = bySeries.get(book.seriesId) ?? [];
    mates.push(book);
    bySeries.set(book.seriesId, mates);
  }
  const likedVolumes = /* @__PURE__ */ new Map();
  for (const book of liked) {
    if (!book.seriesId || book.volume == null) continue;
    const volumes = likedVolumes.get(book.seriesId) ?? [];
    volumes.push(book.volume);
    likedVolumes.set(book.seriesId, volumes);
  }
  const scores = /* @__PURE__ */ new Map();
  const consider = (book, score, reason, allowUnknown) => {
    const key = String(book.id);
    if (readIds.has(key) || heldIds.has(key)) return;
    if (book.authorKey && dislikedAuthors.has(book.authorKey)) return;
    if (!allowed(book, language, audience, allowUnknown)) return;
    const current = scores.get(book.id);
    if (!current || score > current.score) scores.set(book.id, { book, score, reason });
  };
  const nextBonuses = [120, 110, 100, 90, 80, 70];
  for (const [seriesId, volumes] of likedVolumes) {
    const later = (bySeries.get(seriesId) ?? []).filter((book) => book.volume != null && book.volume > Math.max(...volumes)).sort((left, right) => (left.volume ?? 0) - (right.volume ?? 0));
    const nextAtHome = later[0] != null && heldIds.has(String(later[0].id));
    later.slice(0, 6).forEach((book, index) => {
      consider(book, nextBonuses[index] ?? 60, seriesPhrase(book, index === 0 && !nextAtHome), true);
    });
    const earlier = (bySeries.get(seriesId) ?? []).filter((book) => book.volume != null && book.volume < Math.min(...volumes)).sort((left, right) => (left.volume ?? 0) - (right.volume ?? 0));
    if (earlier[0]) consider(earlier[0], 48, "\u05E1\u05E4\u05E8 \u05E7\u05D5\u05D3\u05DD \u05D1\u05E1\u05D3\u05E8\u05D4 \u05E9\u05E2\u05D5\u05D3 \u05DC\u05D0 \u05E7\u05E8\u05D0\u05EA\u05DD", true);
  }
  for (const book of liked) {
    if (!book.seriesId || book.volume != null) continue;
    const mates = (bySeries.get(book.seriesId) ?? []).filter((mate) => mate.id !== book.id).sort((left, right) => (left.volume ?? 999) - (right.volume ?? 999));
    mates.slice(0, 4).forEach((mate) => consider(mate, 55, "\u05E2\u05D5\u05D3 \u05E1\u05E4\u05E8 \u05D1\u05D0\u05D5\u05EA\u05D4 \u05E1\u05D3\u05E8\u05D4", true));
  }
  const unfinishedSeries = (book) => book.volume != null && book.volume > 1 && (!book.seriesId || !likedVolumes.has(book.seriesId));
  for (const book of books2) {
    if (!book.authorKey || !likedAuthors.has(book.authorKey)) continue;
    if (unfinishedSeries(book)) continue;
    consider(book, 36, `\u05E2\u05D5\u05D3 \u05E1\u05E4\u05E8 \u05E9\u05DC ${book.author || "\u05DE\u05D7\u05D1\u05E8 \u05E9\u05D0\u05D4\u05D1\u05EA\u05DD"}`, false);
  }
  if ((language || audience) && [...scores.values()].filter((item) => item.score >= 36).length < 8) {
    const pool = books2.filter((book) => {
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
      consider(pool[index], 18, "\u05DE\u05EA\u05D0\u05D9\u05DD \u05DC\u05D2\u05D9\u05DC \u05D5\u05DC\u05E9\u05E4\u05D4 \u05E9\u05D0\u05EA\u05DD \u05E7\u05D5\u05E8\u05D0\u05D9\u05DD", false);
    }
  }
  const ranked = [...scores.values()].sort(
    (left, right) => right.score - left.score || left.book.name.localeCompare(right.book.name, "he")
  );
  const perAuthor = /* @__PURE__ */ new Map();
  const picked = [];
  const take = (item, cap) => {
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
function toCard(book, state, reason = "") {
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
    seriesName: book.seriesName ?? ""
  };
}
function searchBooks(books2, query, limit = 40) {
  const terms = fold(query).split(" ").filter((term) => term.length >= 2);
  if (!terms.length) return [];
  const hits = [];
  for (const book of books2) {
    if (!terms.every((term) => book.hay.includes(term))) continue;
    const titleHit = terms.every((term) => book.hayTitle.includes(term)) ? 2 : 0;
    const starts = book.hayTitle.startsWith(terms[0]) ? 2 : 0;
    hits.push({ book, score: titleHit + starts });
  }
  hits.sort(
    (left, right) => right.score - left.score || left.book.name.localeCompare(right.book.name, "he")
  );
  return hits.slice(0, limit).map((hit) => hit.book);
}
function byRecent(books2, stamps) {
  return books2.filter((book) => stamps[String(book.id)]).sort((left, right) => (stamps[String(right.id)] ?? 0) - (stamps[String(left.id)] ?? 0));
}

// lib/store.ts
function applyAction(state, id, action) {
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

// lib/users.ts
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs2 from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get, put } from "@vercel/blob";
var SESSION_MS = 1e3 * 60 * 60 * 24 * 30;
var COOKIE = "sifria_session";
function accountFile() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  return path.join(root, "..", "data", "accounts.json");
}
function legacyFile() {
  const root = path.dirname(fileURLToPath(import.meta.url));
  return path.join(root, "..", "data", "state.json");
}
function emptyShelf() {
  return { likes: {}, dislikes: {}, borrowed: {}, waiting: {} };
}
function emptyFile() {
  return { migratedLegacy: false, users: [], sessions: {}, shelves: {} };
}
function normalizeFile(parsed) {
  return {
    migratedLegacy: Boolean(parsed.migratedLegacy),
    users: parsed.users ?? [],
    sessions: parsed.sessions ?? {},
    shelves: parsed.shelves ?? {}
  };
}
function usesBlob() {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID);
}
function readLocal() {
  const file = accountFile();
  if (!fs2.existsSync(file)) return emptyFile();
  try {
    return normalizeFile(JSON.parse(fs2.readFileSync(file, "utf8")));
  } catch {
    return emptyFile();
  }
}
function writeLocal(data) {
  const file = accountFile();
  fs2.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs2.writeFileSync(temporary, JSON.stringify(data, null, 2), "utf8");
  fs2.renameSync(temporary, file);
}
async function readFile() {
  if (!usesBlob()) return readLocal();
  try {
    const result = await get("accounts.json", { access: "private", useCache: false });
    if (!result || result.statusCode !== 200) return emptyFile();
    const text = await new Response(result.stream).text();
    if (!text) return emptyFile();
    return normalizeFile(JSON.parse(text));
  } catch {
    return emptyFile();
  }
}
async function writeFile(data) {
  if (!usesBlob()) {
    writeLocal(data);
    return;
  }
  await put("accounts.json", JSON.stringify(data), {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: "application/json"
  });
}
var queue = Promise.resolve();
function exclusive2(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => void 0,
    () => void 0
  );
  return run;
}
function readLegacy() {
  const file = legacyFile();
  if (!fs2.existsSync(file)) return emptyShelf();
  try {
    const parsed = JSON.parse(fs2.readFileSync(file, "utf8"));
    return {
      likes: parsed.likes ?? {},
      dislikes: parsed.dislikes ?? {},
      borrowed: parsed.borrowed ?? {},
      waiting: parsed.waiting ?? {}
    };
  } catch {
    return emptyShelf();
  }
}
function shelfHasMarks(state) {
  return Object.keys(state.likes).length > 0 || Object.keys(state.dislikes).length > 0 || Object.keys(state.borrowed).length > 0 || Object.keys(state.waiting ?? {}).length > 0;
}
function legacyWaiting() {
  return exclusive2(async () => {
    const data = await readFile();
    return !data.migratedLegacy && shelfHasMarks(readLegacy());
  });
}
function displayName(username) {
  return username.normalize("NFC").trim().replace(/\s+/g, " ");
}
function nameKey(username) {
  return displayName(username).toLocaleLowerCase("he");
}
function validateUsername(username) {
  const name = displayName(username);
  if (!name) return "\u05E6\u05E8\u05D9\u05DA \u05E9\u05DD \u05DE\u05E9\u05EA\u05DE\u05E9";
  if (name.length > 40) return "\u05D4\u05E9\u05DD \u05D0\u05E8\u05D5\u05DA \u05DE\u05D3\u05D9";
  if (/[\u0000-\u001F]/.test(name)) return "\u05D4\u05E9\u05DD \u05DC\u05D0 \u05EA\u05E7\u05D9\u05DF";
  return null;
}
function validatePassword(password) {
  if (typeof password !== "string" || password.length < 1) return "\u05E6\u05E8\u05D9\u05DA \u05E1\u05D9\u05E1\u05DE\u05D4";
  if (password.length > 100) return "\u05D4\u05E1\u05D9\u05E1\u05DE\u05D4 \u05D0\u05E8\u05D5\u05DB\u05D4 \u05DE\u05D3\u05D9";
  return null;
}
function hashPassword(password, salt) {
  return scryptSync(password, salt, 32).toString("hex");
}
function passwordsMatch(password, user) {
  const actual = Buffer.from(hashPassword(password, user.salt), "hex");
  const expected = Buffer.from(user.passwordHash, "hex");
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
function listUsers() {
  return exclusive2(async () => {
    const data = await readFile();
    return data.users.map((user) => ({ id: user.id, username: user.username }));
  });
}
function registerUser(username, password) {
  const nameError = validateUsername(username);
  if (nameError) return Promise.resolve({ error: nameError });
  const passwordError = validatePassword(password);
  if (passwordError) return Promise.resolve({ error: passwordError });
  return exclusive2(async () => {
    const data = await readFile();
    const key = nameKey(username);
    if (data.users.some((user2) => nameKey(user2.username) === key)) {
      return { error: "\u05D4\u05E9\u05DD \u05D4\u05D6\u05D4 \u05DB\u05D1\u05E8 \u05E7\u05D9\u05D9\u05DD" };
    }
    const salt = randomBytes(16).toString("hex");
    const user = {
      id: randomBytes(8).toString("hex"),
      username: displayName(username),
      salt,
      passwordHash: hashPassword(password, salt)
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
function loginUser(username, password) {
  const nameError = validateUsername(username);
  if (nameError) return Promise.resolve({ error: nameError });
  const passwordError = validatePassword(password);
  if (passwordError) return Promise.resolve({ error: passwordError });
  return exclusive2(async () => {
    const data = await readFile();
    const key = nameKey(username);
    const user = data.users.find((item) => nameKey(item.username) === key);
    if (!user || !passwordsMatch(password, user)) return { error: "\u05D4\u05E9\u05DD \u05D0\u05D5 \u05D4\u05E1\u05D9\u05E1\u05DE\u05D4 \u05DC\u05D0 \u05E0\u05DB\u05D5\u05E0\u05D9\u05DD" };
    const token = randomBytes(24).toString("hex");
    data.sessions[token] = { userId: user.id, expires: Date.now() + SESSION_MS };
    await writeFile(data);
    return { token, user: { id: user.id, username: user.username } };
  });
}
function logoutToken(token) {
  if (!token) return Promise.resolve();
  return exclusive2(async () => {
    const data = await readFile();
    if (!data.sessions[token]) return;
    delete data.sessions[token];
    await writeFile(data);
  });
}
function userForToken(token) {
  if (!token) return Promise.resolve(null);
  return exclusive2(async () => {
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
function loadShelf(userId) {
  return exclusive2(async () => {
    const shelf = (await readFile()).shelves[userId];
    if (!shelf) return emptyShelf();
    return {
      likes: shelf.likes ?? {},
      dislikes: shelf.dislikes ?? {},
      borrowed: shelf.borrowed ?? {},
      waiting: shelf.waiting ?? {}
    };
  });
}
function saveShelf(userId, state) {
  return exclusive2(async () => {
    const data = await readFile();
    data.shelves[userId] = state;
    await writeFile(data);
  });
}
function readSessionCookie(header) {
  if (!header) return "";
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE) return decodeURIComponent(rest.join("="));
  }
  return "";
}
function sessionCookie(token) {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1e3}${secure}`;
}
function clearSessionCookie() {
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`;
}

// src/server.ts
function catalogFile() {
  const here = path2.dirname(fileURLToPath2(import.meta.url));
  const candidates = [
    path2.join(process.cwd(), "data", "books.csv"),
    path2.join(here, "data", "books.csv"),
    path2.join(here, "..", "data", "books.csv")
  ];
  return candidates.find((file) => fs3.existsSync(file)) ?? candidates[0];
}
var { books, seriesCount } = loadCatalog(catalogFile());
var byId = new Map(books.map((book) => [book.id, book]));
var actions = /* @__PURE__ */ new Set(["like", "dislike", "borrow", "wait"]);
var app = express();
app.use(express.json());
app.use(express.static(path2.join(process.cwd(), "public")));
function totals() {
  return { books: books.length, series: seriesCount };
}
async function currentUser(req) {
  return userForToken(readSessionCookie(req.headers.cookie));
}
async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) {
    res.status(401).json({ error: "\u05E6\u05E8\u05D9\u05DA \u05DC\u05D4\u05EA\u05D7\u05D1\u05E8" });
    return null;
  }
  return user;
}
app.get("/api/users", async (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ users: await listUsers(), legacyWaiting: await legacyWaiting() });
});
app.get("/api/me", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  res.set("Cache-Control", "no-store");
  res.json({ username: user.username });
});
app.post("/api/register", async (req, res) => {
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
app.post("/api/login", async (req, res) => {
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
app.post("/api/logout", async (req, res) => {
  await logoutToken(readSessionCookie(req.headers.cookie));
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.json({ ok: true });
});
app.get("/api/home", async (req, res) => {
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
    totals: totals()
  });
});
app.get("/api/read", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const state = await loadShelf(user.id);
  res.set("Cache-Control", "no-store");
  res.json({
    username: user.username,
    profile: buildProfile(books, state),
    liked: byRecent(books, state.likes).map((book) => toCard(book, state)),
    disliked: byRecent(books, state.dislikes).map((book) => toCard(book, state)),
    totals: totals()
  });
});
app.post("/api/books/:id/:action", async (req, res) => {
  const user = await requireUser(req, res);
  if (!user) return;
  const id = Number(req.params.id);
  const action = String(req.params.action);
  if (!byId.has(id) || !actions.has(action)) {
    res.status(404).json({ error: "\u05D4\u05E1\u05E4\u05E8 \u05DC\u05D0 \u05E0\u05DE\u05E6\u05D0" });
    return;
  }
  const state = await loadShelf(user.id);
  await saveShelf(user.id, applyAction(state, id, action));
  res.json({ ok: true });
});
var server_default = app;
if (!process.env.VERCEL) {
  const port = Number(process.env.PORT) || 3789;
  app.listen(port, "127.0.0.1", () => {
    console.log(`sifria ready \u2014 ${books.length} books, ${seriesCount} series`);
    console.log(`open http://127.0.0.1:${port}`);
  });
}
export {
  server_default as default
};
