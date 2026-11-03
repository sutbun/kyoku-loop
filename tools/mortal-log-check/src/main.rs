//! Offline diagnostics only: no network, model, review submission or app database.
use convlog::{
    tenhou::{GameLength, Log},
    tenhou_to_mjai,
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs,
    io::{self, Read, Write},
};

const LIMIT: u64 = 32 * 1024 * 1024;
const UPSTREAM: &str = "2dc5ec5c8b28517cfb45f57eb21536d9a8f67aa9";

fn input_json(body: &str) -> Result<Value, String> {
    let text = body.trim_start_matches('\u{feff}').trim();
    if let Ok(value) = serde_json::from_str::<Value>(text) {
        if let Some(quoted) = value.as_str() {
            return input_json(quoted);
        }
        return Ok(value);
    }
    for prefix in ["https://tenhou.net/6/#json=", "https://tenhou.net/6#json="] {
        if let Some(fragment) = text.strip_prefix(prefix) {
            // This is local text decoding; the URL is never opened. '+' stays '+'.
            let decoded = percent_encoding::percent_decode_str(fragment)
                .decode_utf8()
                .map_err(|_| "invalid_utf8_fragment")?;
            return serde_json::from_str(&decoded).map_err(|e| e.to_string());
        }
    }
    Err("Expected Tenhou6 JSON or a pasted https://tenhou.net/6/#json=... URL".into())
}

fn fail(stage: &str, detail: impl ToString) -> Value {
    json!({"ok": false, "stage": stage, "detail": detail.to_string()})
}

fn physical(events: &[Value]) -> Value {
    let mut counts: HashMap<String, usize> = HashMap::new();
    let mut draws = 0;
    let mut rounds = 0;
    let mut context = json!({});
    for (index, event) in events.iter().enumerate() {
        let mut new_tiles = vec![];
        match event["type"].as_str().unwrap_or("") {
            "start_kyoku" => {
                counts.clear();
                draws = 0;
                rounds += 1;
                context = json!({"bakaze":event["bakaze"], "kyoku":event["kyoku"], "honba":event["honba"]});
                for hand in event["tehais"].as_array().into_iter().flatten() {
                    new_tiles.extend(hand.as_array().into_iter().flatten());
                }
                new_tiles.push(&event["dora_marker"]);
            }
            "tsumo" => {
                draws += 1;
                if draws > 70 {
                    return json!({"ok":false,"stage":"physical_tiles","detail":"more_than_70_draws","round":context,"event_index":index});
                }
                new_tiles.push(&event["pai"]);
            }
            "dora" => new_tiles.push(&event["dora_marker"]),
            _ => {}
        }
        for value in new_tiles {
            if let Some(tile) = value.as_str() {
                let base = tile.strip_suffix('r').unwrap_or(tile);
                let count = counts.entry(base.to_owned()).or_default();
                *count += 1;
                if *count > 4 {
                    return json!({"ok":false,"stage":"physical_tiles","detail":"more_than_4_copies","tile":base,"round":context,"event_index":index});
                }
            }
        }
    }
    json!({"ok":true,"stage":"pre_engine_checks","rounds":rounds,"events":events.len(),"engine_inference_tested":false})
}

#[cfg(test)]
fn diagnose(body: &str) -> Value {
    diagnose_with_output(body, None)
}

fn diagnose_with_output(body: &str, output: Option<&str>) -> Value {
    let value = match input_json(body) {
        Ok(v) => v,
        Err(e) => return fail("input_json", e),
    };
    let log = match Log::from_json_str(&value.to_string()) {
        Ok(log) => log,
        Err(e) => return fail("upstream_tenhou_parse", e),
    };
    if log.kyokus.is_empty() {
        return fail("rules", "no_rounds");
    }
    if log.game_length != GameLength::Hanchan {
        return fail("rules", "Mortal supports hanchan games only");
    }
    let events = match tenhou_to_mjai(&log) {
        Ok(events) => events,
        Err(e) => return fail("upstream_tenhou_to_mjai", e),
    };
    let values = events
        .iter()
        .map(|e| serde_json::to_value(e).expect("upstream event serializes"))
        .collect::<Vec<_>>();
    let report = physical(&values);
    if report["ok"] == true
        && let Some(path) = output
    {
        let write = (|| -> io::Result<()> {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(path)?;
            for event in &values {
                serde_json::to_writer(&mut file, event)?;
                writeln!(file)?;
            }
            Ok(())
        })();
        if let Err(error) = write {
            return fail("mjai_output", error);
        }
    }
    report
}

fn main() {
    let mut args = std::env::args().skip(1);
    let Some(path) = args.next() else {
        eprintln!("Usage: kyokuloop-mortal-log-check <local-file|-> [--mjai-out new-local-file]");
        std::process::exit(2)
    };
    if path == "--version" {
        println!(
            "kyokuloop-mortal-log-check {} / convlog {}",
            env!("CARGO_PKG_VERSION"),
            UPSTREAM
        );
        return;
    }
    let output = match args.next().as_deref() {
        None => None,
        Some("--mjai-out") => Some(args.next().unwrap_or_else(|| {
            eprintln!("Expected an output file after --mjai-out");
            std::process::exit(2);
        })),
        _ => {
            eprintln!("Expected --mjai-out new-local-file");
            std::process::exit(2);
        }
    };
    if args.next().is_some() {
        eprintln!("Too many arguments");
        std::process::exit(2);
    }
    let result = (|| -> io::Result<String> {
        let reader: Box<dyn Read> = if path == "-" {
            Box::new(io::stdin())
        } else {
            Box::new(fs::File::open(path)?)
        };
        let mut bytes = vec![];
        reader.take(LIMIT + 1).read_to_end(&mut bytes)?;
        if bytes.len() as u64 > LIMIT {
            return Err(io::Error::other("input exceeds 32 MiB"));
        }
        String::from_utf8(bytes).map_err(io::Error::other)
    })();
    let mut report = match result {
        Ok(body) => diagnose_with_output(&body, output.as_deref()),
        Err(e) => fail("local_input", e),
    };
    report["tool_version"] = json!(env!("CARGO_PKG_VERSION"));
    report["upstream_convlog_sha"] = json!(UPSTREAM);
    println!("{}", serde_json::to_string_pretty(&report).unwrap());
    if report["ok"] != true {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn explicit_mjai_export_never_overwrites_existing_files() {
        let target = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
        fs::create_dir_all(&target).unwrap();
        let path = target.join(format!("preserve-{}.txt", std::process::id()));
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .unwrap();
        file.write_all(b"keep original").unwrap();
        drop(file);
        assert_eq!(
            diagnose_with_output(&raw_fixture().to_string(), path.to_str())["stage"],
            "mjai_output"
        );
        assert_eq!(fs::read(&path).unwrap(), b"keep original");
        fs::remove_file(path).unwrap();
    }
    fn raw_fixture() -> Value {
        let codes = (11..=19)
            .chain(21..=29)
            .chain(31..=39)
            .chain(41..=47)
            .flat_map(|n| [n; 4])
            .collect::<Vec<_>>();
        let mut round = vec![
            json!([0, 0, 0]),
            json!([25000, 25000, 25000, 25000]),
            json!([codes[52]]),
            json!([]),
        ];
        for seat in 0..4 {
            round.push(json!(&codes[seat * 13..(seat + 1) * 13]));
            round.push(if seat == 0 {
                json!([codes[53]])
            } else {
                json!([])
            });
            round.push(if seat == 0 { json!([60]) } else { json!([]) });
        }
        round.push(json!(["流局", [0, 0, 0, 0]]));
        json!({"name":["架空A","架空B","架空C","架空D"],"rule":{"disp":"架空四人南","aka":1},"log":[round]})
    }
    #[test]
    fn upstream_conversion_reports_missing_dora_with_round_context() {
        let mut raw = raw_fixture();
        assert_eq!(diagnose(&raw.to_string())["ok"], true);
        raw["log"][0][2] = json!([]);
        let result = diagnose(&raw.to_string());
        assert_eq!(result["stage"], "upstream_tenhou_to_mjai");
        assert!(
            result["detail"]
                .as_str()
                .unwrap()
                .contains("kyoku 0 honba 0")
        );
    }
    #[test]
    fn east_only_empty_and_malformed_logs_are_distinguished() {
        let mut raw = raw_fixture();
        raw["rule"]["disp"] = json!("架空四人東");
        assert_eq!(diagnose(&raw.to_string())["stage"], "rules");
        raw["log"] = json!([]);
        assert_eq!(diagnose(&raw.to_string())["detail"], "no_rounds");
        raw["log"] = json!([[1]]);
        assert_eq!(diagnose(&raw.to_string())["stage"], "upstream_tenhou_parse");
    }
    fn deck() -> Vec<String> {
        let mut tiles = vec![];
        for suit in ['m', 'p', 's'] {
            for n in 1..=9 {
                for _ in 0..4 {
                    tiles.push(format!("{n}{suit}"));
                }
            }
        }
        for honor in ["E", "S", "W", "N", "P", "F", "C"] {
            for _ in 0..4 {
                tiles.push(honor.into());
            }
        }
        tiles
    }
    fn start() -> Value {
        let d = deck();
        json!({"type":"start_kyoku","bakaze":"E","kyoku":1,"honba":0,"dora_marker":d[52],"tehais":[&d[0..13],&d[13..26],&d[26..39],&d[39..52]]})
    }
    #[test]
    fn physical_ledger_does_not_recount_discards_or_calls() {
        assert_eq!(
            physical(&[
                start(),
                json!({"type":"dahai","pai":"1m"}),
                json!({"type":"pon","pai":"1m"})
            ])["ok"],
            true
        );
    }
    #[test]
    fn fifth_copy_across_players_is_rejected() {
        let mut s = start();
        s["tehais"][1][0] = json!("1m");
        assert_eq!(physical(&[s])["detail"], "more_than_4_copies");
    }
    #[test]
    fn red_five_shares_the_four_copy_limit() {
        let mut s = start();
        s["tehais"][1][3] = json!("5mr");
        assert_eq!(physical(&[s.clone()])["ok"], true);
        assert_eq!(
            physical(&[s, json!({"type":"tsumo","pai":"5m"})])["detail"],
            "more_than_4_copies"
        );
    }
    #[test]
    fn seventy_first_draw_is_rejected_without_tile_overflow() {
        let mut e = vec![start()];
        e.extend(
            deck()
                .iter()
                .skip(53)
                .take(71)
                .map(|t| json!({"type":"tsumo","pai":t})),
        );
        assert_eq!(physical(&e)["detail"], "more_than_70_draws");
    }
    #[test]
    fn local_url_decoding_preserves_plus_and_supports_quoted_urls() {
        let u = "https://tenhou.net/6/#json=%7B%22x%22%3A%22a+b%22%7D";
        assert_eq!(input_json(u).unwrap()["x"], "a+b");
        assert_eq!(input_json(&json!(u).to_string()).unwrap()["x"], "a+b");
        assert!(input_json("https://game.mahjongsoul.com/?paipu=fictional").is_err());
    }
}
