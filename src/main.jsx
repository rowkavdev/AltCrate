import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './shadcn.css';
import './styles.css';
import './presetOverrides.css';
import './workspaceResponsive.css';
import './workspaceDesign.css';
import {applyTheme, readTheme} from './theme.js';

applyTheme(readTheme());

createRoot(document.getElementById('root')).render(
  <React.StrictMode><App /></React.StrictMode>
);
