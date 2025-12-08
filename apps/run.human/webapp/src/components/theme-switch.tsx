"use client";

import { FC, useRef, useState, useEffect } from "react";
import { VisuallyHidden } from "@react-aria/visually-hidden";
import { SwitchProps, useSwitch } from "@heroui/switch";
import { useTheme } from "next-themes";
import { useIsSSR } from "@react-aria/ssr";
import { usePathname } from "next/navigation";
import clsx from "clsx";
import { IconSvgProps } from "@svgtypes";

export const MoonFilledIcon = ({
  size = 24,
  width,
  height,
  ...props
}: IconSvgProps) => (
  <svg
    aria-hidden="true"
    focusable="false"
    height={size || height}
    role="presentation"
    viewBox="0 0 24 24"
    width={size || width}
    {...props}
  >
    <path
      d="M21.53 15.93c-.16-.27-.61-.69-1.73-.49a8.46 8.46 0 01-1.88.13 8.409 8.409 0 01-5.91-2.82 8.068 8.068 0 01-1.44-8.66c.44-1.01.13-1.54-.09-1.76s-.77-.55-1.83-.11a10.318 10.318 0 00-6.32 10.21 10.475 10.475 0 007.04 8.99 10 10 0 002.89.55c.16.01.32.02.48.02a10.5 10.5 0 008.47-4.27c.67-.93.49-1.519.32-1.79z"
      fill="currentColor"
    />
  </svg>
);

export const SunFilledIcon = ({
  size = 24,
  width,
  height,
  ...props
}: IconSvgProps) => (
  <svg
    aria-hidden="true"
    focusable="false"
    height={size || height}
    role="presentation"
    viewBox="0 0 24 24"
    width={size || width}
    {...props}
  >
    <g fill="currentColor">
      <path d="M19 12a7 7 0 11-7-7 7 7 0 017 7z" />
      <path d="M12 22.96a.969.969 0 01-1-.96v-.08a1 1 0 012 0 1.038 1.038 0 01-1 1.04zm7.14-2.82a1.024 1.024 0 01-.71-.29l-.13-.13a1 1 0 011.41-1.41l.13.13a1 1 0 010 1.41.984.984 0 01-.7.29zm-14.28 0a1.024 1.024 0 01-.71-.29 1 1 0 010-1.41l.13-.13a1 1 0 011.41 1.41l-.13.13a1 1 0 01-.7.29zM22 13h-.08a1 1 0 010-2 1.038 1.038 0 011.04 1 .969.969 0 01-.96 1zM2.08 13H2a1 1 0 010-2 1.038 1.038 0 011.04 1 .969.969 0 01-.96 1zm16.93-7.01a1.024 1.024 0 01-.71-.29 1 1 0 010-1.41l.13-.13a1 1 0 011.41 1.41l-.13.13a.984.984 0 01-.7.29zm-14.02 0a1.024 1.024 0 01-.71-.29l-.13-.14a1 1 0 011.41-1.41l.13.13a1 1 0 010 1.41.97.97 0 01-.7.3zM12 3.04a.969.969 0 01-1-.96V2a1 1 0 012 0 1.038 1.038 0 01-1 1.04z" />
    </g>
  </svg>
);

export interface ThemeSwitchProps {
  className?: string;
  classNames?: SwitchProps["classNames"];
}

export const ThemeSwitch: FC<ThemeSwitchProps> = ({
  className,
  classNames,
}) => {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const isSSR = useIsSSR();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  
  // Fire mode state and rapid click detection
  const [fireMode, setFireMode] = useState(false);
  const clickCount = useRef(0);
  const clickTimeout = useRef<NodeJS.Timeout | null>(null);
  const isHeatmapPage = pathname === '/heatmap';

  useEffect(() => {
    setMounted(true);
  }, []);

  const onChange = () => {
    theme === "light" ? setTheme("dark") : setTheme("light");
    
    // Only track rapid clicks on heatmap page
    if (isHeatmapPage) {
      clickCount.current += 1;
      
      // Clear existing timeout
      if (clickTimeout.current) {
        clearTimeout(clickTimeout.current);
      }
      
      // Check for rapid clicking (10+ clicks in 2 seconds)
      if (clickCount.current >= 10) {
        setFireMode(prev => !prev);
        clickCount.current = 0;
        
        // Show mode activation feedback
        const flash = document.createElement('div');
        const newMode = !fireMode;
        
        flash.style.cssText = `
          position: fixed;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: ${newMode ? 'linear-gradient(45deg, #00ff00, #00ff00aa)' : 'linear-gradient(45deg, #333, #666)'};
          color: #fff;
          padding: 20px 30px;
          font-family: 'Courier New', monospace;
          font-size: 24px;
          font-weight: bold;
          z-index: 9999;
          border: 2px solid ${newMode ? '#00ff00' : '#666'};
          border-radius: 8px;
          box-shadow: 0 0 30px ${newMode ? '#00ff00' : '#666'}, inset 0 0 20px ${newMode ? '#00ff0050' : '#66650'};
          text-shadow: 0 0 10px #fff;
          animation: modeFlash 1.5s ease-out;
        `;
        flash.innerHTML = newMode ? 
          `ACTIVATED!` : 
          ``;
        
        // Add flash animation CSS
        const style = document.createElement('style');
        style.textContent = `
          @keyframes modeFlash {
            0% { opacity: 0; transform: translate(-50%, -50%) scale(0.5); }
            20% { opacity: 1; transform: translate(-50%, -50%) scale(1.1); }
            80% { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            100% { opacity: 0; transform: translate(-50%, -50%) scale(0.9); }
          }
        `;
        document.head.appendChild(style);
        document.body.appendChild(flash);
        
        setTimeout(() => {
          if (document.body.contains(flash)) {
            document.body.removeChild(flash);
          }
          if (document.head.contains(style)) {
            document.head.removeChild(style);
          }
        }, 1500);
      } else {
        // Reset click count after 2 seconds
        clickTimeout.current = setTimeout(() => {
          clickCount.current = 0;
        }, 2000);
      }
    }
  };
  
  // Apply mode classes to body when activated
  useEffect(() => {
    if (isHeatmapPage && fireMode) {
      document.body.classList.add('fireMode', 'matrixMode');
    } else {
      document.body.classList.remove('fireMode', 'matrixMode');
    }
    
    return () => {
      document.body.classList.remove('fireMode', 'matrixMode');
    };
  }, [fireMode, isHeatmapPage]);

  const {
    Component,
    slots,
    isSelected,
    getBaseProps,
    getInputProps,
    getWrapperProps,
  } = useSwitch({
    isSelected: resolvedTheme === "light",
    "aria-label": `Switch to ${resolvedTheme === "light" ? "dark" : "light"} mode`,
    onChange,
  });

  // Return consistent loading state during SSR and before mounting
  if (!mounted || isSSR) {
    return (
      <div
        className={clsx(
          "px-px transition-opacity hover:opacity-80 cursor-pointer",
          className,
          classNames?.base,
        )}
      >
        <div
          className={clsx([
            "w-auto h-auto",
            "bg-transparent", 
            "rounded-lg",
            "flex items-center justify-center",
            "!text-default-500",
            "pt-px",
            "px-0",
            "mx-0",
          ])}
        >
          <SunFilledIcon size={22} />
        </div>
      </div>
    );
  }

  return (
    <Component
      {...getBaseProps({
        className: clsx(
          "px-px transition-opacity hover:opacity-80 cursor-pointer",
          className,
          classNames?.base,
        ),
      })}
    >
      <VisuallyHidden>
        <input {...getInputProps()} />
      </VisuallyHidden>
      <div
        {...getWrapperProps()}
        className={slots.wrapper({
          class: clsx(
            [
              "w-auto h-auto",
              "bg-transparent",
              "rounded-lg",
              "flex items-center justify-center",
              "group-data-[selected=true]:bg-transparent",
              "!text-default-500",
              "pt-px",
              "px-0",
              "mx-0",
            ],
            classNames?.wrapper,
          ),
        })}
      >
        {!isSelected ? (
          <SunFilledIcon size={22} />
        ) : (
          <MoonFilledIcon size={22} />
        )}
      </div>
    </Component>
  );
};
