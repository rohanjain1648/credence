import { describe, expect, test } from "vitest";
import { handleCronTick } from "@/lib/cron";

const req = (auth?: string) => new Request("http://localhost/api/cron/tick", { method: "POST", headers: auth ? { authorization: auth } : {} });
const run = async () => ({ stages: [{ name: "flushMemory", ok: true, ms: 1 }] });

describe("cron tick handler", () => {
  test("rejects a missing bearer", async () => {
    expect((await handleCronTick(req(), { secret: "s3cret", run })).status).toBe(401);
  });

  test("rejects a wrong bearer", async () => {
    expect((await handleCronTick(req("Bearer nope"), { secret: "s3cret", run })).status).toBe(401);
  });

  test("accepts CRON_SECRET and returns the tick report", async () => {
    const res = await handleCronTick(req("Bearer s3cret"), { secret: "s3cret", run });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stages: [{ name: "flushMemory", ok: true, ms: 1 }] });
  });

  test("refuses to run when no secret is configured", async () => {
    expect((await handleCronTick(req("Bearer anything"), { secret: undefined, run })).status).toBe(503);
  });
});
