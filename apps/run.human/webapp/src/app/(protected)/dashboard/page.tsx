'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useLogout } from '@/hooks/useLogout';
import { Card, CardBody, Divider, Button, Chip, Avatar } from '@heroui/react';
import { LogOut, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react';
import { SiStrava, SiDiscord, SiGithub } from 'react-icons/si';

const homeUrl = '/';

function relativeExpiry(expires: string): string {
  const ms = new Date(expires).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `Expires in ${h}h ${m}m` : `Expires in ${m}m`;
}

const providers = [
  { name: 'Discord', icon: SiDiscord, key: 'hasDiscord' },
  { name: 'GitHub', icon: SiGithub, key: 'hasGithub' },
  { name: 'Strava', icon: SiStrava, key: 'hasStrava' },
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
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
        <p className="text-default-500">Loading...</p>
      </div>
    );
  }

  const { user } = session;
  const services: string[] = user.services || [];

  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-lg space-y-4">
        <Card>
          <CardBody className="space-y-5">
            {/* Identity */}
            <div className="flex items-center gap-4">
              <Avatar src={user?.image || undefined} name={user?.displayName || user?.email || 'U'} size="lg" isBordered color="primary" />
              <div className="flex flex-col">
                <span className="text-lg font-semibold text-foreground">{user?.displayName || user?.name || 'Unknown User'}</span>
                {user?.email && <span className="text-sm text-default-500">{user.email}</span>}
                {session.expires && <span className="text-xs text-default-400">{relativeExpiry(session.expires)}</span>}
              </div>
            </div>

            <Divider />

            {/* Linked Providers */}
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-default-400">Linked Providers</span>
              {providers.map(({ name, icon: Icon, key }) => (
                <div key={name} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 text-default-500" />
                    <span className="text-sm text-foreground">{name}</span>
                  </div>
                  <Chip size="sm" variant="flat" color={user[key] ? 'success' : 'default'}>
                    {user[key] ? 'Connected' : 'Not Connected'}
                  </Chip>
                </div>
              ))}
              <p className="text-xs text-default-400">Manage connections at auth.defcon.run</p>
            </div>

            <Divider />

            {/* Authorized Services */}
            <div className="space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-default-400">Authorized Services</span>
              {services.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {services.map((s) => (
                    <Chip key={s} size="sm" variant="flat" color={s === 'admin' ? 'danger' : s === 'gpx' ? 'secondary' : 'primary'}>{s}</Chip>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-default-500">No services assigned</p>
              )}
            </div>

            <Divider />

            {/* Quick links */}
            <div className="flex gap-2">
              <Button variant="flat" color="primary" href="/profile" as="a">View Profile &amp; Settings</Button>
              <Button variant="flat" color="danger" startContent={<LogOut className="w-4 h-4" />} onPress={() => logout('/')}>Sign Out</Button>
            </div>
          </CardBody>
        </Card>

        {/* Debug */}
        <Card>
          <CardBody className="space-y-3">
            <button onClick={() => setIsDebugOpen(!isDebugOpen)} className="flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80 transition-opacity">
              {isDebugOpen ? <ChevronDown className="w-4 h-4 text-default-500" /> : <ChevronRight className="w-4 h-4 text-default-500" />}
              <span className="text-sm font-semibold text-foreground">Debug</span>
            </button>
            {isDebugOpen && (
              <div className="space-y-3">
                {user?.id && <p className="text-xs text-default-400">User ID: <span className="font-mono">{user.id}</span></p>}
                <Button size="sm" variant="flat" color="primary" isLoading={isRefreshing} onPress={handleRefreshClaims} startContent={<RefreshCw className="w-3 h-3" />}>
                  Refresh Claims
                </Button>
                <pre className="p-3 rounded-md text-xs overflow-x-auto bg-default-100 text-foreground">{JSON.stringify(session, null, 2)}</pre>
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
