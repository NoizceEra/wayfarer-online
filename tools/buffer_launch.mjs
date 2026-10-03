/**
 * Buffer Launch Integration for Wayfarer Online
 *
 * A thin, read-only-ish wrapper around the Buffer Publish API for
 * launch-day Twitter/X orchestration.  It can queue drafts and
 * schedule them, but by default every mutating call runs in dryRun
 * mode.  Pass sendNow=true to actually submit to Buffer.
 *
 * Environment:
 *   BUFFER_API_KEY  - Buffer access token (from .env or env var)
 *   BUFFER_BASE_URL - Optional. Defaults to https://api.bufferapp.com/1
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_BASE_URL = "https://api.bufferapp.com/1";

function loadEnv(path = ".env") {
  const envPath = resolve(process.cwd(), path);
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const [, key, raw] = m;
    if (process.env[key] === undefined) {
      process.env[key] = raw.replace(/^["']|["']$/g, "");
    }
  }
}

loadEnv();

const API_KEY = process.env.BUFFER_API_KEY;
const BASE_URL = (process.env.BUFFER_BASE_URL || DEFAULT_BASE_URL).replace(/\/$/, "");

function authHeaders() {
  if (!API_KEY) {
    throw new Error(
      "BUFFER_API_KEY is missing. Add it to .env (DO NOT commit .env)."
    );
  }
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
}

function encodeBody(payload) {
  return new URLSearchParams(payload).toString();
}

async function bufferFetch(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });

  let body;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }

  if (!res.ok) {
    const err = new Error(
      `Buffer API error ${res.status}: ${body.message || body.error || text || "unknown"}`
    );
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function assertProfileId(profileId) {
  if (!profileId || typeof profileId !== "string") {
    throw new Error("A valid Buffer profile/service id is required.");
  }
}

/**
 * Queue or schedule a post to Buffer.
 *
 * @param {string} text         Post text (280 chars recommended for X).
 * @param {object} options
 * @param {string} options.profileId   Buffer profile id for the X account.
 * @param {string[]} [options.mediaUrls] Optional image/video URLs.
 * @param {Date|string} [options.scheduledAt] Optional ISO-8601 / Date.
 * @param {boolean} [options.sendNow=false] If true, actually submit to Buffer.
 * @returns {Promise<object>} Buffer response or dry-run preview.
 */
export async function queuePost(text, options = {}) {
  const {
    profileId,
    mediaUrls = [],
    scheduledAt,
    sendNow = false,
  } = options;

  assertProfileId(profileId);

  if (!text || typeof text !== "string") {
    throw new Error("Post text is required.");
  }

  const payload = {
    text,
    profile_ids: [profileId],
  };

  if (mediaUrls.length) {
    payload.media = JSON.stringify({
      link: mediaUrls[0],
      photo: mediaUrls[0],
      thumbnail: mediaUrls[0],
    });
  }

  if (scheduledAt) {
    const when = scheduledAt instanceof Date ? scheduledAt.toISOString() : scheduledAt;
    payload.scheduled_at = when;
  }

  if (!sendNow) {
    return {
      dryRun: true,
      note: "No request sent. Pass sendNow=true to queue for real.",
      endpoint: "/updates/create.json",
      payload,
    };
  }

  return bufferFetch("/updates/create.json", {
    method: "POST",
    body: encodeBody(payload),
  });
}

/**
 * List pending (queued/scheduled) updates for a profile.
 *
 * @param {string} profileId
 * @param {number} [count=10]
 * @returns {Promise<object[]>}
 */
export async function listPendingPosts(profileId, count = 10) {
  assertProfileId(profileId);
  return bufferFetch(`/profiles/${encodeURIComponent(profileId)}/updates/pending.json?count=${count}`);
}

/**
 * Fetch analytics for a sent update.
 *
 * @param {string} postId
 * @returns {Promise<object>}
 */
export async function getPostAnalytics(postId) {
  if (!postId) throw new Error("postId is required.");
  return bufferFetch(`/updates/${encodeURIComponent(postId)}/interactions.json`);
}

/**
 * Read comments / replies for an update.
 *
 * Buffer does not expose native comments on the Publish API; this function
 * returns the update object plus the interactions payload as a placeholder.
 * Replace with a Twitter/X API call when native comment access is needed.
 *
 * @param {string} postId
 * @returns {Promise<object>}
 */
export async function getComments(postId) {
  if (!postId) throw new Error("postId is required.");
  const update = await bufferFetch(`/updates/${encodeURIComponent(postId)}.json`);
  const interactions = await getPostAnalytics(postId);
  return {
    postId,
    update,
    interactions,
    note: "Buffer Publish API has no direct comments endpoint; use X API v2 for replies.",
  };
}

/**
 * List Buffer profiles so you can find the X profile id.
 * @returns {Promise<object[]>}
 */
export async function listProfiles() {
  return bufferFetch("/profiles.json");
}

// CLI smoke-test (dry run only)
if (import.meta.url === `file://${process.argv[1]}`) {
  const profileId = process.argv[2];
  if (!profileId) {
    console.error("Usage: node tools/buffer_launch.mjs <BUFFER_PROFILE_ID>");
    process.exit(1);
  }

  console.log("Buffer launch module loaded.");
  console.log("API key present:", API_KEY ? "yes" : "NO");
  console.log("Base URL:", BASE_URL);

  const preview = await queuePost("Wayfarer Online is live! 🚀", {
    profileId,
    scheduledAt: new Date(Date.now() + 60 * 60 * 1000),
  });
  console.log("Dry-run preview:", JSON.stringify(preview, null, 2));
}
