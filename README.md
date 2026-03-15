# 🦊 FoxShare — Secure Serverless File Vault

![AWS](https://img.shields.io/badge/AWS-Serverless-FF9900?style=flat&logo=amazonaws)
![Vercel](https://img.shields.io/badge/Deployed-Vercel-000000?style=flat&logo=vercel)
![Security](https://img.shields.io/badge/Security-OWASP%20Validated-4CAF50?style=flat)
![MFA](https://img.shields.io/badge/Auth-MFA%20Required-blue?style=flat)
![License](https://img.shields.io/badge/License-MIT-green?style=flat)

FoxShare is a secure, serverless file vault built on AWS. Files are encrypted at rest using AWS KMS, protected in transit with HTTPS and HSTS, and access is gated behind Cognito MFA authentication. Built as an AltSchool Africa Cloud Security capstone project.

---

## 📸 Architecture

```
User → Vercel Frontend → Cognito MFA → API Gateway (JWT) → Lambda → S3 (KMS)
                                                                         ↓
                                                               CloudTrail → CloudWatch
```

**Public Zone:** User Browser, Vercel Frontend, AWS Cognito, API Gateway  
**Private Zone:** AWS Lambda, Amazon S3, AWS KMS, CloudTrail, CloudWatch

---

## 🔐 Security Features

- **MFA Required** — TOTP authenticator app via AWS Cognito (Google Authenticator / Authy)
- **JWT Authorization** — API Gateway validates Cognito-signed tokens before Lambda runs
- **Encryption at Rest** — SSE-KMS with customer-managed key, annual rotation enabled
- **Encryption in Transit** — TLS 1.2+, HSTS preload, S3 HTTPS-only bucket policy
- **Presigned URLs** — Files never pass through the server; direct browser ↔ S3 transfer
- **Security Headers** — CSP, X-Frame-Options, HSTS, X-Content-Type-Options
- **CORS Lockdown** — Origin validation via `ALLOWED_ORIGIN` environment variable
- **Token Storage** — JWT held in JS memory only, never localStorage or cookies
- **Audit Logging** — CloudTrail logs all S3 and KMS events with CloudWatch alerting
- **OWASP ZAP Validated** — Reduced from 12 alerts to informational only

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript |
| Hosting | Vercel (Serverless Functions) |
| Authentication | AWS Cognito (MFA / TOTP) |
| API | AWS API Gateway (REST) |
| Backend | AWS Lambda (Python) |
| Storage | Amazon S3 (Private Bucket) |
| Encryption | AWS KMS (Customer Managed Key) |
| Audit | AWS CloudTrail + CloudWatch |

---

## 📁 Project Structure

```
foxshare/
├── api/
│   ├── cognito.js        # Vercel proxy — Cognito auth calls
│   └── files.js          # Vercel proxy — API Gateway file calls
├── index.html            # Frontend markup
├── style.css             # Styles
├── app.js                # Frontend logic
├── package.json          # Node.js config
├── vercel.json           # Vercel config + security headers
└── lambda/
    ├── upload.py         # Generate presigned S3 POST URL
    ├── download.py       # Generate presigned S3 GET URL
    ├── list_files.py     # List user's files in S3
    ├── delete_file.py    # Delete a file from S3
    └── share_file.py     # Generate shareable presigned URL
```

---

## ⚙️ Environment Variables

Set these in your Vercel project dashboard under **Settings → Environment Variables**:

| Variable | Description |
|---|---|
| `POOL_ID` | Cognito User Pool ID e.g. `us-east-1_xxxxxxxxx` |
| `CLIENT_ID` | Cognito App Client ID |
| `API_URL` | API Gateway Invoke URL ending in `/Prod` |
| `ALLOWED_ORIGIN` | Your Vercel deployment URL e.g. `https://foxshare.vercel.app` |

---

## 🚀 Deployment

### Prerequisites
- AWS Account
- Vercel Account
- Node.js 20.x

### Step 1 — AWS Setup

**Cognito User Pool**
1. Create a User Pool named `Fox-Share-Users`
2. Enable email sign-in
3. Set MFA to **Required** — Authenticator apps only
4. Create an App Client with `ALLOW_USER_PASSWORD_AUTH`, no client secret

**S3 Bucket**
1. Create a private bucket e.g. `fox-shares-bucket`
2. Block all public access
3. Enable default encryption → SSE-KMS → select your KMS key
4. Add HTTPS-only bucket policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": [
        "arn:aws:s3:::fox-shares-bucket",
        "arn:aws:s3:::fox-shares-bucket/*"
      ],
      "Condition": {
        "Bool": { "aws:SecureTransport": "false" }
      }
    }
  ]
}
```

**KMS Key**
1. Create a Customer Managed Key
2. Enable automatic key rotation
3. Restrict key usage to your Lambda execution role only

**API Gateway**
1. Create a REST API
2. Add a Cognito Authorizer pointing to your User Pool
3. Create resource paths: `/files`, `/files/upload`, `/files/download`, `/files/list`, `/files/delete`, `/files/share`
4. Deploy to a stage named `Prod`

### Step 2 — Deploy to Vercel

```bash
git clone https://github.com/ukahip/FOX-SHARE-V2.git
cd FOX-SHARE-V2
vercel deploy
```

Add all four environment variables in the Vercel dashboard and redeploy.

---

## 🐍 Lambda Functions (Python)

### IAM Execution Role

All Lambda functions share an execution role with these permissions:

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
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::fox-shares-bucket",
        "arn:aws:s3:::fox-shares-bucket/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:GenerateDataKey",
        "kms:Decrypt"
      ],
      "Resource": "arn:aws:kms:us-east-1:YOUR_ACCOUNT_ID:key/YOUR_KEY_ID"
    }
  ]
}
```

---

### upload.py — Generate Presigned POST URL

Generates a short-lived presigned POST URL so the browser can upload directly to S3, bypassing the Vercel 4.5MB body limit.

```python
import json
import boto3
import os
from botocore.exceptions import ClientError

s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

BUCKET_NAME = os.environ.get('BUCKET_NAME', 'fox-shares-bucket')
URL_EXPIRY  = int(os.environ.get('URL_EXPIRY', 900))  # 15 minutes


def lambda_handler(event, context):
    headers = {
        'Access-Control-Allow-Origin':  os.environ.get('ALLOWED_ORIGIN', ''),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json',
    }

    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    try:
        # Extract authenticated user ID from Cognito JWT claims
        claims   = event['requestContext']['authorizer']['claims']
        user_sub = claims['sub']  # Unique Cognito user ID

        body     = json.loads(event.get('body', '{}'))
        filename = body.get('filename', '')

        if not filename:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'filename is required'})
            }

        # Sanitize filename — strip path traversal attempts
        filename = os.path.basename(filename).replace('..', '')
        if not filename:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 'Invalid filename'})
            }

        # Scope S3 key to the authenticated user — prevents cross-user access
        s3_key = f"{user_sub}/{filename}"

        # Generate presigned POST — browser uploads directly to S3
        presigned = s3_client.generate_presigned_post(
            Bucket     = BUCKET_NAME,
            Key        = s3_key,
            Conditions = [
                ['content-length-range', 1, 104857600],  # 1 byte to 100 MB
            ],
            ExpiresIn = URL_EXPIRY
        )

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'url':    presigned['url'],
                'fields': presigned['fields'],
                's3_key': s3_key
            })
        }

    except KeyError as e:
        return {
            'statusCode': 401,
            'headers': headers,
            'body': json.dumps({'error': f'Unauthorized: missing claim {str(e)}'})
        }
    except ClientError as e:
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({'error': f'AWS error: {e.response["Error"]["Message"]}'})
        }
```

---

### download.py — Generate Presigned GET URL

Generates a presigned GET URL so the browser can download a file directly from S3.

```python
import json
import boto3
import os
from botocore.exceptions import ClientError

s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

BUCKET_NAME = os.environ.get('BUCKET_NAME', 'fox-shares-bucket')
URL_EXPIRY  = int(os.environ.get('URL_EXPIRY', 900))  # 15 minutes


def lambda_handler(event, context):
    headers = {
        'Access-Control-Allow-Origin':  os.environ.get('ALLOWED_ORIGIN', ''),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json',
    }

    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    try:
        claims   = event['requestContext']['authorizer']['claims']
        user_sub = claims['sub']

        s3_key = event.get('queryStringParameters', {}).get('s3_key', '')

        if not s3_key:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 's3_key is required'})
            }

        # Enforce that the user can only access their own files
        if not s3_key.startswith(f"{user_sub}/"):
            return {
                'statusCode': 403,
                'headers': headers,
                'body': json.dumps({'error': 'Forbidden — access denied'})
            }

        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params    = {'Bucket': BUCKET_NAME, 'Key': s3_key},
            ExpiresIn = URL_EXPIRY
        )

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'download_url': presigned_url})
        }

    except KeyError as e:
        return {
            'statusCode': 401,
            'headers': headers,
            'body': json.dumps({'error': f'Unauthorized: {str(e)}'})
        }
    except ClientError as e:
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({'error': f'AWS error: {e.response["Error"]["Message"]}'})
        }
```

---

### list_files.py — List User Files

Lists all files belonging to the authenticated user by filtering on their Cognito `sub` prefix.

```python
import json
import boto3
import os
from botocore.exceptions import ClientError

s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

BUCKET_NAME = os.environ.get('BUCKET_NAME', 'fox-shares-bucket')


def lambda_handler(event, context):
    headers = {
        'Access-Control-Allow-Origin':  os.environ.get('ALLOWED_ORIGIN', ''),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json',
    }

    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    try:
        claims   = event['requestContext']['authorizer']['claims']
        user_sub = claims['sub']

        # List only objects under the user's prefix — no cross-user access possible
        response = s3_client.list_objects_v2(
            Bucket = BUCKET_NAME,
            Prefix = f"{user_sub}/"
        )

        files = []
        for obj in response.get('Contents', []):
            key      = obj['Key']
            filename = key.replace(f"{user_sub}/", '', 1)
            files.append({
                'key':           key,
                'filename':      filename,
                'size':          obj['Size'],
                'last_modified': obj['LastModified'].isoformat()
            })

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'files': files})
        }

    except KeyError as e:
        return {
            'statusCode': 401,
            'headers': headers,
            'body': json.dumps({'error': f'Unauthorized: {str(e)}'})
        }
    except ClientError as e:
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({'error': f'AWS error: {e.response["Error"]["Message"]}'})
        }
```

---

### delete_file.py — Delete a File

Deletes a file from S3, enforcing that users can only delete their own files.

```python
import json
import boto3
import os
from botocore.exceptions import ClientError

s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

BUCKET_NAME = os.environ.get('BUCKET_NAME', 'fox-shares-bucket')


def lambda_handler(event, context):
    headers = {
        'Access-Control-Allow-Origin':  os.environ.get('ALLOWED_ORIGIN', ''),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
        'Content-Type': 'application/json',
    }

    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    try:
        claims   = event['requestContext']['authorizer']['claims']
        user_sub = claims['sub']

        s3_key = event.get('queryStringParameters', {}).get('s3_key', '')

        if not s3_key:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 's3_key is required'})
            }

        # Enforce ownership — user can only delete their own files
        if not s3_key.startswith(f"{user_sub}/"):
            return {
                'statusCode': 403,
                'headers': headers,
                'body': json.dumps({'error': 'Forbidden — access denied'})
            }

        s3_client.delete_object(Bucket=BUCKET_NAME, Key=s3_key)

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({'message': f'{s3_key} deleted successfully'})
        }

    except KeyError as e:
        return {
            'statusCode': 401,
            'headers': headers,
            'body': json.dumps({'error': f'Unauthorized: {str(e)}'})
        }
    except ClientError as e:
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({'error': f'AWS error: {e.response["Error"]["Message"]}'})
        }
```

---

### share_file.py — Generate Shareable Link

Generates a longer-lived presigned URL for sharing a file with someone who doesn't have a FoxShare account.

```python
import json
import boto3
import os
from botocore.exceptions import ClientError

s3_client = boto3.client('s3', region_name=os.environ.get('AWS_REGION', 'us-east-1'))

BUCKET_NAME  = os.environ.get('BUCKET_NAME', 'fox-shares-bucket')
SHARE_EXPIRY = int(os.environ.get('SHARE_EXPIRY', 3600))  # 1 hour default


def lambda_handler(event, context):
    headers = {
        'Access-Control-Allow-Origin':  os.environ.get('ALLOWED_ORIGIN', ''),
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Content-Type': 'application/json',
    }

    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 200, 'headers': headers, 'body': ''}

    try:
        claims   = event['requestContext']['authorizer']['claims']
        user_sub = claims['sub']

        params = event.get('queryStringParameters') or {}
        s3_key  = params.get('s3_key', '')
        expiry  = int(params.get('expiry', SHARE_EXPIRY))

        # Cap expiry at 24 hours max
        expiry = min(expiry, 86400)

        if not s3_key:
            return {
                'statusCode': 400,
                'headers': headers,
                'body': json.dumps({'error': 's3_key is required'})
            }

        # Enforce ownership
        if not s3_key.startswith(f"{user_sub}/"):
            return {
                'statusCode': 403,
                'headers': headers,
                'body': json.dumps({'error': 'Forbidden — access denied'})
            }

        share_url = s3_client.generate_presigned_url(
            'get_object',
            Params    = {'Bucket': BUCKET_NAME, 'Key': s3_key},
            ExpiresIn = expiry
        )

        return {
            'statusCode': 200,
            'headers': headers,
            'body': json.dumps({
                'share_url':  share_url,
                'expires_in': expiry,
                'note':       'This link expires and cannot be extended.'
            })
        }

    except KeyError as e:
        return {
            'statusCode': 401,
            'headers': headers,
            'body': json.dumps({'error': f'Unauthorized: {str(e)}'})
        }
    except ClientError as e:
        return {
            'statusCode': 500,
            'headers': headers,
            'body': json.dumps({'error': f'AWS error: {e.response["Error"]["Message"]}'})
        }
```

---

## 🔬 Security Validation

### Encryption in Transit
```bash
# Test SSL rating — should return A or A+
curl https://api.ssllabs.com/api/v3/analyze?host=your-app.vercel.app
```

### Encryption at Rest
Check in AWS Console → S3 → fox-shares-bucket → any object → Properties → Server-side encryption should show your KMS key ARN.

### OWASP ZAP
Run OWASP ZAP against the deployed URL. Expected result: 0 medium/high alerts, informational only.

### CloudTrail Validation
After uploading a file, go to AWS Console → CloudTrail → Event history and filter by:
- Event source: `s3.amazonaws.com` → look for `PutObject`
- Event source: `kms.amazonaws.com` → look for `GenerateDataKey`

Both should appear confirming encryption is active on every upload.

---

## 🛡 IAM Read-Only Access for Reviewers

To give colleagues read-only access to review the infrastructure:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "S3ReadOnly",
      "Effect": "Allow",
      "Action": ["s3:ListBucket", "s3:GetBucketLocation", "s3:GetObject"],
      "Resource": ["arn:aws:s3:::fox-shares-bucket", "arn:aws:s3:::fox-shares-bucket/*"]
    },
    {
      "Sid": "LambdaReadOnly",
      "Effect": "Allow",
      "Action": ["lambda:ListFunctions", "lambda:GetFunctionConfiguration"],
      "Resource": "*"
    },
    {
      "Sid": "CloudWatchReadOnly",
      "Effect": "Allow",
      "Action": ["logs:DescribeLogGroups", "logs:GetLogEvents", "cloudwatch:DescribeAlarms"],
      "Resource": "*"
    },
    {
      "Sid": "CloudTrailReadOnly",
      "Effect": "Allow",
      "Action": ["cloudtrail:LookupEvents", "cloudtrail:GetTrail", "cloudtrail:DescribeTrails"],
      "Resource": "*"
    },
    {
      "Sid": "CognitoReadOnly",
      "Effect": "Allow",
      "Action": ["cognito-idp:DescribeUserPool", "cognito-idp:ListUsers", "cognito-idp:GetUserPoolMfaConfig"],
      "Resource": "*"
    }
  ]
}
```

---

## 📊 Threat Model

| Threat | Mitigation |
|---|---|
| MITM Attack | HSTS preload + TLS 1.2+ + S3 HTTPS-only policy |
| Brute Force | Cognito lockout + MFA required |
| Token Theft | JWT in memory only, 1hr expiry |
| XSS | CSP blocks unauthorized scripts |
| Clickjacking | X-Frame-Options: DENY |
| CORS Abuse | ALLOWED_ORIGIN validation |
| Presigned URL Abuse | 15-minute expiry |
| S3 Enumeration | Keys scoped to Cognito sub prefix |
| Unauthorized File Access | Ownership check in every Lambda |

---

## 🗺 Roadmap

- [ ] Client-side encryption using Web Crypto API before upload
- [ ] Multipart upload for large files
- [ ] CloudFront CDN for faster global access
- [ ] File versioning via S3 versioning
- [ ] Role-based access (admin / viewer)
- [ ] WAF integration for API Gateway
- [ ] Move to eu-west-1 for lower latency from Africa

---

## 👨🏾‍💻 Author

**Paul Ikechukwu Ukah (Orion)**  
Cloud & Security Engineer  
GitHub: [@ukahip](https://github.com/ukahip)

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
