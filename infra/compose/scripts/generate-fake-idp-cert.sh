#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
compose_dir="$(cd "${script_dir}/.." && pwd)"
output_dir="${1:-${compose_dir}/certs/generated}"
config_file="${compose_dir}/certs/fake-idp-openssl.cnf"

case "${output_dir}" in
  /|"${HOME}"|"${HOME}/") echo "Refusing unsafe certificate output directory" >&2; exit 2 ;;
esac

mkdir -p "${output_dir}"
ca_key="${output_dir}/awp-local-ca-key.pem"
ca_cert="${output_dir}/awp-local-ca.pem"
service_key="${output_dir}/fake-idp-key.pem"
service_csr="${output_dir}/fake-idp.csr"
service_cert="${output_dir}/fake-idp.pem"

certificate_has_fake_idp_san() {
  local certificate_text
  certificate_text="$(openssl x509 -in "${service_cert}" -noout -text)"
  [[ "${certificate_text}" == *"DNS:fake-idp"* ]]
}

if [[ -s "${ca_cert}" && -s "${service_key}" && -s "${service_cert}" ]] \
  && openssl verify -CAfile "${ca_cert}" "${service_cert}" >/dev/null 2>&1 \
  && certificate_has_fake_idp_san; then
  echo "Fake IdP certificate is already valid: ${service_cert}"
  exit 0
fi

openssl req -x509 -newkey rsa:3072 -sha256 -nodes -days 3650 \
  -subj "/CN=AWP Local Development CA/O=AWP Local Development" \
  -keyout "${ca_key}" -out "${ca_cert}"
openssl req -new -newkey rsa:2048 -sha256 -nodes -config "${config_file}" \
  -keyout "${service_key}" -out "${service_csr}"
openssl x509 -req -sha256 -days 825 -in "${service_csr}" \
  -CA "${ca_cert}" -CAkey "${ca_key}" -CAcreateserial \
  -extfile "${config_file}" -extensions service_extensions -out "${service_cert}"
chmod 600 "${ca_key}" "${service_key}"
chmod 644 "${ca_cert}" "${service_cert}"
openssl verify -CAfile "${ca_cert}" "${service_cert}"
certificate_has_fake_idp_san
echo "Generated Fake IdP certificate and repository test CA in ${output_dir}"
