import React, { useState } from 'react';
import { useRadioStore } from '../../store/radioStore';
import { useRadioCapabilities } from '../../hooks/useRadioCapabilities';
import { Modal } from '../ui/Modal';
import { BUTTON } from '../ui/controlStyles';
import { FORK_VERSION, FORK_AUTHOR } from '../../utils/forkVersion';
import { UiLanguageSwitch } from './UiLanguageSwitch';  // NeonPlugJA: 日本語表示

import { tr } from '../../utils/tr';  // NeonPlugJA: 日本語表示
const USER_GESTURE_MESSAGE = 'Unable to read from radio, please read from a radio or load a codeplug to continue';

export const StatusBar: React.FC = () => {
  const { radioInfo, connectionError, setConnectionError } = useRadioStore();
  const { caps } = useRadioCapabilities();
  const [showFirmwareWarning, setShowFirmwareWarning] = useState(false);
  const showUserGestureInBar = connectionError?.includes('Please click the button directly') ?? false;
  const hasRealFirmware = !!(radioInfo?.firmware && radioInfo.firmware !== '-' && radioInfo.firmware.trim() !== '');
  const isNewerFirmware = !!(hasRealFirmware && caps?.isFirmware049OrNewer?.(radioInfo!.firmware));
  // Only warn when the radio declares a known-good firmware. No declaration
  // means no opinion — not 'wrong firmware'.
  const expectedFirmware = caps?.expectedFirmware;
  const needsFirmwareUpdate = !!expectedFirmware && hasRealFirmware &&
    radioInfo!.firmware !== expectedFirmware && !isNewerFirmware;
  const deviceValue = (v: string | undefined) => (v && v.trim() && v !== '-' ? v : '-');

  return (
    <>
      <div className="bg-deep-gray border-b border-neon-cyan px-6 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center space-x-4 min-w-0 flex-shrink-0">
          {radioInfo ? (
            <>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-cool-gray">{tr("Radio:")}</span>
                <span className="text-sm text-white font-medium">{radioInfo.model}</span>
              </div>
              <span className="text-cool-gray">|</span>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-cool-gray">{radioInfo.firmwareLabel ?? tr("Firmware:")}</span>
                <span className="text-sm text-white">{deviceValue(radioInfo.firmware)}</span>
                {(needsFirmwareUpdate || isNewerFirmware) && (
                  <button
                    onClick={() => setShowFirmwareWarning(true)}
                    className={`${BUTTON.cautionLink} cursor-pointer`}
                    title={isNewerFirmware ? tr("Firmware version not recommended") : tr("Firmware update recommended")}
                  >
                    ⚠️
                  </button>
                )}
              </div>
              <span className="text-cool-gray">|</span>
              <div className="flex items-center space-x-2">
                <span className="text-sm text-cool-gray">{tr("Build:")}</span>
                <span className="text-sm text-white">{deviceValue(radioInfo.buildDate)}</span>
              </div>
            {radioInfo.dspVersion && (
              <>
                <span className="text-cool-gray">|</span>
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-cool-gray">DSP:</span>
                  <span className="text-sm text-white">{radioInfo.dspVersion}</span>
                </div>
              </>
            )}
          </>
        ) : (
          <span className="text-sm text-cool-gray">{tr("No radio data loaded")}</span>
        )}
        </div>
        {showUserGestureInBar && (
          <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
            <span className="text-sm text-amber-400">{tr(USER_GESTURE_MESSAGE)}</span>
            <button
              type="button"
              onClick={() => setConnectionError(null)}
              className={`${BUTTON.ghost} flex-shrink-0`}
              title={tr("Dismiss")}
              aria-label={tr("Dismiss")}
            >
              ×
            </button>
          </div>
        )}
        <div className="flex items-center gap-3 flex-shrink-0">
        <UiLanguageSwitch />
        {/* NeonPlugJA: Web プログラム作成基準 — 右上に Ver とコールサインを常に出す */}
        <div className="text-sm text-cool-gray flex-shrink-0 whitespace-nowrap">
          NEONPLUG
          <span className="ml-3 text-white">Ver {FORK_VERSION}</span>
          <span className="ml-2 text-white">{FORK_AUTHOR}</span>
        </div>
        </div>
      </div>
    <Modal
      isOpen={showFirmwareWarning}
      onClose={() => setShowFirmwareWarning(false)}
      title={isNewerFirmware ? tr("Firmware Version Not Recommended") : tr("Firmware Update Recommended")}
    >
      <div className="space-y-4">
        <div className="flex items-start space-x-3">
          <span className="text-yellow-400 text-2xl">⚠️</span>
          <div className="flex-1">
            {isNewerFirmware ? (
              <>
                <p className="text-white mb-2">
                  {tr("Your radio firmware version is")} <span className="font-mono text-neon-cyan">{radioInfo?.firmware}</span>{tr(", which is not recommended and has not been tested with this software.")}
                </p>
                <p className="text-cool-gray">
                  {tr("This firmware version (049 or newer) may have compatibility issues or untested behavior. Use at your own risk.")}
                </p>
              </>
            ) : (
              <>
                <p className="text-white mb-2">
                  {tr("Your radio firmware version is")} <span className="font-mono text-neon-cyan">{radioInfo?.firmware}</span>{tr(", but the recommended version is")} <span className="font-mono text-neon-cyan">{expectedFirmware}</span>.
                </p>
                <p className="text-cool-gray">
                  {tr("We recommend updating your firmware to ensure compatibility with all features and bug fixes. Please check the official Baofeng website or your radio's documentation for firmware update instructions.")}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
    </>
  );
};

