import { expect, test } from "@playwright/test";

/**
 * Text contrast, in both themes.
 *
 * This site is read at a table, often on a phone, sometimes in a badly lit
 * room, and the palette carries meaning — a Force power is violet, a tech
 * power is cyan, every source book has a hue. That is a lot of colour choices,
 * each made against one background, and a token nudged for one of them lands
 * on all of them.
 *
 * ## Why this is arithmetic rather than a judgement
 *
 * The ratio is defined, the thresholds are defined, and a failure is a fact
 * rather than an opinion. That makes it worth automating, unlike most of what
 * gets called an accessibility check.
 *
 * ## Two ways this test can lie, and what it does about them
 *
 * **Reading colours with a regular expression.** This palette is authored in
 * `oklab`, and that is what `getComputedStyle` hands back —
 * `oklab(0.825 0.005 -0.084)`. Pulling the numbers out with `/[\d.]+/g` yields
 * 0.825, 0.005, 0.084, reads them as red, green and blue out of 255, and calls
 * every colour on the site black. The first version of this did exactly that
 * and reported the monogram plates at a contrast ratio of 1.0 — the two
 * colours are in fact 180,195,253 on 28,35,50, which is fine.
 *
 * So colours are resolved by painting them onto a 1×1 canvas and reading the
 * pixel back. That is the browser's own colour parser, so it handles every
 * notation the stylesheet is allowed to use, including whichever one is
 * fashionable next.
 *
 * **Measuring against a background nothing is drawn on.** Several surfaces
 * here are translucent tints, so walking up to the first background colour
 * finds an `oklab(... / 0.11)` that never appears on screen. Every layer from
 * the element up to the first opaque one is composited in order instead, and
 * the ratio is taken against the result.
 */

type Page = import("@playwright/test").Page;

const PAGES = [
  { path: "/", what: "the home page" },
  { path: "/species", what: "a content index" },
  { path: "/species/abyssin", what: "a content item" },
  { path: "/monsters", what: "a table with numeric columns" },
  { path: "/rules/phb-adventuring", what: "a chapter of prose" },
  { path: "/search?q=blaster", what: "search results" },
  { path: "/sign-in", what: "the sign-in page" },
];

interface Finding {
  text: string;
  where: string;
  size: string;
  ratio: number;
  required: number;
}

/** Every visible run of text whose contrast falls short of WCAG AA. */
async function lowContrastText(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    interface Rgb {
      r: number;
      g: number;
      b: number;
      a: number;
    }

    // The browser's own colour parser, borrowed. `fillStyle` accepts any CSS
    // colour and the canvas gives back the pixel it painted.
    const swatch = document.createElement("canvas");
    swatch.width = 1;
    swatch.height = 1;
    const paint = swatch.getContext("2d", { willReadFrequently: true })!;

    function parse(value: string): Rgb | null {
      if (!value) return null;

      paint.clearRect(0, 0, 1, 1);

      // Set twice: an unparseable value leaves `fillStyle` at whatever it was,
      // so the sentinel is how an invalid colour is told from a black one.
      paint.fillStyle = "#010203";
      paint.fillStyle = value;
      if (paint.fillStyle === "#010203" && value.trim() !== "#010203") return null;

      paint.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = paint.getImageData(0, 0, 1, 1).data;
      return { r: r!, g: g!, b: b!, a: a! / 255 };
    }

    function over(front: Rgb, back: Rgb): Rgb {
      const a = front.a;
      return {
        r: front.r * a + back.r * (1 - a),
        g: front.g * a + back.g * (1 - a),
        b: front.b * a + back.b * (1 - a),
        a: 1,
      };
    }

    const PAPER: Rgb = { r: 255, g: 255, b: 255, a: 1 };

    function backgroundBehind(element: Element): Rgb {
      const layers: Rgb[] = [];
      let node: Element | null = element;

      while (node) {
        const colour = parse(getComputedStyle(node).backgroundColor);
        if (colour && colour.a > 0) {
          layers.push(colour);
          if (colour.a === 1) break;
        }
        node = node.parentElement;
      }

      if (!layers.length) return PAPER;

      let composited = layers[layers.length - 1]!;
      if (composited.a < 1) composited = over(composited, PAPER);
      for (let index = layers.length - 2; index >= 0; index -= 1) {
        composited = over(layers[index]!, composited);
      }
      return composited;
    }

    function luminance({ r, g, b }: Rgb): number {
      const channel = (value: number) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    }

    function contrast(a: Rgb, b: Rgb): number {
      const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (high! + 0.05) / (low! + 0.05);
    }

    const findings: Finding[] = [];
    const seen = new Set<string>();

    for (const element of document.querySelectorAll("body *")) {
      // Only elements that draw text of their own. Without this every ancestor
      // is measured for the text of its descendants, against its own
      // background, which is meaningless.
      const ownText = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim();
      if (!ownText) continue;

      const style = getComputedStyle(element);
      if (
        style.visibility === "hidden" ||
        style.display === "none" ||
        Number(style.opacity) === 0
      ) {
        continue;
      }

      // Visually hidden text is never seen, so its colour is not a claim about
      // anything.
      if (element.closest(".sr-only")) continue;

      const foreground = parse(style.color);
      if (!foreground) continue;

      const background = backgroundBehind(element);
      const size = parseFloat(style.fontSize);
      const bold = Number(style.fontWeight) >= 700;

      // WCAG's "large text": 24px, or 18.66px when bold.
      const required = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;

      const key = `${style.color}|${Math.round(background.r)},${Math.round(
        background.g,
      )},${Math.round(background.b)}|${style.fontSize}|${style.fontWeight}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const ratio = contrast(foreground, background);
      if (ratio < required) {
        findings.push({
          text: ownText.slice(0, 40),
          where: (element.className || element.tagName).toString().slice(0, 40),
          size: style.fontSize,
          ratio: Number(ratio.toFixed(2)),
          required,
        });
      }
    }

    // The control, returned rather than asserted so the caller can see it. A
    // selector that stopped matching would make every page look perfect.
    (window as unknown as { __contrastChecked: number }).__contrastChecked = seen.size;

    return findings.sort((left, right) => left.ratio - right.ratio);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test.describe(`in ${scheme}`, () => {
    test.use({ colorScheme: scheme });

    for (const { path, what } of PAGES) {
      test(`${what} is readable`, async ({ page }) => {
        await page.goto(path);

        const findings = await lowContrastText(page);

        const checked = await page.evaluate(
          () => (window as unknown as { __contrastChecked: number }).__contrastChecked,
        );

        // Without this a page that rendered nothing, or a selector that stopped
        // matching, would pass as flawless.
        expect(checked, `${what} drew no measurable text`).toBeGreaterThan(5);

        expect(
          findings,
          `${what} (${path}) in ${scheme}: ${findings
            .map((f) => `"${f.text}" at ${f.size} is ${f.ratio}:1, needs ${f.required}:1`)
            .join("; ")}`,
        ).toEqual([]);
      });
    }
  });
}
