'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Divider, Skeleton } from '@heroui/react';
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
      <div className="max-w-2xl mx-auto py-4 space-y-4">
        <Card>
          <CardHeader>
            <Skeleton className="h-4 w-40 rounded-lg" />
          </CardHeader>
          <Divider />
          <CardBody>
            <Skeleton className="h-20 w-full rounded-lg" />
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
    <div className="max-w-2xl mx-auto py-4 space-y-4">
      {/* Account Summary */}
      <Card>
        <CardBody className="flex flex-row items-center gap-3 py-3">
          <div>
            <p className="text-lg font-semibold">{displayName}</p>
            {userData?.mqttUsername && (
              <p className="font-mono text-xs text-default-400">{userData.mqttUsername}</p>
            )}
          </div>
          <div className="ml-auto">
            <a href="/dashboard" className="text-xs text-primary hover:underline">
              View identity on Dashboard
            </a>
          </div>
        </CardBody>
      </Card>

      {/* Quotas */}
      {userData?.quotas && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Quotas</h3>
          </CardHeader>
          <Divider />
          <CardBody className="space-y-4">
            {quotaGroups.map((group) => (
              <div key={group.label}>
                <p className="text-xs uppercase tracking-wide text-default-400 mb-2">{group.label}</p>
                <div className="grid grid-cols-3 gap-2">
                  {group.items.map((item) => (
                    <div key={item.key} className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas![item.key]?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas![item.key]?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">{item.label}</p>
                    </div>
                  ))}
                </div>
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

      {/* QR Code Card */}
      {userData?.eqr && (
        <Card>
          <CardHeader>
            <h3 className="text-lg font-semibold">Your Social QR</h3>
          </CardHeader>
          <Divider />
          <CardBody className="flex items-center justify-center">
            <img
              src={userData.eqr}
              alt="Your QR Code"
              className="max-w-[250px]"
            />
            <p className="text-sm text-default-500 mt-2 text-center">
              Share this QR code to connect with other runners
            </p>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
