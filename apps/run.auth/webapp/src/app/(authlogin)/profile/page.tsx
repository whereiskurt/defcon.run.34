'use client';

import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  Button,
  Chip,
  Avatar,
  Accordion,
  AccordionItem,
} from '@heroui/react';

import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { LogOut, CheckCircle, X, Shield, Clock, Copy, Check } from 'lucide-react';
import { SiDiscord, SiGithub, SiStrava } from 'react-icons/si';

const basePath = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
  : '';

type LinkedAccount = {
  linked: boolean;
  username?: string;
  globalName?: string;
  login?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  avatarUrl?: string;
  profileMedium?: string;
  email?: string;
  linkedAt?: string;
};

type ProfileUser = {
  userId: string;
  displayName: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string;
  createdAt: number;
  updatedAt: number;
  quotaTier: string;
  lockedOut: boolean;
  services: string[];
  sessionVersion: number;
  linkedAccounts: {
    discord: LinkedAccount;
    github: LinkedAccount;
    strava: LinkedAccount;
  };
};

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return `${Math.floor(days / 365)} years ago`;
}

function formatMemberSince(ts: number): string {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function ProviderRow({
  icon,
  label,
  account,
}: {
  icon: React.ReactNode;
  label: string;
  account: LinkedAccount;
}) {
  if (!account.linked) {
    return (
      <div className="flex items-center justify-between p-3 rounded-lg bg-default-50 opacity-50">
        <div className="flex items-center gap-3">
          <span className="text-default-400">{icon}</span>
          <span className="text-sm text-default-400">{label}</span>
        </div>
        <Chip size="sm" variant="flat">Not Connected</Chip>
      </div>
    );
  }

  // Display name varies by provider
  let displayName = '';
  if (account.username) displayName = account.username;
  if (account.login) displayName = account.login;
  if (account.firstName) {
    displayName = [account.firstName, account.lastName].filter(Boolean).join(' ');
  }

  return (
    <div className="flex items-center justify-between p-3 rounded-lg bg-default-50">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-default-500">{icon}</span>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-medium text-foreground truncate">
            {displayName || label}
          </span>
          <div className="flex items-center gap-2">
            {account.email && (
              <span className="text-xs text-default-400">{account.email}</span>
            )}
            {account.linkedAt && (
              <span className="text-xs text-default-400">
                Linked {formatRelativeDate(account.linkedAt)}
              </span>
            )}
          </div>
        </div>
      </div>
      <Chip size="sm" variant="flat" color="success">Connected</Chip>
    </div>
  );
}

function ProfileContent() {
  const { data: session, status } = useSession();
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (status !== 'authenticated') return;

    fetch(`${basePath}/api/profile`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load profile');
        return res.json();
      })
      .then((data) => {
        setProfile(data.user);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [status]);

  const copyUserId = () => {
    if (!profile) return;
    navigator.clipboard.writeText(profile.userId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (status === 'loading' || loading) {
    return (
      <div className="bg-content1 shadow-lg rounded-lg p-6">
        <p className="text-center text-foreground">Loading profile...</p>
      </div>
    );
  }

  if (status === 'unauthenticated' || !session) {
    return (
      <Card className="shadow-lg bg-content1">
        <CardBody className="flex justify-center">
          <Button
            as="a"
            href={`${basePath}/login`}
            variant="solid"
            color="primary"
            className="text-lg font-semibold"
          >
            Go to Login
          </Button>
        </CardBody>
      </Card>
    );
  }

  if (error || !profile) {
    return (
      <Card className="shadow-lg bg-content1">
        <CardBody>
          <p className="text-center text-danger">{error || 'Profile not found'}</p>
        </CardBody>
      </Card>
    );
  }

  const tierColor = profile.quotaTier === 'admin'
    ? 'danger'
    : profile.quotaTier === 'upload'
      ? 'primary'
      : 'default';

  return (
    <div className="space-y-4 w-full">
      {/* Section 1: Identity Header */}
      <Card className="shadow-lg bg-content1">
        <CardBody>
          <div className="flex items-center gap-4">
            <Avatar
              src={profile.picture || undefined}
              name={profile.displayName || profile.name || 'U'}
              size="lg"
              isBordered
              color="primary"
            />
            <div className="flex flex-col flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold text-foreground truncate">
                  {profile.displayName}
                </span>
                <Chip size="sm" variant="flat" color={tierColor}>
                  {profile.quotaTier}
                </Chip>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm text-default-500 truncate">{profile.email}</span>
                {profile.emailVerified ? (
                  <CheckCircle className="w-3.5 h-3.5 text-success flex-shrink-0" />
                ) : (
                  <X className="w-3.5 h-3.5 text-danger flex-shrink-0" />
                )}
              </div>
              <span className="text-sm text-default-400">
                Member since {formatMemberSince(profile.createdAt)}
              </span>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Section 2: Linked Accounts */}
      <Card className="shadow-lg bg-content1">
        <CardHeader>
          <span className="text-md font-semibold text-foreground">Linked Accounts</span>
        </CardHeader>
        <Divider />
        <CardBody className="space-y-2">
          <ProviderRow
            icon={<SiDiscord className="w-5 h-5" />}
            label="Discord"
            account={profile.linkedAccounts.discord}
          />
          <ProviderRow
            icon={<SiGithub className="w-5 h-5" />}
            label="GitHub"
            account={profile.linkedAccounts.github}
          />
          <ProviderRow
            icon={<SiStrava className="w-5 h-5" />}
            label="Strava"
            account={profile.linkedAccounts.strava}
          />
        </CardBody>
      </Card>

      {/* Section 3: Authorized Services */}
      <Card className="shadow-lg bg-content1">
        <CardHeader>
          <span className="text-md font-semibold text-foreground">Services</span>
        </CardHeader>
        <Divider />
        <CardBody>
          <div className="flex flex-wrap gap-2">
            {profile.services.map((svc) => (
              <Chip
                key={svc}
                size="sm"
                variant="flat"
                color={
                  svc === 'admin' ? 'danger'
                    : svc === 'strava' ? 'warning'
                      : svc === 'gpxstudio' ? 'secondary'
                        : 'primary'
                }
              >
                {svc}
              </Chip>
            ))}
          </div>
          <p className="text-xs text-default-400 mt-2">
            Services your account is authorized to access.
          </p>
        </CardBody>
      </Card>

      {/* Section 4: Session & Security */}
      <Card className="shadow-lg bg-content1">
        <CardHeader>
          <span className="text-md font-semibold text-foreground">Security</span>
        </CardHeader>
        <Divider />
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between p-2 rounded-md bg-default-50">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-default-500" />
              <span className="text-sm text-default-500">Session Version</span>
            </div>
            <span className="text-sm font-mono text-foreground">{profile.sessionVersion}</span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-default-50">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-default-500" />
              <span className="text-sm text-default-500">Session Expires</span>
            </div>
            <span className="text-sm text-foreground">
              {session.expires ? new Date(session.expires).toLocaleDateString() : 'Unknown'}
            </span>
          </div>
          <div className="flex items-center justify-between p-2 rounded-md bg-default-50">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-default-500" />
              <span className="text-sm text-default-500">Account Status</span>
            </div>
            <Chip size="sm" variant="flat" color={profile.lockedOut ? 'danger' : 'success'}>
              {profile.lockedOut ? 'Locked' : 'Active'}
            </Chip>
          </div>
          <Divider />
          <Button
            variant="flat"
            color="danger"
            className="w-full"
            startContent={<LogOut className="w-4 h-4" />}
            onPress={() => signOut({ callbackUrl: `${basePath}/login` })}
          >
            Sign Out
          </Button>
        </CardBody>
      </Card>

      {/* Section 5: Debug (collapsible) */}
      <Card className="shadow-lg bg-content1">
        <CardBody className="p-0">
          <Accordion>
            <AccordionItem
              key="debug"
              aria-label="Developer Info"
              title={<span className="text-md font-semibold text-foreground">Developer Info</span>}
            >
              <div className="space-y-3 pb-3 px-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-default-500">User ID</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-foreground truncate max-w-[200px]">
                      {profile.userId}
                    </span>
                    <button
                      onClick={copyUserId}
                      className="text-default-400 hover:text-foreground transition-colors cursor-pointer"
                    >
                      {copied ? <Check className="w-4 h-4 text-success" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <Divider />
                <div>
                  <span className="text-sm text-default-500 block mb-1">Raw Session</span>
                  <pre className="p-3 rounded-md text-xs overflow-x-auto bg-default-100 text-foreground">
                    {JSON.stringify(session, null, 2)}
                  </pre>
                </div>
              </div>
            </AccordionItem>
          </Accordion>
        </CardBody>
      </Card>
    </div>
  );
}

export default function ProfilePage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="bg-content1 shadow-lg rounded-lg p-6">
        <p className="text-center text-foreground">Loading...</p>
      </div>
    );
  }

  return <ProfileContent />;
}
