export function diagnosticText(status, version, label = (value) => value) {
  const batch = status?.batch;
  const item = batch?.items?.[batch.index];
  const job = batch
    ? item?.jobId
      ? status?.jobs?.find((j) => j.id === item.jobId)
      : undefined
    : status?.jobs?.find((j) => j.tabId === status.tabId);
  const reason = batch?.reason || job?.reason || job?.transferError;
  const source = item?.id || job?.source?.split("paipu=")[1] || "未確認";
  const code = /^[a-z_]{1,60}$/.test(reason)
    ? reason
    : reason
      ? "operation_failed"
      : "";
  const total = batch?.items?.length;
  const saved = ["saved", "registered"].includes(job?.phase);
  return [
    `KyokuLoop Mortal Helper ${version}`,
    `状態：${batch?.phase || job?.phase || "待機中"}`,
    total
      ? `進捗：登録 ${batch.items.filter((i) => i.status === "done").length}件 ／ 全${total}件（スキップ ${batch.items.filter((i) => i.status === "skipped").length}件）`
      : "一括処理：なし",
    `停止理由：${code ? `${label(code)} [${code}]` : "なし"}`,
    `牌譜ID：${source}`,
    `モデル：${batch?.model || job?.model || "未確認"}`,
    `解析状態：${job?.phase || "未開始"}`,
    `送信操作済み：${job?.claimed === true ? "はい" : job?.claimed === false ? "いいえ" : "未確認"}`,
    `結果ID：${job?.task || "未取得"}`,
    `JSON保存：${saved ? "保存済み" : "未確認"}`,
    `保存先：${job?.filename || "未確認"}`,
    `登録ACK：${job?.phase === "registered" && job.registration?.source_link?.linked === true ? "元対局への登録確認済み" : "未確認"}`,
    `保持JSON：${status?.hasPendingPayload ? "あり（登録待ち）" : "なし"}`,
  ].join("\n");
}
