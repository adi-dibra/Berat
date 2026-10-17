import { render } from 'preact';
import { App } from './App';
import { loadSettings } from './settings';
import './styles.css';

loadSettings().then((settings) => render(<App initial={settings} />, document.getElementById('app')!));
