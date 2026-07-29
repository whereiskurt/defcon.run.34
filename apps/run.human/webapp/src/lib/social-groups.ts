/**
 * Default social group URLs (the DEF CON run Strava club + Signal group).
 * These are a code-level FLOOR only — the CMS copy keys
 * `socials.strava_group_url` / `socials.signal_group_url` override them at
 * runtime with no redeploy. Shared by whoami (CTA buttons) and the landing
 * page (QR tiles).
 */
export const DEFAULT_STRAVA_GROUP_URL = 'https://www.strava.com/clubs/1071823';
export const DEFAULT_SIGNAL_GROUP_URL =
  'https://signal.group/#CjQKIPWdGurSgpzV8xcut1PWo_at1L6hUEFJtHhxLnlAxErEEhB5h5oWXv68P7cgGAGVZ26I';
