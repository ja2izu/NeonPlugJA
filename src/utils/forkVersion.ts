/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */

/**
 * フォークの名前と版。上流の版（utils/version.ts の APP_VERSION）とは別に持つ。
 * 画面には「NeonPlugJA 0.91.1（NeonPlug v2026.9.0 ベース）」のように両方を出す。
 * 版の付け方: 節目までは枝番（0.91.1, 0.91.2 …）、1.0 で初公開。
 */
export const FORK_NAME = 'NeonPlugJA';

/** フォークの版。上流を取り込んだときは上流の版ではなくこちらを上げる */
export const FORK_VERSION = '0.94.10';

export const FORK_AUTHOR = 'JA2IZU';

/** フォークの公開先（GitHub）。オフライン版ダウンロード・About のリンクに使う。公開先を変えるときはここだけ直す */
export const FORK_REPO = 'ja2izu/NeonPlugJA';
export const FORK_REPO_URL = `https://github.com/${FORK_REPO}`;
/** 配布する単一 HTML の名前（リリースに latest 版も同名で付ける） */
export const FORK_RELEASE_ASSET = 'neonplugja-latest.html';

export const FORK_LABEL = `${FORK_NAME} ${FORK_VERSION}`;
