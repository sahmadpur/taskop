import type { DeviceInfo } from '@taskop/contracts';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

export function deviceInfo(): DeviceInfo {
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    osVersion: String(Platform.Version).slice(0, 50),
    appVersion: (Constants.expoConfig?.version ?? '0.0.0').slice(0, 50),
  };
}
