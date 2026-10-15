import appJson from '../app.json';
import pkg from '../package.json';
import eas from '../eas.json';
import { googleServicesFile, withGoogleServices } from '../app.config';
import { adoptSceneLifecycle, withSceneManifest } from '../plugins/with-scene-lifecycle';

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

  it('adds the notifications plugin once, with the default Android channel and the monochrome icon', () => {
    expect(plugins.filter((p) => (Array.isArray(p) ? p[0] : p) === 'expo-notifications')).toHaveLength(1);
    expect(options('expo-notifications')).toEqual({ icon: './assets/android-icon-monochrome.png', color: '#005E8C', defaultChannel: 'default' });
    for (const m of ['expo-notifications', 'expo-device']) expect(Object.keys(pkg.dependencies)).toContain(m);
  });

  it('builds development, preview and production with EAS, the latter two against admin.taskop.app', () => {
    expect(Object.keys(eas.build)).toEqual(['development', 'preview', 'production']);
    expect(eas.build.preview.env.EXPO_PUBLIC_API_URL).toBe('https://admin.taskop.app');
    expect(eas.build.production.env.EXPO_PUBLIC_API_URL).toBe('https://admin.taskop.app');
    expect(eas.build.production.autoIncrement).toBe(true);
    // The development build loads JS from Metro on the Mac, with the local API from apps/mobile/.env.
    expect('env' in eas.build.development).toBe(false);
    expect(eas.cli.appVersionSource).toBe('remote');
  });

  it("gives Android Firebase's file from EAS or from the app folder, and still builds without one", () => {
    expect(googleServicesFile({ GOOGLE_SERVICES_JSON: '/eas/files/google-services.json' }, () => false)).toBe('/eas/files/google-services.json');
    expect(googleServicesFile({}, () => true)).toBe('./google-services.json');
    expect(googleServicesFile({}, () => false)).toBeUndefined();
    const base = { name: 'Taskop', slug: 'taskop', android: { package: 'az.taskop.app' } };
    expect(withGoogleServices(base, './google-services.json').android).toEqual({ package: 'az.taskop.app', googleServicesFile: './google-services.json' });
    expect(withGoogleServices(base, undefined).android).toEqual({ package: 'az.taskop.app' });
    expect(withGoogleServices(base, undefined).name).toBe('Taskop');
  });
});

// The part of expo-template-bare-minimum@57.0.32's AppDelegate.swift that the scene plugin rewrites.
const templateAppDelegate = `@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}
`;

describe('iOS scene life cycle (required by iOS 27)', () => {
  it('registers the plugin', () => {
    expect(plugins).toContain('./plugins/with-scene-lifecycle.js');
  });

  it("names Expo's scene delegate in a single-scene manifest, keeping other Info.plist keys", () => {
    const plist = withSceneManifest({ CFBundleName: 'Taskop' });
    expect(plist.CFBundleName).toBe('Taskop');
    expect(plist.UIApplicationSceneManifest).toEqual({
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    });
    expect(withSceneManifest(plist)).toEqual(plist);
  });

  it('lets the scene delegate create the window and start React Native', () => {
    const swift = adoptSceneLifecycle(templateAppDelegate);
    expect(swift).toContain('class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {');
    expect(swift).not.toContain('UIWindow(frame:');
    expect(swift).not.toContain('startReactNative');
    expect(swift).not.toContain('#if os(iOS)');
    expect(swift).toContain('    reactNativeFactory = factory\n');
    expect(swift).toContain('    return super.application(application, didFinishLaunchingWithOptions: launchOptions)');
    expect(adoptSceneLifecycle(swift)).toBe(swift);
  });

  it('fails the prebuild on an AppDelegate it does not recognise', () => {
    expect(() => adoptSceneLifecycle('class AppDelegate: RCTAppDelegate {}')).toThrow(/unexpected shape/);
    const startsElsewhere = templateAppDelegate.replace('#if os(iOS) || os(tvOS)\n    window = UIWindow(frame: UIScreen.main.bounds)\n', '');
    expect(() => adoptSceneLifecycle(startsElsewhere)).toThrow(/unexpected shape/);
  });
});
