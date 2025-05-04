# raindrop-to-ghost-sync

**raindrop-to-ghost-sync** is a serverless Google Cloud Function that syncs your [Raindrop.io](https://raindrop.io) bookmarks to your [Ghost](https://ghost.org) blog. It allows you to automatically publish curated bookmarks (tagged with `1`), along with notes and highlights, directly to your blog—ideal for public linkrolls or personal reading lists.

> ✨ For a high-level overview and design rationale, check out [this post](https://danielraffel.me/2024/01/30/intriguing-stuff/).

---

## ✨ Features

- **Automatic Publishing**: Syncs the most recent Raindrop bookmark with tag `1` to your Ghost blog.
- **Update Detection**: If the bookmark was already synced, the corresponding Ghost post will be updated (not duplicated).
- **Clean Formatting**: Notes and highlights are wrapped in semantic HTML and stored in a Ghost HTML card block.
- **Metadata Embedded**: Posts include embedded metadata (like Raindrop ID and tags) for filtering or custom display logic.
- **RSS Feed Friendly**: Works well with Ghost’s RSS system to support custom feeds using the `links` tag.

---

## ⚙️ Technical Stack

- **Google Cloud Functions** (Gen 2, Node.js 20)
- **Google Cloud Scheduler** (optional): Automates sync on a recurring schedule
- **Raindrop REST API**: Fetches bookmarks
- **Ghost Admin API**: Publishes or updates blog posts
- **Node.js Libraries**: `axios`, `@tryghost/admin-api`, `@google-cloud/functions-framework`

---

## 🚀 Setup Instructions

### 1. Prerequisites

Before you begin, make sure you have:

#### 🛠️ Google Cloud Setup

- A [Google Cloud Platform (GCP)](https://cloud.google.com/) account
- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) installed and authenticated if you want to deploy locally
- [Node.js and npm](https://nodejs.org/) installed (required to install dependencies and deploy the function via Google Cloud CLI)

#### 🔖 A Raindrop Integration Configured

- A [Raindrop.io developer integration](https://developer.raindrop.io/v1/authentication)
- A **test token** (used as the `RAINDROP_API_KEY` environment variable)
- A **Raindrop Premium** account if you want notes on highlights to appear in Ghost

#### 👻 Ghost Setup

- A Ghost blog with [Admin API](https://ghost.org/docs/admin-api/) access
- A **Ghost Admin API Key** and blog URL  
  (Found under *Ghost Admin → Settings → Integrations → Add Custom Integration*)

---

### 2. Clone the Repository

```bash
git clone https://github.com/danielraffel/raindrop-to-ghost-sync.git
cd raindrop-to-ghost-sync
```


---

### 3. Install Dependencies
```
npm install
```


---

### 4. Set Environment Variables

You’ll need to define the following variables when deploying:

| Variable             | Description                                                                 |
|----------------------|-----------------------------------------------------------------------------|
| `RAINDROP_API_KEY`   | Your Raindrop test token                                                    |
| `GHOST_API_URL`      | Your Ghost blog URL (e.g. `https://yourdomain.com`)                         |
| `GHOST_ADMIN_API_KEY`| Your Ghost Admin API key (`<id>:<secret>`)                                  |
| `SYNC_SECRET`        | A token you’ll use in the `Authorization` header to trigger syncs securely  |


---

### 5. Deploy to Google Cloud Functions
```
gcloud functions deploy raindropToGhostSync \
  --gen2 \
  --runtime nodejs20 \
  --trigger-http \
  --region YOUR_REGION \
  --entry-point raindropToGhostSync \
  --set-env-vars RAINDROP_API_KEY=YOUR_RAINDROP_KEY,GHOST_API_URL=https://yourdomain.com,GHOST_ADMIN_API_KEY=YOUR_ADMIN_KEY,SYNC_SECRET=YOUR_SECRET
```

📌 Replace:
-	YOUR_REGION with a region like us-central1
-	YOUR_* placeholders with your actual credentials

When prompted:
```
Allow unauthenticated invocations of new function [raindropToGhostSync]? (y/N)? y
```


---

### 🧪 Testing the Function

Trigger the sync manually with curl:
```
curl -X POST https://REGION-PROJECT.cloudfunctions.net/raindropToGhostSync \
  -H "Authorization: Bearer YOUR_SECRET"
```
To verify your Raindrop bookmarks are being tagged:
```
curl -H "Authorization: Bearer YOUR_RAINDROP_API_KEY" \
  "https://api.raindrop.io/rest/v1/raindrops/0?tag=1"
```


---

### 🔁 Updating the Function

If you make changes to index.js, re-deploy using:
```
gcloud functions deploy raindropToGhostSync \
  --gen2 \
  --runtime nodejs20 \
  --trigger-http \
  --region YOUR_REGION \
  --entry-point raindropToGhostSync
```
✅ You do not need to re-set environment variables unless they change.

---

### ⏰ Automate with Google Cloud Scheduler

To run the sync every minute:
```
gcloud scheduler jobs create http raindrop-ghost-sync \
  --schedule="* * * * *" \
  --uri=https://REGION-PROJECT.cloudfunctions.net/raindropToGhostSync \
  --http-method=POST \
  --oauth-service-account-email=YOUR_SCHEDULER_SERVICE_ACCOUNT \
  --headers="Authorization: Bearer YOUR_SECRET" \
  --attempt-deadline=540s
```


---

### 🔧 What to Customize in index.js

By default, the function looks for the most recent bookmark tagged with 1. You can change this by editing the tag filter in getLatestRaindropBookmark():
```
params: {
  tag: '1', // ← change this to your preferred tag (e.g. 'publish', 'linkroll')
  sort: '-created',
  perpage: 10
}
```
You can also adjust:
-	How the post content is formatted (inside formatGhostContent)
-	The logic for filtering out empty bookmarks (via shouldProcessBookmark)
-	Any HTML structure or metadata formatting as needed

---

### 📌 To Do (maybe / doubtful)
-	Add deletion support: Remove Ghost posts if the corresponding Raindrop no longer has tag 1
  -	Strategy: Retrieve all links-tagged Ghost posts → extract raindrop-id from each → query Raindrop API → if tag is missing, delete the post
  -	Consider adding a simple database or caching layer to avoid redundant API calls
-	Add support for a .env file

---

### 📄 License

MIT License.
