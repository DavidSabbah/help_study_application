import React from 'react';
import { registerRootComponent } from 'expo';
import App from './App';
import { installDebugLog } from './src/debug/debugLog';
import { I18nProvider } from './src/i18n/I18n';

installDebugLog();

function Root() {
  return React.createElement(I18nProvider, null, React.createElement(App));
}

registerRootComponent(Root);

