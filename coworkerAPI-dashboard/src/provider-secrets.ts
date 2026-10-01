import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedProviderSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: 1;
};

/** Provider credentials are recoverable upstream secrets, unlike hashed client keys. */
export class ProviderSecrets {
  private readonly key: Buffer;
  constructor(masterKey = process.env.MASTER_ENCRYPTION_KEY) {
    if (!masterKey || !/^[a-fA-F0-9]{64}$/.test(masterKey)) {
      throw new Error("MASTER_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.");
    }
    this.key = Buffer.from(masterKey, "hex");
  }

  encrypt(providerId: string, secret: string): EncryptedProviderSecret {
    if (!providerId || !secret || secret.length > 16_384) throw new Error("Invalid provider credential.");
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    // Binding ciphertext to its provider prevents credential swapping in storage.
    cipher.setAAD(Buffer.from(`coworkerapi:provider:${providerId}:1`));
    const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    return { ciphertext: encrypted.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), keyVersion: 1 };
  }

  decrypt(providerId: string, encrypted: EncryptedProviderSecret): string {
    try {
      if (encrypted.keyVersion !== 1) throw new Error();
      const iv = Buffer.from(encrypted.iv, "base64");
      const tag = Buffer.from(encrypted.authTag, "base64");
      if (iv.length !== 12 || tag.length !== 16) throw new Error();
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAAD(Buffer.from(`coworkerapi:provider:${providerId}:1`));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(encrypted.ciphertext, "base64")), decipher.final()]).toString("utf8");
    } catch {
      // Never include secret values or crypto diagnostics in public errors.
      throw new Error("Unable to decrypt the provider credential.");
    }
  }
}
