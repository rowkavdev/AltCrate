import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import '@workspace/ui/globals.css';
import './styles.css';
import './presetOverrides.css';
import './workspaceResponsive.css';
import './workspaceDesign.css';
import {applyTheme, readTheme} from './theme.js';
import { DesktopDirection } from './DesktopDirection.jsx';
import { installDesktopBridge } from './desktopBridge.js';
import './desktop.css';

await installDesktopBridge();

applyTheme(readTheme());

createRoot(document.getElementById('root')).render(
  <React.StrictMode><DesktopDirection><App /></DesktopDirection></React.StrictMode>
);
