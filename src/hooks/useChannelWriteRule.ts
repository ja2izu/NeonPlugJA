import { useMemo } from 'react';
import { useRadioCapabilities } from './useRadioCapabilities';
import { useOutOfBandActive } from './useOutOfBandActive';
import { useJapaneseNamesActive } from './useJapaneseNamesActive';
import { writeFilterOptionsFor } from '../services/writeFilterOptions';
import type { ChannelWriteRule } from '../services/validation/channelProblems';

/** The rule the current radio's write applies to channels, so the grid can mark channels by it. */
export function useChannelWriteRule(): ChannelWriteRule {
  const { caps, model } = useRadioCapabilities();
  const outOfBand = useOutOfBandActive();
  const nameBytes = useJapaneseNamesActive();
  return useMemo(
    () => ({ ...writeFilterOptionsFor(model, caps, outOfBand), maxNameLength: caps?.maxChannelNameLength ?? 16, nameBytes }),
    [model, caps, outOfBand, nameBytes]
  );
}
