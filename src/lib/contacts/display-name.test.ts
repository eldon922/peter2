import { describe, expect, it } from "vitest";

import { contactDisplayName } from "./display-name";

describe("contactDisplayName", () => {
  it("shows the CRM name with the WhatsApp name in parentheses", () => {
    expect(
      contactDisplayName({ name: "Budi Santoso", profile_name: "budi_88", phone: "62812" }),
    ).toBe("Budi Santoso (budi_88)");
  });

  it("shows one name when both are the same", () => {
    expect(
      contactDisplayName({ name: "Budi", profile_name: "Budi", phone: "62812" }),
    ).toBe("Budi");
  });

  it("falls back to the profile name, then the phone", () => {
    expect(contactDisplayName({ name: null, profile_name: "Budi", phone: "62812" })).toBe("Budi");
    expect(contactDisplayName({ name: null, profile_name: null, phone: "62812" })).toBe("62812");
  });

  it("treats a name that is just the phone number as unset", () => {
    expect(
      contactDisplayName({ name: "62812", profile_name: "Budi", phone: "+62 812" }),
    ).toBe("Budi");
  });
});
