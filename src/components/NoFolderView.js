import React from 'react';

const NoFolderView = ({ onSelectFolder }) => {
  return (
    <div>
      <h1>Welcome to Kōdan</h1>
      <p>Please select your Kōdan folder to get started.</p>
      <button onClick={onSelectFolder}>Select Your Kōdan Folder</button>
    </div>
  );
};

export default NoFolderView;
