#!/usr/bin/env node
/**
 * Derives the site's committed image set from the legacy SW5e archive.
 *
 *   node scripts/build-image-assets.mjs --archive ../../sw5e-legacy-archive
 *
 * The archive holds ~14 MB of PNG source art: 133 species portraits with soft
 * alpha edges, class illustrations, the site's own logo and hero, and the four
 * book covers. None of that is committed here. This script writes a much
 * smaller WebP set into `app/assets/`, and it IS committed, because the build
 * has to work on a machine that has never seen the archive.
 *
 * Four decisions are worth knowing about:
 *
 * 1. Sizes are baked into the file names — `wookiee-192x306.webp`. The
 *    renderer reads width and height straight off the URL, so every `<img>`
 *    can carry explicit dimensions and reserve its space before the bytes
 *    arrive. A separate dimensions manifest would be one more thing to drift.
 *
 * 2. Portraits are trimmed of their transparent margin before resizing. The
 *    archive's cutouts carry uneven padding, which makes a grid of them look
 *    ragged and wastes pixels on nothing.
 *
 * 3. Nothing is ever upscaled. A target wider than the source is dropped, so a
 *    171px portrait emits one file rather than three padded ones.
 *
 * 4. Gallery thumbnails are flattened onto an opaque plate; detail portraits
 *    keep their alpha. That single difference is worth about 40% of the
 *    species index's weight. These cutouts have soft, complicated edges —
 *    fur, spines, tendrils — and an alpha channel that detailed costs more to
 *    encode than the picture does. On a 190px tile the transparency buys
 *    nothing, because the tile has a solid ground behind it anyway; on the
 *    detail page, where the portrait sits in a tinted frame, it buys the whole
 *    effect and costs one image per page.
 *
 * ImageMagick 7 does the encoding. It is a system tool rather than an npm
 * dependency on purpose: this runs when the archive changes, which is close to
 * never, and adding a native-binary package to every `npm ci` in CI to serve a
 * script CI never runs is a bad trade.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const MAGICK = process.env.MAGICK ?? "magick";

/** Where the derived set lands, relative to the repository root. */
const OUT_ROOT = "app/assets";

/**
 * What each image role is rendered at.
 *
 * `max` is the widest file this role ever needs; `min` is the narrowest one
 * that could still be chosen by a real layout. The ladder between them steps
 * down by `RATIO`, so the sizes are proportional to each source rather than
 * pulled off a fixed list.
 *
 * That distinction matters here because the archive's art is small and wildly
 * uneven: portraits run from 112 to well over 360 pixels wide. Against a fixed
 * ladder, a 310px source emits a 224 and a 310 — nearly the same picture
 * twice — while a 171px source emits nothing but itself. Against a
 * proportional one, the wide source gets a candidate a low-density screen can
 * actually use and the narrow source correctly emits a single file, because
 * anything smaller would be below the size the layout displays it at and could
 * never be chosen.
 *
 * Nothing is ever upscaled, in either direction: the top of every ladder is
 * `min(max, source width)`.
 */
const RATIO = 1.75;

const RECIPES = {
  species: { max: 360, min: 150, quality: 70, alphaQuality: 78, trim: true },
  speciesThumb: {
    // A tile is about 190 CSS pixels on a desktop and about 165 on a phone.
    // 176 is deliberately just under that: the difference is invisible at
    // thumbnail size, and multiplied by the ~90 tiles a desktop browser
    // speculatively fetches it is worth about 80 KB on the page.
    max: 176,
    min: 96,
    quality: 62,
    trim: true,
    // The tile's ground, baked in. It reads as a plate the portrait is
    // mounted on rather than a background that got the theme wrong, and the
    // tile below it carries the theme's own surface.
    flatten: "#131b26",
  },
  classes: { max: 360, min: 150, quality: 72, alphaQuality: 80, trim: true },
  sources: { max: 352, min: 160, quality: 74, alphaQuality: 100, trim: false },
  brand: { max: 480, min: 200, quality: 82, alphaQuality: 100, trim: true },
  hero: { max: 1600, min: 900, quality: 62, alphaQuality: 100, trim: false },
};

/**
 * Portrait file names the archive spells differently from the dataset's slug
 * in a way no normalization would reconcile. Everything else matches once
 * punctuation and case are stripped, so this table stays short on purpose —
 * if it starts growing, the normalization below is the thing to fix.
 */
const PORTRAIT_ALIASES = {
  hutt: "hutt-adolescent",
  sith: "sith-pureblood",
  droidclass01: "droid-class-i",
  droidclass02_01: "droid-class-ii",
  droidclas03_01: "droid-class-iii",
  droidclass04: "droid-class-iv",
  droidclass05: "droid-class-v",
};

/**
 * Book covers, keyed by the source abbreviation the dataset uses. Only books
 * the dataset actually carries entries from are converted; the archive also
 * holds a Starships of the Galaxy cover, and shipping it for a book with no
 * entries would be a picture with nothing behind it.
 *
 * Expanded Content has no cover art anywhere in the archive. It is community
 * material rather than a published book, and the sources page draws it a
 * typographic plate instead.
 */
const COVERS = {
  PHB: "phb_cover.jpg",
  WH: "wh_cover.jpg",
  SnV: "sav_cover.jpg",
};

function parseArguments(argv) {
  const options = { archive: path.resolve("../sw5e-legacy-archive") };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--archive") options.archive = path.resolve(argv[++index]);
    else if (argument.startsWith("--archive="))
      options.archive = path.resolve(argument.slice(10));
    else throw new Error(`Unrecognized argument: ${argument}`);
  }
  return options;
}

function requireImageMagick() {
  try {
    execFileSync(MAGICK, ["-version"], { stdio: "pipe" });
  } catch {
    throw new Error(
      `ImageMagick 7 is required and '${MAGICK}' was not found on PATH. ` +
        "Install it (https://imagemagick.org) or set MAGICK to its full path. " +
        "The derived assets in app/assets are committed, so this is only " +
        "needed when the source art changes.",
    );
  }
}

function identify(file) {
  const output = execFileSync(MAGICK, ["identify", "-format", "%w %h", file], {
    encoding: "utf8",
  });
  const [width, height] = output.trim().split(/\s+/).map(Number);
  return { width, height };
}

/**
 * The width and height an image ends up with after trimming, which is what the
 * emitted widths have to be measured against. Trimming can take 10% off a
 * padded cutout, and picking targets from the untrimmed width would emit a
 * "360px" file that is really 320.
 */
function measure(file, trim) {
  if (!trim) return identify(file);
  // Measured with alpha regardless of whether this recipe will flatten: the
  // trim has to find the same edges either way.
  const output = execFileSync(
    MAGICK,
    [file, "-background", "none", "-alpha", "set", "-trim", "+repage", "-format", "%w %h", "info:"],
    { encoding: "utf8" },
  );
  const [width, height] = output.trim().split(/\s+/).map(Number);
  return { width, height };
}

/** Emits one WebP at `width`, returning its file name and true dimensions. */
function encode(source, outDir, stem, width, recipe) {
  const argv = [source, "-background", recipe.flatten ?? "none", "-alpha", "set"];
  if (recipe.trim) argv.push("-trim", "+repage");
  if (recipe.flatten) argv.push("-flatten");
  argv.push(
    "-filter",
    "Lanczos",
    "-resize",
    `${width}x`,
    "-strip",
    "-define",
    "webp:method=6",
  );
  if (recipe.alphaQuality !== undefined) {
    argv.push("-define", `webp:alpha-quality=${recipe.alphaQuality}`);
  }
  argv.push("-quality", String(recipe.quality));

  const temporary = path.join(outDir, `${stem}.tmp.webp`);
  execFileSync(MAGICK, [...argv, temporary]);
  const { width: realWidth, height: realHeight } = identify(temporary);
  const name = `${stem}-${realWidth}x${realHeight}.webp`;
  execFileSync(MAGICK, [temporary, path.join(outDir, name)]);
  return { name, temporary };
}

/**
 * Renders every size for one source image. Returns the emitted file names.
 */
/**
 * The ladder of widths for one source: its own width capped at the role's
 * maximum, then each step down by RATIO for as long as the result is still a
 * size the layout could choose. A source too small for even one step down
 * emits a single file, which is the right answer — a narrower copy of a
 * 120px portrait is a file no browser would ever pick.
 */
function ladder(naturalWidth, recipe) {
  const widths = [];
  for (
    let width = Math.min(naturalWidth, recipe.max);
    width >= recipe.min;
    width /= RATIO
  ) {
    widths.push(Math.round(width));
  }
  if (widths.length === 0) widths.push(Math.min(naturalWidth, recipe.max));
  return [...new Set(widths)].sort((left, right) => left - right);
}

async function renderVariants(source, outDir, stem, recipeName) {
  const recipe = RECIPES[recipeName];
  const natural = measure(source, recipe.trim);
  const targets = ladder(natural.width, recipe);

  const emitted = [];
  for (const width of targets) {
    const { name, temporary } = encode(source, outDir, stem, width, recipe);
    await rm(temporary, { force: true });
    emitted.push(name);
  }
  return emitted;
}

/** Lowercased, punctuation-free form used to match a file name to a slug. */
function normalizeKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function buildSpecies(archive, outRoot, slugs) {
  const sourceDir = path.join(archive, "images/site-images/species");
  if (!existsSync(sourceDir)) {
    throw new Error(`No species portraits at ${sourceDir}`);
  }
  const outDir = path.join(outRoot, "species");
  const thumbDir = path.join(outRoot, "species-thumbs");
  await mkdir(outDir, { recursive: true });
  await mkdir(thumbDir, { recursive: true });

  const bySlugKey = new Map(slugs.map((slug) => [normalizeKey(slug), slug]));
  const files = (await readdir(sourceDir)).filter((file) => file.endsWith(".png"));

  let emitted = 0;
  const unmatched = [];
  for (const file of files) {
    const stem = file.replace(/^species_/, "").replace(/\.png$/, "");
    const slug = PORTRAIT_ALIASES[stem] ?? bySlugKey.get(normalizeKey(stem));
    if (!slug) {
      unmatched.push(file);
      continue;
    }
    emitted += (
      await renderVariants(path.join(sourceDir, file), outDir, slug, "species")
    ).length;
    emitted += (
      await renderVariants(
        path.join(sourceDir, file),
        thumbDir,
        slug,
        "speciesThumb",
      )
    ).length;
  }

  const covered = new Set(
    files
      .map((file) => file.replace(/^species_/, "").replace(/\.png$/, ""))
      .map((stem) => PORTRAIT_ALIASES[stem] ?? bySlugKey.get(normalizeKey(stem)))
      .filter(Boolean),
  );
  const without = slugs.filter((slug) => !covered.has(slug));

  return { emitted, unmatched, without };
}

async function buildClasses(archive, outRoot) {
  const sourceDir = path.join(archive, "images/site-images/classes");
  const outDir = path.join(outRoot, "classes");
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(sourceDir)).filter((file) => file.endsWith(".png"));

  // Two illustrations exist for most classes. Only the first is carried
  // forward: the second is a near-duplicate pose and doubles the weight of a
  // page that shows one picture.
  const firstPerClass = new Map();
  for (const file of files.sort()) {
    const className = file.replace(/_\d+\.png$/, "");
    if (!firstPerClass.has(className)) firstPerClass.set(className, file);
  }

  let emitted = 0;
  for (const [className, file] of firstPerClass) {
    const names = await renderVariants(
      path.join(sourceDir, file),
      outDir,
      className,
      "classes",
    );
    emitted += names.length;
  }
  return { emitted, classes: [...firstPerClass.keys()] };
}

async function buildSources(archive, outRoot) {
  const sourceDir = path.join(archive, "repo-assets");
  const outDir = path.join(outRoot, "sources");
  await mkdir(outDir, { recursive: true });

  let emitted = 0;
  const codes = [];
  for (const [code, file] of Object.entries(COVERS)) {
    const source = path.join(sourceDir, file);
    if (!existsSync(source)) continue;
    const names = await renderVariants(
      source,
      outDir,
      code.toLowerCase(),
      "sources",
    );
    emitted += names.length;
    codes.push(code);
  }
  return { emitted, codes };
}

async function buildBrand(archive, outRoot) {
  const sourceDir = path.join(archive, "repo-assets");
  const outDir = path.join(outRoot, "brand");
  await mkdir(outDir, { recursive: true });

  let emitted = 0;
  emitted += (await renderVariants(path.join(sourceDir, "sw5e-logo.png"), outDir, "logo", "brand")).length;
  emitted += (await renderVariants(path.join(sourceDir, "hero.jpg"), outDir, "hero-light", "hero")).length;
  emitted += (await renderVariants(path.join(sourceDir, "hero-dark.jpg"), outDir, "hero-dark", "hero")).length;
  return { emitted };
}

async function directoryBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(full);
    else {
      const { statSync } = await import("node:fs");
      total += statSync(full).size;
    }
  }
  return total;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  requireImageMagick();

  if (!existsSync(options.archive)) {
    throw new Error(
      `No archive at ${options.archive}. Pass --archive <path> to point at it.`,
    );
  }

  const outRoot = path.resolve(OUT_ROOT);
  await rm(outRoot, { recursive: true, force: true });
  await mkdir(outRoot, { recursive: true });

  // Species portraits are keyed by slug, so the slug list has to come from
  // whichever dataset this checkout has. The full generated set is preferred;
  // the committed fixture is the fallback.
  const datasetDir = existsSync(path.resolve("app/data/generated/manifest.json"))
    ? path.resolve("app/data/generated")
    : path.resolve("app/data/fixture");
  const summaries = JSON.parse(
    await import("node:fs").then((fs) =>
      fs.readFileSync(path.join(datasetDir, "species.summaries.json"), "utf8"),
    ),
  );
  const slugs = summaries.map((summary) => summary.slug);

  const species = await buildSpecies(options.archive, outRoot, slugs);
  const classes = await buildClasses(options.archive, outRoot);
  const sources = await buildSources(options.archive, outRoot);
  const brand = await buildBrand(options.archive, outRoot);

  await writeFile(
    path.join(outRoot, "README.md"),
    [
      "# Derived image assets",
      "",
      "Generated by `scripts/build-image-assets.mjs` from the legacy SW5e",
      "archive. Do not edit these by hand — rerun the script instead:",
      "",
      "```",
      "node scripts/build-image-assets.mjs --archive ../sw5e-legacy-archive",
      "```",
      "",
      "File names carry the pixel dimensions (`wookiee-224x358.webp`) because",
      "`app/content/imagery.ts` reads width and height off the URL to reserve",
      "each image's space before it loads.",
      "",
      `Species without a portrait (${species.without.length}): ` +
        `${species.without.join(", ") || "none"}.`,
      "",
    ].join("\n"),
  );

  const bytes = await directoryBytes(outRoot);
  const mb = (value) => `${(value / 1024 / 1024).toFixed(2)} MB`;

  console.log(`species portraits: ${species.emitted} files`);
  if (species.unmatched.length > 0) {
    console.log(`  unmatched source files: ${species.unmatched.join(", ")}`);
  }
  console.log(
    `  species with no portrait (${species.without.length}): ${species.without.join(", ") || "none"}`,
  );
  console.log(`class art: ${classes.emitted} files (${classes.classes.join(", ")})`);
  console.log(`book covers: ${sources.emitted} files (${sources.codes.join(", ")})`);
  console.log(`brand: ${brand.emitted} files`);
  console.log(`total committed: ${mb(bytes)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
