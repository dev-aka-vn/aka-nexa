// Dev launcher: boot the in-repo StubOidcIssuer and keep it alive.
// The compiled stub the API ships binds a fixed loopback port (53416 —
// a dev-only bind in apps/api/dist/auth/oidc-issuer.stub.js), so
// OIDC_ISSUER in .env stays stable across restarts; the printed
// STUB_IDP_ORIGIN remains the runtime truth. The SOURCE stub binds an
// ephemeral port for the spec suites — the dist override is what this
// launcher runs.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const stubPath = fileURLToPath(
  new URL('../apps/api/dist/auth/oidc-issuer.stub.js', import.meta.url),
);
if (!existsSync(stubPath)) {
  console.error(
    'dev-idp: apps/api/dist/auth/oidc-issuer.stub.js not found — build the api first (npm run build).',
  );
  process.exit(1);
}

const { StubOidcIssuer } = await import(
  'file:///' + stubPath.replace(/\\/g, '/')
);

const issuer = await StubOidcIssuer.start();
process.stdout.write('STUB_IDP_ORIGIN=' + issuer.origin + '\n');
process.stdout.write('STUB_IDP_READY\n');
setInterval(() => {}, 2147483647);
