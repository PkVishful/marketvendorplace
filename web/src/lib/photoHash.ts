export async function randomPhotoSha256Hex(): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
