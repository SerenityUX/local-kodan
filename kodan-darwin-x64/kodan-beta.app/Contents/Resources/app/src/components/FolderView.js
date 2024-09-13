import React,  { useState, useEffect } from 'react';

const FolderView = ({ projects, onChangeFolder }) => {
    const [isOverlayVisible, setOverlayVisible] = useState(false);


    useEffect(() => {
        window.electron.ipcRenderer.on('close-modal', () => {
          setOverlayVisible(false); // Hide overlay when modal closes
        });
    
        return () => {
          window.electron.ipcRenderer.removeAllListeners('close-modal');
        };
      }, []);

    const openModal = () => {
        window.electron.ipcRenderer.send('open-modal');
        setOverlayVisible(true); // Show overlay when modal opens
  
    };

    const handleProjectClick = (projectFilePath) => {
      window.electron.ipcRenderer.send('open-project', projectFilePath);
    };




  return (
    <div>

        <div style={{width: "100%", height: "100%", display: "flex", position: "absolute", backgroundColor: "#000", pointerEvents: !isOverlayVisible ? ("none") : ("auto"), opacity: isOverlayVisible ? (0.5) : (0), transition: "opacity 0.3s ease-out"}}>
        </div>

        <div style={{display: "flex",  padding: "16px", justifyContent: "space-between"}}>
            <p style={{fontSize: 24, margin: 0}}>Kōdan Anime Studio</p>
            <button onClick={openModal} style={{backgroundColor: "#1F93FF", cursor: "pointer", border: "0px", borderRadius: "4px", color: "#fff"}}>Create Anime</button>
        </div>
     {/* <button onClick={onChangeFolder}>Change Folder</button> */}
      <div style={{display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: '1px'}}>
        {projects.map((project, index) => (
          <div style={{cursor: "pointer"}} onClick={() => handleProjectClick(project.path)} // Send project path on click
          key={index} className="project">
            <img style={{position: "absolute"}}/>
            <img style={{width: "100%", height: "fit-object", backgroundColor: "#F2F2F2", objectFit: "contain", aspectRatio: 16/9, display: "flex"}} src={project.thumbnail} alt={project.name} />
            
            <div style={{padding: "2px"}}>
            <div style={{fontSize: 16}} className="project-name">{project.name}</div>
            <div style={{fontSize: 8}} className="project-time">
              Last Edited: {new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: 'numeric',
              }).format(new Date(project.lastEdited))}
            </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default FolderView;
