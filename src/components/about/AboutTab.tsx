import React, { useState } from 'react';
import { useDebugStore } from '../../store/debugStore';
import { useOutOfBandStore } from '../../store/outOfBandStore';
import { useJapaneseNamesStore } from '../../store/japaneseNamesStore';
import { FORK_LABEL, FORK_AUTHOR, FORK_REPO_URL } from '../../utils/forkVersion';
import { useRadioCapabilities } from '../../hooks/useRadioCapabilities';
import { RADIO_DESCRIPTORS } from '../../radios';
import { Card } from '../ui/Card';
import { SectionTitle } from '../ui/SectionTitle';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/ConfirmModal';
import { downloadOfflineAsZip, OFFLINE_RELEASE_URL } from '../../utils/offlineDownload';
import { PageHeader } from '../ui/PageHeader';
import { VERSION_LABEL, COMMIT_HASH, BUILD_TIME, IS_RELEASE_BUILD, RELEASE_NOTES_URL } from '../../utils/version';
import { latestEntry, whatsNewItems } from '../../utils/changelog';
import changelogSource from '../../../CHANGELOG.md?raw';

import { tr } from '../../utils/tr';  // NeonPlugJA: 日本語表示
// NeonPlugJA: 表示のたびに組み立てる（日本語表示の切替に追従するため）
const offlineFallbackMessage = () =>
  tr('The latest tagged release is published as a single downloadable HTML file.') + '\n\n' +
  tr('Click Download to save neonplugja-latest.html from GitHub Releases.') + '\n\n' +
  tr('Or build it locally using the instructions below.');

const LATEST_RELEASE = latestEntry(changelogSource);
const WHATS_NEW = LATEST_RELEASE ? whatsNewItems(LATEST_RELEASE) : [];

export const AboutTab: React.FC = () => {
  const { debugMode, setDebugMode } = useDebugStore();
  const { allowOutOfBandFrequencies, setAllowOutOfBandFrequencies } = useOutOfBandStore();
  const { caps } = useRadioCapabilities();
  const [outOfBandConfirmOpen, setOutOfBandConfirmOpen] = useState(false);
  const { japaneseNames, setJapaneseNames } = useJapaneseNamesStore();
  const [japaneseNamesConfirmOpen, setJapaneseNamesConfirmOpen] = useState(false);
  const [offlineFallbackOpen, setOfflineFallbackOpen] = useState(false);

  return (
    <>
    <div>
      <PageHeader
        title={tr("About NeonPlug")}
        description={tr("Online Digital CPS — program your radio directly from your browser.")}
      />

      <div className="space-y-6">
        {/* NeonPlugJA: フォークの版と出典。上流の版とは別に出す */}
        <Card>
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <SectionTitle>{FORK_LABEL}</SectionTitle>
            <span className="text-xs font-mono text-muted">NeonPlug {VERSION_LABEL} ベース</span>
          </div>
          <p className="text-cool-gray text-sm">
            DM-32UV の日本語（GB2312・供出区点）対応フォークです。日本語化したフォント（master_1990_v2）を焼いた
            無線機で、チャンネル名などに日本語を使えます。About の「日本語名」で切り替えます。
          </p>
          <p className="text-xs text-muted mt-2">
            Copyright (c) 2026 {FORK_AUTHOR} · MIT License ·
            Based on NeonPlug (Copyright (c) NeonPlug contributors), MIT License
          </p>
          <p className="text-xs text-cool-gray mt-3 leading-relaxed">
            <b>ご利用にあたって</b>：この開発では、コードのすべてについて Claude（Anthropic の AI）の作成支援を受けています。
            個人が自分のために作成したもので、十分な検証が済んでいない恐れがあります。無保証・サポートなしです。
            利用は自己責任でお願いします。バージョンアップを行うことはありますが、期待しないでください。
            使用に不安がある方や、内容が理解できない方には向いていません。無線機に書き込むソフトです。
            著作権は上位の NeonPlug と同じ MIT License とします。
          </p>
        </Card>

        {/* What's new — parsed from the bundled CHANGELOG.md so it works offline */}
        {LATEST_RELEASE && (
          <Card>
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <SectionTitle>{tr("What's New")}</SectionTitle>
              <span className="text-xs font-mono text-muted">
                {VERSION_LABEL}
                {LATEST_RELEASE.date && ` · ${LATEST_RELEASE.date}`}
              </span>
            </div>
            {!IS_RELEASE_BUILD && (
              <p className="text-xs text-muted mb-3">
                {tr("You're on a development build, which is ahead of the notes below.")}
              </p>
            )}
            <ul className="list-disc list-inside text-cool-gray text-sm space-y-1 ml-4">
              {WHATS_NEW.slice(0, 12).map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
            {WHATS_NEW.length > 12 && (
              <p className="text-xs text-muted mt-2">
                {tr("…and")} {WHATS_NEW.length - 12} more.
              </p>
            )}
            <p className="text-xs text-muted mt-3">
              <a
                href={RELEASE_NOTES_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="link-accent"
              >
                {tr("Full release notes and previous versions")}
              </a>
            </p>
          </Card>
        )}

        {/* Offline Version */}
        <Card>
          <SectionTitle>{tr("Offline Version")}</SectionTitle>
          <div className="space-y-4">
            <p className="text-cool-gray">
              Download a single-file version of NeonPlug that works completely offline. 
              This is a self-contained HTML file with all assets inlined - perfect for:
            </p>
            <ul className="list-disc list-inside text-cool-gray space-y-2 ml-4">
              <li>{tr("Running without an internet connection")}</li>
              <li>{tr("Portable use on any computer")}</li>
              <li>{tr("Backup and archival purposes")}</li>
            </ul>
            
            <div className="flex flex-col gap-3">
              <Button
                onClick={async () => {
                  try {
                    await downloadOfflineAsZip();
                  } catch {
                    setOfflineFallbackOpen(true);
                  }
                }}
                variant="primary"
                size="none"
                className="inline-flex items-center justify-center px-6 py-3"
              >
                {tr("📥 Download Offline Version (ZIP)")}
              </Button>
              
              <p className="text-xs text-muted">
                {tr("Downloads a ZIP containing neonplug.html. Unzip and open the HTML file in your browser.")}
                {typeof window !== 'undefined' && window.location.hostname === 'localhost' && (
                  <> {tr("From the dev server the downloaded file is the dev build (not standalone). For a single-file offline build, use the live site or run")} <code className="text-neon-cyan">npm run build:single</code>.</>
                )}
                {' '}{tr("If the button doesn't work,")}{' '}
                <a href={OFFLINE_RELEASE_URL} target="_blank" rel="noopener noreferrer" className="link-accent">download the latest release</a>{' '}
                instead.
              </p>
            </div>

            <Card variant="subdued" className="mt-4 border-opacity-30">
              <SectionTitle as="h4" size="sm">{tr("Building Locally")}</SectionTitle>
              <p className="text-cool-gray text-sm mb-2">
                {tr("To build your own offline version from source:")}
              </p>
              <pre className="bg-black rounded p-3 text-xs text-neon-cyan overflow-x-auto">
                {/* A string, not JSX text: JSX folds line breaks in text into
                    single spaces, so these four commands rendered as one line
                    that fails when pasted. */}
                <code>{`git clone ${FORK_REPO_URL}.git\ncd NeonPlugJA\nnpm install\nnpm run build:single`}</code>
              </pre>
              <p className="text-cool-gray text-xs mt-2">
                {tr("The single-file HTML will be in the")} <code className="text-neon-cyan">dist/index.html</code> file.
              </p>
            </Card>

            <Card variant="subdued" className="mt-4 border-opacity-30">
              <SectionTitle as="h4" size="sm">{tr("Using the Offline Version")}</SectionTitle>
              <ul className="list-disc list-inside text-cool-gray text-sm space-y-1 ml-4">
                <li>{tr("Simply open the downloaded")} <code className="text-neon-cyan">neonplug.html</code> file in any modern web browser</li>
                <li>{tr("No server or internet connection required - everything is in one file")}</li>
                <li>{tr("The Web Serial API will still work for connecting to your radio")}</li>
                <li>{tr("All features work exactly the same as the online version")}</li>
              </ul>
            </Card>
          </div>
        </Card>

        {/* Project Info */}
        <Card>
          <SectionTitle>{tr("Project Information")}</SectionTitle>
          <div className="space-y-3 text-cool-gray">
            <p>
              <span className="text-neon-cyan font-semibold">NeonPlug</span> {tr("is a next-generation, web-based Channel Programming Software (CPS). Built with a cyberpunk neon-themed UI, it provides an intuitive interface for managing channels, zones, scan lists, contacts, and radio settings — all from your browser, with no drivers or software to install.")}
            </p>
            <p>
              {tr("Each radio's full protocol is implemented natively, enabling read and write operations via the Web Serial API and — where supported — Bluetooth Low Energy (BLE).")}
            </p>
          </div>
        </Card>

        {/* Supported Radios */}
        <Card>
          <SectionTitle>{tr("Supported Radios")}</SectionTitle>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neon-cyan border-opacity-30">
                  <th className="text-left py-2 pr-4 text-neon-cyan font-semibold">{tr("Radio")}</th>
                  <th className="text-left py-2 pr-4 text-neon-cyan font-semibold">{tr("Manufacturer")}</th>
                  <th className="text-left py-2 text-neon-cyan font-semibold">{tr("Connection")}</th>
                </tr>
              </thead>
              <tbody>
                {RADIO_DESCRIPTORS.map((d) => (
                  <tr key={d.modelIds[0]} className="border-b border-neon-cyan border-opacity-10">
                    <td className="py-2 pr-4 text-white font-medium">
                      {d.icon} {d.modelIds.join(' / ')}
                    </td>
                    <td className="py-2 pr-4 text-cool-gray">{d.group ?? '—'}</td>
                    <td className="py-2 text-cool-gray">
                      {d.supportsBle ? tr("USB or BLE") : 'USB'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Codeplug format */}
        <Card>
          <SectionTitle>{tr("Codeplug format (.neonplug)")}</SectionTitle>
          <p className="text-cool-gray text-sm">
            {tr("The codeplug file is a zipped JSON archive. You can unzip it to inspect the contents in a semi-human-readable way (e.g.")} <code className="text-neon-cyan">codeplug.json</code> {tr("inside the zip). Editing the JSON directly is not recommended—use NeonPlug’s import/export and in-app editing instead, to avoid invalid data or corruption.")}
          </p>
        </Card>

        {/* Links */}
        <Card>
          <SectionTitle>{tr("Links")}</SectionTitle>
          <div className="space-y-3">
            <div>
              <span className="text-cool-gray">NeonPlugJA リポジトリ: </span>
              <a href={FORK_REPO_URL} target="_blank" rel="noopener noreferrer" className="link-accent">
                {FORK_REPO_URL}
              </a>
            </div>
            <div>
              <span className="text-cool-gray">{tr("NeonPlug Repository:")} </span>
              <a
                href="https://github.com/infamy/NeonPlug"
                target="_blank"
                rel="noopener noreferrer"
                className="link-accent"
              >
                https://github.com/infamy/NeonPlug
              </a>
            </div>
            <div>
              <span className="text-cool-gray">{tr("DM-32UV Protocol Specification:")} </span>
              <a
                href="https://github.com/infamy/DM32-Protocol-Spec"
                target="_blank"
                rel="noopener noreferrer"
                className="link-accent"
              >
                https://github.com/infamy/DM32-Protocol-Spec
              </a>
            </div>
          </div>
        </Card>

        {/* Credits */}
        <Card>
          <SectionTitle>{tr("Credits")}</SectionTitle>
          <div className="space-y-3 text-cool-gray">
            <p>
              <span className="text-neon-cyan font-semibold">{tr("Developer:")}</span>{' '}
              <a
                href="https://github.com/infamy"
                target="_blank"
                rel="noopener noreferrer"
                className="link-accent"
              >
                infamy
              </a>
            </p>
            <p>
              {tr("Radio protocols were implemented through reverse engineering — serial port captures, analysis of official CPS software, and reference to open-source projects including CHIRP. The DM-32UV protocol specification is documented separately.")}
            </p>
            <div className="mt-4 space-y-2">
              <p className="text-sm text-cool-gray">
                {tr("Built with React, TypeScript, Vite, and Tailwind CSS")}
              </p>
              <div className="text-xs text-cool-gray font-mono">
                <div>
                  <span className="text-cool-gray">{tr("Version:")} </span>
                  <span className="text-neon-cyan">{VERSION_LABEL}</span>
                  {!IS_RELEASE_BUILD && (
                    <span className="text-muted"> (development build)</span>
                  )}
                </div>
                <div className="mt-1">
                  <span className="text-cool-gray">Commit: </span>
                  <span className="text-neon-cyan">{COMMIT_HASH}</span>
                </div>
                {BUILD_TIME && (
                  <div className="mt-1">
                    <span className="text-cool-gray">{tr("Built:")} </span>
                    <span className="text-neon-cyan">
                      {new Date(BUILD_TIME).toLocaleString()}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>

        {/* Data Sources & Attribution */}
        <Card>
          <SectionTitle>{tr("Data Sources & Attribution")}</SectionTitle>
          <div className="space-y-4 text-cool-gray">
            <p className="text-sm">
              {tr("NeonPlug uses data from the following sources. We are grateful to these organizations and projects for making their data available.")}
            </p>
            
            <div className="space-y-3">
              <div>
                <SectionTitle as="h4" size="sm" className="mb-1">RadioID.net</SectionTitle>
                <p className="text-sm mb-2">
                  {tr("DMR contact database and API for downloading contacts by country.")}
                </p>
                <a
                  href="https://radioid.net"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-accent text-sm"
                >
                  https://radioid.net
                </a>
              </div>

              <div>
                <SectionTitle as="h4" size="sm" className="mb-1">{tr("TAFL Database")}</SectionTitle>
                <p className="text-sm mb-2">
                  {tr("Canadian radio frequency license data from the Technical Acceptance and Frequency List (TAFL), maintained by Innovation, Science and Economic Development Canada (ISED).")}
                </p>
                <a
                  href="https://ised-isde.canada.ca/site/spectrum-management-telecommunications/en"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="link-accent text-sm"
                >
                  ISED Spectrum Management
                </a>
              </div>

              <div>
                <SectionTitle as="h4" size="sm" className="mb-1">{tr("Airport Frequency Data")}</SectionTitle>
                <p className="text-sm mb-2">
                  {tr("Airport communication frequencies and location data from open aviation databases, including ICAO-compliant frequency information.")}
                </p>
                <div className="space-y-1">
                  <a
                    href="https://frequency.icao.int"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-accent block text-sm"
                  >
                    ICAO Frequency Finder
                  </a>
                  <a
                    href="https://airportmap.de/data"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="link-accent block text-sm"
                  >
                    Airportmap Open Databases
                  </a>
                </div>
              </div>
            </div>

            <div className="mt-4 pt-3 border-t border-neon-cyan border-opacity-20">
              <p className="text-xs text-cool-gray italic">
                {tr("Data accuracy and completeness may vary. Always verify critical frequency information with official sources before use.")}
              </p>
            </div>
          </div>
        </Card>

        {/* License */}
        <Card>
          <SectionTitle>{tr("License")}</SectionTitle>
          <p className="text-cool-gray text-sm">
            {tr("This software is provided \"as is\" without warranty. Use at your own risk. Ensure compliance with local radio regulations and manufacturer warranties.")}
          </p>
        </Card>

        {/* Debug Mode */}
        <div className="bg-deep-gray rounded-lg border border-yellow-600/30 p-6">
          <h3 className="text-lg font-semibold text-yellow-400 mb-4">{tr("Debug Mode")}</h3>
          <div className="space-y-3">
            <p className="text-cool-gray text-sm">
              Enable debug mode to access diagnostic tools for inspecting raw memory blocks and verifying field parsing.
            </p>
            <button
              type="button"
              onClick={() => setDebugMode(!debugMode)}
              className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                debugMode
                  ? 'bg-yellow-900/30 text-yellow-400 border border-yellow-600/30 hover:bg-yellow-900/50'
                  : 'bg-yellow-900/20 text-yellow-500 border border-yellow-600/20 hover:bg-yellow-900/30'
              }`}
            >
              {debugMode ? tr("✓ Debug Mode Enabled") : tr("Enable Debug Mode")}
            </button>
            {debugMode && (
              <p className="text-xs text-yellow-400">
                {tr("Debug mode is enabled. The Diagnostics tab (🐛) is now visible in the navigation bar.")}
              </p>
            )}
          </div>
        </div>

        {/* Out-of-band frequencies. Hidden until debug mode is on, and shown whenever the
            switch is on, so it can always be turned off. DM-32 only for now. */}
        {caps?.supportsOutOfBandFrequencies && (debugMode || allowOutOfBandFrequencies) && (
          <div className="bg-deep-gray rounded-lg border-2 border-red-500 p-6">
            <h3 className="text-2xl font-bold text-red-400 mb-3">{tr("⚠ Out-of-band frequencies")}</h3>
            <div className="space-y-3">
              <p className="text-base font-semibold text-red-300">
                {tr("For radios with modified firmware only. Writing frequencies outside a stock radio's bands can make the write fail or leave the radio misbehaving, and transmitting outside the bands a radio was built for can damage it and may be illegal.")}
              </p>
              <p className="text-cool-gray text-sm">
                {tr("While this is on, NeonPlug stops checking channels against the radio's bands: the channel editor shows no band errors, and a write keeps every channel below 1000 MHz as it is. It stays on until you turn it off here.")}
              </p>
              <button
                type="button"
                onClick={() =>
                  allowOutOfBandFrequencies ? setAllowOutOfBandFrequencies(false) : setOutOfBandConfirmOpen(true)
                }
                className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                  allowOutOfBandFrequencies
                    ? 'bg-red-900/40 text-red-300 border border-red-500 hover:bg-red-900/60'
                    : 'bg-red-900/20 text-red-400 border border-red-600/40 hover:bg-red-900/30'
                }`}
              >
                {allowOutOfBandFrequencies ? tr("⚠ Out-of-band frequencies ON: turn off") : tr("Turn on out-of-band frequencies")}
              </button>
            </div>
          </div>
        )}

        {/* 日本語名。日本語化したフォントを焼いた DM-32 向け。shown whenever the radio supports it
            or the switch is on, so it can always be turned off. */}
        {(caps?.supportsJapaneseNames || japaneseNames) && (
          <div className="bg-deep-gray rounded-lg border-2 border-yellow-500 p-6">
            <h3 className="text-2xl font-bold text-yellow-400 mb-3">日本語名（Japanese names）</h3>
            <div className="space-y-3">
              <p className="text-base font-semibold text-yellow-300">
                日本語化したフォント（master_1990_v2）を焼いた無線機専用です。純正のフォントのままでは、
                GB2312 に無い字（ー 東 関 塚 など）が別の中国漢字で表示されます。
              </p>
              <p className="text-cool-gray text-sm">
                ON のあいだ、チャンネル・ゾーン・スキャンリスト・連絡先・トークグループ・RX グループ・無線機 ID・
                緊急システム・暗号鍵の名前を GB2312 と供出区点で読み書きします。長さは文字数ではなくバイト数で数えます
                （英数字 1、漢字・かな 2）。切り替えたら、無線機から読み直してください。
                読み込み済みの名前は、読んだときの設定で解釈されています。
              </p>
              <button
                type="button"
                onClick={() => (japaneseNames ? setJapaneseNames(false) : setJapaneseNamesConfirmOpen(true))}
                className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                  japaneseNames
                    ? 'bg-yellow-900/40 text-yellow-300 border border-yellow-500 hover:bg-yellow-900/60'
                    : 'bg-yellow-900/20 text-yellow-400 border border-yellow-600/40 hover:bg-yellow-900/30'
                }`}
              >
                {japaneseNames ? '日本語名 ON：OFF にする' : '日本語名を ON にする'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    <ConfirmModal
      isOpen={offlineFallbackOpen}
      onClose={() => setOfflineFallbackOpen(false)}
      onConfirm={() => window.open(OFFLINE_RELEASE_URL, '_blank')}
      title={tr("Download offline version")}
      message={offlineFallbackMessage()}
      confirmLabel={tr("Download")}
      cancelLabel={tr("Close")}
      variant="default"
    />
    <ConfirmModal
      isOpen={outOfBandConfirmOpen}
      onClose={() => setOutOfBandConfirmOpen(false)}
      onConfirm={() => setAllowOutOfBandFrequencies(true)}
      title={tr("Turn on out-of-band frequencies?")}
      message={
        tr('Only do this for a radio with modified firmware.') + '\n\n' +
        tr("NeonPlug will stop checking channels against the radio's bands, and will write them as they are.") + ' ' +
        tr('On a stock radio that can make the write fail or leave the radio misbehaving, and transmitting outside its bands can damage it and may be illegal.') + '\n\n' +
        tr('It stays on until you turn it off in About.')
      }
      confirmLabel={tr("Turn on")}
      variant="danger"
    />
    <ConfirmModal
      isOpen={japaneseNamesConfirmOpen}
      onClose={() => setJapaneseNamesConfirmOpen(false)}
      onConfirm={() => setJapaneseNames(true)}
      title="日本語名を ON にしますか？"
      message={
        '日本語化したフォント（master_1990_v2）を焼いた無線機専用です。\n\n' +
        '純正のフォントのままだと、GB2312 に無い字が別の中国漢字で表示されます。\n\n' +
        'ON にしたら、無線機から読み直してください。About で OFF にするまで ON のままです。'
      }
      confirmLabel="ON にする"
      variant="default"
    />
    </>
  );
};

