import {
  JEV_SPEC_VERSION,
  JevRequestSchema,
  JevResponseSchema,
  RULE_BASED_PROVIDER_NAME,
  type HealthStatus,
  type JevCapability,
  type JevProvider,
  type JevRequest,
  type JevResponse,
  type ToolDescriptor,
} from '@akane/contract';

const normalize = (text: string): string =>
  ` ${text.normalize('NFC').toLowerCase().trim().replace(/\s+/gu, ' ')} `;

const NEGATION = /(?:^|[^\p{L}])(?:not|don't|dont|không|đừng|khong|dung)(?=$|[^\p{L}])/iu;

/**
 * The terminal offline provider (RTE-05, D-52/D-53).
 *
 * Deterministic substring matching over the *already RBAC-filtered* `req.tools`,
 * using only app-owner-declared aliases. No network, no fuzzy similarity over a
 * global catalogue, no LLM. Any degradation — empty tools, unknown input,
 * negation, unsupported locale, forced clarification, malformed payload —
 * abstains rather than guessing.
 */
export class RuleBasedProvider implements JevProvider {
  readonly name = RULE_BASED_PROVIDER_NAME;
  readonly spec_version = JEV_SPEC_VERSION;
  readonly capabilities: JevCapability[] = ['tool_selection', 'clarification', 'multi_turn'];

  constructor(
    private readonly declaredAliases: ReadonlyMap<string, readonly string[]>,
  ) {}

  async decide(input: JevRequest): Promise<JevResponse> {
    const started = performance.now();
    const req = JevRequestSchema.parse(input);

    const words = normalize(
      [
        ...req.context.previous_turns.filter((turn) => turn.role === 'user').map((turn) => turn.text),
        req.question,
      ].join(' '),
    );

    const negated = NEGATION.test(words);
    const abstain =
      req.state.force_clarification || negated || !['en', 'vi'].includes(req.state.locale);

    const matches: ToolDescriptor[] = abstain
      ? []
      : req.tools.filter((tool) =>
          (this.declaredAliases.get(tool.id) ?? []).some((alias) => words.includes(normalize(alias))),
        );

    const sole = matches.length === 1 ? matches[0] : undefined;

    const response: JevResponse = {
      spec_version: JEV_SPEC_VERSION,
      request_id: req.request_id,
      choice: sole
        ? { tool_id: sole.id, confidence: 1, verified: true }
        : { tool_id: null, confidence: 0, verified: null },
      ...(matches.length > 1
        ? { alternatives: matches.slice(0, 3).map((tool) => ({ tool_id: tool.id, confidence: 1 })) }
        : {}),
      clarification_needed: !sole,
      ...(!sole ? { clarification_prompt: 'Which authorized app did you mean?' } : {}),
      provider: this.name,
      latency_ms: performance.now() - started,
    };

    return JevResponseSchema.parse(response);
  }

  async healthCheck(): Promise<HealthStatus> {
    return {
      status: 'healthy',
      model_version: 'rules-v1',
      spec_version: this.spec_version,
      capabilities: this.capabilities,
      uptime_seconds: process.uptime(),
    };
  }
}
