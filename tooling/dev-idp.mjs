// Dev launcher: boot the in-repo StubOidcIssuer on a fixed loopback port
// (53416) and keep it alive. The API is pointed at it via OIDC_ISSUER.
import { StubOidcIssuer } from 'file:///C:/Vibe-Code/labs-aka-vn/aka-nexa/apps/api/dist/auth/oidc-issuer.stub.js';

const issuer = await StubOidcIssuer.start();
process.stdout.write('STUB_IDP_ORIGIN=' + issuer.origin + '\n');
process.stdout.write('STUB_IDP_READY\n');
setInterval(() => {}, 2147483647);
