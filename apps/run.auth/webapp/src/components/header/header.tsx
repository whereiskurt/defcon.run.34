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
import { GrMapLocation } from 'react-icons/gr';
import { MenuIcon } from './icon/menu';
import { FaRadio } from 'react-icons/fa6';

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

const APP_VERSION_TOOLTIP = `DC34 Auth ${process.env.NEXT_PUBLIC_VERSION_APP || 'dev'}`;

const navItems = [
  { href: 'https://gpx.defcon.run', label: 'Maps', icon: GrMapLocation, external: true },
  { href: `https://run.defcon.run/meshtastic`, label: 'Meshtastic', icon: FaRadio, external: true },
] as const;

export function Header() {
  const { data: session, status } = useSession();
  const hasSession = status === 'authenticated' && !!session?.user;

  return (
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
          <MenuDropDown />
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
            <Link
              color="foreground"
              href={href}
              {...(external ? { target: '_blank', rel: 'noreferrer' } : {})}
              className="text-sm flex items-center gap-1.5 transition-colors relative py-1 text-default-500 hover:text-foreground"
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
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
  );
}
