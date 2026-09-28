#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
# Copyright (c) 2026 JA2IZU. MIT License.
# Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
# Copyright (c) NeonPlug contributors.
"""
gen-name-codec-parity.py - 日本語名コーデックのテスト期待値を dm32_slotmap.py から作る

使い方:
    python3 tools/gen-name-codec-parity.py <dm32_slotmap.py のあるフォルダ> \
        tools/data/master_1990.csv <ZoneTestDM32-5.csv> <ZoneTestDM32-5M.csv> \
        tests/fixtures/nameCodec/slotmapParity.json

出力（JSON）:
    masterSha256 : master の SHA-256
    encode       : GBK の2バイト全字について、CPS 経由の手順（CSV の encode）で書かれるバイト列
                   { chars: 文字を並べた文字列, gbk: 各字の GBK の16進, bytes: 各字の16進（未割当は null） }
    decode       : GB2312 全区点について、CSV の decode で戻る文字
                   { hex: 区点の16進を並べた配列, chars: 戻る文字を並べた文字列 }
    zoneTest     : 実データ（CPS で書き実機で表示を確認済み）の Zone 名
                   [{ ja: 置換前の名前, hex: 置換後のバイト列 }]
"""
import csv
import hashlib
import json
import os
import sys


def main():
    if len(sys.argv) != 6:
        sys.stderr.write(__doc__)
        sys.exit(1)
    smdir, master, zone_ja, zone_gb, out = sys.argv[1:6]
    sys.path.insert(0, smdir)
    import dm32_slotmap as sm

    t = sm.load_master(master)
    encmap = {j: sm.gb2312_bytes(d) for j, d in t.j2d.items()}
    decmap = {}
    for d, j in t.d2j.items():
        b = sm.gbk_bytes(j)
        if b is not None:
            decmap[d] = b

    # encode: GBK 2バイト全字
    enc_chars = []
    enc_gbk = []
    enc_bytes = []
    for lead in range(0x81, 0xFF):
        for trail in range(0x40, 0xFF):
            if trail == 0x7F:
                continue
            raw = bytes([lead, trail])
            try:
                c = raw.decode("gbk")
            except UnicodeDecodeError:
                continue
            if len(c) != 1:
                continue
            if sm.find_unassigned(raw, t):
                enc_bytes.append(None)
            else:
                o, _ = sm.substitute(raw, encmap, "parity")
                enc_bytes.append(o.hex().upper())
            enc_chars.append(c)
            enc_gbk.append(raw.hex().upper())

    # decode: GB2312 全区点
    dec_hex = []
    dec_chars = []
    for ku in range(1, 88):
        for ten in range(1, 95):
            raw = bytes([0xA0 + ku, 0xA0 + ten])
            try:
                raw.decode("gb2312")
            except UnicodeDecodeError:
                continue
            o, _ = sm.substitute(raw, decmap, "parity")
            dec_hex.append(raw.hex().upper())
            dec_chars.append(o.decode("gbk"))

    # zoneTest: 実データの Zone 名
    def names(path):
        rows = open(path, "rb").read().split(b"\r\n")[1:]
        return [r.split(b",")[1] for r in rows if b"," in r]

    ja = names(zone_ja)
    gb = names(zone_gb)
    if len(ja) != len(gb):
        sys.stderr.write("Zone 数が違う\n")
        sys.exit(1)
    zone = []
    for a, b in zip(ja, gb):
        o, _ = sm.substitute(a, encmap, "parity")
        if o != b:
            sys.stderr.write("置換結果が CSV と違う: %r\n" % a)
            sys.exit(1)
        zone.append({"ja": a.decode("gbk"), "hex": b.hex().upper()})

    res = {
        "masterSha256": hashlib.sha256(open(master, "rb").read()).hexdigest(),
        "source": {
            "zoneJa": {"name": os.path.basename(zone_ja),
                       "sha256": hashlib.sha256(open(zone_ja, "rb").read()).hexdigest()},
            "zoneGb": {"name": os.path.basename(zone_gb),
                       "sha256": hashlib.sha256(open(zone_gb, "rb").read()).hexdigest()},
        },
        "encode": {"chars": "".join(enc_chars), "gbk": enc_gbk, "bytes": enc_bytes},
        "decode": {"hex": dec_hex, "chars": "".join(dec_chars)},
        "zoneTest": zone,
    }
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(res, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print("encode  : %d 字（未割当 %d）" % (len(enc_chars), enc_bytes.count(None)))
    print("decode  : %d 区点" % len(dec_hex))
    print("zoneTest: %d 件" % len(zone))
    print("出力    : %s" % out)


if __name__ == "__main__":
    main()
