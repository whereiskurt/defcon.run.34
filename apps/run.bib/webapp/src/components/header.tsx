"use client";

import {
  Navbar,
  NavbarContent,
  NavbarItem,
  Link,
  Button,
  Tooltip,
} from "@heroui/react";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { GrMapLocation } from "react-icons/gr";
import { FaRadio } from "react-icons/fa6";
import { PiPersonSimpleRun } from "react-icons/pi";
import { FiShield } from "react-icons/fi";

import { ThemeSwitch } from "./theme-switch";

/**
 * Site header (v1.6) — ported look from run.human's HeroUI Navbar so the bib
 * app reads as the same site: glass-nav wordmark `defcon.run` (teal dot,
 * MuseoModerno) + Maps / Meshtastic / Bib nav + theme toggle + sign-out.
 * The admin link only shows for members of the "admin" group.
 */
const basePath =
  process.env.NODE_ENV === "production"
    ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || "use1"}`
    : "";

const APP_VERSION_TOOLTIP = `DC34 ${process.env.NEXT_PUBLIC_VERSION_APP || "dev"}`;

const navItems = [
  { href: "https://gpx.defcon.run", label: "Maps", icon: GrMapLocation, external: true },
  { href: "https://run.defcon.run/meshtastic", label: "Meshtastic", icon: FaRadio, external: true },
  { href: "/orderform", label: "Bib", icon: PiPersonSimpleRun, external: false },
] as const;

export interface HeaderProps {
  userName?: string | null;
  isAdmin?: boolean;
}

export function Header({ userName, isAdmin = false }: HeaderProps) {
  const pathname = usePathname();
  const normalized = (pathname || "").replace(basePath, "");

  const Wordmark = (
    <Tooltip content={APP_VERSION_TOOLTIP} placement="bottom">
      <Link color="foreground" href="/orderform">
        <span className="font-museo text-lg font-bold tracking-tight">
          defcon<span className="teal-dot">.</span>run
        </span>
      </Link>
    </Tooltip>
  );

  return (
    <Navbar maxWidth="lg" classNames={{ base: "glass-nav", wrapper: "max-w-[900px]" }}>
      {/* Mobile: wordmark */}
      <NavbarContent className="sm:hidden" justify="start">
        <NavbarItem>{Wordmark}</NavbarItem>
      </NavbarContent>

      {/* Desktop: wordmark + nav */}
      <NavbarContent className="sm:flex hidden gap-6" justify="center">
        <NavbarItem>{Wordmark}</NavbarItem>
        {navItems.map(({ href, label, icon: Icon, external }) => {
          const isActive = !external && normalized.startsWith(href);
          return (
            <NavbarItem key={href}>
              <Link
                color="foreground"
                href={href}
                {...(external ? { isExternal: true, target: "_blank", rel: "noreferrer" } : {})}
                className={`text-sm flex items-center gap-1.5 transition-colors relative py-1 ${
                  isActive
                    ? "text-primary font-medium nav-active"
                    : "text-default-500 hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            </NavbarItem>
          );
        })}
        {isAdmin && (
          <NavbarItem>
            <Link
              color="foreground"
              href="/admin"
              className={`text-sm flex items-center gap-1.5 transition-colors relative py-1 ${
                normalized.startsWith("/admin")
                  ? "text-primary font-medium nav-active"
                  : "text-default-500 hover:text-foreground"
              }`}
            >
              <FiShield className="w-4 h-4" />
              Admin
            </Link>
          </NavbarItem>
        )}
      </NavbarContent>

      {/* Right: theme + sign-out */}
      <NavbarContent justify="end" className="gap-2">
        <NavbarItem>
          <ThemeSwitch />
        </NavbarItem>
        {userName ? (
          <NavbarItem className="flex items-center gap-2">
            <span className="hidden sm:inline text-xs text-default-500 max-w-[140px] truncate">
              {userName}
            </span>
            <Button
              size="sm"
              variant="flat"
              className="text-xs"
              onPress={() => signOut({ callbackUrl: "/orderform" })}
            >
              Sign out
            </Button>
          </NavbarItem>
        ) : null}
      </NavbarContent>
    </Navbar>
  );
}

export default Header;
