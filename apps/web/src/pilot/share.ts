/** WhatsApp link that opens a chat picker with the text filled in. */
export const whatsappLink = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/**
 * Shares text through the phone's share sheet when there is one, else opens WhatsApp. Returns
 * false if the person closed the share sheet.
 */
export async function shareText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      await navigator.share({ text });
      return true;
    } catch {
      return false;
    }
  }
  window.open(whatsappLink(text), "_blank", "noopener");
  return true;
}

const toB64Url = (s: string) => btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64Url = (s: string) => atob(s.replace(/-/g, "+").replace(/_/g, "/"));

/** ASCII JSON → URL-safe parameter, and back (undefined if it is not valid base64url). */
export const toParam = (json: string) => toB64Url(JSON.stringify(JSON.parse(json)));
export function fromParam(param: string): string | undefined {
  try {
    return fromB64Url(param);
  } catch {
    return undefined;
  }
}
