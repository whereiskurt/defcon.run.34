'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Card, CardBody, Divider, Skeleton } from '@heroui/react';
import MeshtasticRadios from '@/components/profile/MeshtasticRadios';
import { apiUrl } from '@/lib/api';

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
  meshtasticRadios?: any[];
  checkIns?: any[];
  checkInCount?: number;
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

export default function ProfilePage() {
  const { data: session, status } = useSession();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  if (status === 'loading' || loading) {
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

  const displayName = userData?.displayname || userData?.displayName || session.user?.name || 'User';

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-fade-up">
      {/* Page title */}
      <h1 className="font-museo text-2xl font-bold tracking-tight text-foreground">
        Profile
      </h1>

      {/* Account Summary */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="flex flex-row items-center gap-3 px-5 py-4">
          <div>
            <p className="font-museo text-lg font-bold text-foreground">{displayName}</p>
            {userData?.mqttUsername && (
              <p className="font-mono text-xs text-default-400">{userData.mqttUsername}</p>
            )}
          </div>
          <div className="ml-auto">
            <a href="/dashboard" className="text-xs text-primary hover:underline">
              Dashboard
            </a>
          </div>
        </CardBody>
      </Card>

      {/* Quotas */}
      {userData?.quotas && (
        <Card className="glass-card overflow-hidden">
          <CardBody className="px-5 py-4 space-y-5">
            <h3 className="font-museo text-base font-bold text-foreground">Quotas</h3>
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
          </CardBody>
        </Card>
      )}

      {/* Meshtastic Radios */}
      <MeshtasticRadios
        radios={userData?.meshtasticRadios}
        quotas={userData?.quotas}
        onUpdate={fetchUserData}
      />

      {/* QR Code */}
      {userData?.eqr && (
        <Card className="glass-card overflow-hidden">
          <CardBody className="px-5 py-4 space-y-3">
            <h3 className="font-museo text-base font-bold text-foreground">Your Social QR</h3>
            <div className="flex flex-col items-center">
              <div className="bg-white p-3 rounded-lg">
                <img
                  src={userData.eqr}
                  alt="Your QR Code"
                  className="max-w-[220px]"
                />
              </div>
              <p className="text-xs text-default-400 mt-3 text-center">
                Share this QR code to connect with other runners
              </p>
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
