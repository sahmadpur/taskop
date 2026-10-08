const { getDefaultConfig } = require('expo/metro-config');

// Expo's default config detects the pnpm workspace and watches packages/*.
module.exports = getDefaultConfig(__dirname);
