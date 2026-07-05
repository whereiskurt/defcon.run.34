'use client';

import {
  Avatar,
  Button,
  Link,
  Navbar,
  NavbarContent,
  NavbarItem,
  Tooltip,
} from '@heroui/react';
import dynamic from 'next/dynamic';
import { useSession } from 'next-auth/react';
import { useState } from 'react';
import { GrMapLocation } from 'react-icons/gr';
import { MenuIcon } from './icon/menu';
import { FaRadio } from 'react-icons/fa6';
import { PiPersonSimpleRun } from 'react-icons/pi';
import { DonateModal } from '../DonateModal';

const UserDropDown = dynamic(() => import('./dropdown-user'), {
  ssr: false,
  loading: () => (
    <Avatar size="lg" className="opacity-50 animate-pulse" src="" />
  ),
});
const LoginDropDown = dynamic(() => import('./dropdown-login'), {
  ssr: false,
  loading: () => (
    <Button variant="light" className="opacity-50 animate-pulse" disabled size="sm">
      Login
    </Button>
  ),
});
const MenuDropDown = dynamic(() => import('./dropdown-menu'), {
  ssr: false,
  loading: () => (
    <div className="opacity-50 animate-pulse">
      <MenuIcon />
    </div>
  ),
});

import { ThemeSwitch } from '../theme-switch';

const basePath = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
  : '';

const APP_VERSION_TOOLTIP = `DC34 Flash ${process.env.NEXT_PUBLIC_VERSION_APP || 'dev'}`;

// Region for cross-app deep links into run.defcon.run — always region-prefixed
// (run.defcon.run is region-mounted even when this app runs locally).
const runRegion = process.env.NEXT_PUBLIC_REGION_SHORT || 'use1';

// Quick-donate modal targets the bib app cross-origin (checkout POST hits naked
// /api/*; Venmo/Cash App provider PAGES are region-prefixed).
const BIB_ORIGIN = 'https://bib.defcon.run';
const BIB_REGION_PREFIX = process.env.NEXT_PUBLIC_REGION_SHORT || 'use1';

// Aligned with run/bib desktop nav: Maps · Meshtastic · Bib.
const navItems = [
  { href: 'https://gpx.defcon.run', label: 'Maps', icon: GrMapLocation, external: true },
  { href: `https://run.defcon.run/${runRegion}/meshtastic`, label: 'Meshtastic', icon: FaRadio, external: true },
  { href: 'https://bib.defcon.run', label: 'Bib', icon: PiPersonSimpleRun, external: true },
] as const;

export function Header() {
  const { data: session } = useSession();
  const hasSession = !!session?.user;
  const [donateOpen, setDonateOpen] = useState(false);

  return (
    <>
    <Navbar
      maxWidth="lg"
      classNames={{
        base: "glass-nav",
        wrapper: "max-w-[900px]",
      }}
    >
      {/* Mobile: hamburger */}
      <NavbarContent className="sm:hidden" justify="start">
        <NavbarItem>
          <MenuDropDown onDonate={() => setDonateOpen(true)} />
        </NavbarItem>
      </NavbarContent>

      {/* Mobile: wordmark */}
      <NavbarContent className="sm:hidden" justify="center">
        <NavbarItem>
          <Tooltip content={APP_VERSION_TOOLTIP} placement="bottom">
            <Link color="foreground" href={`${basePath}/`}>
              <span className="font-museo text-lg font-bold tracking-tight">
                defcon<span className="teal-dot">.</span>run
              </span>
            </Link>
          </Tooltip>
        </NavbarItem>
      </NavbarContent>

      {/* Desktop: wordmark + nav */}
      <NavbarContent className="sm:flex hidden gap-6" justify="center">
        <NavbarItem>
          <Tooltip content={APP_VERSION_TOOLTIP} placement="bottom">
            <Link color="foreground" href={`${basePath}/`}>
              <span className="font-museo text-lg font-bold tracking-tight">
                defcon<span className="teal-dot">.</span>run
              </span>
            </Link>
          </Tooltip>
        </NavbarItem>

        {navItems.map(({ href, label, icon: Icon, external }) => (
          <NavbarItem key={href}>
            <span className="text-sm flex items-center gap-1.5 py-1">
              <Link
                color="foreground"
                href={href}
                {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                className="flex items-center gap-1.5 transition-colors relative text-default-500 hover:text-foreground"
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
              {/* "Bib" gains a "Donate $" sibling that opens the quick-give
                * modal in place (cross-origin to the bib app). */}
              {label === 'Bib' && (
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
        ))}
      </NavbarContent>

      {/* Right: theme + auth */}
      <NavbarContent justify="end" className="gap-2">
        <NavbarItem>
          <ThemeSwitch />
        </NavbarItem>
        <NavbarItem>
          {hasSession ? (
            <UserDropDown />
          ) : (
            <LoginDropDown />
          )}
        </NavbarItem>
      </NavbarContent>
    </Navbar>

    <DonateModal
      open={donateOpen}
      onClose={() => setDonateOpen(false)}
      bibOrigin={BIB_ORIGIN}
      regionPrefix={BIB_REGION_PREFIX}
    />
    </>
  );
}
