'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Card, CardBody, CardHeader, Avatar, Divider, Skeleton, Chip } from '@heroui/react';
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
  quotas?: {
    file_upload?: QuotaInfo;
    gpx_upload?: QuotaInfo;
    gpx_save?: QuotaInfo;
    gpx_share?: QuotaInfo;
    photo_upload?: QuotaInfo;
    strava_sync?: QuotaInfo;
    checkin?: QuotaInfo;
    meshtastic_radio?: QuotaInfo;
    qr_scan?: QuotaInfo;
    displayname_change?: QuotaInfo;
    qr_sheet?: QuotaInfo;
  };
  preferences?: {
    checkinPreference?: string;
  };
  checkin_preference?: string;
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
      <div className="flex flex-col gap-4">
        <Card className="w-full">
          <CardHeader className="flex gap-3">
            <Skeleton className="w-12 h-12 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-32 rounded-lg" />
              <Skeleton className="h-3 w-48 rounded-lg" />
            </div>
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
    <div className="container mx-auto py-4 space-y-4">
      {/* User Details Card */}
      <Card className="w-full">
        <CardHeader className="flex gap-3">
          <Avatar
            src={session.user?.image || undefined}
            size="lg"
            isBordered
            color="primary"
          />
          <div className="flex flex-col">
            <p className="text-lg font-semibold">{displayName}</p>
            <p className="text-small text-default-500">{session.user?.email}</p>
            {userData?.mqttUsername && (
              <p className="text-xs text-default-400">MQTT: {userData.mqttUsername}</p>
            )}
          </div>
        </CardHeader>
        <Divider />
        <CardBody>
          <div className="flex flex-col gap-4">
            {/* Linked Services */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Linked Services</h3>
              <div className="flex flex-wrap gap-2">
                {session.user?.linkedProviders?.length > 0 ? (
                  session.user.linkedProviders.map((provider: string) => (
                    <Chip
                      key={provider}
                      color={
                        provider === 'strava' ? 'warning' :
                        provider === 'discord' ? 'secondary' :
                        provider === 'github' ? 'default' : 'primary'
                      }
                      variant="flat"
                      size="sm"
                      className="capitalize"
                    >
                      {provider}
                    </Chip>
                  ))
                ) : (
                  <p className="text-default-500">No linked services</p>
                )}
              </div>
            </div>

            <Divider />

            {/* Quota Info */}
            {userData?.quotas && (
              <>
                <div>
                  <h3 className="text-lg font-semibold mb-2">Quota</h3>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                    {/* Activity Stats */}
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.checkInCount ?? userData.checkIns?.length ?? 0}
                      </p>
                      <p className="text-xs text-default-500">Total Check-ins</p>
                    </div>
                    {/* Upload Quotas */}
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas.file_upload?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas.file_upload?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">File Uploads</p>
                    </div>
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas.gpx_upload?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas.gpx_upload?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">GPX Uploads</p>
                    </div>
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas.gpx_save?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas.gpx_save?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">GPX Saves</p>
                    </div>
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas.gpx_share?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas.gpx_share?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">GPX Shares</p>
                    </div>
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas.photo_upload?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas.photo_upload?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">Photo Uploads</p>
                    </div>
                    {/* Activity Quotas */}
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas.checkin?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas.checkin?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">Check-ins Left</p>
                    </div>
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas.strava_sync?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas.strava_sync?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">Strava Syncs</p>
                    </div>
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas.meshtastic_radio?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas.meshtastic_radio?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">Radio Slots</p>
                    </div>
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas.qr_scan?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas.qr_scan?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">QR Scans</p>
                    </div>
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas.displayname_change?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas.displayname_change?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">Name Changes</p>
                    </div>
                    <div className="text-center p-2 bg-default-100 rounded-lg">
                      <p className="text-2xl font-bold text-primary">
                        {userData.quotas.qr_sheet?.remaining ?? 0}
                        <span className="text-sm text-default-400">/{userData.quotas.qr_sheet?.initial ?? 0}</span>
                      </p>
                      <p className="text-xs text-default-500">QR Sheets</p>
                    </div>
                  </div>
                </div>
                <Divider />
              </>
            )}

            {/* Session Info */}
            <div>
              <h3 className="text-lg font-semibold mb-2">Session Info</h3>
              <div className="text-sm text-default-500 space-y-1">
                <p>User ID: <span className="font-mono text-xs">{session.user?.id || 'N/A'}</span></p>
                <p>Session Version: {session.user?.sessionVersion || 'N/A'}</p>
                <p>Check-in Preference: {userData?.checkin_preference || userData?.preferences?.checkinPreference || 'public'}</p>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Meshtastic Radios */}
      <MeshtasticRadios
        radios={userData?.meshtasticRadios}
        quotas={userData?.quotas}
        onUpdate={fetchUserData}
      />

      {/* QR Code Card */}
      {userData?.eqr && (
        <Card className="w-full">
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
