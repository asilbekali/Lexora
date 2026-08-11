/**
 * Generates a scrypt hash for ADMIN_PASSWORD_HASH.
 *
 *   npm run hash-password -- 'your-password'
 *
 * Paste the output into .env and remove the plaintext ADMIN_PASSWORD.
 */

import { hashPassword } from './auth.ts'

const password = process.argv[2]

if (!password) {
  console.error("Usage: npm run hash-password -- 'your-password'")
  process.exit(1)
}

console.log(`ADMIN_PASSWORD_HASH=${await hashPassword(password)}`)
