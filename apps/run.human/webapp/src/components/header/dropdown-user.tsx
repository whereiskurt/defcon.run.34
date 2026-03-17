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
import { useSession } from 'next-auth/react';
import { fullLogout } from '@/hooks/useLogout';

import { useRouter } from 'next/navigation';
import { FaUserAlt, FaTrophy, FaMapMarkerAlt } from 'react-icons/fa';
import CheckInModal from '@/components/CheckInModal';
import { LogoutIcon } from './icon/logout';
import { QRIcon } from './icon/qr';
import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api';

import DCJackIcon from '@public/header/dcjack.svg';

const iconClasses =
  'text-2xl text-default-500 pointer-events-none flex-shrink-0';

const UserDropDown = (params: any) => {
  const {
    isOpen: isLogoutOpen,
    onOpen: openLogout,
    onClose: closeLogout,
  } = useDisclosure();
  const {
    isOpen: isQROpen,
    onOpen: openQR,
    onClose: closeQR,
  } = useDisclosure();
  const {
    isOpen: isCheckInOpen,
    onOpen: openCheckIn,
    onClose: closeCheckIn,
  } = useDisclosure();
  const [userDetail, setUserDetail] = useState<any>(null);
  const router = useRouter();

  // Fetch user details once when component mounts
  const fetchUserDetails = async () => {
    try {
      const res = await fetch(apiUrl('/api/user'), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      if (!res.ok || res.status !== 200) {
        throw new Error('Failed to get User details.');
      }
      const record = await res.json();
      setUserDetail(record.user);
    } catch (error) {
      console.error('Error fetching user details:', error);
    }
  };

  useEffect(() => {
    if (!userDetail) {
      fetchUserDetails();
    }
  }, []); // Empty dependency array means this runs once after initial render

  const showLogoutModal = () => {
    openLogout();
  };

  const showQR = () => {
    openQR();
  };

  const { data: session, update, status } = useSession();

  // Add effect to refresh user details on window focus (when user comes back from profile page)
  useEffect(() => {
    const handleFocus = () => {
      if (session?.user?.email) {
        fetchUserDetails();
      }
    };

    // Also listen for custom events when user data is updated
    const handleUserUpdate = () => {
      fetchUserDetails();
    };

    const handleDisplaynameUpdate = () => {
      fetchUserDetails();
    };

    window.addEventListener('focus', handleFocus);
    window.addEventListener('userUpdated', handleUserUpdate);
    window.addEventListener('displaynameUpdated', handleDisplaynameUpdate);

    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('userUpdated', handleUserUpdate);
      window.removeEventListener('displaynameUpdated', handleDisplaynameUpdate);
    };
  }, [session?.user?.email]);

  const checkInQuotaExhausted = userDetail?.quotas?.checkin?.remaining === 0;

  if (!session || !session.user) return <></>;

  return (
    <>
      {LogoutModal(isLogoutOpen, closeLogout)}
      {QRModal(isQROpen, closeQR, userDetail)}
      <CheckInModal
        isOpen={isCheckInOpen}
        onClose={closeCheckIn}
        checkinPreference={userDetail?.preferences?.checkinPreference}
      />
      <Dropdown
        backdrop="blur"
        showArrow
        radius="sm"
        closeOnSelect={false}
        classNames={{
          base: 'before:bg-default-200', // change arrow background
          content: 'p-0 border-small border-divider bg-background',
        }}
      >
        <DropdownTrigger>
          <Avatar
            src={session.user.image ?? DCJackIcon.src}
            ignoreFallback={true}
            size="lg"
            isBordered
            color="primary"
          />
        </DropdownTrigger>

        <DropdownMenu
          aria-label="Custom item styles"
          disabledKeys={['profile_example', ...(checkInQuotaExhausted ? ['checkin'] : [])]}
          topContent={
            <User
              name={userDetail?.displayname ? `🐰 ${userDetail.displayname}` : session.user.name}
              description={
                <div className="flex flex-col">
                  {userDetail?.displayname && (
                    <span className="text-sm text-default-600">{session.user.name}</span>
                  )}
                  <span className="text-xs text-default-400">{session.user.email}</span>
                </div>
              }
              avatarProps={{
                ignoreFallback: true,
                size: 'lg',
                src: session.user.image ?? DCJackIcon.src,
              }}
              className="pt-2 pb-2"
            />
          }
        >
          <DropdownSection aria-label="Divider" showDivider>
            <></>
          </DropdownSection>
          <DropdownSection aria-label="User Profile" showDivider>
            <DropdownItem
              startContent={<FaUserAlt />}
              key="profile"
              className="gap-2 opacity-100 py-2 text-base"
              textValue="Profile"
              href="/whoami"
              closeOnSelect={true}
            >
              Profile
            </DropdownItem>

            <DropdownItem
              startContent={<FaTrophy />}
              key="leaderboard"
              className="gap-2 opacity-100 py-2 text-base"
              textValue="Leaderboard"
              href="/leaderboard"
              closeOnSelect={true}
            >
              Leaderboard
            </DropdownItem>
          </DropdownSection>

          <DropdownSection aria-label="Check-in" showDivider>
            <DropdownItem
              startContent={<FaMapMarkerAlt />}
              key="checkin"
              className="gap-2 opacity-100 py-2 text-base"
              textValue="GPS Check-in"
              onPress={() => openCheckIn()}
              closeOnSelect={true}
              description={checkInQuotaExhausted ? 'Check-in limit reached for today' : undefined}
            >
              GPS Check-in
            </DropdownItem>
          </DropdownSection>

          <DropdownSection aria-label="QR Code" showDivider>
            <DropdownItem
              startContent={<QRIcon className={iconClasses} />}
              key="showqr"
              className="gap-2 opacity-100 py-2 text-base"
              textValue="showqr"
              onPress={() => showQR()}
              closeOnSelect={true}
            >
              Show My QR
            </DropdownItem>
          </DropdownSection>

          <DropdownSection aria-label="Logout">
            <DropdownItem
              startContent={<LogoutIcon className={iconClasses} />}
              key="logout"
              className="py-2 text-base"
              textValue="Logout"
              onPress={() => showLogoutModal()}
              closeOnSelect={true}
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

function LogoutModal(isOpen: boolean, onClose: () => void) {
  const doLogout = () => {
    onClose();
    fullLogout('/');
  };
  const closeWindow = () => {
    onClose();
  };
  return (
    <Modal
      size={'sm'}
      placement="center"
      isOpen={isOpen}
      backdrop="blur"
      onClose={closeWindow}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1">Logout?</ModalHeader>
            <ModalBody>
              <p>Do you want to Logout of {process.env.NEXT_PUBLIC_SITE_DOMAIN || 'defcon.run'}? </p>
            </ModalBody>
            <ModalFooter>
              <Button color="danger" variant="light" onClick={doLogout}>
                Logout
              </Button>
              <Button color="primary" onClick={closeWindow}>
                Stay Logged In
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}

function QRModal(isOpen: boolean, onClose: () => void, userDetail: any) {
  const closeWindow = () => {
    onClose();
  };

  const hasQR = userDetail?.eqr;

  return (
    <Modal
      size={'sm'}
      placement="center"
      isOpen={isOpen}
      backdrop="blur"
      onClose={closeWindow}
    >
      <ModalContent>
        {() => (
          <>
            <ModalHeader className="flex flex-col gap-1 text-center pb-2">
              <div className="text-2xl font-bold text-primary drop-shadow-lg">
                Your Social QR
              </div>
              <div className="text-sm text-default-500">Share to connect with other rabbits!</div>
            </ModalHeader>
            <ModalBody className="p-0 pt-0">
              {hasQR ? (
                <div className="p-0 overflow-hidden">
                  <img src={userDetail.eqr} className="w-full scale-110 -m-[0px]" />
                </div>
              ) : (
                <div className="flex items-center justify-center h-[300px]">
                  <span className="text-default-500">Loading QR Code...</span>
                </div>
              )}
            </ModalBody>
            <ModalFooter className="flex justify-center -mt-[10px]">
              <Button
                size="lg"
                color="success"
                variant="solid"
                radius="full"
                onPress={closeWindow}
                className="px-8 py-3 text-lg font-semibold min-w-[150px]"
              >
                Done
              </Button>
            </ModalFooter>
          </>
        )}
      </ModalContent>
    </Modal>
  );
}
