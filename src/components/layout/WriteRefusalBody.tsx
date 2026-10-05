/**
 * A write the planner refused, laid out. writeRefusal.ts reads the planner's
 * text into a lead, lists and paragraphs, and says why it stays text.
 */

import React from 'react';
import { parseRefusal } from './writeRefusal';

import { tr } from '../../utils/tr';  // NeonPlugJA: 日本語表示
export const WriteRefusalBody: React.FC<{ refusal: string }> = ({ refusal }) => {
  const { lead, blocks } = parseRefusal(refusal);
  return (
    <div className="space-y-3 text-sm pb-1">
      {lead && <p className="text-white">{lead}</p>}
      {blocks.map((block, i) =>
        block.kind === 'list' ? (
          <ul key={i} className="ml-4 list-disc space-y-0.5 text-xs text-cool-gray">
            {block.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
            {block.more > 0 && (
              <li className="list-none -ml-4 text-muted">{tr("…and")} {block.more.toLocaleString()} more</li>
            )}
          </ul>
        ) : (
          <p key={i} className="text-cool-gray">
            {block.text}
          </p>
        )
      )}
      <p className="border-t border-neon-cyan border-opacity-20 pt-3 text-xs text-muted">
        {tr("Nothing was sent to the radio.")}
      </p>
    </div>
  );
};
