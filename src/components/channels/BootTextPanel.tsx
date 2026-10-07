/*
 * NeonPlugJA Ver.0.93 — UV-K1 (25Ja) 起動画面の文言の入力欄
 * Copyright (c) 2026 JA2IZU. MIT License.
 */
import React from 'react';
import { useBootTextStore } from '../../store/bootTextStore';
import { UVK1_BOOT_TEXT_MAX_PX, UVK1_BOOT_TEXT_SIZE } from '../../radios/uvk1/constants';
import { bootTextBytes, bootTextWidth, truncateBootText, validateBootText } from '../../radios/uvk1/bootText';
import { FIELD } from '../ui/controlStyles';

/**
 * 起動画面の下端に出す文言（SPI 0x0089A0、24 バイト、幅 128 px 以内）。
 * 本体のメニュー「起動表示」を「ユーザー」にすると表示される。選択そのものは本体で行う（ここでは書かない）。
 */
export const BootTextPanel: React.FC = () => {
  const { supported, text, radioText, setText } = useBootTextStore();
  if (!supported) return null;
  const bytes = bootTextBytes(text);
  const width = bootTextWidth(text);
  const problems = validateBootText(text, '25ja');
  const changed = text !== radioText;
  return (
    <details className="mb-3 shrink-0 rounded border border-panel px-3 py-2 text-sm" open={changed || undefined}>
      <summary className="cursor-pointer text-neon-cyan font-bold">
        起動画面の文言{radioText ? `：${radioText}` : '（未設定）'}{changed ? '　※変更あり（書込で反映）' : ''}
      </summary>
      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={text}
            onChange={(e) => setText(truncateBootText(e.target.value))}
            placeholder="例：SN:123456789012345"
            aria-label="起動画面の文言"
            className={`${FIELD} border rounded px-2 py-1 text-sm w-96 max-w-full`}
          />
          <span className={`text-xs ${problems.length ? 'text-red-400' : 'text-cool-gray'}`}>
            {bytes}/{UVK1_BOOT_TEXT_SIZE} バイト・幅 {width}/{UVK1_BOOT_TEXT_MAX_PX} px
          </span>
        </div>
        {problems.length > 0 && <p className="text-xs text-red-400">{problems.join(' / ')}</p>}
        <p className="text-xs text-cool-gray">
          本体のメニュー「起動表示」を「ユーザー」にすると、この文言が起動画面の下に出ます（選択は本体で行います）。
          半角は 7 px、漢字・かなは 13 px で数え、24 バイトと 128 px の両方に収まる分だけ入力できます。
          空にして書き込むと、本体の既定の表示（「漢字万歳」）に戻ります。実機の表示は未確認です。
        </p>
      </div>
    </details>
  );
};
