# Phase 3: Natural-Language Routing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-07
**Phase:** 3-Natural-Language Routing
**Areas discussed:** Clarification flow, Offline matching, Provider data policy, Language handling

---

## Clarification flow

### When two authorized apps are plausible, what should the Slack reply show?
| Option | Description | Selected |
|--------|-------------|----------|
| Short app choices | Show up to three app names and ask the user to pick; no link until selection. | ✓ |
| Ask open question | Ask what they meant without listing candidates. | |
| Best guess plus confirm | Suggest one app and ask for confirmation before a link. | |

**User's choice:** Short app choices.

### How should the employee select one of those choices?
| Option | Description | Selected |
|--------|-------------|----------|
| Chat reply | Reply in the same thread with app name or number; no Slack-specific controls. | ✓ |
| Slack buttons | Tap a button; handle a new interaction event. | |
| Either method | Buttons plus typed reply. | |

**User's choice:** Chat reply.

### If the user replies with more detail rather than a choice?
| Option | Description | Selected |
|--------|-------------|----------|
| Re-evaluate with context | Use original request plus their reply to choose or ask again. | ✓ |
| Only accept a choice | Ask them to pick one of the listed apps. | |
| Start a new request | Route the reply as an unrelated request. | |

**User's choice:** Re-evaluate with context.

### How far should clarification continue?
| Option | Description | Selected |
|--------|-------------|----------|
| Two follow-ups | Allow two clarification replies, then offer examples or slash commands and invite a fresh request. | ✓ |
| One follow-up | After one unsuccessful reply, ask them to start again or use slash command. | |
| Keep asking | Continue until resolved or they stop replying. | |

**User's choice:** Two follow-ups. No further questions requested for this area.

---

## Offline matching

### What should the offline matcher use as its source of phrases?
| Option | Description | Selected |
|--------|-------------|----------|
| Published app intents | Use app-declared intents and descriptions. | ✓ |
| Central phrase list | Separate platform-wide list for every app. | |
| Both sources | App-declared intents plus central overrides. | |

**User's choice:** Published app intents.

### How forgiving should matching be?
| Option | Description | Selected |
|--------|-------------|----------|
| Keywords and aliases | Distinctive keywords and explicitly declared aliases; tolerate case and simple wording changes. | ✓ |
| Exact phrases only | Exact declared phrases or slash commands. | |
| Broad fuzzy matches | Loosely related or similar-sounding wording, even without alias. | |

**User's choice:** Keywords and aliases.

### When no authorized app matches offline, what should the user receive?
| Option | Description | Selected |
|--------|-------------|----------|
| Examples of available apps | Say no clear match and offer authorized app examples or slash commands. | ✓ |
| Ask for rewording only | Request clearer text without suggestions. | |
| Silent fallback | Generic failure, try later. | |

**User's choice:** Examples of available apps.

### If one clear authorized app is above its threshold, should offline issue a link?
| Option | Description | Selected |
|--------|-------------|----------|
| Issue link directly | Route like hosted provider; clarify only weak or competing matches. | ✓ |
| Always confirm offline | Confirm any app when hosted providers are down. | |
| Slash command only | Offline suggests but only slash commands issue links. | |

**User's choice:** Issue link directly. No further questions requested for this area.

---

## Provider data policy

### Where may a hosted provider process requests?
| Option | Description | Selected |
|--------|-------------|----------|
| Approved region only | Approved for deployment's locked region; otherwise route locally. | ✓ |
| Private deployment only | Provider inside enterprise network or cloud account. | |
| Any configured host | Configurable external provider without region restriction. | |

**User's choice:** Approved region only.

### What if the request contains an obvious email, phone or employee ID?
| Option | Description | Selected |
|--------|-------------|----------|
| Redact then route | Replace identifiers in request and recent turns before hosted call. | ✓ |
| Local only | Do not call hosted provider for that request. | |
| Send as written | Send unchanged to approved provider. | |

**User's choice:** Redact then route.

### What data-use promise is required?
| Option | Description | Selected |
|--------|-------------|----------|
| No training or retention | No training and no provider-side request retention beyond processing. | ✓ |
| No training | Forbid training but allow agreed retention. | |
| Region approval only | Leave retention and training to deployment policy. | |

**User's choice:** No training or retention.

### Can a deployment permanently run without a hosted provider?
| Option | Description | Selected |
|--------|-------------|----------|
| Yes, local-only | Rule-based routing is a supported normal deployment mode. | ✓ |
| Temporary only | Local-only during outages but hosted provider needed for normal operation. | |
| No | Hosted provider required before natural-language routing. | |

**User's choice:** Yes, local-only. No further questions requested for this area.

---

## Language handling

### How much English/Vietnamese support in Phase 3?
| Option | Description | Selected |
|--------|-------------|----------|
| Equal core coverage | Seeded app intents and offline matcher work in both; prompts use user's detected language. | ✓ |
| English-first | Offline English; Vietnamese uses hosted provider or clarification. | |
| Owner-declared only | Each app supports only languages its intents explicitly declare. | |

**User's choice:** Equal core coverage.

### What if message mixes English and Vietnamese terms?
| Option | Description | Selected |
|--------|-------------|----------|
| Treat as either language | Search both languages' authorized intents; clarify conflicts. | ✓ |
| Choose dominant language | Match only dominant-language intents. | |
| Ask to rephrase | Require single-language sentence. | |

**User's choice:** Treat as either language.

### What should unsupported-language clarification say?
| Option | Description | Selected |
|--------|-------------|----------|
| Bilingual guidance | Ask for English or Vietnamese with a few authorized slash examples. | ✓ |
| Language note only | Ask to retry in English or Vietnamese, no examples. | |
| Generic clarification | Ask what they want without language guidance. | |

**User's choice:** Bilingual guidance.

### What language for mixed-language clarification?
| Option | Description | Selected |
|--------|-------------|----------|
| Bilingual prompt | Concise English/Vietnamese question, published app names. | ✓ |
| Match first phrase | Use language of first recognizable phrase. | |
| Deployment default | Use configured default language. | |

**User's choice:** Bilingual prompt. No further questions requested for this area; user confirmed ready for context.

## The agent's Discretion

No question was delegated with "you decide". Exact copy, storage mechanics, provider/model selection and numerical defaults remain implementation/research details under CONTEXT.md, the frozen requirements and forthcoming AI-SPEC.

## Deferred Ideas

None. Provider/model choice belongs to the Phase 3 AI-SPEC, not a future feature.
