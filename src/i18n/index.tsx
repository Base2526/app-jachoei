import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppLanguage, DEFAULT_LANGUAGE, translations, type TranslationDict } from "./translations";

const LANGUAGE_STORAGE_KEY = "jachoei.language";

type I18nContextValue = {
  language: AppLanguage;
  ready: boolean;
  setLanguage: (next: AppLanguage) => Promise<void>;
  t: (key: string, vars?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function isSupportedLanguage(value: string | null | undefined): value is AppLanguage {
  return value === "en" || value === "th";
}

function getNested(dict: TranslationDict, path: string): string | null {
  const parts = path.split(".");
  let node: any = dict;

  for (const p of parts) {
    if (!node || typeof node !== "object" || !(p in node)) return null;
    node = node[p];
  }

  return typeof node === "string" ? node : null;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{\{(.*?)\}\}/g, (_, rawKey) => {
    const key = String(rawKey || "").trim();
    const value = vars[key];
    return value == null ? "" : String(value);
  });
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(DEFAULT_LANGUAGE);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        const stored = await AsyncStorage.getItem(LANGUAGE_STORAGE_KEY);
        if (mounted && isSupportedLanguage(stored)) {
          setLanguageState(stored);
        }
      } catch {
        // keep default language
      } finally {
        if (mounted) setReady(true);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  const setLanguage = useCallback(async (next: AppLanguage) => {
    setLanguageState(next);
    try {
      await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    } catch {
      // keep in-memory language even if persistence fails
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = translations[language] ?? translations[DEFAULT_LANGUAGE];
      const fallbackDict = translations[DEFAULT_LANGUAGE];
      const value = getNested(dict, key) ?? getNested(fallbackDict, key) ?? key;
      return interpolate(value, vars);
    },
    [language]
  );

  const value = useMemo<I18nContextValue>(
    () => ({ language, setLanguage, t, ready }),
    [language, setLanguage, t, ready]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useI18n must be used within LanguageProvider");
  }
  return ctx;
}
