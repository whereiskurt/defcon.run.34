'use client';

import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  Button,
  Chip,
  Avatar,
} from '@heroui/react';

import { useEffect, useState } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { Text, Heading } from '@components/text-effects/Common';

import { Link2, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { FaStrava } from 'react-icons/fa';

function StravaLinkContent() {
  const [isLinking, setIsLinking] = useState(false);
  const { data: session, status } = useSession();

  const handleStravaLink = async () => {
    setIsLinking(true);
    await signIn('strava', { callbackUrl: '/' });
  };

  // Loading state
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
        <div className="z-10 w-full max-w-md">
          <div className="bg-content1 shadow-lg rounded-lg p-6">
            <p className="text-center">Loading session...</p>
          </div>
        </div>
      </div>
    );
  }

  // Not authenticated - require login first
  if (status === 'unauthenticated' || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
        <div className="z-10 w-full max-w-md">
          <Card className="shadow-lg bg-content1">
            <CardHeader>
              <div className="flex flex-col w-full">
                <div className="flex items-center justify-between w-full">
                  <Heading level={1}>Link Strava</Heading>
                  <Chip
                    color="warning"
                    variant="flat"
                    startContent={<AlertCircle className="w-4 h-4" />}
                  >
                    Login Required
                  </Chip>
                </div>
                <Text variant="small" className="text-default-500">
                  You must be logged in to link your Strava account.
                </Text>
              </div>
            </CardHeader>
            <Divider />
            <CardBody className="flex flex-col items-center gap-4">
              <Text className="text-center text-default-600">
                Strava linking requires an existing account. Please log in first with your email, Discord, or GitHub.
              </Text>
              <Button
                as="a"
                href="/login"
                variant="solid"
                color="primary"
                className="text-lg font-semibold"
                startContent={<ArrowLeft className="w-5 h-5" />}
              >
                Go to Login
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  // Check if user has Strava linked
  const hasStravaLinked = (session?.user as { hasStrava?: boolean })?.hasStrava ?? false;

  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
      <div className="z-10 w-full max-w-md">
        <Card className="shadow-lg bg-content1">
          <CardHeader>
            <div className="flex flex-col w-full">
              <div className="flex items-center justify-between w-full">
                <Heading level={1}>Link Strava</Heading>
                {hasStravaLinked ? (
                  <Chip
                    color="success"
                    variant="flat"
                    startContent={<CheckCircle className="w-4 h-4" />}
                  >
                    Connected
                  </Chip>
                ) : (
                  <Chip
                    color="default"
                    variant="flat"
                    startContent={<Link2 className="w-4 h-4" />}
                  >
                    Not Linked
                  </Chip>
                )}
              </div>
              <Text variant="small" className="text-default-500">
                Connect your Strava account
              </Text>
            </div>
          </CardHeader>
          <Divider />
          <CardBody className="space-y-4">
            {/* User Info */}
            <div className="flex items-center gap-4 p-3 rounded-lg bg-default-100">
              <Avatar
                src={session.user?.image || undefined}
                name={session.user?.name || session.user?.email || 'U'}
                size="lg"
                isBordered
                color="primary"
              />
              <div className="flex flex-col">
                <span className="text-lg font-semibold text-foreground">
                  {session.user?.name || 'User'}
                </span>
                <span className="text-sm text-default-500">
                  {session.user?.email}
                </span>
              </div>
            </div>

            {/* Strava Info Section */}
              <div className="flex items-center gap-3">
                <FaStrava className="w-8 h-8 text-warning" />
                <div>
                  <h3 className="font-semibold text-foreground">
                    Strava Integration
                  </h3>
                  <p className="text-sm text-default-500">
                    {hasStravaLinked
                      ? 'Your Strava account is connected'
                      : 'Link your Strava to sync activities'}
                  </p>
                </div>
              </div>
          </CardBody>
          <Divider />
          <CardBody className="flex flex-col items-center gap-3">
            <Button
              variant="solid"
              color={hasStravaLinked ? 'success' : 'success'}
              className="text-lg font-semibold w-full"
              startContent={<FaStrava className="w-5 h-5" />}
              onPress={handleStravaLink}
              isLoading={isLinking}
              isDisabled={isLinking}
            >
              {isLinking
                ? 'Connecting...'
                : hasStravaLinked
                  ? 'Re-link Strava Account'
                  : 'Link to Strava'}
            </Button>

            <Button
              as="a"
              href="/"
              variant="flat"
              color="default"
              className="w-full"
              startContent={<ArrowLeft className="w-4 h-4" />}
            >
              Back to Dashboard
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function StravaPage() {
  return <StravaLinkContent />;
}
