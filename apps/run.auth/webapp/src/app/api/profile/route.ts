import { NextResponse } from "next/server";
import { auth } from "@/config/auth";
import { getAuthProfile } from "@/entities/auth-profile";

/**
 * Mask an email: show first char + "***" + "@" + domain
 * Example: "khundeck@gmail.com" -> "k***@gmail.com"
 */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  return `${local[0]}***@${domain}`;
}

/**
 * GET /api/profile - Get authenticated user's full profile
 *
 * Returns the AuthProfile from DynamoDB with linked account details,
 * services, and security info. Sensitive fields are excluded.
 */
export async function GET() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const profile = await getAuthProfile(session.user.id);

  if (!profile) {
    return NextResponse.json({ error: "Profile not found" }, { status: 404 });
  }

  // Build linked accounts with masked emails
  const linkedAccounts: Record<string, object> = {};

  if (profile.discord?.id) {
    linkedAccounts.discord = {
      linked: true,
      username: profile.discord.username,
      globalName: profile.discord.globalName,
      avatarUrl: profile.discord.avatarUrl,
      email: profile.discord.email ? maskEmail(profile.discord.email) : undefined,
      linkedAt: profile.discord.linkedAt
        ? new Date(profile.discord.linkedAt).toISOString()
        : undefined,
    };
  } else {
    linkedAccounts.discord = { linked: false };
  }

  if (profile.github?.id) {
    linkedAccounts.github = {
      linked: true,
      login: profile.github.login,
      name: profile.github.name,
      avatarUrl: profile.github.avatarUrl,
      email: profile.github.email ? maskEmail(profile.github.email) : undefined,
      linkedAt: profile.github.linkedAt
        ? new Date(profile.github.linkedAt).toISOString()
        : undefined,
    };
  } else {
    linkedAccounts.github = { linked: false };
  }

  if (profile.strava?.id) {
    linkedAccounts.strava = {
      linked: true,
      firstName: profile.strava.firstName,
      lastName: profile.strava.lastName,
      username: profile.strava.username,
      profileMedium: profile.strava.profileMedium,
      linkedAt: profile.strava.linkedAt
        ? new Date(profile.strava.linkedAt).toISOString()
        : undefined,
    };
  } else {
    linkedAccounts.strava = { linked: false };
  }

  if (profile.linkedin?.id) {
    linkedAccounts.linkedin = {
      linked: true,
      name: profile.linkedin.name,
      givenName: profile.linkedin.givenName,
      familyName: profile.linkedin.familyName,
      avatarUrl: profile.linkedin.picture,
      email: profile.linkedin.email ? maskEmail(profile.linkedin.email) : undefined,
      linkedAt: profile.linkedin.linkedAt
        ? new Date(profile.linkedin.linkedAt).toISOString()
        : undefined,
    };
  } else {
    linkedAccounts.linkedin = { linked: false };
  }

  return NextResponse.json({
    user: {
      userId: profile.userId,
      displayName: profile.displayName,
      email: profile.email,
      emailVerified: profile.emailVerified ?? false,
      name: profile.name,
      picture: profile.picture,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
      quotaTier: profile.quotaTier ?? "upload",
      lockedOut: profile.lockedOut ?? false,
      services: profile.services ?? [],
      sessionVersion: profile.sessionVersion ?? 1,
      linkedAccounts,
    },
  });
}
