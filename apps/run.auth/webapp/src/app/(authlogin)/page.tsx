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
import { LogOut, ChevronRight, Shield, Copy, Check } from 'lucide-react';
import { SiDiscord, SiGithub, SiStrava } from 'react-icons/si';

const REGION_SHORT = process.env.NEXT_PUBLIC_REGION_SHORT || 'use1';

const basePath = process.env.NODE_ENV === 'production'
  ? `/${REGION_SHORT}`
  : '';

// This bare landing (auth.defcon.run/{region}) is a historical artifact — most
// users never need it; the real entry is run.human → OIDC → /login. So bounce
// everyone to run.human EXCEPT admins (who use it as the console jump-off) and
// anyone passing ?debug=true (to inspect the page directly).
const RUN_HUMAN_URL = `https://run.${process.env.NEXT_PUBLIC_SITE_DOMAIN || 'defcon.run'}/${REGION_SHORT}`;

type LinkedAccount = { linked: boolean };

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const days = Math.floor((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (days <= 0) return 'expired';
  if (days === 1) return 'in 1 day';
  if (days < 30) return `in ${days} days`;
  return `in ${Math.floor(days / 30)} months`;
}

const providers = [
  { key: 'discord', label: 'Discord', icon: SiDiscord, color: '#5865F2' },
  { key: 'github', label: 'GitHub', icon: SiGithub, color: '#e4e4ef' },
  { key: 'strava', label: 'Strava', icon: SiStrava, color: '#FC4C02' },
] as const;

function DashboardContent() {
  const { data: session, status } = useSession();
  const [linked, setLinked] = useState<Record<string, LinkedAccount> | null>(null);
  const [copied, setCopied] = useState(false);
  const services = (session?.user as { services?: string[] })?.services || [];
  const isAdmin = services.includes('admin') || services.includes('runadmin');
  const debug =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('debug') === 'true';
  // Non-admin (incl. unauthenticated), non-debug, session resolved → bounce to
  // run.human. Waits for the session to resolve so a slow load can't misclassify
  // an admin as a non-admin. Computed synchronously so the render guard below can
  // show the skeleton instead of flashing the Sign In card before we navigate.
  const shouldBounce = status !== 'loading' && !isAdmin && !debug;

  useEffect(() => {
    if (shouldBounce) window.location.replace(RUN_HUMAN_URL);
  }, [shouldBounce]);

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch(`${basePath}/api/profile`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.user?.linkedAccounts) setLinked(d.user.linkedAccounts); })
      .catch(() => {});
  }, [status]);

  const copyUserId = () => {
    if (!session?.user?.id) return;
    navigator.clipboard.writeText(session.user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Skeleton while the session resolves OR while we bounce a non-admin to
  // run.human — avoids flashing the Sign In card / dashboard before navigating.
  if (status === 'loading' || shouldBounce) {
    return (
      <div className="space-y-4">
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
      <div className="space-y-6 animate-fade-up">
        <div className="text-center space-y-2">
          <h1 className="font-museo text-4xl font-bold tracking-tight text-foreground">
            defcon<span className="teal-dot">.</span>run
          </h1>
          <p className="font-mono text-xs text-default-400 tracking-widest uppercase">
            Authentication Server
          </p>
        </div>
        <Card className="glass-card">
          <CardBody className="flex justify-center py-6">
            <Button as="a" href={`${basePath}/login`} variant="solid" color="primary" className="font-semibold" size="lg">
              Sign In
            </Button>
          </CardBody>
        </Card>
      </div>
    );
  }

  const { user } = session;

  return (
    <div className="space-y-4 w-full animate-fade-up">
      {/* Identity hero */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="px-5 py-5">
          <div className="flex items-center gap-4">
            <Avatar
              src={user?.image || undefined}
              name={user?.name || user?.email || 'U'}
              size="lg"
              isBordered
              color="primary"
              classNames={{ base: "ring-2 ring-primary/20" }}
            />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-museo text-xl font-bold text-foreground truncate">
                {user?.name || 'Unknown User'}
              </span>
              <span className="text-sm text-default-500 truncate">{user?.email}</span>
              {session.expires && (
                <span className="text-xs text-default-400 font-mono">
                  Session expires {formatRelativeTime(session.expires)}
                </span>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Providers + Services */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="px-5 py-4 space-y-4">
          {/* Linked Providers */}
          <div className="space-y-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-default-400">
              Linked Providers
            </span>
            <div className="space-y-1.5">
              {providers.map(({ key, label, icon: Icon, color }) => {
                const isLinked = linked ? linked[key]?.linked : undefined;
                return (
                  <div key={key} className="flex items-center justify-between py-1.5">
                    <div className="flex items-center gap-2.5">
                      <Icon className="w-4 h-4" style={{ color: isLinked ? color : undefined }} />
                      <span className={`text-sm ${isLinked ? 'text-foreground' : 'text-default-400'}`}>{label}</span>
                    </div>
                    {isLinked === undefined ? (
                      <div className="w-2 h-2 rounded-full bg-default-300 animate-pulse" />
                    ) : isLinked ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-full bg-success" />
                        <span className="text-xs text-success">Connected</span>
                      </div>
                    ) : (
                      <span className="text-xs text-default-400">Not linked</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <Divider />

          {/* Services */}
          <div className="space-y-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-default-400">
              Services
            </span>
            {services.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {services.map((svc) => (
                  <Chip
                    key={svc}
                    size="sm"
                    variant="flat"
                    color="primary"
                    classNames={{ base: "font-mono text-xs" }}
                  >
                    {svc}
                  </Chip>
                ))}
              </div>
            ) : (
              <span className="text-sm text-default-400">No services assigned</span>
            )}
          </div>
        </CardBody>
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          as="a"
          href={`${basePath}/profile`}
          variant="flat"
          color="primary"
          className="flex-1"
          endContent={<ChevronRight className="w-4 h-4" />}
        >
          Full Profile
        </Button>
        <Button
          variant="flat"
          color="danger"
          className="flex-1"
          startContent={<LogOut className="w-4 h-4" />}
          onPress={() => signOut({ callbackUrl: `${basePath}/login` })}
        >
          Sign Out
        </Button>
      </div>

      {/* Debug */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="p-0">
          <Accordion>
            <AccordionItem
              key="debug"
              aria-label="Developer Info"
              title={
                <span className="text-sm font-semibold text-default-500">Developer Info</span>
              }
            >
              <div className="space-y-3 pb-3 px-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-default-400">User ID</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-foreground truncate max-w-[200px]">
                      {user?.id}
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

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return (
      <div className="space-y-4">
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

  return <DashboardContent />;
}
