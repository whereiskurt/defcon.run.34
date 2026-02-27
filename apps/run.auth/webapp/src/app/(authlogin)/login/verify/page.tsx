'use client';

import {
  addToast,
  Button,
  InputOtp,
  ToastProvider,
  Card,
  CardBody,
  Divider,
} from '@heroui/react';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { FaDiscord, FaGithub } from 'react-icons/fa';
import { FaMobileScreenButton } from 'react-icons/fa6';
import { Mail, ArrowLeft } from 'lucide-react';
import React from 'react';
import { signIn } from 'next-auth/react';

const basePath = process.env.NODE_ENV === 'production'
  ? `/${process.env.NEXT_PUBLIC_REGION_SHORT || 'use1'}`
  : '';

function OAuthButtons({ oidcInteraction }: { oidcInteraction: string | null }) {
  const getCallbackUrl = () => {
    if (oidcInteraction) {
      return `${basePath}/api/oidc/interaction/${oidcInteraction}`;
    }
    return `${basePath}/`;
  };

  return (
    <div className="flex gap-3 w-full">
      <Button
        variant="flat"
        className="flex-1"
        size="sm"
        startContent={<FaDiscord className="w-3.5 h-3.5" />}
        onPress={() => signIn('discord', { callbackUrl: getCallbackUrl() })}
      >
        Discord
      </Button>
      <Button
        variant="flat"
        className="flex-1"
        size="sm"
        startContent={<FaGithub className="w-3.5 h-3.5" />}
        onPress={() => signIn('github', { callbackUrl: getCallbackUrl() })}
      >
        GitHub
      </Button>
    </div>
  );
}

function EmailVerificationForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState<string>('');
  const [code, setCode] = useState<string>('');
  const oidcInteraction = searchParams?.get('oidc');

  useEffect(() => {
    addToast({
      title: 'Email Sent',
      description: 'Check your inbox for a verification code.',
      color: 'success',
      variant: 'flat',
    });

    const emailQuery = searchParams
      ?.get('email')
      ?.replace(' ', '%2B')
      .replace('+', '%2B');

    setEmail(emailQuery || '');
  }, [searchParams]);

  const getCallbackUrl = () => {
    if (oidcInteraction) {
      return `${basePath}/api/oidc/interaction/${oidcInteraction}`;
    }
    return `${basePath}/`;
  };

  const handleValidation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const callbackUrl = encodeURIComponent(getCallbackUrl());
    const url = `${basePath}/api/auth/callback/nodemailer?token=${code}&email=${email}&callbackUrl=${callbackUrl}`;
    window.location.href = url;
    return false;
  };

  const handlePress = (e: any) => {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const callbackUrl = encodeURIComponent(getCallbackUrl());
    const url = `${basePath}/api/auth/callback/nodemailer?token=${code}&email=${email}&callbackUrl=${callbackUrl}`;
    window.location.href = url;
  };

  return (
    <div className="space-y-6 animate-fade-up">
      {/* Wordmark */}
      <div className="text-center space-y-2">
        <h1 className="font-museo text-4xl font-bold tracking-tight text-foreground">
          defcon<span className="teal-dot">.</span>run
        </h1>
      </div>

      <Card className="glass-card overflow-hidden">
        <CardBody className="space-y-5 px-5 py-5">
          {/* Status header */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center flex-shrink-0">
              <Mail className="w-5 h-5 text-success" />
            </div>
            <div>
              <h2 className="font-museo text-lg font-bold text-foreground">Check your email</h2>
              {email && (
                <p className="text-sm text-default-500">
                  Sent to <span className="font-mono text-foreground">{email.replace('%2B', '+')}</span>
                </p>
              )}
            </div>
          </div>

          <Divider />

          {/* Code input */}
          <form onSubmit={handleValidation} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-default-600">
                Verification Code
              </label>
              <div className="flex justify-center">
                <InputOtp
                  autoFocus={true}
                  name="code"
                  type="code"
                  placeholder="XXXXXX"
                  length={6}
                  value={code}
                  onChange={(e) => setCode((e.target as HTMLInputElement).value)}
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="solid"
              color="primary"
              className="w-full font-semibold"
              onPress={handlePress}
              startContent={<FaMobileScreenButton className="w-4 h-4" />}
            >
              Verify Code
            </Button>
          </form>

          <div className="relative w-full">
            <Divider />
            <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-content1 px-3 text-xs text-default-400">
              or try another method
            </span>
          </div>

          <OAuthButtons oidcInteraction={oidcInteraction ?? null} />

          <div className="text-center">
            <Button
              as="a"
              href={`${basePath}/login`}
              variant="light"
              size="sm"
              className="text-default-400"
              startContent={<ArrowLeft className="w-3.5 h-3.5" />}
            >
              Back to login
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export default function EmailLogin() {
  return (
    <>
      <ToastProvider placement="bottom-center" />
      <Suspense
        fallback={
          <div className="space-y-6">
            <div className="text-center">
              <div className="h-10 w-48 mx-auto rounded bg-content2 animate-pulse" />
            </div>
            <div className="glass-card rounded-xl p-6">
              <div className="h-32 rounded bg-content2 animate-pulse" />
            </div>
          </div>
        }
      >
        <EmailVerificationForm />
      </Suspense>
    </>
  );
}
