# Buffer Launch Integration

`tools/buffer_launch.mjs` is the launch-day Buffer (Twitter/X) helper for Wayfarer Online. It queues, schedules, and inspects posts without accidentally publishing anything — every write defaults to `dryRun` mode.

## Setup

1. Make sure `.env` contains your Buffer token:

   ```env
   BUFFER_API_KEY=your_buffer_token_here
   ```

2. `.env` is already gitignored. **Never commit it.**

3. Install Node dependencies (fetch is built into modern Node, no extra package needed):

   ```bash
   node --version   # v18+ recommended
   ```

## Finding your X profile id

Buffer posts are routed to a profile/service id, not just a screen name.

```js
import { listProfiles } from "./tools/buffer_launch.mjs";

const profiles = await listProfiles();
console.log(profiles.map((p) => ({ id: p.id, service: p.service, handle: p.service_username })));
```

Save the profile id whose `service` is `twitter` (or `x`) for the posts below.

## Functions

### `queuePost(text, options)`

Queue or schedule a post. Defaults to dry-run.

```js
import { queuePost } from "./tools/buffer_launch.mjs";

// Preview only — nothing is sent
const preview = await queuePost("Wayfarer Online is live! 🚀", {
  profileId: "YOUR_X_PROFILE_ID",
  mediaUrls: ["https://wayfarer.online/launch-card.png"],
  scheduledAt: new Date("2026-10-03T09:00:00-07:00"),
});
console.log(preview);

// Actually submit to Buffer
const real = await queuePost("Wayfarer Online is live! 🚀", {
  profileId: "YOUR_X_PROFILE_ID",
  scheduledAt: new Date("2026-10-03T09:00:00-07:00"),
  sendNow: true,
});
console.log(real);
```

Options:

- `profileId` (required) — Buffer profile id for the X account.
- `mediaUrls` (optional) — Array of image/video URLs.
- `scheduledAt` (optional) — `Date` or ISO-8601 string.
- `sendNow` (optional, default `false`) — Set `true` to actually create the update.

### `listPendingPosts(profileId, count = 10)`

List queued/scheduled updates.

```js
import { listPendingPosts } from "./tools/buffer_launch.mjs";

const pending = await listPendingPosts("YOUR_X_PROFILE_ID", 20);
console.log(pending);
```

### `getPostAnalytics(postId)`

Fetch interactions/analytics for a sent update.

```js
import { getPostAnalytics } from "./tools/buffer_launch.mjs";

const stats = await getPostAnalytics("UPDATE_ID_HERE");
console.log(stats);
```

### `getComments(postId)`

Returns the update object plus interactions. Buffer’s Publish API does not expose native replies/comments; for full reply threads use the X API v2.

```js
import { getComments } from "./tools/buffer_launch.mjs";

const { update, interactions } = await getComments("UPDATE_ID_HERE");
```

### `listProfiles()`

List available Buffer profiles.

```js
import { listProfiles } from "./tools/buffer_launch.mjs";
```

## CLI smoke test

```bash
node tools/buffer_launch.mjs YOUR_X_PROFILE_ID
```

This only performs a dry-run preview; it never sends a real post.

## Launch-Day Checklist

- [ ] `.env` has a valid `BUFFER_API_KEY` and is gitignored.
- [ ] `listProfiles()` returns the X/Twitter profile and you saved its `id`.
- [ ] `queuePost(...)` preview output looks correct (text, media, scheduled time).
- [ ] At least one launch post is queued with `sendNow: true` and `scheduledAt`.
- [ ] `listPendingPosts(profileId)` shows the queued launch post.
- [ ] Analytics/comment polling command is ready to run after posts go live.
- [ ] No secrets are committed (`git status` shows `.env` untracked/ignored).
