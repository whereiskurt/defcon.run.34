"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Button } from "@heroui/react";
import { FiSun, FiMoon } from "react-icons/fi";

/**
 * Minimal light/dark toggle (v1.6). next-themes drives the `class` on <html>;
 * HeroUI + globals.css react to it. SSR-safe: renders a stable icon until
 * mounted so the server and first client render match.
 */
export function ThemeSwitch() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const isLight = mounted && resolvedTheme === "light";

  return (
    <Button
      isIconOnly
      size="sm"
      variant="light"
      aria-label={`Switch to ${isLight ? "dark" : "light"} mode`}
      className="text-default-500 hover:text-foreground min-w-8 w-8 h-8"
      onPress={() => setTheme(isLight ? "dark" : "light")}
    >
      {isLight ? <FiMoon className="w-5 h-5" /> : <FiSun className="w-5 h-5" />}
    </Button>
  );
}

export default ThemeSwitch;
