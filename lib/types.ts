export interface Book {
  id: number;
  name: string;
  author: string;
  language: string;
  pages: string;
  audience: string;
  image: string;
  stem: string;
  volume: number | null;
  hasSeparator: boolean;
  seriesId: string | null;
  seriesName: string | null;
  authorKey: string;
  audienceBucket: "youth" | "adult" | null;
  shelfKey: string;
  hay: string;
  hayTitle: string;
}

export interface UserState {
  likes: Record<string, number>;
  dislikes: Record<string, number>;
  borrowed: Record<string, number>;
}

export interface BookCard {
  id: number;
  name: string;
  author: string;
  language: string;
  audience: string;
  pages: string;
  image: string;
  liked: boolean;
  disliked: boolean;
  borrowed: boolean;
  reason: string;
  seriesName: string;
}

export interface Profile {
  readCount: number;
  likeCount: number;
  dislikeCount: number;
  borrowedCount: number;
  language: string;
  audience: string;
  note: string;
}
