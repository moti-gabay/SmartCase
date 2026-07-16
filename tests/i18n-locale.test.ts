import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPortalLocale,
  PORTAL_LOCALES,
  PORTAL_LOCALE_DIR,
  PORTAL_LOCALE_LABELS,
  portalDict,
} from "../src/lib/i18n/conversion-portal";

// Client.locale is a plain TEXT column, so isPortalLocale is the only thing
// standing between a stray DB/user value and an undefined dictionary lookup.
test("isPortalLocale accepts every supported locale", () => {
  for (const locale of PORTAL_LOCALES) {
    assert.ok(isPortalLocale(locale), `should accept ${locale}`);
  }
});

test("isPortalLocale rejects unsupported and non-string values", () => {
  for (const value of ["de", "HE", "", "he-IL", null, undefined, 42, {}, ["he"]]) {
    assert.equal(isPortalLocale(value), false, `should reject ${JSON.stringify(value)}`);
  }
});

test("every supported locale has a dictionary, label and direction", () => {
  for (const locale of PORTAL_LOCALES) {
    assert.ok(portalDict[locale], `missing dictionary for ${locale}`);
    assert.ok(PORTAL_LOCALE_LABELS[locale], `missing label for ${locale}`);
    assert.ok(PORTAL_LOCALE_DIR[locale], `missing direction for ${locale}`);
  }
});

// The rejection email picks its dir from the locale; Hebrew is the only RTL one.
test("only Hebrew is right-to-left", () => {
  assert.equal(PORTAL_LOCALE_DIR.he, "rtl");
  assert.equal(PORTAL_LOCALE_DIR.en, "ltr");
  assert.equal(PORTAL_LOCALE_DIR.fr, "ltr");
});
