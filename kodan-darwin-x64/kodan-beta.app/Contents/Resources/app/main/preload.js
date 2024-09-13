const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  openExternalLink: (url) => ipcRenderer.invoke('open-external-link', url),
  closeWindow: () => ipcRenderer.send('close-window'),
  getProjectData: (folderPath) => ipcRenderer.invoke('get-project-data', folderPath),
  startDownload: (modelId, modelName, modelType) => 
    ipcRenderer.invoke('startDownload', modelId, modelName, modelType),
  getDownloadProgress: (downloadId) => 
    ipcRenderer.invoke('getDownloadProgress', downloadId),
  downloadModel: (url, modelName, modelType, progressCallback) => {
    return new Promise((resolve, reject) => {
      ipcRenderer.invoke('downloadModel', url, modelName, modelType)
        .then(resolve)
        .catch(reject);

      ipcRenderer.on('downloadProgress', (event, progress) => {
        progressCallback(progress);
      });
    });
  },
  on: (channel, func) => {
    ipcRenderer.on(channel, (event, ...args) => func(...args));
  },
  off: (channel, func) => {
    ipcRenderer.removeListener(channel, (event, ...args) => func(...args));
  },
  ipcRenderer: {
    send: (channel, ...args) => ipcRenderer.send(channel, ...args),
    on: (channel, func) => {
      const subscription = (_event, ...args) => func(...args);
      ipcRenderer.on(channel, subscription);
      return () => ipcRenderer.removeListener(channel, subscription);
    },
    once: (channel, func) => {
      ipcRenderer.once(channel, (event, ...args) => func(...args));
    },
    removeListener: (channel, func) => {
      ipcRenderer.removeListener(channel, func);
    },
    removeAllListeners: (channel) => {
      ipcRenderer.removeAllListeners(channel);
    },
    invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  },
  send: (channel, data) => {
    ipcRenderer.send(channel, data);
  },
  receive: (channel, func) => {
    ipcRenderer.on(channel, (event, ...args) => func(...args));
  },
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  createProject: (projectDetails) => ipcRenderer.invoke('createProject', projectDetails),
  checkModelExists: (modelName, modelType) => ipcRenderer.invoke('checkModelExists', modelName, modelType),
  downloadModel: (url, modelName, modelType, progressCallback) => 
    ipcRenderer.invoke('downloadModel', url, modelName, modelType, progressCallback),
  deleteModel: (modelName, modelType) => ipcRenderer.invoke('deleteModel', modelName, modelType),
});

// Add this to listen for download progress
ipcRenderer.on('download-progress', (event, progress) => {
  window.dispatchEvent(new CustomEvent('download-progress', { detail: { progress } }));
});

ipcRenderer.on('download-complete', (event, downloadId) => {
  window.dispatchEvent(new CustomEvent('download-complete', { detail: { downloadId } }));
});

ipcRenderer.on('download-error', (event, downloadId, error) => {
  window.dispatchEvent(new CustomEvent('download-error', { detail: { downloadId, error } }));
});
