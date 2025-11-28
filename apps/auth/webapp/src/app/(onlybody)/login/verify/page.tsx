'use client';
import {
  addToast,
  Button,
  Input,
  InputOtp,
  Link,
  ToastProvider,
} from '@heroui/react';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, Suspense } from 'react';
import { FaDiscord, FaGithub } from 'react-icons/fa';
import { FaMobileScreenButton } from 'react-icons/fa6';
import { MdOutlineMarkEmailRead } from 'react-icons/md';
import React from 'react';
import { signIn } from 'next-auth/react';

import { Text } from '@components/text-effects/Common';
import { Heading } from '@components/text-effects/Common';

// Separate client component to handle search params
function EmailVerificationForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState<string>('');
  const [code, setCode] = useState<string>('');

  useEffect(() => {
    addToast({
      title: 'Email Sent',
      description: 'You should receive an email with a magic link shortly.',
      color: 'success',
      variant: 'flat',
    });

    const emailQuery = searchParams
      .get('email')
      ?.replace(' ', '%2B')
      .replace('+', '%2B');

    setEmail(emailQuery || '');
  }, [searchParams]);

  const handleValidation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const url = `/api/auth/callback/nodemailer?token=${code}&email=${email}&callbackUrl=/`;
    window.location.href = url;
    return false;
  };

  const handlePress = (e: any) => {
    // Prevent default if possible (for compatibility)
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const url = `/api/auth/callback/nodemailer?token=${code}&email=${email}&callbackUrl=/`;
    window.location.href = url;
  };

  return (
    <>
      {email && (
        <Text variant="large">
          Check <b>{email.replace('%2B', '+')}</b>
        </Text>
      )}
      <form onSubmit={handleValidation}>
        <InputOtp
          autoFocus={true}
          name="code"
          type="code"
          placeholder="XXXXXX"
          description="Enter Code"
          length={6}
          title="Poop"
          value={code}
          onChange={(e) => setCode((e.target as HTMLInputElement).value)}
        />

        <Button
          className="mt-4 mb-2"
          type="submit"
          variant="solid"
          color="primary"
          onPress={handlePress}
        >
          <FaMobileScreenButton size={24} />
          <Heading level={4}>Validate</Heading>
        </Button>
      </form>
    </>
  );
}

// Main page component
export default function EmailLogin() {
  return (
    <div>
      <ToastProvider placement="bottom-center" />
      <div className="min-h-screen flex flex-col items-center text-center px-4">
        <MdOutlineMarkEmailRead className="text-green-500" size={48} />
        <Heading level={2}>Email Queued</Heading>
        <Text variant="xxlarge">You will receive an email shortly.</Text>

        <Suspense fallback={<Text variant="large">Check account</Text>}>
          <EmailVerificationForm />
        </Suspense>

        <Text variant="large" className="pt-2">
          No email? Try{' '}
          <Link
            size="lg"
            href="#"
            onPress={() => signIn('discord', { callbackUrl: '/dashboard' })}
          >
            &nbsp; <FaDiscord />
            Discord
          </Link>{' '}
          or
          <Link
            size="lg"
            href="#"
            onPress={() => signIn('github', { callbackUrl: '/dashboard' })}
          >
            &nbsp; <FaGithub />
            Github
          </Link>
        </Text>
      </div>
    </div>
  );
}
