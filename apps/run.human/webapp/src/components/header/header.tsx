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
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GrMapLocation } from 'react-icons/gr';
import { MenuIcon } from './icon/menu';
import { FaRadio } from 'react-icons/fa6';
import { FaTrophy } from 'react-icons/fa';
import { FiShield, FiDollarSign } from 'react-icons/fi';
import { DonateModal } from '../DonateModal';
import { useCopy } from '../CopyProvider';
import { gpxMapUrl } from '@/lib/gpx-map';

const UserDropDown = dynamic(() => import('./dropdown-user'), {
  ssr: false,
  loading: () => (
    <Avatar size="sm" className="opacity-50 animate-pulse" src="" />
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

const APP_VERSION_TOOLTIP = `DC34 ${process.env.NEXT_PUBLIC_VERSION_APP || 'dev'}`;

// Quick-donate modal targets the bib app cross-origin. The checkout POST hits
// naked /api/* (bib's nginx rewrites it to the region path); the Venmo/Cash App
// provider PAGES are region-prefixed.
const BIB_ORIGIN = 'https://bib.defcon.run';
const BIB_REGION_PREFIX = process.env.NEXT_PUBLIC_REGION_SHORT || 'use1';

// "Maps" goes straight to the gpx map with the official routes layer on. The
// bare gpx.defcon.run origin only reaches it via an interstitial that drops the
// query string, so the URL has to be spelled out — see lib/gpx-map.
const navItems = [
  { href: gpxMapUrl(), label: 'Maps', labelKey: 'common.header.maps', icon: GrMapLocation, external: true },
  { href: '/meshtastic', label: 'Meshtastic', labelKey: 'common.header.meshtastic', icon: FaRadio, external: false },
  // Launched 2026-08-03. The board is signed-in-only, so this renders for
  // everyone but 404s an anonymous click — same posture as the page itself.
  { href: '/leaderboard', label: 'Leaderboard', labelKey: 'common.header.leaderboard', icon: FaTrophy, external: false },
] as const;

/**
 * ONE class string for every top-level nav control so the row reads as a single
 * set. Donate used to be a bare <button> with no icon hanging off "Bib" behind a
 * "/" separator, which is why it sat at a different weight and colour than its
 * neighbours (Kurt, 2026-08-03: "make the header nicer, same font and stuff").
 * Bib itself was dropped from the nav — it still lives in the avatar menu as
 * "My Bib" and on the landing page.
 */
const NAV_BASE = 'flex items-center gap-1.5 text-sm transition-colors relative';
const NAV_IDLE = 'text-default-500 hover:text-foreground';
const NAV_ACTIVE = 'text-primary font-medium nav-active';

export function Header(params: any) {
  const session = params.session;
  const hasSession = session !== null;
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [donateOpen, setDonateOpen] = useState(false);
  const { t } = useCopy();

  // Deep-link auto-open: `?open=donate` pops the quick-give modal (e.g. the
  // static defcon.run landing's Donate tile routes here via /api/auth/auto-signin
  // so login completes first, then lands on /whoami?open=donate). Gated on a live
  // session so the panel never flashes on a pre-login page — mirrors the
  // `?open=checkin|qr` convention in dropdown-user.tsx.
  useEffect(() => {
    if (hasSession && searchParams?.get('open') === 'donate') setDonateOpen(true);
  }, [hasSession, searchParams]);

  // Admin console link shows ONLY for admin/runadmin operators. This is a
  // convenience gate on the cached session claims; the /admin route itself
  // re-checks + live-revalidates, so a stale claim can never grant real access.
  const services = session?.user?.services;
  const isAdmin =
    Array.isArray(services) &&
    (services.includes('admin') || services.includes('runadmin'));

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
          <MenuDropDown session={session} isAdmin={isAdmin} onDonate={() => setDonateOpen(true)} />
        </NavbarItem>
      </NavbarContent>

      {/* Mobile: wordmark */}
      <NavbarContent className="sm:hidden" justify="center">
        <NavbarItem>
          <Tooltip content={APP_VERSION_TOOLTIP} placement="bottom">
            <Link color="foreground" href="/">
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
            <Link color="foreground" href="/">
              <span className="font-museo text-lg font-bold tracking-tight">
                defcon<span className="teal-dot">.</span>run
              </span>
            </Link>
          </Tooltip>
        </NavbarItem>

        {navItems.map(({ href, labelKey, icon: Icon, external }) => {
          const isActive = !external && !!pathname && pathname.replace(basePath, '').startsWith(href);
          return (
            <NavbarItem key={href}>
              <Link
                color="foreground"
                href={href}
                {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                className={`${NAV_BASE} ${isActive ? NAV_ACTIVE : NAV_IDLE}`}
              >
                <Icon className="w-4 h-4" />
                {t(labelKey)}
              </Link>
            </NavbarItem>
          );
        })}

        {/* Donate opens the quick-give modal in place (the bib app is
            cross-origin), so it is a button rather than a link — but it is
            styled and iconed exactly like its neighbours. */}
        <NavbarItem>
          <button type="button" onClick={() => setDonateOpen(true)} className={`${NAV_BASE} ${NAV_IDLE}`}>
            <FiDollarSign className="w-4 h-4" />
            {t('common.header.donate')}
          </button>
        </NavbarItem>

        {isAdmin && (
          <NavbarItem>
            <Link
              color="foreground"
              href="/admin"
              className={`${NAV_BASE} ${
                pathname && pathname.replace(basePath, '').startsWith('/admin') ? NAV_ACTIVE : NAV_IDLE
              }`}
            >
              <FiShield className="w-4 h-4" />
              {t('common.header.admin')}
            </Link>
          </NavbarItem>
        )}
      </NavbarContent>

      {/* Right: theme + auth */}
      <NavbarContent justify="end" className="gap-2">
        <NavbarItem>
          <ThemeSwitch />
        </NavbarItem>
        <NavbarItem>
          {hasSession ? (
            <UserDropDown session={session} />
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
