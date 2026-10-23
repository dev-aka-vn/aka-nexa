/**
 * The Slack transport-authentication helpers (OUT-04).
 *
 * One concern only: proving a request came from Slack. Slack-specific
 * *semantics* (events, slash commands, conversation references) live in the
 * receiver and in the `adapters/slack` domain element, not here.
 */
export * from './slack-webhook-verifier.js';
