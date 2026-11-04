import { describe, expect, test } from "vitest";
import { features, parseEnv } from "@/lib/env";

describe("env", () => {
  test("features are off when keys are missing", () => {
    expect(features(parseEnv({}))).toEqual({ tatum: false, memory: false, suiSigner: false, odds: false });
  });

  test("memory needs both account id and private key", () => {
    expect(features(parseEnv({ MEMWAL_ACCOUNT_ID: "0x1" })).memory).toBe(false);
    expect(features(parseEnv({ MEMWAL_ACCOUNT_ID: "0x1", MEMWAL_PRIVATE_KEY: "ab" })).memory).toBe(true);
  });

  test("sui signer needs both private key and package id", () => {
    expect(features(parseEnv({ SUI_RECEIPTS_PRIVATE_KEY: "suiprivkey1x" })).suiSigner).toBe(false);
    expect(features(parseEnv({ SUI_RECEIPTS_PRIVATE_KEY: "suiprivkey1x", SUI_RECEIPTS_PACKAGE_ID: "0x2" })).suiSigner).toBe(true);
  });

  test("empty strings count as missing", () => {
    expect(features(parseEnv({ TATUM_API_KEY: "" })).tatum).toBe(false);
  });

  test("defaults", () => {
    const e = parseEnv({});
    expect(e.MEMWAL_SERVER_URL).toBe("https://relayer.memory.walrus.xyz");
    expect(e.TATUM_DAILY_CREDIT_CAP).toBe(60000);
    expect(e.DATABASE_URL).toBe("file:./data/credence.db");
  });

  test("credit cap parses from string", () => {
    expect(parseEnv({ TATUM_DAILY_CREDIT_CAP: "1500" }).TATUM_DAILY_CREDIT_CAP).toBe(1500);
  });
});
