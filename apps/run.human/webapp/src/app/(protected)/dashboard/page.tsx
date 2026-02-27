'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useLogout } from '@/hooks/useLogout';
import { Card, CardBody, Divider, Button, Chip, Avatar } from '@heroui/react';
import { LogOut, ChevronRight, ChevronDown, RefreshCw, ExternalLink } from 'lucide-react';
import { SiStrava, SiDiscord, SiGithub } from 'react-icons/si';

const homeUrl = '/';

function relativeExpiry(expires: string): string {
  const ms = new Date(expires).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

const providers = [
  { name: 'Discord', icon: SiDiscord, key: 'hasDiscord', color: '#5865F2' },
  { name: 'GitHub', icon: SiGithub, key: 'hasGithub', color: '#e4e4ef' },
  { name: 'Strava', icon: SiStrava, key: 'hasStrava', color: '#FC4C02' },
] as const;

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const router = useRouter();
  const { data: session, update } = useSession();
  const { logout } = useLogout();

  useEffect(() => { setMounted(true); }, []);

  const handleRefreshClaims = async () => {
    setIsRefreshing(true);
    try {
      const result = await update({ refreshClaims: true });
      if (!result) { await signOut({ callbackUrl: homeUrl }); return; }
      router.refresh();
    } catch {
      await signOut({ callbackUrl: homeUrl });
    } finally {
      setIsRefreshing(false);
    }
  };

  if (!mounted || !session) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-64 rounded bg-content2 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="glass-card rounded-xl p-6 h-48 animate-pulse" />
          <div className="glass-card rounded-xl p-6 h-48 animate-pulse" />
        </div>
      </div>
    );
  }

  const { user } = session;
  const services: string[] = user.services || [];

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Welcome header */}
      <div>
        <h1 className="font-museo text-2xl font-bold tracking-tight text-foreground">
          Welcome back, {user?.displayName || user?.name?.split(' ')[0] || 'Runner'}
        </h1>
        <p className="text-sm text-default-400 mt-1">
          {session.expires && (
            <span className="font-mono text-xs">Session: {relativeExpiry(session.expires)} remaining</span>
          )}
        </p>
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Identity card */}
        <Card className="glass-card overflow-hidden">
          <CardBody className="px-5 py-4 space-y-4">
            <div className="flex items-center gap-3">
              <Avatar
                src={user?.image || undefined}
                name={user?.displayName || user?.email || 'U'}
                size="lg"
                isBordered
                color="primary"
                classNames={{ base: "ring-2 ring-primary/20" }}
              />
              <div className="flex flex-col min-w-0">
                <span className="font-semibold text-foreground truncate">
                  {user?.displayName || user?.name || 'Unknown User'}
                </span>
                {user?.email && (
                  <span className="text-xs text-default-500 truncate">{user.email}</span>
                )}
              </div>
            </div>

            <Divider />

            {/* Linked Providers */}
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-default-400">
                Linked Providers
              </span>
              {providers.map(({ name, icon: Icon, key, color }) => {
                const isConnected = user[key];
                return (
                  <div key={name} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <Icon className="w-3.5 h-3.5" style={{ color: isConnected ? color : undefined }} />
                      <span className={`text-sm ${isConnected ? 'text-foreground' : 'text-default-400'}`}>{name}</span>
                    </div>
                    {isConnected ? (
                      <div className="flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-success" />
                        <span className="text-xs text-success">Connected</span>
                      </div>
                    ) : (
                      <span className="text-xs text-default-400">-</span>
                    )}
                  </div>
                );
              })}
              <p className="text-xs text-default-400 pt-1">
                Manage at{' '}
                <a href="https://auth.defcon.run" className="text-primary hover:underline" target="_blank" rel="noreferrer">
                  auth.defcon.run <ExternalLink className="w-3 h-3 inline" />
                </a>
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Services + Actions card */}
        <Card className="glass-card overflow-hidden">
          <CardBody className="px-5 py-4 space-y-4">
            {/* Services */}
            <div className="space-y-2.5">
              <span className="text-xs font-semibold uppercase tracking-wider text-default-400">
                Authorized Services
              </span>
              {services.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {services.map((s) => (
                    <Chip
                      key={s}
                      size="sm"
                      variant="flat"
                      color={s === 'admin' ? 'danger' : s === 'gpx' ? 'secondary' : 'primary'}
                      classNames={{ base: "font-mono text-xs" }}
                    >
                      {s}
                    </Chip>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-default-400">No services assigned</p>
              )}
            </div>

            <Divider />

            {/* Quick actions */}
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-default-400">
                Quick Actions
              </span>
              <div className="space-y-2">
                <Button
                  variant="flat"
                  color="primary"
                  href="/profile"
                  as="a"
                  className="w-full justify-start"
                  endContent={<ChevronRight className="w-4 h-4 ml-auto" />}
                >
                  Profile & Settings
                </Button>
                <Button
                  variant="flat"
                  color="danger"
                  className="w-full justify-start"
                  startContent={<LogOut className="w-4 h-4" />}
                  onPress={() => logout('/')}
                >
                  Sign Out
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Debug */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="px-5 py-3">
          <button
            onClick={() => setIsDebugOpen(!isDebugOpen)}
            className="flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80 transition-opacity"
          >
            {isDebugOpen ? (
              <ChevronDown className="w-3.5 h-3.5 text-default-400" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-default-400" />
            )}
            <span className="text-sm font-semibold text-default-500">Debug</span>
          </button>
          {isDebugOpen && (
            <div className="space-y-3 mt-3">
              {user?.id && (
                <p className="text-xs text-default-400">
                  User ID: <span className="font-mono text-foreground">{user.id}</span>
                </p>
              )}
              <Button
                size="sm"
                variant="flat"
                color="primary"
                isLoading={isRefreshing}
                onPress={handleRefreshClaims}
                startContent={<RefreshCw className="w-3 h-3" />}
              >
                Refresh Claims
              </Button>
              <pre className="terminal-block p-3 text-xs overflow-x-auto text-foreground">
                {JSON.stringify(session, null, 2)}
              </pre>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
