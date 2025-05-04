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
-	RAINDROP_API_KEY with your Raindrop test token
- GHOST_API_URL with your Ghost Admin API key
- GHOST_ADMIN_API_KEY with your YOUR_ADMIN_KEY
-	SYNC_SECRET with your token

When prompted:
```
Allow unauthenticated invocations of new function [raindropToGhostSync]? (y/N)? y
```


---

### 🧪 Testing the Function

Trigger the sync manually with curl using your SYNC_SECRET:
```
curl -X POST https://REGION-PROJECT.cloudfunctions.net/raindropToGhostSync \
  -H "Authorization: Bearer YOUR_SECRET"
```
To verify your Raindrop bookmarks are being tagged using YOUR_RAINDROP_API_KEY:
```
curl -H "Authorization: Bearer YOUR_RAINDROP_API_KEY" \
  "https://api.raindrop.io/rest/v1/raindrops/0?tag=1"
```


---

### 🔁 Updating the Function

If you make changes to index.js, re-deploy using YOUR_REGION:
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

To run your Raindrop → Ghost sync automatically every minute, use Google Cloud Scheduler to call your function on a recurring schedule.

---

#### ✅ Step 1: Grant Invoke Permissions

Cloud Scheduler needs permission to call your Cloud Function. Run:
```
gcloud functions add-iam-policy-binding raindropToGhostSync \
  --region=us-central1 \
  --member="serviceAccount:SERVICE_ACCOUNT_EMAIL" \
  --role="roles/cloudfunctions.invoker"
```
Replace SERVICE_ACCOUNT_EMAIL with the service account Scheduler will use.

To find that email:

In most cases, the default is:
```
PROJECT_ID@appspot.gserviceaccount.com
```
You can confirm this in the IAM section of the Cloud Console or by running:
```
gcloud iam service-accounts list
```

---

#### ✅ Step 2: Create the Scheduler Job

Once the correct service account has access, create the job (update this with your region, your cloud function URI, and your SYNC_SECRET :

```
gcloud scheduler jobs create http raindrop-ghost-sync \
  --location=us-central1 \
  --schedule="* * * * *" \
  --uri=https://us-central1-YOUR_PROJECT.cloudfunctions.net/raindropToGhostSync \
  --http-method=POST \
  --headers="Authorization=Bearer ${SYNC_SECRET}" \
  --attempt-deadline=540s
```
🔐 This sends your pre-defined SYNC_SECRET as a bearer token in the Authorization header. Your Cloud Function should reject requests that don’t include this.

---

### 🧪 Manual Test (Optional)

You can test the sync manually by running:
```
gcloud scheduler jobs run raindrop-ghost-sync --location=us-central1
```
Check your function logs to confirm it was triggered successfully:
```
gcloud functions logs read raindropToGhostSync --region=us-central1 --limit=10
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
