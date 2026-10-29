// first: secure random numbers for the encryption libraries (they look for them when they load)
import './src/crypto/polyfill';
// then the push task must exist before anything else, because android may start the app without any
// screen just to run it (a push arriving while YaapZone is closed)
import './src/services/pushTask';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
