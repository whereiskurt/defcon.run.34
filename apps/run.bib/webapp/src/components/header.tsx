"use client";

import {
  Navbar,
  NavbarContent,
  NavbarItem,
  Link,
  Tooltip,
} from "@heroui/react";
import { useState } from "react";
import { usePathname } from "next/navigation";
import { GrMapLocation } from "react-icons/gr";
import { FaRadio } from "react-icons/fa6";
import { PiPersonSimpleRun } from "react-icons/pi";
import { FiShield } from "react-icons/fi";

import { runHumanUrl } from "@/lib/run-human-url";

import { ThemeSwitch } from "./theme-switch";
import { UserDropdown } from "./user-dropdown";
import { MenuDropdown } from "./menu-dropdown";
import { DonateModal } from "./DonateModal";

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

// Region prefix (no leading slash) for the same-origin donate provider pages;
// empty in dev where there is no basePath. bibOrigin stays "" (same app).
const DONATE_REGION_PREFIX =
  process.env.NODE_ENV === "production"
    ? process.env.NEXT_PUBLIC_REGION_SHORT || "use1"
    : "";

const APP_VERSION_TOOLTIP = `DC34 ${process.env.NEXT_PUBLIC_VERSION_APP || "dev"}`;

const navItems = [
  { href: "https://gpx.defcon.run", label: "Maps", icon: GrMapLocation, external: true },
  { href: runHumanUrl("/meshtastic"), label: "Meshtastic", icon: FaRadio, external: true },
  { href: "/orderform", label: "Bib", icon: PiPersonSimpleRun, external: false },
] as const;

export interface HeaderProps {
  userName?: string | null;
  isAdmin?: boolean;
}

export function Header({ userName, isAdmin = false }: HeaderProps) {
  const pathname = usePathname();
  const normalized = (pathname || "").replace(basePath, "");
  const [donateOpen, setDonateOpen] = useState(false);

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
    <>
    <Navbar maxWidth="lg" classNames={{ base: "glass-nav", wrapper: "max-w-[900px]" }}>
      {/* Mobile: hamburger nav */}
      <NavbarContent className="sm:hidden" justify="start">
        <NavbarItem>
          <MenuDropdown isAdmin={isAdmin} onDonate={() => setDonateOpen(true)} />
        </NavbarItem>
      </NavbarContent>

      {/* Mobile: wordmark */}
      <NavbarContent className="sm:hidden" justify="center">
        <NavbarItem>{Wordmark}</NavbarItem>
      </NavbarContent>

      {/* Desktop: wordmark + nav */}
      <NavbarContent className="sm:flex hidden gap-6" justify="center">
        <NavbarItem>{Wordmark}</NavbarItem>
        {navItems.map(({ href, label, icon: Icon, external }) => {
          const isActive = !external && normalized.startsWith(href);
          return (
            <NavbarItem key={href}>
              <span className="text-sm flex items-center gap-1.5 py-1">
                <Link
                  color="foreground"
                  href={href}
                  {...(external ? { isExternal: true, target: "_blank", rel: "noreferrer" } : {})}
                  className={`flex items-center gap-1.5 transition-colors relative ${
                    isActive
                      ? "text-primary font-medium nav-active"
                      : "text-default-500 hover:text-foreground"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </Link>
                {/* "Bib" gains a sibling "Donate $" that opens the quick-give
                  * modal in place (same-origin here in run.bib). */}
                {label === "Bib" && (
                  <>
                    <span className="text-default-400">/</span>
                    <button
                      type="button"
                      onClick={() => setDonateOpen(true)}
                      className="transition-colors text-default-500 hover:text-foreground"
                    >
                      Donate $
                    </button>
                  </>
                )}
              </span>
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

      {/* Right: theme + avatar dropdown (matches run.defcon.run) */}
      <NavbarContent justify="end" className="gap-3">
        <NavbarItem>
          <ThemeSwitch />
        </NavbarItem>
        {userName ? (
          <NavbarItem>
            <UserDropdown />
          </NavbarItem>
        ) : null}
      </NavbarContent>
    </Navbar>

    <DonateModal
      open={donateOpen}
      onClose={() => setDonateOpen(false)}
      regionPrefix={DONATE_REGION_PREFIX}
    />
    </>
  );
}

export default Header;
