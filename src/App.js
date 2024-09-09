import React, { useState, useEffect } from 'react';
import NoFolderView from './components/NoFolderView';
import FolderView from './components/FolderView';

const App = () => {
  const [folderPath, setFolderPath] = useState(null);
  const [projects, setProjects] = useState([]);

  useEffect(() => {
    const savedFolder = localStorage.getItem('kodanFolder');
    if (savedFolder) {
      loadProjects(savedFolder);
    }
  }, []);

  const loadProjects = async (folderPath) => {
    try {
      const projects = await window.electron.getProjectData(folderPath);
      setProjects(projects);
      setFolderPath(folderPath);
    } catch (error) {
      console.error("Failed to load projects:", error);
    }
  };
  
  const handleSelectFolder = async () => {
    try {
      const folderPath = await window.electron.selectFolder();
      if (folderPath) {
        localStorage.setItem('kodanFolder', folderPath);
        loadProjects(folderPath);
      }
    } catch (error) {
      console.error("Failed to select folder:", error);
    }
  };
  

  const handleChangeFolder = () => {
    window.electron.selectFolder().then((folderPath) => {
      if (folderPath) {
        localStorage.setItem('kodanFolder', folderPath);
        loadProjects(folderPath);
      }
    });
  };
  const handleCreateProject = async (projectDetails) => {
    try {
      const success = await window.electron.createProject(projectDetails);
      if (success) {
        loadProjects(folderPath);
        setIsModalOpen(false);
      }
    } catch (error) {
      console.error("Failed to create project:", error);
    }
  };
  
  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' }}>
      {!folderPath ? (
        <NoFolderView onSelectFolder={handleSelectFolder} />
      ) : (
        <FolderView onSubmit={handleCreateProject} projects={projects} onChangeFolder={handleChangeFolder} />
      )}
    </div>
  );
};

export default App;
