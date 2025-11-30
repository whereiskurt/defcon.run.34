'use client';

import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Divider,
  Link,
  Input,
} from '@heroui/react';

import type React from 'react';
import { fontMuseo } from '@/config/fonts';
import BlurPulseBackground from '@/components/BlurPulseBackground';
import { GlitchLabel, RainbowText } from '@/components/text-effects';
import { Text } from '@components/text-effects/Common';
import { Heading } from '@components/text-effects/Common';

import { Key, Wand } from 'lucide-react';
import { useTheme } from 'next-themes';
import { useState } from 'react';
import { getCsrfToken } from "next-auth/react"
import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

import { FaDiscord, FaGithub } from 'react-icons/fa';
import { signIn } from 'next-auth/react';

// Separate component for client-side only rendering
function ClientOnlyForm() {
  const [email, setEmail] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isInviteCodeFocused, setIsInviteCodeFocused] = useState(false);
  const [isEmailFocused, setIsEmailFocused] = useState(false);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  const searchParams = useSearchParams();

  // Check for OIDC interaction ID in URL params
  const oidcInteraction = searchParams?.get('oidc');

  useEffect(() => {
    setMounted(true);
    const fetchCsrfToken = async () => {
      const token = await getCsrfToken();
      setCsrfToken(token);
    };
    fetchCsrfToken();
    setIsSubmitting(false);
  }, []);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!csrfToken || csrfToken === '') {
      setError("CSRF token not handled or set properly.")
      return
    }
    if (!email || email === '') {
      setError("Provide an email to receive 🪄 magic link.")
      return
    }
    if (!inviteCode || inviteCode === '') {
      setError("Provide the invite code.")
      return
    }
    try {
      setIsSubmitting(true)
      const res = await fetch("/api/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ inviteCode, email, csrfToken }),
      })
      if (!res.ok || res.status != 200) {
        const errorData = await res.json()
        throw new Error(errorData.error)
      } else {
        // Include OIDC interaction ID if present (for OIDC flow)
        const verifyUrl = oidcInteraction
          ? `/login/verify?email=${email}&oidc=${oidcInteraction}`
          : `/login/verify?email=${email}`;
        window.location.href = verifyUrl;
      }
    } catch (error: any) {
      setError(error.message)
      setIsSubmitting(false)
    }
    return false
  }

  // Use a safe default in case we're rendering on the server
  const isDarkTheme = mounted && resolvedTheme === 'dark';

  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
      <BlurPulseBackground imagePath={`/assets/bunny-face-${isDarkTheme ? 'dark' : 'light'}.svg`} />
      <div className="z-10 w-full max-w-md" >
        <form onSubmit={handleSubmit} className="w-full">
          <Card className={`shadow-lg ${isDarkTheme ? 'bg-gray-900/50' : 'bg-white/50'}`}>
            <CardHeader>
              <div className="flex flex-col">
                <Heading level={1}>
                  {isSubmitting ? (
                    <RainbowText text={'Welcome!'} />
                  ) : (
                    'Welcome!'
                  )}
                </Heading>
                <Text variant="small" className={isDarkTheme ? 'text-gray-300' : 'text-black'}>
                  We don&apos;t store passwords but require an email address.
                </Text>
              </div>
            </CardHeader>
            <Divider />
            <CardBody className="space-y-6">
              <div className="space-y-3 w-full">
                <Heading level={4}>
                  <label
                    htmlFor="email"
                    className={`block text-lg font-medium ${isDarkTheme ? 'text-white' : 'text-black'}`}
                  >
                    {isEmailFocused ? (
                      <RainbowText text='Email Address' />
                    ) : (
                      'Email Address'
                    )}
                  </label>
                </Heading>
                <div className="relative w-full">
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    className={`text-lg w-full ${isDarkTheme ? 'text-white' : 'text-black'}`}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setIsEmailFocused(true)}
                    onBlur={() => setIsEmailFocused(false)}
                    required
                    disabled={isSubmitting}
                  />
                </div>
              </div>

              <div className="space-y-3 w-full">
                <label
                  htmlFor="inviteCode"
                  className={`block text-lg font-medium pt-2 ${fontMuseo.className} ${isDarkTheme ? 'text-white' : 'text-black'}`}
                >
                  {isInviteCodeFocused ? (
                    <GlitchLabel>Invite Codes</GlitchLabel>
                  ) : (
                    'Invite Codes'
                  )}
                </label>
                <div className="relative w-full">
                  <div className={`absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none ${isDarkTheme ? 'text-gray-400' : 'text-gray-500'}`}>
                    <Key className="h-5 w-5" />
                  </div>
                  <Input
                    id="inviteCode"
                    type="text"
                    placeholder="hacktheplanet"
                    className="text-lg w-full"
                    value={inviteCode}
                    onChange={(e) => setInviteCode(e.target.value)}
                    onFocus={() => setIsInviteCodeFocused(true)}
                    onBlur={() => setIsInviteCodeFocused(false)}
                    required
                    disabled={isSubmitting}
                  />
                </div>
              {error && <div><p className="error text-red-600 text-center text-xl" >{error}</p></div>}
              </div>
            </CardBody>
            <Divider className="mt-2" />
            <CardFooter className="justify-center">
              <Button
                type="submit"
                variant="solid"
                color="primary"
                className="text-lg font-semibold w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <GlitchLabel className={fontMuseo.className}>
                    Processing
                  </GlitchLabel>
                ) : (
                  <>
                    Send Magic Link <Wand />
                  </>
                )}
              </Button>

            </CardFooter>
                <div className="w-full flex justify-center">
                 <Text variant="large" className="pt-2 text-center">
                  No email? Try{' '}
                  <Link
                    size="lg"
                    href="#"
                    onPress={() => signIn('discord', {
                      callbackUrl: oidcInteraction
                        ? `/api/oidc/interaction/${oidcInteraction}`
                        : '/'
                    })}
                    >
                    &nbsp; <FaDiscord />
                    Discord
                  </Link>{' '}
                  or
                  <Link
                    size="lg"
                    href="#"
                    onPress={() => signIn('github', {
                      callbackUrl: oidcInteraction
                        ? `/api/oidc/interaction/${oidcInteraction}`
                        : '/'
                    })}
                    >
                    &nbsp; <FaGithub />
                    Github
                  </Link>
                  </Text>
                </div>  

              
          </Card>
        </form>
      </div>
    </div>
  );
}

export default function UnlockForm() {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Only render the form client-side to avoid hydration mismatch
  if (!mounted) {
    return <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
      <div className="z-10 w-full max-w-md">
        <div className="bg-white/50 dark:bg-gray-900/50 shadow-lg rounded-lg p-6">
          <p className="text-center">Loading...</p>
        </div>
      </div>
    </div>;
  }
  
  return <ClientOnlyForm />;
}
