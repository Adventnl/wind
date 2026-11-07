import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'chat.wind.app',
  appName: 'Wind',
  webDir: 'dist',
  backgroundColor: '#16191d',
  ios: { contentInset: 'automatic', preferredContentMode: 'mobile' },
  android: { backgroundColor: '#16191d', allowMixedContent: false },
};
export default config;
