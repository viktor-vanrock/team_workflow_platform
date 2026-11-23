# Provider ingress deployment

`ingress-policy.example.json` is an illustrative development policy. Its hashes,
references and dates are placeholders; it does not enable a route. Create exact
published binding/profile/connection revisions and a matching conformance record
before registering `ProviderIngressModule`. The module awaits conformance at boot
and the runtime rechecks evidence/current heads for every receipt, including retries.
`CORPORATE` requires verified `INSTALLED_PROVIDER` evidence with the same provider,
edition, exact version, dialect and scope. Development evidence cannot satisfy it.

Register separate `GATEWAY` and `RECEIVER` deployments for `TRUSTED_PROXY`; native
Jira/GitLab may select a `NATIVE` receiver explicitly. The Nest host must enable
`rawBody: true`. Set its parser body limit to the selected policy limit, retain raw
bytes, disable ingress body/header logging and keep callback routes out of generic
browser authentication/CSRF middleware. Provider auth is enforced by these routes.
There is no JSON reserialization fallback or default secret. Use a server request
deadline and transport body/header limits before authentication.

Jira Cloud/DC body-HMAC selection requires the signed JSON `timestamp` in
milliseconds and exact issue project ID. The delivery header is only an alias;
the signed body hash is the semantic identity. Unsupported OAuth, missing signed
timestamps and providers needing authoritative freshness rereads remain disabled
until their own exact dialect/conformance adapter is supplied. The accepted event
requests an authoritative read; it never updates business state from the webhook.

GitLab selection requires Standard Webhooks HMAC-SHA256 over delivery ID, timestamp
and exact bytes, with the numeric project pinned. A legacy token does not enable
this dialect. Both key rings permit exactly one active key and at most two overlap
keys, each with an exact secret reference and a bounded verification lifetime.
The host supplies purpose-scoped secret use; there is no environment-key fallback.

For Mattermost, the gateway must terminate client-authenticated TLS from the
approved source. Configure a client CA with `requestCert` and `rejectUnauthorized`
enabled. `sourceKeys[].ref.contentHash` is the SHA-256 of the permitted client
certificate DER. A CA-valid unpinned certificate is rejected. Forwarded certificate
headers are ignored. A generic proxy with an anonymous backend is not an approved
source; TLS termination elsewhere requires its own authenticated-source adapter and
conformance proof, not header forwarding. The proxy HMAC key ring is separate from
these certificate references. Native Mattermost authentication is not inferred.

Mattermost intent issuance must persist `MATTERMOST_POST_ACTION` or
`MATTERMOST_DIALOG_SUBMISSION` transport, exact binding/profile/connection refs,
external human, team and channel, and post/action or callback IDs. Only the raw
token SHA-256 is persisted. The gateway checks that original intent; the receiver
locks and rechecks its original expiry and current human authorization before
consuming it atomically with the receipt and `mattermost.intent.received.v1` event.
The host must supply a current Core human/mapping/permission authority and the
business handler for this intent hint. It must reauthorize at action consumption.
Raw callback tokens are omitted from durable receipts, proxy statements and events.

Forward the unchanged original body with the canonical proxy envelope encoded as
base64url in `x-awp-ingress-envelope`. The signature covers exact policy, route,
scope, original source identity/key, body hash, semantic ID, original event/intent
time and expiry, proxy time and proxy key version. Proxy clock skew does not extend
original validity. Envelopes must fit the HTTP host's configured header limit.
For large dialogs, use short allowed fields and an explicit compatible header
limit; reject oversized envelopes rather than truncating them.

Receipts reuse the Core inbox with scoped connection/semantic/delivery keys.
Connection-level transaction locking serializes aliases and receipt/outbox writes.
Retention must cover retry horizon plus clock skew; never delete unexpired inbox
rows. Expired original callbacks are rejected even if a new proxy signature exists.
Key rotation requires publishing the exact replacement policy and preserving only
the approved overlap window. Re-signing original receipts is not a freshness repair.

The HTTP/PostgreSQL/mTLS fixtures exercise these adapters in the development
contour. They do not establish C1/N2 evidence for a corporate installation. Complete
API/worker startup composition and installed evidence import remain separately gated.
