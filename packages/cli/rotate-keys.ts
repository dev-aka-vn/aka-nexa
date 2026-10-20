import { Keyring } from '@akane/platform';

export interface RotateKeysResult {
  readonly previousActiveKid: string;
  readonly newActiveKid: string;
  readonly retained: readonly string[];
  readonly overlapExpiry: Date;
  readonly alreadyActive: boolean;
}

export interface RotateKeysDeps {
  readonly keyring: Keyring;
  readonly overlapMs?: number;
}

const DEFAULT_OVERLAP_MS = 24 * 60 * 60 * 1000;

export async function rotateKeys(
  newKid: string,
  keyring: Keyring,
  overlapMs: number = DEFAULT_OVERLAP_MS,
): Promise<RotateKeysResult> {
  const active = await keyring.keyId();
  if (newKid === active) {
    return {
      previousActiveKid: active,
      newActiveKid: active,
      retained: await keyring.retainedKids(),
      overlapExpiry: keyring.overlapExpiry() ?? new Date(Date.now() + overlapMs),
      alreadyActive: true,
    };
  }
  if (!(await keyring.hasKid(newKid))) {
    throw new Error(`KEY_NOT_FOUND: ${newKid} is not in the keyring`);
  }
  const previous = active;
  await keyring.retainKid(previous, overlapMs);
  await keyring.promoteActive(newKid, overlapMs);
  const expiry = new Date(Date.now() + overlapMs);
  return {
    previousActiveKid: previous,
    newActiveKid: newKid,
    retained: await keyring.retainedKids(),
    overlapExpiry: keyring.overlapExpiry(previous) ?? expiry,
    alreadyActive: false,
  };
}

function parseArgs(args: string[]): { newKid?: string } {
  const out: { newKid?: string } = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--kid' || a === '--new-kid') out.newKid = args[++i];
    else if (a.startsWith('--kid=') || a.startsWith('--new-kid=')) out.newKid = a.split('=')[1];
    else if (!a.startsWith('--')) out.newKid = a;
  }
  return out;
}

export async function runRotateKeys(
  args: string[] = process.argv.slice(2),
  deps?: RotateKeysDeps,
): Promise<void> {
  const parsed = parseArgs(args);
  if (!deps?.keyring) {
    console.error('keyring required');
    process.exitCode = 2;
    return;
  }
  if (!parsed.newKid) {
    console.error('missing --kid');
    process.exitCode = 2;
    return;
  }
  try {
    const result = await rotateKeys(parsed.newKid, deps.keyring, deps.overlapMs ?? DEFAULT_OVERLAP_MS);
    if (result.alreadyActive) {
      console.log(`already-active: ${result.newActiveKid}`);
    } else {
      console.log(`previous_active_kid: ${result.previousActiveKid}`);
      console.log(`new_active_kid: ${result.newActiveKid}`);
      console.log(`retained: ${result.retained.join(',')}`);
      console.log(`overlap_expiry: ${result.overlapExpiry.toISOString()}`);
    }
  } catch (err) {
    console.error((err as Error).message);
    process.exitCode = 1;
  }
}