import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "launchpad-theme";
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

function applyTheme(theme: Theme) {
  const isDark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia(DARK_MEDIA_QUERY).matches);

  document.documentElement.classList.toggle("dark", isDark);
  document.documentElement.classList.toggle("light", theme === "light");
  document.documentElement.style.colorScheme = isDark ? "dark" : "light";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    let storedTheme: string | null = null;

    try {
      storedTheme = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // System preference remains available when storage is blocked.
    }
    const initialTheme = isTheme(storedTheme) ? storedTheme : "dark";

    setThemeState(initialTheme);
    applyTheme(initialTheme);
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(DARK_MEDIA_QUERY);
    const handleChange = () => {
      if (theme === "system") {
        applyTheme("system");
      }
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme(nextTheme) {
        try {
          window.localStorage.setItem(STORAGE_KEY, nextTheme);
        } catch {
          // The selected theme still applies for the current page session.
        }
        setThemeState(nextTheme);
        applyTheme(nextTheme);
      },
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider.");
  }

  return context;
}

export const themeBootstrapScript = `
  (() => {
    try {
      const stored = localStorage.getItem("${STORAGE_KEY}");
      const theme = stored === "light" || stored === "dark" || stored === "system"
        ? stored
        : "dark";
      const isDark = theme === "dark" ||
        (theme === "system" && matchMedia("${DARK_MEDIA_QUERY}").matches);
      document.documentElement.classList.toggle("dark", isDark);
      document.documentElement.classList.toggle("light", theme === "light");
      document.documentElement.style.colorScheme = isDark ? "dark" : "light";
    } catch {
      // The CSS media query remains the fallback when storage is unavailable.
    }
  })();
`;
