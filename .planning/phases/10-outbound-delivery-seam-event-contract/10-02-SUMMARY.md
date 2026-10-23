---
phase: 10-outbound-delivery-seam-event-contract
plan: 02
subsystem: notifications
tags: [conversation-reference, platform-scoped, teams]
dependency_graph:
  requires: []
  provides: [platform-scoped-conversation-keys]
  affects: [teams-adapters]
tech_stack:
  added: []
  patterns: [platform-scoped-keys]
key_files:
  created: []
  modified:
    - packages/domain/src/notifications/data-access/conversation-reference.repository.ts
    - apps/api/src/adapters/teams/teams-activity.service.ts
    - apps/worker/src/adapters/teams/teams-delivery.service.ts
    - apps/api/src/adapters/teams/teams.outbound.service.ts
decisions:
  - "Key format changed to `${platform}:${channel_id}::${chat_user_id}`"
  - "Existing Teams rows inferred as platform 'teams' (migration note)"
metrics:
  duration: 5m
  completed: "2026-10-22T00:00:00Z"
  tasks: 2
  commits: 1
---

# Phase 10 Plan 02: Outbound Delivery Seam - Event Contract Summary

**Platform-scoped conversation reference keys to prevent cross-platform collisions**

## Accomplishments

- Updated `ConversationReferenceRepository.key()` to accept `platform` as first parameter
- Key format changed from `${channelId}::${chatUserId}` to `${platform}:${channelId}::${chatUserId}`
- Updated all Teams adapter call sites (activity service, outbound service, worker delivery service) to pass `platform: 'teams'`

## Task Commits

1. **feat(10-02): make conversation reference keys platform-scoped** - `a9bce31c`

## Files Changed

- `packages/domain/src/notifications/data-access/conversation-reference.repository.ts` - Updated key signature
- `apps/api/src/adapters/teams/teams-activity.service.ts` - Pass 'teams' platform
- `apps/worker/src/adapters/teams/teams-delivery.service.ts` - Pass 'teams' platform
- `apps/api/src/adapters/teams/teams.outbound.service.ts` - Pass 'teams' platform

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- [x] ConversationReferenceRepository.key() takes (platform, channelId, chatUserId)
- [x] Returns platform-scoped key format
- [x] All Teams adapters updated
- [x] No old-style calls remain in source files
