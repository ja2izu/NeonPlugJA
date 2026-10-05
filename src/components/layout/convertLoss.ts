/**
 * What converting a codeplug for another radio removes or changes, one item each.
 *
 * It was one paragraph joined with ". " and "(s)" plurals, and two of its
 * clauses printed no number at all — "channels had a scan list reference
 * cleared" — because they treated formatPlural as returning the count with the
 * noun. It returns only the noun.
 */

import type { MigrationLoss } from '../../services/codeplugMigration';
import { formatPlural } from '../../utils/formatPlural';

import { tr } from '../../utils/tr';  // NeonPlugJA: 日本語表示
const count = (n: number, noun: string) => `${n.toLocaleString()} ${formatPlural(n, noun)}`;

export function describeMigrationLoss(loss: MigrationLoss): string[] {
  const items: string[] = [];
  // Same nouns, same order, as the import summary.
  const removed: [number, string][] = [
    [loss.channelsDropped, 'channel'],
    [loss.zonesLost, 'zone'],
    [loss.scanListsLost, 'scan list'],
    [loss.contactsLost, 'contact'],
    [loss.quickContactsLost, 'talk group'],
    [loss.rxGroupsLost, 'RX group'],
    [loss.radioIdsLost, 'DMR radio ID'],
    [loss.messagesLost, 'quick message'],
    [loss.digitalEmergenciesLost, 'digital emergency system'],
    [loss.encryptionKeysLost, 'encryption key'],
  ];
  for (const [n, noun] of removed) if (n > 0) items.push(tr("{0} removed", count(n, noun)));

  if (loss.zoneChannelsTrimmed > 0)
    items.push(tr("{0} trimmed to this radio's per-zone limit", count(loss.zoneChannelsTrimmed, 'zone member')));
  if (loss.scanListChannelsTrimmed > 0)
    items.push(tr("{0} trimmed to this radio's limit", count(loss.scanListChannelsTrimmed, 'scan list member')));
  if (loss.rxGroupMembersTrimmed > 0)
    items.push(tr("{0} trimmed to this radio's limit", count(loss.rxGroupMembersTrimmed, 'RX group member')));
  if (loss.scanListRefsCleared > 0)
    items.push(
      tr("{0} lost a scan list reference: the list does not exist on this radio", count(loss.scanListRefsCleared, 'channel'))
    );
  if (loss.powerLevelsDowngraded > 0)
    items.push(
      tr("{0} stepped down to the strongest power this radio supports", count(loss.powerLevelsDowngraded, 'channel'))
    );
  if (loss.settingsCleared) items.push(tr("Radio settings cleared: they do not map between radios"));
  return items;
}
