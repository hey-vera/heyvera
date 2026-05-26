# R2 Media Setup — media.heyvera.org

Step-by-step guide for connecting Cloudflare R2 to the HeyVera media upload pipeline.

---

## 1. Create the R2 Bucket

1. Log in to [Cloudflare dashboard](https://dash.cloudflare.com) and select your account.
2. Navigate to **R2 Object Storage** in the left sidebar.
3. Click **Create bucket**.
4. Name the bucket `heyvera-media` (or your preferred name — must match `STORAGE_BUCKET` below).
5. Choose a region close to your primary user base (or **Automatic**).
6. Click **Create bucket**.

---

## 2. Set Up a Custom Domain

1. In the R2 dashboard, open the `heyvera-media` bucket.
2. Click **Settings → Custom domains → Connect domain**.
3. Enter `media.heyvera.org`.
4. Cloudflare will automatically create a CNAME DNS record — confirm it.
5. Wait for the domain to become active (usually under 1 minute on Cloudflare-hosted zones).

After activation, objects are publicly readable at:
```
https://media.heyvera.org/<object-key>
```

---

## 3. Create R2 API Credentials

1. In the R2 dashboard, click **Manage R2 API tokens**.
2. Click **Create API token**.
3. Set permissions: **Object Read & Write** on the `heyvera-media` bucket only.
4. Copy the **Access Key ID** and **Secret Access Key** — they are shown only once.

---

## 4. Required Environment Variables

Set these on the Cortex API server (`.env` or system environment):

```env
# R2 S3-compatible endpoint (replace ACCOUNT_ID with your Cloudflare account ID)
STORAGE_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com

# Bucket name (must match what you created in step 1)
STORAGE_BUCKET=heyvera-media

# Credentials from step 3
STORAGE_ACCESS_KEY=<Access Key ID>
STORAGE_SECRET_KEY=<Secret Access Key>

# Public base URL for serving uploaded media
STORAGE_PUBLIC_URL=https://media.heyvera.org
```

---

## 5. CORS Configuration for the R2 Bucket

In the R2 dashboard, open `heyvera-media → Settings → CORS policy`, paste:

```json
[
  {
    "AllowedOrigins": [
      "https://heyvera.org",
      "https://www.heyvera.org",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Save the policy. This allows the web frontend to upload directly to R2 via presigned URLs and to read media assets.

---

## 6. Test Upload Flow with curl

### 6a. Request a presigned upload URL

```bash
curl -s -X POST https://api.heyvera.org/v1/social/media/upload-url \
  -H "Authorization: Bearer <clerk-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"content_type": "image/jpeg", "file_name": "avatar.jpg"}'
```

Response:
```json
{
  "upload_url": "https://<ACCOUNT_ID>.r2.cloudflarestorage.com/heyvera-media/media/<id>.jpg?X-Amz-...",
  "media_id": "media_<uuid>",
  "public_url": "https://media.heyvera.org/media/<id>.jpg"
}
```

### 6b. Upload the file directly to R2

```bash
curl -s -X PUT "<upload_url>" \
  -H "Content-Type: image/jpeg" \
  --data-binary @avatar.jpg
```

### 6c. Finalize the upload

```bash
curl -s -X POST https://api.heyvera.org/v1/social/media/<media_id>/finalize \
  -H "Authorization: Bearer <clerk-session-token>"
```

After finalization the asset is available at the `public_url` returned in step 6a.

---

## Notes

- Presigned URLs expire after 15 minutes. Finalize promptly after upload.
- Maximum upload size is currently 10 MB (enforced at the API layer).
- The `STORAGE_ENDPOINT` uses the S3-compatible API. Do not use the R2 dashboard URL.
- Never commit `STORAGE_ACCESS_KEY` or `STORAGE_SECRET_KEY` to the repository.
