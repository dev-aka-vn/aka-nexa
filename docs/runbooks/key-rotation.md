# Key Rotation

Operator procedure (policy-triggered, not alert-triggered). Rotates the active key
without downtime using the overlap window.

## When to rotate

- On a suspected key compromise, on a scheduled rotation policy, or when retiring
  a key after its overlap window.

## Command

```sh
akane rotate-keys <new-kid> --overlap <ms>
```

Example:

```sh
akane rotate-keys local-abcdef0123456789 --overlap 86400000
```

## Expected output

Successful promotion:

```
previous_active_kid: local-0000000000000000
new_active_kid: local-abcdef0123456789
retained: local-0000000000000000
overlap_expiry: 2026-10-21T00:00:00.000Z
```

Already active (no-op):

```
already-active: local-abcdef0123456789
```

Unknown kid: non-zero exit code with `KEY_NOT_FOUND: ...`.

## Confirm new key in use

Seal a test secret and confirm its `kid` equals the new active kid.

## If a decrypt fails after rotation

- Verify the retired kid is still in the retained set within the overlap window.
- If the overlap expired, restore the previous active kid (rollback below) and re-run.

## Overlap expiry check

The command reports `overlap_expiry`. Do not remove the retired kid before that time.

## Rollback

Within the overlap window, re-run the command with the previous active kid to restore it:

```sh
akane rotate-keys <previous-active-kid>
```