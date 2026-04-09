import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { appConfig } from "./config.js";

function loadOrCreateSecret() {
  mkdirSync(path.dirname(appConfig.secretFile), { recursive: true });

  try {
    return Buffer.from(readFileSync(appConfig.secretFile, "utf8"), "base64");
  } catch {
    const secret = randomBytes(32);
    writeFileSync(appConfig.secretFile, secret.toString("base64"), "utf8");
    return secret;
  }
}

const secret = loadOrCreateSecret();

export function encryptText(value: string | null) {
  if (!value) {
    return null;
  }

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secret, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
}

export function decryptText(value: string | null) {
  if (!value) {
    return null;
  }

  const [ivText, tagText, encryptedText] = value.split(":");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    secret,
    Buffer.from(ivText, "base64")
  );
  decipher.setAuthTag(Buffer.from(tagText, "base64"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64")),
    decipher.final()
  ]);

  return decrypted.toString("utf8");
}
