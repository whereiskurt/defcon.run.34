"use client";

import {
  Avatar,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
  User,
} from "@heroui/react";
import { useSession, signOut } from "next-auth/react";
import { FaUserAlt, FaMapMarkerAlt } from "react-icons/fa";
import { FaPenToSquare } from "react-icons/fa6";
import { PiPersonSimpleRun } from "react-icons/pi";
import { FiShield } from "react-icons/fi";
import { LogOut, QrCode } from "lucide-react";

import { runHumanUrl } from "@/lib/run-human-url";
import { useCopy } from "@/components/CopyProvider";

/**
 * User avatar + dropdown for the bib header — mirrors flash/run.human's user
 * menu (Profile, My Bib, CMS, GPS Check-in, Show My QR, Sign out) PLUS bib's
 * own Admin item, so runners moving between bib.defcon.run and run.defcon.run
 * see the same menu (BIB-ADM-10).
 *
 * Cross-app links into run.defcon.run go through the shared runHumanUrl helper
 * so they're region-prefixed (run.defcon.run is mounted under /{region}). GPS
 * Check-in / Show My QR deep-link to run.human's ?open=checkin | ?open=qr, which
 * auto-open its Check-in / QR modals. My Bib (/orderform) and Admin (/admin)
 * stay in-app — this app IS bib, so it keeps its own identity.
 *
 * The CMS and Admin items are gated on session.user.services (client-side UX
 * gating only; cms.defcon.run and the bib /admin route enforce authorization
 * server-side). Reads the live session client-side (SessionProvider is mounted
 * in the root layout). Avatar uses session.user.image (the OIDC picture claim)
 * and falls back to initials from the name when no image is present.
 */
export function UserDropdown() {
  const { t } = useCopy();
  const { data: session } = useSession();
  const user = session?.user as
    | { name?: string | null; email?: string | null; image?: string | null; services?: string[] }
    | undefined;
  if (!user) return null;

  const name = user.name || user.email || "Runner";
  const services = user.services;
  const hasCms = Array.isArray(services) && services.includes("cms");
  const isAdmin = Array.isArray(services) && services.includes("admin");

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
        <DropdownSection aria-label="Profile" showDivider>
          <DropdownItem
            key="profile"
            startContent={<FaUserAlt className="text-lg" />}
            href={runHumanUrl("/whoami")}
            target="_blank"
            rel="noopener noreferrer"
            textValue="Profile"
            className="py-2"
          >
            {t("common.profileMenu.profile")}
          </DropdownItem>
          <DropdownItem
            key="bib"
            startContent={<PiPersonSimpleRun className="text-lg" />}
            href="/orderform"
            textValue="My Bib"
            className="py-2"
          >
            {t("common.profileMenu.myBib")}
          </DropdownItem>
          {hasCms ? (
            <DropdownItem
              key="cms"
              startContent={<FaPenToSquare className="text-lg" />}
              href="https://cms.defcon.run"
              target="_blank"
              rel="noopener noreferrer"
              textValue="CMS"
              className="py-2"
            >
              {t("common.profileMenu.cms")}
            </DropdownItem>
          ) : null}
          {isAdmin ? (
            <DropdownItem
              key="admin"
              startContent={<FiShield className="text-lg" />}
              href="/admin"
              textValue="Admin"
              className="py-2"
            >
              {t("common.profileMenu.adminReports")}
            </DropdownItem>
          ) : null}
        </DropdownSection>

        <DropdownSection aria-label="Check-in & QR" showDivider>
          <DropdownItem
            key="checkin"
            startContent={<FaMapMarkerAlt className="text-lg" />}
            href={runHumanUrl("/?open=checkin")}
            target="_blank"
            rel="noopener noreferrer"
            textValue="GPS Check-in"
            className="py-2"
          >
            {t("common.profileMenu.gpsCheckin")}
          </DropdownItem>
          <DropdownItem
            key="showqr"
            startContent={<QrCode className="w-4 h-4" />}
            href={runHumanUrl("/?open=qr")}
            target="_blank"
            rel="noopener noreferrer"
            textValue="Show My QR"
            className="py-2"
          >
            {t("common.profileMenu.showQr")}
          </DropdownItem>
        </DropdownSection>

        <DropdownSection aria-label="Sign out">
          <DropdownItem
            key="signout"
            color="danger"
            startContent={<LogOut className="w-4 h-4" />}
            textValue="Sign out"
            className="py-2 text-danger"
            onPress={() => signOut({ callbackUrl: "/orderform" })}
          >
            {t("common.profileMenu.signOut")}
          </DropdownItem>
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
}

export default UserDropdown;
