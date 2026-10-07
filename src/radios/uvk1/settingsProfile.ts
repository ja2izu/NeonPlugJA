/*
 * NeonPlugJA Ver.0.94 — Quansheng UV-K1 (25Ja firmware) settings profile
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
import type { OptionItem, SettingsProfile } from '../../types/settingsProfile';
import { UVK1_KEY_ACTIONS } from './settings';

/**
 * 25Ja (UV-K1) 設定タブ。値・範囲は 25Ja ファームのソースの読みによる。JA2IZU の実機確認済み（2026-10-07）。
 * 項目名は本体メニューの英語名を括弧内に併記する。
 */

const opts = (labels: string[]): OptionItem[] => labels.map((label, value) => ({ value, label }));

/** Key action options. IDs the radio may hold but this table does not offer are shown as unknown. */
const KEY_OPTIONS: OptionItem[] = (() => {
  const known = new Map(UVK1_KEY_ACTIONS.map(([id, name]) => [id, name]));
  const all: OptionItem[] = [];
  for (let id = 0; id <= 20; id++) all.push({ value: id, label: known.get(id) ?? `不明（${id}）・選べません` });
  return all;
})();

const key = (k: string, label: string, hint?: string) => ({
  key: `radioSpecific.${k}`, label, type: 'select' as const, options: KEY_OPTIONS, ...(hint ? { hint } : {}),
});

const BACKLIGHT_TIME: OptionItem[] = [
  { value: 0, label: 'OFF' },
  ...Array.from({ length: 60 }, (_, i) => ({ value: i + 1, label: `${(i + 1) * 5} 秒` })),
  { value: 61, label: '常時ON' },
];

const SCAN_RESUME: OptionItem[] = [
  { value: 0, label: 'STOP（停止したまま）' },
  ...Array.from({ length: 80 }, (_, i) => ({ value: i + 1, label: `CARRIER ${((i + 1) * 0.25).toFixed(2).replace(/\.?0+$/, '')} 秒` })),
  ...Array.from({ length: 24 }, (_, i) => ({ value: 81 + i, label: `TIMEOUT ${(i + 1) * 5} 秒` })),
];

const LIST_OPTIONS: OptionItem[] = [
  ...Array.from({ length: 24 }, (_, i) => ({ value: i + 1, label: `スキャングループ ${i + 1}` })),
  { value: 25, label: 'ALL（すべて）' },
];

const PROVENANCE = '値は 25Ja ファームのソースの読み。JA2IZU の実機確認済み（2026-10-07）。';

export const UVK1_SETTINGS_PROFILE: SettingsProfile = {
  radioType: 'UV-K1 (25Ja)',
  sections: [
    {
      id: 'basic',
      title: '基本',
      fields: [
        { key: 'radioSpecific.squelch', label: 'スケルチ（Sql）', type: 'select', options: opts(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) },
        { key: 'radioSpecific.txTimeoutSec', label: '送信時間制限（TxTOut・秒）', type: 'number', min: 30, max: 900, step: 5, hint: '5 秒単位（30 秒〜15 分）。' },
        { key: 'radioSpecific.batterySave', label: '省電力（BatSav）', type: 'select', options: opts(['OFF', '1:1', '1:2', '1:3', '1:4', '1:5']) },
        { key: 'radioSpecific.micGain', label: 'マイク感度（Mic）', type: 'select', options: opts(['0', '1', '2', '3', '4', '5', '6', '7', '8']) },
        { key: 'radioSpecific.ste', label: 'テール消去（STE）', type: 'checkbox' },
        { key: 'radioSpecific.rpSte', label: 'リピーターテール消去（RP STE）', type: 'select', options: opts(['OFF', ...Array.from({ length: 10 }, (_, i) => `${(i + 1) * 100} ms`)]) },
        {
          key: 'radioSpecific.roger', label: 'ラジャー音（Roger）', type: 'select',
          options: [{ value: 0, label: 'OFF' }, { value: 1, label: 'ROGER' }, { value: 4, label: 'Custom 1' }, { value: 5, label: 'Custom 2' }, { value: 6, label: 'Custom 3' }],
          hint: 'MDC・Yan ID は 25Ja で使えないため選べません。本体にその値が入っていると OFF と表示します。',
        },
        { key: 'radioSpecific.keyBeep', label: 'キービープ（Beep）', type: 'checkbox' },
      ],
    },
    {
      id: 'rxmode',
      title: '待受・メイン VFO',
      fields: [
        {
          key: 'radioSpecific.rxMode', label: '待受方式（RxMode）', type: 'select',
          options: opts(['メインのみ', 'デュアル受信応答', 'クロスバンド', '主送信・2 波受信']),
          hint: 'メイン VFO（下）と一緒に 3 か所のバイトに保存されます。' + PROVENANCE,
        },
        { key: 'radioSpecific.txVfo', label: 'メイン VFO（TX_VFO）', type: 'select', options: opts(['A', 'B']) },
        { key: 'radioSpecific.chDisplay', label: 'CH 表示（ChDisp）', type: 'select', options: opts(['FREQ', 'CH 番号', 'NAME', 'NAME+FREQ']) },
      ],
    },
    {
      id: 'scan',
      title: 'スキャン',
      fields: [
        { key: 'radioSpecific.scanResume', label: 'スキャン再開（ScnRev）', type: 'select', options: SCAN_RESUME },
        {
          key: 'radioSpecific.scanFast', label: 'スキャン速度（SetScn）', type: 'select', options: opts(['NORMAL', 'FAST']),
          hint: '保存値は反転しています。本体のバージョンを更新する前に書いた設定は、更新直後は FAST と表示されることがあります。',
        },
        { key: 'radioSpecific.priorityScan', label: '優先スキャン', type: 'checkbox' },
        { key: 'radioSpecific.defaultList', label: '既定スキャングループ（SList）', type: 'select', options: LIST_OPTIONS },
        { key: 'radioSpecific.priorityCh1', label: '優先 CH 1', type: 'number', min: 0, max: 1024, hint: 'チャンネル番号（1〜1024）。0 = なし。保存値は 0 始まり、なしは 1024（ファームのソースで確認）。' },
        { key: 'radioSpecific.priorityCh2', label: '優先 CH 2', type: 'number', min: 0, max: 1024, hint: 'チャンネル番号（1〜1024）。0 = なし。' },
        { key: 'radioSpecific.callCh', label: 'ワンキー呼出 CH', type: 'number', min: 1, max: 1024, hint: 'チャンネル番号（1〜1024）。' },
      ],
    },
    {
      id: 'display',
      title: '表示・照明',
      fields: [
        { key: 'radioSpecific.backlightTime', label: '照明時間（BLTime）', type: 'select', options: BACKLIGHT_TIME },
        { key: 'radioSpecific.backlightMin', label: '照明 最小（BLMin）', type: 'select', options: opts(Array.from({ length: 10 }, (_, i) => String(i))), hint: '0〜9。最大より小さい値だけ書けます。' },
        { key: 'radioSpecific.backlightMax', label: '照明 最大（BLMax）', type: 'select', options: opts(Array.from({ length: 11 }, (_, i) => String(i))) },
        { key: 'radioSpecific.backlightTxRx', label: '送受信時の照明（BLTxRx）', type: 'select', options: opts(['OFF', 'TX', 'RX', 'TX/RX']) },
        { key: 'radioSpecific.batteryText', label: '電池表示（BatTXT）', type: 'select', options: opts(['NONE', 'VOLTAGE', 'PERCENT']) },
        { key: 'radioSpecific.micBar', label: '送信中のマイクバー（MicBar）', type: 'checkbox' },
        { key: 'radioSpecific.contrast', label: '表示濃度（SetCtr）', type: 'select', options: Array.from({ length: 15 }, (_, i) => ({ value: i + 1, label: String(i + 1) })) },
      ],
    },
    {
      id: 'operation',
      title: '動作',
      fields: [
        { key: 'radioSpecific.lockRange', label: 'ロック範囲（SetLck）', type: 'select', options: opts(['KEYS', 'KEYS+PTT']) },
        { key: 'radioSpecific.autoKeyLock', label: '自動キーロック（KeyLck・秒）', type: 'number', min: 0, max: 600, step: 15, hint: '0 = OFF。15 秒単位（〜10 分）。' },
        { key: 'radioSpecific.sleepMin', label: 'スリープ（SetOff・分）', type: 'number', min: 0, max: 120, hint: '0 = OFF。' },
        { key: 'radioSpecific.timer', label: 'タイマー（SetTmr）', type: 'checkbox', hint: '本体メニューでは隠れている項目です。' },
        { key: 'radioSpecific.navKeys', label: '機種依存キー（SetNav）', type: 'select', options: opts(['LEFT/RIGHT（K1）', 'UP/DOWN（K5 V3）']), hint: '本体では隠しメニューの項目です。' },
        { key: 'radioSpecific.batteryType', label: '電池の種類（BatTyp）', type: 'select', options: opts(['1600K5', '2200K5', '3500K5', '1400K1', '2500K1']), hint: '本体では隠しメニューの項目です。' },
        {
          key: 'radioSpecific.fLock', label: '送信周波数ロック（F Lock）', type: 'select',
          options: opts([
            '標準（137-174 / 400-470）', 'FCCアマ（144-148 / 420-450）', 'CAアマ（144-148 / 430-450）', 'JA/CEアマ（144-146 / 430-440）', 'GBアマ（144-148 / 430-440）',
            '137-174 / 400-430', '137-174 / 400-438', 'PMR 446', 'GMRS FRS MURS', '全送信 禁止',
          ]),
          hint: '本体では隠しメニュー（PTT と上側のサイドキーを押しながら電源を入れる）の項目です。UNLOCK ALL（10）は本体メニューからだけ設定できます。並びは 25Ja（Fusion）のものです。',
        },
        { key: 'radioSpecific.rx350', label: '350 MHz 受信解除', type: 'checkbox', hint: '本体では隠しメニュー（PTT と上側のサイドキーを押しながら電源を入れる）の項目です。' },
      ],
    },
    {
      id: 'keys',
      title: 'キー割当',
      fields: [
        key('keyMenuLong', 'MENU 長押し'),
        key('keyPf1Short', 'PF1 短押し'),
        key('keyPf1Long', 'PF1 長押し', '名称は本体メニューの表示（日本語）です。25Ja の番号は CHIRP と違います。'),
        key('keyPf2Short', 'PF2 短押し'),
        key('keyPf2Long', 'PF2 長押し'),
      ],
    },
  ],
};
