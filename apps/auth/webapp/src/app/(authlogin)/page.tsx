'use client';

import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  Button,
  Chip,
  Avatar,
} from '@heroui/react';

import { useEffect, useState } from 'react';
import { useTheme } from 'next-themes';
import { useSession, signOut } from 'next-auth/react';
import BlurPulseBackground from '@/components/BlurPulseBackground';
import { RainbowText } from '@/components/text-effects';
import { Text, Heading } from '@components/text-effects/Common';

import { LogOut, User, Mail, Shield, Clock, CheckCircle, Layers, ChevronRight, ChevronDown } from 'lucide-react';

function DashboardContent() {
  const [mounted, setMounted] = useState(false);
  const [isClaimsOpen, setIsClaimsOpen] = useState(false);
  const [isRawSessionOpen, setIsRawSessionOpen] = useState(false);
  const { resolvedTheme } = useTheme();
  const { data: session, status } = useSession();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDarkTheme = mounted && resolvedTheme === 'dark';

  // Services are now included in the session directly
  const services = (session?.user as { services?: string[] })?.services || [];

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
        <div className="z-10 w-full max-w-md">
          <div className="bg-white/50 dark:bg-gray-900/50 shadow-lg rounded-lg p-6">
            <p className="text-center">Loading session...</p>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated' || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
        <BlurPulseBackground imagePath={`/login/bunny-face-${isDarkTheme ? 'dark' : 'light'}.svg`} />
        <div className="z-10 w-full max-w-md">
          <Card className={`shadow-lg ${isDarkTheme ? 'bg-gray-900/50' : 'bg-white/50'}`}>
            <CardHeader>
              <div className="flex flex-col">
                <Heading level={1}>Not Authenticated</Heading>
                <Text variant="small" className={isDarkTheme ? 'text-gray-300' : 'text-black'}>
                  You need to log in to view this page.
                </Text>
              </div>
            </CardHeader>
            <Divider />
            <CardBody className="flex justify-center">
              <Button
                as="a"
                href="/login"
                variant="solid"
                color="primary"
                className="text-lg font-semibold"
              >
                Go to Login
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    );
  }

  const { user } = session;

  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
      <BlurPulseBackground imagePath={`/login/bunny-face-${isDarkTheme ? 'dark' : 'light'}.svg`} />
      <div className="z-10 w-full max-w-lg">
        <Card className={`shadow-lg ${isDarkTheme ? 'bg-gray-900/50' : 'bg-white/50'}`}>
          <CardHeader>
            <div className="flex flex-col w-full">
              <div className="flex items-center justify-between w-full">
                <Heading level={1}>
                  <RainbowText text="Session Info" />
                </Heading>
                <Chip
                  color="success"
                  variant="flat"
                  startContent={<CheckCircle className="w-4 h-4" />}
                >
                  Authenticated
                </Chip>
              </div>
              <Text variant="small" className={isDarkTheme ? 'text-gray-300' : 'text-black'}>
                Proof of successful login - debug view
              </Text>
            </div>
          </CardHeader>
          <Divider />
          <CardBody className="space-y-4">
            {/* User Avatar and Name */}
            <div className="flex items-center gap-4 p-3 rounded-lg bg-default-100">
              <Avatar
                src={user?.image || undefined}
                name={user?.name || user?.email || 'U'}
                size="lg"
                isBordered
                color="primary"
              />
              <div className="flex flex-col">
                <span className={`text-lg font-semibold ${isDarkTheme ? 'text-white' : 'text-black'}`}>
                  {user?.name || 'Unknown User'}
                </span>
                <span className={`text-sm ${isDarkTheme ? 'text-gray-400' : 'text-gray-600'}`}>
                  Logged in successfully
                </span>
              </div>
            </div>

            {/* Session Details */}
            <div className="space-y-3">
              <button
                onClick={() => setIsClaimsOpen(!isClaimsOpen)}
                className={`flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80 transition-opacity`}
              >
                {isClaimsOpen ? (
                  <ChevronDown className={`w-5 h-5 ${isDarkTheme ? 'text-white' : 'text-black'}`} />
                ) : (
                  <ChevronRight className={`w-5 h-5 ${isDarkTheme ? 'text-white' : 'text-black'}`} />
                )}
                <Heading level={4} className={isDarkTheme ? 'text-white' : 'text-black'}>
                  User Claims
                </Heading>
              </button>

              {isClaimsOpen && (
                <div className="space-y-2">
                {user?.id && (
                  <div className="flex items-center gap-3 p-2 rounded-md bg-default-50">
                    <Shield className={`w-5 h-5 ${isDarkTheme ? 'text-blue-400' : 'text-blue-600'}`} />
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className={`text-xs uppercase tracking-wide ${isDarkTheme ? 'text-gray-400' : 'text-gray-500'}`}>
                        User ID
                      </span>
                      <span className={`text-sm font-mono truncate ${isDarkTheme ? 'text-white' : 'text-black'}`}>
                        {user.id}
                      </span>
                    </div>
                  </div>
                )}

                {user?.name && (
                  <div className="flex items-center gap-3 p-2 rounded-md bg-default-50">
                    <User className={`w-5 h-5 ${isDarkTheme ? 'text-green-400' : 'text-green-600'}`} />
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className={`text-xs uppercase tracking-wide ${isDarkTheme ? 'text-gray-400' : 'text-gray-500'}`}>
                        Name
                      </span>
                      <span className={`text-sm truncate ${isDarkTheme ? 'text-white' : 'text-black'}`}>
                        {user.name}
                      </span>
                    </div>
                  </div>
                )}

                {user?.email && (
                  <div className="flex items-center gap-3 p-2 rounded-md bg-default-50">
                    <Mail className={`w-5 h-5 ${isDarkTheme ? 'text-purple-400' : 'text-purple-600'}`} />
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className={`text-xs uppercase tracking-wide ${isDarkTheme ? 'text-gray-400' : 'text-gray-500'}`}>
                        Email
                      </span>
                      <span className={`text-sm truncate ${isDarkTheme ? 'text-white' : 'text-black'}`}>
                        {user.email}
                      </span>
                    </div>
                  </div>
                )}

                {session.expires && (
                  <div className="flex items-center gap-3 p-2 rounded-md bg-default-50">
                    <Clock className={`w-5 h-5 ${isDarkTheme ? 'text-orange-400' : 'text-orange-600'}`} />
                    <div className="flex flex-col flex-1 min-w-0">
                      <span className={`text-xs uppercase tracking-wide ${isDarkTheme ? 'text-gray-400' : 'text-gray-500'}`}>
                        Session Expires
                      </span>
                      <span className={`text-sm truncate ${isDarkTheme ? 'text-white' : 'text-black'}`}>
                        {new Date(session.expires).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )}

                {/* Services */}
                <div className="flex items-start gap-3 p-2 rounded-md bg-default-50">
                  <Layers className={`w-5 h-5 mt-0.5 ${isDarkTheme ? 'text-cyan-400' : 'text-cyan-600'}`} />
                  <div className="flex flex-col flex-1 min-w-0">
                    <span className={`text-xs uppercase tracking-wide ${isDarkTheme ? 'text-gray-400' : 'text-gray-500'}`}>
                      Authorized Services
                    </span>
                    {services.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mt-1">
                        {services.map((service) => (
                          <Chip
                            key={service}
                            size="sm"
                            variant="flat"
                            color={service === 'admin' ? 'danger' : service === 'gpx' ? 'secondary' : 'primary'}
                          >
                            {service}
                          </Chip>
                        ))}
                      </div>
                    ) : (
                      <span className={`text-sm ${isDarkTheme ? 'text-gray-400' : 'text-gray-500'}`}>
                        No services assigned
                      </span>
                    )}
                  </div>
                </div>
              </div>
              )
            }
            </div>

            {/* Raw Session Data */}
            <div className="space-y-2">
              <button
                onClick={() => setIsRawSessionOpen(!isRawSessionOpen)}
                className={`flex items-center gap-2 w-full text-left cursor-pointer hover:opacity-80 transition-opacity`}
              >
                {isRawSessionOpen ? (
                  <ChevronDown className={`w-5 h-5 ${isDarkTheme ? 'text-white' : 'text-black'}`} />
                ) : (
                  <ChevronRight className={`w-5 h-5 ${isDarkTheme ? 'text-white' : 'text-black'}`} />
                )}
                <Heading level={4} className={isDarkTheme ? 'text-white' : 'text-black'}>
                  Raw Session Object
                </Heading>
              </button>
              {isRawSessionOpen && (
                <pre className={`p-3 rounded-md text-xs overflow-x-auto ${isDarkTheme ? 'bg-gray-800 text-gray-200' : 'bg-gray-100 text-gray-800'}`}>
                  {JSON.stringify(session, null, 2)}
                </pre>
              )}
            </div>
          </CardBody>
          <Divider />
          <CardBody className="flex justify-center">
            <Button
              variant="flat"
              color="danger"
              className="text-lg font-semibold"
              startContent={<LogOut className="w-5 h-5" />}
              onPress={() => signOut({ callbackUrl: '/login' })}
            >
              Sign Out
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
        <div className="z-10 w-full max-w-md">
          <div className="bg-white/50 dark:bg-gray-900/50 shadow-lg rounded-lg p-6">
            <p className="text-center">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return <DashboardContent />;
}
