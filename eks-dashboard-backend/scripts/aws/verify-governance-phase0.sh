#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  verify-governance-phase0.sh --profile PROFILE --region REGION --role-arn ROLE_ARN [--cluster-arn CLUSTER_ARN]

Runs read-only AWS identity checks and IAM policy simulation for the Dashboard
AWS governance inventory contract. It does not call any AWS write API.
EOF
}

profile=""
region=""
role_arn=""
cluster_arn=""

while (($# > 0)); do
  case "$1" in
    --profile)
      profile="${2:-}"
      shift 2
      ;;
    --region)
      region="${2:-}"
      shift 2
      ;;
    --role-arn)
      role_arn="${2:-}"
      shift 2
      ;;
    --cluster-arn)
      cluster_arn="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$profile" || -z "$region" || -z "$role_arn" ]]; then
  usage >&2
  exit 2
fi

readonly_actions=(
  ec2:DescribeInstances
  ec2:DescribeVolumes
  ec2:DescribeSecurityGroups
  elasticloadbalancing:DescribeLoadBalancers
  elasticloadbalancing:DescribeTargetGroups
  eks:ListClusters
  rds:DescribeDBInstances
  s3:ListAllMyBuckets
  route53:ListHostedZones
  acm:ListCertificates
  iam:ListRoles
  cloudtrail:DescribeTrails
  cloudtrail:GetTrailStatus
  cloudtrail:GetEventSelectors
  config:DescribeConfigurationRecorders
  config:DescribeConfigurationRecorderStatus
  securityhub:DescribeHub
  guardduty:ListDetectors
)

export AWS_PROFILE="$profile"
export AWS_REGION="$region"
export AWS_DEFAULT_REGION="$region"

collected_at="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
caller_json="$(aws sts get-caller-identity --output json)"
role_json="$(aws iam get-role \
  --role-name "${role_arn##*/}" \
  --query 'Role.{Arn:Arn,MaxSessionDuration:MaxSessionDuration}' \
  --output json)"
simulation_json="$(aws iam simulate-principal-policy \
  --policy-source-arn "$role_arn" \
  --action-names "${readonly_actions[@]}" \
  --resource-arns '*' \
  --query 'EvaluationResults[].{action:EvalActionName,decision:EvalDecision}' \
  --output json)"

eks_json="[]"
if [[ -n "$cluster_arn" ]]; then
  eks_json="$(aws iam simulate-principal-policy \
    --policy-source-arn "$role_arn" \
    --action-names eks:DescribeCluster \
    --resource-arns "$cluster_arn" \
    --query 'EvaluationResults[].{action:EvalActionName,decision:EvalDecision,resources:ResourceSpecificResults[].{resource:EvalResourceName,decision:EvalResourceDecision}}' \
    --output json)"
fi

COLLECTED_AT="$collected_at" \
CALLER_JSON="$caller_json" \
ROLE_JSON="$role_json" \
SIMULATION_JSON="$simulation_json" \
EKS_JSON="$eks_json" \
node <<'NODE'
const output = {
  collectedAt: process.env.COLLECTED_AT,
  caller: JSON.parse(process.env.CALLER_JSON),
  targetRole: JSON.parse(process.env.ROLE_JSON),
  inventorySimulation: JSON.parse(process.env.SIMULATION_JSON),
  resourceScopedSimulation: JSON.parse(process.env.EKS_JSON),
};
process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
NODE
