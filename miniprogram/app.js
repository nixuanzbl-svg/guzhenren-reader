const storage = require('./utils/storage');

App({
  onLaunch() {
    storage.ensureDefaultSettings();
  },

  globalData: {
    appName: '墨卷'
  }
});
