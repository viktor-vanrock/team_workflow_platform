# Local account contracts

- `GET /local/personas`: exactly nine `{key,label}` entries; no diagnostic humans or service principal. Reader label is `Читатель`.
- `POST /local/persona/exchange`, step-up and legacy select-project: retired or SERVICE persona returns 403; retained HUMAN accounts use existing persisted authorization.
- Fake IdP token issuance: retired human subjects rejected; worker token issuance remains available to existing service/test clients. A worker token does not become a human session.
- Previously issued retired tokens fail API catalog validation; retired grants are also removed/revoked on upgrade.
- `localPersonaCatalog.seedOptions()`: internal active principal options including worker. Never used as UI login options.
- Existing corporate identity APIs and workspace/project permission contracts unchanged.
