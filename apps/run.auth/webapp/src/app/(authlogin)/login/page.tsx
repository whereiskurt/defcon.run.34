'use client';

import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Divider,
  Input,
  Avatar,
} from '@heroui/react';

import type React from 'react';
import { Key, Wand, RefreshCw, ArrowRight } from 'lucide-react';
import { FaDiscord, FaGithub, FaLinkedin } from 'react-icons/fa';
import { useState, useCallback, useRef, useEffect } from 'react';
import { getCsrfToken, useSession, signOut, signIn } from 'next-auth/react';
import { useSearchParams } from 'next/navigation';

const basePath = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
  : '';

function ClientOnlyForm() {
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const [altchaToken, setAltchaToken] = useState<string | null>(null);
  const [altchaVerified, setAltchaVerified] = useState(false);
  const searchParams = useSearchParams();
  const { data: session, status } = useSession();
  const oidcInteraction = searchParams?.get('oidc');
  const hasRedirectedRef = useRef(false);

  const handleAltchaStateChange = useCallback((ev: CustomEvent) => {
    if (ev.detail?.state === 'verified' && ev.detail?.payload) {
      setAltchaToken(ev.detail.payload);
      setAltchaVerified(true);
    } else if (ev.detail?.state === 'verifying') {
      setAltchaVerified(false);
    } else if (ev.detail?.state === 'error' || ev.detail?.state === 'expired') {
      setAltchaVerified(false);
      setAltchaToken(null);
    }
  }, []);

  useEffect(() => {
    const fetchCsrfToken = async () => {
      const token = await getCsrfToken();
      setCsrfToken(token);
    };
    fetchCsrfToken();
    setIsSubmitting(false);
    import('altcha').catch(console.error);
  }, []);

  const handleSwitchUser = async () => {
    setIsSwitching(true);
    await signOut({ redirect: false });
    setIsSwitching(false);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!csrfToken) { setError("CSRF token not ready."); return; }
    if (!email) { setError("Enter your email address."); return; }
    if (!inviteCode) { setError("Enter the invite code."); return; }
    if (!altchaToken || !altchaVerified) { setError("Complete the verification first."); return; }
    try {
      setIsSubmitting(true);
      const res = await fetch(`${basePath}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode, email, csrfToken, altcha: altchaToken }),
      });
      if (!res.ok || res.status != 200) {
        const errorData = await res.json();
        throw new Error(errorData.error);
      } else {
        const verifyUrl = oidcInteraction
          ? `${basePath}/login/verify?email=${email}&oidc=${oidcInteraction}`
          : `${basePath}/login/verify?email=${email}`;
        window.location.href = verifyUrl;
      }
    } catch (error: any) {
      setError(error.message);
      setIsSubmitting(false);
    }
    return false;
  };

  useEffect(() => {
    if (status === 'authenticated' && session && oidcInteraction && !hasRedirectedRef.current) {
      hasRedirectedRef.current = true;
      window.location.href = `${basePath}/api/oidc/interaction/${oidcInteraction}`;
    }
  }, [status, session, oidcInteraction]);

  // Authenticated + OIDC redirect
  if (status === 'authenticated' && session && oidcInteraction) {
    return (
      <div className="space-y-6 animate-fade-up">
        <Card className="glass-card">
          <CardBody className="flex justify-center items-center py-12">
            <p className="text-default-500 font-mono text-sm">Completing login...</p>
          </CardBody>
        </Card>
      </div>
    );
  }

  // Authenticated view
  if (status === 'authenticated' && session) {
    const continueUrl = `${basePath}/`;
    return (
      <div className="space-y-6 animate-fade-up">
        <Card className="glass-card overflow-hidden">
          <CardHeader className="pb-0 pt-5 px-5">
            <div className="flex flex-col gap-1">
              <h1 className="font-museo text-2xl font-bold tracking-tight text-foreground">
                Welcome back
              </h1>
              <p className="text-sm text-default-500">You&apos;re signed in</p>
            </div>
          </CardHeader>
          <Divider className="mt-4" />
          <CardBody className="px-5 py-4">
            <div className="flex items-center gap-4 p-3 rounded-lg bg-content2">
              <Avatar
                src={session.user?.image || undefined}
                name={session.user?.name || session.user?.email || 'U'}
                size="lg"
                isBordered
                color="primary"
              />
              <div className="flex flex-col min-w-0">
                <span className="text-lg font-semibold text-foreground truncate">
                  {session.user?.name || 'User'}
                </span>
                <span className="text-sm text-default-500 truncate">
                  {session.user?.email}
                </span>
              </div>
            </div>
          </CardBody>
          <Divider />
          <CardFooter className="flex flex-col gap-3 px-5 py-4">
            <Button
              as="a"
              href={continueUrl}
              variant="solid"
              color="primary"
              className="w-full font-semibold"
              endContent={<ArrowRight className="w-4 h-4" />}
            >
              Continue as {session.user?.name?.split(' ')[0] || 'User'}
            </Button>
            <Button
              variant="flat"
              color="default"
              className="w-full"
              startContent={<RefreshCw className="w-4 h-4" />}
              onPress={handleSwitchUser}
              isLoading={isSwitching}
            >
              Switch User
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Login form
  return (
    <div className="space-y-6 animate-slide-up">
      {/* Wordmark */}
      <div className="text-center space-y-2">
        <h1 className="font-museo text-4xl font-bold tracking-tight text-foreground">
          defcon<span className="teal-dot">.</span>run
        </h1>
        <p className="font-mono text-xs text-default-400 tracking-widest uppercase">
          DEF CON 34 &mdash; Las Vegas 2026
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <Card className="glass-card overflow-hidden">
          <CardBody className="space-y-5 px-5 py-5">
            <div className="space-y-1.5">
              <label htmlFor="email" className="block text-sm font-medium text-default-600">
                Email Address
              </label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                size="lg"
                variant="bordered"
                classNames={{
                  inputWrapper: "bg-content2 border-default-300 hover:border-primary focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20",
                }}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="inviteCode" className="block text-sm font-medium text-default-600">
                Invite Code
              </label>
              <Input
                id="inviteCode"
                type="text"
                placeholder="hacktheplanet"
                size="lg"
                variant="bordered"
                classNames={{
                  inputWrapper: "bg-content2 border-default-300 hover:border-primary focus-within:border-primary focus-within:ring-1 focus-within:ring-primary/20",
                }}
                startContent={<Key className="h-4 w-4 text-default-400" />}
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value)}
                required
                disabled={isSubmitting}
              />
            </div>

            {/* Altcha verification */}
            <div className="flex justify-center pt-1">
              <altcha-widget
                challengeurl={`${basePath}/api/captcha/challenge`}
                onstatechange={handleAltchaStateChange}
                hidefooter
                hidelogo
              />
            </div>

            {error && (
              <div className="px-3 py-2 rounded-lg bg-danger/10 border border-danger/20">
                <p className="text-danger text-sm text-center">{error}</p>
              </div>
            )}
          </CardBody>
          <Divider />
          <CardFooter className="flex flex-col gap-4 px-5 py-4">
            <Button
              type="submit"
              variant="solid"
              color="primary"
              className="w-full font-semibold"
              size="lg"
              isLoading={isSubmitting}
              isDisabled={isSubmitting || !altchaVerified}
              endContent={!isSubmitting ? <Wand className="w-4 h-4" /> : undefined}
            >
              {isSubmitting ? 'Sending...' : 'Send Magic Link'}
            </Button>

            <div className="relative w-full">
              <Divider />
              <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-content1 px-3 text-xs text-default-400">
                or sign in with
              </span>
            </div>

            <div className="flex gap-3 w-full">
              <Button
                variant="flat"
                className="flex-1"
                startContent={<FaDiscord className="w-4 h-4" />}
                onPress={() => signIn('discord', {
                  callbackUrl: oidcInteraction
                    ? `${basePath}/login?oidc=${oidcInteraction}`
                    : `${basePath}/`
                })}
              >
                Discord
              </Button>
              <Button
                variant="flat"
                className="flex-1"
                startContent={<FaGithub className="w-4 h-4" />}
                onPress={() => signIn('github', {
                  callbackUrl: oidcInteraction
                    ? `${basePath}/login?oidc=${oidcInteraction}`
                    : `${basePath}/`
                })}
              >
                GitHub
              </Button>
              <Button
                variant="flat"
                className="flex-1"
                startContent={<FaLinkedin className="w-4 h-4" />}
                onPress={() => signIn('linkedin', {
                  callbackUrl: oidcInteraction
                    ? `${basePath}/login?oidc=${oidcInteraction}`
                    : `${basePath}/`
                })}
              >
                LinkedIn
              </Button>
            </div>
          </CardFooter>
        </Card>
      </form>
    </div>
  );
}

export default function UnlockForm() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="h-10 w-48 mx-auto rounded bg-content2 animate-pulse" />
          <div className="h-4 w-64 mx-auto rounded bg-content2 animate-pulse" />
        </div>
        <div className="glass-card rounded-xl p-6">
          <div className="space-y-4">
            <div className="h-12 rounded bg-content2 animate-pulse" />
            <div className="h-12 rounded bg-content2 animate-pulse" />
            <div className="h-10 rounded bg-content2 animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  return <ClientOnlyForm />;
}
