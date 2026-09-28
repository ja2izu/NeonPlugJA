/*
 * NeonPlugJA Ver.0.91 — DM-32UV 日本語（GB2312・供出区点）対応
 * Copyright (c) 2026 JA2IZU. MIT License.
 * Based on NeonPlug (https://github.com/infamy/NeonPlug), MIT License,
 * Copyright (c) NeonPlug contributors.
 */
/**
 * 日本語名 ON で、書けない字を含む名前があるときに書込を止めた理由。
 */
import React from 'react';
import type { UnwritableName } from '../../services/validation/japaneseNameCheck';
import { Callout, DialogHeading } from '../ui/DialogParts';

const SHOWN = 30;

export const JapaneseNamesBlockedBody: React.FC<{ items: readonly UnwritableName[] }> = ({ items }) => (
  <div className="space-y-4 text-sm pb-1">
    <Callout tone="danger" title="字庫に無い字を含む名前があるため、書込を止めました">
      無線機には何も送っていません。
    </Callout>
    <section>
      <DialogHeading>{`書けない字を含む名前（${items.length} 件）`}</DialogHeading>
      <ul className="space-y-1">
        {items.slice(0, SHOWN).map((u, i) => (
          <li key={i}>
            <span className="text-cool-gray">{u.what}</span>{' '}
            <span className="text-white">{u.name}</span>{' '}
            <span className="text-red-300">書けない字: {u.chars.join(' ')}</span>
          </li>
        ))}
      </ul>
      {items.length > SHOWN && <p className="text-xs text-muted mt-1">ほか {items.length - SHOWN} 件</p>}
    </section>
    <section className="border-t border-neon-cyan border-opacity-20 pt-4">
      <DialogHeading>直し方</DialogHeading>
      <p className="text-cool-gray">
        該当する名前を入力し直してください。CPS の入力で化けた字（丒 など）は、元の字に直してください。
        チャンネル一覧では、該当する名前の欄が赤く表示されます。
      </p>
    </section>
  </div>
);
