#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
# Copyright (c) 2026 JA2IZU. MIT License.
# Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
# Copyright (c) NeonPlug contributors.
"""
gen-name-codec-tables.py - DM32 日本語名コーデックの変換表を master から生成する

使い方:
    python3 tools/gen-name-codec-tables.py tools/data/master_1990.csv \
        src/radios/dm32uv/nameCodecTables.ts

出力先の拡張子が .py なら、同じ表を Python の形式で書き出す（連絡先の生成ツール用）。
NeonPlugJA と生成ツールが同じ master から同じ表を作るための、唯一の生成元。

出力する表（すべて TypeScript のソースとして埋め込む。実行時に GBK デコーダは使わない）:
    GB_KU      : 区1-87 × 点1-94 の文字。GB2312 に無い区点は U+0000
                 GB2312 の区点→文字は Python の gb2312 コーデックで作る
                 （master の native 行 3,809 字がこれと一致することを検査する）
    DONOR_JA   : 置換対象の日本語 3,070 字（master の donor_jisonly 行の順）
    DONOR_SLOT : 上の各字を書く供出区点の通し番号 (区-1)*94+(点-1)
    ALIASES    : GBK で同じ区点のバイトになる別の Unicode（中点 U+00B7・ダッシュ U+2014）
    GBK_EXT    : GBK の2バイトのうち GB2312 の区点に無いもの（14,346 字）。第1バイト 0x81-0xFE ごとに
                 第2バイト 0x40-0xFE の 191 文字（無いものは U+0000）。読みだけで使う
                 （CPS が変換なしで書いた 関 島 などを読むため）

検査に失敗したら出力せずに終了する。
"""
import csv
import hashlib
import json
import sys

KU_MAX = 87
TEN_MAX = 94


def die(msg):
    sys.stderr.write("ERROR: %s\n" % msg)
    sys.exit(1)


def gb2312_char(ku, ten):
    b = bytes([0xA0 + ku, 0xA0 + ten])
    try:
        c = b.decode("gb2312")
    except UnicodeDecodeError:
        return None
    return c if len(c) == 1 else None


def main():
    if len(sys.argv) != 3:
        die("usage: gen-name-codec-tables.py <master_1990.csv> <out.ts>")
    master_path, out_path = sys.argv[1], sys.argv[2]

    raw = open(master_path, "rb").read()
    master_sha = hashlib.sha256(raw).hexdigest()
    rows = list(csv.DictReader(raw.decode("utf-8-sig").splitlines()))

    # GB2312 区点表
    grid = {}
    for ku in range(1, KU_MAX + 1):
        for ten in range(1, TEN_MAX + 1):
            c = gb2312_char(ku, ten)
            if c is not None:
                grid[(ku, ten)] = c
    if len(grid) != 7445:
        die("GB2312 の字数が 7445 でない: %d" % len(grid))

    # master の検査
    seen_char = set()
    seen_slot = set()
    donor_ja = []
    donor_slot = []
    counts = {}
    for r in rows:
        ch, kind = r["char"], r["kind"]
        ku, ten = int(r["ku"]), int(r["ten"])
        counts[kind] = counts.get(kind, 0) + 1
        if len(ch) != 1:
            die("1文字でない: %r" % ch)
        if bytes.fromhex(r["gb_hex"]) != bytes([0xA0 + ku, 0xA0 + ten]):
            die("gb_hex と区点が食い違う: %r" % r)
        if (ku, ten) not in grid:
            die("GB2312 に無い区点: %r" % r)
        if ch in seen_char:
            die("文字の重複: %r" % ch)
        if (ku, ten) in seen_slot:
            die("区点の重複: %d-%d" % (ku, ten))
        seen_char.add(ch)
        seen_slot.add((ku, ten))
        if kind in ("native_kana", "native_kanji"):
            if grid[(ku, ten)] != ch:
                die("native 行が GB2312 と一致しない: %r / %r" % (ch, grid[(ku, ten)]))
        elif kind == "donor_jisonly":
            if ch in grid.values():
                die("donor 行の字が GB2312 にある: %r" % ch)
            donor_ja.append(ch)
            donor_slot.append((ku - 1) * TEN_MAX + (ten - 1))
        else:
            die("未知の kind: %r" % kind)
    if counts != {"native_kana": 478, "native_kanji": 3331, "donor_jisonly": 3070}:
        die("件数が想定と違う: %r" % counts)

    # 別名（GBK 経由で同じ区点のバイトになる Unicode）
    aliases = {}
    for (ku, ten), c in grid.items():
        b = bytes([0xA0 + ku, 0xA0 + ten])
        g = b.decode("gbk")
        if g != c:
            aliases[g] = (ku - 1) * TEN_MAX + (ten - 1)
    if sorted(aliases) != ["\u00b7", "\u2014"]:
        die("別名が想定と違う: %r" % sorted(aliases))

    # GBK 拡張（GB2312 の区点に無い GBK の2バイト）
    gbk_rows = []
    gbk_count = 0
    for lead in range(0x81, 0xFF):
        row = []
        for trail in range(0x40, 0xFF):
            c = "\u0000"
            raw = bytes([lead, trail])
            gb_slot = (0xA1 <= lead <= 0xA0 + KU_MAX and 0xA1 <= trail <= 0xFE
                       and (lead - 0xA0, trail - 0xA0) in grid)
            if trail != 0x7F and not gb_slot:
                try:
                    d = raw.decode("gbk")
                except UnicodeDecodeError:
                    d = ""
                if len(d) == 1:
                    c = d
                    gbk_count += 1
            row.append(c)
        gbk_rows.append("".join(row))
    if gbk_count != 14346:
        die("GBK 拡張の字数が 14346 でない: %d" % gbk_count)

    if out_path.endswith('.py'):
        write_python(out_path, master_sha, grid, donor_ja, donor_slot, aliases, gbk_rows, gbk_count)
        return

    # 出力
    ku_lines = []
    for ku in range(1, KU_MAX + 1):
        s = "".join(grid.get((ku, ten), "\u0000") for ten in range(1, TEN_MAX + 1))
        ku_lines.append("  %s, // 区%d" % (json.dumps(s, ensure_ascii=False), ku))

    slot_lines = []
    for i in range(0, len(donor_slot), 20):
        slot_lines.append("  " + ", ".join(str(n) for n in donor_slot[i:i + 20]) + ",")

    alias_lines = []
    for g in sorted(aliases):
        alias_lines.append("  [0x%04X, %d]," % (ord(g), aliases[g]))

    ja_lines = []
    s = "".join(donor_ja)
    for i in range(0, len(s), 94):
        ja_lines.append("  %s +" % json.dumps(s[i:i + 94], ensure_ascii=False))
    ja_lines[-1] = ja_lines[-1][:-2] + ";"

    out = []
    out.append("/*")
    out.append(" * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応")
    out.append(" * Copyright (c) 2026 JA2IZU. MIT License.")
    out.append(" * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,")
    out.append(" * Copyright (c) NeonPlug contributors.")
    out.append(" */")
    out.append("// このファイルは tools/gen-name-codec-tables.py が生成する。手で編集しないこと。")
    out.append("// master: %s" % master_path.replace("\\", "/").split("/")[-1])
    out.append("// master SHA-256: %s" % master_sha)
    out.append("// GB2312 7,445 字 / 置換 %d 組 / 別名 %d / GBK 拡張 %d 字" % (len(donor_ja), len(aliases), gbk_count))
    out.append("")
    out.append("export const MASTER_SHA256 = '%s';" % master_sha)
    out.append("")
    out.append("/** 区1-87 の文字。1要素が1区、各94文字（点1-94）。GB2312 に無い区点は U+0000。 */")
    out.append("export const GB_KU: readonly string[] = [")
    out.extend(ku_lines)
    out.append("];")
    out.append("")
    out.append("/** 置換対象の日本語（GB2312 に無い字）。DONOR_SLOT と同じ順。 */")
    out.append("export const DONOR_JA: string =")
    out.extend(ja_lines)
    out.append("")
    out.append("/** DONOR_JA の各字を書く区点の通し番号 (区-1)*94+(点-1)。 */")
    out.append("export const DONOR_SLOT: readonly number[] = [")
    out.extend(slot_lines)
    out.append("];")
    out.append("")
    out.append("/**")
    out.append(" * GBK の2バイトのうち GB2312 の区点に無いもの。1要素が第1バイト 0x81-0xFE の1つ、")
    out.append(" * 各191文字（第2バイト 0x40-0xFE）。無いものは U+0000。読みだけで使う。")
    out.append(" */")
    out.append("export const GBK_EXT: readonly string[] = [")
    for i, r in enumerate(gbk_rows):
        out.append("  %s, // 0x%02X" % (json.dumps(r, ensure_ascii=False), 0x81 + i))
    out.append("];")
    out.append("")
    out.append("/** [Unicode, 区点の通し番号]。GBK で同じ区点のバイトになる別の文字。書きだけで受け付ける。 */")
    out.append("export const ALIASES: readonly (readonly [number, number])[] = [")
    out.extend(alias_lines)
    out.append("];")
    out.append("")

    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out))
    print("master  : %s" % master_sha)
    print("GB2312  : %d 字" % len(grid))
    print("置換    : %d 組" % len(donor_ja))
    print("別名    : %s" % ", ".join("U+%04X" % ord(g) for g in sorted(aliases)))
    print("GBK拡張 : %d 字" % gbk_count)
    print("出力    : %s" % out_path)


def write_python(out_path, master_sha, grid, donor_ja, donor_slot, aliases, gbk_rows, gbk_count):
    """同じ表を Python の形式で書き出す（連絡先の生成ツールが読む）"""
    out = []
    out.append("# -*- coding: utf-8 -*-")
    out.append("# NeonPlugJA — DM-32UV 日本語（GB2312・供出区点）の変換表")
    out.append("# Copyright (c) 2026 JA2IZU. MIT License.")
    out.append("# このファイルは tools/gen-name-codec-tables.py が生成する。手で編集しないこと。")
    out.append("# master SHA-256: %s" % master_sha)
    out.append("# GB2312 7,445 字 / 置換 %d 組 / 別名 %d / GBK 拡張 %d 字" % (len(donor_ja), len(aliases), gbk_count))
    out.append("")
    out.append("MASTER_SHA256 = \"%s\"" % master_sha)
    out.append("")
    out.append("# 区1-87 の文字。1要素が1区、各94文字（点1-94）。GB2312 に無い区点は U+0000。")
    out.append("GB_KU = (")
    for ku in range(1, KU_MAX + 1):
        s = "".join(grid.get((ku, ten), "\u0000") for ten in range(1, TEN_MAX + 1))
        out.append("    %s,  # 区%d" % (json.dumps(s, ensure_ascii=False), ku))
    out.append(")")
    out.append("")
    out.append("# 置換対象の日本語（GB2312 に無い字）。DONOR_SLOT と同じ順。")
    out.append("DONOR_JA = (")
    s = "".join(donor_ja)
    for i in range(0, len(s), 94):
        out.append("    %s" % json.dumps(s[i:i + 94], ensure_ascii=False))
    out.append(")")
    out.append("")
    out.append("# DONOR_JA の各字を書く区点の通し番号 (区-1)*94+(点-1)。")
    out.append("DONOR_SLOT = (")
    for i in range(0, len(donor_slot), 20):
        out.append("    " + ", ".join(str(n) for n in donor_slot[i:i + 20]) + ",")
    out.append(")")
    out.append("")
    out.append("# {Unicode: 区点の通し番号}。GBK で同じ区点のバイトになる別の文字。書きだけで受け付ける。")
    out.append("ALIASES = {")
    for g in sorted(aliases):
        out.append("    %s: %d," % (json.dumps(g, ensure_ascii=False), aliases[g]))
    out.append("}")
    out.append("")
    out.append("# GBK の2バイトのうち GB2312 の区点に無いもの。1要素が第1バイト 0x81-0xFE の1つ、")
    out.append("# 各191文字（第2バイト 0x40-0xFE）。無いものは U+0000。読みだけで使う。")
    out.append("GBK_EXT = (")
    for i, r in enumerate(gbk_rows):
        out.append("    %s,  # 0x%02X" % (json.dumps(r, ensure_ascii=False), 0x81 + i))
    out.append(")")
    out.append("")
    with open(out_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(out))
    print("master  : %s" % master_sha)
    print("GB2312  : %d 字" % len(grid))
    print("置換    : %d 組" % len(donor_ja))
    print("出力    : %s (Python)" % out_path)


if __name__ == "__main__":
    main()
