const { app, shell, BrowserWindow, nativeImage, ipcMain, screen, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { exec, spawn } = require('child_process');
const fontkit = require('fontkit');
const glob = require('glob');
const ffmpeg = require('fluent-ffmpeg');
const zlib = require('zlib');
const https = require('https');
const http = require('http');
const fetch = require('node-fetch');

let rootFolder

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
  const modelPath = path.join(modelsDir, modelDir, modelName);
  
  try {
    await fs.promises.access(modelPath);
    return true;
  } catch {
    return false;
  }
});

const downloads = new Map();

async function downloadFromCivitai(apiUrl, modelPath) {
  try {
    console.log('Fetching:', apiUrl);
    const response = await fetch(apiUrl, {
      redirect: 'follow',
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', response.headers);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const totalBytes = parseInt(response.headers.get('content-length'), 10);
    let downloadedBytes = 0;

    const fileStream = fs.createWriteStream(modelPath);
    
    return new Promise((resolve, reject) => {
      response.body.on('data', (chunk) => {
        downloadedBytes += chunk.length;
        const progress = totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
        BrowserWindow.getAllWindows().forEach(window => {
          window.webContents.send('download-progress', progress);
        });
      });

      response.body.pipe(fileStream);

      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
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

ipcMain.handle('startDownload', async (event, modelURL, modelName, modelType) => {
  try {
    const modelsDir = path.join(rootFolder, 'Models');
    const modelDir = modelType === 'base-model' ? 'Base-Models' : 'LoRA';
    const modelPath = path.join(modelsDir, modelDir, modelName);

    // Ensure the directory exists
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });

    const apiUrl = modelURL;

    const response = await fetch(apiUrl, { redirect: 'follow' });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const totalBytes = parseInt(response.headers.get('content-length'), 10);
    let downloadedBytes = 0;

    const fileStream = fs.createWriteStream(modelPath);
    
    response.body.on('data', (chunk) => {
      downloadedBytes += chunk.length;
      const progress = totalBytes ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
      event.sender.send('download-progress', { modelName, progress });
    });

    await new Promise((resolve, reject) => {
      response.body.pipe(fileStream);
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
    });

    return { success: true, path: modelPath };
  } catch (error) {
    console.error('Download failed:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('getDownloadProgress', (event, downloadId) => {
    return downloads.get(downloadId) || 0;
});

async function deleteModel(modelName, modelType, rootFolder) {
  const modelsDir = path.join(rootFolder, 'Models');
  const modelDir = modelType === 'base-model' ? 'Base-Models' : 'LoRA';
  const modelPath = path.join(modelsDir, modelDir, modelName);

  try {
    // Delete the file or directory and its contents
    await fs.promises.rm(modelPath, { recursive: true, force: true });

    // Check if the parent directory is empty, and delete it if so
    let currentDir = path.dirname(modelPath);
    while (currentDir !== path.join(modelsDir, modelDir)) {
      const items = await fs.promises.readdir(currentDir);
      if (items.length === 0) {
        await fs.promises.rmdir(currentDir);
        currentDir = path.dirname(currentDir);
      } else {
        break;
      }
    }

    console.log(`Model and empty parent directories deleted successfully up to ${modelDir}`);
    return true;
  } catch (error) {
    console.error(`Error deleting model: ${error}`);
    throw error;
  }
}

ipcMain.handle('deleteModel', async (event, modelName, modelType) => {
  try {
    console.log(modelName, modelType, rootFolder)
    await deleteModel(modelName, modelType, rootFolder);
    return { success: true };
  } catch (error) {
    console.error('Error in deleteModel handler:', error);
    return { success: false, error: error.message };
  }
});


ipcMain.handle('get-voices', (event) => {
  return new Promise((resolve, reject) => {
    const voicesPath = path.join(__dirname, '..', 'Voices');
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

ipcMain.handle('add-voice', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'WAV', extensions: ['wav'] }]
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const sourcePath = result.filePaths[0];
    const fileName = path.basename(sourcePath);
    const destPath = path.join(__dirname, '..', 'Voices', fileName);

    return new Promise((resolve) => {
      fs.copyFile(sourcePath, destPath, (err) => {
        if (err) {
          console.error('Error copying voice file:', err);
          resolve(false);
        } else {
          resolve(true);
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

    const venvPath = path.join(__dirname, '../venv'); // Path to your virtual environment

    // Command to activate the virtual environment and run renderProject.py with the selected file path
    const activateAndRun = `source ${venvPath}/bin/activate && python3 renderProject.py "${projectFolder}" "${filePath}"`;

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



  
function createProjectWindow(projectFilePath) {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  rootFolder = projectFilePath.split("/Projects")[0]
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


app.whenReady().then(() => {
  app.setAppUserModelId('com.serenidad.kodan'); // Optional for Windows, doesn't impact macOS

  const image = nativeImage.createFromPath('./KodanFlower.icns');
  app.dock.setIcon(image);  
  createWindow()
  app.commandLine.appendSwitch('disable-gpu');
  process.env.PYTORCH_ENABLE_MPS_FALLBACK = "1";



});

let lastNumber = 0


function renderClip(projectPath, sceneNumber) {
  const venvPath = path.join(__dirname, '../venv'); // Path to your virtual environment

  const activateAndRun = `source ${venvPath}/bin/activate && python3 renderClip.py "${projectPath}" "${sceneNumber}"`;

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
  const sceneNumber = parseInt(arg.outputLocation.split("Voicelines/")[1].split(".mp3")[0]);
  generatingVoicelines.add(sceneNumber);

  const venvPath = path.join(__dirname, '../venv'); // Path to your virtual environment
  const outputLocation = arg.outputLocation;
  const prompt = arg.prompt;
  const maxLength = arg.maxLength || 250;
  const speakerWav = `./Voices/${arg.speakerWav}.wav` || "./Voices/Narrator.wav";
  const language = arg.language || "en";

  const projectPath = arg.outputLocation.split("/Voicelines")[0];

  const activateAndRun = `source ${venvPath}/bin/activate && python3 -u voice.py "${prompt}" "${outputLocation}" ${maxLength} "${speakerWav}" "${language}"`;

  const process = exec(activateAndRun);

  let isProcessClosed = false;

  process.stdout.on('data', (data) => {
    if (!isProcessClosed) {
      data.split('\n').forEach(line => {
        const trimmedLine = line.trim();
        console.log('stdout:', trimmedLine);
        event.sender.send('voice-progress-update', trimmedLine);
      });
    }
  });

  process.stderr.on('data', (data) => {
    if (!isProcessClosed) {
      console.warn('stderr:', data.toString());
      event.sender.send('voice-error', data.toString());
    }
  });

  process.on('close', (code) => {
    isProcessClosed = true;
    generatingVoicelines.delete(sceneNumber);
    if (code === 0) {
      // Update project.kodan with the voice line path
      const projectFilePath = path.join(projectPath, 'project.kodan');
      const projectData = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));

      projectData.scenes[sceneNumber - 1].voiceLinePath = outputLocation;
      projectData.scenes[sceneNumber - 1].voiceLine = prompt;

      fs.writeFileSync(projectFilePath, JSON.stringify(projectData, null, 2), 'utf-8');

      console.log(`Process exited with code: ${code}`);
      event.sender.send('voice-model-response', {
        success: true,
        message: 'MP3 generation completed successfully',
      });

      checkAndRenderClip(projectPath, sceneNumber); // Check and render clip if the image also exists
    } else {
      event.sender.send('voice-model-response', {
        success: false,
        message: `Process exited with code ${code}`,
      });
    }
    event.sender.send('voice-generation-status', { sceneNumber, isGenerating: false });
  });
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
ipcMain.on('run-model', (event, arg) => {
  playFlute()
  const venvPath = path.join(__dirname, '../venv'); // Path to your virtual environment
  const outputPath = arg.outputPath;
  const aspectRatio = arg.aspectRatio;
  const prompt = arg.prompt;
  const negativePrompt = arg.negativePrompt;
  const width = arg.width;
  const height = arg.height;
  const sceneIndex = arg.sceneIndex; // Track which scene is being processed
  const baseModel = arg.baseModel; // New argument for base model
  const selectedLora = arg.selectedLora; // New argument for LoRA module

  const projectPath = arg.outputPath.split("/thumbnail.png")[0]
  console.log("project path", projectPath)

  const runModelPath = app.isPackaged
    ? path.join(process.resourcesPath, 'run_model.py')
    : path.join(__dirname, '..', 'run_model.py');

  // Use app.whenReady() to ensure process is available
  app.whenReady().then(() => {
    const activateAndRun = `source ${venvPath}/bin/activate && python3 -u "${runModelPath}" "${outputPath}" ${aspectRatio} "${prompt}" "${negativePrompt}" ${width} ${height} "${baseModel}"`;

    const process = exec(activateAndRun);

    let isProcessClosed = false;

    process.stdout.on('data', (data) => {
      if (!isProcessClosed) {
        data.split('\n').forEach(line => {
          const trimmedLine = line.trim();

          // Match progress lines only
          const progressBarMatch = trimmedLine.match(/^(\d+)%\|/);
          const progressCustomMatch = trimmedLine.match(/PROGRESS: (\d+)\/(\d+)/);

          if (progressBarMatch) {
            const progressPercent = parseInt(progressBarMatch[1], 10);
            if (!isNaN(progressPercent)) {
              console.log(`Progress for scene ${sceneIndex}:`, progressPercent);
              event.sender.send('progress-update', sceneIndex, progressPercent);
            }
          } else if (progressCustomMatch) {
            const currentStep = parseInt(progressCustomMatch[1], 10);
            const totalSteps = parseInt(progressCustomMatch[2], 10);
            if (!isNaN(currentStep) && !isNaN(totalSteps) && totalSteps > 0) {
              const progressPercent = Math.round((currentStep / totalSteps) * 100);
              console.log(`Progress for scene ${sceneIndex}:`, progressPercent);
              event.sender.send('progress-update', sceneIndex, progressPercent);
            }
          } else if (!isNaN(trimmedLine)) {
            // Handle cases where a number is received without a percentage symbol
            const progressPercent = parseInt(trimmedLine, 10);
            if (!isNaN(progressPercent)) {
              console.log(`Progress for scene ${sceneIndex}:`, progressPercent);
              event.sender.send('progress-update', sceneIndex, progressPercent);
            }
          } else {
            console.warn('Non-progress data:', trimmedLine);
          }
        });
      }
    });

    process.stderr.on('data', (data) => {
      if (!isProcessClosed) {
        // You may want to handle stderr data similarly
        console.warn(`stderr for scene ${sceneIndex}:`, data.toString());
      }
    });

    process.on('close', async (code) => {
      isProcessClosed = true;
      console.log(`Process for scene ${sceneIndex} exited with code ${code}`);
      playFlute()

      if (code === 0) {
        try {
          // Load the project data to get the caption settings
          const projectData = JSON.parse(fs.readFileSync(outputPath?.split("/Images")[0], 'utf-8'));
          const scene = projectData.scenes[sceneIndex - 1];
          const captionSettings = scene.captionSettings || {};

          // Call update-caption

          await ipcMain.handle('update-caption', event, outputPath?.split("/Images")[0] + "./project.kodan", sceneIndex, captionSettings);
          
          console.log(`Caption updated for scene ${sceneIndex}`);
        } catch (error) {
          console.error(`Error updating caption for scene ${sceneIndex}:`, error);
        }
      }

      checkAndRenderClip(projectPath.split("/Images")[0], sceneIndex);

      event.sender.send('run-model-response', sceneIndex, {
        success: code === 0,
        message: code === 0 ? 'Image generation and caption update completed successfully' : `Process exited with code ${code}`,
      });
    });
  });
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

    // sharp({
    //     create: {
    //       width: widthPx,
    //       height: heightPx,
    //       channels: 4,
    //       background: '#F2F2F2',
    //     }
    //   })
    //   .png()
    //   .toFile(thumbnailPath)
    //   .then(() => {
    //     console.log('Thumbnail.png created.');
    //   })
    //   .catch(err => {
    //     console.error('Error creating thumbnail:', err);
    //   });
    //   sharp({
    //     create: {
    //       width: widthPx,
    //       height: heightPx,
    //       channels: 4,
    //       background: '#F2F2F2',
    //     }
    //   })
    //   .png()
    //   .toFile(firstScenePath)
    //   .then(() => {
    //     console.log('Thumbnail.png created.');
    //   })
    //   .catch(err => {
    //     console.error('Error creating thumbnail:', err);
    //   });
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
  try {
    const projectData = JSON.parse(fs.readFileSync(projectFilePath, 'utf-8'));
    const scene = projectData.scenes[sceneIndex - 1];
     
    if (scene && scene.thumbnail && fs.existsSync(scene.thumbnail)) {
      const venvPath = path.join(__dirname, '../venv');
      const scriptPath = path.join(__dirname, '../generate_caption.py');
      
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

