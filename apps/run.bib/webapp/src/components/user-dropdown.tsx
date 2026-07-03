"use client";

import {
  Avatar,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
  User,
} from "@heroui/react";
import { useSession, signOut } from "next-auth/react";
import { PiPersonSimpleRun } from "react-icons/pi";
import { FiShield, FiLogOut } from "react-icons/fi";

/**
 * User avatar + dropdown for the bib header — matches run.human's header
 * pattern (teal-bordered avatar → blur dropdown with a User header + menu),
 * trimmed to bib-relevant items: My bib, Admin (admin group only), Sign out.
 *
 * Reads the live session client-side (SessionProvider is mounted in the root
 * layout). Avatar uses `session.user.image` (the OIDC picture claim) and
 * falls back to initials from the name when no image is present.
 */
export function UserDropdown() {
  const { data: session } = useSession();
  const user = session?.user as
    | { name?: string | null; email?: string | null; image?: string | null; services?: string[] }
    | undefined;
  if (!user) return null;

  const name = user.name || user.email || "Runner";
  const isAdmin = Array.isArray(user.services) && user.services.includes("admin");

  return (
    <Dropdown
      backdrop="blur"
      showArrow
      radius="sm"
      classNames={{
        base: "before:bg-default-200",
        content: "p-0 border-small border-divider bg-background",
      }}
    >
      <DropdownTrigger>
        <Avatar
          src={user.image ?? undefined}
          name={name}
          showFallback
          isBordered
          color="primary"
          size="md"
          className="cursor-pointer transition-transform"
        />
      </DropdownTrigger>

      <DropdownMenu
        aria-label="User menu"
        topContent={
          <User
            name={name}
            description={
              <span className="text-xs text-default-400">{user.email}</span>
            }
            avatarProps={{
              src: user.image ?? undefined,
              name,
              showFallback: true,
              size: "sm",
            }}
            className="justify-start px-3 pt-3 pb-1"
          />
        }
      >
        <DropdownItem
          key="bib"
          startContent={<PiPersonSimpleRun className="text-lg" />}
          href="/orderform"
          textValue="My bib"
          className="py-2"
        >
          My bib
        </DropdownItem>
        {isAdmin ? (
          <DropdownItem
            key="admin"
            startContent={<FiShield className="text-lg" />}
            href="/admin"
            textValue="Admin"
            className="py-2"
          >
            Admin reports
          </DropdownItem>
        ) : null}
        <DropdownItem
          key="signout"
          color="danger"
          startContent={<FiLogOut className="text-lg" />}
          textValue="Sign out"
          className="py-2 text-danger"
          onPress={() => signOut({ callbackUrl: "/orderform" })}
        >
          Sign out
        </DropdownItem>
      </DropdownMenu>
    </Dropdown>
  );
}

export default UserDropdown;
