import React, { useEffect, useState, useCallback, useRef } from 'react';
import { debounce } from 'lodash';
import animeFacts from './animeFacts.json';
import { Img } from 'react-image'
import { useInterval } from 'react-use';
import { Tooltip } from 'react-tooltip';

const ProjectComponent = ({ filePath }) => {
  const [projectData, setProjectData] = useState(null);
  const [thumbnail, setThumbnail] = useState('');
  const [aspectRatio, setAspectRatio] = useState(1);
  const [selectedScene, setSelectedScene] = useState(1);
  const [refreshKey, setRefreshKey] = useState(Date.now()); // Key to force image refresh
  const [imgW, setImgW] = useState(0); // Width of the image
  const [imgH, setImgH] = useState(0); // Height of the image
  const [composeUserInput, setComposeUserInput] = useState("");
  const [composeSubmitted, setComposeSubmitted] = useState(false);

  const [voiceText, setVoiceText] = useState('');
  const [speakerWav, setSpeakerWav] = useState('Narrator');

  const [baseModel, setBaseModel] = useState('');
  const [selectedLora, setSelectedLora] = useState('');

  const [baseModels, setBaseModels] = useState([]);
  const [loraModules, setLoraModules] = useState([]);

  const [isGeneratingVoice, setIsGeneratingVoice] = useState(false);
  const [generateText, setGenerateText] = useState('Generate Voice');

  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const [currentFact, setCurrentFact] = useState('');

  const generateVoiceLine = async (sceneIndex) => {
    const outputLocation = `${filePath.split("/project.kodan")[0]}/Voicelines/${sceneIndex}.mp3`;
    const language = 'en'; // Assuming English, can be adjusted as needed
    
    setIsGeneratingVoice(true);
    setGenerateText('Generating');

    window.electron.send('run-voice-model', {
      prompt: voiceText,
      outputLocation: outputLocation,
      speakerWav: speakerWav,
      language: language
    });

    window.electron.once('voice-model-response', (event, response) => {
      setIsGeneratingVoice(false);
      setGenerateText('Generate Voice');

      if (response.success) {
        console.log('Voice generation completed successfully!');
      } else {
        console.error('Voice generation failed:', response.message);
      }
    });
  };

  useEffect(() => {
    const checkVoiceGenerationStatus = async () => {
      const status = await window.electron.ipcRenderer.invoke('check-voice-generation-status', selectedScene);
      setIsGeneratingVoice(status);
      setGenerateText(status ? 'Generating' : 'Generate Voice');
    };

    checkVoiceGenerationStatus();

    const intervalId = setInterval(checkVoiceGenerationStatus, 1000); // Check every second

    return () => clearInterval(intervalId);
  }, [selectedScene]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      // Check if the active element is an input or textarea
      const activeElement = document.activeElement;
      const isInputFocused = activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA';

      if ((event.key === 'ArrowRight' || event.key === 'ArrowLeft') && !isInputFocused) {
        setVoiceText("");
        setPressedScene(selectedScene);

        setTimeout(() => {
          setSelectedScene((prevScene) => {
            if (event.key === 'ArrowRight' && projectData && prevScene < projectData.scenes.length) {
              return prevScene + 1;
            } else if (event.key === 'ArrowLeft' && prevScene > 1) {
              return prevScene - 1;
            }
            return prevScene;
          });
          setPressedScene(null);
        }, 100);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [projectData, selectedScene]);

  const [currentlyLoading, setCurrentlyLoading] = useState([]); // Track currently loading scenes

  const [progressMap, setProgressMap] = useState({}); // Track progress for each scene
  const [progressMessageMap, setProgressMessageMap] = useState({}); // Track progress message for each scene

  
  useEffect(() => {
    const intervalId = setInterval(async () => {
      if (projectData && projectData.scenes.length > 0) {
        const scene = projectData.scenes[selectedScene - 1];
        const mp4Path = `${filePath.split("/project.kodan")[0]}/Clips/${selectedScene}.mp4`;
        const fileModifiedTime = await window.electron.ipcRenderer.invoke('check-file-updated', mp4Path);
  
        if (fileModifiedTime) {
          // If the MP4 exists, update the thumbnail to use the video, appending a timestamp to force reload
          setThumbnail(`${mp4Path}`);
          setRefreshKey(Date.now()); // Update the key to force image refresh
          setVideoKey(fileModifiedTime); // Use fileModifiedTime as the key to force a refresh

          // Get video duration
          const duration = await window.electron.ipcRenderer.invoke('get-video-duration', mp4Path);
          setSceneDuration(duration);
        } else {
          // If no MP4 exists, continue using the PNG thumbnail
          loadThumbnail(scene.thumbnail);
          setSceneDuration(null);
        }
      }
    }, 1000);
  
    // Clean up the interval when the component is unmounted
    return () => clearInterval(intervalId);
  }, [projectData, selectedScene, refreshKey]);

  const [videoKey, setVideoKey] = useState(null); // New state for video file updates

  useEffect(() => {
    const loadProjectData = () => {
      fetch(filePath)
        .then((response) => response.json())
        .then((data) => {
          setProjectData(data);

          if (data?.scenes?.length > 0) {
            const scene = data.scenes[selectedScene - 1];
            loadThumbnail(scene.thumbnail);
          }
        })
        .catch((error) => {
          console.error('Error loading project:', error);
        });
    };

    loadProjectData();
  }, [filePath, selectedScene]);

  const loadThumbnail = (thumbnailPath) => {
    const img = new Image();
    img.src = thumbnailPath;

    img.onload = function () {
      setThumbnail(thumbnailPath);
      setAspectRatio(img.width / img.height);
      setImgW(img.width);
      setImgH(img.height);
    };

    img.onerror = function () {
      setThumbnail(null);
      console.error('Error loading thumbnail image.');
    };
  };

  const generateImage = async (sceneIndex) => {
    window.electron.send('run-model', {
      outputPath: filePath.split("/project.kodan")[0] + `/Images/${sceneIndex}.png`,
      aspectRatio: aspectRatio,
      prompt: prompt,
      negativePrompt: negativePrompt,
      width: imgW,
      height: imgH,
      sceneIndex: sceneIndex,
      baseModel: baseModel,
      loraModule: selectedLora
    });
  };

  const addNewScene = () => {
    window.electron.ipcRenderer.invoke('add-new-scene', filePath, aspectRatio)
      .then((updatedProjectData) => {
        setProjectData(updatedProjectData);
        setVoiceText("")
        setSelectedScene(updatedProjectData.scenes.length);
        setNegativePrompt("");
        setPrompt("");
      })
      .catch(error => {
        console.error('Failed to add new scene:', error);
      });
  };

  const [generateImageText, setGenerateImageText] = useState({});

  useEffect(() => {
    const handleProgressUpdate = (event, sceneIndex, progressPercent) => {

      console.log("progressP", progressPercent, "event", event, "index", sceneIndex)
      setProgressMap(prev => ({
        ...prev,
        [event]: sceneIndex
      }));
      setProgressMessageMap(prev => ({
        ...prev,
        [event]: `${sceneIndex}% Complete`
      }));
      if (parseInt(sceneIndex) >= 95) {
        setTimeout(() => {

        setCurrentlyLoading(prev => prev.filter(scene => scene !== event));
        console.log("Setting generated", event, "Progress", sceneIndex)

        setGenerateImageText(prev => ({
          ...prev,
          [event]: 'Generate Visuals'
        }));
      }, 2000); // 2000 milliseconds = 2 seconds

      }
    };
  
    const handleModelResponse = (event, sceneIndex, response) => {
      console.log("sceneIndex", sceneIndex, "response", response, "event", event)
      if(sceneIndex.success == false && sceneIndex.message != "Process exited with code 1") {
        alert(sceneIndex.message)
        setCurrentlyLoading(prev => prev.filter(scene => scene !== event));
      }
      if (response.success) {
        setProgressMessageMap(prev => ({
          ...prev,
          [sceneIndex]: 'Generation Complete!'
        }));
        setCurrentlyLoading(prev => prev.filter(scene => scene !== sceneIndex));
        setGenerateImageText(prev => ({
          ...prev,
          [sceneIndex]: 'Generated'
        }));
      } else {
        setProgressMessageMap(prev => ({
          ...prev,
          [sceneIndex]: 'Generation Failed!'
        }));
        setGenerateImageText(prev => ({
          ...prev,
          [sceneIndex]: 'Generate Visuals'
        }));
      }
    };
  
    window.electron.on('progress-update', handleProgressUpdate);
    window.electron.on('run-model-response', handleModelResponse);
  
    return () => {
      window.electron.off('progress-update', handleProgressUpdate);
      window.electron.off('run-model-response', handleModelResponse);
    };
  }, []);
  
  

  const startGenerationForScene = (sceneIndex) => {
    setCurrentlyLoading(prev => [...prev, sceneIndex]);
    console.log("Setting generating", sceneIndex)
    setGenerateImageText(prev => ({
      ...prev,
      [sceneIndex]: 'Generating'
    }));
    generateImage(sceneIndex);
  };

  // Add new state variables for caption settings
  const [captionSettings, setCaptionSettings] = useState({
    fontSize: 16,
    captionColor: '#FFE600',
    caption: '',
    strokeColor: '#000000',
    strokeSize: 1.5,
    selectedFont: 'Arial',
    selectedWeight: '700'
  });

  useEffect(() => {
    if (projectData && projectData.scenes[selectedScene - 1]) {
      setIsTransitioning(true);
      const currentScene = projectData.scenes[selectedScene - 1];
      setTimeout(() => {
        setPrompt(currentScene.positivePrompt || '');
        setNegativePrompt(currentScene.negativePrompt || '');
        setVoiceText(currentScene.voiceline || '');
        setSpeakerWav(currentScene.speaker || 'Narrator');
        fetchBaseModels()
        fetchLoraModules()
        setBaseModel(currentScene.baseModel || baseModels[0]);
        setSelectedLora(currentScene.selectedLora || loraModules[0]);
        
        // Load caption settings
        setCaptionSettings(prevSettings => ({
          ...prevSettings,
          ...currentScene.captionSettings,
          fontSize: currentScene.captionSettings?.fontSize || 16,
          captionColor: currentScene.captionSettings?.captionColor || '#FFE600',
          caption: currentScene.captionSettings?.caption || '',
          strokeColor: currentScene.captionSettings?.strokeColor || '#000000',
          strokeSize: currentScene.captionSettings?.strokeSize || 1.5,
          selectedFont: currentScene.captionSettings?.selectedFont || 'Arial',
          selectedWeight: currentScene.captionSettings?.selectedWeight || '700'
        }));
        
        setIsTransitioning(false);
      }, 50);
    }
  }, [selectedScene, projectData]);

  const updateCaptionSettings = useCallback(
    debounce(async (newSettings) => {
      try {
        const updatedSettings = { ...captionSettings, ...newSettings };
        await window.electron.ipcRenderer.invoke('update-scene-caption', filePath, selectedScene, updatedSettings);
        
        // Only generate caption if there's an image
        if (thumbnail) {
          const refreshedThumbnail = await window.electron.ipcRenderer.invoke('update-caption', filePath, selectedScene, updatedSettings);
          setThumbnail(refreshedThumbnail);
          
          // Update the project data with new caption settings
          setProjectData(prevData => ({
            ...prevData,
            scenes: prevData.scenes.map((scene, index) => 
              index === selectedScene - 1 
                ? { ...scene, thumbnail: refreshedThumbnail, captionSettings: updatedSettings }
                : scene
            )
          }));

          // Update the local captionSettings state
          setCaptionSettings(updatedSettings);
        }
      } catch (error) {
        console.error('Failed to update scene caption settings:', error);
      }
    }, 500),
    [filePath, selectedScene, thumbnail, captionSettings]
  );

  const updateScenePrompts = useCallback(
    debounce((positivePrompt, negativePrompt) => {
      window.electron.ipcRenderer.invoke('update-scene-prompts', filePath, selectedScene, positivePrompt, negativePrompt)
        .catch(error => console.error('Failed to update scene prompts:', error));
    }, 500),
    [filePath, selectedScene]
  );

  const updateSceneVoiceline = useCallback(
    debounce((voiceline, speaker) => {
      window.electron.ipcRenderer.invoke('update-scene-voiceline', filePath, selectedScene, voiceline, speaker)
        .catch(error => console.error('Failed to update scene voiceline and speaker:', error));
    }, 500),
    [filePath, selectedScene]
  );

  const updateSceneModelSettings = useCallback(
    debounce((baseModel, selectedLora) => {
      window.electron.ipcRenderer.invoke('update-scene-model-settings', filePath, selectedScene, baseModel, selectedLora)
        .catch(error => console.error('Failed to update scene model settings:', error));
    }, 500),
    [filePath, selectedScene]
  );

  const handlePromptChange = (event) => {
    const newPrompt = event.target.value;
    setPrompt(newPrompt);
    updateScenePrompts(newPrompt, negativePrompt);
  };

  const handleNegativePromptChange = (event) => {
    const newNegativePrompt = event.target.value;
    setNegativePrompt(newNegativePrompt);
    updateScenePrompts(prompt, newNegativePrompt);
  };

  const handleVoiceTextChange = (event) => {
    const newVoiceText = event.target.value;
    setVoiceText(newVoiceText);
    updateSceneVoiceline(newVoiceText, speakerWav);
  };

  const handleVoiceTextBlur = () => {
    if (!captionSettings.caption || captionSettings.caption.trim() === '') {
      updateSceneVoiceline(voiceText, speakerWav);
      setVoiceText(voiceText)

      setTimeout(() => {

      setLocalCaption(voiceText);
      updateCaptionSettings({ caption: voiceText });

    }, 2000); // 2000 milliseconds = 2 seconds

    }
  };

// Update the handleSpeakerChange function to use the new handleAddVoice
const handleSpeakerChange = async (event) => {
  const newSpeaker = event.target.value;
  if (newSpeaker === 'add-voice') {
    await handleAddVoice();
  } else {
    setSpeakerWav(newSpeaker);
    updateSceneVoiceline(voiceText, newSpeaker);
  }
};

  const [pressedScene, setPressedScene] = useState(null);
  const [isMouseDown, setIsMouseDown] = useState(false);

  const [deletingScenes, setDeletingScenes] = useState(new Set());
  const sceneRefs = useRef({});

  const handleDeleteScene = (index) => {
    window.electron.ipcRenderer.invoke('delete-scene', filePath, index + 1)
      .then((updatedProjectData) => {
        if (updatedProjectData) {
          // Animate the scene deletion
          setDeletingScenes(prev => new Set(prev).add(index + 1));
          
          // Trigger the animation
          if (sceneRefs.current[index + 1]) {
            sceneRefs.current[index + 1].style.width = '0px';
            sceneRefs.current[index + 1].style.height = '0px';
            sceneRefs.current[index + 1].style.opacity = '0';
            sceneRefs.current[index + 1].style.margin = '0';
            sceneRefs.current[index + 1].style.padding = '0';
          }

          // Wait for the animation to complete before updating the state
          setTimeout(() => {
            setProjectData(updatedProjectData);
            setVoiceText("");
            if (index + 1 <= selectedScene) {
              setSelectedScene(Math.max(1, selectedScene - 1));
            }
            setDeletingScenes(prev => {
              const newSet = new Set(prev);
              newSet.delete(index + 1);
              return newSet;
            });
          }, 300); // Match this with the transition duration
        }
        // If updatedProjectData is null, it means the deletion was canceled
        // In this case, we don't update any state
      })
      .catch(error => {
        console.error('Failed to delete scene:', error);
      });
  };

  const handleOpenFolder = (sceneIndex) => {
    window.electron.ipcRenderer.invoke('open-scene-folder', filePath, sceneIndex)
      .catch(error => console.error('Failed to open scene folder:', error));
  };

  const [availableFonts, setAvailableFonts] = useState([]);
  const [availableWeights, setAvailableWeights] = useState([]);

  const colorInputRef = React.useRef(null);
  const colorStrokeInputRef = React.useRef(null);

  const openColorPicker = () => {
    colorInputRef.current.click();
  };
  const openStrokeColorPicker = () => {
    colorStrokeInputRef.current.click();
  };

  useEffect(() => {
    setSelectedScene(2)
    const fetchFonts = async () => {
      try {
        const fonts = await window.electron.ipcRenderer.invoke('get-system-fonts');
        console.log('Received fonts:', fonts);
        setAvailableFonts(fonts);
        
        // Find Arial in the fonts list
        const arialFont = fonts.find(font => font.name.toLowerCase() === 'arial');
        
        if (arialFont) {
          setCaptionSettings(prev => ({ ...prev, selectedFont: 'Arial' }));
          updateAvailableWeights(arialFont);
        } else if (fonts.length > 0) {
          setCaptionSettings(prev => ({ ...prev, selectedFont: fonts[0].name }));
          updateAvailableWeights(fonts[0]);
        }
      } catch (error) {
        console.error('Error fetching fonts:', error);
      }
    };

    fetchFonts();
  }, []);

  const updateAvailableWeights = useCallback((font) => {
    const weights = font.weights.map(w => ({
      value: w.toString(),
      label: weightToString(w)
    }));
    setAvailableWeights(weights);
    
    // Set default weight to Bold (700) if available, otherwise to the first available weight
    const boldWeight = weights.find(w => w.value === '700');
    if (boldWeight) {
      setCaptionSettings(prev => ({ ...prev, selectedWeight: '700' }));
    } else {
      setCaptionSettings(prev => ({ ...prev, selectedWeight: weights[0].value }));
    }
  }, []);

  const weightToString = useCallback((weight) => {
    const weightMap = {
      100: 'Thin',
      200: 'Extra Light',
      300: 'Light',
      400: 'Regular',
      500: 'Medium',
      600: 'Semi Bold',
      700: 'Bold',
      800: 'Extra Bold',
      900: 'Black'
    };
    return weightMap[weight] || weight.toString();
  }, []);

  const handleFontChange = useCallback((event) => {
    const newFont = event.target.value;
    updateCaptionSettings({ selectedFont: newFont });
    const font = availableFonts.find(f => f.name === newFont);
    if (font) {
      updateAvailableWeights(font);
    }
  }, [availableFonts, updateCaptionSettings]);

  const handleWeightChange = useCallback((event) => {
    const newWeight = event.target.value;
    updateCaptionSettings({ selectedWeight: newWeight });
  }, [updateCaptionSettings]);

  const handleFontSizeChange = (event) => {
    const newSize = Math.min(99, Math.max(1, parseInt(event.target.value) || 1));
    updateCaptionSettings({ fontSize: newSize });
  };

  const handleColorChange = (event) => {
    updateCaptionSettings({ captionColor: event.target.value });
  };

  const handleStrokeColorChange = (event) => {
    updateCaptionSettings({ strokeColor: event.target.value });
  };

  const handleStrokeSizeChange = (event) => {
    updateCaptionSettings({ strokeSize: event.target.value });
  };

  const [localCaption, setLocalCaption] = useState('');

  const handleCaptionChange = (event) => {
    setLocalCaption(event.target.value);
  };

  const handleCaptionBlur = () => {
    updateCaptionSettings({ caption: localCaption });
  };

  useEffect(() => {
    fetchBaseModels()
    fetchLoraModules()
    if (projectData && projectData.scenes[selectedScene - 1]) {
      setIsTransitioning(true);
      const currentScene = projectData.scenes[selectedScene - 1];
      setTimeout(() => {
        setPrompt(currentScene.positivePrompt || '');
        setNegativePrompt(currentScene.negativePrompt || '');
        setVoiceText(currentScene.voiceline || '');
        setSpeakerWav(currentScene.speaker || 'Narrator');
        
        // Load caption settings
        setCaptionSettings(prevSettings => ({
          ...prevSettings,
          ...currentScene.captionSettings,
          fontSize: currentScene.captionSettings?.fontSize || 16,
          captionColor: currentScene.captionSettings?.captionColor || '#FFE600',
          caption: currentScene.captionSettings?.caption || '',
          strokeColor: currentScene.captionSettings?.strokeColor || '#000000',
          strokeSize: currentScene.captionSettings?.strokeSize || 1.5,
          selectedFont: currentScene.captionSettings?.selectedFont || 'Arial',
          selectedWeight: currentScene.captionSettings?.selectedWeight || '700'
        }));
        
        setLocalCaption(currentScene.captionSettings?.caption || '');
        setIsTransitioning(false);
      }, 50);
    }
  }, [selectedScene, projectData]);

  const fetchBaseModels = useCallback(async () => {
    try {
      const models = await window.electron.ipcRenderer.invoke('get-base-models');
      setBaseModels(models);
    } catch (error) {
      console.error('Failed to fetch base models:', error);
    }
  }, []);

  const fetchLoraModules = useCallback(async () => {
    try {
      const modules = await window.electron.ipcRenderer.invoke('get-lora-modules');
      setLoraModules(modules);
    } catch (error) {
      console.error('Failed to fetch LoRA modules:', error);
    }
  }, []);

  const handleBaseModelChange = async (event) => {
    const newBaseModel = event.target.value;
    if (newBaseModel === 'manage') {
      window.electron.ipcRenderer.send('open-manage-window', 'baseModel');
    } else {
      setBaseModel(newBaseModel);
      updateSceneModelSettings(newBaseModel, selectedLora);
    }
  };

  const handleLoraChange = async (event) => {
    const newSelectedLora = event.target.value;
    if (newSelectedLora === 'manage') {
      window.electron.ipcRenderer.send('open-manage-window', 'lora');
    } else {
      setSelectedLora(newSelectedLora);
      updateSceneModelSettings(baseModel, newSelectedLora);
    }
  };

  const [composeMode, setComposeMode] = useState(false);


  const [pressedAddScene, setPressedAddScene] = useState(false);

  const [sceneDuration, setSceneDuration] = useState(null);

  useEffect(() => {
    // Add this to select a random fact when the component mounts or when the selected scene changes
    setCurrentFact(animeFacts[Math.floor(Math.random() * animeFacts.length)]);
  }, [selectedScene]);

  const [voices, setVoices] = useState([]);

  useEffect(() => {
    loadVoices();
  }, []);

  const loadVoices = async () => {
    try {
      const voiceFiles = await window.electron.ipcRenderer.invoke('get-voices');
      setVoices(voiceFiles);
    } catch (error) {
      console.error('Failed to load voices:', error);
    }
  };

  const handleAddVoice = async () => {
    try {
      const result = await window.electron.ipcRenderer.invoke('add-voice');
      if (result) {
        await loadVoices();
        // Get the name of the newly added voice (without the .wav extension)
        const newVoiceName = result.split('.')[0];
        // Set the new voice as the selected speaker
        setSpeakerWav(newVoiceName);
        // Update the scene with the new voice
        updateSceneVoiceline(voiceText, newVoiceName);
      }
    } catch (error) {
      console.error('Failed to add voice:', error);
    }
  };

  const [canExportClip, setCanExportClip] = useState(false);

  useEffect(() => {
    const checkExportability = async () => {
      if (projectData && projectData.scenes[selectedScene - 1]) {
        const scene = projectData.scenes[selectedScene - 1];
        const mp4Path = `${filePath.split("/project.kodan")[0]}/Clips/${selectedScene}.mp4`;
        const pngPath = scene.thumbnail;
        
        const mp4Exists = await window.electron.ipcRenderer.invoke('check-file-exists', mp4Path);
        const pngExists = await window.electron.ipcRenderer.invoke('check-file-exists', pngPath);
        
        setCanExportClip(mp4Exists || pngExists);
      }
    };

    checkExportability();
  }, [projectData, selectedScene, filePath]);

  const handleExportClip = async () => {
    if (!canExportClip) return;

    const scene = projectData.scenes[selectedScene - 1];
    const mp4Path = `${filePath.split("/project.kodan")[0]}/Clips/${selectedScene}.mp4`;
    const pngPath = scene.thumbnail;

    try {
      const exportPath = await window.electron.ipcRenderer.invoke('export-clip', mp4Path, pngPath, selectedScene);
      if (exportPath) {
        console.log(`Clip exported successfully to: ${exportPath}`);
      }
    } catch (error) {
      console.error('Failed to export clip:', error);
    }
  };

  const [thumbnailTimestamps, setThumbnailTimestamps] = useState({});

  const getFileLastModified = async (path) => {
    try {
      const lastModified = await window.electron.ipcRenderer.invoke('check-file-updated', path);
      return lastModified;
    } catch (error) {
      console.error('Error getting file last modified time:', error);
      return null;
    }
  };

  useInterval(() => {
    if (projectData && projectData.scenes) {
      projectData.scenes.forEach(async (scene, index) => {
        const lastModified = await getFileLastModified(scene.thumbnail);
        if (lastModified) {
          setThumbnailTimestamps(prev => ({
            ...prev,
            [index + 1]: lastModified
          }));
        }
      });
    }
  }, 1000);

  useEffect(() => {
    const handleImageGenerationError = (event, data) => {
      alert(`Image generation failed: ${data.errorMessage}`);
      setCurrentlyLoading(prev => prev.filter(scene => scene !== data.sceneIndex));
      setGenerateImageText(prev => ({
        ...prev,
        [data.sceneIndex]: 'Generate Visuals'
      }));
    };

    window.electron.on('image-generation-error', handleImageGenerationError);

    return () => {
      window.electron.off('image-generation-error', handleImageGenerationError);
    };
  }, []);

  return (

    !composeMode ? 
    (<div style={{ height: '100%', width: "100%", display: 'flex', flexDirection: 'column', fontFamily: 'Arial, sans-serif', margin: 0, padding: 0, alignItems: 'center', justifyContent: 'space-between' }}>
<div style={{width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", height: 45, backgroundColor: "#fff", borderBottom: "1px solid #D9D9D9", WebkitAppRegion: "drag"}}>
  <div style={{marginLeft: 12, display: "flex", flexDirection: "row", gap: 9}}>
    {/* Close button */}
    <div 
      onClick={() => window.electron.ipcRenderer.invoke('close-app')}
      style={{backgroundColor: "#FE5F58", width: 14, height: 14, borderRadius: 7, cursor: "pointer", WebkitAppRegion: "no-drag" }}
    ></div>
    
    {/* Minimize button */}
    <div 
      onClick={() => window.electron.ipcRenderer.invoke('minimize-app')}
      style={{backgroundColor: "#FEBC2F", width: 14, height: 14, borderRadius: 7, cursor: "pointer", WebkitAppRegion: "no-drag" }}
    ></div>
    
    {/* Maximize button (adjusts window size to screen dimensions) */}
    <div 
      onClick={() => window.electron.ipcRenderer.invoke('maximize-app')}
      style={{backgroundColor: "#28C840", width: 14, height: 14, borderRadius: 7, cursor: "pointer", WebkitAppRegion: "no-drag" }}
    ></div>
  </div>
  
  <p style={{fontWeight: 500, WebkitAppRegion: "drag"}}>Kōdan</p>
  
  <div>
    <button
      onClick={() => {
        console.log("file path:", filePath.split("/project.kodan")[0]);
        window.electron.ipcRenderer.invoke('render-project', filePath.split("/project.kodan")[0])
          .then(() => {
            console.log('Rendering completed and opened in Finder.');
          })
          .catch((error) => {
            console.error('Error rendering project:', error);
          });
      }}
      style={{
        backgroundColor: "#1F93FF",
        color: "#fff",
        paddingLeft: 8,
        paddingRight: 8,
        border: "0px",
        borderRadius: 4,
        marginRight: 12,
        paddingTop: 4,
        paddingBottom: 4,
        WebkitAppRegion: "no-drag"
      }}
    >
      Export
    </button>
  </div>
</div>


      <div style={{ display: 'flex', width: '100%', height: 'calc(100% - 175px)' }}>
      <div style={{ width: '274px', justifyContent: "space-between", display: "flex", gap: "12px", paddingTop:  "0px", paddingBottom: "9px", flexDirection: "column" }} id="left-bar">
          <div style={{display: "flex", gap: 12, overflowY: "scroll", flexDirection: "column",  paddingTop:  "12px"}}>
          <div style={{display: "flex", flexDirection: "column", gap: 12}}>
          <p style={{fontSize: 16, alignItems: "center", display: "flex", gap: "8px", color: "#404040", marginTop: 0, marginLeft: 12, marginBottom: 0}}>          <Img src="icons/Picture.svg"/>Style</p>
          <div
                data-tooltip-id="base-model-tooltip"
                data-tooltip-content="A base model is a pre-trained AI model that serves as the foundation for generating images. It contains general knowledge about visual concepts and styles."

          style={{display: "flex", flexDirection: "column", gap: 4, marginTop: 8}}>
    
    <p 
      style={{color: "#404040", fontWeight: 800, marginTop: 0, marginBottom: 0, fontSize: 6, marginLeft: 12, marginRight: 12}}
    >
      BASE MODEL
    </p>
    <select 
      value={baseModel}
      onChange={handleBaseModelChange}
      onClick={fetchBaseModels}
      style={{
        width: "calc(100% - 24px)", 
        marginLeft: 12, 
        appearance: "none",
        marginRight: 12,
        padding: "4px 4px",
        border: "1px solid #D9D9D9",
        borderRadius: "4px",
        backgroundColor: "#fff",
        fontSize: "14px",
        color: "#404040"
      }}
    >
      {baseModels.length == 0 && <option>Select Base Model</option>}
      {baseModels.map((model) => (
        <option key={model} value={model}>{model}</option>
      ))}
      <option value="manage">Manage Base Models</option>
    </select>

  </div>
  {baseModels.length == 0 && <Tooltip 
      id="base-model-tooltip" 
      place="top" 
      type="dark" 
      effect="solid" 
      style={{ maxWidth: '300px' }}
    />}

<div 
                data-tooltip-id="lora-model-tooltip"
                data-tooltip-content="A LoRA (Low-Rank Adaptation) module is a fine-tuning technique that allows for efficient adaptation of large language models. It can be used to specialize a base model for specific styles or subjects."

style={{display: "flex", flexDirection: "column", gap: 4, marginTop: 8}}>
  <p style={{color: "#404040", fontWeight: 800, marginTop: 0, marginBottom: 0, fontSize: 6, marginLeft: 12, marginRight: 12}}>LORA MODULE</p>
  <select 
    value={selectedLora}
    onChange={handleLoraChange}
    onClick={fetchLoraModules}
    style={{
      width: "calc(100% - 24px)", 
      marginLeft: 12, 
      marginRight: 12,
      appearance: "none",
      padding: "4px 4px",
      border: "1px solid #D9D9D9",
      borderRadius: "4px",
      backgroundColor: "#fff",
      fontSize: "14px",
      color: "#404040"
    }}
  >
       {loraModules.length == 0 && <option>Select LoRa</option>}

    {loraModules.map((module) => (
      <option key={module} value={module}>{module}</option>
    ))}    

    <option value="manage">Manage LoRa Modules</option>
  </select>
  {loraModules.length == 0 && <Tooltip 
      id="lora-model-tooltip" 
      place="top" 
      type="dark" 
      effect="solid" 
      style={{ maxWidth: '300px' }}
    />}

</div>
          </div>
          <div style={{width: "100%", height: "1px", backgroundColor: "#D9D9D9"}}></div>
          <p style={{fontSize: 16, alignItems: "center", display: "flex", gap: "8px", color: "#404040", marginTop: 0, marginLeft: 12, marginBottom: 0}}><Img src="icons/Prompt.svg"/>Prompt</p>
          <div style={{display: "flex", flexDirection: "column", gap: 4, marginTop: 8}}>
            <p style={{color: "#404040", fontWeight: 800, marginTop: 0, marginBottom: 0, fontSize: 6, marginLeft: 12, marginRight: 12}}>POSITIVE PROMPT</p>
            <textarea
              value={prompt}
              onChange={handlePromptChange}
              style={{
                width: "calc(100% - 32px)", 
                marginLeft: 12, 
                marginRight: 12,
                resize: "none",
                padding: "4px 4px",
                border: "1px solid #D9D9D9",
                borderRadius: "4px",
                backgroundColor: "#fff",
                fontSize: "14px",
                color: "#404040",
                height: "60px",
                overflowY: "auto",
                transition: 'opacity 0.2s ease-in-out',
                opacity: isTransitioning ? 0 : 1,
              }}
              placeholder="Positive Prompt..."
            />
          </div>

          <div style={{display: "flex", flexDirection: "column", gap: 4, marginTop: 8}}>
            <p style={{color: "#404040", fontWeight: 800, marginTop: 0, marginBottom: 0, fontSize: 6, marginLeft: 12, marginRight: 12}}>NEGATIVE PROMPT</p>
            <textarea
              value={negativePrompt}
              onChange={handleNegativePromptChange}
              style={{
                width: "calc(100% - 32px)", 
                marginLeft: 12, 
                marginRight: 12,
                padding: "4px 4px",
                border: "1px solid #D9D9D9",
                borderRadius: "4px",
                backgroundColor: "#fff",
                resize: "none",
                fontSize: "14px",
                color: "#404040",
                height: "60px",
                overflowY: "auto",
                transition: 'opacity 0.2s ease-in-out',
                opacity: isTransitioning ? 0 : 1,
              }}
              placeholder="Negative Prompt..."
            />
          </div>
          {sceneDuration !== null && (
<>          <div style={{width: "100%", height: "1px", backgroundColor: "#D9D9D9"}}></div>
          <p style={{fontSize: 16, alignItems: "center", display: "flex", gap: "8px", color: "#404040", marginTop: 0, marginLeft: 12, marginBottom: 0}}><Img src="icons/clipDuration.svg"/>Duration</p>
            <p style={{fontSize: 14, color: "#404040", marginTop: 0, marginLeft: 12, marginBottom: 12}}>
              {sceneDuration.toFixed(2)} seconds
            </p>
            </>

          )}
          </div>
          <div style={{display: "flex", flexDirection: "column", gap: 12, width: "100%"}}>
          <div style={{width: "100%", height: "1px", backgroundColor: "#D9D9D9"}}></div>

          {/* Add the Generate button here */}
          <button 
            onClick={() => startGenerationForScene(selectedScene)}
            style={{
              backgroundColor: "#fff",
              color: "#404040",
              border: "1px solid #D9D9D9",
              borderRadius: "6px",
              padding: "8px 12px",
              marginLeft: 12,
              marginRight: 12,
              fontSize: 13.3,
              cursor: prompt == "" || currentlyLoading.includes(selectedScene) || (baseModels.length == 0 && loraModules.length == 0) ? "not-allowed" : "pointer",
              opacity: prompt == "" || currentlyLoading.includes(selectedScene) || (baseModels.length == 0 && loraModules.length == 0) ? 0.6 : 1
            }}
            disabled={prompt == "" || currentlyLoading.includes(selectedScene) || (baseModels.length == 0 && loraModules.length == 0)}
          >
            {generateImageText[selectedScene] || 'Generate Visuals'}
          </button>
          </div>
        </div>


        <div style={{ display: 'flex', width: '100%', padding: '42px', backgroundColor: '#F2F2F2', borderRadius: '0px', textAlign: 'center', alignItems: 'center' }} id="content">
          <div id="thumbnail-container" style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            aspectRatio,
            width: '100%',
            maxHeight: "100%",
            flexDirection: "column",
            height: 'fit-content'
          }}>
            {thumbnail != null ? (
              thumbnail.endsWith(".mp4") ? (
                <video
                  key={videoKey}  // Use the videoKey to control re-rendering
                  src={thumbnail}
                  controls
                  style={{
                    aspectRatio,
                    maxWidth: '100%',
                    height: '100%',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    objectFit: 'contain',
                    display: 'flex',
                  }}
                />
              ) : (
                <Img
                  src={thumbnail}
                  alt="Thumbnail"
                  style={{
                    aspectRatio,
                    maxWidth: '100%',
                    height: '100%',
                    borderRadius: '16px',
                    overflow: 'hidden',
                    objectFit: 'contain',
                    display: 'flex',
                  }}
                />
              )
            ) :
            (
              <div
                alt="Thumbnail"
                style={{
                  aspectRatio,
                  maxWidth: '100%',
                  aspectRatio: aspectRatio,
                  height: '100%',
                  borderRadius: '16px',
                  overflow: 'hidden',
                  objectFit: 'contain',
                  display: 'flex',
                  flexDirection:'column',
                  backgroundColor: "#fff", 
                  alignItems: "center",
                  justifyContent:"center"
                }}
              >
                {!currentlyLoading.includes(selectedScene) ? (
                  <div style={{
                    width: "100%",
                    maxWidth: "518px",
                    padding: '24px',
                    border: "1px solid #000", borderRadius: "16px",
                    display: 'flex', 
                    alignItems: 'start',
                    flexDirection: 'column'
                  }}>
                    <p style={{fontSize: 24, marginTop: 0, marginBottom: 20}}>Scene Visual</p>
                    <div style={{display: 'flex', width: "100%", gap: 12, flexDirection: 'row'}}>
                      <div style={{display: "flex", width: "calc(100% - 16px)", alignItems: 'start', flexDirection: "column"}}>
                        <p className="labelTop">POSITIVE PROMPT</p>
                        <textarea
                          value={prompt}
                          style={{width: "calc(100% - 16px)", fontSize: 14, maxWidth: 250}}
                          onChange={handlePromptChange}
                          placeholder="Positive Prompt..."
                        />
                      </div> 
                      <div style={{display: "flex", width: "calc(100% - 16px)", alignItems: 'start', flexDirection: "column"}}>
                        <p className="labelTop">NEGATIVE PROMPT</p>
                        <textarea
                          value={negativePrompt}
                          style={{width: "calc(100% - 16px)", fontSize: 14, maxWidth: 250}}
                          onChange={handleNegativePromptChange}
                          placeholder="Negative Prompt..."
                        />
                      </div>
                    </div> 
                    <button disabled={prompt == "" || (baseModels.length == 0 && loraModules.length == 0)} style={{marginTop: 24, cursor: "pointer", border: "1px solid #D9D9D9", paddingTop: 8, paddingBottom: 8, backgroundColor:  "#fff", color: "#404040", fontSize: 16, width: "100%", borderRadius: "6px"}} onClick={() => {
                      startGenerationForScene(selectedScene);
                    }}>Generate Visuals</button>
                  </div>) : (
                    <div>
                      <progress id="progress-bar" max="100" value={progressMap[selectedScene] || null}></progress>
                      <p style={{
                        fontSize: '12px',
                        color: '#404040',
                        marginTop: '8px',
                        textAlign: 'center',
                        margin: '8px auto 0'
                      }}>
                        {currentFact}
                      </p>
                    </div>
                  )}
              </div>
            )}
            <div style={{width: "100%", gap: 16, display: 'flex', flexDirection: "row", maxWidth: "700px", paddingTop: 24}}>
            <input 
                    value={voiceText}
                    onChange={handleVoiceTextChange}
                    //onBlur={handleVoiceTextBlur}
            placeholder="Voiceline for this scene..." style={{display: "flex", width: "100%"}}/>

            <div style={{paddingLeft: 0, width: 128, paddingRight: 8, backgroundColor: "#fff", border: "1px solid #D9D9D9", borderRadius: "8px"}}>
            <select
                  value={speakerWav}
                  onChange={handleSpeakerChange}
                  style={{paddingLeft: 8, height: "100%", width: "100%", paddingRight: 0, border: "0px solid #D9D9D9", borderRadius: "8px"}} 
                  name="voice" 
                  id="voice-select"
            >
              {voices.map((voice) => (
                <option key={voice} value={voice}>{voice}</option>
              ))}
              <option value="add-voice">Add Voice...</option>
            </select>
            </div>
              <button 
                style={{
                  border:"1px solid #D9D9D9", 
                  width: "196px", 
                  borderRadius: "8px", 
                  backgroundColor: "#fff", 
                  padding: "12px 8px",
                  fontSize: 13.3,
                  cursor: isGeneratingVoice ? "not-allowed" : "pointer",
                  opacity: isGeneratingVoice ? 0.6 : 1
                }} 
                onClick={() => generateVoiceLine(selectedScene)}
                disabled={isGeneratingVoice}
              >
                {generateText}
              </button>

            </div>
          </div>
        </div>
        <div style={{ width: '274px', display: "flex", gap: "12px", paddingTop:  "12px", paddingBottom: "16px", flexDirection: "column" }} id="right-bar">
          

          <p style={{fontSize: 16, alignItems: "center", display: "flex", gap: "8px", color: "#404040", marginTop: 0, marginLeft: 12, marginBottom: 0}}>          <Img src="icons/caption.svg"/>Caption</p>
          <div style={{display: "flex", flexDirection: "row", gap: 8, marginLeft: 12, marginRight: 12}}>
            <select 
              value={captionSettings.selectedFont}
              onChange={handleFontChange}
              onClick={() => window.electron.ipcRenderer.invoke('get-system-fonts')}
              style={{width: "50%",
                borderRadius: "4px",
                appearance: 'none',
                border: "1px solid #D9D9D9", padding: "4px", fontSize: 14}}
            >
              {availableFonts.map((font) => (
                <option key={font.name} value={font.name}>{font.name}</option>
              ))}
            </select>
            <select 
              value={captionSettings.selectedWeight}
              onChange={handleWeightChange}
              style={{width: "50%",
                borderRadius: "4px",
                appearance: 'none',
                border: "1px solid #D9D9D9", padding: "4px", fontSize: 14}}
            >
              {availableWeights.map((weight) => (
                <option key={weight.value} value={weight.value}>{weight.label}</option>
              ))}
            </select>
          </div>
          <div style={{display: "flex", flexDirection: "row", gap: 8, marginLeft: 12, marginRight: 12}}>
            <input
              type="number"
              value={captionSettings.fontSize}
              onChange={handleFontSizeChange}
              min="1"
              max="99"
              style={{
                width: "50%",
                borderRadius: "4px",
                border: "1px solid #D9D9D9",
                padding: "4px",
                fontSize: 14
              }}
            />
            <div 
              onClick={openColorPicker}
              style={{
                width: "50%",
                display: "flex",
                alignItems: "center",
                gap: 4,
                borderRadius: "4px",
                border: "1px solid #D9D9D9",
                padding: "4px",
                fontSize: 14,
                cursor: "pointer"
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  backgroundColor: captionSettings.captionColor,
                  border: "1px solid #D9D9D9",
                  borderRadius: "2px"
                }}
              ></div>
              <input
                ref={colorInputRef}
                type="color"
                value={captionSettings.captionColor}
                onChange={handleColorChange}
                style={{
                  position: "absolute",
                  width: 0,
                  height: 0,
                  padding: 0,
                  border: "none",
                  visibility: "hidden"
                }}
              />
              <span style={{flexGrow: 1, textAlign: "center"}}>{captionSettings.captionColor}</span>
            </div>
          </div>
          <textarea
            value={localCaption}
            onChange={handleCaptionChange}
            onBlur={handleCaptionBlur}
            placeholder="Caption for this scene..."
            style={{
              width: "calc(100% - 32px)",
              marginLeft: 12,
              marginRight: 12,
              fontFamily: captionSettings.selectedFont,
              resize: "none",
              padding: "4px 4px",
              border: "1px solid #D9D9D9",
              borderRadius: "4px",
              backgroundColor: "#fff",
              fontSize: "14px",
              color: "#404040",
              height: "60px",
              overflowY: "auto"
            }}
          />
          <p style={{fontSize: 14, color: "#404040", marginTop: 0, marginLeft: 12, marginBottom: 0}}>Caption Stroke</p>
          <div style={{display: "flex", flexDirection: "row", gap: 8, marginLeft: 12, marginRight: 12}}>
            <input
              type="number"
              value={captionSettings.strokeSize}
              onChange={handleStrokeSizeChange}
              min="1"
              max="99"
              style={{
                width: "50%",
                borderRadius: "4px",
                border: "1px solid #D9D9D9",
                padding: "4px",
                fontSize: 14
              }}
            />
            <div 
              onClick={openStrokeColorPicker}
              style={{
                width: "50%",
                display: "flex",
                alignItems: "center",
                gap: 4,
                borderRadius: "4px",
                border: "1px solid #D9D9D9",
                padding: "4px",
                fontSize: 14,
                cursor: "pointer"
              }}
            >
              <div
                style={{
                  width: 20,
                  height: 20,
                  backgroundColor: captionSettings.strokeColor,
                  border: "1px solid #D9D9D9",
                  borderRadius: "2px"
                }}
              ></div>
              <input
                ref={colorStrokeInputRef}
                type="color"
                value={captionSettings.strokeColor}
                onChange={handleStrokeColorChange}
                style={{
                  position: "absolute",
                  width: 0,
                  height: 0,
                  padding: 0,
                  border: "none",
                  visibility: "hidden"
                }}
              />
              <span style={{flexGrow: 1, textAlign: "center"}}>{captionSettings.strokeColor}</span>
            </div>
          </div>
          <div style={{width: "100%", height: "1px", backgroundColor: "#D9D9D9"}}></div>
          <p style={{fontSize: 16, alignItems: "center", display: "flex", gap: "8px", color: "#404040", marginTop: 0, marginLeft: 12, marginBottom: 0}}><Img src="icons/export.svg"/>Export Clip</p>

          <button 
            onClick={handleExportClip}
            disabled={!canExportClip}
            style={{
              backgroundColor: "#fff",
              color: "#404040",
              border: "1px solid #D9D9D9",
              borderRadius: "6px",
              padding: "8px 12px",
              marginLeft: 12,
              marginRight: 12,
              fontSize: 13.3,
              cursor: canExportClip ? "pointer" : "not-allowed",
              opacity: canExportClip ? 1 : 0.6
            }}
          >
            Export Clip
          </button>

      </div>  
      </div>
      <div id="bottom-bar" style={{ height: '175px', display: 'flex', width: 'calc(100% - 24px)', paddingLeft: "0px", paddingRight:"24px", overflowX: "scroll", backgroundColor: '#404040' }}>
        {projectData && projectData?.scenes?.map((item, index) => (
          <div
            key={item.id}
            ref={el => sceneRefs.current[index + 1] = el}
            style={{
              display: index == 0 ? ("none"): ('flex'),
              width: deletingScenes.has(index + 1) ? '0px' : 'fit-content',
              maxHeight: deletingScenes.has(index + 1) ? '0px' : '100%',
              padding: deletingScenes.has(index + 1) ? '0px' : '24px',
              marginLeft: deletingScenes.has(index + 1) ? '0px' : '24px',
              paddingLeft: '0px',
              paddingRight: '0px',
              marginRight: '0px',
              position: "relative",
              cursor: 'pointer',
              opacity: deletingScenes.has(index + 1) ? 0 : (selectedScene === index + 1 ? 1 : 0.3),
              transform: `scale(${(pressedScene === index + 1 && isMouseDown) || (selectedScene === index + 1 && pressedScene === selectedScene) ? 0.9 : 1})`,
              transition: "opacity 0.25s ease-out, transform 0.1s ease-out, width 0.3s ease-out, height 0.3s ease-out, margin 0.3s ease-out, padding 0.3s ease-out"
            }}
            onMouseDown={() => {
              setPressedScene(index + 1);
              setIsMouseDown(true);
            }}
            onMouseUp={() => {
              setIsMouseDown(false);
              if (pressedScene === index + 1) {
                setSelectedScene(index + 1);
              }
              setPressedScene(null);
            }}
            onMouseLeave={() => {
              if (isMouseDown) {
                setIsMouseDown(false);
                setPressedScene(null);
              }
            }}
          >
            {(!deletingScenes.has(selectedScene) && !currentlyLoading.includes(selectedScene) || thumbnail != null) && (
              <>
                <Img 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteScene(index);
                  }}
                  style={{
                    width: 18, 
                    height: 18, 
                    position: "absolute", 
                    top: 32, 
                    right: 12,
                    opacity: selectedScene === index + 1 ? 1 : 0,
                    transform: `scale(${selectedScene === index + 1 ? 1 : 0})`,
                    transition: "opacity 0.25s ease-out, transform 0.25s ease-out",
                    zIndex: 10,
                  }} 
                  src="./icons/Minus.svg"
                />
                {canExportClip && <Img 
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenFolder(index + 1);
                  }}
                  style={{
                    width: 18, 
                    height: 18, 
                    position: "absolute", 
                    top: 32, 
                    right: 36,
                    opacity: selectedScene === index + 1 ? 1 : 0,
                    transform: `scale(${selectedScene === index + 1 ? 1 : 0})`,
                    transition: "opacity 0.25s ease-out, transform 0.25s ease-out",
                    zIndex: 10,
                  }} 
                  src="./icons/Folder.svg"
                />}
              </>
            )}
        <Img
          src={`${item.thumbnail}?t=${thumbnailTimestamps[index + 1] || ''}`}
          loader={
            <div style={{
              aspectRatio,
              borderRadius: '12px',
              maxHeight: '100%',
              width: '100%',
              backgroundColor: '#F2F2F2',
            }} />
          }
          unloader={
            <div style={{
              aspectRatio,
              borderRadius: '12px',
              maxHeight: '100%',
              transition: "opacity 0.1s ease-out, width 0.3s ease-out, transform 0.1s ease-out",
              width: '100%',
              backgroundColor: '#F2F2F2',
            }} />
          }
          style={{
            aspectRatio,
            borderRadius: '12px',
            maxHeight: '100%',
            display: 'flex',
            backgroundColor: '#fff',
            objectFit: 'cover',
            transition: "opacity 0.1s ease-out, width 0.3s ease-out, transform 0.1s ease-out",
            opacity: (pressedScene === index + 1 && isMouseDown) || (selectedScene === index + 1 && pressedScene === selectedScene) ? 0.7 : 1,
            transform: `scale(${(pressedScene === index + 1 && isMouseDown) || (selectedScene === index + 1 && pressedScene === selectedScene) ? 0.95 : 1})`
          }}
        />
          </div>
        ))}
        <div
          id="addItem"
          style={{
            display: 'flex',
            width: 'fit-content',
            maxHeight: '100%',
            padding: '24px',
            marginLeft: '24px',
            paddingLeft: '0px',
            paddingRight: '0px',
            marginRight: '0px',
            cursor: "pointer",
            transform: `scale(${pressedAddScene ? 0.9 : 1})`,
            transition: "transform 0.1s ease-out"
          }}
          onMouseDown={() => setPressedAddScene(true)}
          onMouseUp={() => {
            setPressedAddScene(false);
            addNewScene();
          }}
          onMouseLeave={() => setPressedAddScene(false)}
        >
          <div
            style={{
              aspectRatio,
              border: '4px solid #D9D9D9',
              borderRadius: '12px',
              maxHeight: '100%',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              opacity: pressedAddScene ? 0.7 : 1,
              transform: `scale(${pressedAddScene ? 0.95 : 1})`,
              transition: "opacity 0.1s ease-out, transform 0.1s ease-out"
            }}
          >
            <Img src='./icons/Plus.svg' style={{ width: '32px', height: '32px' }} alt="Add Item" />
          </div>
        </div>
      </div>
    </div>) : 
    (
      <div style={{ height: '100%', width: "100%", display: 'flex', flexDirection: 'column', fontFamily: 'Arial, sans-serif', margin: 0, padding: 0, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", height: 45, backgroundColor: "#fff", borderBottom: "1px solid #D9D9D9", WebkitAppRegion: "drag"}}>
          <div style={{marginLeft: 12, display: "flex", flexDirection: "row", gap: 9}}>
            {/* Close button */}
            <div 
              onClick={() => window.electron.ipcRenderer.invoke('close-app')}
              style={{backgroundColor: "#FE5F58", width: 14, height: 14, borderRadius: 7, cursor: "pointer", WebkitAppRegion: "no-drag" }}
            ></div>
            
            {/* Minimize button */}
            <div 
              onClick={() => window.electron.ipcRenderer.invoke('minimize-app')}
              style={{backgroundColor: "#FEBC2F", width: 14, height: 14, borderRadius: 7, cursor: "pointer", WebkitAppRegion: "no-drag" }}
            ></div>
            
            {/* Maximize button (adjusts window size to screen dimensions) */}
            <div 
              onClick={() => window.electron.ipcRenderer.invoke('maximize-app')}
              style={{backgroundColor: "#28C840", width: 14, height: 14, borderRadius: 7, cursor: "pointer", WebkitAppRegion: "no-drag" }}
            ></div>
          </div>        
        </div>
<div style={{display: "flex", flexDirection: "row", widows: "100vw", justifyContent: "center"}}>

<div style={{display: "flex", height: "100%", width: "50vw", borderLeft: "1px solid #D9D9D9",  borderRight: "1px solid #D9D9D9"}}>
<div style={{ position: 'relative', width: "100%", height: "100%", display: "flex" }}>
  <textarea 
    style={{width: '100%', padding: '8px', height: 'calc(100vh - 46px)', border: '0px', borderRadius: '0px', resize: 'none', overflowY: 'auto', fontFamily: 'system-ui, sans-serif'}}
    value={composeUserInput}
    onChange={e => setComposeUserInput(e.target.value)}
    placeholder="Compose your story..."
    placeholderStyle={{color: '#BFBFBF'}}
    disabled={composeSubmitted}
  ></textarea>
  {!composeSubmitted && <button 
    style={{ position: 'absolute', bottom: 12, right: 12, backgroundColor: '#000', color: 'white', border: 'none', fontWeight: 500, borderRadius: '4px', fontSize: "16px", padding: "4px 8px", cursor: 'pointer', opacity: composeUserInput ? 1 : 0.5 }}
    disabled={!composeUserInput}
    onClick={() => setComposeSubmitted(true)}
  >
    Generate Story
  </button>}
</div>        
</div>
{composeSubmitted &&        <div style={{display: "flex", height: "100%", width: "50vw", borderLeft: "0px solid #D9D9D9",  borderRight: "1px solid #D9D9D9"}}>
<div style={{ position: 'relative', width: "100%", height: "100%", display: "flex" }}>
  <p style={{fontSize: 16, width: "100%", height: "100%", display: "flex", margin: 0, padding: 8}}>Enriching Story...</p>
  
</div>        
</div>}
</div>
      </div> 
  )
)}

export default ProjectComponent;
