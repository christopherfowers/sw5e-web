/**
 * The community's channels, and the check that keeps them honest.
 *
 * An outbound link on a community's reference site is a phishing primitive. If
 * whoever can edit these is compromised, the valuable move is not defacing the
 * corpus — it is repointing "Discord" at a credential-harvesting clone that
 * people click precisely because this domain vouched for it.
 *
 * The host allowlist is the half of that which can be closed mechanically, and
 * it lives in code rather than in content so that changing it is a pull request
 * rather than an edit. These are the tests that make it a control rather than a
 * decoration.
 */

import { describe, expect, it } from "vitest";

import {
  CHANNELS,
  CHANNEL_GROUPS,
  channelGroup,
  channelLabel,
  isAllowedChannelUrl,
} from "./channels";

describe("the channels the corpus describes", () => {
  it("carries the Discord, the subreddit and the group", () => {
    expect(CHANNELS.map((channel) => channel.platform)).toEqual([
      "discord",
      "reddit",
      "facebook",
    ]);
  });

  /**
   * No Support column, and no setting that turns one off.
   *
   * The Patreon the old site carried belongs to the previous maintainer and is
   * shared with another project, so it is deliberately not carried over. An
   * earlier design gave it a dedicated admin toggle defaulting to off; this is
   * the assertion that replaced it, and it needs no code at all — a group
   * nothing is filed under does not exist.
   */
  it("has no support group, because nothing is filed under one", () => {
    expect(channelGroup("support")).toBeNull();
  });

  it("puts development before connect", () => {
    const groups = CHANNEL_GROUPS.map(channelGroup).filter(Boolean);

    expect(groups.map((group) => group!.heading)).toEqual([
      "Development",
      "Connect",
    ]);
  });

  /**
   * A reader is told what a platform is called, not what a document says.
   *
   * Free-text labelling would let whoever edits a channel publish a button
   * reading "Official Discord" pointing somewhere else. There is no naming
   * flexibility worth that.
   */
  it("names a channel from its platform rather than from its document", () => {
    expect(channelLabel("discord")).toBe("Discord");
    expect(channelLabel("twitter")).toBe("X");
  });
});

describe("the host allowlist", () => {
  it("accepts the hosts a platform really uses", () => {
    expect(isAllowedChannelUrl("discord", "https://discord.gg/abc")).toBe(true);
    expect(isAllowedChannelUrl("reddit", "https://www.reddit.com/r/sw5e")).toBe(
      true,
    );
    expect(isAllowedChannelUrl("patreon", "https://www.patreon.com/x")).toBe(
      true,
    );
  });

  /**
   * The lookalike cases, which are the whole point.
   *
   * `discord.gg.example.com` is the one that matters: it *contains* the
   * allowed host, so any implementation that asks whether the URL includes
   * "discord.gg" accepts it. This is the same mistake as matching PDF
   * JavaScript by substring, and it fails the same way.
   */
  it.each([
    ["a host that merely contains the real one", "https://discord.gg.example.com/x"],
    ["a subdomain of an attacker's domain", "https://evil.com/discord.gg/x"],
    ["a hyphenated lookalike", "https://discord-invite.example/x"],
    ["plain http", "http://discord.gg/x"],
    ["a javascript url", "javascript:alert(1)"],
    ["a data url", "data:text/html,<script>alert(1)</script>"],
    ["not a url at all", "/discord"],
  ])("refuses %s", (_why, url) => {
    expect(isAllowedChannelUrl("discord", url)).toBe(false);
  });

  /**
   * And a URL allowed for one platform is not allowed for another. Without
   * this, the allowlist would collapse into "any host any platform uses",
   * which is a much weaker claim than the one it appears to make.
   */
  it("binds the allowlist to the platform, not to the set of all hosts", () => {
    expect(isAllowedChannelUrl("patreon", "https://discord.gg/x")).toBe(false);
    expect(isAllowedChannelUrl("discord", "https://www.patreon.com/x")).toBe(
      false,
    );
  });

  /**
   * Every published channel passes its own check.
   *
   * The reader never sees a channel that fails, because `read` drops it — so
   * without this test a seed pointing somewhere unexpected would vanish
   * silently rather than failing loudly, and "the Discord link disappeared" is
   * a worse way to find out than a red test.
   */
  it("passes every channel the corpus actually ships", () => {
    for (const channel of CHANNELS) {
      expect(
        isAllowedChannelUrl(channel.platform, channel.url),
        `${channel.key} points at a host its platform does not use`,
      ).toBe(true);
    }
  });
});
