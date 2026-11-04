import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  payloadHash,
  pendingPayload,
  putPayload,
  getPayload,
  removePayload,
} from "../extensions/mortal-helper/payloads.js";

test("retains the single unacknowledged report across imports and refuses another job", async () => {
  const data = btoa('{"fictional":true}');
  const payload = { jobId: "one", data, hash: await payloadHash(data) };
  await putPayload(payload);
  assert.deepEqual(await getPayload("one"), payload);
  await assert.rejects(
    putPayload({ ...payload, jobId: "two" }),
    /payload_storage_failed/,
  );
  await removePayload("two");
  assert.deepEqual(await pendingPayload(), payload);
  await assert.rejects(
    putPayload({ ...payload, data: btoa("changed") }),
    /invalid_report/,
  );
  assert.deepEqual(await getPayload("one"), payload);
  await removePayload("one");
  assert.equal(await pendingPayload(), null);
});

test("does not accept an empty, malformed or oversized report", async () => {
  await assert.rejects(payloadHash(""), /size_limit/);
  await assert.rejects(payloadHash("!not-base64!"), /invalid_report/);
  await assert.rejects(
    payloadHash("A".repeat(28 * 1024 * 1024 + 4)),
    /size_limit/,
  );
});
