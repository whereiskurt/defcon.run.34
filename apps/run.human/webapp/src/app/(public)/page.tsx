"use client";

import {
  Card,
  CardBody,
  CardFooter,
  Button,
  Image,
  Spinner,
} from "@heroui/react";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn, useSession } from "next-auth/react";
import { ChevronRight, MapPin, Footprints, Camera } from "lucide-react";

import { EggTrigger } from "@/components/EggTrigger";
import SocialQRRow from "@/components/profile/SocialQRRow";
import { useCopy } from "@/components/CopyProvider";
import QuickCheckInModal from "@/components/QuickCheckInModal";
import QrScannerModal from "@/components/qr/QrScannerModal";
import { DEFAULT_STRAVA_GROUP_URL, DEFAULT_SIGNAL_GROUP_URL } from "@/lib/social-groups";
import { gpxMapUrl } from "@/lib/gpx-map";
import { gpxAddRunUrl } from "@/lib/gpx-addrun";
import { buildScannerCopy } from "@/lib/scanner-copy";
import { apiUrl } from "@/lib/api";

const isDev = process.env.NODE_ENV !== "production";
const region = process.env.NEXT_PUBLIC_REGION_SHORT || "use1";
// Region-prefixed URLs. Needed anywhere the href bypasses the HeroUI router
// integration: the next-auth signIn callback (a post-login redirect) and
// Button `as="a"` (raw DOM anchor — HeroUIProvider's useHref/basePath does
// NOT apply, unlike Link/DropdownItem).
const whoamiUrl = isDev ? "/whoami" : `/${region}/whoami`;
// Routes live in the gpx.studio editor (gpx.defcon.run), not run.human — the
// local /routes page no longer exists, so the old region-relative href 404'd.
// Same destination as the tiles below: the bare origin only redirects there via
// an interstitial, so go straight to the map (see lib/gpx-map).
const routesUrl = gpxMapUrl();
// public/ assets rendered via raw <img> (HeroUI Image) need the region basePath
// prefixed by hand — same reason as the raw-anchor hrefs above.
const asset = (p: string) => (isDev ? p : `/${region}${p}`);

// Map pins. These coordinates are the real payload now — the tiles used to hand
// them to OpenStreetMap / Google Maps, and now centre the gpx map instead (see
// lib/gpx-map for why the URL has to be spelled the way it is).
// Rally point at LVCC West — meet here at 0600 daily.
const RALLY_POINT = { lat: 36.135189, lon: -115.158541 };
// ReBAR, 1225 S Main St (Arts District) — same pin as the gpx payphone beacon.
const REBAR = { lat: 36.1565826, lon: -115.1535043 };

function LoginContent() {
  const [mounted, setMounted] = useState(false);
  const [autoLoginTriggered, setAutoLoginTriggered] = useState(false);
  const searchParams = useSearchParams();

  const autoLogin = searchParams.get("autoLogin") === "true";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (autoLogin && mounted && !autoLoginTriggered) {
      setAutoLoginTriggered(true);
      console.log("[Silent SSO] Auto-login triggered, starting OIDC flow");
      signIn("run.defcon.run", { callbackUrl: whoamiUrl });
    }
  }, [autoLogin, mounted, autoLoginTriggered]);

  if (autoLogin && !autoLoginTriggered) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 animate-fade-in">
        <Spinner size="lg" color="primary" />
        <p className="text-sm text-default-400 font-mono">
          Signing you in...
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-8 py-16 animate-slide-up">
      <div className="text-center space-y-3">
        <h2 className="font-museo text-2xl font-bold text-foreground">
          Welcome to DEF CON 34
        </h2>
        <p className="text-sm text-default-500 max-w-sm">
          Sign in to access your dashboard, routes, and event features.
        </p>
      </div>
      <Button
        variant="solid"
        color="primary"
        className="font-semibold px-8"
        size="lg"
        onPress={() =>
          signIn("run.defcon.run", { callbackUrl: whoamiUrl })
        }
      >
        Sign In
      </Button>
    </div>
  );
}

/** DC33-style photo tile: image-filled card, eyebrow + title top-left, blurred footer. */
function PhotoTile({
  eyebrow,
  title,
  imgSrc,
  imgAlt,
  footTitle,
  footSub,
  ctaLabel,
  ctaHref,
  className = "",
  imgClassName = "",
}: {
  eyebrow: string;
  title: string;
  imgSrc: string;
  imgAlt: string;
  footTitle: string;
  footSub: string;
  ctaLabel: string;
  ctaHref: string;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <Card
      isFooterBlurred
      className={`w-full h-[300px] col-span-12 sm:col-span-4 ${className}`}
    >
      <div className="absolute z-10 top-3 left-3 flex flex-col items-start gap-1">
        <span className="font-mono text-[10px] tracking-widest uppercase text-white/70 bg-black/60 px-2 py-0.5 rounded">
          {eyebrow}
        </span>
        <span className="text-lg font-bold text-white/95 bg-black/30 px-2 py-0.5 rounded">
          {title}
        </span>
      </div>
      <Image
        removeWrapper
        alt={imgAlt}
        src={imgSrc}
        className={`z-0 w-full h-full object-cover ${imgClassName}`}
      />
      <CardFooter className="absolute bg-black/20 bottom-0 z-10 border-t-1 border-white/15 justify-between gap-2">
        <div className="flex flex-col min-w-0">
          <span className="text-[13px] font-bold text-white/90 whitespace-nowrap">
            {footTitle}
          </span>
          <span className="text-[11px] text-white/60 truncate">{footSub}</span>
        </div>
        <Button
          as="a"
          href={ctaHref}
          target="_blank"
          rel="noopener noreferrer"
          color="primary"
          radius="sm"
          size="sm"
          className="font-semibold shrink-0"
        >
          {ctaLabel}
        </Button>
      </CardFooter>
    </Card>
  );
}

function WelcomeContent({ userName }: { userName: string }) {
  const { t } = useCopy();
  // CMS copy overrides the group URLs at runtime; `t` echoes the raw key when
  // unset, so only accept a real http(s) URL (same idiom as whoami).
  const asUrl = (key: string) => {
    const v = t(key);
    return v.startsWith('http') ? v : '';
  };
  const stravaGroupUrl = asUrl('socials.strava_group_url') || DEFAULT_STRAVA_GROUP_URL;
  const signalGroupUrl = asUrl('socials.signal_group_url') || DEFAULT_SIGNAL_GROUP_URL;

  const [isQuickCheckInOpen, setIsQuickCheckInOpen] = useState(false);
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  // Cosmetic only. QuickCheckInModal uses checkinPreference to pick private vs
  // public wording and QrScannerModal uses attendance to show the admin
  // toggle. The check-in POSTs exactly {samples, source} and the server
  // resolves privacy from the stored preference, so a slow or failed fetch can
  // show the wrong wording for a moment but can NEVER make a private runner
  // public. Do not gate the buttons on this.
  const [checkinPreference, setCheckinPreference] = useState<string>();
  const [attendanceAvailable, setAttendanceAvailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl("/api/user"))
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.user) return;
        setCheckinPreference(data.user.preferences?.checkinPreference);
        setAttendanceAvailable(!!data.user.social?.attendance);
      })
      .catch(() => {
        /* defaults stand; the server still decides the real behaviour */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // t() echoes the raw key when unset, so floor every lookup on a real default.
  const copyOr = (key: string, fallback: string) => {
    const v = t(key);
    return !v || v === key ? fallback : v;
  };
  const scanCopy = buildScannerCopy(copyOr);

  return (
    <div className="flex flex-col gap-2.5 py-4 animate-slide-up">
      {/* Full-bleed hero - DC33 group photo, welcome + CTAs inside.
          The photo is absolutely positioned and the content flows, so the card
          grows with the CTA stack on narrow screens; min-h keeps the original
          420px on desktop, where the buttons wrap into rows instead. */}
      <Card isFooterBlurred className="w-full">
        <Image
          removeWrapper
          alt="DC33 defcon.run group at the finish"
          src={asset("/dashboard/defcongroup.jpg")}
          className="absolute inset-0 z-0 w-full h-full object-cover brightness-[.55]"
        />
        <div className="relative z-10 min-h-[420px] flex flex-col items-center justify-center gap-4 text-center px-5 py-10 pb-14">
          <h1 className="font-museo text-3xl sm:text-4xl font-bold text-white drop-shadow-[0_2px_18px_rgba(0,0,0,0.8)]">
            Welcome back, {userName}
          </h1>
          <p className="text-white/80 text-sm max-w-md drop-shadow-[0_1px_8px_rgba(0,0,0,0.8)]">
            Hackers who run. Rally 0600 daily at LVCC West - routes, rabbits,
            and the mesh await.
          </p>
          <div className="flex gap-3 flex-wrap justify-center">
            <Button
              variant="solid"
              color="primary"
              className="font-semibold w-[190px]"
              size="lg"
              href={whoamiUrl}
              as="a"
              endContent={<ChevronRight className="w-4 h-4" />}
            >
              Who Am I
            </Button>
            <Button
              className="w-[190px] bg-white/15 text-white backdrop-blur-sm"
              size="lg"
              href={routesUrl}
              as="a"
              target="_blank"
              rel="noopener noreferrer"
              endContent={<ChevronRight className="w-4 h-4" />}
            >
              Routes
            </Button>
            {/* The three event-time actions, same flows as /whoami. Ordered by
                how often a runner needs them mid-event. */}
            <Button
              className="w-[190px] bg-white/15 text-white backdrop-blur-sm"
              size="lg"
              startContent={<MapPin className="w-4 h-4" />}
              onPress={() => setIsQuickCheckInOpen(true)}
            >
              {copyOr("checkin.quick.button", "Check-in")}
            </Button>
            <Button
              className="w-[190px] bg-white/15 text-white backdrop-blur-sm"
              size="lg"
              href={gpxAddRunUrl()}
              as="a"
              target="_blank"
              rel="noopener noreferrer"
              startContent={<Footprints className="w-4 h-4" />}
            >
              Add Run
            </Button>
            {/* Its own CMS key on purpose: /whoami names the outcome
                ("Connect") via the socialqr scan button key, this names the
                mechanism because it sits beside four navigational CTAs.
                Sharing the key would let one CMS edit rename both. */}
            <Button
              className="w-[190px] bg-white/15 text-white backdrop-blur-sm"
              size="lg"
              startContent={<Camera className="w-4 h-4" />}
              onPress={() => setIsScannerOpen(true)}
            >
              {copyOr("socialqr.scan.button.short", "Scan")}
            </Button>
          </div>
        </div>
        <CardFooter className="absolute bg-black/20 bottom-0 z-10 border-t-1 border-white/15">
          <span className="text-[11px] text-white/70">
            📸 DC33 - last year&apos;s crew at the finish
          </span>
        </CardFooter>
      </Card>

      {/* DC33-style tile strip. */}
      <div className="grid grid-cols-12 gap-2.5">
        <PhotoTile
          eyebrow="Meetup Spot"
          title="Rally 0600"
          imgSrc={asset("/dashboard/NewMeetPoint.jpg")}
          imgAlt="Meeting point at LVCC West"
          footTitle="🚨 Rally Point 🚨"
          footSub="Meet here at 0600 daily - LVCC West"
          ctaLabel="Map"
          ctaHref={gpxMapUrl(RALLY_POINT)}
        />
        <PhotoTile
          eyebrow="Routes"
          title="Plan Your Run"
          imgSrc={asset("/dashboard/VegasRunMap.png")}
          imgAlt="Las Vegas run map"
          footTitle="gpx.defcon.run"
          footSub="Official routes + editor"
          ctaLabel="Map"
          ctaHref={gpxMapUrl()}
        />
        <PhotoTile
          eyebrow="Social Run"
          title="ReBAR"
          imgSrc={asset("/dashboard/ReBarPayphone.jpg")}
          imgAlt="Payphone kiosk like the one at ReBAR"
          footTitle="Bar + Antique Store"
          footSub="Arts District hangout - say hi at the payphone"
          ctaLabel="Map"
          ctaHref={gpxMapUrl(REBAR)}
        />
      </div>

      {/* Group QR tiles — parked here from whoami for now (the profile keeps
          button CTAs; the scannable codes live on the landing page). */}
      <Card className="glass-card overflow-hidden">
        <CardBody className="flex flex-row flex-wrap items-center justify-between gap-3 px-5 py-4">
          <div className="flex flex-col min-w-0">
            <span className="font-museo text-base font-bold text-foreground">
              Run with us
            </span>
            <span className="text-xs text-default-500">
              Scan or tap to join the Strava club and the Signal group
            </span>
          </div>
          <SocialQRRow stravaUrl={stravaGroupUrl} signalUrl={signalGroupUrl} />
        </CardBody>
      </Card>

      {/* Hero action modals live at page level so their triggers never depend
          on a collapsible panel being open (same arrangement as /whoami). */}
      <QuickCheckInModal
        isOpen={isQuickCheckInOpen}
        onClose={() => setIsQuickCheckInOpen(false)}
        checkinPreference={checkinPreference}
      />
      <QrScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        copy={scanCopy}
        attendanceAvailable={attendanceAvailable}
      />
    </div>
  );
}

export default function PublicPage() {
  const [mounted, setMounted] = useState(false);
  const { data: session, status } = useSession();

  useEffect(() => {
    setMounted(true);
  }, []);

  let content: React.ReactNode;
  if (!mounted || status === "loading") {
    content = (
      <div className="flex flex-col items-center gap-6 py-16">
        <div className="h-8 w-48 rounded bg-content2 animate-pulse" />
        <div className="h-4 w-64 rounded bg-content2 animate-pulse" />
      </div>
    );
  } else if (session?.user) {
    const userName = session.user.displayName || session.user.name?.split(' ')[0] || 'Runner';
    content = <WelcomeContent userName={userName} />;
  } else {
    content = <LoginContent />;
  }

  // SECONDARY anon covert-egg mount: anon visitors are NOT silent-SSO-redirected
  // here, so an unauth `!!!` fire parks its v for claim on the next signed-in load.
  return (
    <>
      {content}
      <EggTrigger />
    </>
  );
}
