/**
 * Getting in touch, last on the page, as the site this replaces had it.
 *
 * The channels are content rather than markup, and that is not a convenience.
 * This is a community project whose leadership is expected to change hands,
 * and the day the Discord moves the fix should not be a code edit and a deploy
 * by whoever still holds commit rights.
 *
 * ## Columns are not a setting
 *
 * A group nothing is filed under draws nothing at all. There is no Support
 * column and no toggle for one: the old Patreon belongs to the previous
 * maintainer and is shared with another project, so no Support channel exists.
 * "Off, with nothing filled in" turned out not to be a state worth modelling.
 * It is the absence of a channel.
 *
 * Which is why the editor rearranges links within a column and never the
 * columns themselves. A column is where its links say it is.
 */

import { PlatformIcon } from "~/components/platform-icon";
import type { Platform } from "~/content/channels";

import type { ListEditing } from "./editable";
import { AddToList, EditableText } from "./editable";
import { SortableShelf } from "./sortable";

export interface TouchChannel {
  key: string;
  name: string;
  platform: Platform;
  label: string;
  url: string;
}

export interface TouchGroup {
  heading: string;
  blurb: string | null;
  channels: readonly TouchChannel[];
}

export interface TouchProps {
  heading: string | null;
  lede: string | null;
  ledeFallback: React.ReactNode;
  groups: readonly TouchGroup[];
  editing?: {
    onHeadingChange(next: string): void;
    onLedeChange(next: string): void;
    forGroup(heading: string): ListEditing<TouchChannel>;
  };
}

export function Touch({
  heading,
  lede,
  ledeFallback,
  groups,
  editing,
}: TouchProps) {
  if (groups.length === 0 && !editing) return null;

  return (
    <section className="home-touch" aria-labelledby="getting-in-touch">
      <h2 className="section-heading" id="getting-in-touch">
        {heading ?? "Getting in touch"}
      </h2>

      {/* Under the heading, not inside it. See `shelf.tsx`. */}
      {editing ? (
        <EditableText
          value={heading}
          fallback="Getting in touch"
          editing={{ label: "Heading", onChange: editing.onHeadingChange }}
        />
      ) : null}

      <EditableText
        value={lede}
        fallback={ledeFallback}
        className="section-lede"
        editing={
          editing
            ? { label: "Lede", onChange: editing.onLedeChange }
            : undefined
        }
      />

      <div className="touch-groups">
        {groups.map((group) => {
          const forGroup = editing?.forGroup(group.heading);
          return (
            <div className="touch-group" key={group.heading}>
              <h3 className="touch-heading">{group.heading}</h3>
              {group.blurb ? <p className="touch-blurb">{group.blurb}</p> : null}

              {forGroup ? (
                <>
                  <SortableShelf
                    items={group.channels}
                    editing={forGroup}
                    className="touch-links"
                  >
                    {(channel) => <ChannelLink channel={channel} />}
                  </SortableShelf>
                  <AddToList editing={forGroup} />
                </>
              ) : (
                <ul className="touch-links">
                  {group.channels.map((channel) => (
                    <li key={channel.key}>
                      <ChannelLink channel={channel} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ChannelLink({ channel }: { channel: TouchChannel }) {
  return (
    /*
      `noreferrer` as well as `noopener`: these leave the site, and where a
      reader came from is not this project's to hand to somebody else's
      analytics.
    */
    <a
      href={channel.url}
      rel="noopener noreferrer"
      className="button button-channel"
    >
      <PlatformIcon platform={channel.platform} />
      {channel.label}
    </a>
  );
}
