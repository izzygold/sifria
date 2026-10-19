const ORDINALS: Record<string, number> = {
  ראשון: 1,
  ראשונה: 1,
  שני: 2,
  שנייה: 2,
  שניה: 2,
  שלישי: 3,
  שלישית: 3,
  רביעי: 4,
  רביעית: 4,
  חמישי: 5,
  חמישית: 5,
  שישי: 6,
  שישית: 6,
  שביעי: 7,
  שביעית: 7,
  שמיני: 8,
  שמינית: 8,
  תשיעי: 9,
  תשיעית: 9,
  עשירי: 10,
  עשירית: 10,
};

const LETTERS: Record<string, number> = {
  א: 1,
  ב: 2,
  ג: 3,
  ד: 4,
  ה: 5,
  ו: 6,
  ז: 7,
  ח: 8,
  ט: 9,
  י: 10,
};

const ORDINAL_PATTERN = Object.keys(ORDINALS).join("|");

const STOP_TOKENS = new Set([
  "the",
  "and",
  "of",
  "a",
  "an",
  "in",
  "on",
  "my",
  "to",
  "של",
  "עם",
  "על",
  "אל",
  "לא",
  "איך",
  "מה",
  "מי",
  "כל",
  "בין",
  "כמו",
  "הרפתקאות",
  "סיפורי",
  "סיפורים",
  "מעשיות",
]);

export function fold(value: string): string {
  return value
    .toLowerCase()
    .replace(/["'״׳”“„«»]/g, "")
    .replace(/[-–—־:|#/\\,._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function authorKey(author: string): string {
  return fold(author)
    .replace(/\s+עורך(?:ת)?$/, "")
    .replace(/\s+editor$/, "")
    .trim();
}

export function audienceBucket(audience: string): "youth" | "adult" | null {
  if (
    audience === "ילדים" ||
    audience === "ילדים ונוער" ||
    audience === "נוער" ||
    audience === "צעירים" ||
    audience === "פעוטות" ||
    audience === "נוער צעיר"
  ) {
    return "youth";
  }
  if (audience === "מבוגרים") return "adult";
  return null;
}

export function shelfKey(classification: string): string {
  const code = classification.trim();
  if (!code) return "";
  if (code.startsWith("ס")) return "fiction";
  if (code.startsWith("ש")) return "poetry";
  if (code.startsWith("נ")) return "youth-shelf";
  const dewey = code.match(/^(\d)/);
  if (dewey) return `d${dewey[1]}`;
  return code;
}

function volumeToken(token: string): number | null {
  if (ORDINALS[token]) return ORDINALS[token];
  if (LETTERS[token]) return LETTERS[token];
  const numeric = Number(token);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 60) return numeric;
  return null;
}

export interface StemmedTitle {
  stem: string;
  volume: number | null;
  hasSeparator: boolean;
}

export function stemTitle(title: string): StemmedTitle {
  let working = title.replace(/\s+/g, " ").trim();
  let volume: number | null = null;
  const hasSeparator = /[:\-–—־]/.test(working);

  const remember = (value: number | null): void => {
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
    `(?:^|[\\s:\\-–—־])(?:ספר|חלק|כרך)\\s+ה?(${ORDINAL_PATTERN}|\\d{1,2}|[אבגדהוזחטי])['׳]?`,
    "gu",
  );
  working = working.replace(phrase, (full: string, token: string) => {
    remember(volumeToken(token));
    return full.startsWith(" ") || full.startsWith(":") || full.startsWith("-") ? " " : "";
  });

  const trailing = working.match(
    new RegExp(`(?:^|\\s)ה?(${ORDINAL_PATTERN})\\s*$`),
  );
  if (trailing) {
    remember(ORDINALS[trailing[1]] ?? null);
    working = working.replace(new RegExp(`\\s*ה?${trailing[1]}\\s*$`), "").trim();
  }

  return {
    stem: fold(working),
    volume,
    hasSeparator,
  };
}

export function commonWordPrefix(left: string, right: string): string {
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

export function firstToken(value: string): string {
  return value.split(" ")[0] ?? "";
}

export function sameSeriesStem(
  left: StemmedTitle,
  right: StemmedTitle,
): boolean {
  if (!left.stem || !right.stem) return false;
  if (left.stem === right.stem && (left.volume != null || right.volume != null)) {
    return true;
  }

  const prefix = commonWordPrefix(left.stem, right.stem);
  if (prefix.length >= 14) return true;
  if (prefix.length >= 9 && (left.volume != null || right.volume != null)) return true;

  const token = firstToken(left.stem);
  if (
    token.length >= 6 &&
    token === firstToken(right.stem) &&
    !STOP_TOKENS.has(token) &&
    left.hasSeparator &&
    right.hasSeparator
  ) {
    return true;
  }

  return false;
}

export function clusterLabel(stems: string[]): string {
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

  const counts = new Map<string, number>();
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
