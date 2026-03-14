# 🦊 FoxShare — Complete Setup Guide
**From AWS to Vercel**
*Last updated: March 2026*

---

## Overview

FoxShare is a secure, encrypted file vault built on:

| Layer | Service |
|---|---|
| Frontend | Vercel (static HTML + API proxy) |
| Authentication | AWS Cognito (MFA enabled) |
| File Storage | AWS S3 (KMS encrypted) |
| Backend Logic | AWS Lambda + API Gateway |
| Encryption | AWS KMS |

---

## Prerequisites

- AWS account with admin access
- Vercel account (free tier works)
- Node.js installed locally (for Vercel CLI)
- FoxShare zip file (`foxshare-v3-fixed.zip`)

---

## Part 1 — AWS KMS (Encryption Key)

### 1.1 Create a KMS Key

1. Go to **AWS Console → KMS → Customer managed keys**
2. Click **Create key**
3. Key type: **Symmetric**
4. Key usage: **Encrypt and decrypt**
5. Give it an alias e.g. `foxshare-key`
6. Set key administrators (your IAM user)
7. Set key users — add the Lambda execution role (you'll create this later, come back and add it)
8. Click **Finish**
9. Copy the **Key ARN** — you'll need it later

---

## Part 2 — AWS S3 (File Storage)

### 2.1 Create the S3 Bucket

1. Go to **AWS Console → S3 → Create bucket**
2. Give it a name e.g. `foxshare-files`
3. Region: choose your preferred region (remember it — use the same region for everything)
4. **Block all public access** — leave this ON (files are served via presigned URLs only)
5. Enable **Bucket Versioning** (optional but recommended)
6. Under **Default encryption**:
   - Encryption type: **SSE-KMS**
   - AWS KMS key: select the key you created in Part 1
7. Click **Create bucket**

### 2.2 Configure CORS on the Bucket

1. Open your bucket → **Permissions** tab → **Cross-origin resource sharing (CORS)**
2. Click **Edit** and paste:

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "POST", "PUT"],
    "AllowedOrigins": ["*"],
    "ExposeHeaders": ["ETag", "Content-Disposition", "Content-Length", "Content-Type"]
  }
]
```

3. Click **Save changes**

> ⚠️ The `ExposeHeaders` list is critical — without `Content-Disposition`, downloads will redirect away from the app instead of saving silently.

---

## Part 3 — AWS Cognito (Authentication + MFA)

### 3.1 Create a User Pool

1. Go to **AWS Console → Cognito → User pools → Create user pool**
2. **Sign-in options:** select **Email**
3. Click **Next**
4. **Password policy:** set minimum 8 characters, require numbers and symbols
5. **MFA:** select **Required** → **Authenticator apps (TOTP)**
6. Click **Next**
7. **Self-service sign-up:** enable it
8. **Required attributes:** add `email`
9. **Optional attributes:** add `preferred_username` (used as display name)
10. Click **Next** through email settings (use Cognito's default email sender for now)
11. **User pool name:** e.g. `foxshare-users`
12. Click **Next**

### 3.2 Create an App Client

1. Still in the User Pool setup → **App clients**
2. Click **Add an app client**
3. App type: **Public client**
4. App client name: e.g. `foxshare-web`
5. **Authentication flows:** enable `ALLOW_USER_PASSWORD_AUTH` and `ALLOW_REFRESH_TOKEN_AUTH`
6. **No client secret** (public client)
7. Click **Create user pool**

### 3.3 Copy Your IDs

From the User Pool dashboard, copy:
- **User Pool ID** — looks like `us-east-1_xxxxxxxxx` → this is your `POOL_ID`
- **App client ID** — from the App clients tab → this is your `CLIENT_ID`

---

## Part 4 — AWS IAM (Lambda Execution Role)

### 4.1 Create the Lambda Role

1. Go to **AWS Console → IAM → Roles → Create role**
2. Trusted entity: **AWS service → Lambda**
3. Attach these policies:
   - `AWSLambdaBasicExecutionRole` (for CloudWatch logs)
   - Create a custom inline policy (see below)
4. Name the role e.g. `foxshare-lambda-role`

### 4.2 Custom Inline Policy

Click **Add inline policy** and paste:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GeneratePresignedUrl"
      ],
      "Resource": [
        "arn:aws:s3:::YOUR-BUCKET-NAME",
        "arn:aws:s3:::YOUR-BUCKET-NAME/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:GenerateDataKey",
        "kms:Decrypt",
        "kms:DescribeKey"
      ],
      "Resource": "YOUR-KMS-KEY-ARN"
    }
  ]
}
```

Replace `YOUR-BUCKET-NAME` and `YOUR-KMS-KEY-ARN` with your actual values.

5. Now go back to KMS → your key → **Key users** → add this Lambda role

---

## Part 5 — AWS Lambda Functions

You need **4 Lambda functions**. Each uses the same execution role from Part 4.

Go to **AWS Console → Lambda → Create function** for each one:
- Runtime: **Python 3.12**
- Execution role: select the role from Part 4

### Environment Variables (set on each Lambda)

| Variable | Value |
|---|---|
| `BUCKET_NAME` | Your S3 bucket name |
| `KMS_KEY_ARN` | Your KMS key ARN |

---

### Lambda 1 — File Upload (`fileupload`)

Handles generating a presigned POST URL for direct S3 uploads.

**Environment variables:** `BUCKET_NAME`, `KMS_KEY_ARN`, `MAX_SIZE` (default `50`)

Paste the upload Lambda code and click **Deploy**.

---

### Lambda 2 — File List (`filelist`)

Lists all files belonging to the authenticated user.

**Environment variables:** `BUCKET_NAME`

---

### Lambda 3 — File Share / Download (`fileshare`)

Generates presigned URLs for downloading and sharing files.

**Environment variables:** `BUCKET_NAME`, `SHARE_EXPIRY_HOURS` (default `24`)

> ⚠️ This Lambda must return both `download_url` (with `ResponseContentDisposition: attachment`) and `share_url` (TinyURL shortened). See the patched `fileshare_lambda.py` included in the zip.

---

### Lambda 4 — File Delete (`filedelete`)

Deletes a file from S3.

**Environment variables:** `BUCKET_NAME`

---

## Part 6 — AWS API Gateway

### 6.1 Create the API

1. Go to **AWS Console → API Gateway → Create API**
2. Choose **REST API** → **Build**
3. API name: e.g. `foxshare-api`
4. Click **Create API**

### 6.2 Add Cognito Authorizer

1. In your API → **Authorizers → Create authorizer**
2. Name: `CognitoAuth`
3. Type: **Cognito**
4. Cognito user pool: select the one from Part 3
5. Token source: `Authorization`
6. Click **Create**

### 6.3 Create Resources and Methods

Create the following structure:

```
/files
  GET     → filelist Lambda    (with CognitoAuth)
  POST    → fileupload Lambda  (with CognitoAuth)
  OPTIONS → (CORS mock)

/files/download
  GET     → fileshare Lambda   (with CognitoAuth)
  OPTIONS → (CORS mock)

/files/share
  GET     → fileshare Lambda   (with CognitoAuth)
  OPTIONS → (CORS mock)

/files/delete
  DELETE  → filedelete Lambda  (with CognitoAuth)
  OPTIONS → (CORS mock)
```

For each method:
1. Click the method → **Integration type: Lambda Function**
2. Select the correct Lambda
3. Check **Use Lambda Proxy integration**
4. Set the **Authorization** to `CognitoAuth`

For each `OPTIONS` method:
1. Integration type: **Mock**
2. After creating, add these response headers to the method response:
   - `Access-Control-Allow-Origin`
   - `Access-Control-Allow-Headers`
   - `Access-Control-Allow-Methods`
3. In the Integration Response, map them to:
   - `'*'`
   - `'Content-Type,Authorization'`
   - `'OPTIONS,GET,POST,DELETE'`

### 6.4 Enable CORS on Each Resource

For each resource (`/files`, `/files/download`, etc.):
1. Click the resource → **Actions → Enable CORS**
2. Leave defaults and click **Enable CORS and replace existing CORS headers**

### 6.5 Deploy the API

1. **Actions → Deploy API**
2. Stage: **New stage** → name it `prod`
3. Click **Deploy**
4. Copy the **Invoke URL** — looks like:
   `https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod`
   This is your `API_URL`

---

## Part 7 — Vercel Deployment

### 7.1 Install Vercel CLI

```bash
npm install -g vercel
```

### 7.2 Unzip and Deploy

```bash
unzip foxshare-v3-fixed.zip
cd foxshare-v3-fixed
vercel --prod
```

Follow the prompts — log in, create a new project, and deploy.

### 7.3 Set Environment Variables

After deploying, go to **Vercel Dashboard → Your Project → Settings → Environment Variables** and add:

| Variable | Value |
|---|---|
| `POOL_ID` | Your Cognito User Pool ID e.g. `us-east-1_xxxxxxxxx` |
| `CLIENT_ID` | Your Cognito App Client ID |
| `API_URL` | Your API Gateway Invoke URL e.g. `https://xxxxxxxxxx.execute-api.us-east-1.amazonaws.com/prod` |

> ⚠️ `API_URL` must have **no trailing slash**

After adding the variables, **redeploy** for them to take effect:

```bash
vercel --prod
```

Or trigger a redeploy from the Vercel dashboard.

---

## Part 8 — Verify Everything Works

Go through this checklist after deployment:

- [ ] Sign up with a new email address
- [ ] Verify email with the 6-digit code sent to your inbox
- [ ] Log in — you should be prompted to scan a QR code and set up MFA
- [ ] Scan with Google Authenticator or Authy
- [ ] Enter the 6-digit code — you should land on the logged-in screen
- [ ] Upload a small file — confirm success message
- [ ] Upload a file with spaces in the name — confirm success
- [ ] Click Refresh My Files — confirm file appears in the list
- [ ] Click Download — confirm file saves and you stay on the page
- [ ] Click Share — confirm a share link is generated
- [ ] Click Delete — confirm file is removed
- [ ] Click Logout — confirm you return to the login form

---

## Architecture Diagram

```
Browser (Vercel)
     │
     ├── /api/cognito  ──────────────────────→  AWS Cognito
     │       (login, MFA, signup)                (User Pool + MFA)
     │
     └── /api/files    ──────────────────────→  API Gateway
             (proxy)                                  │
                                              ┌───────┴────────┐
                                          Lambda           Lambda
                                         (upload)      (list/share/delete)
                                              │                │
                                           S3 + KMS        S3 + KMS
                                         (encrypted       (encrypted
                                          storage)         storage)
```

For uploads, files go **directly from the browser to S3** via presigned POST URL — they never pass through Vercel or Lambda, so there is no size limit imposed by the proxy.

For downloads, files are fetched **directly from S3** via presigned GET URL — same reason, no Lambda/API Gateway size limit applies.

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| MFA code rejected | Wrong USERNAME in challenge response | Ensure frontend uses `ChallengeParameters.USERNAME` |
| 502 on download | File too large for API Gateway (10MB limit) | Use presigned S3 URL directly — not the proxy |
| Download redirects away | No `Content-Disposition` on presigned URL | Add `ResponseContentDisposition` to Lambda |
| CORS error on download | S3 CORS missing `Content-Disposition` in `ExposeHeaders` | Update S3 CORS config |
| Upload returns 400 | Wrong content type or missing `file_name` in request body | Check API Gateway integration and Lambda code |
| Welcome shows UUID | `cognito:username` used instead of `email` | Use `payload['email']` fallback in JWT decode |
| Env vars not working | Vercel needs redeploy after adding vars | Run `vercel --prod` again after setting vars |

---

## Environment Variables Reference

### Vercel

| Variable | Description | Example |
|---|---|---|
| `POOL_ID` | Cognito User Pool ID | `us-east-1_aBcDeFgHi` |
| `CLIENT_ID` | Cognito App Client ID | `1a2b3c4d5e6f7g8h9i0j` |
| `API_URL` | API Gateway base URL (no trailing slash) | `https://abc123.execute-api.us-east-1.amazonaws.com/prod` |

### Lambda

| Variable | Description | Default |
|---|---|---|
| `BUCKET_NAME` | S3 bucket name | — |
| `KMS_KEY_ARN` | Full ARN of KMS key | — |
| `MAX_SIZE` | Max upload size in MB | `50` |
| `SHARE_EXPIRY_HOURS` | Presigned URL expiry in hours | `24` |
