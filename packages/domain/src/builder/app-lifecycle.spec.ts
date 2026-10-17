/**
 * APP-02 / APP-03 / APP-05 / APP-06 — the app-definition
 * lifecycle state machine, in isolation.
 *
 * The machine is a property of the domain, not of any
 * instance: the transition table, the submission gate,
 * and the trigger-registration gate are what every
 * builder seam calls before it writes. This spec pins
 * the table itself — every legal arrow and every named
 * refusal — so no caller can regress a gate without a
 * red test.
 *
 * ## The transition table
 *
 * ```
 * draft ──publish──▶ published ──deprecate──▶ deprecated
 *   │                     │                       │
 *   └──────archive────────┴────────archive────────┘
 *                             ▼
 *                         archived (terminal)
 * ```
 *
 * Plus re-activation `deprecated → published`.
 */

import { describe, expect, it } from 'vitest';

import {
  APP_LIFECYCLE_STATES,
  AppLifecycle,
  LifecycleTransitionError,
  SubmissionRefusedError,
  TriggerRegisterRefusedError,
  type AppLifecycleState,
} from './app-lifecycle.js';

describe('AppLifecycle state machine (APP-02, APP-05, APP-06)', () => {
  describe('the legal-transition table', () => {
    const legal: ReadonlyArray<readonly [AppLifecycleState, AppLifecycleState]> =
      [
        ['draft', 'published'],
        ['draft', 'archived'],
        ['published', 'deprecated'],
        ['published', 'archived'],
        ['deprecated', 'published'],
        ['deprecated', 'archived'],
      ];

    it.each(legal)('%s → %s is legal', (from, to) => {
      expect(() => AppLifecycle.assertTransition(from, to)).not.toThrow();
    });

    const illegal: ReadonlyArray<readonly [AppLifecycleState, AppLifecycleState]> =
      [
        // A draft cannot skip publish straight to deprecation.
        ['draft', 'deprecated'],
        // No self-transitions.
        ['draft', 'draft'],
        ['published', 'published'],
        ['deprecated', 'deprecated'],
        // publish is only reachable from draft and deprecated.
        ['published', 'draft'],
        ['published', 'published'],
        // archived is terminal — nothing leaves it.
        ['archived', 'draft'],
        ['archived', 'published'],
        ['archived', 'deprecated'],
        ['archived', 'archived'],
      ];

    it.each(illegal)('%s → %s is refused with the named illegal-transition error', (from, to) => {
      expect(() => AppLifecycle.assertTransition(from, to)).toThrow(
        LifecycleTransitionError,
      );
      try {
        AppLifecycle.assertTransition(from, to);
      } catch (error) {
        expect((error as LifecycleTransitionError).code).toBe(
          'LIFECYCLE_ILLEGAL_TRANSITION',
        );
        expect((error as LifecycleTransitionError).message).toContain(
          `${from} → ${to}`,
        );
      }
    });

    it('exactly the four states exist, in ladder order', () => {
      expect([...APP_LIFECYCLE_STATES]).toEqual([
        'draft',
        'published',
        'deprecated',
        'archived',
      ]);
    });
  });

  describe('the submission gate (APP-06)', () => {
    it('draft, published, and deprecated apps accept submissions', () => {
      // APP-05: a deprecated app stays functional — submissions
      // keep flowing.
      for (const lifecycle of [
        'draft',
        'published',
        'deprecated',
      ] as const) {
        expect(AppLifecycle.acceptsSubmissions(lifecycle)).toBe(true);
        expect(() =>
          AppLifecycle.assertAcceptsSubmissions('app-x', lifecycle),
        ).not.toThrow();
      }
    });

    it('an archived app refuses submissions with the named error', () => {
      expect(AppLifecycle.acceptsSubmissions('archived')).toBe(false);
      expect(() =>
        AppLifecycle.assertAcceptsSubmissions('asset-request', 'archived'),
      ).toThrow(SubmissionRefusedError);

      try {
        AppLifecycle.assertAcceptsSubmissions('asset-request', 'archived');
      } catch (error) {
        expect((error as SubmissionRefusedError).code).toBe(
          'SUBMISSION_REFUSED_ARCHIVED',
        );
        // The refusal names the app, inline (BLD-07).
        expect((error as SubmissionRefusedError).message).toContain(
          'asset-request',
        );
      }
    });
  });

  describe('the trigger-registration gate (APP-05)', () => {
    it('draft and published apps register triggers', () => {
      for (const lifecycle of ['draft', 'published'] as const) {
        expect(AppLifecycle.registersTriggers(lifecycle)).toBe(true);
        expect(() =>
          AppLifecycle.assertRegistersTriggers('app-x', lifecycle),
        ).not.toThrow();
      }
    });

    it('a deprecated app refuses NEW trigger registrations with the named error', () => {
      // The app's existing triggers are untouched — only NEW
      // registrations are refused.
      expect(AppLifecycle.registersTriggers('deprecated')).toBe(false);
      expect(() =>
        AppLifecycle.assertRegistersTriggers('leave-request', 'deprecated'),
      ).toThrow(TriggerRegisterRefusedError);

      try {
        AppLifecycle.assertRegistersTriggers('leave-request', 'deprecated');
      } catch (error) {
        expect((error as TriggerRegisterRefusedError).code).toBe(
          'TRIGGER_REGISTER_REFUSED_DEPRECATED',
        );
        expect((error as TriggerRegisterRefusedError).message).toContain(
          'leave-request',
        );
      }
    });

    it('an archived app registers nothing either', () => {
      expect(AppLifecycle.registersTriggers('archived')).toBe(false);
      expect(() =>
        AppLifecycle.assertRegistersTriggers('app-x', 'archived'),
      ).toThrow(TriggerRegisterRefusedError);
    });
  });
});
