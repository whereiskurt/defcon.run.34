'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import { useLogout } from '@/hooks/useLogout';
import { Card, CardBody, Divider, Button, Chip, Avatar, Skeleton, Input } from '@heroui/react';
import { LogOut, ChevronRight, ChevronDown, RefreshCw, Pencil, Check, X, Download, QrCode, Footprints, Trophy, MapPin } from 'lucide-react';
import { SiStrava, SiDiscord, SiGithub } from 'react-icons/si';
import MeshtasticRadios from '@/components/profile/MeshtasticRadios';
import CheckInHistory from '@/components/profile/CheckInHistory';
import CheckInPinCard from '@/components/profile/CheckInPinCard';
import StyledRunnerQr from '@/components/qr/StyledRunnerQr';
import SocialQrFlair, { type SocialInfo } from '@/components/qr/SocialQrFlair';
import QrCardModal from '@/components/qr/QrCardModal';
import QrScannerModal from '@/components/qr/QrScannerModal';
import QuickCheckInModal from '@/components/QuickCheckInModal';
import YourStandingModal from '@/components/leaderboard/YourStandingModal';
import { useCopy } from '@/components/CopyProvider';
import { usePersistedDisclosure } from '@/hooks/usePersistedDisclosure';
import { apiUrl } from '@/lib/api';
import { LEADERBOARD_SELF_ENABLED } from '@/lib/leaderboard-launch';
import { gpxAddRunUrl } from '@/lib/gpx-addrun';
import { buildScannerCopy } from '@/lib/scanner-copy';

const homeUrl = '/';
const isDev = process.env.NODE_ENV !== 'production';
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
  hash?: string;
  mqttUsername?: string;
  mqttPassword?: string;
  mqttUsertype?: string;
  radios?: any[];
  checkIns?: any[];
  checkInCount?: number;
  runnerCode?: string | null;
  quotas?: Record<string, QuotaInfo>;
  preferences?: {
    checkinPreference?: string;
  };
  checkin_preference?: string;
  social?: SocialInfo;
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

/**
 * One row of the account accordion (Linked Providers / Authorized Services /
 * Debug). Declared at MODULE level, not inside WhoAmIPage — a component defined
 * inside another component is a new type on every render, so React unmounts and
 * remounts the whole subtree each time, losing focus and any child state.
 */
function DisclosureRow({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="py-3 first:pt-0 last:pb-0">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80 transition-opacity"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-default-400" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-default-400" />
        )}
        <span className="text-sm font-semibold text-default-500">{label}</span>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

export default function WhoAmIPage() {
  const [mounted, setMounted] = useState(false);
  // Panel open/closed states persist per browser so the page comes back the
  // way the runner left it (Kurt UAT 2026-07-23).
  const [isQROpen, setIsQROpen] = usePersistedDisclosure('social-qr');
  const [isCardModalOpen, setIsCardModalOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isQuickCheckInOpen, setIsQuickCheckInOpen] = useState(false);
  const [isStandingOpen, setIsStandingOpen] = useState(false);
  const [isQuotasOpen, setIsQuotasOpen] = usePersistedDisclosure('quotas');
  const [isDebugOpen, setIsDebugOpen] = usePersistedDisclosure('debug');
  // Kurt 2026-08-03: Providers / Services / Debug collapsed into ONE stacked
  // accordion. Each row keeps its own persisted key, so a runner who had Debug
  // open keeps it open — and the two new rows default closed, which is why the
  // account chrome no longer eats a screen of space above Sign Out.
  const [isProvidersOpen, setIsProvidersOpen] = usePersistedDisclosure('providers');
  const [isServicesOpen, setIsServicesOpen] = usePersistedDisclosure('services');
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

  // t() echoes the raw key when unset, so floor every lookup on a real default.
  const copyOr = (key: string, fallback: string) => {
    const v = t(key);
    return !v || v === key ? fallback : v;
  };
  const qrCardCopy = {
    tagline: copyOr('qrcard.tagline', 'SCAN TO CONNECT'),
    prompt: copyOr('qrcard.prompt', '$ defcon.run/connect_'),
    wordmark: copyOr('qrcard.wordmark', 'DEF CON 34'),
    site: copyOr('qrcard.site', 'defcon.run'),
    optionWallpaper: copyOr('qrcard.option.wallpaper', 'Lock-screen wallpaper'),
    optionShare: copyOr('qrcard.option.share', 'Share card'),
  };
  // Shared with the landing page's Scan button so the modal copy cannot drift.
  const scanCopy = buildScannerCopy(copyOr);

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
      setIsEditingName(false); // no change - don't burn a name-change quota
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

  // Skeleton only while bootstrapping. next-auth's update() flips status back
  // to 'loading' during the on-focus claims refresh — once userData exists,
  // keep the tree mounted so open dialogs survive the background refresh.
  if (!mounted || ((status === 'loading' || loading) && !userData)) {
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
  // Convenience gate on the cached session claims — same idiom as the header's
  // admin link. It only decides whether a BUTTON renders; /api/leaderboard/me
  // re-checks and live-revalidates, so a stale claim grants no real access.
  const isAdmin = services.includes('admin') || services.includes('runadmin');
  const authBase = isDev
    ? `http://localhost:${LOCAL_AUTH_PORT}`
    : `https://auth.${siteDomain}/${REGION_SHORT}`;
  const stravaLinkUrl = `${authBase}/strava?autoLink`;
  // Raw <img> under the hood — the region basePath must be prefixed by hand
  // (same idiom as the landing page's asset() helper).
  const bunnyHeadUrl = isDev
    ? '/header/bunny-head-alpha.png'
    : `/${REGION_SHORT}/header/bunny-head-alpha.png`;

  return (
    <div className="max-w-[900px] mx-auto space-y-2.5 animate-fade-up">
      {/* Identity card */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex flex-col gap-4 min-w-0 flex-1">
            <div className="flex items-center gap-3 min-w-0">
            <Avatar
              src={bunnyHeadUrl}
              alt="defcon.run bunny"
              size="lg"
              isBordered
              color="primary"
              classNames={{
                base: 'ring-2 ring-primary/20 bg-black shrink-0',
                img: 'object-contain p-1',
              }}
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
            {/* Action bar — ONE loud primary (+Activity, gpx green) beside three
                brand-teal outline actions. Order is deliberate (Kurt, 2026-08-03):
                the two things you do about YOUR OWN standing come first
                (+Activity, My Leaderboard), then the two things you do out in the
                world (Scan, Check-in). */}
            <div className="flex flex-wrap items-center gap-2 self-start">
              <a
                href={gpxAddRunUrl()}
                target="_blank"
                rel="noopener noreferrer"
                className="cta-bar seg-addrun flex items-center gap-2 rounded-full font-semibold text-xs sm:text-sm px-3 sm:px-4 py-2 sm:py-2.5 whitespace-nowrap"
              >
                <Footprints className="w-4 h-4 sm:w-5 sm:h-5" />
                +Activity
              </a>
              {/* "My Leaderboard", not "Leaderboard": this opens YourStandingModal
                  — the caller's OWN row — while the header nav entry of the same
                  name would open the full multi-runner board. Two surfaces, two
                  names. LEADERBOARD_SELF_ENABLED is a cosmetic gate only; the API
                  behind it enforces the same rule server-side. */}
              {(LEADERBOARD_SELF_ENABLED || isAdmin) && (
                <Button
                  color="primary"
                  variant="bordered"
                  radius="full"
                  className="font-semibold"
                  startContent={<Trophy className="w-4 h-4 sm:w-5 sm:h-5" />}
                  onPress={() => setIsStandingOpen(true)}
                >
                  {copyOr('leaderboard.self.button', 'My Leaderboard')}
                </Button>
              )}
              {/* The camera, promoted out of the collapsed QR panel. A QR glyph
                  rather than a camera: what you point it at is the subject, and
                  it reads as the twin of "Your Social QR" below. */}
              <Button
                color="primary"
                variant="bordered"
                radius="full"
                className="font-semibold"
                startContent={<QrCode className="w-4 h-4 sm:w-5 sm:h-5" />}
                onPress={() => setIsScannerOpen(true)}
              >
                {copyOr('socialqr.scan.button', 'Scan')}
              </Button>
              {/* One tap to mark that you were here. No privacy or pin controls:
                  the server applies this runner's profile defaults, and the
                  Check-ins card "+" is still the way to override either for a
                  single check-in. */}
              <Button
                color="primary"
                variant="bordered"
                radius="full"
                className="font-semibold"
                startContent={<MapPin className="w-4 h-4 sm:w-5 sm:h-5" />}
                onPress={() => setIsQuickCheckInOpen(true)}
              >
                {copyOr('checkin.quick.button', 'Check-in')}
              </Button>
            </div>
            {!user.hasStrava && (
              <a
                href={stravaLinkUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 self-start text-xs sm:text-sm text-secondary hover:text-secondary-600 transition-colors"
              >
                <SiStrava className="w-3.5 h-3.5" />
                Link your Strava account
                <span aria-hidden="true">→</span>
              </a>
            )}
            {session.expires && (
              <p className="font-mono text-xs text-default-400">
                Session: {relativeExpiry(session.expires)} remaining
              </p>
            )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Your Social QR (collapsed by default) - sits directly under the header */}
      {(userData?.hash || userData?.eqr) && (
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
                {/* The "Scan a runner" button that used to sit here moved up to
                    the action bar — the camera is no longer behind this panel. */}
                {userData.social ? (
                  <SocialQrFlair
                    hash={userData.hash}
                    eqrFallback={userData.eqr}
                    social={userData.social}
                    alt="Your QR Code"
                  />
                ) : (
                  <div className="bg-white p-3 rounded-lg">
                    <StyledRunnerQr
                      hash={userData.hash}
                      eqrFallback={userData.eqr}
                      alt="Your QR Code"
                      className="max-w-[220px]"
                    />
                  </div>
                )}
                <p className="text-xs text-default-400 text-center">
                  {copyOr(
                    'socialqr.share.caption',
                    'Scan another runner to connect - you both score. Your QR levels up as your rank climbs.'
                  )}
                </p>
                {userData.hash && (
                  <Button
                    size="sm" color="primary" variant="flat"
                    startContent={<Download className="w-4 h-4" />}
                    onPress={() => setIsCardModalOpen(true)}
                  >
                    {copyOr('qrcard.button', 'Save QR card')}
                  </Button>
                )}
                {userData.hash && (
                  <QrCardModal
                    isOpen={isCardModalOpen}
                    onClose={() => setIsCardModalOpen(false)}
                    hash={userData.hash}
                    name={displayName}
                    bib={userData.runnerCode ? userData.runnerCode.toUpperCase() : null}
                    copy={qrCardCopy}
                  />
                )}
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
        radios={userData?.radios}
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

      {/* Account chrome — ONE stacked accordion. Providers and Services used to
          be two always-open cards in a 2-up grid with Debug as a third card
          below; three stacked disclosure rows in a single card say the same
          thing in a fraction of the height and put Sign Out back above the fold. */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="px-5 py-3 divide-y divide-divider">
          <DisclosureRow
            label="Linked Providers"
            open={isProvidersOpen}
            onToggle={() => setIsProvidersOpen(!isProvidersOpen)}
          >
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
                  return (
                    <a key={name} href={stravaLinkUrl} target="_blank" rel="noopener noreferrer">
                      {chip}
                    </a>
                  );
                }
                return chip;
              })}
            </div>
          </DisclosureRow>

          <DisclosureRow
            label="Authorized Services"
            open={isServicesOpen}
            onToggle={() => setIsServicesOpen(!isServicesOpen)}
          >
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
          </DisclosureRow>

          <DisclosureRow label="Debug" open={isDebugOpen} onToggle={() => setIsDebugOpen(!isDebugOpen)}>
            <div className="space-y-3">
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
          </DisclosureRow>
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

      {/* Action-bar modals live at page level, NOT inside the (collapsible)
          Social QR card — their triggers are always visible now. */}
      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        copy={scanCopy}
        attendanceAvailable={!!userData?.social?.attendance}
      />
      <QuickCheckInModal
        isOpen={isQuickCheckInOpen}
        onClose={() => setIsQuickCheckInOpen(false)}
        checkinPreference={userData?.preferences?.checkinPreference}
      />
      {(LEADERBOARD_SELF_ENABLED || isAdmin) && (
        <YourStandingModal
          isOpen={isStandingOpen}
          onClose={() => setIsStandingOpen(false)}
          displayName={displayName}
        />
      )}
    </div>
  );
}
