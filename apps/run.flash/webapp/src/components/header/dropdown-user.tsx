'use client';

import {
  Avatar,
  Button,
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownSection,
  DropdownTrigger,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  User,
  useDisclosure,
} from '@heroui/react';
import { useSession, signOut } from 'next-auth/react';
import { FaUserAlt, FaTrophy } from 'react-icons/fa';
import { LogOut } from 'lucide-react';

const RUN_BASE = 'https://run.defcon.run';

const iconClasses =
  'text-xl text-default-500 pointer-events-none flex-shrink-0';

const UserDropDown = () => {
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
                    signOut({ callbackUrl: '/' });
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
          base: 'before:bg-default-200',
          content: 'p-0 border-small border-divider bg-background',
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
                ?.split(' ')
                .map((n) => n[0])
                .join('')
                .toUpperCase()
                .slice(0, 2) || '?'
            }
          />
        </DropdownTrigger>

        <DropdownMenu
          aria-label="User menu"
          disabledKeys={['profile_info']}
          topContent={
            <User
              name={session.user.name}
              description={
                <span className="text-xs text-default-400">
                  {session.user.email}
                </span>
              }
              avatarProps={{
                size: 'lg',
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
};

export default UserDropDown;
