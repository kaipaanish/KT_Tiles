import './styles.css';
import './panels.css';
import './photo.css';
import { startApp } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (root) startApp(root);
