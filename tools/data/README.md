# tools/data

- `master_1990.csv` — 日本語名の字表（JIS X 0208 の字と、GB2312 への割り当て・供出区点）。**JA2IZU が別プロジェクトで作成したファイル**で、著作権は JA2IZU にあります。ライセンスはこのリポジトリと同じ MIT License です（2026-10-06 JA2IZU 確認）。
- 内容：DM-32UV 内蔵の元フォント（BDF）に存在する字の有無を JIS と照合した一覧です。**字形（グリフ本体）は含まず**、字の有無・区点・コードを数えて並べたものです。元フォントの権利は不明ですが、作成者（JA2IZU）はパブリックドメインと認識しています（**未確認**）。字形を含まないため、元フォントの著作権の対象ではないと判断しています。
- 生成：`tools/gen-name-codec-tables.py`（`src/radios/dm32uv/nameCodecTables.ts` を作る）、検証：`tools/gen-name-codec-parity.py`。
- `master_1990_v2.csv` — `master_1990.csv` の派生版（2026-10-12）。かな・区1の記号・全角英数記号 332 字（`kind=moved`）を、GB2312 の区点から漢字域の空きの区点（区82〜87）へ移した。16 ドット表示は区4/5 のかなを描かないため。他の行は master_1990.csv と同じ。生成：`tools/gen-name-codec-tables.py tools/data/master_1990_v2.csv src/radios/dm32uv/nameCodecTables.ts`。
