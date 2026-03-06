'use client';

import {
  Card,
  CardBody,
  Divider,
  Button,
  Chip,
  Avatar,
} from '@heroui/react';

import { useState, useEffect } from 'react';
import { useSession, signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';
import { Link2, CheckCircle, AlertCircle, ArrowLeft } from 'lucide-react';
import { FaStrava } from 'react-icons/fa';

const basePath = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
  : '';

function StravaLinkContent() {
  const [isLinking, setIsLinking] = useState(false);
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();

  const handleStravaLink = async () => {
    setIsLinking(true);
    await signIn('strava', { callbackUrl: '/' });
  };

  const autoLink = searchParams.get('autoLink') !== null;

  // Auto-start linking when ?autoLink is present and user is authenticated
  useEffect(() => {
    if (autoLink && status === 'authenticated' && session) {
      const hasStrava = (session.user as { hasStrava?: boolean })?.hasStrava ?? false;
      if (!hasStrava) {
        handleStravaLink();
      }
    }
  }, [status, session, autoLink]);

  if (status === 'loading' || (autoLink && status === 'authenticated')) {
    return (
      <div className="space-y-4 animate-fade-in">
        <div className="glass-card rounded-xl p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-content2 animate-pulse" />
            <div className="space-y-2 flex-1">
              <div className="h-5 w-32 rounded bg-content2 animate-pulse" />
              <div className="h-4 w-48 rounded bg-content2 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated' || !session) {
    return (
      <div className="space-y-4 animate-fade-up">
        <Card className="glass-card overflow-hidden">
          <CardBody className="px-5 py-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FaStrava className="w-6 h-6 text-warning" />
                <h1 className="font-museo text-xl font-bold text-foreground">Link Strava</h1>
              </div>
              <Chip
                color="warning"
                variant="flat"
                size="sm"
                startContent={<AlertCircle className="w-3.5 h-3.5" />}
                classNames={{ base: "font-mono text-xs" }}
              >
                Login Required
              </Chip>
            </div>
            <Divider />
            <p className="text-sm text-default-500">
              You must be logged in to link your Strava account. Sign in first with email, Discord, or GitHub.
            </p>
            <Button
              as="a"
              href={`${basePath}/login`}
              variant="solid"
              color="primary"
              className="w-full font-semibold"
              startContent={<ArrowLeft className="w-4 h-4" />}
            >
              Go to Login
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  const hasStravaLinked = (session?.user as { hasStrava?: boolean })?.hasStrava ?? false;

  return (
    <div className="space-y-4 w-full animate-fade-up">
      {/* Back */}
      <Button
        as="a"
        href={`${basePath}/`}
        variant="light"
        size="sm"
        className="text-default-400 -ml-2"
        startContent={<ArrowLeft className="w-3.5 h-3.5" />}
      >
        Dashboard
      </Button>

      <Card className="glass-card overflow-hidden">
        <CardBody className="px-5 py-5 space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <FaStrava className="w-6 h-6 text-warning" />
              <h1 className="font-museo text-xl font-bold text-foreground">Strava Integration</h1>
            </div>
            {hasStravaLinked ? (
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-success" />
                <span className="text-xs text-success">Connected</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <Link2 className="w-3.5 h-3.5 text-default-400" />
                <span className="text-xs text-default-400">Not linked</span>
              </div>
            )}
          </div>

          <Divider />

          {/* User info */}
          <div className="flex items-center gap-4 p-3 rounded-lg bg-content2">
            <Avatar
              src={session.user?.image || undefined}
              name={session.user?.name || session.user?.email || 'U'}
              size="md"
              isBordered
              color="primary"
            />
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-foreground truncate">
                {session.user?.name || 'User'}
              </span>
              <span className="text-xs text-default-500 truncate">
                {session.user?.email}
              </span>
            </div>
          </div>

          <p className="text-sm text-default-500">
            {hasStravaLinked
              ? 'Your Strava account is connected. Activities will sync automatically.'
              : 'Link your Strava account to sync activities and routes.'}
          </p>

          <Button
            variant="solid"
            color="warning"
            className="w-full font-semibold"
            startContent={<FaStrava className="w-4 h-4" />}
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
        </CardBody>
      </Card>
    </div>
  );
}

export default function StravaPage() {
  return <StravaLinkContent />;
}
