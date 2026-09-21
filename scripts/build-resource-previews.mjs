#!/usr/bin/env node
/**
 * Renders page one of each downloadable sheet into `app/assets/resources/`.
 *
 *   node scripts/build-resource-previews.mjs --content ../sw5e-database
 *
 * A character sheet's cover is its first page. Nothing else would do: a generic
 * document icon tells a reader nothing, and these sit on the front page beside
 * five book covers that are actual artwork. A letter page is 612x792 and a book
 * cover is drawn at 352x455, the same ratio to within a pixel, so a rendered
 * first page needs no cropping to share the shelf's form factor.
 *
 * ## Why this is a script and not part of the build
 *
 * Same trade as `build-image-assets.mjs`, which this deliberately mirrors. It
 * runs when the sheets change, which is close to never, and the output is
 * committed so a clean clone builds without it. Rendering PDF needs poppler and
 * ImageMagick (system tools, not npm packages) and adding a native-binary
 * dependency to every `npm ci` in CI to serve a script CI never runs is a bad
 * trade.
 *
 * It also means CI never parses a PDF, which is worth having on purpose: the
 * eventual upload pipeline does that in a locked-down sidecar precisely because
 * it is the risky operation. There is no reason for the site's build to do it
 * too.
 *
 * ## Sizes
 *
 * The same ladder the book covers use, so the two rows request comparable
 * bytes at comparable widths. Dimensions are in the file name because the
 * renderer parses them back out to reserve the image's space before it loads.
 * See `app/content/imagery.ts`.
 */

import { execFileSync } from "node:child_process";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/** Matches the `sources` recipe in build-image-assets.mjs. */
const WIDTHS = [201, 352];

/** US Letter, which every sheet in the corpus is. */
const PAGE_RATIO = 792 / 612;

const MAGICK = process.env.MAGICK ?? "magick";
const PDFTOPPM = process.env.PDFTOPPM ?? "pdftoppm";

function parseArguments(argv) {
  const options = { content: "../sw5e-database", out: "app/assets/resources" };

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--content") options.content = argv[++index];
    else if (argv[index] === "--out") options.out = argv[++index];
  }

  return options;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const repository = path.resolve(options.content);
  const documents = path.join(repository, "content", "resource");
  const files = path.join(repository, "assets", "resource");
  const outputDirectory = path.resolve(options.out);

  const names = (await readdir(documents)).filter((name) =>
    name.endsWith(".json"),
  );

  if (names.length === 0) {
    throw new Error(
      `${documents} holds no resource documents. Nothing downstream can tell ` +
        "that apart from a corpus with no sheets, so it fails here.",
    );
  }

  // Rebuilt rather than added to, so a resource removed from the corpus does
  // not leave its preview behind to be shipped forever.
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const scratch = path.join(outputDirectory, ".page-one");
  let written = 0;

  for (const name of names.sort()) {
    const document = JSON.parse(
      await readFile(path.join(documents, name), "utf8"),
    );
    const source = path.join(files, document.file);

    /*
      One page, at a resolution comfortably above the largest width emitted, so
      the downscale to 352 does the resampling rather than the rasteriser. 100
      dpi on letter is 850px wide.
    */
    execFileSync(PDFTOPPM, [
      "-png", "-r", "100", "-f", "1", "-l", "1", "-singlefile",
      source, scratch,
    ]);

    for (const width of WIDTHS) {
      const height = Math.round(width * PAGE_RATIO);
      execFileSync(MAGICK, [
        `${scratch}.png`,
        "-resize", `${width}x`,
        "-quality", "74",
        path.join(outputDirectory, `${document.key}-${width}x${height}.webp`),
      ]);
      written += 1;
    }

    process.stdout.write(`  ${document.key}\n`);
  }

  await rm(`${scratch}.png`, { force: true });

  process.stdout.write(
    `\n${written} previews written to ${path.relative(process.cwd(), outputDirectory)}\n`,
  );
}

await main();
