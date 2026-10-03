import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Object storage abstraction.
 *   Cloudflare → R2 bucket bound as `MEDIA`
 *   Local dev / `next start` → ./.data/uploads on disk (no binding available)
 * Bytes NEVER go into Postgres; only the object key does.
 */
interface R2Like {
  put(key: string, value: ArrayBuffer, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
}

function bucket(): R2Like | null {
  try {
    const env = getCloudflareContext().env as { MEDIA?: R2Like };
    return env.MEDIA ?? null;
  } catch {
    return null;
  }
}

const LOCAL_DIR = ".data/uploads";
const CT_BY_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

async function localPath(key: string) {
  const path = await import("node:path");
  const root = path.resolve(process.cwd(), LOCAL_DIR);
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error("bad key"); // traversal guard
  return { full, path };
}

export async function putObject(key: string, bytes: ArrayBuffer, contentType: string) {
  const b = bucket();
  if (b) return void (await b.put(key, bytes, { httpMetadata: { contentType } }));
  const fs = await import("node:fs/promises");
  const { full, path } = await localPath(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, Buffer.from(bytes));
}

export async function getObject(key: string): Promise<{ body: BodyInit; contentType: string } | null> {
  const ext = key.split(".").pop() ?? "";
  const contentType = CT_BY_EXT[ext];
  if (!contentType) return null;
  const b = bucket();
  if (b) {
    const obj = await b.get(key);
    return obj ? { body: obj.body, contentType } : null;
  }
  try {
    const fs = await import("node:fs/promises");
    const { full } = await localPath(key);
    return { body: new Uint8Array(await fs.readFile(full)), contentType };
  } catch {
    return null;
  }
}

export async function deleteObject(key: string | null | undefined) {
  if (!key) return;
  try {
    const b = bucket();
    if (b) return void (await b.delete(key));
    const fs = await import("node:fs/promises");
    const { full } = await localPath(key);
    await fs.rm(full, { force: true });
  } catch (e) {
    console.error("[storage] delete failed", e);
  }
}

export const mediaUrl = (key: string | null | undefined) => (key ? `/api/media/${key}` : null);
