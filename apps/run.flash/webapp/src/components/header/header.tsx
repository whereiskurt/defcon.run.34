"use client";

import {
  Navbar,
  NavbarBrand,
  NavbarContent,
  Avatar,
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from "@heroui/react";
import { LogOut } from "lucide-react";
import { useSession, signOut } from "next-auth/react";

export function Header() {
  const { data: session } = useSession();

  const userInitials = session?.user?.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <Navbar
      maxWidth="full"
      className="glass-nav"
      classNames={{
        wrapper: "px-4 sm:px-6",
      }}
    >
      <NavbarBrand>
        <span className="font-mono text-lg text-primary">
          flash<span className="text-default-500">.</span>defcon
          <span className="text-default-500">.</span>run
        </span>
      </NavbarBrand>

      <NavbarContent justify="end">
        {session?.user && (
          <Dropdown placement="bottom-end">
            <DropdownTrigger>
              <Avatar
                as="button"
                className="transition-transform"
                color="primary"
                name={userInitials}
                size="sm"
                src={session.user.image || undefined}
              />
            </DropdownTrigger>
            <DropdownMenu aria-label="User menu">
              <DropdownItem
                key="profile"
                className="h-14 gap-2 opacity-100"
                isReadOnly
                textValue="Profile"
              >
                <p className="font-semibold text-sm">
                  {session.user.name || "User"}
                </p>
                <p className="text-xs text-default-500">
                  {session.user.email}
                </p>
              </DropdownItem>
              <DropdownItem
                key="signout"
                color="danger"
                startContent={<LogOut className="w-4 h-4" />}
                onPress={() => signOut()}
                textValue="Sign Out"
              >
                Sign Out
              </DropdownItem>
            </DropdownMenu>
          </Dropdown>
        )}
      </NavbarContent>
    </Navbar>
  );
}
