interface NamedContact {
  name?: string | null;
  profile_name?: string | null;
  phone: string;
}

const digits = (value: string) => value.replace(/\D/g, "");

/**
 * How a contact is labelled in the UI: "Name (WhatsApp name)" when the CRM
 * name and the customer's own WhatsApp profile name differ, otherwise
 * whichever exists, otherwise the phone number. A name that is just the
 * phone number (what a nameless contact is created with) counts as unset.
 */
export function contactDisplayName(contact: NamedContact): string {
  const rawName = contact.name?.trim() ?? "";
  const name = rawName && digits(rawName) !== digits(contact.phone) ? rawName : "";
  const profile = contact.profile_name?.trim() ?? "";
  if (name && profile && name !== profile) return `${name} (${profile})`;
  return name || profile || contact.phone;
}
