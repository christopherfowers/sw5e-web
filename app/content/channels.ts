/**
 * Where the community gathers, off this site.
 *
 * A Discord, a subreddit, a funding page. These were going to be hard-coded,
 * and that would have been wrong for a reason that has nothing to do with
 * convenience: this is an open-source community project whose leadership is
 * expected to change hands, and the day the Discord moves, the fix should not
 * be a code edit and a deploy by whoever still holds commit rights.
 *
 * So they are content, and an administrator will be able to edit them through
 * the CMS once channels are an authored type there.
 *
 * ## The host allowlist is the part that matters
 *
 * An outbound link on a community's reference site is a phishing primitive. If
 * an administrator account is compromised, the valuable move is not defacing
 * the corpus — it is repointing "Discord" at a credential-harvesting clone that
 * people will click precisely because this domain vouched for it.
 *
 * So a channel's platform decides which hosts its URL may use, and that table
 * lives here, in code, where changing it is a pull request. It is the one part
 * of a channel that an administrator cannot reach at runtime.
 *
 * Be clear about what this does and does not stop. It makes
 * `discord-invite.example` impossible. It does **not** stop `discord.gg/ours`
 * becoming `discord.gg/theirs`, because that is a real Discord invite and
 * nothing here can know which server is the community's. That residual is what
 * the notification and the audit trail in the channels design are for; this
 * closes the half that can be closed mechanically.
 */

export type ChannelGroup = "development" | "connect" | "support";

export type Platform =
  | "discord"
  | "reddit"
  | "facebook"
  | "twitter"
  | "youtube"
  | "github"
  | "patreon"
  | "kofi"
  | "opencollective"
  | "githubsponsors";

export interface Channel {
  key: string;
  platform: Platform;
  group: ChannelGroup;
  url: string;
  blurb: string | null;
  order: number;
  enabled: boolean;
}

/**
 * What a reader is told a channel is called.
 *
 * Derived from the platform rather than authored, so a compromised account
 * cannot publish a button reading "Official Discord" that points somewhere
 * else. There is no naming flexibility worth that risk.
 */
const LABELS: Record<Platform, string> = {
  discord: "Discord",
  reddit: "Reddit",
  facebook: "Facebook",
  twitter: "X",
  youtube: "YouTube",
  github: "GitHub",
  patreon: "Patreon",
  kofi: "Ko-fi",
  opencollective: "Open Collective",
  githubsponsors: "GitHub Sponsors",
};

/**
 * The hosts each platform may point at.
 *
 * Exact matches against the URL's host, never a substring test: a containment
 * check would accept `discord.gg.example.com`, which is the same class of
 * mistake as matching JavaScript by substring in the resource sanitiser.
 */
const HOSTS: Record<Platform, readonly string[]> = {
  discord: ["discord.gg", "discord.com", "www.discord.com"],
  reddit: ["reddit.com", "www.reddit.com", "old.reddit.com"],
  facebook: ["facebook.com", "www.facebook.com"],
  twitter: ["twitter.com", "www.twitter.com", "x.com", "www.x.com"],
  youtube: ["youtube.com", "www.youtube.com", "youtu.be"],
  github: ["github.com", "www.github.com"],
  patreon: ["patreon.com", "www.patreon.com"],
  kofi: ["ko-fi.com", "www.ko-fi.com"],
  opencollective: ["opencollective.com", "www.opencollective.com"],
  githubsponsors: ["github.com", "www.github.com"],
};

/** The order the columns are read in. */
export const CHANNEL_GROUPS: readonly ChannelGroup[] = [
  "development",
  "connect",
  "support",
];

const GROUP_HEADINGS: Record<ChannelGroup, string> = {
  development: "Development",
  connect: "Connect",
  support: "Support",
};

const generated: Record<string, unknown> = import.meta.glob(
  "../data/generated/channels.json",
  { eager: true, import: "default" },
);

const fixture: Record<string, unknown> = import.meta.glob(
  "../data/fixture/channels.json",
  { eager: true, import: "default" },
);

/**
 * True when this URL is one the platform is allowed to point at.
 *
 * HTTPS only, and an exact host match. A channel failing this is dropped
 * rather than rendered, and dropping is the right failure: a link the site
 * cannot vouch for should not be offered under the site's name.
 */
export function isAllowedChannelUrl(platform: Platform, url: string): boolean {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (parsed.protocol !== "https:") return false;

  return (HOSTS[platform] ?? []).includes(parsed.host.toLowerCase());
}

function read(): Channel[] {
  const found = Object.values(generated)[0] ?? Object.values(fixture)[0];
  if (!Array.isArray(found)) return [];

  return (found as Channel[])
    .filter((channel) => channel.enabled !== false)
    .filter((channel) => LABELS[channel.platform] !== undefined)
    .filter((channel) => isAllowedChannelUrl(channel.platform, channel.url))
    .sort((left, right) => left.order - right.order);
}

/** Every channel the corpus describes that survives the checks above. */
export const CHANNELS: readonly Channel[] = read();

/** What a reader is told this channel is called. */
export function channelLabel(platform: Platform): string {
  return LABELS[platform];
}

/** What a column is headed. */
export function groupHeading(group: ChannelGroup): string {
  return GROUP_HEADINGS[group];
}

/**
 * The channels of one group, and the paragraph above them.
 *
 * Returns null for a group nothing is filed under, which is how a site with no
 * funding page has no Support column rather than an empty one — and is why the
 * Patreon needed no toggle of its own. "Off by default with nothing filled in"
 * is not a setting; it is the absence of a channel.
 */
export function channelGroup(
  group: ChannelGroup,
): { heading: string; blurb: string | null; channels: Channel[] } | null {
  const channels = CHANNELS.filter((channel) => channel.group === group);
  if (channels.length === 0) return null;

  return {
    heading: GROUP_HEADINGS[group],
    blurb: channels.find((channel) => channel.blurb)?.blurb ?? null,
    channels,
  };
}
