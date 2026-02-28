'use client';

import {
  Card,
  CardBody,
  Divider,
  Button,
  Chip,
  Avatar,
  Accordion,
  AccordionItem,
  Tabs,
  Tab,
} from '@heroui/react';

import { useEffect, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { LogOut, CheckCircle, X, Shield, Clock, Copy, Check, ArrowLeft } from 'lucide-react';
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
  color,
}: {
  icon: React.ReactNode;
  label: string;
  account: LinkedAccount;
  color: string;
}) {
  if (!account.linked) {
    return (
      <div className="flex items-center justify-between py-2.5 opacity-40">
        <div className="flex items-center gap-3">
          <span className="text-default-400">{icon}</span>
          <span className="text-sm text-default-400">{label}</span>
        </div>
        <span className="text-xs text-default-400">Not linked</span>
      </div>
    );
  }

  let displayName = '';
  if (account.username) displayName = account.username;
  if (account.login) displayName = account.login;
  if (account.firstName) {
    displayName = [account.firstName, account.lastName].filter(Boolean).join(' ');
  }

  return (
    <div className="flex items-center justify-between py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <span style={{ color }}>{icon}</span>
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
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full bg-success" />
        <span className="text-xs text-success">Connected</span>
      </div>
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
      <div className="space-y-4">
        <div className="glass-card rounded-xl p-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-content2 animate-pulse" />
            <div className="space-y-2 flex-1">
              <div className="h-6 w-40 rounded bg-content2 animate-pulse" />
              <div className="h-4 w-56 rounded bg-content2 animate-pulse" />
              <div className="h-3 w-32 rounded bg-content2 animate-pulse" />
            </div>
          </div>
        </div>
        <div className="glass-card rounded-xl p-6 h-48 bg-content2 animate-pulse" />
      </div>
    );
  }

  if (status === 'unauthenticated' || !session) {
    return (
      <Card className="glass-card">
        <CardBody className="flex justify-center py-6">
          <Button as="a" href={`${basePath}/login`} variant="solid" color="primary" className="font-semibold">
            Sign In
          </Button>
        </CardBody>
      </Card>
    );
  }

  if (error || !profile) {
    return (
      <Card className="glass-card">
        <CardBody>
          <p className="text-center text-danger">{error || 'Profile not found'}</p>
        </CardBody>
      </Card>
    );
  }

  const tierColor = profile.quotaTier === 'admin' ? 'danger'
    : profile.quotaTier === 'upload' ? 'primary'
    : 'default';

  return (
    <div className="space-y-4 w-full animate-fade-up">
      {/* Back link */}
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

      {/* Identity hero */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="px-5 py-5">
          <div className="flex items-center gap-4">
            <Avatar
              src={profile.picture || undefined}
              name={profile.displayName || profile.name || 'U'}
              size="lg"
              isBordered
              color="primary"
              classNames={{ base: "ring-2 ring-primary/20 w-14 h-14" }}
            />
            <div className="flex flex-col flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-museo text-xl font-bold text-foreground truncate">
                  {profile.displayName}
                </span>
                <Chip size="sm" variant="flat" color={tierColor} classNames={{ base: "font-mono text-xs" }}>
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
              <span className="text-xs text-default-400 font-mono">
                Member since {formatMemberSince(profile.createdAt)}
              </span>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Tabs: Accounts / Services / Security */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="p-0">
          <Tabs
            aria-label="Profile sections"
            variant="underlined"
            classNames={{
              tabList: "gap-6 w-full px-5 pt-3 border-b border-divider",
              tab: "text-sm",
              cursor: "bg-primary",
              panel: "px-5 py-4",
            }}
          >
            <Tab key="accounts" title="Accounts">
              <div className="space-y-1">
                <ProviderRow
                  icon={<SiDiscord className="w-5 h-5" />}
                  label="Discord"
                  account={profile.linkedAccounts.discord}
                  color="#5865F2"
                />
                <Divider />
                <ProviderRow
                  icon={<SiGithub className="w-5 h-5" />}
                  label="GitHub"
                  account={profile.linkedAccounts.github}
                  color="#e4e4ef"
                />
                <Divider />
                <ProviderRow
                  icon={<SiStrava className="w-5 h-5" />}
                  label="Strava"
                  account={profile.linkedAccounts.strava}
                  color="#FC4C02"
                />
              </div>
            </Tab>

            <Tab key="services" title="Services">
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {profile.services.map((svc) => (
                    <Chip
                      key={svc}
                      size="sm"
                      variant="flat"
                      color={
                        svc === 'admin' ? 'danger'
                          : svc === 'strava' ? 'warning'
                          : svc === 'gpxstudio' ? 'success'
                          : 'primary'
                      }
                      classNames={{ base: "font-mono text-xs" }}
                    >
                      {svc}
                    </Chip>
                  ))}
                </div>
                <p className="text-xs text-default-400">
                  Services your account is authorized to access.
                </p>
              </div>
            </Tab>

            <Tab key="security" title="Security">
              <div className="space-y-3">
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-default-400" />
                    <span className="text-sm text-default-500">Session Version</span>
                  </div>
                  <span className="text-sm font-mono text-foreground">{profile.sessionVersion}</span>
                </div>
                <Divider />
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-default-400" />
                    <span className="text-sm text-default-500">Session Expires</span>
                  </div>
                  <span className="text-sm font-mono text-foreground">
                    {session.expires ? new Date(session.expires).toLocaleDateString() : 'Unknown'}
                  </span>
                </div>
                <Divider />
                <div className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-default-400" />
                    <span className="text-sm text-default-500">Account Status</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${profile.lockedOut ? 'bg-danger' : 'bg-success'}`} />
                    <span className={`text-xs ${profile.lockedOut ? 'text-danger' : 'text-success'}`}>
                      {profile.lockedOut ? 'Locked' : 'Active'}
                    </span>
                  </div>
                </div>
              </div>
            </Tab>
          </Tabs>
        </CardBody>
      </Card>

      {/* Sign Out */}
      <Button
        variant="flat"
        color="danger"
        className="w-full"
        startContent={<LogOut className="w-4 h-4" />}
        onPress={() => signOut({ callbackUrl: `${basePath}/login` })}
      >
        Sign Out
      </Button>

      {/* Debug */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="p-0">
          <Accordion>
            <AccordionItem
              key="debug"
              aria-label="Developer Info"
              title={<span className="text-sm font-semibold text-default-500">Developer Info</span>}
            >
              <div className="space-y-3 pb-3 px-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-default-400">User ID</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-foreground truncate max-w-[200px]">
                      {profile.userId}
                    </span>
                    <button
                      onClick={copyUserId}
                      className="text-default-400 hover:text-foreground transition-colors cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
                <Divider />
                <div>
                  <span className="text-xs text-default-400 block mb-1">Raw Session</span>
                  <pre className="terminal-block p-3 text-xs overflow-x-auto text-foreground">
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
      <div className="space-y-4">
        <div className="glass-card rounded-xl p-6">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-content2 animate-pulse" />
            <div className="space-y-2 flex-1">
              <div className="h-6 w-40 rounded bg-content2 animate-pulse" />
              <div className="h-4 w-56 rounded bg-content2 animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return <ProfileContent />;
}
