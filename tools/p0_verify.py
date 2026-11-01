"""Read-only P0 consistency spike. Not a production importer or mahjong engine.

Only local, user-selected reports are accepted. No HTTP, authentication or paid
analysis. Real observations and scenes must remain outside the Git repository.
"""
from __future__ import annotations

import argparse
import copy
import gzip
import json
import math
import re
from collections import Counter
from pathlib import Path

HONORS = ("E", "S", "W", "N", "P", "F", "C")
TILES = [f"{n}{s}" for s in "mps" for n in range(1, 10)] + list(HONORS)
SUPPORTED = {"start_kyoku", "tsumo", "dahai", "pon", "chi", "daiminkan", "ankan", "kakan", "reach", "reach_accepted", "dora"}


def tile(number: int) -> str:
    if type(number) is not int:
        raise ValueError("tile_type")
    if number in (51, 52, 53):
        return "5" + "mps"[number - 51] + "r"
    if number // 10 in (1, 2, 3) and 1 <= number % 10 <= 9:
        return str(number % 10) + "mps"[number // 10 - 1]
    if 41 <= number <= 47:
        return HONORS[number - 41]
    raise ValueError("tile_code")


def tile_index(value: str) -> int:
    return TILES.index(value.removesuffix("r"))


def validate_weights(row, declared: str) -> str | None:
    if not isinstance(row, list) or len(row) != 34:
        return "weight_shape"
    if any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in row):
        return "weight_value"
    if sum(row) == 0:
        return "weight_zero"
    try:
        if row[tile_index(declared)] != max(row):
            return "suggestion_mismatch"
    except (ValueError, TypeError, AttributeError):
        return "suggestion_tile"
    return None


def inspect_report(report: dict, seat: int = 0, model: int = 0, timeline: list | None = None) -> tuple[dict, list[dict]]:
    """Compare embedded converted logs with report events, then project scenes.

    This establishes internal consistency only. The embedded converted log is
    NOT independent proof of the original Mahjong Soul game or player identity.
    A mismatch or unsupported event invalidates all scenes in that round.
    """
    if not isinstance(report, dict):
        raise ValueError("root_shape")
    if seat not in range(4) or model < 0:
        raise ValueError("seat_or_model")
    rounds = report.get("pred")
    raw_chunks = report.get("custom_haihu")
    if not isinstance(rounds, list) or not isinstance(raw_chunks, list) or len(rounds) != len(raw_chunks):
        raise ValueError("round_shape")
    if report.get("data_version") != [1, 0]:
        raise ValueError("unsupported_data_version")
    if not isinstance(report.get("naga_types"), dict) or str(model) not in report["naga_types"]:
        raise ValueError("model_missing")
    return inspect_event_rounds(rounds, raw_chunks, seat, model, report["naga_types"], timeline)


def inspect_event_rounds(rounds, raw_chunks, seat, model=0, model_names=None, timeline=None):
    """Validate event streams against editor logs without assuming an AI engine.

    Assessment-free streams produce only public snapshots. Engine adapters bind
    their own evaluations separately; no foreign output is treated as NAGA data.
    """
    if seat not in range(4) or not isinstance(rounds, list) or len(rounds) != len(raw_chunks):
        raise ValueError("round_shape")
    model_names = model_names or {}
    totals, issues, excluded, scenes = Counter(), Counter(), Counter(), []
    round_results = []
    for ri, entries in enumerate(rounds):
        counts, errors, pending, steps = Counter(), Counter(), [], []
        try:
            raw_group = json.loads(raw_chunks[ri]) if isinstance(raw_chunks[ri], str) else raw_chunks[ri]
            if not isinstance(raw_group, list) or len(raw_group) != 1 or len(raw_group[0]) != 17:
                raise ValueError("custom_round_shape")
            raw = raw_group[0]
            start = entries[0]["info"]["msg"]
            if start["type"] != "start_kyoku" or len(start["tehais"]) != 4:
                raise ValueError("start_shape")
            if (start["bakaze"] not in HONORS[:4] or type(start["kyoku"]) is not int or start["kyoku"] not in range(1,5)
                    or any(type(start[k]) is not int or start[k] < 0 for k in ("honba","kyotaku","oya"))
                    or not isinstance(start["scores"],list) or len(start["scores"]) != 4
                    or any(type(s) is not int for s in start["scores"])):
                raise ValueError("start_metadata")
            hands = copy.deepcopy(start["tehais"])
            if any(not isinstance(h,list) or len(h) != 13 for h in hands):
                raise ValueError("initial_hand_length")
            if any(t not in TILES and t not in ("5mr","5pr","5sr") for h in hands for t in h):
                raise ValueError("initial_tile")
            if max(Counter(t.removesuffix("r") for h in hands for t in h).values()) > 4:
                raise ValueError("initial_tile_count")
            if all(Counter(map(tile, raw[4 + 3 * a])) == Counter(hands[a]) for a in range(4)):
                counts["initial_hands_match"] += 1
            else:
                errors["initial_hand_mismatch"] += 1
            if raw[1] == start["scores"]:
                counts["initial_scores_match"] += 1
            else:
                errors["initial_scores_mismatch"] += 1
            if raw[2] and tile(raw[2][0]) == start["dora_marker"]:
                counts["initial_dora_match"] += 1
            else:
                errors["initial_dora_mismatch"] += 1
            # Editor round number: 0..3 East, 4..7 South, etc. Verify,
            # rather than inferring match grouping from hanchan=True.
            if (raw[0][:3] == [HONORS.index(start["bakaze"]) * 4 + start["kyoku"] - 1, start["honba"], start["kyotaku"]]
                    and start["oya"] == (start["kyoku"] - 1) % 4):
                counts["round_metadata_match"] += 1
            else:
                errors["round_metadata_mismatch"] += 1
            draws, discards, last_draw = [0] * 4, [0] * 4, [None] * 4
            rivers, melds = [[] for _ in range(4)], [[] for _ in range(4)]
            declared_reach, accepted_reach = [False] * 4, [False] * 4
            scores, dora, kyotaku = start["scores"].copy(), [start["dora_marker"]], start["kyotaku"]
            def snapshot(index, kind, actor):
                return copy.deepcopy({
                    "round_index": ri, "event_index": index, "seat": seat,
                    "bakaze": start["bakaze"], "kyoku": start["kyoku"], "honba": start["honba"],
                    "own_wind": HONORS[(seat - start["oya"]) % 4], "own_hand": hands[seat],
                    "drawn": last_draw[seat], "rivers": rivers, "melds": melds,
                    "dora_markers": dora, "scores": scores, "kyotaku": kyotaku,
                    "reach_declared": declared_reach, "reach_accepted": accepted_reach,
                    "source_discard_index": discards[seat], "event_type": kind, "actor": actor,
                })
            if timeline is not None:
                steps.append(snapshot(0, "start_kyoku", None))
            for ei, entry in enumerate(entries[1:], 1):
                msg = entry["info"]["msg"]
                kind, actor = msg["type"], msg.get("actor")
                if kind not in SUPPORTED or kind == "start_kyoku":
                    errors["unsupported_event"] += 1
                    break
                if actor is not None and (type(actor) is not int or actor not in range(4)):
                    raise ValueError("actor")
                if kind == "tsumo":
                    source = raw[5 + 3 * actor][draws[actor]]
                    draws[actor] += 1
                    if type(source) is int and tile(source) == msg["pai"]:
                        counts["draw_match"] += 1
                    else:
                        errors["draw_mismatch"] += 1
                    hands[actor].append(msg["pai"])
                    last_draw[actor] = msg["pai"]
                elif kind in ("pon", "chi", "daiminkan"):
                    source = raw[5 + 3 * actor][draws[actor]]
                    draws[actor] += 1
                    marker = {"pon": "p", "chi": "c", "daiminkan": "m"}[kind]
                    source_tiles = [tile(int(n)) for n in re.findall(r"\d{2}", source)] if isinstance(source, str) else []
                    if isinstance(source, str) and marker in source and Counter(source_tiles) == Counter([msg["pai"], *msg["consumed"]]):
                        counts["meld_tiles_match"] += 1
                        # Observed editor token positions encode the source
                        # seat. The 4-tile minkan uses position 3 for shimocha.
                        relative = {"pon": {0: 1, 1: 2, 2: 3}, "chi": {0: 1}, "daiminkan": {0: 1, 1: 2, 3: 3}}[kind].get(source.index(marker) // 2)
                        if relative != (actor - msg["target"]) % 4:
                            errors["meld_target_mismatch"] += 1
                        else:
                            counts["meld_target_match"] += 1
                    else:
                        errors["meld_tiles_mismatch"] += 1
                    target = msg["target"]
                    if target not in range(4) or not rivers[target] or rivers[target][-1]["tile"] != msg["pai"]:
                        errors["called_discard_mismatch"] += 1
                    else:
                        rivers[target][-1]["called"] = True
                    for value in msg["consumed"]:
                        hands[actor].remove(value)
                    melds[actor].append({"type": kind, "tile": msg["pai"], "consumed": msg["consumed"].copy(), "target": target})
                    last_draw[actor] = None
                    if kind == "daiminkan":
                        # The editor's paired discard stream contains a zero,
                        # followed by the supplementary draw's actual discard.
                        if raw[6 + 3 * actor][discards[actor]] != 0:
                            errors["daiminkan_placeholder_mismatch"] += 1
                        discards[actor] += 1
                elif kind == "ankan":
                    source = raw[6 + 3 * actor][discards[actor]]
                    discards[actor] += 1
                    source_tiles = [tile(int(n)) for n in re.findall(r"\d{2}", source)] if isinstance(source, str) else []
                    if isinstance(source, str) and "a" in source and Counter(source_tiles) == Counter(msg["consumed"]):
                        counts["ankan_tiles_match"] += 1
                    else:
                        errors["ankan_tiles_mismatch"] += 1
                    for value in msg["consumed"]:
                        hands[actor].remove(value)
                    melds[actor].append({"type": kind, "consumed": msg["consumed"].copy()})
                    last_draw[actor] = None
                elif kind == "kakan":
                    source = raw[6 + 3 * actor][discards[actor]]
                    discards[actor] += 1
                    source_tiles = [tile(int(n)) for n in re.findall(r"\d{2}", source)] if isinstance(source, str) else []
                    if isinstance(source, str) and "k" in source and Counter(source_tiles) == Counter([msg["pai"], *msg["consumed"]]):
                        counts["kakan_tiles_match"] += 1
                    else:
                        errors["kakan_tiles_mismatch"] += 1
                    prior = next((m for m in melds[actor] if m["type"] == "pon"
                                  and Counter([m["tile"], *m["consumed"]]) == Counter(msg["consumed"])), None)
                    if prior is None:
                        errors["kakan_pon_missing"] += 1
                    else:
                        prior["type"] = "kakan"
                        prior["added"] = msg["pai"]
                        if prior["target"] != msg["target"]:
                            # In an observed report this field equals the
                            # actor itself. It is not a verified source-seat
                            # field for kakan. Preserve the editor-verified
                            # original pon target instead of overwriting it.
                            counts["kakan_target_metadata_diff"] += 1
                    hands[actor].remove(msg["pai"])
                    last_draw[actor] = None
                elif kind == "dahai":
                    source = raw[6 + 3 * actor][discards[actor]]
                    discards[actor] += 1
                    is_reach = isinstance(source, str) and source.startswith("r")
                    if is_reach:
                        source = int(source[1:])
                    value = last_draw[actor] if source == 60 else tile(source)
                    if value == msg["pai"]:
                        counts["discard_match"] += 1
                    else:
                        errors["discard_mismatch"] += 1
                    if is_reach and not declared_reach[actor]:
                        errors["reach_mismatch"] += 1
                    if bool(source == 60) != bool(msg["tsumogiri"]):
                        # The editor can encode an explicit tile for a tsumogiri.
                        # Equality to the drawn tile alone is ambiguous with duplicates.
                        if source == 60:
                            errors["tsumogiri_mismatch"] += 1
                    hands[actor].remove(msg["pai"])
                    rivers[actor].append({"tile": msg["pai"], "called": False, "reach": is_reach})
                    last_draw[actor] = None
                elif kind == "reach":
                    declared_reach[actor] = True
                elif kind == "reach_accepted":
                    expected_scores = scores.copy()
                    expected_scores[actor] -= 1000
                    if msg["scores"] != expected_scores or any(type(s) is not int for s in msg["scores"]):
                        errors["reach_scores_mismatch"] += 1
                    accepted_reach[actor] = True
                    scores = msg["scores"].copy()
                    kyotaku += 1
                elif kind == "dora":
                    if len(dora) >= len(raw[2]) or tile(raw[2][len(dora)]) != msg["dora_marker"]:
                        errors["dora_update_mismatch"] += 1
                    else:
                        counts["dora_update_match"] += 1
                    dora.append(msg["dora_marker"])
                if kind in ("tsumo", "dahai", "pon", "chi", "daiminkan", "ankan", "kakan"):
                    expected = 13 - 3 * len(melds[actor]) + (1 if kind in ("tsumo", "pon", "chi") else 0)
                    if len(hands[actor]) != expected:
                        errors["event_hand_length_mismatch"] += 1
                if timeline is not None:
                    steps.append(snapshot(ei, kind, actor))
                if "dahai_pred" not in entry:
                    continue
                following = next(((index, s["info"]["msg"]) for index, s in enumerate(entries[ei + 1:], ei + 1)
                                  if s["info"]["msg"]["type"] not in ("reach", "reach_accepted", "dora")), None)
                future = following[1] if following else None
                if not future or future["type"] != "dahai" or future.get("actor") != actor:
                    excluded["no_following_discard"] += 1
                    continue
                if msg.get("real_dahai") != future["pai"]:
                    errors["real_dahai_mismatch"] += 1
                    continue
                counts["assessment_discard_match"] += 1
                if actor != seat:
                    continue
                rows, suggestions = entry["dahai_pred"], msg.get("pred_dahai")
                if not isinstance(rows, list) or model >= len(rows) or not isinstance(suggestions, list) or model >= len(suggestions):
                    excluded["model_missing"] += 1
                    continue
                weight_error = validate_weights(rows[model], suggestions[model])
                if weight_error:
                    excluded[weight_error] += 1
                    continue
                expected_length = 14 - 3 * len(melds[seat])
                if len(hands[seat]) != expected_length or msg["real_dahai"] not in hands[seat] or suggestions[model] not in hands[seat]:
                    errors["decision_hand_mismatch"] += 1
                    continue
                # Reveal dora that becomes observable before this discard, but
                # do not leak the player's later reach choice into the question.
                visible_dora = dora + [s["info"]["msg"]["dora_marker"] for s in entries[ei + 1:following[0]]
                                       if s["info"]["msg"]["type"] == "dora"]
                # A copied public projection: never include other concealed hands.
                scene = copy.deepcopy({
                    "round_index": ri, "event_index": ei, "discard_event_index": following[0], "seat": seat,
                    "bakaze": start["bakaze"], "kyoku": start["kyoku"], "honba": start["honba"],
                    "own_wind": HONORS[(seat - start["oya"]) % 4], "own_hand": hands[seat],
                    "drawn": last_draw[seat], "rivers": rivers, "melds": melds,
                    "dora_markers": visible_dora, "scores": scores, "kyotaku": kyotaku,
                    "reach_declared": declared_reach, "reach_accepted": accepted_reach,
                    "actual": msg["real_dahai"], "suggested": suggestions[model],
                    "model_index": model, "model_name": model_names[str(model)],
                    "raw_weights": rows[model], "weight_total": sum(rows[model]),
                    "source_discard_index": discards[seat],
                })
                visible = scene["own_hand"] + scene["dora_markers"] + [t["tile"] for river in rivers for t in river if not t["called"]]
                for player_melds in melds:
                    for meld in player_melds:
                        visible += meld["consumed"] + ([meld["tile"]] if "tile" in meld else []) + ([meld["added"]] if "added" in meld else [])
                if max(Counter(t.removesuffix("r") for t in visible).values()) > 4:
                    errors["visible_tile_count_mismatch"] += 1
                    continue
                counts["visible_tile_count_match"] += 1
                pending.append(scene)
            if any(draws[a] != len(raw[5 + 3 * a]) or discards[a] != len(raw[6 + 3 * a]) for a in range(4)):
                errors["unconsumed_source_actions"] += 1
        except (KeyError, IndexError, TypeError, ValueError):
            errors["malformed_or_inconsistent_round"] += 1
        totals.update(counts)
        issues.update(errors)
        if not errors:
            scenes.extend(pending)
            if timeline is not None:
                timeline.extend(steps)
        round_results.append({"round_index": ri, "counts": dict(counts), "issues": dict(errors), "projected_decisions": len(pending) if not errors else 0})
    summary = {"rounds": len(rounds), "events": sum(map(len, rounds)), "seat": seat, "model": model,
               "counts": dict(totals), "issues": dict(issues), "excluded": dict(excluded),
               "projected_decisions": len(scenes), "round_results": round_results,
               "original_source_verified": False, "identity_verified": False, "p0_gate_passed": False}
    return summary, scenes


def select_five(scenes: list[dict]) -> list[dict]:
    selected = []
    predicates = [lambda s: any(t.endswith("r") for t in s["own_hand"]),
                  lambda s: any(m["type"] in ("ankan", "daiminkan", "kakan") for player in s["melds"] for m in player),
                  lambda s: bool(s["melds"][s["seat"]]),
                  lambda s: any(s["reach_accepted"]),
                  lambda s: s["own_wind"] != (selected[0]["own_wind"] if selected else None)]
    for predicate in predicates:
        match = next((s for s in scenes if s not in selected and predicate(s)), None)
        if match is not None:
            selected.append(match)
    for scene in scenes:
        if len(selected) >= 5:
            break
        if scene not in selected:
            selected.append(scene)
    return selected


def private_output(path: Path) -> Path:
    path = path.resolve()
    private_root = Path("D:/dev-data/kyoku-loop/private").resolve()
    if path != private_root and private_root not in path.parents:
        raise ValueError("output_must_be_in_private_root")
    if any((parent / ".git").exists() for parent in (path, *path.parents)):
        raise ValueError("output_must_not_be_in_git")
    path.mkdir(parents=True, exist_ok=True)
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--seat", type=int, default=0)
    parser.add_argument("--model", type=int, default=0)
    args = parser.parse_args()
    try:
        out = private_output(args.output)
        payload = args.report.read_bytes()
        if len(payload) > 20 * 1024 * 1024:
            raise ValueError("input_size_limit")
        if payload[:2] == b"\x1f\x8b":
            import io
            with gzip.GzipFile(fileobj=io.BytesIO(payload)) as stream:
                payload = stream.read(20 * 1024 * 1024 + 1)
        if len(payload) > 20 * 1024 * 1024:
            raise ValueError("decoded_size_limit")
        summary, scenes = inspect_report(json.loads(payload), args.seat, args.model)
        for name, value in (("summary.json", summary), ("scenes.json", scenes), ("five-decisions.json", select_five(scenes))):
            (out / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        # No path, URL, identity, hand, score or actual answer in stdout.
        print(json.dumps({key: summary[key] for key in ("rounds", "events", "counts", "issues", "excluded", "projected_decisions", "p0_gate_passed")}, ensure_ascii=True))
        return 0 if not summary["issues"] else 2
    except (ValueError, TypeError, OSError):
        print(json.dumps({"error": "invalid_input_or_output"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
