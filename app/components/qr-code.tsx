/**
 * A QR code, drawn as inline SVG from the data itself.
 *
 * Generated in the browser rather than fetched as an image, because the
 * obvious alternative — pointing an `<img>` at a QR service — would hand a
 * third party the TOTP secret it is asked to draw. That is the entire second
 * factor, in a URL, in someone else's access log. It would also need an
 * external host in `img-src`, which this site's Content-Security-Policy does
 * not have and CI refuses to let it grow.
 *
 * SVG rather than a canvas so it stays sharp at any size, needs no ref or
 * effect, and renders identically during the prerender and after hydration.
 *
 * A QR code is not an interface on its own. It cannot be read by a screen
 * reader, focused, or used at all by someone whose authenticator app is on the
 * same device as the browser — a phone, which is most people. The secret is
 * always shown as selectable text beside it; see the security page. This
 * element is therefore `aria-hidden`, with the accessible path living in that
 * text rather than in a description of a picture of a number.
 */

import { encode } from "uqr";

/**
 * One quiet-zone border of four modules, which the specification requires and
 * scanners genuinely need — a code drawn flush to the edge of a dark surface
 * often will not read.
 */
const QUIET_ZONE = 4;

export function QrCode({
  value,
  className,
  size = 200,
}: {
  value: string;
  className?: string;
  size?: number;
}) {
  // `border` is part of the encoded grid, so the quiet zone arrives inside
  // `data` rather than being something this code has to offset by.
  const { size: extent, data } = encode(value, { ecc: "M", border: QUIET_ZONE });

  // One path of many subpaths rather than a rect per module: a version-5 code
  // is around 1,300 dark modules, and 1,300 elements is a measurable amount of
  // DOM for a picture nothing interacts with.
  let path = "";
  for (let row = 0; row < extent; row += 1) {
    for (let column = 0; column < extent; column += 1) {
      if (data[row]?.[column]) path += `M${column} ${row}h1v1h-1z`;
    }
  }

  return (
    <svg
      className={["qr-code", className].filter(Boolean).join(" ")}
      viewBox={`0 0 ${extent} ${extent}`}
      width={size}
      height={size}
      role="presentation"
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {/* The light modules have to be painted, not left transparent: this site
          has a dark theme, and a code with a transparent quiet zone over a
          near-black background is unreadable to every scanner. */}
      <rect width={extent} height={extent} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
