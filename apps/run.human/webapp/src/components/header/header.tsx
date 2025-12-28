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
import { GrMapLocation } from 'react-icons/gr';
import { MenuIcon } from './icon/menu';
import { Logo } from './logo-icon';

import { FaMoneyCheckDollar, FaRadio, FaFire } from 'react-icons/fa6';

const UserDropDown = dynamic(() => import('./dropdown-user'), {
  ssr: false,
  loading: () => (
    <Avatar
      size="lg"
      className="opacity-50 animate-pulse"
      src=""
    />
  ),
});
const LoginDropDown = dynamic(() => import('./dropdown-login'), {
  ssr: false,
  loading: () => (
    <Button
      variant="ghost"
      className="opacity-50 animate-pulse"
      disabled
    >
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

// Version tooltip - will be populated from environment
const APP_VERSION_TOOLTIP = `DC34 ${process.env.NEXT_PUBLIC_VERSION_APP || 'dev'}`;

export function Header(params: any) {
  const session = params.session;
  const hasSession = session !== null;
  return (
    <Navbar isBordered className="mx-auto max-w-[900px]">
      <NavbarContent className="sm:hidden" justify="start">
        <NavbarItem>
          <MenuDropDown session={session} />
        </NavbarItem>
      </NavbarContent>
      <NavbarContent className="sm:hidden" justify="center">
        <NavbarItem className="">
          <Tooltip content={APP_VERSION_TOOLTIP} placement="bottom">
            <Link color="foreground" href="/dashboard">
              <Logo />
            </Link>
          </Tooltip>
        </NavbarItem>
      </NavbarContent>
      <NavbarContent className="sm:flex hidden" justify="center">
        <>
          <NavbarItem>
            <Tooltip content={APP_VERSION_TOOLTIP} placement="bottom">
              <Link color="foreground" href="/dashboard">
                <Logo />
              </Link>
            </Tooltip>
          </NavbarItem>
        </>
        {hasSession ? (
          <>
            <NavbarItem>
              <Link color="foreground" href="/routes">
                <Button variant="ghost">
                  <GrMapLocation size={24} />
                  Routes
                </Button>
              </Link>
            </NavbarItem>
            <NavbarItem>
              <Link className='p-0 m-0' color="foreground" href="/heatmap">
                <Button variant="ghost">
                  <FaFire size={24} />
                  HeatMap
                </Button>
              </Link>
            </NavbarItem>
          </>
        ) : (
          <>
            <NavbarItem>
              <Link color="foreground" href="/routes">
                <Button variant="ghost">
                  <GrMapLocation size={24} />
                  Routes
                </Button>
              </Link>
            </NavbarItem>
            <NavbarItem>
              <Link className='p-0 m-0' color="foreground" href="/heatmap">
                <Button variant="ghost">
                  <FaFire size={24} />
                  HeatMap
                </Button>
              </Link>
            </NavbarItem>
          </>
        )}
        <NavbarItem>
          <Link color="foreground" href="/meshtastic">
            <Button variant="ghost">
              <FaRadio size={24} />
              Meshtastic
            </Button>
          </Link>
        </NavbarItem>


        <NavbarItem>
          <Link color="foreground" href="/contributors">
            <Button variant="ghost">
              <FaMoneyCheckDollar size={24} />
              Contributors
            </Button>
          </Link>
        </NavbarItem>

      </NavbarContent>

      <NavbarContent justify="end">
        <NavbarItem>
          <ThemeSwitch />
        </NavbarItem>
        {hasSession ? (
          <>
            <NavbarItem>
              <UserDropDown session={session} />
            </NavbarItem>
          </>
        ) : (
          <>
            <NavbarItem>
              <LoginDropDown />
            </NavbarItem>
          </>
        )}
      </NavbarContent>
    </Navbar>
  );
}
