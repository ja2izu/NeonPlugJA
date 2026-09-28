/**
 * What is wrong with a channel on this radio, cell by cell, by the rule its
 * write uses (writeFilter.ts).
 *
 * The grid never validated. A channel outside the radio's bands looked like any
 * other until the write left it out and reported a count afterwards, and a name
 * longer than the radio keeps was cut without a word.
 */

import type { Channel } from '../../models/Channel';
import { isNoTxFrequency, isRxInNoTxBand, isValidFrequencyRange } from './frequencyValidator';
import { isChannelWritable, type WriteFilterOptions } from './writeFilter';
import { nameByteLength, unwritableChars } from '../../utils/japaneseNames';

export interface ChannelWriteRule extends WriteFilterOptions {
  /** capabilities.maxChannelNameLength */
  maxNameLength: number;
  /** 日本語名 ON: maxNameLength をバイト数として数え、書けない字も問題にする */
  nameBytes?: boolean;
}

export interface ChannelProblems {
  rx?: string;
  tx?: string;
  name?: string;
}

const LEFT_OUT = 'so a write leaves this channel out.';

export function channelProblems(channel: Channel, rule: ChannelWriteRule): ChannelProblems {
  const problems: ChannelProblems = {};
  if (rule.nameBytes) {
    const bad = unwritableChars(channel.name);
    if (bad.length) {
      problems.name = `書けない字があります: ${bad.join(' ')}`;
    } else if (nameByteLength(channel.name) > rule.maxNameLength) {
      problems.name = `${rule.maxNameLength} バイトを超えています（英数字 1、漢字・かな 2）。書込で切り詰めます。`;
    }
  } else if (channel.name.length > rule.maxNameLength) {
    problems.name = `Longer than the ${rule.maxNameLength} characters this radio keeps.`;
  }
  if (isChannelWritable(channel, rule)) return problems;

  // Which frequency fails isWritableChannelFrequency, checked the same way.
  const bad = (mhz: number) =>
    rule.outOfBand ? !(mhz > 0 && mhz < 1000) : !(mhz > 0 && isValidFrequencyRange(mhz, rule.bandLimits));
  const why = (mhz: number) =>
    mhz <= 0
      ? `No frequency, ${LEFT_OUT}`
      : rule.outOfBand
        ? `Too high to store, ${LEFT_OUT}`
        : `Outside this radio's bands, ${LEFT_OUT}`;
  const blankTx =
    rule.outOfBand || rule.blankTxAnyBand
      ? isNoTxFrequency(channel.txFrequency)
      : isRxInNoTxBand(channel.rxFrequency) && channel.forbidTx && isNoTxFrequency(channel.txFrequency);

  if (bad(channel.rxFrequency)) problems.rx = why(channel.rxFrequency);
  if (!blankTx && bad(channel.txFrequency)) problems.tx = why(channel.txFrequency);
  return problems;
}
