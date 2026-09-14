// Uniform, cryptographically secure characters for application and receipt codes.
export function randomCode(alphabet, length) {
  const limit = 256 - (256 % alphabet.length);
  let code = '';
  const bytes = new Uint8Array(32);
  while (code.length < length) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit) code += alphabet[byte % alphabet.length];
      if (code.length === length) break;
    }
  }
  return code;
}
