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
import { Shield, LogOut } from 'lucide-react';
import { SiStrava } from 'react-icons/si';

const basePath = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
  : '';

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

  const { user } = session;

  return (
    <>
      <LogoutModal isOpen={isLogoutOpen} onClose={closeLogout} />
      <Dropdown
        backdrop="blur"
        showArrow
        radius="sm"
        classNames={{
          base: 'before:bg-default-200',
          content: 'p-0 border-small border-divider bg-background',
        }}
      >
        <DropdownTrigger>
          <Avatar
            src={user.image || undefined}
            name={user.name || user.email || 'U'}
            size="sm"
            isBordered
            color="primary"
            classNames={{ base: "cursor-pointer" }}
          />
        </DropdownTrigger>

        <DropdownMenu
          aria-label="User menu"
          disabledKeys={['profile_info']}
          topContent={
            <User
              name={user.name || 'Unknown User'}
              description={
                <span className="text-xs text-default-400">{user.email}</span>
              }
              avatarProps={{
                src: user.image || undefined,
                name: user.name || user.email || 'U',
                size: 'lg',
                isBordered: true,
                color: 'primary',
              }}
              className="pt-2 pb-2 px-2"
            />
          }
        >
          <DropdownSection aria-label="Divider" showDivider>
            <></>
          </DropdownSection>
          <DropdownSection aria-label="Navigation" showDivider>
            <DropdownItem
              startContent={<Shield className={iconClasses} />}
              key="profile"
              className="gap-2 opacity-100 py-2 text-base"
              textValue="Profile"
              href={`${basePath}/profile`}
              closeOnSelect={true}
            >
              Profile
            </DropdownItem>

            <DropdownItem
              startContent={<SiStrava className={iconClasses} />}
              key="strava"
              className="gap-2 opacity-100 py-2 text-base"
              textValue="Strava"
              href={`${basePath}/strava`}
              closeOnSelect={true}
            >
              Strava Linking
            </DropdownItem>
          </DropdownSection>

          <DropdownSection aria-label="Logout">
            <DropdownItem
              startContent={<LogOut className={iconClasses} />}
              key="logout"
              className="py-2 text-base text-danger"
              color="danger"
              textValue="Sign Out"
              onPress={() => openLogout()}
              closeOnSelect={true}
            >
              Sign Out
            </DropdownItem>
          </DropdownSection>
        </DropdownMenu>
      </Dropdown>
    </>
  );
};

function LogoutModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const doLogout = () => {
    onClose();
    signOut({ callbackUrl: `${basePath}/login` });
  };

  return (
    <Modal
      size="sm"
      placement="center"
      isOpen={isOpen}
      backdrop="blur"
      onClose={onClose}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1">Sign Out?</ModalHeader>
            <ModalBody>
              <p>Do you want to sign out of auth.defcon.run?</p>
            </ModalBody>
            <ModalFooter>
              <Button color="danger" variant="light" onClick={doLogout}>
                Sign Out
              </Button>
              <Button color="primary" onClick={onClose}>
                Stay Logged In
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

export default UserDropDown;
