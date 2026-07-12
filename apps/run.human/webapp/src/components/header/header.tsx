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
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { GrMapLocation } from 'react-icons/gr';
import { MenuIcon } from './icon/menu';
import { FaRadio } from 'react-icons/fa6';
import { PiPersonSimpleRun } from 'react-icons/pi';
import { FiShield } from 'react-icons/fi';
import { DonateModal } from '../DonateModal';
import { useCopy } from '../CopyProvider';

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

const navItems = [
  { href: 'https://gpx.defcon.run', label: 'Maps', labelKey: 'common.header.maps', icon: GrMapLocation, external: true },
  { href: '/meshtastic', label: 'Meshtastic', labelKey: 'common.header.meshtastic', icon: FaRadio, external: false },
  { href: 'https://bib.defcon.run', label: 'Bib', labelKey: 'common.header.bib', icon: PiPersonSimpleRun, external: true },
] as const;

export function Header(params: any) {
  const session = params.session;
  const hasSession = session !== null;
  const pathname = usePathname();
  const [donateOpen, setDonateOpen] = useState(false);
  const { t } = useCopy();

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

        {navItems.map(({ href, label, labelKey, icon: Icon, external }) => {
          const isActive = !external && !!pathname && pathname.replace(basePath, '').startsWith(href);
          return (
            <NavbarItem key={href}>
              <span className="text-sm flex items-center gap-1.5 py-1">
                <Link
                  color="foreground"
                  href={href}
                  {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
                  className={`flex items-center gap-1.5 transition-colors relative ${
                    isActive
                      ? 'text-primary font-medium nav-active'
                      : 'text-default-500 hover:text-foreground'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t(labelKey)}
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
                      {t('common.header.donate')}
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
              className={`flex items-center gap-1.5 transition-colors relative ${
                pathname && pathname.replace(basePath, '').startsWith('/admin')
                  ? 'text-primary font-medium nav-active'
                  : 'text-default-500 hover:text-foreground'
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
