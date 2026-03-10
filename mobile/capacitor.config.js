import { CapacitorConfig } from '@capacitor/cli';

const config = {
  appId: 'com.scriptures.inview.mobile',
  appName: 'Scriptures in View',
  webDir: 'dist',
  server: {
    // In dev, load from Vite dev server for HMR
    // Remove or comment out for production builds
    // url: 'http://10.0.2.2:5173',
    // cleartext: true,
  },
  plugins: {},
};

export default config;
