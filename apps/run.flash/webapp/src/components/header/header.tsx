"use client";

import {
  Avatar,
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
  Link,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Navbar,
  NavbarContent,
  NavbarItem,
  Tooltip,
  User,
  useDisclosure,
} from "@heroui/react";
import { useSession, signOut } from "next-auth/react";
import { GrMapLocation } from "react-icons/gr";
import {
  FaMoneyCheckDollar,
  FaRadio,
  FaFire,
  FaQuestion,
} from "react-icons/fa6";
import { FaUserAlt, FaTrophy } from "react-icons/fa";
import { LogOut, Menu, Zap } from "lucide-react";
import { useState } from "react";

const APP_VERSION_TOOLTIP = `DC34 Flash ${process.env.NEXT_PUBLIC_VERSION_APP || "dev"}`;

const RUN_BASE = "https://run.defcon.run";
const GPX_BASE = "https://gpx.defcon.run";

const navItems = [
  { href: GPX_BASE, label: "Routes", icon: GrMapLocation, external: true },
  {
    href: `${GPX_BASE}?overlay=heatmap`,
    label: "HeatMap",
    icon: FaFire,
    external: true,
  },
  {
    href: `${RUN_BASE}/meshtastic`,
    label: "Meshtastic",
    icon: FaRadio,
    external: true,
  },
  {
    href: `${RUN_BASE}/contributors`,
    label: "Contributors",
    icon: FaMoneyCheckDollar,
    external: true,
  },
] as const;

const iconClasses =
  "text-lg text-default-400 pointer-events-none flex-shrink-0";

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
        content: "bg-content1 border border-divider",
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
            "rounded-lg",
            "text-default-600",
            "transition-all",
            "data-[hover=true]:text-foreground",
            "data-[hover=true]:bg-content2",
            "data-[pressed=true]:opacity-70",
          ],
        }}
      >
        <DropdownSection aria-label="Navigation">
          <DropdownItem
            textValue="flash"
            startContent={<Zap className={iconClasses} />}
            key="flash"
            showDivider
            onClick={() => {
              setIsOpen(false);
              window.location.href = "/";
            }}
          >
            <span className="text-base">Flash Device</span>
          </DropdownItem>

          <DropdownItem
            textValue="whoami"
            startContent={<FaUserAlt className={iconClasses} />}
            key="whoami"
            onClick={() => {
              setIsOpen(false);
              window.open(`${RUN_BASE}/whoami`, "_blank");
            }}
          >
            <span className="text-base">Who Am I</span>
          </DropdownItem>

          <DropdownItem
            textValue="leaderboard"
            startContent={<FaTrophy className={iconClasses} />}
            key="leaderboard"
            onClick={() => {
              setIsOpen(false);
              window.open(`${RUN_BASE}/leaderboard`, "_blank");
            }}
          >
            <span className="text-base">Leaderboard</span>
          </DropdownItem>

          <DropdownItem
            textValue="routes"
            startContent={<GrMapLocation className={iconClasses} />}
            key="routes"
            onClick={() => {
              setIsOpen(false);
              window.open(GPX_BASE, "_blank");
            }}
          >
            <span className="text-base">Routes</span>
          </DropdownItem>

          <DropdownItem
            textValue="heatmap"
            startContent={<FaFire className={iconClasses} />}
            key="heatmap"
            onClick={() => {
              setIsOpen(false);
              window.open(`${GPX_BASE}?overlay=heatmap`, "_blank");
            }}
          >
            <span className="text-base">HeatMap</span>
          </DropdownItem>

          <DropdownItem
            textValue="meshtastic"
            startContent={<FaRadio className={iconClasses} />}
            key="meshtastic"
            onClick={() => {
              setIsOpen(false);
              window.open(`${RUN_BASE}/meshtastic`, "_blank");
            }}
          >
            <span className="text-base">Meshtastic</span>
          </DropdownItem>

          <DropdownItem
            textValue="contributors"
            startContent={<FaMoneyCheckDollar className={iconClasses} />}
            key="contributors"
            showDivider
            onClick={() => {
              setIsOpen(false);
              window.open(`${RUN_BASE}/contributors`, "_blank");
            }}
          >
            <span className="text-base">Contributors</span>
          </DropdownItem>

          <DropdownItem
            textValue="faq"
            startContent={<FaQuestion className={iconClasses} />}
            key="faq"
            onClick={() => {
              setIsOpen(false);
              window.open(`${RUN_BASE}/faq`, "_blank");
            }}
          >
            <span className="text-base">FAQ</span>
          </DropdownItem>
        </DropdownSection>
      </DropdownMenu>
    </Dropdown>
  );
}

function UserDropDown() {
  const { data: session } = useSession();
  const {
    isOpen: isLogoutOpen,
    onOpen: openLogout,
    onClose: closeLogout,
  } = useDisclosure();

  if (!session?.user) return null;

  return (
    <>
      <Modal
        size="sm"
        placement="center"
        isOpen={isLogoutOpen}
        backdrop="blur"
        onClose={closeLogout}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                Logout?
              </ModalHeader>
              <ModalBody>
                <p>Do you want to Logout of flash.defcon.run?</p>
              </ModalBody>
              <ModalFooter>
                <Button
                  color="danger"
                  variant="light"
                  onClick={() => {
                    closeLogout();
                    signOut({ callbackUrl: "/" });
                  }}
                >
                  Logout
                </Button>
                <Button color="primary" onClick={closeLogout}>
                  Stay Logged In
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      <Dropdown
        backdrop="blur"
        showArrow
        radius="sm"
        closeOnSelect={false}
        classNames={{
          base: "before:bg-default-200",
          content: "p-0 border-small border-divider bg-background",
        }}
      >
        <DropdownTrigger>
          <Avatar
            as="button"
            className="transition-transform"
            color="primary"
            size="sm"
            src={session.user.image || undefined}
            name={
              session.user.name
                ?.split(" ")
                .map((n) => n[0])
                .join("")
                .toUpperCase()
                .slice(0, 2) || "?"
            }
          />
        </DropdownTrigger>

        <DropdownMenu
          aria-label="User menu"
          disabledKeys={["profile_info"]}
          topContent={
            <User
              name={session.user.name}
              description={
                <span className="text-xs text-default-400">
                  {session.user.email}
                </span>
              }
              avatarProps={{
                size: "lg",
                src: session.user.image || undefined,
              }}
              className="pt-2 pb-2"
            />
          }
        >
          <DropdownSection aria-label="Divider" showDivider>
            <></>
          </DropdownSection>
          <DropdownSection aria-label="Profile" showDivider>
            <DropdownItem
              startContent={<FaUserAlt />}
              key="profile"
              className="gap-2 opacity-100 py-2 text-base"
              textValue="Profile"
              href={`${RUN_BASE}/whoami`}
              target="_blank"
              closeOnSelect
            >
              Profile
            </DropdownItem>
            <DropdownItem
              startContent={<FaTrophy />}
              key="leaderboard"
              className="gap-2 opacity-100 py-2 text-base"
              textValue="Leaderboard"
              href={`${RUN_BASE}/leaderboard`}
              target="_blank"
              closeOnSelect
            >
              Leaderboard
            </DropdownItem>
          </DropdownSection>
          <DropdownSection aria-label="Logout">
            <DropdownItem
              startContent={<LogOut className="w-4 h-4" />}
              key="logout"
              className="py-2 text-base"
              textValue="Logout"
              onPress={openLogout}
              closeOnSelect
            >
              Logout
            </DropdownItem>
          </DropdownSection>
        </DropdownMenu>
      </Dropdown>
    </>
  );
}

export function Header() {
  const { data: session } = useSession();

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
            <Link color="foreground" href="/" className="flex items-center gap-2">
              <FaRadio className="w-5 h-5 text-primary" />
              <span className="font-museo text-lg font-bold tracking-tight">
                flash<span className="teal-dot">.</span>defcon
                <span className="teal-dot">.</span>run
              </span>
            </Link>
          </Tooltip>
        </NavbarItem>
      </NavbarContent>

      {/* Desktop: wordmark + nav */}
      <NavbarContent className="sm:flex hidden gap-6" justify="center">
        <NavbarItem>
          <Tooltip content={APP_VERSION_TOOLTIP} placement="bottom">
            <Link color="foreground" href="/" className="flex items-center gap-2">
              <FaRadio className="w-5 h-5 text-primary" />
              <span className="font-museo text-lg font-bold tracking-tight">
                flash<span className="teal-dot">.</span>defcon
                <span className="teal-dot">.</span>run
              </span>
            </Link>
          </Tooltip>
        </NavbarItem>

        {navItems.map(({ href, label, icon: Icon, external }) => (
          <NavbarItem key={href}>
            <Link
              color="foreground"
              href={href}
              {...(external
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
              className="text-sm flex items-center gap-1.5 transition-colors relative py-1 text-default-500 hover:text-foreground"
            >
              <Icon className="w-4 h-4" />
              {label}
            </Link>
          </NavbarItem>
        ))}
      </NavbarContent>

      {/* Right: auth */}
      <NavbarContent justify="end" className="gap-2">
        <NavbarItem>
          {session?.user ? (
            <UserDropDown />
          ) : (
            <Button as="a" href="/signin" variant="ghost" size="sm">
              Login
            </Button>
          )}
        </NavbarItem>
      </NavbarContent>
    </Navbar>
  );
}
