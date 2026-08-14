import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyMetaWebhookSignature } from "./webhook-signature";

const SECRET = process.env.META_APP_SECRET!;

function signedHeader(body: string, secret: string = SECRET): string {
  const hex = crypto.createHmac("sha256", secret).update(body).digest("hex");
  return `sha256=${hex}`;
}

describe("verifyMetaWebhookSignature", () => {
  it("accepts a request signed with the correct secret", () => {
    const body = JSON.stringify({ object: "whatsapp_business_account" });
    expect(verifyMetaWebhookSignature(body, signedHeader(body))).toBe(true);
  });

  it("rejects a signature computed with a different secret", () => {
    const body = "{}";
    expect(verifyMetaWebhookSignature(body, signedHeader(body, "wrong"))).toBe(
      false,
    );
  });

  it("rejects when the body has been tampered with after signing", () => {
    const original = '{"entry":[]}';
    const header = signedHeader(original);
    const tampered = '{"entry":[{"id":"injected"}]}';
    expect(verifyMetaWebhookSignature(tampered, header)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyMetaWebhookSignature("anything", null)).toBe(false);
  });

  it("rejects a header without the sha256= prefix", () => {
    const body = "{}";
    const hex = crypto
      .createHmac("sha256", SECRET)
      .update(body)
      .digest("hex");
    expect(verifyMetaWebhookSignature(body, hex)).toBe(false);
    expect(verifyMetaWebhookSignature(body, `sha512=${hex}`)).toBe(false);
  });

  it("rejects a header of the wrong length without throwing", () => {
    // timingSafeEqual would throw on length mismatch — the guard inside
    // the verifier should catch this and return false instead.
    expect(verifyMetaWebhookSignature("{}", "sha256=tooshort")).toBe(false);
  });

  describe("fail-closed when secret is missing", () => {
    const originalSecret = process.env.META_APP_SECRET;
    beforeEach(() => {
      delete process.env.META_APP_SECRET;
    });
    afterEach(() => {
      process.env.META_APP_SECRET = originalSecret;
    });

    it("rejects even a correctly-formed signature when no secret is configured", () => {
      const body = "{}";
      // Use the original secret to produce the header so we can verify
      // the rejection is solely due to missing config.
      const header = signedHeader(body, originalSecret!);
      expect(verifyMetaWebhookSignature(body, header)).toBe(false);
    });
  });

  // Per-account App Secret (migration 041): the caller resolves the
  // secret from whatsapp_config and passes it in. The env var stays as
  // the fallback so deployments predating the column keep working.
  describe("per-account secret", () => {
    const ACCOUNT_SECRET = "account-scoped-secret";

    it("accepts a signature made with the passed-in secret", () => {
      const body = '{"entry":[]}';
      const header = signedHeader(body, ACCOUNT_SECRET);
      expect(verifyMetaWebhookSignature(body, header, ACCOUNT_SECRET)).toBe(
        true,
      );
    });

    it("takes precedence over the env var", () => {
      const body = '{"entry":[]}';
      // Signed with the env secret, but this account is configured with a
      // different one — it must NOT be accepted, or one tenant could sign
      // deliveries for another.
      const header = signedHeader(body, SECRET);
      expect(verifyMetaWebhookSignature(body, header, ACCOUNT_SECRET)).toBe(
        false,
      );
    });

    it("falls back to the env var when none is passed", () => {
      const body = '{"entry":[]}';
      const header = signedHeader(body, SECRET);
      expect(verifyMetaWebhookSignature(body, header, null)).toBe(true);
      expect(verifyMetaWebhookSignature(body, header, undefined)).toBe(true);
    });

    it("falls back to the env var when the stored secret is an empty string", () => {
      // A row with app_secret set to '' should behave like "not
      // configured", not like a secret of zero length.
      const body = '{"entry":[]}';
      const header = signedHeader(body, SECRET);
      expect(verifyMetaWebhookSignature(body, header, "")).toBe(true);
    });
  });
});
