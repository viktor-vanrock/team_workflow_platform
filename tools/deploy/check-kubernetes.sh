#!/bin/sh
# Run from the repository root. The supplied chart is copied, never modified.
set -eu
chart=${1:?Usage: sh tools/deploy/check-kubernetes.sh /path/to/helm-template}
check_dir=$(mktemp -d)
trap 'rm -rf "$check_dir"' EXIT
mkdir "$check_dir/chart"
cp "$chart/Chart.yaml" "$chart/values.yaml" "$check_dir/chart/"
cp -R "$chart/templates" "$check_dir/chart/"
for values in envs/hermes-advosd-dev.yaml envs/hermes-advosp-prod.yaml; do
  helm lint "$check_dir/chart" -f "$values"
  helm template hermes "$check_dir/chart" -f "$values" >/dev/null
done
cp infra/deploy/workspace-bootstrap.job.tpl "$check_dir/chart/templates/workspace-bootstrap.yaml"
for values in envs/workspace-advosd-dev.yaml envs/workspace-advosp-prod.yaml; do
  helm lint "$check_dir/chart" -f "$values"
  helm template workspace "$check_dir/chart" -f "$values" \
    --set-string ingress.route.host=awp.example.internal >/dev/null
done
