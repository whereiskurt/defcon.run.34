"use client";

import {
  Card,
  CardBody,
  CardHeader,
  Divider,
  Button,
  Chip,
  Avatar,
} from "@heroui/react";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { useSession, signIn, signOut } from "next-auth/react";
import { useLogout } from "@/hooks/useLogout";
import BlurPulseBackground from "@/components/BlurPulseBackground";
import { RainbowText } from "@/components/text-effects";
import { Text, Heading } from "@components/text-effects/Common";

import {
  LogOut,
  User,
  Mail,
  Shield,
  Clock,
  CheckCircle,
  Layers,
  ChevronRight,
  ChevronDown,
  Link2,
  RefreshCw,
} from "lucide-react";
import { SiStrava, SiDiscord, SiGithub } from "react-icons/si";

// Build callback URL with region prefix for production
const isDev = process.env.NODE_ENV !== "production";
const REGION_SHORT = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
const dashboardUrl = isDev ? "/dashboard" : `/${REGION_SHORT}/dashboard`;

function DashboardContent() {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDarkTheme = mounted && resolvedTheme === "dark";

  return (
    <div className="flex min-h-screen items-center justify-center p-4 md:p-8">
      <BlurPulseBackground
        imagePath={`/logo/bunny-face-${isDarkTheme ? "dark" : "light"}.svg`}
      />
      <div className="z-10 w-full max-w-md">
        <Card
          className={`shadow-lg ${
            isDarkTheme ? "bg-gray-900/50" : "bg-white/50"
          }`}
        >
          <CardHeader>
            <div className="flex flex-col">
              <Heading level={1}>Not Authenticated</Heading>
              <Text
                variant="small"
                className={isDarkTheme ? "text-gray-300" : "text-black"}
              >
                You need to log in to view this page.
              </Text>
            </div>
          </CardHeader>
          <Divider />
          <CardBody className="flex justify-center">
            <Button
              variant="solid"
              color="primary"
              className="text-lg font-semibold"
              onPress={() =>
                signIn("run.defcon.run", { callbackUrl: dashboardUrl })
              }
            >
              Go to Login
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
