'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useLogout } from '@/hooks/useLogout';
import { Card, CardBody, Divider, Button, Chip, Avatar, Skeleton, Input } from '@heroui/react';
import { LogOut, ChevronRight, ChevronDown, RefreshCw, Pencil, Check, X } from 'lucide-react';
import { SiStrava, SiDiscord, SiGithub } from 'react-icons/si';
import MeshtasticRadios from '@/components/profile/MeshtasticRadios';
import CheckInHistory from '@/components/profile/CheckInHistory';
import CheckInPinCard from '@/components/profile/CheckInPinCard';
import SocialQRRow from '@/components/profile/SocialQRRow';
import { useCopy } from '@/components/CopyProvider';
import { apiUrl } from '@/lib/api';

const homeUrl = '/';
const isDev = process.env.NODE_ENV !== 'production';

// Default social group URLs (the DEF CON run Strava club + Signal group). These
// are a code-level FLOOR only — the CMS copy keys `socials.strava_group_url` /
// `socials.signal_group_url` override them at runtime with no redeploy (see the
// `asUrl(...) || DEFAULT` reads below). Empty a default to hide that tile.
const DEFAULT_STRAVA_GROUP_URL = 'https://www.strava.com/clubs/1071823';
const DEFAULT_SIGNAL_GROUP_URL = 'https://signal.group/#CjQKIPWdGurSgpzV8xcut1PWo_at1L6hUEFJtHhxLnlAxErEEhB5h5oWXv68P7cgGAGVZ26I';
const siteDomain = process.env.NEXT_PUBLIC_SITE_DOMAIN || 'defcon.run';
const LOCAL_AUTH_PORT = process.env.NEXT_PUBLIC_LOCAL_AUTH_PORT || '3002';
const REGION_SHORT = process.env.NEXT_PUBLIC_REGION_SHORT || 'use1';

interface QuotaInfo {
  remaining: number;
  initial: number;
}

interface UserData {
  userId: string;
  displayname?: string;
  displayName?: string;
  eqr?: string;
  mqttUsername?: string;
  mqttPassword?: string;
  mqttUsertype?: string;
  meshtasticRadios?: any[];
  checkIns?: any[];
  checkInCount?: number;
  runnerCode?: string | null;
  quotas?: Record<string, QuotaInfo>;
  preferences?: {
    checkinPreference?: string;
  };
  checkin_preference?: string;
}

const quotaGroups = [
  { label: 'Uploads', items: [
    { key: 'file_upload', label: 'Files' },
    { key: 'gpx_upload', label: 'GPX Uploads' },
    { key: 'gpx_save', label: 'GPX Saves' },
    { key: 'gpx_share', label: 'GPX Shares' },
    { key: 'photo_upload', label: 'Photos' },
  ]},
  { label: 'Activity', items: [
    { key: 'checkin', label: 'Check-ins' },
    { key: 'strava_sync', label: 'Strava Syncs' },
    { key: 'qr_scan', label: 'QR Scans' },
  ]},
  { label: 'System', items: [
    { key: 'meshtastic_radio', label: 'Radio Slots' },
    { key: 'displayname_change', label: 'Name Changes' },
    { key: 'qr_sheet', label: 'QR Sheets' },
  ]},
];

const providerList = [
  { name: 'Discord', icon: SiDiscord, key: 'hasDiscord', color: '#5865F2' },
  { name: 'GitHub', icon: SiGithub, key: 'hasGithub', color: '#e4e4ef' },
  { name: 'Strava', icon: SiStrava, key: 'hasStrava', color: '#FC4C02' },
] as const;

function relativeExpiry(expires: string): string {
  const ms = new Date(expires).getTime() - Date.now();
  if (ms <= 0) return 'Expired';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function QuotaBar({ remaining, initial, label }: { remaining: number; initial: number; label: string }) {
  const pct = initial > 0 ? (remaining / initial) * 100 : 0;
  const barColor = pct > 50 ? 'bg-primary' : pct > 20 ? 'bg-warning' : 'bg-danger';

  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-default-500">{label}</span>
        <span className="font-mono text-sm text-foreground">
          {remaining}<span className="text-default-400 text-xs">/{initial}</span>
        </span>
      </div>
      <div className="w-full h-1.5 rounded-full bg-content2 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.max(pct, 2)}%` }}
        />
      </div>
    </div>
  );
}

export default function WhoAmIPage() {
  const [mounted, setMounted] = useState(false);
  const [isQROpen, setIsQROpen] = useState(false);
  const [isQuotasOpen, setIsQuotasOpen] = useState(false);
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const { data: session, update, status } = useSession();
  const { logout } = useLogout();
  const { t } = useCopy();

  // Social group URLs come from CMS copy; `t` echoes the raw key when unset, so
  // only accept a real http(s) URL — anything else hides that tile.
  const asUrl = (key: string) => {
    const v = t(key);
    return v.startsWith('http') ? v : '';
  };
  const stravaGroupUrl = asUrl('socials.strava_group_url') || DEFAULT_STRAVA_GROUP_URL;
  const signalGroupUrl = asUrl('socials.signal_group_url') || DEFAULT_SIGNAL_GROUP_URL;

  useEffect(() => { setMounted(true); }, []);

  // Refresh claims when tab regains focus (e.g., after linking Strava in another tab)
  useEffect(() => {
    const onFocus = () => {
      if (status === 'authenticated') {
        update({ refreshClaims: true });
        fetchUserData();
      }
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [status]);

  useEffect(() => {
    if (session?.user?.id) {
      fetchUserData();
    }
  }, [session?.user?.id]);

  const fetchUserData = async () => {
    try {
      const response = await fetch(apiUrl('/api/user'));
      if (!response.ok) {
        throw new Error('Failed to fetch user data');
      }
      const data = await response.json();
      setUserData(data.user);
    } catch (err) {
      console.error('Error fetching user data:', err);
      setError('Failed to load user data');
    } finally {
      setLoading(false);
    }
  };

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

  const startEditName = (current: string) => {
    setNameInput(current);
    setNameError(null);
    setIsEditingName(true);
  };

  const saveName = async () => {
    const trimmed = nameInput.trim();
    if (trimmed === displayName) {
      setIsEditingName(false); // no change — don't burn a name-change quota
      return;
    }
    if (trimmed.length < 3 || trimmed.length > 20) {
      setNameError('Must be 3–20 characters');
      return;
    }
    setSavingName(true);
    setNameError(null);
    try {
      const res = await fetch(apiUrl('/api/user'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmed }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not save name');
      }
      setIsEditingName(false);
      await update({ refreshClaims: true }); // pull the new name into the session
      await fetchUserData(); // refresh name + name-change quota
    } catch (err) {
      setNameError(err instanceof Error ? err.message : 'Could not save name');
    } finally {
      setSavingName(false);
    }
  };

  if (!mounted || status === 'loading' || loading) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="h-7 w-48 rounded bg-content2 animate-pulse" />
        <Card className="glass-card overflow-hidden">
          <CardBody className="p-5">
            <Skeleton className="h-12 w-full rounded-lg" />
          </CardBody>
        </Card>
        <Card className="glass-card overflow-hidden">
          <CardBody className="p-5">
            <Skeleton className="h-40 w-full rounded-lg" />
          </CardBody>
        </Card>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <p className="text-default-500">Please sign in to view your profile.</p>
      </div>
    );
  }

  const { user } = session;
  const displayName = userData?.displayname || userData?.displayName || user?.displayName || user?.name || 'Runner';
  const nameChangesLeft = userData?.quotas?.displayname_change?.remaining ?? 0;
  const services: string[] = user.services || [];

  return (
    <div className="max-w-[900px] mx-auto space-y-2.5 animate-fade-up">
      {/* Identity card */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="px-5 py-4 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
            <Avatar
              src={user?.image || undefined}
              name={displayName}
              size="lg"
              isBordered
              color="primary"
              classNames={{ base: "ring-2 ring-primary/20" }}
            />
            <div className="flex flex-col min-w-0 flex-1">
              {isEditingName ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-1.5">
                    <Input
                      autoFocus
                      size="sm"
                      value={nameInput}
                      onValueChange={setNameInput}
                      maxLength={20}
                      isDisabled={savingName}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveName();
                        if (e.key === 'Escape') setIsEditingName(false);
                      }}
                      classNames={{ inputWrapper: 'h-8', input: 'font-museo font-bold' }}
                    />
                    <Button isIconOnly size="sm" variant="flat" color="primary" isLoading={savingName} onPress={saveName}>
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button isIconOnly size="sm" variant="light" isDisabled={savingName} onPress={() => setIsEditingName(false)}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                  {nameError && <span className="text-danger text-xs">{nameError}</span>}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="font-museo text-lg font-bold text-foreground truncate">
                    {displayName}
                  </span>
                  {nameChangesLeft > 0 && (
                    <button
                      onClick={() => startEditName(displayName)}
                      className="shrink-0 text-default-400 hover:text-primary transition-colors cursor-pointer"
                      aria-label="Edit display name"
                      title={`Change your name (${nameChangesLeft} left)`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )}
              {user?.email && (
                <span className="text-xs text-default-500 truncate">{user.email}</span>
              )}
              {userData?.mqttUsername && (
                <span className="font-mono text-xs text-default-400">{userData.mqttUsername}</span>
              )}
              {userData?.runnerCode && (
                <span className="font-mono text-xs text-primary">🎽 {userData.runnerCode.toUpperCase()}</span>
              )}
            </div>
            </div>
            <SocialQRRow
              stravaUrl={stravaGroupUrl}
              signalUrl={signalGroupUrl}
            />
          </div>
          {session.expires && (
            <p className="font-mono text-xs text-default-400">
              Session: {relativeExpiry(session.expires)} remaining
            </p>
          )}
        </CardBody>
      </Card>

      {/* Your Social QR (collapsed by default) — sits directly under the header */}
      {userData?.eqr && (
        <Card className="glass-card overflow-hidden">
          <CardBody className="px-5 py-3">
            <button
              onClick={() => setIsQROpen(!isQROpen)}
              className="flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80 transition-opacity"
            >
              {isQROpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-default-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-default-400" />
              )}
              <span className="font-museo text-base font-bold text-foreground">Your Social QR</span>
              {userData?.runnerCode && (
                <span className="font-mono text-xs text-primary">🎽 {userData.runnerCode.toUpperCase()}</span>
              )}
            </button>
            {isQROpen && (
              <div className="flex flex-col items-center mt-3 space-y-3">
                <div className="bg-white p-3 rounded-lg">
                  <img
                    src={userData.eqr}
                    alt="Your QR Code"
                    className="max-w-[220px]"
                  />
                </div>
                <p className="text-xs text-default-400 text-center">
                  Share this QR code to connect with other runners
                </p>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Check-in History (Check-in Pin nested inside) */}
      <CheckInHistory checkInCount={userData?.checkInCount ?? 0} checkinPreference={userData?.preferences?.checkinPreference}>
        <CheckInPinCard />
      </CheckInHistory>

      {/* Meshtastic Radios */}
      <MeshtasticRadios
        radios={userData?.meshtasticRadios}
        quotas={userData?.quotas}
        mqttUsername={userData?.mqttUsername}
        mqttPassword={userData?.mqttPassword}
        onUpdate={fetchUserData}
      />

      {/* Quotas */}
      {userData?.quotas && (
        <Card className="glass-card overflow-hidden">
          <CardBody className="px-5 py-3">
            <button
              onClick={() => setIsQuotasOpen(!isQuotasOpen)}
              className="flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80 transition-opacity"
            >
              {isQuotasOpen ? (
                <ChevronDown className="w-3.5 h-3.5 text-default-400" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-default-400" />
              )}
              <span className="font-museo text-base font-bold text-foreground">Quotas</span>
            </button>
            {isQuotasOpen && (
              <div className="space-y-5 mt-3">
                {quotaGroups.map((group) => (
                  <div key={group.label}>
                    <p className="text-xs uppercase tracking-wider text-default-400 mb-3 font-semibold">
                      {group.label}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {group.items.map((item) => {
                        const quota = userData.quotas![item.key];
                        if (!quota) return null;
                        return (
                          <QuotaBar
                            key={item.key}
                            remaining={quota.remaining}
                            initial={quota.initial}
                            label={item.label}
                          />
                        );
                      })}
                    </div>
                    {group !== quotaGroups[quotaGroups.length - 1] && <Divider className="mt-4" />}
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Two-column: Providers + Services */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
        {/* Linked Providers */}
        <Card className="glass-card overflow-hidden">
          <CardBody className="px-5 py-4 space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-default-400">
              Linked Providers
            </span>
            <div className="flex flex-wrap gap-1.5">
              {providerList.map(({ name, icon: Icon, key, color }) => {
                const isConnected = user[key];
                const linkable = !isConnected && name === 'Strava';
                const chip = (
                  <Chip
                    key={name}
                    size="sm"
                    variant="flat"
                    color={isConnected ? 'success' : linkable ? 'warning' : 'default'}
                    startContent={
                      <Icon className="w-3 h-3 ml-1" style={{ color: isConnected ? color : linkable ? '#FC4C02' : undefined }} />
                    }
                    classNames={{ base: `font-mono text-xs ${linkable ? 'cursor-pointer hover:scale-105 transition-transform border-1 border-warning/50' : ''}` }}
                  >
                    {linkable ? 'Link Strava ↗' : name}
                  </Chip>
                );
                if (linkable) {
                  const authBase = isDev
                    ? `http://localhost:${LOCAL_AUTH_PORT}`
                    : `https://auth.${siteDomain}/${REGION_SHORT}`;
                  return (
                    <a key={name} href={`${authBase}/strava?autoLink`} target="_blank" rel="noopener noreferrer">
                      {chip}
                    </a>
                  );
                }
                return chip;
              })}
            </div>
          </CardBody>
        </Card>

        {/* Authorized Services */}
        <Card className="glass-card overflow-hidden">
          <CardBody className="px-5 py-4 space-y-3">
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
                    color="primary"
                    classNames={{ base: "font-mono text-xs" }}
                  >
                    {s}
                  </Chip>
                ))}
              </div>
            ) : (
              <p className="text-sm text-default-400">No services assigned</p>
            )}

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

      {/* Sign Out */}
      <Button
        variant="flat"
        color="danger"
        className="w-full"
        startContent={<LogOut className="w-4 h-4" />}
        onPress={() => logout('/')}
      >
        Sign Out
      </Button>
    </div>
  );
}
