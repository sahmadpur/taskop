import appJson from '../app.json';
import pkg from '../package.json';

type Plugin = string | [string, Record<string, unknown>];
const plugins = appJson.expo.plugins as Plugin[];
const options = (name: string) => plugins.find((p): p is [string, Record<string, unknown>] => Array.isArray(p) && p[0] === name)?.[1];

describe('native configuration', () => {
  it('encrypts the local database with SQLCipher', () => {
    expect(options('expo-sqlite')).toEqual({ useSQLCipher: true });
  });

  it('asks for camera, microphone and photo access in Azerbaijani', () => {
    expect(options('expo-camera')).toMatchObject({
      recordAudioAndroid: true,
      cameraPermission: expect.stringContaining('kamera'),
      microphonePermission: expect.stringContaining('mikrofon'),
    });
    expect(options('expo-image-picker')).toMatchObject({ photosPermission: expect.stringContaining('qalereya') });
    expect(plugins).toContain('expo-video');
  });

  it('depends on every Expo module the offline layer uses and builds development builds', () => {
    const deps = Object.keys(pkg.dependencies);
    for (const m of ['expo-sqlite', 'expo-camera', 'expo-image-picker', 'expo-image-manipulator', 'expo-file-system', 'expo-network', 'expo-video', 'expo-crypto']) {
      expect(deps).toContain(m);
    }
    expect(pkg.scripts.ios).toBe('expo run:ios');
    expect(pkg.scripts.android).toBe('expo run:android');
  });
});
