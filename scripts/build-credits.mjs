#!/usr/bin/env node
/**
 * Builds the site's credits document from the canonical content set.
 *
 *   node scripts/build-credits.mjs --content ../sw5e-database/content
 *
 * Deliberately not part of `build-content-fixture.mjs`, and deliberately not
 * split into a curated sample and a generated full set the way the game
 * content is. That split exists because a contributor without the archive
 * still needs the UI to render, and four species is enough to prove a species
 * page works. Credits do not work that way: four patrons out of three hundred
 * and eighty-four is not a smaller version of the credits, it is a wrong one,
 * and it would be wrong in the specific way that matters here — it would leave
 * people out. So there is one document, it is complete, and it is committed.
 *
 * It is regenerated only when the canonical credits change, which is why this
 * is a script somebody runs rather than a build step: the output is reviewed
 * like the content it came from.
 *
 * Output: `app/data/credits.json`, holding the categories in their authored
 * order with their people nested inside, plus every asset citation keyed by
 * "<group>/<key>". Nesting rather than two flat lists is what stops a renderer
 * from accidentally showing one undifferentiated roll of names: there is no
 * "all credits" array in the file to map over.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const OUTPUT = "app/data/credits.json";

function parseArguments(argv) {
  const options = { content: "../sw5e-database/content", out: OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--content") options.content = argv[++index];
    else if (argument.startsWith("--content=")) options.content = argument.slice(10);
    else if (argument === "--out") options.out = argv[++index];
    else if (argument.startsWith("--out=")) options.out = argument.slice(6);
    else throw new Error(`Unrecognized argument: ${argument}`);
  }
  return options;
}

/** Every JSON document in one canonical type directory, by file order. */
async function readType(contentDirectory, type) {
  const directory = path.join(contentDirectory, type);

  let names;
  try {
    names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  } catch {
    throw new Error(
      `Cannot read ${directory}. Pass --content <dir> pointing at the ` +
        "`content` directory of a sw5e-database checkout.",
    );
  }

  if (names.length === 0) {
    throw new Error(`${directory} holds no documents, so the credits would be empty.`);
  }

  return Promise.all(
    names.map(async (name) =>
      JSON.parse(await readFile(path.join(directory, name), "utf8")),
    ),
  );
}

function byOrder(left, right) {
  return left.order - right.order;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const contentDirectory = path.resolve(options.content);

  const [categories, credits, assetCredits] = await Promise.all([
    readType(contentDirectory, "credit-category"),
    readType(contentDirectory, "credit"),
    readType(contentDirectory, "asset-credit"),
  ]);

  const known = new Set(categories.map((category) => category.key));
  const orphans = credits.filter((credit) => !known.has(credit.categoryKey));
  if (orphans.length > 0) {
    // Grouping is by category, so an unmatched key does not misfile somebody:
    // it drops them off the page entirely, silently, which is the one failure
    // this whole feature exists to stop.
    throw new Error(
      `${orphans.length} credit(s) name a category that does not exist: ` +
        `${orphans.map((credit) => `${credit.key} -> ${credit.categoryKey}`).join(", ")}`,
    );
  }

  // No generation timestamp. The file is committed and reviewed like content,
  // so a field that changes on every run would put noise in every diff and
  // make a real change to somebody's credit harder to see.
  const document = {
    categories: [...categories].sort(byOrder).map((category) => ({
      key: category.key,
      title: category.title,
      description: category.description ?? null,
      note: category.note ?? null,
      people: credits
        .filter((credit) => credit.categoryKey === category.key)
        .sort(byOrder)
        .map((credit) => ({
          key: credit.key,
          name: credit.name,
          contribution: credit.contribution ?? null,
          link: credit.link ?? null,
        })),
    })),
    assets: Object.fromEntries(
      [...assetCredits]
        .sort((left, right) => left.key.localeCompare(right.key, "en"))
        .map((credit) => [
          `${credit.assetGroup}/${credit.assetKey}`,
          {
            status: credit.status,
            artist: credit.artist ?? null,
            workTitle: credit.workTitle ?? null,
            provenance: credit.provenance,
            basis: credit.basis,
            basisNote: credit.basisNote ?? null,
            link: credit.link ?? null,
          },
        ]),
    ),
  };

  const file = path.resolve(options.out);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(document, null, 2)}\n`, "utf8");

  const people = document.categories.reduce(
    (sum, category) => sum + category.people.length,
    0,
  );
  const cited = Object.values(document.assets).filter(
    (asset) => asset.status === "cited",
  ).length;

  process.stdout.write(
    `${people} people across ${document.categories.length} categories\n` +
      `${Object.keys(document.assets).length} asset citations ` +
      `(${cited} cited, ${Object.keys(document.assets).length - cited} inherited)\n` +
      `written to ${path.relative(process.cwd(), file)}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
