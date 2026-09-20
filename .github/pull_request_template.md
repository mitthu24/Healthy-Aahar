## What

## Why

## How

## Testing

- [ ] Unit tests added or updated
- [ ] Integration tests added or updated
- [ ] Manually verified

## Documentation

- [ ] `/docs` updated, or not applicable
- [ ] ADR added for any architectural decision

## Database

- [ ] No migration
- [ ] Migration included and backward-compatible with currently running code
- [ ] Expand/contract used for any destructive change

## Serviceability (required if this touches cities, pincodes, zones or slots)

- [ ] No city, pincode or slot value is hard-coded in application logic (BR-SV1)
- [ ] Serviceability is resolved from the database, not from a client-supplied flag
- [ ] Deactivation preserves historical records (BR-SV6)

## Security (required for auth, payments, orders, permissions)

- [ ] Authorization checked at the API layer, not only in the UI
- [ ] Input validated with Zod
- [ ] No PII added to logs
- [ ] No secret added to the repository

## Screenshots (UI changes)
