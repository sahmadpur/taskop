// Jest setup: native modules that jest-expo does not mock on its own.
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-localization', () => ({ getLocales: () => [{ languageTag: 'az-AZ', languageCode: 'az' }] }));
