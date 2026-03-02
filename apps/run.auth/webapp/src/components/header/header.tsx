'use client';

import {
  Avatar,
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
  Link,
  Navbar,
  NavbarContent,
  NavbarItem,
  Tooltip,
} from '@heroui/react';
import dynamic from 'next/dynamic';
import { useSession, signIn } from 'next-auth/react';
import { GrMapLocation } from 'react-icons/gr';
import { FaMoneyCheckDollar, FaRadio, FaFire } from 'react-icons/fa6';
import { Menu } from 'lucide-react';
import { useState } from 'react';
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

const RUN_BASE = 'https://run.defcon.run';
const GPX_BASE = 'https://gpx.defcon.run';

const navItems = [
  { href: GPX_BASE, label: 'Routes', icon: GrMapLocation },
  { href: `${GPX_BASE}?overlay=heatmap`, label: 'HeatMap', icon: FaFire },
  { href: `${RUN_BASE}/meshtastic`, label: 'Meshtastic', icon: FaRadio },
  { href: `${RUN_BASE}/contributors`, label: 'Contributors', icon: FaMoneyCheckDollar },
] as const;

const iconClasses = 'text-lg text-default-400 pointer-events-none flex-shrink-0';

function MobileMenu() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dropdown
      showArrow
      radius="sm"
      backdrop="blur"
      isOpen={isOpen}
      onOpenChange={(open) => setIsOpen(open)}
      classNames={{
        content: 'bg-content1 border border-divider',
      }}
    >
      <DropdownTrigger>
        <div className="cursor-pointer">
          <Menu className="w-6 h-6 text-default-500" />
        </div>
      </DropdownTrigger>

      <DropdownMenu
        aria-label="Navigation menu"
        className="p-2"
        itemClasses={{
          base: [
            'rounded-lg',
            'text-default-600',
            'transition-all',
            'data-[hover=true]:text-foreground',
            'data-[hover=true]:bg-content2',
            'data-[pressed=true]:opacity-70',
          ],
        }}
      >
        <DropdownSection aria-label="Navigation">
          {navItems.map(({ href, label, icon: Icon }) => (
            <DropdownItem
              key={label.toLowerCase()}
              textValue={label}
              startContent={<Icon className={iconClasses} />}
              onClick={() => {
                setIsOpen(false);
                window.open(href, '_blank');
              }}
            >
              <span className="text-base">{label}</span>
            </DropdownItem>
          ))}
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
}

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
          <MobileMenu />
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

        {navItems.map(({ href, label, icon: Icon }) => (
          <NavbarItem key={href}>
            <Link
              color="foreground"
              href={href}
              target="_blank"
              rel="noreferrer"
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
            <Button
              variant="ghost"
              size="sm"
              onPress={() => signIn()}
            >
              Login
            </Button>
          )}
        </NavbarItem>
      </NavbarContent>
    </Navbar>
  );
}
