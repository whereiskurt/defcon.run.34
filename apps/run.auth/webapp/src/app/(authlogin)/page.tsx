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
import { LogOut, ChevronRight } from 'lucide-react';
import { SiDiscord, SiGithub, SiStrava } from 'react-icons/si';

const basePath = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
  : '';

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
  { key: 'discord', label: 'Discord', icon: <SiDiscord className="w-4 h-4" /> },
  { key: 'github', label: 'GitHub', icon: <SiGithub className="w-4 h-4" /> },
  { key: 'strava', label: 'Strava', icon: <SiStrava className="w-4 h-4" /> },
] as const;

function DashboardContent() {
  const { data: session, status } = useSession();
  const [linked, setLinked] = useState<Record<string, LinkedAccount> | null>(null);
  const services = (session?.user as { services?: string[] })?.services || [];

  useEffect(() => {
    if (status !== 'authenticated') return;
    fetch(`${basePath}/api/profile`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.user?.linkedAccounts) setLinked(d.user.linkedAccounts); })
      .catch(() => {});
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="bg-content1 shadow-lg rounded-lg p-6">
        <p className="text-center text-foreground">Loading session...</p>
      </div>
    );
  }

  if (status === 'unauthenticated' || !session) {
    return (
      <Card className="shadow-lg bg-content1">
        <CardBody className="flex justify-center">
          <Button as="a" href={`${basePath}/login`} variant="solid" color="primary" className="text-lg font-semibold">
            Go to Login
          </Button>
        </CardBody>
      </Card>
    );
  }

  const { user } = session;

  return (
    <div className="space-y-4 w-full">
      {/* Identity */}
      <Card className="shadow-lg bg-content1">
        <CardBody>
          <div className="flex items-center gap-4">
            <Avatar src={user?.image || undefined} name={user?.name || user?.email || 'U'} size="lg" isBordered color="primary" />
            <div className="flex flex-col min-w-0">
              <span className="text-lg font-semibold text-foreground truncate">{user?.name || 'Unknown User'}</span>
              <span className="text-sm text-default-500 truncate">{user?.email}</span>
              {session.expires && (
                <span className="text-xs text-default-400">Session expires {formatRelativeTime(session.expires)}</span>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Linked Providers */}
      <Card className="shadow-lg bg-content1">
        <CardHeader><span className="text-md font-semibold text-foreground">Linked Providers</span></CardHeader>
        <Divider />
        <CardBody className="space-y-2">
          {providers.map(({ key, label, icon }) => {
            const isLinked = linked ? linked[key]?.linked : undefined;
            return (
              <div key={key} className="flex items-center justify-between p-2 rounded-md bg-default-50">
                <div className="flex items-center gap-3">
                  <span className="text-default-500">{icon}</span>
                  <span className="text-sm text-foreground">{label}</span>
                </div>
                {isLinked === undefined ? (
                  <Chip size="sm" variant="flat">...</Chip>
                ) : isLinked ? (
                  <Chip size="sm" variant="flat" color="success">Connected</Chip>
                ) : (
                  <Chip size="sm" variant="flat">Not Connected</Chip>
                )}
              </div>
            );
          })}
        </CardBody>
      </Card>

      {/* Services */}
      <Card className="shadow-lg bg-content1">
        <CardHeader><span className="text-md font-semibold text-foreground">Services</span></CardHeader>
        <Divider />
        <CardBody>
          {services.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {services.map((svc) => (
                <Chip key={svc} size="sm" variant="flat" color={svc === 'admin' ? 'danger' : svc === 'gpxstudio' || svc === 'gpx' ? 'secondary' : 'primary'}>
                  {svc}
                </Chip>
              ))}
            </div>
          ) : (
            <span className="text-sm text-default-500">No services assigned</span>
          )}
        </CardBody>
      </Card>

      {/* Actions */}
      <div className="flex gap-3">
        <Button as="a" href={`${basePath}/profile`} variant="flat" color="primary" className="flex-1" endContent={<ChevronRight className="w-4 h-4" />}>
          View Full Profile
        </Button>
        <Button variant="flat" color="danger" className="flex-1" startContent={<LogOut className="w-4 h-4" />} onPress={() => signOut({ callbackUrl: `${basePath}/login` })}>
          Sign Out
        </Button>
      </div>

      {/* Debug */}
      <Card className="shadow-lg bg-content1">
        <CardBody className="p-0">
          <Accordion>
            <AccordionItem key="debug" aria-label="Debug" title={<span className="text-md font-semibold text-foreground">Developer Info</span>}>
              <div className="space-y-3 pb-3 px-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-default-500">User ID</span>
                  <span className="text-xs font-mono text-foreground truncate max-w-[200px]">{user?.id}</span>
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

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  if (!mounted) {
    return (
      <div className="bg-content1 shadow-lg rounded-lg p-6">
        <p className="text-center text-foreground">Loading...</p>
      </div>
    );
  }

  return <DashboardContent />;
}
