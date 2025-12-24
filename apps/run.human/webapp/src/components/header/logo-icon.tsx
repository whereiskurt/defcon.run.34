"use client";

import React, { useEffect, useState } from "react";
import Image from 'next/image';
import BunnyWhite from "@public/header/Buny-White-Trans.svg";
import BunnyBlack from "@public/header/Bunny-Black-Trans.svg";

import { useTheme } from "next-themes";

const defaultTheme = 'light'; // Default theme if none is set
export function Logo() {
  const { theme, resolvedTheme } = useTheme();
  const [currentTheme, setCurrentTheme] = useState<string>(defaultTheme); // Default to light for initial render

  useEffect(() => {
    const detectTheme = () => {
      if (document.documentElement.classList.contains('dark')) {
        setCurrentTheme('dark');
      } else if (document.documentElement.classList.contains('light')) {
        setCurrentTheme('light');
      } else if (document.documentElement.classList.contains('modern')) {
        setCurrentTheme('modern');
      } else {
        setCurrentTheme(resolvedTheme || theme || defaultTheme);
      }
    };

    detectTheme();

    const observer = new MutationObserver(detectTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class']
    });

    return () => observer.disconnect();
  }, [resolvedTheme, theme]);

  const getBunnyForTheme = () => {
    switch (currentTheme) {
      case 'dark':
        return BunnyWhite;
      case 'light':
        return BunnyBlack;
      case 'modern':
        return BunnyWhite;
      default:
        return BunnyWhite;
    }
  };

  return (
    <Image
      alt="Bunny"
      priority={true}
      width={200}
      src={getBunnyForTheme()}
    />
  );
}
