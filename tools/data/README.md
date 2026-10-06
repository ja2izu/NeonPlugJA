# tools/data

- `master_1990.csv` — 日本語名の字表（JIS X 0208 の字と、GB2312 への割り当て・供出区点）。**JA2IZU が別プロジェクトで作成したファイル**で、著作権は JA2IZU にあります。ライセンスはこのリポジトリと同じ MIT License です（2026-10-06 JA2IZU 確認）。
- 生成：`tools/gen-name-codec-tables.py`（`src/radios/dm32uv/nameCodecTables.ts` を作る）、検証：`tools/gen-name-codec-parity.py`。
