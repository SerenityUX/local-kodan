import React from 'react';
import { createRoot } from 'react-dom/client';
import ProjectComponent from './components/ProjectComponent';

const urlParams = new URLSearchParams(window.location.search);
const filePath = urlParams.get('filePath');

const container = document.getElementById('root');
const root = createRoot(container);

root.render(<ProjectComponent filePath={filePath} />);
