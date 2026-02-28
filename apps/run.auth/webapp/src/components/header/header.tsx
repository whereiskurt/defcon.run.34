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
import { useSession } from 'next-auth/react';
import { Shield } from 'lucide-react';
import { SiStrava } from 'react-icons/si';
import { ThemeSwitch } from '../theme-switch';

const UserDropDown = dynamic(() => import('./dropdown-user'), {
  ssr: false,
  loading: () => (
    <Avatar size="sm" className="opacity-50 animate-pulse" src="" />
  ),
});

const basePath = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
  : '';

const APP_VERSION_TOOLTIP = `DC34 Auth ${process.env.NEXT_PUBLIC_VERSION_APP || 'dev'}`;

const navItems = [
  { href: '/profile', label: 'Profile', icon: Shield },
  { href: '/strava', label: 'Strava', icon: SiStrava },
] as const;

export function Header() {
  const pathname = usePathname();
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
      {/* Left: wordmark + nav */}
      <NavbarContent className="gap-6" justify="start">
        <NavbarItem>
          <Tooltip content={APP_VERSION_TOOLTIP} placement="bottom">
            <Link color="foreground" href={`${basePath}/`}>
              <span className="font-museo text-lg font-bold tracking-tight">
                auth<span className="teal-dot">.</span>defcon<span className="teal-dot">.</span>run
              </span>
            </Link>
          </Tooltip>
        </NavbarItem>

        {hasSession && navItems.map(({ href, label, icon: Icon }) => {
          const fullHref = `${basePath}${href}`;
          const isActive = pathname?.endsWith(href);
          return (
            <NavbarItem key={href} className="hidden sm:flex">
              <Link
                color="foreground"
                href={fullHref}
                className={`text-sm flex items-center gap-1.5 transition-colors relative py-1 ${
                  isActive
                    ? 'text-primary font-medium nav-active'
                    : 'text-default-500 hover:text-foreground'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            </NavbarItem>
          );
        })}
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
            <Button
              as="a"
              href={`${basePath}/login`}
              variant="ghost"
              size="sm"
            >
              Login
            </Button>
          )}
        </NavbarItem>
      </NavbarContent>
    </Navbar>
  );
}
