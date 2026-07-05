"use client";

import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownTrigger,
} from "@heroui/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { GrMapLocation } from "react-icons/gr";
import { FaRadio } from "react-icons/fa6";
import { PiPersonSimpleRun } from "react-icons/pi";
import { FiShield, FiMenu } from "react-icons/fi";

import { runHumanUrl } from "@/lib/run-human-url";

/**
 * Mobile hamburger nav for the bib header — mirrors run.human's MenuDropDown
 * so the small-screen menu matches. Items: My bib, Maps, Meshtastic, and Admin
 * (admin group only). Desktop uses the inline Navbar links instead.
 */
const iconClasses = "text-lg text-default-400 pointer-events-none flex-shrink-0";

export function MenuDropdown({ isAdmin = false }: { isAdmin?: boolean }) {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();

  const go = (href: string) => {
    setIsOpen(false);
    router.push(href);
  };
  const ext = (href: string) => {
    setIsOpen(false);
    // IN-01: window.open does NOT default to noopener (unlike anchor
    // target="_blank"), so the opened tab gets a live window.opener. Pass
    // noopener,noreferrer to sever it (reverse tab-nabbing hardening).
    window.open(href, "_blank", "noopener,noreferrer");
  };

  return (
    <Dropdown
      showArrow
      radius="sm"
      backdrop="blur"
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      classNames={{ content: "bg-content1 border border-divider" }}
    >
      <DropdownTrigger>
        <div className="cursor-pointer p-1 text-default-500 hover:text-foreground">
          <FiMenu className="w-6 h-6" />
        </div>
      </DropdownTrigger>

      <DropdownMenu
        aria-label="Navigation menu"
        className="p-2"
        itemClasses={{
          base: [
            "rounded-lg",
            "text-default-600",
            "data-[hover=true]:text-foreground",
            "data-[hover=true]:bg-content2",
          ],
        }}
      >
        <DropdownItem
          key="bib"
          textValue="My bib"
          startContent={<PiPersonSimpleRun className={iconClasses} />}
          onPress={() => go("/orderform")}
        >
          <span className="text-base">My bib</span>
        </DropdownItem>
        <DropdownItem
          key="maps"
          textValue="Maps"
          startContent={<GrMapLocation className={iconClasses} />}
          onPress={() => ext("https://gpx.defcon.run")}
        >
          <span className="text-base">Maps</span>
        </DropdownItem>
        <DropdownItem
          key="meshtastic"
          textValue="Meshtastic"
          startContent={<FaRadio className={iconClasses} />}
          onPress={() => ext(runHumanUrl("/meshtastic"))}
        >
          <span className="text-base">Meshtastic</span>
        </DropdownItem>
        {isAdmin ? (
          <DropdownItem
            key="admin"
            textValue="Admin"
            startContent={<FiShield className={iconClasses} />}
            onPress={() => go("/admin")}
          >
            <span className="text-base">Admin reports</span>
          </DropdownItem>
        ) : null}
      </DropdownMenu>
    </Dropdown>
  );
}

export default MenuDropdown;
