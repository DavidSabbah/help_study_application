import { registerRootComponent } from 'expo';
import App from './App';
import { installDebugLog } from './src/debug/debugLog';

installDebugLog();

registerRootComponent(App);

