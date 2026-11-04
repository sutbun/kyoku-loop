import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnosticText } from "../extensions/mortal-helper/diagnostics.js";

test("inline confirmation status exposes only waiting metadata", () => {
  const text = diagnosticText(
    {
      tabId: 1,
      jobs: [
        {
          tabId: 1,
          phase: "waiting",
          claimed: false,
          awaitingConfirmation: true,
          token: "never-copy-token",
        },
      ],
    },
    "DEV-test",
  );
  assert.ok(text.includes("本人確認待ち：はい"));
  assert.ok(text.includes("送信操作済み：いいえ"));
  assert.ok(!text.includes("never-copy-token"));
});

test("an adopted manual result is labelled as manual submission rather than helper submission", () => {
  const text = diagnosticText(
    {
      tabId: 1,
      jobs: [
        { tabId: 1, phase: "analysing", claimed: true, manualSubmission: true },
      ],
    },
    "DEV-test",
  );
  assert.ok(text.includes("送信操作済み：手動送信（再送しません）"));
});

test("stopped batch diagnostics identify the job and raw cause using only safe metadata", () => {
  const status = {
    batch: {
      phase: "paused",
      reason: "reconstruction_failed",
      model: "4.1b",
      index: 1,
      items: [{ status: "done" }, { id: "fictional-replay", jobId: "job" }],
    },
    hasPendingPayload: true,
    jobs: [
      {
        id: "job",
        phase: "saved",
        claimed: true,
        task: "0123456789abcdef",
        filename: "Downloads/fictional.json",
        cookie: "never-copy-cookie",
        token: "never-copy-token",
        data: "never-copy-json",
      },
    ],
    answers: "never-copy-study",
  };
  const text = diagnosticText(status, "DEV-11.05-2", (v) =>
    v === "reconstruction_failed" ? "局面の照合失敗" : v,
  );
  for (const expected of [
    "DEV-11.05-2",
    "登録 1件 ／ 全2件",
    "[reconstruction_failed]",
    "fictional-replay",
    "4.1b",
    "0123456789abcdef",
    "Downloads/fictional.json",
    "保持JSON：あり",
    "送信操作済み：はい",
  ])
    assert.ok(text.includes(expected), expected);
  assert.ok(!text.includes("never-copy"));
});

test("single-page and unavailable job snapshots do not invent submission or save success", () => {
  const text = diagnosticText(
    {
      tabId: 3,
      jobs: [
        {
          tabId: 3,
          source: "https://game.mahjongsoul.com/?paipu=fictional-source",
          phase: "stopped",
          reason: "timeout",
          claimed: false,
        },
      ],
    },
    "DEV-test",
  );
  assert.ok(text.includes("fictional-source"));
  assert.ok(text.includes("[timeout]"));
  assert.ok(text.includes("送信操作済み：いいえ"));
  assert.ok(text.includes("登録ACK：未確認"));
  const empty = diagnosticText({}, "DEV-test");
  assert.ok(empty.includes("送信操作済み：未確認"));
});

test("a queued batch item never borrows the previous result from a reused tab", () => {
  const text = diagnosticText(
    {
      tabId: 3,
      batch: {
        phase: "paused",
        reason: "page_changed",
        model: "4.1b",
        index: 1,
        items: [{ status: "done" }, { id: "fictional-next", status: "queued" }],
      },
      jobs: [
        {
          id: "previous",
          tabId: 3,
          source: "https://game.mahjongsoul.com/?paipu=fictional-previous",
          task: "previous-result",
          phase: "registered",
          claimed: true,
        },
      ],
    },
    "DEV-test",
  );
  assert.ok(text.includes("牌譜ID：fictional-next"));
  assert.ok(text.includes("結果ID：未取得"));
  assert.ok(text.includes("送信操作済み：未確認"));
  assert.ok(!text.includes("previous-result"));
});
