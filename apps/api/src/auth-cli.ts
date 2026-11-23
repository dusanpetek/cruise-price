import { randomBytes } from 'node:crypto';
import { generateTotpSecret, hashPassword, otpauthUri } from './auth';

/**
 * Creates the sign-in settings for the .env file:
 *   pnpm --filter @cruise/api auth:setup [--user dusan] [--password '...'] [--totp]
 * Without --password a random one is made and printed. With --totp it also prints the authenticator secret.
 */
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const user = option('user') ?? 'dusan';
const given = option('password') ?? process.env.AUTH_PASSWORD;
const password = given ?? randomBytes(15).toString('base64url');
if (password.length < 12) {
  console.error('The password must have at least 12 characters.');
  process.exit(1);
}

const lines = [`AUTH_USER=${user}`, `AUTH_PASSWORD_HASH=${await hashPassword(password)}`, `AUTH_SESSION_SECRET=${randomBytes(32).toString('hex')}`];
let totp: string | null = null;
if (args.includes('--totp')) {
  totp = generateTotpSecret();
  lines.push(`AUTH_TOTP_SECRET=${totp}`);
}

console.log('# Put these lines into the .env file of the server:');
console.log(lines.join('\n'));
console.log('');
if (!given) console.log(`# Password (shown only now, not stored anywhere): ${password}`);
if (totp) {
  console.log('# Authenticator app (Microsoft Authenticator: "+" > "Anderes Konto" > "Code manuell eingeben"): enter this key,');
  console.log(`# name "Cruise Price Tracker", type time-based:  ${totp.match(/.{1,4}/g)!.join(' ')}`);
  console.log(`# or as a link (for apps/QR generators): ${otpauthUri(totp, user)}`);
}
