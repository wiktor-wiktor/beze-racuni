import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("ships the Bezenškova House product instead of starter preview UI", async () => {
  const [page, layout, styles, packageJson, hosting] = await Promise.all([
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/layout.tsx", root), "utf8"),
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL(".openai/hosting.json", root), "utf8"),
  ]);

  assert.match(page, /Bezenškova House/);
  assert.match(page, /Household feed/);
  assert.match(page, /Admin password/);
  assert.match(page, /Recipients & weights/);
  assert.match(layout, /Bezenškova House — Our shared bills/);
  assert.match(page, /aria-expanded=\{open\}/);
  assert.match(page, /IconPicker/);
  assert.match(page, /monthB\.localeCompare\(monthA\)/);
  assert.match(page, /className="feed-month"/);
  assert.match(page, /Last month \(\{monthName\(data\.featured\.month\)\}\)/);
  assert.match(page, /if \(month > data\.featured\.month\) return/);
  assert.match(page, /group\.month === data\.featured\.month \? " \(current\)"/);
  assert.doesNotMatch(page, /Bills, divided|One calm place/);
  assert.doesNotMatch(page, /SETTLED|Monthly total|Here is the final share/);
  assert.match(page, /♻/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  assert.match(styles, /\.feed-month\[data-tone="1"\]/);
  assert.doesNotMatch(styles, /data-archived/);
  assert.match(hosting, /"d1": "DB"/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
