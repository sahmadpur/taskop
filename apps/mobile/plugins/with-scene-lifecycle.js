const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

/**
 * iOS 27 stops at launch (EXC_BREAKPOINT in `_UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`) unless the
 * app adopts the UIScene life cycle. Expo 57 ships the scene delegate (`ExpoAppSceneDelegate`, objc `EXExpoAppSceneDelegate`)
 * and the `ExpoReactNativeFactoryProvider` protocol, but its prebuild template does not wire them in yet. This plugin does:
 * Info.plist names the scene delegate, and the AppDelegate hands its React Native factory to it instead of creating the
 * window and starting React Native itself. Both steps are idempotent, so `expo prebuild` can run on an existing ios/.
 * Drop this plugin once the template does it.
 */

const CONFIGURATION_NAME = 'Default Configuration';
const SCENE_DELEGATE_CLASS = 'EXExpoAppSceneDelegate';
const PROVIDER = 'ExpoReactNativeFactoryProvider';

/** Returns the Info.plist with a single-scene manifest whose default configuration uses Expo's scene delegate. */
function withSceneManifest(infoPlist) {
  const manifest = infoPlist.UIApplicationSceneManifest ?? {};
  const configurations = manifest.UISceneConfigurations ?? {};
  const others = (configurations.UIWindowSceneSessionRoleApplication ?? []).filter(
    (c) => c.UISceneConfigurationName !== CONFIGURATION_NAME,
  );
  return {
    ...infoPlist,
    UIApplicationSceneManifest: {
      ...manifest,
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        ...configurations,
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: CONFIGURATION_NAME, UISceneDelegateClassName: SCENE_DELEGATE_CLASS },
          ...others,
        ],
      },
    },
  };
}

// The template's `window = UIWindow(...)` + `factory.startReactNative(...)` block, with or without its `#if os(iOS) || os(tvOS)`.
const START_IN_APP_DELEGATE =
  /^[ \t]*(?:#if os\(iOS\) \|\| os\(tvOS\)\n[ \t]*)?window = UIWindow\(.*\)\n[ \t]*factory\.startReactNative\([\s\S]*?\)\n(?:[ \t]*#endif\n)?/m;
const CLASS_DECLARATION = /class AppDelegate:\s*ExpoAppDelegate([^{]*)\{/;

/** Returns the Swift AppDelegate conforming to ExpoReactNativeFactoryProvider and no longer starting React Native itself. */
function adoptSceneLifecycle(appDelegate) {
  let contents = appDelegate.replace(CLASS_DECLARATION, (declaration, rest) =>
    rest.includes(PROVIDER) ? declaration : `class AppDelegate: ExpoAppDelegate, ${PROVIDER}${rest.trimEnd()} {`,
  );
  contents = contents.replace(
    START_IN_APP_DELEGATE,
    '    // iOS 27: ExpoAppSceneDelegate creates the window and starts React Native into it (plugins/with-scene-lifecycle.js).\n',
  );
  // A template change this plugin does not recognise would otherwise crash at launch, so fail the prebuild instead.
  if (!CLASS_DECLARATION.exec(contents)?.[1].includes(PROVIDER) || contents.includes('startReactNative(')) {
    throw new Error(
      'with-scene-lifecycle: the generated AppDelegate.swift has an unexpected shape; update apps/mobile/plugins/with-scene-lifecycle.js.',
    );
  }
  return contents;
}

const withSceneLifecycle = (config) => {
  config = withInfoPlist(config, (c) => {
    c.modResults = withSceneManifest(c.modResults);
    return c;
  });
  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') {
      throw new Error(`with-scene-lifecycle: expected a Swift AppDelegate, got ${c.modResults.language}.`);
    }
    c.modResults.contents = adoptSceneLifecycle(c.modResults.contents);
    return c;
  });
};

module.exports = withSceneLifecycle;
module.exports.withSceneManifest = withSceneManifest;
module.exports.adoptSceneLifecycle = adoptSceneLifecycle;
