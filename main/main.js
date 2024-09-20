const { app, shell, BrowserWindow, nativeImage, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { exec, spawn, execSync } = require('child_process');
const fontkit = require('fontkit');
const glob = require('glob');
const ffmpeg = require('fluent-ffmpeg');
const zlib = require('zlib');
const https = require('https');
const http = require('http');
const fetch = require('node-fetch');
const os = require('os');
const extract = require('extract-zip');
const stream = require('stream');
const util = require('util');
const finished = util.promisify(stream.finished);



let rootFolder;
let dependenciesFolder;

function getResourcePath(filename) {
  return app.isPackaged
    ? path.join(process.resourcesPath, filename)
    : path.join(__dirname, '..', filename);
}

// Update these paths
function updatePaths() {
  dependenciesFolder = path.join(rootFolder, 'dependencies');
  const pythonFolder = path.join(dependenciesFolder, 'python');
  const ffmpegFolder = path.join(dependenciesFolder, 'ffmpeg');
  const venvPath = path.join(dependenciesFolder, 'venv');
  const runModelPath = getResourcePath('run_model.py');
  const voicePath = getResourcePath('voice.py');
  const generateCaptionPath = getResourcePath('generate_caption.py');
  const renderClipPath = getResourcePath('renderClip.py');
  const renderProjectPath = getResourcePath('renderProject.py');


  // Update PATH to include FFmpeg
  process.env.PATH = `${ffmpegFolder}${path.delimiter}${process.env.PATH}`;

  
  return { venvPath, runModelPath, voicePath, generateCaptionPath, renderClipPath, renderProjectPath };
}

let manageWindow;

let mainWindow;
let modalWindow;

let generatingVoicelines = new Set();

function createManageWindow(type) {
  if (manageWindow) {
    manageWindow.focus();
    return;
  }

  manageWindow = new BrowserWindow({
    width: 900,
    height: 530,
    parent: modalWindow,
    modal: false,
    show: false,
    frame: false, 
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  manageWindow.loadFile(path.join(__dirname, '../public/manage.html'));

  manageWindow.webContents.on('did-finish-load', () => {
    manageWindow.webContents.send('set-manage-type', type, rootFolder);
    manageWindow.show();
  });

  manageWindow.on('closed', () => {
    manageWindow = null;
  });
}

ipcMain.on('open-manage-window', (event, type) => {
  createManageWindow(type);
});

const player = require('node-wav-player');

function playFlute() {
  console.log("FLUTE");
  const flutePath = path.join(__dirname, '../flute.mp3');
  if (fs.existsSync(flutePath)) {
    player.play({
      path: flutePath,
    }).catch(e => console.error('Error playing flute sound:', e));
  } else {
    console.log(flutePath);
    console.warn('Flute sound file not found');
  }
}

function createGreyPNG(width, height, filePath) {
  return new Promise((resolve, reject) => {
    // PNG signature
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

    // IHDR chunk
    const IHDR = Buffer.alloc(25);
    IHDR.writeUInt32BE(13, 0); // Length of chunk data
    IHDR.write('IHDR', 4);
    IHDR.writeUInt32BE(width, 8);
    IHDR.writeUInt32BE(height, 12);
    IHDR.writeUInt8(8, 16); // Bit depth
    IHDR.writeUInt8(6, 17); // Color type (6 = truecolor with alpha)
    IHDR.writeUInt8(0, 18); // Compression method
    IHDR.writeUInt8(0, 19); // Filter method
    IHDR.writeUInt8(0, 20); // Interlace method
    const crcIHDR = calculateCRC(IHDR.slice(4, 21));
    IHDR.writeUInt32BE(crcIHDR, 21);

    // IDAT chunk (image data)
    const dataLength = width * height * 4 + height;
    const data = Buffer.alloc(dataLength);
    let pos = 0;
    for (let y = 0; y < height; y++) {
      data[pos++] = 0; // No filter
      for (let x = 0; x < width; x++) {
        data.writeUInt32BE(0xF2F2F2FF, pos);
        pos += 4;
      }
    }
    const compressedData = zlib.deflateSync(data);
    const IDAT = Buffer.alloc(compressedData.length + 12);
    IDAT.writeUInt32BE(compressedData.length, 0);
    IDAT.write('IDAT', 4);
    compressedData.copy(IDAT, 8);
    const crcIDAT = calculateCRC(IDAT.slice(4, IDAT.length - 4));
    IDAT.writeUInt32BE(crcIDAT, IDAT.length - 4);

    // IEND chunk
    const IEND = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);

    // Write the PNG file
    const writeStream = fs.createWriteStream(filePath);
    writeStream.write(signature);
    writeStream.write(IHDR);
    writeStream.write(IDAT);
    writeStream.write(IEND);
    writeStream.end();

    writeStream.on('finish', resolve);
    writeStream.on('error', reject);
  });
}

function calculateCRC(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return c ^ 0xffffffff;
}

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[i] = c;
}

ipcMain.handle('checkModelExists', async (event, modelName, modelType) => {
  const modelsDir = path.join(rootFolder, 'Models');
  const modelDir = modelType === 'base-model' ? 'Base-Models' : 'LoRA';
  
  // Clean up the filename: replace spaces with underscores and remove illegal characters
  let safeModelName = modelName
    .replace(/\s+/g, '_')  // Replace spaces with underscores
    .replace(/[<>:"\/\\|?*]+/g, '')  // Remove illegal characters
    .replace(/^\.+/, '')  // Remove leading periods
    .trim();

  // Ensure the filename ends with .safetensors
  if (!safeModelName.toLowerCase().endsWith('.safetensors')) {
    safeModelName += '.safetensors';
  }

  const modelPath = path.join(modelsDir, modelDir, safeModelName);
  
  try {
    await fs.promises.access(modelPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
});

const downloads = new Map();

ipcMain.handle('startDownload', async (event, modelURL, modelName, modelType) => {
  try {
    const modelsDir = path.join(rootFolder, 'Models');
    const modelDir = modelType == 'base-model' ? 'Base-Models' : 'LoRA';
    let modelFolder = path.join(modelsDir, modelDir);

    // Ensure the directory exists
    fs.mkdirSync(modelFolder, { recursive: true });

    const downloadId = Date.now().toString(); // Create a unique download ID
    downloads.set(downloadId, 0); // Initialize progress to 0

    let modelPath = await downloadFromCivitai(modelURL, modelFolder, downloadId, modelName);

    downloads.delete(downloadId); // Remove the download from the map when complete

    return { success: true, path: modelPath };
  } catch (error) {
    console.error('Download failed:', error);
    return { success: false, error: error.message };
  }
});

async function downloadFromCivitai(apiUrl, modelFolder, downloadId, modelName) {
  try {
    const response = await fetch(apiUrl + "?token=fb503c54644270e19f0334586fb538d9", {
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Clean up the filename: replace spaces with underscores and remove illegal characters
    let filename = modelName
      .replace(/\s+/g, '_')  // Replace spaces with underscores
      .replace(/[<>:"\/\\|?*]+/g, '')  // Remove illegal characters
      .replace(/^\.+/, '')  // Remove leading periods
      .trim();

    // Ensure the filename ends with .safetensors
    if (!filename.toLowerCase().endsWith('.safetensors')) {
      filename += '.safetensors';
    }

    const modelPath = path.join(modelFolder, filename);
    const totalBytes = parseInt(response.headers.get('content-length'), 10);
    let downloadedBytes = 0;

    const fileStream = fs.createWriteStream(modelPath);
    
    return new Promise((resolve, reject) => {
      response.body.on('data', (chunk) => {
        console.log(chunk)
        downloadedBytes += chunk.length;
        const progress = totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
        
        console.log(filename, progress)
        downloads.set(filename, progress);
        BrowserWindow.getAllWindows().forEach(window => {
          window.webContents.send('download-progress', {modelName: filename, progress: progress}, progress);
        });
      });

      response.body.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve(modelPath);
      });

      fileStream.on('error', (err) => {
        reject(err);
      });
    });
  } catch (error) {
    console.error('Error in downloadFromCivitai:', error);
    throw error;
  }
}

ipcMain.handle('getDownloadProgress', (event, downloadId) => {
    return downloads.get(downloadId) || 0;
});

async function deleteModel(modelName, modelType, rootFolder) {
  const modelsDir = path.join(rootFolder, 'Models');
  const modelDir = modelType === 'base-model' ? 'Base-Models' : 'LoRA';

  // Clean up the filename: replace spaces with underscores and remove illegal characters
  let safeModelName = modelName
    .replace(/\s+/g, '_')  // Replace spaces with underscores
    .replace(/[<>:"\/\\|?*]+/g, '')  // Remove illegal characters
    .replace(/^\.+/, '')  // Remove leading periods
    .trim();

  // Ensure the filename ends with .safetensors
  if (!safeModelName.toLowerCase().endsWith('.safetensors')) {
    safeModelName += '.safetensors';
  }

  const modelPath = path.join(modelsDir, modelDir, safeModelName);

  try {
    // Check if the file exists before attempting to delete
    await fs.promises.access(modelPath, fs.constants.F_OK);
    
    // Delete the file
    await fs.promises.unlink(modelPath);
    console.log(`Model deleted successfully: ${modelPath}`);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.error(`Model file not found: ${modelPath}`);
      // You might want to return false or throw a specific error here
      return false;
    }
    console.error(`Error deleting model: ${error}`);
    throw error;
  }
}

ipcMain.handle('deleteModel', async (event, modelName, modelType) => {
  try {
    await deleteModel(modelName, modelType, rootFolder);
    return { success: true };
  } catch (error) {
    console.error('Error in deleteModel handler:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('get-voices', (event) => {
  return new Promise((resolve, reject) => {
    const voicesPath = path.join(rootFolder, 'Voices');
    fs.readdir(voicesPath, (err, files) => {
      if (err) {
        console.error('Error reading voices directory:', err);
        resolve([]);
      } else {
        const voiceFiles = files
          .filter(file => file.endsWith('.wav'))
          .map(file => path.parse(file).name);
        resolve(voiceFiles);
      }
    });
  });
});

ipcMain.handle('add-voice', async (event) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'WAV', extensions: ['wav'] }]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const sourcePath = result.filePaths[0];
    const fileName = path.basename(sourcePath);
    const destPath = path.join(rootFolder, 'Voices', fileName);

    return new Promise((resolve) => {
      fs.copyFile(sourcePath, destPath, (err) => {
        if (err) {
          console.error('Error copying voice file:', err);
          resolve(false);
        } else {
          resolve(fileName);
        }
      });
    });
  }

  return false;
});

ipcMain.handle('get-video-duration', async (event, filePath) => {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
      } else {
        resolve(metadata.format.duration);
      }
    });
  });
});

ipcMain.handle('close-app', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) window.close();
});

ipcMain.handle('minimize-app', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) window.minimize();
});

// Handle resizing the window to fit the screen (safe areas included)
ipcMain.handle('maximize-app', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize; // Get screen dimensions excluding taskbars or docks
    window.setBounds({ x: 0, y: 0, width, height });
  }
});

// ipcMain.handle('maximize-app', () => {
//   const window = BrowserWindow.getFocusedWindow();
//   if (window) {
//     if (window.isMaximized()) {
//       window.unmaximize();
//     } else {
//       window.maximize();
//     }
//   }
// });

ipcMain.handle('render-project', async (event, projectFolder) => {
  const { renderProjectPath, venvPath } = updatePaths();

  try {
    // Open save dialog for the user to choose where to save the file and its name
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save Rendered Project',
      defaultPath: path.join(projectFolder, 'output.mp4'),  // Default name and location
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
      ]
    });

    // If the user canceled the save dialog, return early
    if (canceled || !filePath) {
      event.sender.send('render-error', 'Render canceled by user.');
      return;
    }

    // const venvPath = path.join(__dirname, '../venv'); // Path to your virtual environment

    // Command to activate the virtual environment and run renderProject.py with the selected file path
    const activateAndRun = `source ${venvPath}/bin/activate && python3 ${renderProjectPath} "${projectFolder}" "${filePath}"`;

    // Execute the script
    exec(activateAndRun, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error executing script: ${error.message}`);
        event.sender.send('render-error', error.message);
        return;
      }

      if (stderr) {
        console.error(`stderr: ${stderr}`);
        event.sender.send('render-error', stderr);
        return;
      }

      console.log(`stdout: ${stdout}`);
      event.sender.send('render-success', `Project rendered successfully at ${filePath}!`);
      
      // Open the output file in Finder/Explorer
      shell.showItemInFolder(filePath);
    });
  } catch (err) {
    console.error(`Error in render-project: ${err}`);
    event.sender.send('render-error', err.message);
  }
});

function createWindow() {
  mainWindow = new BrowserWindow({
    icon: path.join(__dirname, 'KodanFlower.icns'), // Path to your .icns file
    width: 652,
    height: 560,
    resizable: false,
    minimizable: true,
    maximizable: false,
    closable: true, // Normally, the window is closable
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
    .catch(err => {
      console.error('Failed to load index.html:', err);
    });

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorCode, errorDescription);
  });
}

function createModalWindow() {
    modalWindow = new BrowserWindow({
    parent: mainWindow,
    icon: path.join(__dirname, 'KodanFlower.icns'), // Path to your .icns file
    modal: false,
    show: false,
    width: 300,
    height: 200,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true, // The modal window itself is closable
    title: "New Project",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  modalWindow.loadFile(path.join(__dirname, '../public/modal.html'));
  
  modalWindow.once('ready-to-show', () => {
    // Disable closing the main window when the modal is ready to be shown
    mainWindow.setClosable(false);
    mainWindow.setMinimizable(false);

    modalWindow.show();
  });

  // Re-enable closing the main window when the modal is closed
  modalWindow.on('closed', () => {
    mainWindow.setClosable(true);
    mainWindow.setMinimizable(true);
    mainWindow.webContents.send('close-modal'); // Send message to hide overlay

  });

}

function ensureVoicesDirectory(projectRootPath) {
  const voicesDir = path.join(projectRootPath, 'Voices');
  if (!fs.existsSync(voicesDir)) {
    fs.mkdirSync(voicesDir, { recursive: true });
    
    // Copy default Narrator.wavf
    const defaultNarratorPath = path.join(__dirname, '..', 'Voices', 'Narrator.wav');
    const newNarratorPath = path.join(voicesDir, 'Narrator.wav');
    fs.copyFileSync(defaultNarratorPath, newNarratorPath);
  }
}

function createProjectWindow(projectFilePath) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  rootFolder = projectFilePath.split("/Projects")[0]
  
  ensureVoicesDirectory(rootFolder)
  const projectWindow = new BrowserWindow({
    width,
    height,
    icon: path.join(__dirname, 'KodanFlower.icns'), // Path to your .icns file
    resizable: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    frame: false, 
    title: "Project Viewer",
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  projectWindow.loadFile(path.join(__dirname, '../dist/project-viewer.html'), {
    query: { filePath: projectFilePath },
  });

  projectWindow.on('closed', () => {
    // Optional: Handle any cleanup or state management here
  });
}

ipcMain.handle('delete-scene', async (event, projectFilePath, sceneIndex) => {
  try {
    console.log(`delete-scene triggered for sceneIndex: ${sceneIndex}, projectFilePath: ${projectFilePath}`);

    // Show a confirmation dialog
    const response = await dialog.showMessageBox({
      type: 'warning',
      buttons: ['Cancel', 'Delete'],
      defaultId: 0,
      title: 'Confirm Deletion',
      message: 'Are you sure you want to delete this scene?',
      detail: 'This action cannot be undone.',
    });

    console.log(`Dialog response: ${response.response === 0 ? 'Canceled' : 'Confirmed'}`);

    // If the user cancels, return null to indicate cancellation
    if (response.response === 0) {
      return null;
    }

    const projectDir = path.dirname(projectFilePath);
    console.log(`Project directory: ${projectDir}`);

    const projectData = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
    console.log(`Loaded project data: ${JSON.stringify(projectData.scenes)}`);

    // Get the scene to be deleted
    const sceneToDelete = projectData.scenes[sceneIndex - 1];
    const sceneFilePath = sceneToDelete.thumbnail;
    console.log(`Scene to delete: ${sceneToDelete}, thumbnail path: ${sceneFilePath}`);

    // Delete the .png file and its corresponding _raw.png file
    if (fs.existsSync(sceneFilePath)) {
      fs.unlinkSync(sceneFilePath);
      console.log(`Deleted thumbnail file: ${sceneFilePath}`);
      
      const rawFilePath = sceneFilePath.replace('.png', '_raw.png');
      if (fs.existsSync(rawFilePath)) {
        fs.unlinkSync(rawFilePath);
        console.log(`Deleted raw thumbnail file: ${rawFilePath}`);
      }
      
      shell.beep();
    } else {
      console.log(`Thumbnail file not found: ${sceneFilePath}`);
    }

    // Define paths for Clips and Voicelines directories
    const clipsDir = path.join(projectDir, '..', 'Clips');
    const voicelinesDir = path.join(projectDir, '..', 'Voicelines');
    console.log(`Clips directory: ${clipsDir}`);
    console.log(`Voicelines directory: ${voicelinesDir}`);

    // Delete the corresponding clip and voiceline files if they exist
    const clipFilePath = path.join(clipsDir, `${sceneIndex}.mp4`);
    const voicelineFilePath = path.join(voicelinesDir, `${sceneIndex}.mp3`);

    if (fs.existsSync(clipFilePath)) {
      fs.unlinkSync(clipFilePath);
      console.log(`Deleted clip file: ${clipFilePath}`);
    } else {
      console.log(`Clip file not found: ${clipFilePath}`);
    }

    if (fs.existsSync(voicelineFilePath)) {
      fs.unlinkSync(voicelineFilePath);
      console.log(`Deleted voiceline file: ${voicelineFilePath}`);
    } else {
      console.log(`Voiceline file not found: ${voicelineFilePath}`);
    }

    // Remove the scene from the project data
    projectData.scenes.splice(sceneIndex - 1, 1);
    console.log(`Scene removed. Updated scenes: ${JSON.stringify(projectData.scenes)}`);

    // Adjust the indices of the remaining scenes and files after the deleted scene
    for (let i = sceneIndex - 1; i < projectData.scenes.length; i++) {
      const newIndex = i + 1;
      const oldIndex = newIndex + 1;

      // Rename image files
      const oldImagePath = projectData.scenes[i].thumbnail;
      const newImagePath = oldImagePath.replace(`${oldIndex}.png`, `${newIndex}.png`);
      if (fs.existsSync(oldImagePath)) {
        fs.renameSync(oldImagePath, newImagePath);
        projectData.scenes[i].thumbnail = newImagePath;
        console.log(`Renamed thumbnail from ${oldImagePath} to ${newImagePath}`);
        
        // Rename raw image files
        const oldRawImagePath = oldImagePath.replace('.png', '_raw.png');
        const newRawImagePath = newImagePath.replace('.png', '_raw.png');
        if (fs.existsSync(oldRawImagePath)) {
          fs.renameSync(oldRawImagePath, newRawImagePath);
          console.log(`Renamed raw thumbnail from ${oldRawImagePath} to ${newRawImagePath}`);
        }
      }

      // Rename clip files
      const oldClipPath = path.join(clipsDir, `${oldIndex}.mp4`);
      const newClipPath = path.join(clipsDir, `${newIndex}.mp4`);
      if (fs.existsSync(oldClipPath)) {
        fs.renameSync(oldClipPath, newClipPath);
        console.log(`Renamed clip from ${oldClipPath} to ${newClipPath}`);
      }

      // Rename voiceline files
      const oldVoicelinePath = path.join(voicelinesDir, `${oldIndex}.mp3`);
      const newVoicelinePath = path.join(voicelinesDir, `${newIndex}.mp3`);
      if (fs.existsSync(oldVoicelinePath)) {
        fs.renameSync(oldVoicelinePath, newVoicelinePath);
        console.log(`Renamed voiceline from ${oldVoicelinePath} to ${newVoicelinePath}`);
      }
    }

    // Save the updated project data
    fs.writeFileSync(projectFilePath, JSON.stringify(projectData, null, 2), 'utf-8');
    console.log(`Project data saved to ${projectFilePath}`);

    // Return the updated project data to the renderer process
    return projectData;
  } catch (error) {
    console.error('Failed to delete scene:', error);
    throw error;
  }
});

ipcMain.handle('add-new-scene', async (event, projectFilePath, aspectRatio) => {
  try {
    // Load the project data
    const projectDir = path.dirname(projectFilePath);
    const projectData = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));

    // Determine the new scene ID and file path
    const newSceneId = projectData.scenes.length + 1;
    const newSceneFilename = `${newSceneId}.png`;
    const newSceneFilePath = path.join(projectDir, 'Images', newSceneFilename);

    // Validate and calculate the width and height
    const baseSize = 1000;
    const widthPx = aspectRatio >= 1 ? baseSize : baseSize * aspectRatio;
    const heightPx = aspectRatio >= 1 ? baseSize / aspectRatio : baseSize;

    if (isNaN(widthPx) || isNaN(heightPx) || widthPx <= 0 || heightPx <= 0) {
      throw new Error('Invalid dimensions for creating a new image.');
    }

    // // Create a new image for the scene
    // await sharp({
    //   create: {
    //     width: Math.round(widthPx),
    //     height: Math.round(heightPx),
    //     channels: 4,
    //     background: '#F2F2F2',
    //   }
    // })
    // .png()
    // .toFile(newSceneFilePath);

    // Add the new scene to the project data
    const newScene = {
      id: Math.floor(Math.random() * 1000000000),
      thumbnail: newSceneFilePath,
    };

    projectData.scenes.push(newScene);

    // Save the updated project data back to the file
    fs.writeFileSync(projectFilePath, JSON.stringify(projectData, null, 2), 'utf-8');

    return projectData;
  } catch (error) {
    console.error('Failed to add new scene:', error);
    throw error;
  }
});

// const fetch = require('node-fetch');
// const fs = require('fs-extra');
// const path = require('path');


async function downloadPython(pythonFolder, retries = 3) {
  const pythonUrl = 'https://github.com/SerenityUX/pythonZip3.9/raw/main/python.zip';

  console.log(`Starting Python download (attempt ${4 - retries}/3)...`);
  console.log(`Download URL: ${pythonUrl}`);
  console.log(`Destination folder: ${pythonFolder}`);

  try {
    await fs.ensureDir(pythonFolder);
    console.log(`Ensured that ${pythonFolder} exists.`);

    const response = await fetch(pythonUrl, { timeout: 60000 });

    if (!response.ok) {
      throw new Error(`Failed to download Python: HTTP status ${response.status}`);
    }

    const totalBytes = parseInt(response.headers.get('content-length'), 10);
    console.log(`Total download size: ${totalBytes} bytes`);

    const downloadPath = path.join(pythonFolder, 'python.zip');
    const fileStream = fs.createWriteStream(downloadPath);
    
    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    console.log('Python download completed. Extracting...');

    // Remove existing Python folder if it exists
    const extractPath = path.join(pythonFolder, 'python');
    if (await fs.pathExists(extractPath)) {
      await fs.remove(extractPath);
    }

    // Extract the zip file
    await extract(downloadPath, { 
      dir: pythonFolder,
      onEntry: (entry, zipfile) => {
        if (entry.type === 'SymbolicLink') {
          // Skip symlink creation during extraction
          entry.autodrain();
        }
      }
    });

    console.log('Python extracted successfully.');

    // Clean up the downloaded zip file
    await fs.remove(downloadPath);

    // Set the path to the Python executable
    const pythonExecutable = process.platform === 'win32'
      ? path.join(pythonFolder, 'python', 'python.exe')
      : path.join(pythonFolder, 'python', 'install', 'bin', 'python3');
    console.log(`Python executable path: ${pythonExecutable}`);

    // Verify that the Python executable exists
    if (await fs.pathExists(pythonExecutable)) {
      console.log('Python setup completed successfully.');
      return pythonExecutable;
    } else {
      throw new Error('Python executable not found after extraction.');
    }
  } catch (error) {
    console.error(`Error during download or installation: ${error.message}`);
    if (retries > 0) {
      console.log(`Operation failed. Retrying... (${retries} attempts left)`);
      await new Promise(resolve => setTimeout(resolve, 5000));
      return downloadPython(pythonFolder, retries - 1);
    } else {
      throw error;
    }
  }
}
async function setupDependencies() {
  if (!rootFolder) {
    throw new Error('rootFolder is not set. Please set it before calling setupDependencies.');
  }

  dependenciesFolder = path.join(rootFolder, 'dependencies');
  const pythonFolder = path.join(dependenciesFolder, 'python');
  const ffmpegFolder = path.join(dependenciesFolder, 'ffmpeg');
  const venvFolder = path.join(dependenciesFolder, 'venv');

  if (!fs.existsSync(dependenciesFolder)) {
    fs.mkdirSync(dependenciesFolder, { recursive: true });
  }

  // Check if FFmpeg is installed in the dependencies folder
  if (!fs.existsSync(path.join(ffmpegFolder, 'ffmpeg'))) {
    console.log('FFmpeg not found in dependencies. Installing...');
    await installFFmpeg(ffmpegFolder);
  } else {
    console.log('FFmpeg found in dependencies.');
  }

  // Check for Python in the dependencies folder
  if (!fs.existsSync(pythonFolder)) {
    console.log('Python not found in dependencies. Downloading and installing...');
    try {
      await downloadPython(dependenciesFolder);
    } catch (error) {
      console.error('Failed to download and install Python:', error.message);
      console.log('Please download Python 3.9.0 manually and place it in the following folder:');
      console.log(pythonFolder);
      throw error;
    }
  }
  pythonPath = path.join(pythonFolder, 'install/bin/python3');

  // Create virtual environment if it doesn't exist
  if (!fs.existsSync(venvFolder)) {
    console.log('Creating virtual environment...');

    try {
      await new Promise((resolve, reject) => {
        exec(`"${pythonPath}" -m venv "${venvFolder}"`, (error, stdout, stderr) => {
          if (error) {
            console.error(`Error creating virtual environment: ${error.message}`);
            reject(error);
          } else {
            console.log('Virtual environment created successfully');
            resolve();
          }
        });
      });
    } catch (error) {
      console.error('Failed to create virtual environment:', error);
      throw error;
    }
  }

  // Install required packages
  console.log('Installing required packages...');
  const venvPythonPath = process.platform === 'win32' ? 
    path.join(venvFolder, 'Scripts', 'python') : 
    path.join(venvFolder, 'bin', 'python');
  const requirementsPath = getResourcePath('requirements.txt');

  // Upgrade pip first
  const upgradePipCommand = `"${venvPythonPath}" -m pip install --upgrade pip && "${venvPythonPath}" -m pip cache purge`;
  console.log("Upgrading pip command:", upgradePipCommand);
  try {
    await new Promise((resolve, reject) => {
      exec(upgradePipCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('Error upgrading pip:', error);
          reject(error);
        } else {
          console.log('Pip upgrade stdout:', stdout);
          console.log('Pip upgrade stderr:', stderr);
          console.log('Pip upgrade completed successfully');
          resolve();
        }
      });
    });
  } catch (error) {
    console.error('Error upgrading pip:', error);
    throw error; // Rethrow the error to stop the process if pip upgrade fails
  }

  // Install packages with verbose output
  const pipInstall = `"${venvPythonPath}" -m pip install -r "${requirementsPath}" -v`;
  console.log("Installing packages command:", pipInstall);
  // Execute pip install and wait for it to complete
  return new Promise((resolve, reject) => {
    const child = exec(pipInstall);
    
    child.stdout.on('data', (data) => {
      console.log('Pip install stdout:', data);
    });
    
    child.stderr.on('data', (data) => {
      console.log('Pip install stderr:', data);
    });
    
    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`Pip install process exited with code ${code}`);
        reject(new Error(`Pip install failed with code ${code}`));
      } else {
        console.log('Pip install process completed successfully');
        resolve();
      }
    });
  });
}


async function downloadAndOpenPythonInstaller() {
  const pythonVersion = '3.9.0';
  const installerUrl = `https://www.python.org/ftp/python/${pythonVersion}/python-${pythonVersion}-macosx10.9.pkg`;
  const installerPath = path.join(app.getPath('temp'), `python-${pythonVersion}-installer.pkg`);

  console.log('Downloading Python installer...');
  const response = await fetch(installerUrl);
  const fileStream = fs.createWriteStream(installerPath);
  await new Promise((resolve, reject) => {
    response.body.pipe(fileStream);
    response.body.on('error', reject);
    fileStream.on('finish', resolve);
  });

  console.log('Opening Python installer...');
  shell.openPath(installerPath);
}



async function installFFmpeg(ffmpegFolder) {
  return new Promise(async (resolve, reject) => {
    let ffmpegUrl;
    let fileName;

    switch (process.platform) {
      case 'darwin':
        ffmpegUrl = 'https://evermeet.cx/ffmpeg/ffmpeg-5.1.2.zip';
        fileName = 'ffmpeg.zip';
        break;
      case 'win32':
        ffmpegUrl = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
        fileName = 'ffmpeg.zip';
        break;
      case 'linux':
        ffmpegUrl = 'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz';
        fileName = 'ffmpeg.tar.xz';
        break;
      default:
        reject(new Error('Unsupported operating system'));
        return;
    }

    const filePath = path.join(ffmpegFolder, fileName);

    console.log(`Downloading FFmpeg from ${ffmpegUrl}`);

    // Ensure the ffmpegFolder exists
    await fs.ensureDir(ffmpegFolder);

    // Download the file
    const file = fs.createWriteStream(filePath);
    https.get(ffmpegUrl, (response) => {
      response.pipe(file);
      file.on('finish', () => {
        file.close(async () => {
          console.log('FFmpeg download completed. Extracting...');
          
          try {
            if (process.platform === 'linux') {
              // For Linux, use tar to extract
              await exec(`tar xf "${filePath}" -C "${ffmpegFolder}"`);
            } else {
              // For Windows and macOS, use extract-zip
              await extract(filePath, { dir: ffmpegFolder });
            }

            // Clean up the downloaded file
            await fs.remove(filePath);

            // Rename the extracted file to 'ffmpeg' if it's not already named that
            const files = await fs.readdir(ffmpegFolder);
            if (files.length === 1 && files[0] !== 'ffmpeg') {
              await fs.rename(path.join(ffmpegFolder, files[0]), path.join(ffmpegFolder, 'ffmpeg'));
            }

            // Make the ffmpeg file executable (for macOS and Linux)
            if (process.platform !== 'win32') {
              await fs.chmod(path.join(ffmpegFolder, 'ffmpeg'), '755');
            }

            console.log('FFmpeg installed successfully in dependencies folder');
            resolve();
          } catch (error) {
            console.error('Error extracting FFmpeg:', error);
            reject(error);
          }
        });
      });
    }).on('error', (err) => {
      fs.unlink(filePath);
      console.error(`Error downloading FFmpeg: ${err.message}`);
      reject(err);
    });
  });
}



// async function installFFmpeg() {
//   return new Promise((resolve, reject) => {
//     let command;
//     switch (os.platform()) {
//       case 'darwin':
//         command = 'brew install ffmpeg';
//         break;
//       case 'win32':
//         command = 'winget install ffmpeg';
//         break;
//       case 'linux':
//         if (os.release().toLowerCase().includes('ubuntu') || os.release().toLowerCase().includes('debian')) {
//           command = 'sudo apt-get update && sudo apt-get install -y ffmpeg';
//         } else if (os.release().toLowerCase().includes('fedora') || os.release().toLowerCase().includes('centos')) {
//           command = 'sudo dnf install -y ffmpeg';
//         } else {
//           reject(new Error('Unsupported Linux distribution'));
//           return;
//         }
//         break;
//       default:
//         reject(new Error('Unsupported operating system'));
//         return;
//     }

//     exec(command, (error, stdout, stderr) => {
//       if (error) {
//         console.error(`Error installing FFmpeg: ${error.message}`);
//         reject(error);
//       } else {
//         console.log('FFmpeg installed successfully');
//         resolve();
//       }
//     });
//   });
// }

function launchKodan() {
  let kodanPath;
  if (app.isPackaged) {
    kodanPath = path.join(process.resourcesPath, '..', 'MacOS', 'kodan');
  } else {
    kodanPath = path.join(__dirname, 'kodan');
  }

  console.log('Launching Kodan from:', kodanPath);

  const child = spawn(kodanPath, [], {
    detached: true,
    stdio: 'inherit'
  });

  child.unref();
  app.quit();
}



app.whenReady().then(() => {
  // app.setAppUserModelId('com.serenidad.kodan'); // Optional for Windows, doesn't impact macOS

  // const image = nativeImage.createFromPath('./KodanFlower.icns');
  // app.dock.setIcon(image);  

  // if (app.isPackaged) {
  //   // Check if we're already running the internal executable
  //   if (process.argv[0].endsWith('MacOS/kodan')) {
  //     createWindow();
  //   } else {
  //     launchKodan();
  //   }
  // } else {
  //   createWindow();
  // }

  createWindow()
   app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
  app.commandLine.appendSwitch('use-angle', 'metal');  // Use Metal for rendering on Apple Silicon
  process.env.PYTORCH_ENABLE_MPS_FALLBACK = "1";
});

let lastNumber = 0


function renderClip(projectPath, sceneNumber) {
  // const venvPath = path.join(__dirname, '../venv'); // Path to your virtual environment
  const { renderClipPath, venvPath } = updatePaths();

  const activateAndRun = `source ${venvPath}/bin/activate && python3 ${renderClipPath} "${projectPath}" "${sceneNumber}"`;

  const process = exec(activateAndRun);

  let isProcessClosed = false;

  process.stdout.on('data', (data) => {
    if (!isProcessClosed) {
      console.log('stdout:', data);
      mainWindow.webContents.send('clip-progress-update', data);
    }
  });

  process.stderr.on('data', (data) => {
    if (!isProcessClosed) {
      console.warn('stderr:', data.toString());
      mainWindow.webContents.send('clip-error', data.toString());
    }
  });

  process.on('close', (code) => {
    isProcessClosed = true;
    console.log(`Process exited with code ${code}`);
    mainWindow.webContents.send('clip-render-response', {
      success: code === 0,
      message: code === 0 ? 'Clip rendering completed successfully' : `Process exited with code ${code}`,
    });
  });
}
function checkAndRenderClip(projectPath, sceneNumber) {
  const imageFilePath = path.join(projectPath, 'Images', `${sceneNumber}.png`);
  const audioFilePath = path.join(projectPath, 'Voicelines', `${sceneNumber}.mp3`);

  // If both the image and audio files exist, render the clip
  if (fs.existsSync(imageFilePath) && fs.existsSync(audioFilePath)) {
    renderClip(projectPath, sceneNumber);
  }
}


ipcMain.on('run-voice-model', (event, arg) => {
  console.log('run-voice-model event received:', arg);
  try {
    const { venvPath, runModelPath, voicePath } = updatePaths();
    console.log('Paths updated:', { venvPath, runModelPath, voicePath });

    const sceneNumber = parseInt(arg.outputLocation.split("Voicelines/")[1].split(".mp3")[0]);
    console.log('Scene number:', sceneNumber);
    generatingVoicelines.add(sceneNumber);
    console.log('Added to generatingVoicelines:', Array.from(generatingVoicelines));

    const outputLocation = arg.outputLocation;
    const prompt = arg.prompt;
    const maxLength = arg.maxLength || 250;
    const projectPath = arg.outputLocation.split("/Voicelines")[0];
    const voicesDir = path.join(rootFolder, 'Voices');
    const speakerWav = path.join(voicesDir, `${arg.speakerWav}.wav`);
    const language = arg.language || "en";
    console.log('Voice generation parameters:', { outputLocation, prompt, maxLength, projectPath, voicesDir, speakerWav, language });

    // Ensure the speaker WAV file exists, otherwise use Narrator.wav
    const defaultNarratorPath = path.join(voicesDir, 'Narrator.wav');
    const finalSpeakerWav = fs.existsSync(speakerWav) ? speakerWav : defaultNarratorPath;
    console.log('Final speaker WAV path:', finalSpeakerWav);

    const pythonPath = process.platform === 'win32' 
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python');
    console.log('Python path:', pythonPath);

    const activateAndRun = `source ${venvPath}/bin/activate && "${pythonPath}" -u "${voicePath}" "${prompt}" "${outputLocation}" ${maxLength} "${finalSpeakerWav}" "${language}"`;
    console.log('Executing command:', activateAndRun);

    const childProcess = exec(activateAndRun);
    console.log('Child process started');

    let isProcessClosed = false;

    childProcess.stdout.on('data', (data) => {
      if (!isProcessClosed) {
        data.split('\n').forEach(line => {
          const trimmedLine = line.trim();
          console.log('Child process stdout:', trimmedLine);
          event.sender.send('voice-progress-update', trimmedLine);
        });
      }
    });

    childProcess.stderr.on('data', (data) => {
      if (!isProcessClosed) {
        console.warn('Child process stderr:', data.toString());
        event.sender.send('voice-error', data.toString());
      }
    });

    childProcess.on('close', (code) => {
      console.log(`Child process closed with code: ${code}`);
      isProcessClosed = true;
      generatingVoicelines.delete(sceneNumber);
      console.log('Removed from generatingVoicelines:', Array.from(generatingVoicelines));

      if (code === 0) {
        console.log('Voice generation successful, updating project file');
        // Update project.kodan with the voice line path
        const projectFilePath = path.join(projectPath, 'project.kodan');
        console.log('Project file path:', projectFilePath);

        let projectData;
        try {
          projectData = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
          console.log('Project data loaded successfully');
        } catch (err) {
          console.error('Error reading project file:', err);
          throw err;
        }

        projectData.scenes[sceneNumber - 1].voiceLinePath = outputLocation;
        projectData.scenes[sceneNumber - 1].voiceLine = prompt;
        console.log('Updated project data:', projectData.scenes[sceneNumber - 1]);

        try {
          fs.writeFileSync(projectFilePath, JSON.stringify(projectData, null, 2), 'utf-8');
          console.log('Project file updated successfully');
        } catch (err) {
          console.error('Error writing project file:', err);
          throw err;
        }

        console.log('Sending success response to renderer');
        event.sender.send('voice-model-response', {
          success: true,
          message: 'MP3 generation completed successfully',
        });

        console.log('Checking and rendering clip');
        checkAndRenderClip(projectPath, sceneNumber);
      } else {
        console.log('Voice generation failed, sending error response to renderer');
        event.sender.send('voice-model-response', {
          success: false,
          message: `Process exited with code ${code}`,
        });
      }
      console.log('Sending generation status update to renderer');
      event.sender.send('voice-generation-status', { sceneNumber, isGenerating: false });
    });
  } catch (error) {
    console.error('Error in run-voice-model:', error);
    console.log('Stack trace:', error.stack);
    event.sender.send('voice-model-response', {
      success: false,
      message: `An error occurred: ${error.message}`,
    });
    event.sender.send('voice-generation-status', { sceneNumber: -1, isGenerating: false });
  }
});

ipcMain.on('close-window', () => {
  const window = BrowserWindow.getFocusedWindow();
  if (window) window.close();
});
ipcMain.handle('check-voice-generation-status', (event, sceneNumber) => {
  return generatingVoicelines.has(sceneNumber);
});
ipcMain.handle('open-external-link', (event, url) => {
  shell.openExternal(url);
});
ipcMain.on('run-model', async (event, arg) => {
  try {
    await setupDependencies();
    const { venvPath, runModelPath } = updatePaths();

    playFlute();
    const outputPath = arg.outputPath;
    const aspectRatio = arg.aspectRatio;
    const prompt = arg.prompt;
    const negativePrompt = arg.negativePrompt;
    const width = arg.width;
    const height = arg.height;
    const sceneIndex = arg.sceneIndex;
    const baseModel = arg.baseModel;
    const loraModule = arg.loraModule;

    const projectPath = arg.outputPath.split("/Images")[0];
    const rootFolder = projectPath.split("/Projects")[0];
    console.log("root folder", rootFolder);

    const pythonPath = process.platform === 'win32' 
      ? path.join(venvPath, 'Scripts', 'python.exe')
      : path.join(venvPath, 'bin', 'python');

    const activateAndRun = `"${pythonPath}" "${runModelPath}" "${outputPath}" ${aspectRatio} "${prompt}" "${negativePrompt}" ${width} ${height} "${baseModel}" "${loraModule}" "${rootFolder}"`;
    console.log("Running command:", activateAndRun);

    let stderrBuffer = '';
    let isProcessClosed = false;

    const childProcess = exec(activateAndRun);

    childProcess.stdout.on('data', (data) => {
      data.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        console.log('stdout here:', trimmedLine);
        
        const progressMatch = trimmedLine.match(/ge:\s*(\d+)%\|/);
        
        if (progressMatch) {
          const progressPercent = parseInt(progressMatch[1], 10);
          if (!isNaN(progressPercent)) {
            console.log(`Progress for scene ${sceneIndex}:`, progressPercent);
            event.sender.send('progress-update', sceneIndex, progressPercent);
          }
        }
      });
    });

    childProcess.stdout.on('data', (data) => {
      if (!isProcessClosed) {
        data.split('\n').forEach(line => {
          const trimmedLine = line.trim();
          console.log('stdout here:', trimmedLine);
    
          
          // Match progress lines
          const progressMatch = trimmedLine.match(/ge:\s*(\d+)%\|/);
          
          if (progressMatch) {
            const progressPercent = parseInt(progressMatch[1], 10);
            if (!isNaN(progressPercent)) {
              console.log(`Progress for scene ${sceneIndex}:`, progressPercent);
              event.sender.send('progress-update', sceneIndex, progressPercent);
            }
          }
        });
      }
    });
    childProcess.stderr.on('data', (data) => {
      if (!isProcessClosed) {
        stderrBuffer += data.toString(); // Accumulate stderr output

        data.split('\n').forEach(line => {
          const trimmedLine = line.trim();
          console.log('stdout here:', trimmedLine);
    
          // Match progress lines with a more flexible regex
          const progressMatch = trimmedLine.match(/ge:\s*(\d+)%\|/);
          
          if (progressMatch) {
            const progressPercent = parseInt(progressMatch[1], 10);
            if (!isNaN(progressPercent)) {
              console.log(`Progress for scene ${sceneIndex}:`, progressPercent);
              event.sender.send('progress-update', sceneIndex, progressPercent);
            }
          }
        });
      }
    });

    childProcess.stderr.on('data', (data) => {
      stderrBuffer += data;
      console.error('stderr:', data);
    });

    childProcess.on('close', async (code) => {
      isProcessClosed = true;

      console.log(`Process for scene ${sceneIndex} exited with code ${code}`);
      playFlute();

      if (code === 0) {
        try {
          const projectData = JSON.parse(fs.readFileSync(projectPath + "/project.kodan", 'utf-8'));
          const scene = projectData.scenes[sceneIndex - 1];
          const captionSettings = scene.captionSettings || {};

          await ipcMain.handle('update-caption', event, projectPath + "/project.kodan", sceneIndex, captionSettings);
          
          console.log(`Caption updated for scene ${sceneIndex}`);
        } catch (error) {
          console.error(`Error updating caption for scene ${sceneIndex}:`, error);
        }
      } else {
        let errorMessage = `Image generation failed for scene ${sceneIndex}. Please check your inputs and try again.`;
        if (stderrBuffer.trim()) {
          errorMessage = `Image generation failed: ${stderrBuffer.trim()}`;
        }

        event.sender.send('run-model-response', sceneIndex, {
          success: false,
          message: errorMessage,
        });

        event.sender.send('image-generation-error', {
          sceneIndex,
          errorMessage,
        });
      }

      checkAndRenderClip(projectPath, sceneIndex);

      event.sender.send('run-model-response', sceneIndex, {
        success: code === 0,
        message: code === 0 ? 'Image generation and caption update completed successfully' : `Process exited with code ${code}`,
      });
    });
  } catch (error) {
    console.error('Error in run-model:', error);
    event.sender.send('run-model-response', arg.sceneIndex, {
      success: false,
      message: `An error occurred: ${error.message}`,
    });
  }
});










ipcMain.handle('check-file-updated', async (event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    return stats.mtime.getTime(); // Return the modification time
  } catch (error) {
    //console.error('Error checking file:', error);
    return null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Listen for createProject event
ipcMain.handle('createProject', async (event, projectDetails) => {
    const { folderPath, projectName, projectFolder, width, height } = projectDetails;
  
    const projectDir = path.join(folderPath, 'Projects', projectFolder);
    const modelsDir = path.join(folderPath, 'Models');
    const loraDir = path.join(modelsDir, 'LoRA');
    const baseDir = path.join(modelsDir, 'Base-Models');
    
    // Create project directory
    [projectDir, modelsDir, loraDir, baseDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    });
  
    // Create Thumbnail.png
    fs.mkdirSync(projectDir + "/Images", { recursive: true });

    const firstScenePath = path.join(projectDir, '/Images/1.png');

    const thumbnailPath = path.join(projectDir, 'Thumbnail.png');
    const widthPx = parseInt(width);
    const heightPx = parseInt(height);

    
    Promise.all([
      createGreyPNG(widthPx, heightPx, thumbnailPath),
      createGreyPNG(widthPx, heightPx, firstScenePath)
    ])
    .then(() => {
      console.log('Thumbnail.png and first scene image created.');
    })
    .catch(err => {
      console.error('Error creating images:', err);
    });

    // Create project.kodan
    const projectFilePath = path.join(projectDir, 'project.kodan');
    const projectData = {
      name: projectName,
      scenes: [
        {
          id: Math.floor(Math.random() * (1000000000 - 0 + 1)),
          thumbnail: projectDir + '/Images/1.png'
        },
        {
          id: Math.floor(Math.random() * (1000000000 - 0 + 1)),
          thumbnail: projectDir + '/Images/2.png'
        }
      ]
    };
    fs.writeFileSync(projectFilePath, JSON.stringify(projectData, null, 2));
  
    createProjectWindow(projectFilePath);


    return true;
  });


ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  } else {
    return null;
  }
});

ipcMain.handle('get-base-models', async () => {
  try {
    const baseModelsDir = path.join(rootFolder, 'Models', 'Base-Models');
    console.log(baseModelsDir)
    const files = await fs.promises.readdir(baseModelsDir);
    console.log(files)

    return files.filter(file => file.endsWith('.safetensors') || file.endsWith('.ckpt'));
  } catch (error) {
    console.error('Error fetching base models:', error);
    return [];
  }
});

ipcMain.handle('get-lora-modules', async () => {
  try {
    const loraModulesDir = path.join(rootFolder, 'Models', 'LoRA');
    const files = await fs.promises.readdir(loraModulesDir);
    return files.filter(file => file.endsWith('.safetensors') || file.endsWith('.ckpt'));
  } catch (error) {
    console.error('Error fetching LoRA modules:', error);
    return [];
  }
});

ipcMain.handle('get-project-data', async (event, folderPath) => {
  const projectsPath = path.join(folderPath, 'Projects');
  if (!fs.existsSync(projectsPath)) {
    return [];
  }

  const projects = fs.readdirSync(projectsPath)
    .filter((projectFolder) => {
      const projectPath = path.join(projectsPath, projectFolder);
      const kodanFile = path.join(projectPath, 'project.kodan');
      const thumbnailFile = path.join(projectPath, 'thumbnail.png');
      return fs.existsSync(kodanFile) && fs.existsSync(thumbnailFile);
    })
    .map((projectFolder) => {
      const projectPath = path.join(projectsPath, projectFolder);
      const kodanFile = path.join(projectPath, 'project.kodan');
      const thumbnailPath = path.join(projectPath, 'thumbnail.png');

      const fileContent = fs.readFileSync(kodanFile, 'utf-8');
      const projectContent = JSON.parse(fileContent);

      const stats = fs.statSync(projectPath);

      return {
        name: projectContent.name || 'Unnamed Project',
        lastEdited: stats.mtime,
        scenes: projectContent.scenes,
        path: projectPath,
        path: kodanFile, // Ensure this is the path to the project.kodan file
        thumbnail: thumbnailPath,
      };
    });

  return projects;
});

ipcMain.handle('open-scene-folder', async (event, projectFilePath, sceneIndex) => {
  try {
    const projectDir = path.dirname(projectFilePath);
    const clipPath = path.join(projectDir, 'Clips', `${sceneIndex}.mp4`);
    const imagePath = path.join(projectDir, 'Images', `${sceneIndex}.png`);

    if (fs.existsSync(clipPath)) {
      shell.showItemInFolder(clipPath);
    } else if (fs.existsSync(imagePath)) {
      shell.showItemInFolder(imagePath);
    } else {
      throw new Error('Neither clip nor image file found');
    }
  } catch (error) {
    console.error('Failed to open scene folder:', error);
    throw error;
  }
});

// IPC listener for opening the modal window
ipcMain.on('open-modal', () => {
  createModalWindow(); // Opens the modal window when the signal is received
});

ipcMain.on('open-project', (event, projectFilePath) => {
  createProjectWindow(projectFilePath);
});


  // Close the modal window
  ipcMain.on('close-modal', () => {
    if (modalWindow) {
      modalWindow.close();
    }
  });
  
  // Close the main window
  ipcMain.on('close-main-window', () => {
    if (mainWindow) {
      mainWindow.setClosable(true);

      mainWindow.close();
    }
  });

// Add this new IPC handler
ipcMain.handle('update-scene-prompts', async (event, projectFilePath, sceneIndex, positivePrompt, negativePrompt) => {
  try {
    const projectData = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
    
    if (projectData.scenes[sceneIndex - 1]) {
      projectData.scenes[sceneIndex - 1].positivePrompt = positivePrompt;
      projectData.scenes[sceneIndex - 1].negativePrompt = negativePrompt;
      
      fs.writeFileSync(projectFilePath, JSON.stringify(projectData, null, 2), 'utf-8');
      
      return true;
    } else {
      throw new Error('Scene not found');
    }
  } catch (error) {
    console.error('Failed to update scene prompts:', error);
    throw error;
  }
});

// Add a new IPC handler for updating caption settings
ipcMain.handle('update-scene-caption', async (event, projectFilePath, sceneIndex, captionSettings) => {
  try {
    const projectData = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
    
    if (projectData.scenes[sceneIndex - 1]) {
      projectData.scenes[sceneIndex - 1].captionSettings = {
        ...projectData.scenes[sceneIndex - 1].captionSettings,
        ...captionSettings
      };
      
      fs.writeFileSync(projectFilePath, JSON.stringify(projectData, null, 2), 'utf-8');
      
      return true;
    } else {
      throw new Error('Scene not found');
    }
  } catch (error) {
    console.error('Failed to update scene caption settings:', error);
    throw error;
  }
});

ipcMain.handle('update-caption', async (event, projectFilePath, sceneIndex, captionSettings) => {
  const { generateCaptionPath, venvPath } = updatePaths();
  try {
    const projectData = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
    const scene = projectData.scenes[sceneIndex - 1];
     
    if (scene && scene.thumbnail && fs.existsSync(scene.thumbnail)) {
      // const venvPath = path.join(__dirname, '../venv');
      const scriptPath = generateCaptionPath;
      
      // Create raw image path
      const rawImagePath = scene.thumbnail.replace('.png', '_raw.png');
      
      // If raw image doesn't exist, create it
      if (!fs.existsSync(rawImagePath)) {
        fs.copyFileSync(scene.thumbnail, rawImagePath);
      }
      
      const activateAndRun = `source ${venvPath}/bin/activate && python3 ${scriptPath} "${rawImagePath}" "${scene.thumbnail}" "${captionSettings.caption || ''}" "${captionSettings.fontSize || 16}" "${captionSettings.captionColor || '#FFE600'}" "${captionSettings.strokeColor || '#000000'}" "${captionSettings.strokeSize || 1.5}" "${captionSettings.selectedFont || 'Arial'}" "${captionSettings.selectedWeight || '400'}"`;

      return new Promise((resolve, reject) => {
        exec(activateAndRun, (error, stdout, stderr) => {
          if (stderr) {
            console.warn(`stderr: ${stderr}`);
            // Check if the last line indicates success
            if (stderr.trim().endsWith('caption generated successfully')) {
              // Process was actually successful
              const refreshedThumbnail = `${scene.thumbnail}?t=${Date.now()}`;
              const projectPath = path.dirname(projectFilePath);
              checkAndRenderClip(projectPath, sceneIndex);
              resolve(refreshedThumbnail);
            } else {
              // Real error occurred
              reject(new Error(stderr));
            }
          } else if (error) {
            console.error(`Error executing script: ${error.message}`);
            reject(error);
          } else {
            console.log(`stdout: ${stdout}`);
            const refreshedThumbnail = `${scene.thumbnail}?t=${Date.now()}`;
            const projectPath = path.dirname(projectFilePath);
            checkAndRenderClip(projectPath, sceneIndex);
            resolve(refreshedThumbnail);
          }
        });
      });
    } else {
      throw new Error('Scene or image not found');
    }
  } catch (error) {
    console.error('Failed to update caption:', error);
    throw error;
  }
});

ipcMain.handle('update-scene-model-settings', async (event, projectFilePath, sceneIndex, baseModel, selectedLora) => {
  try {
    const projectData = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
    
    if (projectData.scenes[sceneIndex - 1]) {
      projectData.scenes[sceneIndex - 1].baseModel = baseModel;
      projectData.scenes[sceneIndex - 1].selectedLora = selectedLora;
      
      fs.writeFileSync(projectFilePath, JSON.stringify(projectData, null, 2), 'utf-8');
      
      return true;
    } else {
      throw new Error('Scene not found');
    }
  } catch (error) {
    console.error('Failed to update scene model settings:', error);
    throw error;
  }
});

ipcMain.handle('update-scene-voiceline', async (event, projectFilePath, sceneIndex, voiceline, speaker) => {
  try {
    const projectData = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
    
    // Ensure the scene exists
    if (projectData.scenes[sceneIndex - 1]) {
      projectData.scenes[sceneIndex - 1].voiceline = voiceline;
      projectData.scenes[sceneIndex - 1].speaker = speaker; // Add this line to save the speaker
      
      // Save the updated project data
      fs.writeFileSync(projectFilePath, JSON.stringify(projectData, null, 2), 'utf-8');
      
      return true;
    } else {
      throw new Error('Scene not found');
    }
  } catch (error) {
    console.error('Failed to update scene voiceline and speaker:', error);
    throw error;
  }
});
ipcMain.on('update-project-order', async (event, filePath, updatedProjectData) => {
  try {
    // Update the project.kodan file
    await fs.writeFile(filePath, JSON.stringify(updatedProjectData, null, 2));

    // Rename files based on new order
    for (let i = 0; i < updatedProjectData.scenes.length; i++) {
      const scene = updatedProjectData.scenes[i];
      const newIndex = i + 1;
      const oldIndex = scene.id;

      if (newIndex !== oldIndex) {
        const basePath = path.dirname(filePath);

        // Rename image file
        const oldImagePath = path.join(basePath, 'Images', `${oldIndex}.png`);
        const newImagePath = path.join(basePath, 'Images', `${newIndex}.png`);
        if (await fs.pathExists(oldImagePath)) {
          await fs.move(oldImagePath, newImagePath, { overwrite: true });
        }

        // Rename voiceline file
        const oldVoicePath = path.join(basePath, 'Voicelines', `${oldIndex}.mp3`);
        const newVoicePath = path.join(basePath, 'Voicelines', `${newIndex}.mp3`);
        if (await fs.pathExists(oldVoicePath)) {
          await fs.move(oldVoicePath, newVoicePath, { overwrite: true });
        }

        // Rename clip file
        const oldClipPath = path.join(basePath, 'Clips', `${oldIndex}.mp4`);
        const newClipPath = path.join(basePath, 'Clips', `${newIndex}.mp4`);
        if (await fs.pathExists(oldClipPath)) {
          await fs.move(oldClipPath, newClipPath, { overwrite: true });
        }

        // Update scene id and thumbnail path
        scene.id = newIndex;
        scene.thumbnail = path.join('Images', `${newIndex}.png`);
      }
    }

    // Write updated project data back to file
    await fs.writeFile(filePath, JSON.stringify(updatedProjectData, null, 2));

    event.reply('update-project-order-response', { success: true });
  } catch (error) {
    console.error('Error updating project order:', error);
    event.reply('update-project-order-response', { success: false, error: error.message });
  }
});

ipcMain.handle('get-system-fonts', async () => {
  try {
    const fontDirs = [
      '/System/Library/Fonts',
      '/Library/Fonts',
      `${process.env.HOME}/Library/Fonts`
    ];

    const fontFiles = fontDirs.flatMap(dir => 
      glob.sync(path.join(dir, '**/*.{ttf,otf}'))
    );

    const fontMap = new Map();
    let arialWeights = new Set();

    for (const file of fontFiles) {
      try {
        const font = fontkit.openSync(file);
        const family = font.familyName;
        let weight = 400; // Default to Regular

        // Try to infer weight from PostScript name or full name
        const psName = font.postscriptName.toLowerCase();
        const fullName = font.fullName.toLowerCase();

        if (psName.includes('thin') || fullName.includes('thin')) weight = 100;
        else if (psName.includes('extralight') || fullName.includes('extra light')) weight = 200;
        else if (psName.includes('light')) weight = 300;
        else if (psName.includes('medium')) weight = 500;
        else if (psName.includes('semibold') || fullName.includes('semi bold')) weight = 600;
        else if (psName.includes('extrabold') || fullName.includes('extra bold')) weight = 800;
        else if (psName.includes('bold')) weight = 700;
        else if (psName.includes('black') || fullName.includes('black')) weight = 900;

        if (family.toLowerCase() === 'arial') {
          arialWeights.add(weight);
        }

        if (!fontMap.has(family)) {
          fontMap.set(family, new Set());
        }
        fontMap.get(family).add(weight);
      } catch (err) {
        console.error(`Error processing font file ${file}:`, err);
      }
    }

    // Move Arial to the front of the list if it exists
    let result = Array.from(fontMap, ([name, weights]) => ({
      name,
      weights: Array.from(weights).sort((a, b) => a - b)
    }));

    if (arialWeights.size > 0) {
      const arialEntry = result.find(font => font.name.toLowerCase() === 'arial');
      if (arialEntry) {
        result = [arialEntry, ...result.filter(font => font.name.toLowerCase() !== 'arial')];
      }
    }

    console.log('Fonts with weights:', result);
    return result;
  } catch (error) {
    console.error('Error fetching system fonts:', error);
    return [];
  }
});

ipcMain.handle('check-file-exists', async (event, filePath) => {
  return fs.existsSync(filePath);
});

ipcMain.handle('export-clip', async (event, mp4Path, pngPath, sceneNumber) => {
  try {
    let sourcePath = fs.existsSync(mp4Path) ? mp4Path : pngPath;
    let extension = path.extname(sourcePath);
    console.log(sourcePath, extension)
    if(extension == ".png") {

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export Clip',
        defaultPath: `Scene_${sceneNumber}${extension}`,
        filters: [
          { name: 'Image', extensions: ['png'] }
        ]
      });

      if (canceled || !filePath) {
        return null;
      }
  
      // Ensure the correct extension is used
      let targetPath = filePath;
      if (path.extname(targetPath) !== extension) {
        targetPath = `${targetPath}${extension}`;
      }
  
      await fs.promises.copyFile(sourcePath, targetPath);
  
      // Open the folder with the exported file selected
      shell.showItemInFolder(targetPath);
  
      return targetPath;
    } else {
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export Clip',
        defaultPath: `Scene_${sceneNumber}${extension}`,
        filters: [
          { name: 'Video', extensions: ['mp4'] },
        ]
    })

    if (canceled || !filePath) {
      return null;
    }

    // Ensure the correct extension is used
    let targetPath = filePath;
    if (path.extname(targetPath) !== extension) {
      targetPath = `${targetPath}${extension}`;
    }

    await fs.promises.copyFile(sourcePath, targetPath);

    // Open the folder with the exported file selected
    shell.showItemInFolder(targetPath);

    return targetPath;
    }



  } catch (error) {
    console.error('Error exporting clip:', error);
    throw error;
  }
});

