import { ja } from "./ja.js";
import { en } from "./en.js";

export const LOCALES = { ja, en } as const;

export type Locale = keyof typeof LOCALES;

export type LocaleMessages = typeof ja;
