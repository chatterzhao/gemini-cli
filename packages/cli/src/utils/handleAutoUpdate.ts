/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { UpdateObject } from '../ui/utils/updateCheck.js';
import { LoadedSettings } from '../config/settings.js';
import { getInstallationInfo } from './installationInfo.js';
import { updateEventEmitter } from './updateEventEmitter.js';
import { HistoryItem, MessageType } from '../ui/types.js';
import { spawnWrapper } from './spawnWrapper.js';
import { spawn } from 'child_process';

export function handleAutoUpdate(
  info: UpdateObject | null,
  settings: LoadedSettings,
  projectRoot: string,
  spawnFn: typeof spawn = spawnWrapper,
) {
  if (!info) {
    return;
  }

  if (settings.merged.disableUpdateNag) {
    return;
  }

  // 检查是否禁用了自动更新（包括环境变量和设置）
  const isAutoUpdateDisabled = 
    (settings.merged.disableAutoUpdate ?? true) || 
    process.env['GEMINI_CLI_DISABLE_AUTOUPDATER'] === 'true';

  const installationInfo = getInstallationInfo(
    projectRoot,
    isAutoUpdateDisabled,
  );

  let combinedMessage = info.message;
  if (installationInfo.updateMessage) {
    combinedMessage += `\n${installationInfo.updateMessage}`;
  }

  updateEventEmitter.emit('update-received', {
    message: combinedMessage,
  });

  // 如果禁用了自动更新或没有更新命令，则不执行自动更新
  if (!installationInfo.updateCommand || isAutoUpdateDisabled) {
    return;
  }
  
  const isNightly = info.update.latest.includes('nightly');

  const updateCommand = installationInfo.updateCommand.replace(
    '@latest',
    isNightly ? '@nightly' : `@${info.update.latest}`,
  );
  const updateProcess = spawnFn(updateCommand, { stdio: 'pipe', shell: true });
  let errorOutput = '';
  updateProcess.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });

  updateProcess.on('close', (code) => {
    if (code === 0) {
      updateEventEmitter.emit('update-success', {
        message:
          'Update successful! The new version will be used on your next run.',
      });
    } else {
      updateEventEmitter.emit('update-failed', {
        message: `Automatic update failed. Please try updating manually. (command: ${updateCommand}, stderr: ${errorOutput.trim()})`,
      });
    }
  });

  updateProcess.on('error', (err) => {
    updateEventEmitter.emit('update-failed', {
      message: `Automatic update failed. Please try updating manually. (error: ${err.message})`,
    });
  });
  return updateProcess;
}

export function setUpdateHandler(
  addItem: (item: Omit<HistoryItem, 'id'>, timestamp: number) => void,
  setUpdateInfo: (info: UpdateObject | null) => void,
) {
  let successfullyInstalled = false;
  const handleUpdateRecieved = (info: UpdateObject) => {
    setUpdateInfo(info);
    const savedMessage = info.message;
    setTimeout(() => {
      if (!successfullyInstalled) {
        addItem(
          {
            type: MessageType.INFO,
            text: savedMessage,
          },
          Date.now(),
        );
      }
      setUpdateInfo(null);
    }, 60000);
  };

  const handleUpdateFailed = () => {
    setUpdateInfo(null);
    addItem(
      {
        type: MessageType.ERROR,
        text: `Automatic update failed. Please try updating manually`,
      },
      Date.now(),
    );
  };

  const handleUpdateSuccess = () => {
    successfullyInstalled = true;
    setUpdateInfo(null);
    addItem(
      {
        type: MessageType.INFO,
        text: `Update successful! The new version will be used on your next run.`,
      },
      Date.now(),
    );
  };

  const handleUpdateInfo = (data: { message: string }) => {
    addItem(
      {
        type: MessageType.INFO,
        text: data.message,
      },
      Date.now(),
    );
  };

  updateEventEmitter.on('update-received', handleUpdateRecieved);
  updateEventEmitter.on('update-failed', handleUpdateFailed);
  updateEventEmitter.on('update-success', handleUpdateSuccess);
  updateEventEmitter.on('update-info', handleUpdateInfo);

  return () => {
    updateEventEmitter.off('update-received', handleUpdateRecieved);
    updateEventEmitter.off('update-failed', handleUpdateFailed);
    updateEventEmitter.off('update-success', handleUpdateSuccess);
    updateEventEmitter.off('update-info', handleUpdateInfo);
  };
}
