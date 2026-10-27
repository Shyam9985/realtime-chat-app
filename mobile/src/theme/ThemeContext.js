import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { light, dark } from './palette';

/*
 * Ported from the web client's contexts/ThemeContext.jsx and contexts/FontSizeContext.jsx:
 *  - theme: light, dark or system (follows the phone's setting, and the default), persisted
 *  - font size: 12 to 20 px in steps of 2, 16 by default, persisted. The web scaled the root font
 *    size; here every theme.font value is scaled by fontSize / 16, which every screen reads.
 */
const THEME_KEY = 'chat-app.theme';
const FONT_KEY = 'chat-app.font-size';
export const DEFAULT_FONT = 16;
export const MIN_FONT = 12;
export const MAX_FONT = 20;

const ThemeContext = createContext(null);

const persist = (key, value) => AsyncStorage.setItem(key, String(value)).catch(() => {});

const scaleFonts = (base, scale) => (scale === 1 ? base : {
  ...base,
  font: Object.fromEntries(Object.entries(base.font).map(([k, v]) => [k, Math.round(v * scale)])),
});

export function ThemeProvider({ children }) {
  const [mode, setMode] = useState('system');
  const systemScheme = useColorScheme();   // 'light' | 'dark' | null; updates when the phone's setting changes
  const [fontSize, setFontSizeState] = useState(DEFAULT_FONT);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(THEME_KEY), AsyncStorage.getItem(FONT_KEY)])
      .then(([savedTheme, savedFont]) => {
        if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'system') setMode(savedTheme);
        const size = Number(savedFont);
        if (size >= MIN_FONT && size <= MAX_FONT) setFontSizeState(size);
      })
      .catch(() => {});
  }, []);

  const setLightTheme = useCallback(() => { setMode('light'); persist(THEME_KEY, 'light'); }, []);
  const setDarkTheme = useCallback(() => { setMode('dark'); persist(THEME_KEY, 'dark'); }, []);
  const setSystemTheme = useCallback(() => { setMode('system'); persist(THEME_KEY, 'system'); }, []);
  const setFontSize = useCallback((next) => {
    const size = Math.min(MAX_FONT, Math.max(MIN_FONT, next));
    setFontSizeState(size);
    persist(FONT_KEY, size);
  }, []);

  const value = useMemo(() => {
    const isDark = mode === 'dark' || (mode === 'system' && systemScheme === 'dark');
    return { theme: scaleFonts(isDark ? dark : light, fontSize / DEFAULT_FONT), isDark, mode, setLightTheme, setDarkTheme, setSystemTheme, fontSize, setFontSize };
  }, [mode, systemScheme, fontSize, setLightTheme, setDarkTheme, setSystemTheme, setFontSize]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
