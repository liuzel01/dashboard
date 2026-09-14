# GitHub Actions production deployment

The production workflow builds the backend and frontend on GitHub-hosted runners,
uploads an immutable release archive to S3, and invokes the EC2 deployment through
AWS Systems Manager (SSM). It does not clone the private repository on the EC2
instance and does not require an inbound SSH/PEM deployment key.

Workflow: `.github/workflows/ci-cd.yml`

## GitHub configuration

Configure these variables in the GitHub `production` Environment. They are
intentionally not hardcoded in the workflow, so the deployment target can be
changed later without a repository code change:

| Variable | Value |
| --- | --- |
| `DEPLOY_AWS_REGION` | `ap-southeast-1` |
| `DEPLOY_S3_BUCKET` | `mgbx-tfstate-931324892624` |
| `DEPLOY_S3_PREFIX` | `dashboard/releases` |

Create this repository or `production` environment secret:

| Secret | Value |
| --- | --- |
| `DEPLOY_AWS_ROLE_ARN` | IAM role assumed by GitHub Actions through OIDC |

The IAM role trust policy must restrict the GitHub OIDC `sub` claim to this
repository and the `main` branch (or the `production` environment if that is
used for the deployment job).

The role needs only:

- `s3:PutObject` and `s3:AbortMultipartUpload` on the release prefix;
- `ssm:SendCommand` for the target instance and `AWS-RunShellScript` document;
- `ssm:GetCommandInvocation` for the target instance.

The S3 bucket should block public access and use server-side encryption. A
dedicated KMS key can replace SSE-S3 if the organization requires it.

## EC2 one-time preparation

The EC2 instance must already have:

- SSM Agent online;
- an instance role allowing `s3:GetObject` on the release prefix;
- `aws`, `npm`, `pm2`, `tar`, `sha256sum`, and `curl` available to root;
- `/opt/dashboard` owned by the production service user/root as appropriate;
- `/root/.kube/config` and the host `.env` kept outside release artifacts.

The workflow installs `scripts/deploy-release.sh` on every deployment through
SSM before invoking it, so there is no separate script copy step. The script
creates `/opt/dashboard/releases/<commit-sha>` and switches the
`/opt/dashboard/current` symlink only after checksum, dependency installation,
PM2, backend, and frontend checks succeed. The previous release is restored if
the post-switch health checks fail.

The instance role used by the deployment script must be allowed to read the S3
release prefix. This is separate from the role's EKS permissions, although the
same EC2 role may contain both least-privilege policies.

## First run and rollback

Push to `main` or run the workflow manually. The workflow stops before S3/SSM
deployment when tests or builds fail. To roll back manually, run the deployment
script with a previously uploaded archive and its recorded SHA-256 checksum.

The current repository test suite has a pre-existing Jest ESM parsing failure in
`ai-ops/ai-ops.service.spec.ts` (`otplib`/`@scure/base`). Until that test setup is
fixed, the CI test step intentionally blocks production deployment; the backend
and frontend build steps pass independently.
